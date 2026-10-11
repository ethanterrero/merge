-- Matching (M-26). Spec: docs/superpowers/specs/2026-10-10-matching-rpc-design.md.
--
-- Discovery for the signed-in member: public.find_matches(ride_date, role_filter),
-- a security definer RPC. profiles, commutes and vehicles stay owner-only (0002,
-- 0004); this function reads them as its owner and returns only what the privacy
-- invariants allow before a ride is confirmed:
--   - name through public_name, role, the vetted flag and ride preferences;
--   - the STORED area centers and labels (0008), never an exact point;
--   - shared weekdays, the other person's departure time and window;
--   - the detour as a band ('under_3' or '3_to_5'), never whole minutes (owner, Q8);
--   - seats and scooter fit, never make, model, color or plate.
-- Every hard filter runs here, inside definer code: opt-in (D-14), is_active,
-- is_blocked both ways, the D-06 vetting gate for drivers, weekday, departure
-- windows, vehicle, seats and the per-date availability, cargo (D-04), and M-33's
-- estimate_detour_minutes (D-08), which is called, never reimplemented.

-- Indexes ------------------------------------------------------------------------
-- The area prefilter below compares candidates' generalized areas against a point
-- derived from the caller's own route. 0008 created neither index.

create index if not exists commutes_origin_area_gist on public.commutes using gist (origin_area);
create index if not exists commutes_destination_area_gist on public.commutes using gist (destination_area);

-- Area prefilter ---------------------------------------------------------------------
-- A necessary condition for a detour within the limit, on generalized areas.
-- If the passenger's exact points are within the limit, both lie inside the ellipse
-- with foci at the driver's origin and destination and major axis L + D, where L is
-- the driver's direct distance and D the largest insertion cost (meters) that still
-- rounds to detour_limit_minutes() (M-33's road_minutes rounds half up). That
-- ellipse lies in the disc of radius (L + D) / 2 around the route's midpoint, and
-- each exact point is within area_radius_m() of its area center. The 1% covers the
-- planar approximation at Bay Area distances. It only ever lets more through:
-- rule 13 (estimate_detour_minutes) still decides.

create function public.match_prefilter(
  driver_origin extensions.geography,
  driver_dest extensions.geography,
  pax_origin_area extensions.geography,
  pax_dest_area extensions.geography
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    extensions.st_dwithin(pax_origin_area, r.mid, r.radius)
      and extensions.st_dwithin(pax_dest_area, r.mid, r.radius),
    false)
  from (
    select
      extensions.st_project(
        driver_origin,
        l.len / 2,
        coalesce(extensions.st_azimuth(driver_origin, driver_dest), 0)) as mid,
      (l.len
        + (public.detour_limit_minutes() + 0.5)
          * public.detour_speed_mph() * 1609.344 / 60
          / public.detour_road_factor())
        / 2 * 1.01
        + public.area_radius_m() as radius
    from (select extensions.st_distance(driver_origin, driver_dest) as len) l
  ) r
$$;

-- Shared-days label ------------------------------------------------------------------
-- 'Every weekday' for Mon–Fri. Otherwise runs of 3 or more consecutive days become a
-- range ('Mon–Thu'), shorter runs are listed ('Mon, Tue'), pieces are joined with
-- commas, and ' overlap' is appended: 'Mon–Wed, Fri overlap'.

create function public.match_days_label(days integer[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when days = array[1,2,3,4,5] then 'Every weekday'
    else (
      select string_agg(runs.piece, ', ' order by runs.first_day) || ' overlap'
      from (
        select
          min(s.d) as first_day,
          case
            when count(*) >= 3 then
              (array['Mon','Tue','Wed','Thu','Fri'])[min(s.d)] || '–'
                || (array['Mon','Tue','Wed','Thu','Fri'])[max(s.d)]
            else string_agg((array['Mon','Tue','Wed','Thu','Fri'])[s.d], ', ' order by s.d)
          end as piece
        from (
          select u.d, u.d - row_number() over (order by u.d) as grp
          from unnest(days) as u(d)
        ) s
        group by s.grp
      ) runs
    )
  end
$$;

-- Candidates ---------------------------------------------------------------------------
-- Every eligible pair for member `me` on `ride_date` (spec section 2), with raw
-- fields, including EXACT detour minutes. Never client-callable: find_matches and
-- later security definer RPCs (M-27's send_invitation) call it. It's invoker on
-- purpose: run by a client it would see only that client's own commutes under RLS.
-- Parameters are qualified as match_candidates.<name>: in a SQL function a column of
-- the same name (rides.ride_date) would otherwise win.
-- M-41 (cohort) and M-27 extend this function: copy this definition first.

create function public.match_candidates(me uuid, ride_date date)
returns table (
  my_commute_id uuid,
  other_commute_id uuid,
  other_id uuid,
  role text,
  detour_minutes integer,
  departure_gap_minutes integer,
  shared_weekdays integer[],
  seats_offered integer,
  seats_open integer,
  pax_brings_scooter boolean,
  scooter_fits boolean,
  shared_prefs text[],
  connected boolean,
  reaches_hov boolean
)
language sql
stable
set search_path = ''
as $$
  with
  mine as (
    select c.id, c.role, c.departure_time, c.departure_flex_minutes, c.weekdays
    from public.commutes c
    where c.owner_id = match_candidates.me
      and extract(isodow from match_candidates.ride_date)::integer = any (c.weekdays)
  ),
  pairs as (
    select
      m.id as my_commute_id,
      t.id as other_commute_id,
      t.owner_id as other_id,
      t.role as other_role,
      (extract(epoch from (t.departure_time - m.departure_time)) / 60)::integer as gap,
      m.departure_flex_minutes + t.departure_flex_minutes as flex_sum,
      m.weekdays as my_days,
      t.weekdays as their_days,
      case when t.role = 'driver' then t.id else m.id end as drv_commute_id,
      case when t.role = 'driver' then m.id else t.id end as pax_commute_id
    from mine m
    join public.commutes t
      on t.role <> m.role
     and t.owner_id <> match_candidates.me
     and extract(isodow from match_candidates.ride_date)::integer = any (t.weekdays)
  ),
  eligible as (
    select
      pr.*,
      dc.owner_id as drv_owner,
      dc.origin as drv_origin,
      dc.destination as drv_dest,
      dc.max_detour_minutes as drv_max_detour,
      least(dc.seats_offered, v.passenger_seats) as seats_total,
      v.accepts_foldable_scooters as fits,
      pc.owner_id as pax_owner,
      pc.origin as pax_origin,
      pc.destination as pax_dest,
      pc.origin_area as pax_origin_area,
      pc.destination_area as pax_dest_area,
      pc.brings_scooter as pax_scooter,
      (select count(*)::integer
         from public.rides r
        where r.driver_id = dc.owner_id
          and r.ride_date = match_candidates.ride_date
          and r.status in ('confirmed','completed')) as booked
    from pairs pr
    join public.commutes dc on dc.id = pr.drv_commute_id
    join public.commutes pc on pc.id = pr.pax_commute_id
    -- Rule 9: a driver commute with no vehicle neither matches nor is matched.
    join public.vehicles v on v.id = dc.vehicle_id
    join public.profiles op on op.id = pr.other_id
    where op.discovery_opt_in                                              -- rule 3
      and public.is_active(pr.other_id)                                    -- rule 4
      and not public.is_blocked(match_candidates.me, pr.other_id)          -- rule 5
      and (pr.other_role <> 'driver' or public.is_vetted(pr.other_id))     -- rule 6 (Q1)
      and abs(pr.gap) <= pr.flex_sum                                       -- rule 8 (Q5)
      and (not pc.brings_scooter or v.accepts_foldable_scooters)           -- rule 12
  ),
  available as (
    select e.*
    from eligible e
    where
      -- Rules 10-11 (Q2), for the other person only.
      case
        when e.other_role = 'driver' then
          e.seats_total - e.booked > 0
          and not exists (
            select 1 from public.rides r
            where r.passenger_id = e.other_id
              and r.ride_date = match_candidates.ride_date
              and r.status in ('confirmed','completed'))
        else
          not exists (
            select 1 from public.rides r
            where e.other_id in (r.driver_id, r.passenger_id)
              and r.ride_date = match_candidates.ride_date
              and r.status in ('confirmed','completed'))
      end
      and public.match_prefilter(e.drv_origin, e.drv_dest, e.pax_origin_area, e.pax_dest_area)
  ),
  scored as (
    select
      a.*,
      public.estimate_detour_minutes(a.drv_origin, a.drv_dest, a.pax_origin, a.pax_dest) as detour
    from available a
  )
  select
    s.my_commute_id,
    s.other_commute_id,
    s.other_id,
    s.other_role,
    s.detour,
    s.gap,
    array(select d from unnest(s.my_days) as u(d) where d = any (s.their_days) order by d),
    s.seats_total,
    s.seats_total - s.booked,
    s.pax_scooter,
    s.fits,
    array(
      select pref
      from unnest(mp.ride_prefs) as u(pref)
      where pref = any (op.ride_prefs)
      order by pref),
    exists (
      select 1 from public.connections cn
      where cn.user_low = least(match_candidates.me, s.other_id)
        and cn.user_high = greatest(match_candidates.me, s.other_id)),
    -- Q7: the driver, this passenger and the driver's booked passengers make 3 or
    -- more people. A ranking key only; never returned to a client.
    s.booked + 2 >= 3
  from scored s
  join public.profiles op on op.id = s.other_id
  join public.profiles mp on mp.id = match_candidates.me
  where s.detour is not null                                                    -- rule 13
    and s.detour <= least(public.detour_limit_minutes(), s.drv_max_detour)
$$;

-- find_matches ---------------------------------------------------------------------------
-- The client RPC. Caller checks (spec section 1), the role filter, presentation
-- columns (section 3), reasons (section 6), ranking (section 5) and the 50-row cap.
-- Exact detour minutes are used for ranking and the band only; no returned column
-- carries them (Q8). Output columns are named in RETURNS TABLE, so every column
-- reference in the body is qualified, and the parameters are qualified as
-- find_matches.<name>.

create function public.find_matches(ride_date date, role_filter text default 'all')
returns table (
  other_id uuid,
  role text,
  name text,
  vetted boolean,
  ride_prefs text[],
  origin_area_lat double precision,
  origin_area_lng double precision,
  origin_area_label text,
  destination_area_lat double precision,
  destination_area_lng double precision,
  destination_area_label text,
  area_radius_m integer,
  shared_weekdays integer[],
  departure_time time,
  window_start time,
  window_end time,
  departure_gap_minutes integer,
  detour_band text,
  seats_offered integer,
  seats_open integer,
  brings_scooter boolean,
  scooter_fits boolean,
  connected boolean,
  reasons jsonb,
  rank integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if me is null then
    raise exception 'Sign in to see matches' using errcode = '42501';
  end if;
  if find_matches.ride_date is null or find_matches.ride_date < today then
    raise exception 'Choose today or a later date' using errcode = '22023';
  end if;
  if find_matches.role_filter is not null
     and find_matches.role_filter not in ('all', 'driver', 'passenger') then
    raise exception 'role_filter must be all, driver or passenger' using errcode = '22023';
  end if;

  -- No profile, or suspended: nothing, the same as "no matches yet" (member-status
  -- spec decision 3).
  if not exists (
    select 1 from public.profiles p where p.id = me and p.suspended_at is null
  ) then
    return;
  end if;

  return query
  with ranked as (
    select
      mc.*,
      row_number() over (
        order by
          mc.detour_minutes,
          abs(mc.departure_gap_minutes),
          mc.connected desc,
          cardinality(mc.shared_prefs) desc,
          cardinality(mc.shared_weekdays) desc,
          mc.reaches_hov desc,
          mc.other_id,
          mc.role
      )::integer as n
    from public.match_candidates(me, find_matches.ride_date) mc
    where find_matches.role_filter is null
       or find_matches.role_filter = 'all'
       or mc.role = find_matches.role_filter
  )
  select
    r.other_id,
    r.role,
    public.public_name(op.display_name),
    public.is_vetted(r.other_id),
    op.ride_prefs,
    extensions.st_y(t.origin_area::extensions.geometry),
    extensions.st_x(t.origin_area::extensions.geometry),
    t.origin_area_label,
    extensions.st_y(t.destination_area::extensions.geometry),
    extensions.st_x(t.destination_area::extensions.geometry),
    t.destination_area_label,
    public.area_radius_m()::integer,
    r.shared_weekdays,
    t.departure_time,
    pg_catalog.make_time(w.start_min / 60, w.start_min % 60, 0),
    pg_catalog.make_time(w.end_min / 60, w.end_min % 60, 0),
    r.departure_gap_minutes,
    case when r.detour_minutes <= 2 then 'under_3' else '3_to_5' end,
    case when r.role = 'driver' then r.seats_offered end,
    case when r.role = 'driver' then r.seats_open end,
    case when r.role = 'passenger' then r.pax_brings_scooter end,
    case when r.role = 'driver' then r.scooter_fits end,
    r.connected,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('code', x.code, 'label', x.label, 'ok', x.ok)
          order by x.ord),
        '[]'::jsonb)
      from (values
        (1, 'detour',
            case when r.detour_minutes <= 2 then 'Under 3 min detour' else '3–5 min detour' end,
            true, true),
        (2, 'time',
            case
              when abs(r.departure_gap_minutes) <= 5 then 'Same departure window'
              when r.departure_gap_minutes < 0 then 'Leaves ' || abs(r.departure_gap_minutes) || ' min earlier'
              else 'Leaves ' || r.departure_gap_minutes || ' min later'
            end,
            abs(r.departure_gap_minutes) <= 5, true),
        (3, 'days', public.match_days_label(r.shared_weekdays), true, true),
        (4, 'cargo',
            case when r.role = 'driver' then 'Your scooter fits' else 'Brings a foldable scooter' end,
            true, r.pax_brings_scooter),
        (5, 'pref_quiet', 'Both prefer quiet rides', true, 'quiet' = any (r.shared_prefs)),
        (6, 'pref_smoke_free', 'Both prefer smoke-free', true, 'smoke_free' = any (r.shared_prefs)),
        (7, 'connected', 'You''ve ridden together', true, r.connected)
      ) as x(ord, code, label, ok, shown)
      where x.shown
    ),
    r.n
  from ranked r
  join public.commutes t on t.id = r.other_commute_id
  join public.profiles op on op.id = r.other_id
  cross join lateral (
    select
      greatest(0, (extract(epoch from t.departure_time) / 60)::integer - t.departure_flex_minutes) as start_min,
      least(1439, (extract(epoch from t.departure_time) / 60)::integer + t.departure_flex_minutes) as end_min
  ) w
  where r.n <= 50
  order by r.n;
end
$$;

-- Privileges ---------------------------------------------------------------------------
-- The shim (like Supabase) grants execute to anon and authenticated by default.

revoke execute on function public.match_prefilter(
  extensions.geography, extensions.geography, extensions.geography, extensions.geography)
  from public, anon, authenticated;
revoke execute on function public.match_days_label(integer[]) from public, anon, authenticated;
revoke execute on function public.match_candidates(uuid, date) from public, anon, authenticated;
revoke execute on function public.find_matches(date, text) from public, anon;
grant execute on function public.find_matches(date, text) to authenticated;

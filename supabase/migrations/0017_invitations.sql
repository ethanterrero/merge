-- Invitations: send, accept, decline, withdraw, and what each side sees (M-27).
-- Spec: docs/superpowers/specs/2026-10-10-booking-design.md (approved 2026-10-10,
-- Q1-Q12 as recommended; see its "Build notes").
--
-- The table stores what really happened (declined, withdrawn, ...). Clients never
-- read it: my_invitations() projects each viewer's state at read time through
-- invitation_state(row, viewer, as_of). When the side that owes the answer says no
-- (a decline, or a driver withdrawing an invite the passenger accepted), the waiting
-- side keeps seeing the earlier state until held_until, which is always the reply
-- cutoff (D-22, Q8). Every RPC decides from the caller's projection, never the stored
-- status, so no success, error, count or timestamp tells a "no" from "not answered".
-- Booking (confirm, cancel, can't drive, pickup reveal) is M-32's, in *_booking.sql.

-- The hosted table is empty: no client could write it before this migration, and
-- the new not-null columns have no backfill.
do $$
begin
  if exists (select 1 from public.invitations) then
    raise exception '0017 expects no invitations; add a backfill for the new columns first';
  end if;
end
$$;

-- Cutoffs (D-02). The app's copy is apps/mobile/src/lib/dates.ts (M-08):
-- REPLY_CUTOFF_MINUTES and CANCEL_CUTOFF_MINUTES. Keep the two in step. -------------

create function public.reply_cutoff_minutes()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 1200
$$;

create function public.cancel_cutoff_minutes()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 1260
$$;

-- `minutes` after midnight, Los Angeles wall-clock time, on the evening before the
-- ride. Converting the local time handles both daylight-saving changes.
create function public.ride_cutoff(ride_date date, minutes integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((ride_cutoff.ride_date - 1)::timestamp
          + pg_catalog.make_interval(mins => ride_cutoff.minutes))
         at time zone 'America/Los_Angeles'
$$;

-- Drivers reply, and requests for the date close, at 8 PM the evening before.
create function public.reply_cutoff(ride_date date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select public.ride_cutoff(reply_cutoff.ride_date, public.reply_cutoff_minutes())
$$;

-- Columns ---------------------------------------------------------------------------

alter table public.invitations
  drop constraint invitations_status_check,
  add constraint invitations_status_check
    check (status in ('pending','accepted','declined','withdrawn','expired','cancelled','booked')),
  -- request: a passenger asks a driver. invite: a driver invites a passenger.
  add column direction text not null check (direction in ('request','invite')),
  add column kind text not null check (kind in ('first_ride','ride_again','crew')),
  -- The passenger's origin_area when sent (D-16). Nullable only so account deletion
  -- can clear it; required on insert.
  add column pickup_area extensions.geography(point, 4326),
  add column pickup_area_label text,
  add column pickup_time time not null,
  add column seats integer not null default 1,
  add column brings_scooter boolean not null default false,
  add column expires_at timestamptz not null,
  add column accepted_at timestamptz,
  add column closed_at timestamptz,
  add column held_until timestamptz,
  add column waiting_closed_at timestamptz,
  add column cancel_reason text,
  add column updated_at timestamptz not null default now(),
  -- Not an equivalence: crew_id is set null if the Crew is ever deleted (0010).
  add constraint invitations_crew_kind check (crew_id is null or kind = 'crew'),
  add constraint invitations_pickup_whole_minute check (extract(second from pickup_time) = 0),
  add constraint invitations_one_seat check (seats = 1),
  add constraint invitations_cancel_reason_known
    check (cancel_reason in ('block','suspension','booked_elsewhere','full','cant_drive'));

comment on column public.invitations.held_until is
  'Until when the waiting party still sees the state before the other side''s "no" (D-22). Server-only.';
comment on column public.invitations.waiting_closed_at is
  'When the waiting party closed a held row, without changing what the other side sees. Server-only.';

-- Server-filled columns. expires_at and the timestamps are always the server's.
-- send_invitation sets everything else itself; the fallbacks serve server-side and
-- older test inserts that name only the 0001/0003 columns.
create function public.invitations_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.commutes;
begin
  new.expires_at := public.reply_cutoff(new.ride_date);
  new.created_at := now();
  new.updated_at := now();
  new.kind := coalesce(new.kind, case when new.crew_id is not null then 'crew' else 'first_ride' end);
  new.direction := coalesce(new.direction, 'request');
  if new.pickup_time is null or new.pickup_area is null or new.pickup_area_label is null then
    select * into c from public.commutes where id = new.commute_id;
    new.pickup_time := coalesce(new.pickup_time, c.departure_time);
    new.pickup_area := coalesce(new.pickup_area, c.origin_area);
    new.pickup_area_label := coalesce(new.pickup_area_label, c.origin_area_label);
  end if;
  return new;
end
$$;

create function public.invitations_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.invitations_fill_defaults() from public, anon, authenticated;
revoke execute on function public.invitations_set_updated_at() from public, anon, authenticated;

-- Triggers fire in name order: fill, then 0010's require_on_insert, then this one.
create trigger invitations_fill_defaults
  before insert on public.invitations
  for each row execute function public.invitations_fill_defaults();

create trigger invitations_require_pickup_on_insert
  before insert on public.invitations
  for each row execute function public.require_on_insert('pickup_area', 'pickup_area_label');

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.invitations_set_updated_at();

-- sender_id, recipient_id, commute_id and crew_id are indexed by 0010.
create index invitations_sender_ride_date_idx on public.invitations (sender_id, ride_date);
create index invitations_recipient_ride_date_idx on public.invitations (recipient_id, ride_date);

-- RLS and grants (Q3) ----------------------------------------------------------------
-- The policy is defense in depth. Clients have no privilege on the table at all: the
-- raw status and timestamps carry the "no", and RLS can't hide a blocked pair.

create policy "Participants read their invitations"
  on public.invitations for select
  to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

revoke all on public.invitations from public, anon, authenticated;

-- Projection ---------------------------------------------------------------------------
-- States: waiting_for_them, waiting_for_me, accepted_confirm_seat (driver),
-- accepted_waiting_for_driver (passenger), booked, unavailable, closed_by_me.
-- Pure in its arguments, so tests pass a fixed as_of. Null when viewer isn't a party.

create function public.invitation_state(inv public.invitations, viewer uuid, as_of timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  live boolean := inv.status in ('pending','accepted') and as_of < inv.expires_at;
  held boolean := inv.held_until is not null and as_of < inv.held_until and inv.waiting_closed_at is null;
begin
  if viewer is null or as_of is null then
    return null;
  end if;

  if viewer = inv.sender_id then
    if inv.status = 'booked' then return 'booked'; end if;
    if inv.status = 'pending' and live then return 'waiting_for_them'; end if;
    if inv.status = 'declined' and held then return 'waiting_for_them'; end if;       -- D-22
    if inv.status = 'accepted' and live then return 'accepted_confirm_seat'; end if;  -- invites only
    if inv.status = 'withdrawn'
       or (inv.status = 'declined' and inv.waiting_closed_at is not null) then
      return 'closed_by_me';
    end if;
    return 'unavailable';
  elsif viewer = inv.recipient_id then
    if inv.status = 'booked' then return 'booked'; end if;
    if inv.status = 'pending' and live then return 'waiting_for_me'; end if;
    if inv.status = 'accepted' and live then return 'accepted_waiting_for_driver'; end if;
    if inv.status = 'withdrawn' and held then return 'accepted_waiting_for_driver'; end if;  -- Q8
    if inv.status = 'declined'
       or (inv.status = 'withdrawn' and inv.waiting_closed_at is not null) then
      return 'closed_by_me';
    end if;
    return 'unavailable';
  end if;
  return null;
end
$$;

-- The other party exists, is active, and the pair isn't blocked (Q10).
create function public.invitation_counterpart_visible(inv public.invitations, viewer uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(o.other is not null
                  and public.is_active(o.other)
                  and not public.is_blocked(viewer, o.other), false)
  from (select case
                 when viewer = inv.sender_id then inv.recipient_id
                 when viewer = inv.recipient_id then inv.sender_id
               end as other) o
$$;

-- Open for viewer: a live projected state, with the counterpart visible. Rate limits,
-- the per-recipient and pair-date rules and system closes all use this.
create function public.invitation_open_for(inv public.invitations, viewer uuid, as_of timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.invitation_state(inv, viewer, as_of)
      in ('waiting_for_them','waiting_for_me','accepted_confirm_seat','accepted_waiting_for_driver')
    and public.invitation_counterpart_visible(inv, viewer),
    false)
$$;

-- System closes (block, suspension; M-32: booked elsewhere, full, can't drive). A live
-- row is cancelled; a held row ends its hold now, keeping its status, so the waiting
-- party sees "unavailable" exactly when it would for a live row and the acting party
-- still sees closed_by_me. cancel_reason is never returned to a client.
create function public.close_invitations(ids uuid[], reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.invitations i
  set status = 'cancelled',
      cancel_reason = close_invitations.reason,
      closed_at = now()
  where i.id = any (close_invitations.ids)
    and i.status in ('pending','accepted')
    and now() < i.expires_at;

  update public.invitations i
  set held_until = now(),
      cancel_reason = close_invitations.reason
  where i.id = any (close_invitations.ids)
    and i.held_until > now()
    and i.waiting_closed_at is null;
end
$$;

-- The one neutral refusal. Same code, hint and message for every cause.
create function public.invitation_unavailable()
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This ride isn''t available anymore'
    using errcode = '42501', hint = 'unavailable';
end
$$;

revoke execute on function public.reply_cutoff_minutes() from public, anon, authenticated;
revoke execute on function public.cancel_cutoff_minutes() from public, anon, authenticated;
revoke execute on function public.ride_cutoff(date, integer) from public, anon, authenticated;
revoke execute on function public.reply_cutoff(date) from public, anon, authenticated;
revoke execute on function public.invitation_state(public.invitations, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.invitation_counterpart_visible(public.invitations, uuid) from public, anon, authenticated;
revoke execute on function public.invitation_open_for(public.invitations, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.close_invitations(uuid[], text) from public, anon, authenticated;
revoke execute on function public.invitation_unavailable() from public, anon, authenticated;

-- Matching (0015) gains the connected exception and Q5 -------------------------------
-- Copied from *_matching.sql. Two changes, marked M-27:
--   rule 3: with skip_opt_in_if_connected, a connected pair passes without opt-in (Q6);
--   Q5: a pair with a completed ride and no connection doesn't match (no second First
--       Ride without Ride Again), in find_matches too.
-- The two-argument signature stays (matching_test.sql and find_matches use it) and now
-- calls this one with false.

create function public.match_candidates(me uuid, ride_date date, skip_opt_in_if_connected boolean)
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
      case when t.role = 'driver' then m.id else t.id end as pax_commute_id,
      exists (
        select 1 from public.connections cn
        where cn.user_low = least(match_candidates.me, t.owner_id)
          and cn.user_high = greatest(match_candidates.me, t.owner_id)) as is_connected
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
    where (op.discovery_opt_in                                             -- rule 3
           or (match_candidates.skip_opt_in_if_connected and pr.is_connected))  -- M-27, Q6
      and public.is_active(pr.other_id)                                    -- rule 4
      and not public.is_blocked(match_candidates.me, pr.other_id)          -- rule 5
      and (pr.other_role <> 'driver' or public.is_vetted(pr.other_id))     -- rule 6 (Q1)
      and abs(pr.gap) <= pr.flex_sum                                       -- rule 8 (Q5)
      and (not pc.brings_scooter or v.accepts_foldable_scooters)           -- rule 12
      and (pr.is_connected or not exists (                                 -- M-27, Q5
             select 1 from public.rides r
             where r.status = 'completed'
               and ((r.driver_id = match_candidates.me and r.passenger_id = pr.other_id)
                 or (r.driver_id = pr.other_id and r.passenger_id = match_candidates.me))))
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
    s.is_connected,
    -- Q7: the driver, this passenger and the driver's booked passengers make 3 or
    -- more people. A ranking key only; never returned to a client.
    s.booked + 2 >= 3
  from scored s
  join public.profiles op on op.id = s.other_id
  join public.profiles mp on mp.id = match_candidates.me
  where s.detour is not null                                                    -- rule 13
    and s.detour <= least(public.detour_limit_minutes(), s.drv_max_detour)
$$;

create or replace function public.match_candidates(me uuid, ride_date date)
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
  select * from public.match_candidates(match_candidates.me, match_candidates.ride_date, false)
$$;

revoke execute on function public.match_candidates(uuid, date, boolean) from public, anon, authenticated;
revoke execute on function public.match_candidates(uuid, date) from public, anon, authenticated;

-- send_invitation -----------------------------------------------------------------------
-- Checks about the caller first, then the rate limits, and only then anything about
-- the recipient: if a recipient check came first, a sender at their limit could tell
-- a block (unavailable) from everyone else (daily_limit). Spec section 3.

create function public.send_invitation(
  recipient uuid,
  other_role text,
  ride_date date,
  pickup_time time default null,
  brings_scooter boolean default null,
  crew_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'America/Los_Angeles')::date;
  d date := send_invitation.ride_date;
  them uuid := send_invitation.recipient;
  my_role text;
  dow integer;
  mine public.commutes;
  theirs public.commutes;
  pax public.commutes;
  drv public.commutes;
  v_kind text;
  v_scooter boolean;
  v_fits boolean;
  lo uuid;
  hi uuid;
  n integer;
  win_start integer;
  win_end integer;
  t integer;
  new_id uuid;
begin
  -- 1-2. Caller and arguments.
  if me is null then
    raise exception 'Sign in to send a request' using errcode = '42501', hint = 'not_signed_in';
  end if;
  if them is null or send_invitation.other_role is null or d is null
     or them = me
     or send_invitation.other_role not in ('driver','passenger')
     or extract(second from send_invitation.pickup_time) <> 0 then
    raise exception 'Check the request and try again' using errcode = '22023', hint = 'invalid_input';
  end if;

  -- 3. A suspended or profile-less caller: nothing special (member-status decision 3).
  if not public.is_active(me) then
    perform public.invitation_unavailable();
  end if;

  -- 4-5. The date.
  if now() >= public.reply_cutoff(d) then
    raise exception 'Requests for that date are closed' using errcode = 'P0001', hint = 'past_cutoff';
  end if;
  if d > today + 14 then
    raise exception 'That date is too far ahead' using errcode = 'P0001', hint = 'too_far_ahead';
  end if;

  -- 6-10. The caller's own commute, vetting, car and date.
  my_role := case when send_invitation.other_role = 'driver' then 'passenger' else 'driver' end;
  dow := extract(isodow from d)::integer;
  select c.* into mine
  from public.commutes c
  where c.owner_id = me and c.role = my_role and dow = any (c.weekdays);
  if not found then
    raise exception 'You have no commute that day' using errcode = 'P0001', hint = 'no_commute_that_day';
  end if;

  if my_role = 'driver' then
    if not public.is_vetted(me) then
      raise exception 'Only vetted drivers can offer rides' using errcode = 'P0001', hint = 'not_vetted';
    end if;
    if mine.vehicle_id is null then
      raise exception 'Add your car first' using errcode = 'P0001', hint = 'no_vehicle';
    end if;
  end if;

  -- Q1: a passenger holds one ride a date; nobody rides in both roles on one date.
  if exists (
    select 1 from public.rides r
    where r.ride_date = d
      and r.status in ('confirmed','completed')
      and (r.passenger_id = me or (my_role = 'passenger' and r.driver_id = me))
  ) then
    raise exception 'You already have a ride that day' using errcode = 'P0001', hint = 'already_booked';
  end if;

  if my_role = 'driver' then
    select least(mine.seats_offered, v.passenger_seats)
           - (select count(*)::integer from public.rides r
              where r.driver_id = me and r.ride_date = d and r.status in ('confirmed','completed'))
    into n
    from public.vehicles v
    where v.id = mine.vehicle_id;
    if coalesce(n, 0) <= 0 then
      raise exception 'Your seats for that day are full' using errcode = 'P0001', hint = 'car_full';
    end if;
  end if;

  -- 11. Serialize with a suspension (profiles for share, id order) and with the
  -- caller's other sends (the counts below).
  perform 1 from public.profiles p where p.id in (me, them) order by p.id for share;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merge.sender:' || me::text, 0));

  -- 12-13. Rate limits (D-02), from the caller's own view.
  select count(*) into n
  from public.invitations i
  where i.sender_id = me
    and (i.created_at at time zone 'America/Los_Angeles')::date = today;
  if n >= 10 then
    raise exception 'Daily request limit reached' using errcode = 'P0001', hint = 'daily_limit';
  end if;

  select count(*) into n
  from public.invitations i
  where i.sender_id = me
    and public.invitation_open_for(i, me, now());
  if n >= 5 then
    raise exception 'Too many requests waiting' using errcode = 'P0001', hint = 'pending_limit';
  end if;

  -- 14. The pair lock blocks_end_pair (0005) and blocks_close_invitations take.
  lo := least(me, them);
  hi := greatest(me, them);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merge.pair:' || lo::text || ':' || hi::text, 0));

  -- Kind (Q12): crew with a crew_id, ride_again when connected, else first_ride.
  if send_invitation.crew_id is not null then
    v_kind := 'crew';
  elsif exists (select 1 from public.connections cn where cn.user_low = lo and cn.user_high = hi) then
    v_kind := 'ride_again';
  else
    v_kind := 'first_ride';
  end if;

  -- 15. One open invitation per recipient (Q4): any date for a First Ride, per date
  -- for Ride Again and Crew.
  if exists (
    select 1 from public.invitations i
    where i.sender_id = me and i.recipient_id = them
      and (v_kind = 'first_ride' or i.ride_date = d)
      and public.invitation_open_for(i, me, now())
  ) then
    raise exception 'You already have a request with this person' using errcode = 'P0001', hint = 'already_requested';
  end if;

  -- 16. One open invitation per pair and date, either direction, in either party's view.
  if exists (
    select 1 from public.invitations i
    where ((i.sender_id = me and i.recipient_id = them) or (i.sender_id = them and i.recipient_id = me))
      and i.ride_date = d
      and (public.invitation_open_for(i, me, now()) or public.invitation_open_for(i, them, now()))
  ) then
    raise exception 'You already have a request with this person' using errcode = 'P0001', hint = 'already_requested';
  end if;

  -- 17. A Crew ride needs this pair's active Crew on that weekday.
  if v_kind = 'crew' and not exists (
    select 1 from public.commute_crews cc
    where cc.id = send_invitation.crew_id
      and cc.user_low = lo and cc.user_high = hi
      and cc.status = 'active'
      and dow = any (cc.weekdays)
  ) then
    perform public.invitation_unavailable();
  end if;

  -- 18. Eligibility: the same rules as discovery, rechecked now (M-16's gate).
  if not public.is_active(them) or public.is_blocked(me, them) then
    perform public.invitation_unavailable();
  end if;
  select c.* into theirs
  from public.match_candidates(me, d, v_kind in ('ride_again','crew')) mc
  join public.commutes c on c.id = mc.other_commute_id
  where mc.other_id = them and mc.role = send_invitation.other_role and mc.my_commute_id = mine.id;
  if not found then
    perform public.invitation_unavailable();
  end if;

  if my_role = 'passenger' then
    pax := mine;
    drv := theirs;
  else
    pax := theirs;
    drv := mine;
  end if;

  -- 19. Pickup time inside both windows; the default clamps the passenger's departure.
  win_start := greatest(
    (extract(epoch from pax.departure_time) / 60)::integer - pax.departure_flex_minutes,
    (extract(epoch from drv.departure_time) / 60)::integer - drv.departure_flex_minutes,
    0);
  win_end := least(
    (extract(epoch from pax.departure_time) / 60)::integer + pax.departure_flex_minutes,
    (extract(epoch from drv.departure_time) / 60)::integer + drv.departure_flex_minutes,
    1439);
  if send_invitation.pickup_time is null then
    t := least(greatest((extract(epoch from pax.departure_time) / 60)::integer, win_start), win_end);
  else
    t := (extract(epoch from send_invitation.pickup_time) / 60)::integer;
  end if;
  if t < win_start or t > win_end then
    raise exception 'Pick a time inside both windows' using errcode = 'P0001', hint = 'time_outside_window';
  end if;

  -- 20. Cargo (D-04).
  v_scooter := coalesce(send_invitation.brings_scooter, pax.brings_scooter);
  if v_scooter then
    select v.accepts_foldable_scooters into v_fits from public.vehicles v where v.id = drv.vehicle_id;
    if not coalesce(v_fits, false) then
      raise exception 'The trunk doesn''t fit a scooter' using errcode = 'P0001', hint = 'scooter_doesnt_fit';
    end if;
  end if;

  insert into public.invitations (
    sender_id, recipient_id, commute_id, ride_date, direction, kind, crew_id,
    pickup_area, pickup_area_label, pickup_time, seats, brings_scooter
  ) values (
    me, them, mine.id, d,
    case when my_role = 'passenger' then 'request' else 'invite' end,
    v_kind,
    case when v_kind = 'crew' then send_invitation.crew_id end,
    pax.origin_area, pax.origin_area_label,
    pg_catalog.make_time(t / 60, t % 60, 0),
    1, v_scooter
  )
  returning id into new_id;

  return new_id;
end
$$;

-- Answering and withdrawing ------------------------------------------------------------
-- Common steps: the row, the caller a party, both parties present and the caller
-- active; then locks in the same order as send (profiles for share, pair lock, row);
-- then the counterpart visible. Anything else is the neutral refusal.

create function public.invitation_for_action(invitation_id uuid, me uuid)
returns public.invitations
language plpgsql
set search_path = ''
as $$
declare
  inv public.invitations;
  other uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;

  select i.* into inv from public.invitations i where i.id = invitation_for_action.invitation_id;
  if not found or inv.sender_id is null or inv.recipient_id is null
     or me not in (inv.sender_id, inv.recipient_id)
     or not public.is_active(me) then
    perform public.invitation_unavailable();
  end if;
  other := case when me = inv.sender_id then inv.recipient_id else inv.sender_id end;

  perform 1 from public.profiles p where p.id in (me, other) order by p.id for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'merge.pair:' || least(me, other)::text || ':' || greatest(me, other)::text, 0));
  select i.* into inv from public.invitations i where i.id = invitation_for_action.invitation_id for update;

  if not public.is_active(me) or not public.invitation_counterpart_visible(inv, me) then
    perform public.invitation_unavailable();
  end if;
  return inv;
end
$$;

revoke execute on function public.invitation_for_action(uuid, uuid) from public, anon, authenticated;

-- The passenger accepts a driver's invite. It doesn't book: the driver confirms (M-32).
create function public.accept_invitation(invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  inv public.invitations := public.invitation_for_action(accept_invitation.invitation_id, me);
  st text := public.invitation_state(inv, me, now());
begin
  if st = 'waiting_for_me' and inv.direction = 'request' then
    raise exception 'Drivers confirm requests instead' using errcode = 'P0001', hint = 'driver_confirms';
  end if;
  if st is distinct from 'waiting_for_me' or inv.direction <> 'invite' then
    perform public.invitation_unavailable();
  end if;
  if not public.is_vetted(inv.sender_id) then
    perform public.invitation_unavailable();
  end if;
  if exists (
    select 1 from public.rides r
    where r.ride_date = inv.ride_date
      and r.status in ('confirmed','completed')
      and me in (r.driver_id, r.passenger_id)
  ) then
    raise exception 'You already have a ride that day' using errcode = 'P0001', hint = 'already_booked';
  end if;

  update public.invitations
  set status = 'accepted',
      accepted_at = now()
  where id = inv.id;
end
$$;

-- The recipient says no: to a pending invitation (held for the sender until the
-- cutoff, D-22), or the passenger un-accepting (Q9, shown at once). On a row the
-- driver already withdrew (held), it only closes it for the passenger.
create function public.decline_invitation(invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  inv public.invitations := public.invitation_for_action(decline_invitation.invitation_id, me);
  st text := public.invitation_state(inv, me, now());
begin
  if st = 'waiting_for_me' then
    update public.invitations
    set status = 'declined', closed_at = now(), held_until = inv.expires_at
    where id = inv.id;
  elsif st = 'accepted_waiting_for_driver' and inv.status = 'accepted' then
    update public.invitations
    set status = 'declined', closed_at = now()
    where id = inv.id;
  elsif st = 'accepted_waiting_for_driver' then
    update public.invitations
    set waiting_closed_at = now()
    where id = inv.id;
  else
    perform public.invitation_unavailable();
  end if;
end
$$;

-- The sender takes it back: a pending invitation (the recipient sees it at once), a
-- request the driver secretly declined (only closes it for the sender), or the
-- driver's invite the passenger accepted (held for the passenger, Q8).
create function public.withdraw_invitation(invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  inv public.invitations := public.invitation_for_action(withdraw_invitation.invitation_id, me);
  st text := public.invitation_state(inv, me, now());
begin
  if st = 'waiting_for_them' and inv.status = 'pending' then
    update public.invitations
    set status = 'withdrawn', closed_at = now()
    where id = inv.id;
  elsif st = 'waiting_for_them' then
    update public.invitations
    set waiting_closed_at = now()
    where id = inv.id;
  elsif st = 'accepted_confirm_seat' then
    update public.invitations
    set status = 'withdrawn', closed_at = now(), held_until = inv.expires_at
    where id = inv.id;
  else
    perform public.invitation_unavailable();
  end if;
end
$$;

-- my_invitations ---------------------------------------------------------------------------
-- The only read path. Upcoming dates only; rows whose counterpart isn't visible are
-- left out (Q10); nothing that changes on a "no" (status, timestamps, reasons) is
-- returned or used for ordering.

create function public.my_invitations()
returns table (
  id uuid,
  ride_date date,
  kind text,
  direction text,
  my_role text,
  other_id uuid,
  state text,
  reply_by timestamptz,
  pickup_area_lat double precision,
  pickup_area_lng double precision,
  pickup_area_label text,
  area_radius_m integer,
  pickup_time time,
  seats integer,
  brings_scooter boolean,
  crew_id uuid,
  ride_id uuid,
  created_at timestamptz
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
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;
  if not public.is_active(me) then
    return;
  end if;

  return query
  select
    i.id,
    i.ride_date,
    i.kind,
    i.direction,
    case when (i.direction = 'request') = (i.sender_id = me) then 'passenger' else 'driver' end,
    case when i.sender_id = me then i.recipient_id else i.sender_id end,
    s.st,
    i.expires_at,
    extensions.st_y(i.pickup_area::extensions.geometry),
    extensions.st_x(i.pickup_area::extensions.geometry),
    i.pickup_area_label,
    public.area_radius_m()::integer,
    i.pickup_time,
    i.seats,
    i.brings_scooter,
    i.crew_id,
    case when s.st = 'booked' then (select r.id from public.rides r where r.invitation_id = i.id) end,
    i.created_at
  from public.invitations i
  cross join lateral (select public.invitation_state(i, me, now()) as st) s
  where me in (i.sender_id, i.recipient_id)
    and i.ride_date >= today
    and public.invitation_counterpart_visible(i, me)
  order by i.ride_date, i.created_at, i.id;
end
$$;

revoke execute on function public.send_invitation(uuid, text, date, time, boolean, uuid) from public, anon;
revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.decline_invitation(uuid) from public, anon;
revoke execute on function public.withdraw_invitation(uuid) from public, anon;
revoke execute on function public.my_invitations() from public, anon;
grant execute on function public.send_invitation(uuid, text, date, time, boolean, uuid) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.decline_invitation(uuid) to authenticated;
grant execute on function public.withdraw_invitation(uuid) to authenticated;
grant execute on function public.my_invitations() to authenticated;

-- A block closes everything between the pair, both ways --------------------------------
-- Its own trigger; 0005's blocks_end_pair is untouched. Takes the same pair lock, so a
-- send and a block on the pair serialize.

create function public.blocks_close_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lo uuid := least(new.blocker_id, new.blocked_id);
  hi uuid := greatest(new.blocker_id, new.blocked_id);
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merge.pair:' || lo::text || ':' || hi::text, 0));

  perform public.close_invitations(
    array(select i.id from public.invitations i
          where (i.sender_id = new.blocker_id and i.recipient_id = new.blocked_id)
             or (i.sender_id = new.blocked_id and i.recipient_id = new.blocker_id)),
    'block');
  return null;
end
$$;

revoke execute on function public.blocks_close_invitations() from public, anon, authenticated;

create trigger blocks_close_invitations
  after insert on public.blocks
  for each row execute function public.blocks_close_invitations();

-- Suspension (0011) ------------------------------------------------------------------------
-- Copied from *_member_status.sql. The invitation step now records the reason, and
-- also closes accepted driver invites and held rows (an accepted passenger request
-- can't exist in this model; older rows of that shape are left as they were, and are
-- hidden anyway because the counterpart is inactive). Connections, Crews and rides are
-- unchanged; M-32 replaces this again for the rides' safety reason.

create or replace function public.withdraw_member(uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if uid is null then
    return;
  end if;

  perform 1 from public.profiles p where p.id = uid for no key update;

  update public.invitations
  set status = 'cancelled',
      cancel_reason = 'suspension',
      closed_at = now()
  where status = 'pending'
    and uid in (sender_id, recipient_id);

  perform public.close_invitations(
    array(select i.id from public.invitations i
          where uid in (i.sender_id, i.recipient_id)
            and ((i.status = 'accepted' and i.direction = 'invite') or i.held_until > now())),
    'suspension');

  delete from public.connections
  where uid in (user_low, user_high);

  update public.commute_crews
  set status = 'ended',
      ended_at = now()
  where uid in (user_low, user_high)
    and status in ('proposed','active','paused');

  -- Ride dates are calendar days in the pilot's zone. Today's ride is cancelled
  -- even if its pickup time has passed; older confirmed rides await completion.
  update public.rides
  set status = 'cancelled'
  where status = 'confirmed'
    and uid in (driver_id, passenger_id)
    and ride_date >= (now() at time zone 'America/Los_Angeles')::date;
end
$$;

revoke execute on function public.withdraw_member(uuid) from public, anon, authenticated;

-- Account deletion (0010) ------------------------------------------------------------------
-- Copied from *_account_deletion.sql, plus one step: on invitations kept because a
-- ride stands behind them, clear the deleted passenger's copied pickup area (it is
-- derived from their home, and D-15 deletes what they own).

create or replace function public.profiles_apply_deletion_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := old.id;
begin
  -- Rides whose other rider is already gone: nobody left to keep them for. Their
  -- feedback cascades; safety reports keep the report and clear ride_id.
  delete from public.rides r
  where (r.driver_id = me and r.passenger_id is null)
     or (r.passenger_id = me and r.driver_id is null);

  -- A confirmed ride whose pickup hasn't come can't happen now. Past confirmed rides
  -- are left for ride completion (D-01) to settle.
  update public.rides r
  set status = 'cancelled'
  where me in (r.driver_id, r.passenger_id)
    and r.status = 'confirmed'
    and r.ride_date + r.pickup_time > (now() at time zone 'America/Los_Angeles');

  -- M-27: the deleted passenger's area on invitations kept for their ride.
  update public.invitations i
  set pickup_area = null,
      pickup_area_label = null
  from public.rides r
  where r.invitation_id = i.id
    and r.passenger_id = me;

  -- Invitations that led to no ride, either direction and any status.
  delete from public.invitations i
  where me in (i.sender_id, i.recipient_id)
    and not exists (select 1 from public.rides r where r.invitation_id = i.id);

  -- Crews whose other member is already gone; then open Crews end, as after a "no".
  delete from public.commute_crews cc
  where (cc.user_low = me and cc.user_high is null)
     or (cc.user_high = me and cc.user_low is null);

  update public.commute_crews cc
  set status = 'ended',
      ended_at = now()
  where me in (cc.user_low, cc.user_high)
    and cc.status in ('proposed','active','paused');

  return old;
end
$$;

revoke execute on function public.profiles_apply_deletion_policy() from public, anon, authenticated;

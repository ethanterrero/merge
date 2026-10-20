-- Booking: confirm, the pickup reveal, cancel, can't drive, and safety cancellations (M-32).
-- Spec: docs/superpowers/specs/2026-10-10-booking-design.md, section 9 (with sections 2,
-- 6 and 7, and the M-27 "Build notes"). Plan: docs/superpowers/plans/2026-10-20-m-32-booking.md.
--
-- The driver books with confirm_ride, which decides from the driver's projection of the
-- invitation (0017's invitation_state), never its stored status. The exact pickup spot,
-- the driver's note and the vehicle (with its plate) live in ride_pickups, which no
-- client can read; ride_pickup() reveals them to the two participants of a confirmed
-- ride while both are active and not blocked. Clients read rides through column grants
-- that leave out every cancel column, so the other participant sees "Ride cancelled",
-- never why, when or by whom.
--
-- Locking. Every path that changes a person's rides on a date takes that person's day
-- lock (day_lock). confirm_ride takes, in this order: both profiles for share (id
-- order), the pair lock, both day locks (uuid order), then the invitation row for
-- update. cancel_ride takes both day locks before the ride row; cant_drive takes the
-- driver's day lock before any ride or invitation row. Day locks always come before
-- invitation row locks, so a confirm and a "can't drive" never wait on each other's
-- rows while holding a day lock the other needs.
-- The rows a confirm or a "can't drive" closes are other people's, which no day lock
-- covers (two confirms for different drivers can each close a row of the other's
-- set). So both lock every row they will close in one statement, in id order, before
-- closing any; overlapping sets are then always taken in the same order. A confirm's
-- own invitation row, locked earlier, is never in another confirm's set unless the two
-- share a person, and then they already queue on that person's day lock. The block and
-- suspension closes (0017's blocks_close_invitations and withdraw_member) keep their
-- unsorted single-call pattern.

-- Rides: seats, cargo and why a ride was cancelled ----------------------------------------
-- Existing rows and the older test inserts that name only 0003's columns get the
-- defaults (one seat, no scooter) and null cancel columns.

alter table public.rides
  add column seats integer not null default 1 check (seats >= 1),
  add column brings_scooter boolean not null default false,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id) on delete set null,
  add column cancel_reason text
    check (cancel_reason in ('participant','cant_drive','safety','account_deleted')),
  add column cancelled_late boolean;

comment on column public.rides.cancel_reason is
  'Why the ride was cancelled. Server-only: no client has select on it, or on cancelled_at, cancelled_by, cancelled_late.';

create index rides_cancelled_by_idx on public.rides (cancelled_by);
create index rides_driver_ride_date_idx on public.rides (driver_id, ride_date);

-- Q1's backstop: a passenger holds at most one confirmed or completed ride a date.
create unique index rides_one_per_passenger_date
  on public.rides (passenger_id, ride_date)
  where status in ('confirmed','completed');

-- The "Read own rides" policy (0003) stays. The ride_feedback and safety_reports
-- policies (0003, 0005) read only id, status, driver_id and passenger_id.
revoke select on public.rides from public, anon, authenticated;
grant select (id, invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind,
              created_at, completed_at, seats, brings_scooter)
  on public.rides to authenticated;

-- Pickup details (D-16) -------------------------------------------------------------------
-- Written by confirm_ride, read only through ride_pickup(). The spot is near the
-- passenger's home and the plate is the driver's: account deletion removes the row
-- for every ride the deleted person was in.

create table public.ride_pickups (
  ride_id uuid primary key references public.rides(id) on delete cascade,
  spot extensions.geography(point, 4326) not null,
  note text check (char_length(note) <= 280),
  -- The vehicle as it was at confirm.
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  vehicle_plate text,
  created_at timestamptz not null default now()
);

alter table public.ride_pickups enable row level security;

revoke all on public.ride_pickups from public, anon, authenticated;

-- Days off (Q11) -----------------------------------------------------------------------------
-- Recorded by cant_drive. A driver on a day off isn't matched, and can't be asked, as a
-- driver that date. The primary key serves the driver_id foreign key.

create table public.driver_days_off (
  driver_id uuid not null references public.profiles(id) on delete cascade,
  ride_date date not null,
  created_at timestamptz not null default now(),
  primary key (driver_id, ride_date)
);

alter table public.driver_days_off enable row level security;

create policy "Drivers read their days off"
  on public.driver_days_off for select
  to authenticated
  using (driver_id = (select auth.uid()));

revoke all on public.driver_days_off from public, anon, authenticated;
grant select on public.driver_days_off to authenticated;

-- Day lock -------------------------------------------------------------------------------------
-- A person's rides on a date. Internal: only definer RPCs call it.

create function public.day_lock(uid uuid, ride_date date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if day_lock.uid is null or day_lock.ride_date is null then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'merge.day:' || day_lock.uid::text || ':' || day_lock.ride_date::text, 0));
end
$$;

revoke execute on function public.day_lock(uuid, date) from public, anon, authenticated;

-- confirm_ride -----------------------------------------------------------------------------------
-- The driver books a passenger's request (driver projection waiting_for_me) or an
-- invite the passenger accepted (accepted_confirm_seat). Spec section 9, steps 1-10.
-- Everything about the invitation or the passenger is the neutral refusal; the hinted
-- refusals are about the driver's own situation (vetting, car, seats, trunk, spot).

create function public.confirm_ride(
  invitation_id uuid,
  spot_lat double precision,
  spot_lng double precision,
  note text,
  scooter_ok boolean default false
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
  v_note text := nullif(pg_catalog.btrim(confirm_ride.note), '');
  inv public.invitations;
  pax uuid;
  d date;
  st text;
  drv public.commutes;
  veh public.vehicles;
  booked integer;
  seats_left integer;
  v_spot extensions.geography;
  new_id uuid;
  elsewhere_ids uuid[];
  full_ids uuid[];
begin
  -- 1. Caller and arguments.
  if me is null then
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;
  if confirm_ride.invitation_id is null
     or confirm_ride.spot_lat is null or confirm_ride.spot_lng is null
     or not (confirm_ride.spot_lat between -90 and 90)
     or not (confirm_ride.spot_lng between -180 and 180) then
    raise exception 'Check the ride details and try again' using errcode = '22023', hint = 'invalid_input';
  end if;
  if char_length(v_note) > 280 then
    raise exception 'Keep the note to 280 characters' using errcode = '22023', hint = 'note_too_long';
  end if;

  -- 2. The row: the caller must be its driver (the recipient of a request, the sender
  -- of an invite) and active.
  select i.* into inv from public.invitations i where i.id = confirm_ride.invitation_id;
  if not found or inv.sender_id is null or inv.recipient_id is null
     or me is distinct from (case when inv.direction = 'request' then inv.recipient_id
                                  when inv.direction = 'invite' then inv.sender_id end)
     or not public.is_active(me) then
    perform public.invitation_unavailable();
  end if;
  pax := case when me = inv.sender_id then inv.recipient_id else inv.sender_id end;
  d := inv.ride_date;

  -- 3. Locks: profiles for share (id order), the pair lock (as 0017's send and
  -- invitation_for_action), both day locks (uuid order), then the row; then decide
  -- again from what is now committed.
  perform 1 from public.profiles p where p.id in (me, pax) order by p.id for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'merge.pair:' || least(me, pax)::text || ':' || greatest(me, pax)::text, 0));
  perform public.day_lock(least(me, pax), d);
  perform public.day_lock(greatest(me, pax), d);
  select i.* into inv from public.invitations i where i.id = confirm_ride.invitation_id for update;
  if not found then
    perform public.invitation_unavailable();
  end if;

  st := public.invitation_state(inv, me, now());
  if not public.is_active(me)
     or not public.invitation_counterpart_visible(inv, me)
     or not coalesce((inv.direction = 'request' and st = 'waiting_for_me')
                     or (inv.direction = 'invite' and st = 'accepted_confirm_seat'), false) then
    perform public.invitation_unavailable();
  end if;

  if not public.is_vetted(me) then
    raise exception 'Only vetted drivers can offer rides' using errcode = 'P0001', hint = 'not_vetted';
  end if;

  -- 4. Q1: the passenger booked elsewhere (a race: neutral), or the driver is a
  -- passenger that date (their own situation).
  if exists (
    select 1 from public.rides r
    where r.ride_date = d
      and r.status in ('confirmed','completed')
      and pax in (r.driver_id, r.passenger_id)
  ) then
    perform public.invitation_unavailable();
  end if;
  if exists (
    select 1 from public.rides r
    where r.ride_date = d
      and r.status in ('confirmed','completed')
      and r.passenger_id = me
  ) then
    raise exception 'You already have a ride that day' using errcode = 'P0001', hint = 'already_booked';
  end if;

  -- 5. Capacity, from the driver's current driver commute and vehicle.
  select c.* into drv from public.commutes c where c.owner_id = me and c.role = 'driver';
  select v.* into veh from public.vehicles v where v.id = drv.vehicle_id;
  if not found then
    raise exception 'Add your car first' using errcode = 'P0001', hint = 'no_vehicle';
  end if;

  select coalesce(sum(r.seats), 0)::integer into booked
  from public.rides r
  where r.driver_id = me
    and r.ride_date = d
    and r.status in ('confirmed','completed');
  seats_left := coalesce(least(drv.seats_offered, veh.passenger_seats), 0) - booked;
  if seats_left < inv.seats then
    raise exception 'Your seats for that day are full' using errcode = 'P0001', hint = 'car_full';
  end if;

  -- 6. Cargo (D-04): one scooter a car, and the driver approves each one.
  if inv.brings_scooter then
    if not veh.accepts_foldable_scooters or exists (
      select 1 from public.rides r
      where r.driver_id = me
        and r.ride_date = d
        and r.status in ('confirmed','completed')
        and r.brings_scooter
    ) then
      raise exception 'There''s no room for a scooter' using errcode = 'P0001', hint = 'no_cargo_room';
    end if;
    if not coalesce(confirm_ride.scooter_ok, false) then
      raise exception 'Approve the scooter to confirm' using errcode = 'P0001', hint = 'cargo_not_approved';
    end if;
  end if;

  -- 7. The spot (D-16): inside the area copied onto the invitation.
  v_spot := extensions.st_setsrid(
              extensions.st_makepoint(confirm_ride.spot_lng, confirm_ride.spot_lat), 4326
            )::extensions.geography;
  if not coalesce(public.within_area(inv.pickup_area, v_spot), false) then
    raise exception 'Pick a spot inside the pickup area' using errcode = 'P0001', hint = 'spot_outside_area';
  end if;

  -- 8. Book.
  insert into public.rides (
    invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind, seats, brings_scooter
  ) values (
    inv.id, me, pax, d, inv.pickup_time, 'confirmed', inv.kind, inv.seats, inv.brings_scooter
  )
  returning id into new_id;

  insert into public.ride_pickups (
    ride_id, spot, note, vehicle_make, vehicle_model, vehicle_color, vehicle_plate
  ) values (
    new_id, v_spot, v_note, veh.make, veh.model, veh.color, veh.plate
  );

  update public.invitations
  set status = 'booked',
      closed_at = now()
  where id = inv.id;

  -- 9. System closes for that date (section 2): what the booking makes impossible.
  -- The passenger's other invitations in either role, and the driver's as a passenger.
  elsewhere_ids := array(
    select i.id from public.invitations i
    where i.ride_date = d
      and i.id <> inv.id
      and (pax in (i.sender_id, i.recipient_id)
           or (i.direction = 'request' and i.sender_id = me)
           or (i.direction = 'invite' and i.recipient_id = me)));

  -- The driver's leftover driver-side invitations: all of them once the seats are
  -- gone, else the scooter ones once the scooter slot is taken.
  full_ids := array(
    select i.id from public.invitations i
    where i.ride_date = d
      and i.id <> inv.id
      and (seats_left - inv.seats <= 0 or (inv.brings_scooter and i.brings_scooter))
      and ((i.direction = 'request' and i.recipient_id = me)
           or (i.direction = 'invite' and i.sender_id = me)));

  -- Other people's rows, so lock them all at once in id order: two confirms for
  -- different drivers can close each other's rows, and closing them one call at a time
  -- would lock them in an order that depends on the call.
  perform 1 from public.invitations i
  where i.id = any (elsewhere_ids || full_ids)
  order by i.id
  for update;

  perform public.close_invitations(elsewhere_ids, 'booked_elsewhere');
  perform public.close_invitations(full_ids, 'full');

  -- 10.
  return new_id;
end
$$;

-- ride_pickup ----------------------------------------------------------------------------------
-- The exact spot, the note and the vehicle, for the two participants of a confirmed
-- ride while both are active and the pair isn't blocked. Anything else (a requester, a
-- third party, a cancelled ride, a block, a suspension, an unknown id): no row, no error.

create function public.ride_pickup(ride_id uuid)
returns table (
  spot_lat double precision,
  spot_lng double precision,
  note text,
  vehicle_make text,
  vehicle_model text,
  vehicle_color text,
  vehicle_plate text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;

  return query
  select
    extensions.st_y(p.spot::extensions.geometry),
    extensions.st_x(p.spot::extensions.geometry),
    p.note,
    p.vehicle_make,
    p.vehicle_model,
    p.vehicle_color,
    p.vehicle_plate
  from public.rides r
  join public.ride_pickups p on p.ride_id = r.id
  where r.id = ride_pickup.ride_id
    and r.status = 'confirmed'
    and me in (r.driver_id, r.passenger_id)
    and public.is_active(r.driver_id)
    and public.is_active(r.passenger_id)
    and not public.is_blocked(r.driver_id, r.passenger_id);
end
$$;

-- driver_day -----------------------------------------------------------------------------------
-- The caller's real seats for a date as a driver (M-36's "seats open"), from their
-- driver commute and its vehicle: 0 seats with no car.

create function public.driver_day(ride_date date)
returns table (
  seats_total integer,
  seats_booked integer,
  scooter_booked boolean,
  day_off boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  d date := driver_day.ride_date;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;
  if d is null then
    raise exception 'Check the date and try again' using errcode = '22023', hint = 'invalid_input';
  end if;
  if not public.is_active(me) then
    return;
  end if;

  return query
  select
    case when v.id is null then 0
         else coalesce(least(c.seats_offered, v.passenger_seats), 0) end::integer,
    (select coalesce(sum(r.seats), 0)::integer
       from public.rides r
      where r.driver_id = me
        and r.ride_date = d
        and r.status in ('confirmed','completed')),
    exists (
      select 1 from public.rides r
      where r.driver_id = me
        and r.ride_date = d
        and r.status in ('confirmed','completed')
        and r.brings_scooter),
    exists (
      select 1 from public.driver_days_off o
      where o.driver_id = me
        and o.ride_date = d)
  from (values (1)) as base(x)
  left join public.commutes c on c.owner_id = me and c.role = 'driver'
  left join public.vehicles v on v.id = c.vehicle_id;
end
$$;

-- cancel_ride ----------------------------------------------------------------------------------
-- Either participant, while confirmed and dated today or later (LA). Late cancels (from
-- 9 PM the evening before) are allowed with no penalty and only recorded (D-02).
-- Invitations closed by the booking stay closed.

create function public.cancel_ride(ride_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'America/Los_Angeles')::date;
  this_ride public.rides;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;
  if cancel_ride.ride_id is null then
    raise exception 'Check the ride and try again' using errcode = '22023', hint = 'invalid_input';
  end if;

  select x.* into this_ride from public.rides x where x.id = cancel_ride.ride_id;
  if not found
     or not coalesce(me in (this_ride.driver_id, this_ride.passenger_id), false)
     or not public.is_active(me) then
    perform public.invitation_unavailable();
  end if;

  perform public.day_lock(least(this_ride.driver_id, this_ride.passenger_id), this_ride.ride_date);
  perform public.day_lock(greatest(this_ride.driver_id, this_ride.passenger_id), this_ride.ride_date);
  select x.* into this_ride from public.rides x where x.id = cancel_ride.ride_id for update;
  if not found or this_ride.status <> 'confirmed' or this_ride.ride_date < today then
    perform public.invitation_unavailable();
  end if;

  update public.rides
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = me,
      cancel_reason = 'participant',
      cancelled_late = now() >= public.ride_cutoff(this_ride.ride_date, public.cancel_cutoff_minutes())
  where id = this_ride.id;
end
$$;

-- cant_drive -----------------------------------------------------------------------------------
-- The caller can't drive on a date: record the day off (Q11), cancel their confirmed
-- rides as driver that date, and close their open driver-side invitations. Calling it
-- again is harmless.

create function public.cant_drive(ride_date date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'America/Los_Angeles')::date;
  d date := cant_drive.ride_date;
  close_ids uuid[];
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501', hint = 'not_signed_in';
  end if;
  if d is null or d < today then
    raise exception 'Check the date and try again' using errcode = '22023', hint = 'invalid_input';
  end if;
  if not public.is_active(me) then
    perform public.invitation_unavailable();
  end if;

  perform public.day_lock(me, d);

  insert into public.driver_days_off (driver_id, ride_date)
  values (me, d)
  on conflict on constraint driver_days_off_pkey do nothing;

  update public.rides r
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = me,
      cancel_reason = 'cant_drive',
      cancelled_late = now() >= public.ride_cutoff(r.ride_date, public.cancel_cutoff_minutes())
  where r.driver_id = me
    and r.ride_date = d
    and r.status = 'confirmed';

  close_ids := array(
    select i.id from public.invitations i
    where i.ride_date = d
      and ((i.direction = 'request' and i.recipient_id = me)
           or (i.direction = 'invite' and i.sender_id = me)));

  -- In id order, as confirm_ride locks the rows it closes.
  perform 1 from public.invitations i
  where i.id = any (close_ids)
  order by i.id
  for update;

  perform public.close_invitations(close_ids, 'cant_drive');
end
$$;

revoke execute on function public.confirm_ride(uuid, double precision, double precision, text, boolean) from public, anon;
revoke execute on function public.ride_pickup(uuid) from public, anon;
revoke execute on function public.driver_day(date) from public, anon;
revoke execute on function public.cancel_ride(uuid) from public, anon;
revoke execute on function public.cant_drive(date) from public, anon;
grant execute on function public.confirm_ride(uuid, double precision, double precision, text, boolean) to authenticated;
grant execute on function public.ride_pickup(uuid) to authenticated;
grant execute on function public.driver_day(date) to authenticated;
grant execute on function public.cancel_ride(uuid) to authenticated;
grant execute on function public.cant_drive(date) to authenticated;

-- Matching gains Q11 ------------------------------------------------------------------------------
-- Copied from *_invitations.sql. One change, marked M-32: a driver on a recorded day
-- off isn't matched as a driver that date. send_invitation's eligibility check is this
-- function, so they can't be asked either; their own invites as a driver still work.

create or replace function public.match_candidates(me uuid, ride_date date, skip_opt_in_if_connected boolean)
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
      and (pr.other_role <> 'driver' or not exists (                       -- M-32, Q11
             select 1 from public.driver_days_off dd
             where dd.driver_id = pr.other_id
               and dd.ride_date = match_candidates.ride_date))
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

revoke execute on function public.match_candidates(uuid, date, boolean) from public, anon, authenticated;

-- A block cancels the pair's upcoming rides (safety) ------------------------------------------------
-- Its own trigger; blocks_end_pair (0005) and blocks_close_invitations (0017) are
-- untouched. Same pair lock, so a confirm and a block on the pair serialize. Today's
-- ride is cancelled even if its pickup time has passed; older confirmed rides await
-- completion, and ride_pickup hides them anyway.

create function public.blocks_cancel_rides()
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

  update public.rides r
  set status = 'cancelled',
      cancel_reason = 'safety',
      cancelled_at = now()
  where r.status = 'confirmed'
    and ((r.driver_id = new.blocker_id and r.passenger_id = new.blocked_id)
      or (r.driver_id = new.blocked_id and r.passenger_id = new.blocker_id))
    and r.ride_date >= (now() at time zone 'America/Los_Angeles')::date;
  return null;
end
$$;

revoke execute on function public.blocks_cancel_rides() from public, anon, authenticated;

create trigger blocks_cancel_rides
  after insert on public.blocks
  for each row execute function public.blocks_cancel_rides();

-- Suspension (0011) ------------------------------------------------------------------------
-- Copied from *_invitations.sql. One change, marked M-32: the rides it cancels record
-- the safety reason and when.

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
  set status = 'cancelled',
      cancel_reason = 'safety',  -- M-32
      cancelled_at = now()       -- M-32
  where status = 'confirmed'
    and uid in (driver_id, passenger_id)
    and ride_date >= (now() at time zone 'America/Los_Angeles')::date;
end
$$;

revoke execute on function public.withdraw_member(uuid) from public, anon, authenticated;

-- Account deletion (0010) ------------------------------------------------------------------
-- Copied from *_invitations.sql. Two changes, marked M-32: the future rides it cancels
-- record account_deleted and when, and the pickup details of every ride the person was
-- in, past or future, are deleted (the spot is near the passenger's home, the plate is
-- the driver's; D-15).

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
  set status = 'cancelled',
      cancel_reason = 'account_deleted',  -- M-32
      cancelled_at = now()                -- M-32
  where me in (r.driver_id, r.passenger_id)
    and r.status = 'confirmed'
    and r.ride_date + r.pickup_time > (now() at time zone 'America/Los_Angeles');

  -- M-32: pickup details of every ride this person was in.
  delete from public.ride_pickups p
  using public.rides r
  where r.id = p.ride_id
    and me in (r.driver_id, r.passenger_id);

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

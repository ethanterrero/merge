-- First Ride: every new match starts with one dated ride. Private post-ride
-- feedback decides, mutually, whether a pair can Ride Again or form a Commute Crew.
-- Spec: docs/superpowers/specs/2026-10-08-first-ride-design.md, "Data model".
--
-- Privacy: feedback rows are readable by their author only. The only shared
-- outcome is a row in connections, so "they said no" and "they haven't answered"
-- look the same to the client.
-- Ride completion (D-01) and the booking API come in later migrations.

-- Commute Crews ------------------------------------------------------------

create table public.commute_crews (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles(id),
  user_high uuid not null references public.profiles(id),
  proposed_by uuid not null references public.profiles(id),
  weekdays integer[] not null,
  departure_time time not null,
  status text not null default 'proposed'
    check (status in ('proposed','active','paused','ended','not_started')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  ended_at timestamptz,
  check (user_low < user_high),
  check (proposed_by in (user_low, user_high)),
  -- ISO weekdays Monday–Friday, non-empty, one-dimensional, no nulls.
  check (
    cardinality(weekdays) > 0
    and array_ndims(weekdays) = 1
    and weekdays <@ array[1,2,3,4,5]
  )
);

-- At most one open Crew per pair.
create unique index commute_crews_one_open_per_pair
  on public.commute_crews (user_low, user_high)
  where status in ('proposed','active','paused');

create index commute_crews_pair_idx on public.commute_crews (user_low, user_high);
create index commute_crews_user_high_idx on public.commute_crews (user_high);

-- Invitations: one specific day each, optionally from a Crew ------------------

-- The hosted database had no rows in invitations when this was written, so no backfill.
alter table public.invitations
  add column ride_date date not null,
  add column crew_id uuid references public.commute_crews(id);

-- Rides ---------------------------------------------------------------------

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.invitations(id),
  driver_id uuid not null references public.profiles(id),
  passenger_id uuid not null references public.profiles(id),
  ride_date date not null,
  pickup_time time not null,
  status text not null default 'confirmed'
    check (status in ('confirmed','completed','cancelled')),
  kind text not null check (kind in ('first_ride','ride_again','crew')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (driver_id <> passenger_id)
);

create index rides_driver_id_idx on public.rides (driver_id);
create index rides_passenger_id_idx on public.rides (passenger_id);

-- Post-ride feedback (private to its author) ---------------------------------

create table public.ride_feedback (
  ride_id uuid not null references public.rides(id),
  author_id uuid not null references public.profiles(id),
  experience text check (experience in ('great','good','not_a_fit')),
  ride_again text check (ride_again in ('yes','individual','no')),
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ride_id, author_id)
);

create index ride_feedback_author_id_idx on public.ride_feedback (author_id);

-- Connections (Ride Again) ----------------------------------------------------

create table public.connections (
  user_low uuid not null references public.profiles(id),
  user_high uuid not null references public.profiles(id),
  crew_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);

create index connections_user_high_idx on public.connections (user_high);

-- Row level security ------------------------------------------------------------

alter table public.commute_crews enable row level security;
alter table public.rides enable row level security;
alter table public.ride_feedback enable row level security;
alter table public.connections enable row level security;

create policy "Read own rides"
  on public.rides for select
  to authenticated
  using ((select auth.uid()) in (driver_id, passenger_id));

create policy "Read own ride feedback"
  on public.ride_feedback for select
  to authenticated
  using (author_id = (select auth.uid()));

create policy "Give feedback on own completed ride"
  on public.ride_feedback for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.rides r
      where r.id = ride_feedback.ride_id
        and r.status = 'completed'
        and (select auth.uid()) in (r.driver_id, r.passenger_id)
    )
  );

create policy "Update own feedback on own completed ride"
  on public.ride_feedback for update
  to authenticated
  using (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.rides r
      where r.id = ride_feedback.ride_id
        and r.status = 'completed'
        and (select auth.uid()) in (r.driver_id, r.passenger_id)
    )
  )
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.rides r
      where r.id = ride_feedback.ride_id
        and r.status = 'completed'
        and (select auth.uid()) in (r.driver_id, r.passenger_id)
    )
  );

create policy "Members read their connections"
  on public.connections for select
  to authenticated
  using ((select auth.uid()) in (user_low, user_high));

create policy "Members read their Commute Crews"
  on public.commute_crews for select
  to authenticated
  using ((select auth.uid()) in (user_low, user_high));

-- Supabase grants API roles every table privilege by default and RLS does the
-- limiting. Where clients must never write, take the privilege away as well.
-- Rides are written by the booking API (later), Crews only through the RPCs
-- below, connections only by resolve_connection. Feedback is never deleted
-- from the client.
revoke insert, update, delete, truncate on public.rides from public, anon, authenticated;
revoke insert, update, delete, truncate on public.commute_crews from public, anon, authenticated;
revoke insert, update, delete, truncate on public.connections from public, anon, authenticated;
revoke delete, truncate on public.ride_feedback from public, anon, authenticated;

-- Feedback timestamps are set by the server, and a row can't be moved ----------

create function public.ride_feedback_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    if new.ride_id is distinct from old.ride_id or new.author_id is distinct from old.author_id then
      raise exception 'Feedback can''t be moved to another ride or author'
        using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke execute on function public.ride_feedback_stamp() from public, anon, authenticated;

create trigger ride_feedback_stamp
  before insert or update on public.ride_feedback
  for each row execute function public.ride_feedback_stamp();

-- Connection rules -------------------------------------------------------------

-- Recomputes the connection between a and b from their feedback:
-- 1. Each person's answer is their most recent non-null ride_again across
--    completed rides the pair shared (by ride_feedback.updated_at).
-- 2. Both answered yes/individual: upsert the connection, crew_eligible when both yes.
-- 3. Otherwise (any no, or a missing answer): delete the connection and end any
--    proposed/active/paused Crew.
-- 4. Connected but no longer Crew-eligible: a proposed Crew becomes not_started.
--    Active and paused Crews are left for the members to end.
-- Not callable by clients (execute revoked below); it only recomputes from
-- stored data, so it doesn't depend on who triggered it.
create function public.resolve_connection(a uuid, b uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lo uuid := least(a, b);
  hi uuid := greatest(a, b);
  answer_lo text;
  answer_hi text;
  eligible boolean;
begin
  if a is null or b is null or a = b then
    return;
  end if;

  select f.ride_again into answer_lo
  from public.ride_feedback f
  join public.rides r on r.id = f.ride_id
  where f.author_id = lo
    and f.ride_again is not null
    and r.status = 'completed'
    and ((r.driver_id = lo and r.passenger_id = hi) or (r.driver_id = hi and r.passenger_id = lo))
  order by f.updated_at desc, r.ride_date desc, r.created_at desc, r.id desc
  limit 1;

  select f.ride_again into answer_hi
  from public.ride_feedback f
  join public.rides r on r.id = f.ride_id
  where f.author_id = hi
    and f.ride_again is not null
    and r.status = 'completed'
    and ((r.driver_id = lo and r.passenger_id = hi) or (r.driver_id = hi and r.passenger_id = lo))
  order by f.updated_at desc, r.ride_date desc, r.created_at desc, r.id desc
  limit 1;

  if answer_lo in ('yes','individual') and answer_hi in ('yes','individual') then
    eligible := answer_lo = 'yes' and answer_hi = 'yes';

    insert into public.connections (user_low, user_high, crew_eligible)
    values (lo, hi, eligible)
    on conflict (user_low, user_high) do update
      set crew_eligible = excluded.crew_eligible,
          updated_at = now()
      where public.connections.crew_eligible is distinct from excluded.crew_eligible;

    if not eligible then
      update public.commute_crews
      set status = 'not_started'
      where user_low = lo and user_high = hi and status = 'proposed';
    end if;
  else
    delete from public.connections
    where user_low = lo and user_high = hi;

    update public.commute_crews
    set status = 'ended',
        ended_at = now()
    where user_low = lo and user_high = hi
      and status in ('proposed','active','paused');
  end if;
end
$$;

revoke execute on function public.resolve_connection(uuid, uuid) from public, anon, authenticated;

-- Runs as the owner so it can call resolve_connection, which clients can't.
create function public.ride_feedback_resolve_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ride record;
begin
  select r.driver_id, r.passenger_id into ride
  from public.rides r
  where r.id = new.ride_id;

  if found then
    perform public.resolve_connection(ride.driver_id, ride.passenger_id);
  end if;
  return null;
end
$$;

revoke execute on function public.ride_feedback_resolve_connection() from public, anon, authenticated;

create trigger ride_feedback_resolve_connection
  after insert or update on public.ride_feedback
  for each row execute function public.ride_feedback_resolve_connection();

-- Commute Crew RPCs ------------------------------------------------------------
-- Refusals raise 42501 (insufficient_privilege); a Crew the caller isn't in is
-- reported as not found (P0002), so its existence isn't revealed.

create function public.propose_crew(other uuid, weekdays integer[], departure_time time)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  crew uuid;
begin
  if me is null then
    raise exception 'Sign in to propose a Commute Crew' using errcode = '42501';
  end if;
  if other is null or other = me then
    raise exception 'Choose someone else to commute with' using errcode = '22023';
  end if;

  lo := least(me, other);
  hi := greatest(me, other);

  -- Lock the connection so a concurrent answer change waits for this proposal,
  -- then sees (and ends or resets) it.
  perform 1
  from public.connections c
  where c.user_low = lo and c.user_high = hi and c.crew_eligible
  for share;
  if not found then
    raise exception 'A Commute Crew isn''t available with this person' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.commute_crews cc
    where cc.user_low = lo and cc.user_high = hi
      and cc.status in ('proposed','active','paused')
  ) then
    raise exception 'You already have an open Commute Crew with this person' using errcode = '42501';
  end if;

  insert into public.commute_crews (user_low, user_high, proposed_by, weekdays, departure_time, status)
  values (lo, hi, me, propose_crew.weekdays, propose_crew.departure_time, 'proposed')
  returning id into crew;

  return crew;
end
$$;

create function public.respond_to_crew(crew_id uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  crew public.commute_crews;
begin
  if me is null then
    raise exception 'Sign in to respond to a Commute Crew' using errcode = '42501';
  end if;
  if accept is null then
    raise exception 'Accept or decline the Commute Crew' using errcode = '22023';
  end if;

  select * into crew
  from public.commute_crews cc
  where cc.id = respond_to_crew.crew_id
  for update;
  if not found or me not in (crew.user_low, crew.user_high) then
    raise exception 'Commute Crew not found' using errcode = 'P0002';
  end if;
  if crew.proposed_by = me then
    raise exception 'Only the invited member can respond to a Commute Crew' using errcode = '42501';
  end if;
  if crew.status <> 'proposed' then
    raise exception 'This Commute Crew is no longer waiting for an answer' using errcode = '42501';
  end if;

  update public.commute_crews
  set status = case when accept then 'active' else 'not_started' end,
      responded_at = now()
  where id = crew.id;
end
$$;

-- Allowed: active -> paused, paused -> active, active|paused -> ended (either
-- member), and proposed -> not_started (the proposer withdrawing).
create function public.set_crew_status(crew_id uuid, status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  crew public.commute_crews;
  next_status text := set_crew_status.status;
begin
  if me is null then
    raise exception 'Sign in to change a Commute Crew' using errcode = '42501';
  end if;

  select * into crew
  from public.commute_crews cc
  where cc.id = set_crew_status.crew_id
  for update;
  if not found or me not in (crew.user_low, crew.user_high) then
    raise exception 'Commute Crew not found' using errcode = 'P0002';
  end if;

  if not coalesce(
       (crew.status = 'active' and next_status in ('paused','ended'))
    or (crew.status = 'paused' and next_status in ('active','ended'))
    or (crew.status = 'proposed' and next_status = 'not_started' and crew.proposed_by = me),
    false
  ) then
    raise exception 'A Commute Crew can''t go from % to %', crew.status, coalesce(next_status, 'nothing')
      using errcode = '42501';
  end if;

  update public.commute_crews
  set status = next_status,
      ended_at = case when next_status = 'ended' then now() else ended_at end
  where id = crew.id;
end
$$;

revoke execute on function public.propose_crew(uuid, integer[], time) from public, anon;
revoke execute on function public.respond_to_crew(uuid, boolean) from public, anon;
revoke execute on function public.set_crew_status(uuid, text) from public, anon;
grant execute on function public.propose_crew(uuid, integer[], time) to authenticated;
grant execute on function public.respond_to_crew(uuid, boolean) to authenticated;
grant execute on function public.set_crew_status(uuid, text) to authenticated;

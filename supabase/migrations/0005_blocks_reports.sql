-- Blocks and safety reports (M-06, data side).
-- Spec: docs/superpowers/specs/2026-10-08-blocks-reports-design.md.
--
-- A block is a silent hard filter both ways: the blocked person can't read it or
-- detect it, and it ends the pair's Ride Again connection and any open Commute Crew,
-- exactly as a "no" does in resolve_connection (0003). Safety reports are
-- insert-only for the reporter and readable by no client; staff read them with the
-- service role. Foreign keys to profiles and rides have no on-delete action yet;
-- 0007 (account deletion) decides the cascades.

-- Blocks -------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles(id),
  blocked_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- "Who blocked me" lookups (matching) and the 0007 cascade. is_blocked is served by
-- the primary key in both directions.
create index blocks_blocked_id_idx on public.blocks (blocked_id);

alter table public.blocks enable row level security;

create policy "Blockers read their blocks"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()));

create policy "Blockers create their blocks"
  on public.blocks for insert
  to authenticated
  with check (blocker_id = (select auth.uid()));

create policy "Blockers remove their blocks"
  on public.blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()));

-- Supabase grants API roles every table privilege by default; take away what
-- clients must not have. A duplicate block raises unique_violation (clients that
-- want idempotency use on conflict do nothing). created_at is the server's.
revoke all on public.blocks from public, anon;
revoke insert, update, truncate, references, trigger on public.blocks from authenticated;
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

-- Safety reports ------------------------------------------------------------------

create table public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  reported_user_id uuid references public.profiles(id),
  ride_id uuid references public.rides(id),
  category text not null
    check (category in ('unsafe_driving','harassment','no_show','vehicle_identity_mismatch','other')),
  details text check (char_length(details) <= 4000),
  created_at timestamptz not null default now(),
  check (reported_user_id is distinct from reporter_id)
);

create index safety_reports_reporter_id_idx on public.safety_reports (reporter_id);
create index safety_reports_reported_user_id_idx on public.safety_reports (reported_user_id);

alter table public.safety_reports enable row level security;

-- The only policy. No client can select, update or delete, including the reporter;
-- clients insert without RETURNING.
create policy "Members file their own safety reports"
  on public.safety_reports for insert
  to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      ride_id is null
      or exists (
        select 1 from public.rides r
        where r.id = safety_reports.ride_id
          and (select auth.uid()) in (r.driver_id, r.passenger_id)
      )
    )
  );

revoke all on public.safety_reports from public, anon, authenticated;
grant insert (reporter_id, reported_user_id, ride_id, category, details)
  on public.safety_reports to authenticated;

-- is_blocked ---------------------------------------------------------------------
-- True if either person blocked the other; false for nulls and a = b.
-- Not callable by clients: a blocked person could call is_blocked(me, x) and learn
-- who blocked them. Later features call it from their own security definer RPCs
-- (which run as the owner) or with the service role, never from an RLS policy.

create function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  )
$$;

revoke execute on function public.is_blocked(uuid, uuid) from public, anon, authenticated;

-- A block ends the pair's connection and open Crew --------------------------------
-- Same pair order, statuses and ended_at as resolve_connection's "no" branch.
-- Unblocking restores nothing, so there is no delete trigger.
-- The advisory lock pairs with connections_skip_blocked: a block and a concurrent
-- feedback change on the same pair serialize, and whichever runs second sees the
-- other (each statement after the lock takes a fresh read committed snapshot).

create function public.blocks_end_pair()
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

  delete from public.connections
  where user_low = lo and user_high = hi;

  update public.commute_crews
  set status = 'ended',
      ended_at = now()
  where user_low = lo and user_high = hi
    and status in ('proposed','active','paused');

  return null;
end
$$;

revoke execute on function public.blocks_end_pair() from public, anon, authenticated;

create trigger blocks_end_pair
  after insert on public.blocks
  for each row execute function public.blocks_end_pair();

-- A blocked pair can't be (re)connected -------------------------------------------
-- resolve_connection (0003) upserts the connection whenever either person's feedback
-- changes, which would bring back Ride Again from an old yes/yes. Rather than
-- redefining it, skip any write to connections for a blocked pair: returning null
-- from a before trigger drops the row silently, so the upsert neither raises nor
-- connects. In an upsert the before-insert trigger runs first, so the row never
-- reaches the conflict check.

create function public.connections_skip_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merge.pair:' || new.user_low::text || ':' || new.user_high::text, 0));

  if public.is_blocked(new.user_low, new.user_high) then
    return null;
  end if;
  return new;
end
$$;

revoke execute on function public.connections_skip_blocked() from public, anon, authenticated;

create trigger connections_skip_blocked
  before insert or update on public.connections
  for each row execute function public.connections_skip_blocked();

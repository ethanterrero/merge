-- Account deletion: the data policy (M-17a, D-15).
-- Spec: docs/superpowers/specs/2026-10-08-account-deletion-design.md, "Deletion policy".
--
-- Deleting a person's auth.users row (M-17b's Edge Function, service role) cascades
-- to their profile. From there:
--   - what they own is deleted (foreign keys on delete cascade);
--   - shared records (rides, the invitations behind them, Crews) stay for the other
--     person with this person's column set to null, which the app shows as
--     "Former member";
--   - safety reports stay with their reference set to null, stamped, and are
--     purged 12 months later;
--   - a before-delete trigger on profiles does what a foreign key can't: cancel
--     future confirmed rides, end open Crews, delete invitations that led to no
--     ride, and delete shared records with nobody left.
-- No identifier of a deleted person is kept (no hashed email).
-- auth.audit_log_entries is purged by M-17b's Edge Function, not here.

-- Required on insert ----------------------------------------------------------------
-- Columns that become nullable for "Former member" are still required when a row is
-- created. Arguments are the column names to check.

create function public.require_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  row_json jsonb := pg_catalog.to_jsonb(new);
begin
  foreach col in array tg_argv loop
    if row_json ->> col is null then
      raise exception 'null value in column "%" of relation "%" violates not-null constraint', col, tg_table_name
        using errcode = 'not_null_violation';
    end if;
  end loop;
  return new;
end
$$;

revoke execute on function public.require_on_insert() from public, anon, authenticated;

-- Invitations (0001, 0003) ------------------------------------------------------------
-- An invitation that led to a ride is part of the ride's record and keeps it; any
-- other invitation is deleted by profiles_apply_deletion_policy before these act.

alter table public.invitations
  alter column sender_id drop not null,
  alter column recipient_id drop not null,
  alter column commute_id drop not null,
  drop constraint invitations_sender_id_fkey,
  drop constraint invitations_recipient_id_fkey,
  drop constraint invitations_commute_id_fkey,
  drop constraint invitations_crew_id_fkey,
  add constraint invitations_sender_id_fkey
    foreign key (sender_id) references public.profiles(id) on delete set null,
  add constraint invitations_recipient_id_fkey
    foreign key (recipient_id) references public.profiles(id) on delete set null,
  add constraint invitations_commute_id_fkey
    foreign key (commute_id) references public.commutes(id) on delete set null,
  add constraint invitations_crew_id_fkey
    foreign key (crew_id) references public.commute_crews(id) on delete set null;

create trigger invitations_require_on_insert
  before insert on public.invitations
  for each row execute function public.require_on_insert('sender_id', 'recipient_id', 'commute_id');

-- Rides (0003) ---------------------------------------------------------------------------
-- rides.invitation_id keeps no action: an invitation can't go while its ride exists.

alter table public.rides
  alter column driver_id drop not null,
  alter column passenger_id drop not null,
  drop constraint rides_driver_id_fkey,
  drop constraint rides_passenger_id_fkey,
  add constraint rides_driver_id_fkey
    foreign key (driver_id) references public.profiles(id) on delete set null,
  add constraint rides_passenger_id_fkey
    foreign key (passenger_id) references public.profiles(id) on delete set null;

create trigger rides_require_on_insert
  before insert on public.rides
  for each row execute function public.require_on_insert('driver_id', 'passenger_id');

-- Ride feedback (0003): owned by its author, and a child of its ride ------------------------

alter table public.ride_feedback
  drop constraint ride_feedback_ride_id_fkey,
  drop constraint ride_feedback_author_id_fkey,
  add constraint ride_feedback_ride_id_fkey
    foreign key (ride_id) references public.rides(id) on delete cascade,
  add constraint ride_feedback_author_id_fkey
    foreign key (author_id) references public.profiles(id) on delete cascade;

-- Connections (0003): a link between two people, deleted with either ------------------------

alter table public.connections
  drop constraint connections_user_low_fkey,
  drop constraint connections_user_high_fkey,
  add constraint connections_user_low_fkey
    foreign key (user_low) references public.profiles(id) on delete cascade,
  add constraint connections_user_high_fkey
    foreign key (user_high) references public.profiles(id) on delete cascade;

-- Commute Crews (0003): kept, ended, for the other member --------------------------------------
-- The pair and proposer checks pass with a null, so they stay as they are.

alter table public.commute_crews
  alter column user_low drop not null,
  alter column user_high drop not null,
  alter column proposed_by drop not null,
  drop constraint commute_crews_user_low_fkey,
  drop constraint commute_crews_user_high_fkey,
  drop constraint commute_crews_proposed_by_fkey,
  add constraint commute_crews_user_low_fkey
    foreign key (user_low) references public.profiles(id) on delete set null,
  add constraint commute_crews_user_high_fkey
    foreign key (user_high) references public.profiles(id) on delete set null,
  add constraint commute_crews_proposed_by_fkey
    foreign key (proposed_by) references public.profiles(id) on delete set null;

create trigger commute_crews_require_on_insert
  before insert on public.commute_crews
  for each row execute function public.require_on_insert('user_low', 'user_high', 'proposed_by');

-- Blocks (0005): deleted with either person (D-15) ------------------------------------------------

alter table public.blocks
  drop constraint blocks_blocker_id_fkey,
  drop constraint blocks_blocked_id_fkey,
  add constraint blocks_blocker_id_fkey
    foreign key (blocker_id) references public.profiles(id) on delete cascade,
  add constraint blocks_blocked_id_fkey
    foreign key (blocked_id) references public.profiles(id) on delete cascade;

-- Safety reports (0005): kept with references cleared, purged after 12 months ---------------------
-- "is distinct from" rejected a report whose reporter and reported person were both
-- deleted (null is not distinct from null). "<>" still rejects a self-report.

alter table public.safety_reports
  alter column reporter_id drop not null,
  drop constraint safety_reports_check,
  drop constraint safety_reports_reporter_id_fkey,
  drop constraint safety_reports_reported_user_id_fkey,
  drop constraint safety_reports_ride_id_fkey,
  add constraint safety_reports_not_self check (reported_user_id <> reporter_id),
  add constraint safety_reports_reporter_id_fkey
    foreign key (reporter_id) references public.profiles(id) on delete set null,
  add constraint safety_reports_reported_user_id_fkey
    foreign key (reported_user_id) references public.profiles(id) on delete set null,
  add constraint safety_reports_ride_id_fkey
    foreign key (ride_id) references public.rides(id) on delete set null,
  add column account_deleted_at timestamptz;

comment on column public.safety_reports.account_deleted_at is
  'When the reporter''s or reported member''s account was last deleted (their reference cleared). Server-set.';

create trigger safety_reports_require_on_insert
  before insert on public.safety_reports
  for each row execute function public.require_on_insert('reporter_id');

-- Clients have no grant on the new column (0005 grants insert on five columns only).
-- Stamp a deletion when a reference is cleared (the set-null action is an UPDATE).
create function public.safety_reports_stamp_account_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.reporter_id is not null and new.reporter_id is null)
     or (old.reported_user_id is not null and new.reported_user_id is null) then
    new.account_deleted_at := now();
  end if;
  return new;
end
$$;

revoke execute on function public.safety_reports_stamp_account_deleted() from public, anon, authenticated;

create trigger safety_reports_stamp_account_deleted
  before update of reporter_id, reported_user_id on public.safety_reports
  for each row execute function public.safety_reports_stamp_account_deleted();

-- Deletes reports 12 months after the later of filing and an account deletion, so
-- every report is kept at least 12 months from each. Returns how many it deleted.
-- Staff or a scheduled job run it with the service role; clients can't.
create function public.purge_expired_safety_reports()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.safety_reports s
  where greatest(s.created_at, coalesce(s.account_deleted_at, s.created_at))
        < now() - interval '12 months';
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.purge_expired_safety_reports() from public, anon, authenticated;

-- Indexes for the deletion cascades (hosted advisor) ------------------------------------------
-- commute_crews.user_low is served by commute_crews_pair_idx, ride_feedback.ride_id by
-- its primary key, rides.invitation_id by its unique constraint.

create index if not exists invitations_sender_id_idx on public.invitations (sender_id);
create index if not exists invitations_recipient_id_idx on public.invitations (recipient_id);
create index if not exists invitations_commute_id_idx on public.invitations (commute_id);
create index if not exists invitations_crew_id_idx on public.invitations (crew_id);
create index if not exists commute_crews_proposed_by_idx on public.commute_crews (proposed_by);
create index if not exists safety_reports_ride_id_idx on public.safety_reports (ride_id);

-- Feedback deletes recompute the connection ----------------------------------------------------
-- 0003's trigger fired on insert and update only, so a cascaded or staff delete left
-- the connection as it was. Same body as 0003, reading old on delete.

create or replace function public.ride_feedback_resolve_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ride record;
  feedback_ride uuid;
begin
  if tg_op = 'DELETE' then
    feedback_ride := old.ride_id;
  else
    feedback_ride := new.ride_id;
  end if;

  select r.driver_id, r.passenger_id into ride
  from public.rides r
  where r.id = feedback_ride;

  if found then
    perform public.resolve_connection(ride.driver_id, ride.passenger_id);
  end if;
  return null;
end
$$;

revoke execute on function public.ride_feedback_resolve_connection() from public, anon, authenticated;

drop trigger ride_feedback_resolve_connection on public.ride_feedback;
create trigger ride_feedback_resolve_connection
  after insert or update or delete on public.ride_feedback
  for each row execute function public.ride_feedback_resolve_connection();

-- What a foreign key can't express -------------------------------------------------------------
-- Runs before the profile row goes, so before any of the cascades and set-nulls above.
-- Every statement is filtered to this person. A later shared table that needs more
-- than a foreign key extends this function (copy its latest definition first).

create function public.profiles_apply_deletion_policy()
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

create trigger profiles_apply_deletion_policy
  before delete on public.profiles
  for each row execute function public.profiles_apply_deletion_policy();

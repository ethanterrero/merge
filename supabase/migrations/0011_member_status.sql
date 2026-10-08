-- Member status: suspension, vetting and the public-name helper (M-56).
-- Spec: docs/superpowers/specs/2026-10-08-member-status-design.md.
--
-- D-06: the owner vets each driver and sets vetted_at; only the server writes it.
-- D-07: removal sets suspended_at, which hides the person everywhere, withdraws
-- their pending invitations, cancels their future rides, ends their Crews and
-- drops their Ride Again connections; then the owner bans them in Supabase Auth.
-- Clearing suspended_at restores nothing.

-- Columns ----------------------------------------------------------------------

-- Nullable with no default, so existing hosted rows need no backfill.
alter table public.profiles
  add column suspended_at timestamptz,
  add column vetted_at timestamptz;

comment on column public.profiles.suspended_at is
  'Removed from the pilot when set (D-07). Server-only; clearing it restores nothing.';
comment on column public.profiles.vetted_at is
  'Owner checked license and insurance (D-06). Server-only; no documents are stored.';

-- Only the server writes them ----------------------------------------------------
-- Not security definer: it must see the caller's role in current_user. Client
-- roles may leave either column alone or write its current value, nothing else.
-- security definer RPCs run as their owner and pass; they must never copy a
-- client-supplied value into these columns.

create function public.profiles_guard_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.suspended_at is not null or new.vetted_at is not null then
        raise exception 'Only Merge can set suspended_at or vetted_at'
          using errcode = '42501';
      end if;
    elsif new.suspended_at is distinct from old.suspended_at
       or new.vetted_at is distinct from old.vetted_at then
      raise exception 'Only Merge can change suspended_at or vetted_at'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.profiles_guard_status() from public, anon, authenticated;

create trigger profiles_guard_status
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_status();

-- Status helpers -----------------------------------------------------------------
-- Not callable by clients: they'd reveal who is suspended or vetted, and whether an
-- id exists. Later features call them from their own security definer RPCs or with
-- the service role, never from an RLS policy or a view evaluated as a client.

-- True when the profile exists and isn't suspended.
create function public.is_active(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.suspended_at is null
  )
$$;

-- True when the owner vetted this member and they're still active.
create function public.is_vetted(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.vetted_at is not null and p.suspended_at is null
  )
$$;

revoke execute on function public.is_active(uuid) from public, anon, authenticated;
revoke execute on function public.is_vetted(uuid) from public, anon, authenticated;

-- public_name ----------------------------------------------------------------------
-- How a name is shown to anyone else: the first word plus the first letter or digit
-- of the last word, upper-cased, and a period ('Priya Sharma' -> 'Priya S.'). One
-- word is shown as typed; a last word with no letter or digit adds nothing. Null for
-- null or blank input. Every path that shows a name to someone else uses this.

create function public.public_name(display_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when w.words is null then null
    when pg_catalog.cardinality(w.words) = 1 then w.words[1]
    else w.words[1] || coalesce(
      ' ' || pg_catalog.upper(pg_catalog.substring(
        w.words[pg_catalog.cardinality(w.words)], '[[:alnum:]]')) || '.',
      '')
  end
  from (
    select pg_catalog.regexp_split_to_array(
      nullif(pg_catalog.regexp_replace(display_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      '[[:space:]]+') as words
  ) as w
$$;

revoke execute on function public.public_name(text) from public, anon;
grant execute on function public.public_name(text) to authenticated;

-- Withdrawal ------------------------------------------------------------------------
-- Ends everything a member shares with others. Called by the suspension trigger
-- below; account deletion (M-17a) can call it too. Order matters: connections go
-- before Crews, so a concurrent propose_crew (which holds the connection for share)
-- either commits first and has its Crew ended here, or runs after and finds no
-- connection. In read committed each statement takes a fresh snapshot.
-- M-32 adds a cancel reason to rides and should record these rides as safety
-- cancellations here (copy this definition before replacing it).

create function public.withdraw_member(uid uuid)
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
  set status = 'cancelled'
  where status = 'pending'
    and uid in (sender_id, recipient_id);

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

create function public.profiles_withdraw_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.withdraw_member(new.id);
  return null;
end
$$;

revoke execute on function public.profiles_withdraw_suspended() from public, anon, authenticated;

create trigger profiles_withdraw_suspended
  after update of suspended_at on public.profiles
  for each row
  when (old.suspended_at is null and new.suspended_at is not null)
  execute function public.profiles_withdraw_suspended();

-- A suspended member can't be (re)connected ------------------------------------------
-- Same approach as connections_skip_blocked (0005): resolve_connection would upsert
-- the pair's connection from an old yes/yes on any later feedback change, so skip
-- the write instead of redefining it. Runs after connections_skip_blocked (triggers
-- fire in name order), so only for unblocked pairs.
-- Race: suspending updates the profile row, whose lock conflicts with for share. A
-- concurrent connection write either locks first (and withdraw_member's delete, a
-- later statement, removes the row) or waits for the suspension to commit and then
-- sees it in the fresh snapshot of the is_active check.

create function public.connections_skip_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles p
  where p.id in (new.user_low, new.user_high)
  order by p.id
  for share;

  if not (public.is_active(new.user_low) and public.is_active(new.user_high)) then
    return null;
  end if;
  return new;
end
$$;

revoke execute on function public.connections_skip_suspended() from public, anon, authenticated;

create trigger connections_skip_suspended
  before insert or update on public.connections
  for each row execute function public.connections_skip_suspended();

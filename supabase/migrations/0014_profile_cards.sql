-- Limited profile cards for related users (M-16).
-- Spec: docs/superpowers/specs/2026-10-10-profile-cards-design.md.
--
-- profiles stays owner-only (0002). Other members' names, roles, ride preferences
-- and vetted flags reach a client only through profile_cards, and only for people
-- the caller already shares an invitation, a ride, a Ride Again connection or a
-- Commute Crew with, in any status. A blocked pair, a suspended member, a deleted
-- member, an unrelated id and an unknown id all come back the same way: no row and
-- no error. The card is the same before and after a ride is confirmed; what a
-- confirmed ride reveals (vehicle, plate, exact pickup spot, contact details) lives
-- with booking (M-32) and contact sharing (M-55a).
--
-- Any invitation makes two people related, so the invitation RPC (M-27) must only
-- let a member invite someone they could already see.
--
-- To change the output columns (M-49 trust stats, M-41 review cohort): copy this
-- definition, drop and recreate the function in your migration, re-apply the
-- revoke and grant below, and keep supabase/tests/profile_cards_test.sql passing.

create function public.profile_cards(ids uuid[])
returns table (
  id uuid,
  public_name text,
  role text,
  ride_prefs text[],
  vetted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted uuid[];
begin
  select coalesce(pg_catalog.array_agg(distinct x.wanted_id), '{}')
  into wanted
  from pg_catalog.unnest(profile_cards.ids) as x(wanted_id)
  where x.wanted_id is not null;

  -- The pilot has at most 100 testers (D-11). Checked before anything about the
  -- caller, so the error is the same for everyone.
  if pg_catalog.cardinality(wanted) > 100 then
    raise exception 'Ask for at most 100 profile cards at a time'
      using errcode = '22023';
  end if;

  -- No caller, or a suspended or profile-less caller: nothing, and no error
  -- (a suspended member's app shows nothing special, M-56).
  if me is null or not public.is_active(me) then
    return;
  end if;

  return query
  select p.id,
         public.public_name(p.display_name),
         p.role,
         p.ride_prefs,
         p.vetted_at is not null
  from public.profiles p
  where p.id = any (wanted)
    and p.id <> me
    and public.is_active(p.id)
    and not public.is_blocked(me, p.id)
    and (
         exists (
           select 1 from public.invitations i
           where (i.sender_id = me and i.recipient_id = p.id)
              or (i.sender_id = p.id and i.recipient_id = me))
      or exists (
           select 1 from public.rides r
           where (r.driver_id = me and r.passenger_id = p.id)
              or (r.driver_id = p.id and r.passenger_id = me))
      or exists (
           select 1 from public.connections c
           where c.user_low = least(me, p.id)
             and c.user_high = greatest(me, p.id))
      or exists (
           select 1 from public.commute_crews cc
           where cc.user_low = least(me, p.id)
             and cc.user_high = greatest(me, p.id))
    );
end
$$;

comment on function public.profile_cards(uuid[]) is
  'Cards (public name, role, ride preferences, vetted) for members the caller shares an invitation, ride, connection or Crew with. Blocked, suspended, deleted and unrelated ids return no row.';

revoke execute on function public.profile_cards(uuid[]) from public, anon;
grant execute on function public.profile_cards(uuid[]) to authenticated;

-- Limited profile cards for related users (M-16).
-- Spec: docs/superpowers/specs/2026-10-10-profile-cards-design.md, "Test plan".
--
-- People (Ada is the caller unless a step says otherwise). Each of 01–0f shares
-- exactly one kind of row with Ada, so every relationship is tested on its own.
--   Ada   0a  caller, 'Ada Lovelace'
--   Priya 01  invitation Ada -> Priya; 'Priya Sharma', vetted driver, prefers quiet
--   Ivy   02  invitation Ivy -> Ada
--   Rex   03  ride, Rex drives Ada (unvetted driver)
--   Pat   04  ride, Ada drives Pat
--   Cora  05  connection only, Ada is user_high
--   Cy    06  Crew only, Ada is user_high
--   Uma   07  unrelated
--   Bo    08  ride with Ada; Ada blocks Bo
--   Bix   09  ride with Ada; Bix blocks Ada
--   Cole  0c  connection only, Ada is user_low
--   Dot   0d  Crew only, Ada is user_low
--   Sue   0e  ride with Ada; suspended later
--   Del   0f  ride with Ada; deleted later
--   Gil   10 + Hal 11  control pair. Rides need an invitation of their own
--                      (rides.invitation_id is unique), so each ride above points
--                      at one of the control pair's invitations, keeping the ride
--                      the only row between Ada and the other person.
--   Fay   12  completed ride with Ada, used for the feedback step
-- Ride completion is not implemented yet (D-01), so rides are set up as admin.
begin;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000000' || s)::uuid, s || '@example.test'
from unnest(array['0a','01','02','03','04','05','06','07','08','09','0c','0d','0e','0f','10','11','12']) as s;

insert into public.profiles (id, display_name, role, ride_prefs) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada Lovelace', 'passenger', '{smoke_free}'),
  ('00000000-0000-0000-0000-000000000001', 'Priya Sharma', 'driver', '{quiet}'),
  ('00000000-0000-0000-0000-000000000002', 'Ivy I.', 'passenger', '{}'),
  ('00000000-0000-0000-0000-000000000003', 'Rex R.', 'driver', '{quiet,smoke_free}'),
  ('00000000-0000-0000-0000-000000000004', 'Pat P.', 'passenger', '{}'),
  ('00000000-0000-0000-0000-000000000005', 'Cora C.', 'both', '{}'),
  ('00000000-0000-0000-0000-000000000006', 'Cy C.', 'both', '{}'),
  ('00000000-0000-0000-0000-000000000007', 'Uma U.', 'driver', '{}'),
  ('00000000-0000-0000-0000-000000000008', 'Bo B.', 'driver', '{}'),
  ('00000000-0000-0000-0000-000000000009', 'Bix B.', 'passenger', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'Cole C.', 'both', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'Dot D.', 'both', '{}'),
  ('00000000-0000-0000-0000-00000000000e', 'Sue S.', 'driver', '{}'),
  ('00000000-0000-0000-0000-00000000000f', 'Del D.', 'passenger', '{}'),
  ('00000000-0000-0000-0000-000000000010', 'Gil G.', 'passenger', '{}'),
  ('00000000-0000-0000-0000-000000000011', 'Hal H.', 'driver', '{}'),
  ('00000000-0000-0000-0000-000000000012', 'Fay F.', 'driver', '{}');

update public.profiles set vetted_at = now()
where id = '00000000-0000-0000-0000-000000000001';

-- One commute serves every invitation (invitations.commute_id is required on insert).
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000011',
  'driver',
  'SRID=4326;POINT(-122.2830 37.7650)',
  'SRID=4326;POINT(-122.3990 37.7890)',
  '07:30', '{1,2,3,4,5}', 2
);

-- i1 Ada -> Priya, i2 Ivy -> Ada. c1..c7 are the control pair's, one per ride.
insert into public.invitations (id, sender_id, recipient_id, commute_id, status, ride_date) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'pending', current_date + 3),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'pending', current_date + 3),
  ('2c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 20),
  ('2c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 19),
  ('2c000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 18),
  ('2c000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 17),
  ('2c000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 16),
  ('2c000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 15),
  ('2c000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', current_date - 14);

-- Rides, all in the past. Pat's is confirmed (awaiting completion); the rest completed.
insert into public.rides (id, invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind) values
  ('40000000-0000-0000-0000-000000000003', '2c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', current_date - 20, '07:30', 'completed', 'first_ride'),
  ('40000000-0000-0000-0000-000000000004', '2c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', current_date - 19, '07:30', 'confirmed', 'first_ride'),
  ('40000000-0000-0000-0000-000000000008', '2c000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-00000000000a', current_date - 18, '07:30', 'completed', 'first_ride'),
  ('40000000-0000-0000-0000-000000000009', '2c000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000009', current_date - 17, '07:30', 'completed', 'first_ride'),
  ('40000000-0000-0000-0000-00000000000e', '2c000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000a', current_date - 16, '07:30', 'completed', 'first_ride'),
  ('40000000-0000-0000-0000-00000000000f', '2c000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000f', current_date - 15, '07:30', 'completed', 'first_ride'),
  ('40000000-0000-0000-0000-000000000012', '2c000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000a', current_date - 14, '07:30', 'completed', 'first_ride');

-- Connections only: Cora (05 < 0a) and Cole (0c > 0a).
insert into public.connections (user_low, user_high, crew_eligible) values
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', true),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', false);

-- Crews only: Cy (06 < 0a) and Dot (0d > 0a).
insert into public.commute_crews (id, user_low, user_high, proposed_by, weekdays, departure_time, status) values
  ('50000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', '{1,3}', '07:30', 'proposed'),
  ('50000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', '{2,4}', '08:00', 'active');

-- Run as postgres, readable later by any role: cards collected by test steps.
create temporary table seen (step text, id uuid, public_name text, role text, ride_prefs text[], vetted boolean);
grant all on seen to authenticated, anon;

-- 1. Privileges and shape. Checked directly, so a missing revoke can't hide.
do $$
declare
  f regprocedure := 'public.profile_cards(uuid[])'::regprocedure;
  p record;
begin
  select pr.prosecdef, pr.proconfig, pr.provolatile into p
  from pg_catalog.pg_proc pr where pr.oid = f;
  if not p.prosecdef then
    raise exception 'profile_cards must be security definer';
  end if;
  if p.proconfig is null or not ('search_path=""' = any (p.proconfig)) then
    raise exception 'profile_cards must set search_path to empty, has %', p.proconfig;
  end if;
  if p.provolatile <> 's' then
    raise exception 'profile_cards must be stable, is %', p.provolatile;
  end if;
  if not has_function_privilege('authenticated', f, 'EXECUTE') then
    raise exception 'authenticated must be able to execute profile_cards';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') then
    raise exception 'anon must not be able to execute profile_cards';
  end if;
  if pg_catalog.pg_get_function_result(f)
     is distinct from 'TABLE(id uuid, public_name text, role text, ride_prefs text[], vetted boolean)' then
    raise exception 'profile_cards returns the wrong columns: %', pg_catalog.pg_get_function_result(f);
  end if;
  -- Clients still can't read the helpers it calls.
  if has_function_privilege('authenticated', 'public.is_blocked(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.is_active(uuid)', 'EXECUTE') then
    raise exception 'is_blocked and is_active must stay client-inaccessible';
  end if;
end
$$;

-- 1b. Anon can't call it at all.
select tests.as_anon();
do $$
begin
  perform * from public.profile_cards(array['00000000-0000-0000-0000-000000000001'::uuid]);
  raise exception 'anon called profile_cards';
exception when insufficient_privilege then
  null;
end
$$;

-- 2–4. Ada sees a card for each related person; fields come from the profile, and
-- the name is public_name's output, never display_name.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into seen
select 'ada-all', c.*
from public.profile_cards(array[
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d',
  '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000009',
  '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f',
  '00000000-0000-0000-0000-000000000012'
]::uuid[]) c;

do $$
declare
  got uuid[];
  priya record;
  rex record;
begin
  select array_agg(s.id order by s.id) into got from seen s where s.step = 'ada-all';
  if got is distinct from array[
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000009',
    '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d',
    '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f',
    '00000000-0000-0000-0000-000000000012'
  ]::uuid[] then
    raise exception 'Ada should get one card per related person, got %', got;
  end if;

  select * into priya from seen s
  where s.step = 'ada-all' and s.id = '00000000-0000-0000-0000-000000000001';
  if priya.public_name is distinct from 'Priya S.' then
    raise exception 'Priya''s card should read ''Priya S.'', got %', priya.public_name;
  end if;
  if priya.role is distinct from 'driver' or priya.ride_prefs is distinct from '{quiet}'::text[]
     or priya.vetted is distinct from true then
    raise exception 'Priya''s card has the wrong fields: %', priya;
  end if;

  select * into rex from seen s
  where s.step = 'ada-all' and s.id = '00000000-0000-0000-0000-000000000003';
  if rex.vetted is distinct from false or rex.ride_prefs is distinct from '{quiet,smoke_free}'::text[] then
    raise exception 'Rex''s card has the wrong fields: %', rex;
  end if;
end
$$;

-- 2 (as admin). Every returned name equals public_name(display_name), and none is
-- the raw display_name where the two differ.
select tests.as_admin();
do $$
begin
  if exists (
    select 1 from seen s join public.profiles p on p.id = s.id
    where s.public_name is distinct from public.public_name(p.display_name)
       or s.role is distinct from p.role
       or s.ride_prefs is distinct from p.ride_prefs
       or s.vetted is distinct from (p.vetted_at is not null)
  ) then
    raise exception 'A card doesn''t match its profile through public_name';
  end if;
  if exists (
    select 1 from seen s join public.profiles p on p.id = s.id
    where s.public_name = p.display_name
      and p.display_name <> public.public_name(p.display_name)
  ) then
    raise exception 'A card leaked a raw display_name';
  end if;
end
$$;

-- 4. From the other side: each related person gets Ada's card, 'Ada L.'.
do $$
declare
  other text;
  got record;
  n integer;
begin
  foreach other in array array['01','02','03','04','05','06','08','09','0c','0d','0e','0f','12'] loop
    perform tests.as_user(('00000000-0000-0000-0000-0000000000' || other)::uuid);
    select count(*) into n
    from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
    select * into got
    from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
    if n <> 1 or got.public_name is distinct from 'Ada L.' or got.role is distinct from 'passenger'
       or got.ride_prefs is distinct from '{smoke_free}'::text[] or got.vetted is distinct from false then
      raise exception '% should get Ada''s card once as ''Ada L.'', got % rows: %', other, n, got;
    end if;
  end loop;
  perform tests.as_admin();
end
$$;

-- 4–5. Status never changes visibility. The card is identical for every invitation
-- status (both directions), ride status and Crew status.
do $$
declare
  st text;
  baseline record;
  got record;
  n integer;
begin
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  select * into baseline
  from public.profile_cards(array['00000000-0000-0000-0000-000000000001'::uuid]);

  foreach st in array array['pending','declined','expired','accepted','cancelled'] loop
    perform tests.as_admin();
    update public.invitations set status = st
    where id in ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');

    perform tests.as_user('00000000-0000-0000-0000-00000000000a');
    select * into got
    from public.profile_cards(array['00000000-0000-0000-0000-000000000001'::uuid]);
    if got is distinct from baseline then
      raise exception 'Priya''s card changed with invitation status %: % vs %', st, got, baseline;
    end if;
    select count(*) into n
    from public.profile_cards(array['00000000-0000-0000-0000-000000000002'::uuid]);
    if n <> 1 then
      raise exception 'Ivy''s card should show with invitation status %', st;
    end if;

    perform tests.as_user('00000000-0000-0000-0000-000000000001');
    select count(*) into n
    from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
    if n <> 1 then
      raise exception 'Priya should see Ada''s card with invitation status %', st;
    end if;
  end loop;

  foreach st in array array['confirmed','completed','cancelled'] loop
    perform tests.as_admin();
    update public.rides set status = st
    where id in ('40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004');

    perform tests.as_user('00000000-0000-0000-0000-00000000000a');
    select count(*) into n
    from public.profile_cards(array['00000000-0000-0000-0000-000000000003',
                                    '00000000-0000-0000-0000-000000000004']::uuid[]);
    if n <> 2 then
      raise exception 'Rex''s and Pat''s cards should show with ride status %, got %', st, n;
    end if;
  end loop;

  foreach st in array array['proposed','active','paused','ended','not_started'] loop
    perform tests.as_admin();
    update public.commute_crews set status = st
    where id in ('50000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-00000000000d');

    perform tests.as_user('00000000-0000-0000-0000-00000000000a');
    select count(*) into n
    from public.profile_cards(array['00000000-0000-0000-0000-000000000006',
                                    '00000000-0000-0000-0000-00000000000d']::uuid[]);
    if n <> 2 then
      raise exception 'Cy''s and Dot''s cards should show with Crew status %, got %', st, n;
    end if;
  end loop;
  perform tests.as_admin();
end
$$;

-- 6. Feedback never changes visibility. Ada and Fay both say yes after their
-- completed ride, which connects them; then Fay says no, which removes the
-- connection. Ada still gets Fay's card through the ride.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.ride_feedback (ride_id, author_id, ride_again)
values ('40000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000a', 'yes');
select tests.as_user('00000000-0000-0000-0000-000000000012');
insert into public.ride_feedback (ride_id, author_id, ride_again)
values ('40000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012', 'yes');

select tests.as_admin();
do $$
begin
  if not exists (
    select 1 from public.connections
    where user_low = '00000000-0000-0000-0000-00000000000a'
      and user_high = '00000000-0000-0000-0000-000000000012'
  ) then
    raise exception 'Setup: yes/yes should connect Ada and Fay';
  end if;
end
$$;

select tests.as_user('00000000-0000-0000-0000-000000000012');
update public.ride_feedback set ride_again = 'no'
where ride_id = '40000000-0000-0000-0000-000000000012'
  and author_id = '00000000-0000-0000-0000-000000000012';

select tests.as_admin();
do $$
declare
  n integer;
begin
  if exists (
    select 1 from public.connections
    where user_low = '00000000-0000-0000-0000-00000000000a'
      and user_high = '00000000-0000-0000-0000-000000000012'
  ) then
    raise exception 'Setup: Fay''s no should remove the connection';
  end if;
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000012'::uuid]);
  if n <> 1 then
    raise exception 'A "no" must not hide Fay''s card (it would reveal the answer)';
  end if;
  perform tests.as_admin();
end
$$;

-- 7. Unrelated, unknown and mixed input.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  got uuid[];
  n integer;
begin
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000007'::uuid]);
  if n <> 0 then
    raise exception 'Ada must not get unrelated Uma''s card';
  end if;
  select count(*) into n
  from public.profile_cards(array['99999999-0000-0000-0000-000000000000'::uuid]);
  if n <> 0 then
    raise exception 'An unknown id must return no card';
  end if;
  select count(*) into n from public.profile_cards(null);
  if n <> 0 then
    raise exception 'A null array must return no card';
  end if;
  select count(*) into n from public.profile_cards('{}'::uuid[]);
  if n <> 0 then
    raise exception 'An empty array must return no card';
  end if;
  -- Gil and Hal share invitations and nothing else with Ada's rides.
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000010',
                                  '00000000-0000-0000-0000-000000000011']::uuid[]);
  if n <> 0 then
    raise exception 'The control pair is unrelated to Ada';
  end if;

  select array_agg(c.id) into got
  from public.profile_cards(array[
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000007',
    '99999999-0000-0000-0000-000000000000',
    null,
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-00000000000a'
  ]::uuid[]) c;
  if got is distinct from array['00000000-0000-0000-0000-000000000001']::uuid[] then
    raise exception 'Mixed input should return only Priya, once (never Ada herself), got %', got;
  end if;
end
$$;

-- 8–10. Block both ways, suspend Sue, delete Del.
select tests.as_admin();
do $$
declare
  n integer;
begin
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000008',
                                  '00000000-0000-0000-0000-000000000009',
                                  '00000000-0000-0000-0000-00000000000e',
                                  '00000000-0000-0000-0000-00000000000f']::uuid[]);
  if n <> 4 then
    raise exception 'Setup: Bo, Bix, Sue and Del should be visible before the changes, got %', n;
  end if;
  perform tests.as_admin();
end
$$;

insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000008'),
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000a');
update public.profiles set suspended_at = now()
where id = '00000000-0000-0000-0000-00000000000e';
delete from auth.users where id = '00000000-0000-0000-0000-00000000000f';

do $$
begin
  if not exists (
    select 1 from public.rides
    where id = '40000000-0000-0000-0000-00000000000f'
      and driver_id = '00000000-0000-0000-0000-00000000000a'
      and passenger_id is null
  ) then
    raise exception 'Setup: Ada should keep her ride with Del as "Former member"';
  end if;
end
$$;

-- 12. Blocked (either way), suspended, deleted, unrelated and unknown all look the
-- same to Ada: no row, no error.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  other uuid;
  n integer;
begin
  foreach other in array array[
    '00000000-0000-0000-0000-000000000008',  -- Ada blocked Bo
    '00000000-0000-0000-0000-000000000009',  -- Bix blocked Ada
    '00000000-0000-0000-0000-00000000000e',  -- Sue suspended
    '00000000-0000-0000-0000-00000000000f',  -- Del deleted
    '00000000-0000-0000-0000-000000000007',  -- unrelated
    '99999999-0000-0000-0000-000000000000'   -- unknown
  ]::uuid[] loop
    select count(*) into n from public.profile_cards(array[other]);
    if n <> 0 then
      raise exception 'Ada must get no card for %', other;
    end if;
  end loop;
end
$$;

-- 8. Neither side of a block sees the other.
do $$
declare
  other text;
  n integer;
begin
  foreach other in array array['08','09'] loop
    perform tests.as_user(('00000000-0000-0000-0000-0000000000' || other)::uuid);
    select count(*) into n
    from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
    if n <> 0 then
      raise exception '% must not see Ada''s card across a block', other;
    end if;
  end loop;
end
$$;

-- 9. A suspended caller gets nothing, even for an active, related member.
select tests.as_user('00000000-0000-0000-0000-00000000000e');
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
  if n <> 0 then
    raise exception 'A suspended caller must get no cards';
  end if;
end
$$;

-- 11. A signed-in role with no user id gets nothing.
select set_config('role', 'authenticated', true), set_config('request.jwt.claim.sub', '', true);
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000001'::uuid]);
  if n <> 0 then
    raise exception 'A call with no user id must return no cards';
  end if;
end
$$;

-- 8–9. Unblocking and clearing a suspension make the cards visible again (they're
-- computed on every call); neither restores a connection or Crew.
select tests.as_admin();
delete from public.blocks
where blocker_id = '00000000-0000-0000-0000-00000000000a'
  and blocked_id = '00000000-0000-0000-0000-000000000008';
update public.profiles set suspended_at = null
where id = '00000000-0000-0000-0000-00000000000e';

do $$
declare
  n integer;
begin
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000008',
                                  '00000000-0000-0000-0000-00000000000e']::uuid[]);
  if n <> 2 then
    raise exception 'After unblocking and unsuspending, Ada should see Bo and Sue, got %', n;
  end if;
  -- Bix's block on Ada is still there.
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-000000000009'::uuid]);
  if n <> 0 then
    raise exception 'Bix''s block must still hide the card';
  end if;

  perform tests.as_user('00000000-0000-0000-0000-000000000008');
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
  if n <> 1 then
    raise exception 'After the unblock, Bo should see Ada''s card';
  end if;

  perform tests.as_user('00000000-0000-0000-0000-00000000000e');
  select count(*) into n
  from public.profile_cards(array['00000000-0000-0000-0000-00000000000a'::uuid]);
  if n <> 1 then
    raise exception 'After the suspension is cleared, Sue should see Ada''s card';
  end if;
  perform tests.as_admin();
end
$$;

-- 13. Batch limit: 100 distinct ids work, 101 raise 22023, and nulls and duplicates
-- don't count toward it.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  hundred uuid[] := array(select gen_random_uuid() from generate_series(1, 100));
  n integer;
begin
  select count(*) into n from public.profile_cards(hundred);
  if n <> 0 then
    raise exception '100 unknown ids should return no cards';
  end if;

  select count(*) into n
  from public.profile_cards(hundred || array[hundred[1], null]::uuid[]);
  if n <> 0 then
    raise exception '100 distinct ids plus a duplicate and a null should work';
  end if;

  begin
    perform * from public.profile_cards(hundred || gen_random_uuid());
    raise exception 'profile_cards accepted 101 ids';
  exception when invalid_parameter_value then
    null;
  end;
end
$$;

-- The same limit error for a suspended caller (nothing about the caller is revealed).
select tests.as_admin();
update public.profiles set suspended_at = now()
where id = '00000000-0000-0000-0000-00000000000e';
select tests.as_user('00000000-0000-0000-0000-00000000000e');
do $$
begin
  perform * from public.profile_cards(array(select gen_random_uuid() from generate_series(1, 101)));
  raise exception 'profile_cards accepted 101 ids from a suspended caller';
exception when invalid_parameter_value then
  null;
end
$$;

rollback;

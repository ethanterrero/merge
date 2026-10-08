-- Member status: suspension, vetting and the public-name helper (M-56).
-- Spec: docs/superpowers/specs/2026-10-08-member-status-design.md, "Testing".
--
-- People:
--   Ada 0a, Bea 0b, Dan 0d   members who share things with Sam
--   Sam 0c                   suspended in section 6 (sits between the others, so he
--                            is user_high in pairs with Ada and Bea, user_low with Dan)
--   Eve 0e                   vetted driver
--   Fay 0f                   creates her profile during the test
--   Gil 10 + Hal 11          control pair, never touched by Sam's suspension
-- Ride completion is not implemented yet (D-01), so rides are set up as admin.
-- Ride dates are relative to today in America/Los_Angeles, the pilot's zone.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'sam@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.test'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.test'),
  ('00000000-0000-0000-0000-00000000000f', 'fay@example.test'),
  ('00000000-0000-0000-0000-000000000010', 'gil@example.test'),
  ('00000000-0000-0000-0000-000000000011', 'hal@example.test');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada Lovelace', 'passenger'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver'),
  ('00000000-0000-0000-0000-00000000000c', 'Sam S.', 'both'),
  ('00000000-0000-0000-0000-00000000000d', 'Dan D.', 'driver'),
  ('00000000-0000-0000-0000-00000000000e', 'Eve E.', 'driver'),
  ('00000000-0000-0000-0000-000000000010', 'Gil G.', 'passenger'),
  ('00000000-0000-0000-0000-000000000011', 'Hal H.', 'driver');

-- 1. Privileges. Checked directly, so a missing revoke can't hide behind anything.
do $$
declare
  f text;
begin
  -- Status helpers would tell any caller who is suspended or vetted, and whether
  -- an id exists. Later features call them from their own security definer RPCs.
  foreach f in array array[
    'public.is_active(uuid)',
    'public.is_vetted(uuid)',
    'public.withdraw_member(uuid)',
    'public.profiles_guard_status()',
    'public.profiles_withdraw_suspended()',
    'public.connections_skip_suspended()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'Clients can call %', f;
    end if;
  end loop;

  -- public_name is a pure formatting rule; signed-in clients may call it.
  if not has_function_privilege('authenticated', 'public.public_name(text)', 'EXECUTE') then
    raise exception 'Signed-in members should be able to call public_name';
  end if;
  if has_function_privilege('anon', 'public.public_name(text)', 'EXECUTE') then
    raise exception 'anon can call public_name';
  end if;

  if (select prosecdef from pg_catalog.pg_proc where oid = 'public.is_active(uuid)'::regprocedure) is not true
     or (select prosecdef from pg_catalog.pg_proc where oid = 'public.is_vetted(uuid)'::regprocedure) is not true then
    raise exception 'is_active and is_vetted must be security definer';
  end if;
  -- The guard reads current_user, so it must run as the caller.
  if (select prosecdef from pg_catalog.pg_proc
      where oid = 'public.profiles_guard_status()'::regprocedure) is not false then
    raise exception 'profiles_guard_status must not be security definer';
  end if;
end
$$;

select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
begin
  perform public.is_active('00000000-0000-0000-0000-00000000000c');
  raise exception 'A signed-in member called is_active';
exception when insufficient_privilege then
  null;
end
$$;
do $$
begin
  perform public.is_vetted('00000000-0000-0000-0000-00000000000e');
  raise exception 'A signed-in member called is_vetted';
exception when insufficient_privilege then
  null;
end
$$;

-- 2. Clients can't write suspended_at or vetted_at, not even on their own row.
-- 2a. Fay can't create her profile already vetted or suspended.
select tests.as_user('00000000-0000-0000-0000-00000000000f');
do $$
begin
  begin
    insert into public.profiles (id, display_name, vetted_at)
    values ('00000000-0000-0000-0000-00000000000f', 'Fay F.', now());
    raise exception 'Fay created her profile with vetted_at set';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.profiles (id, display_name, suspended_at)
    values ('00000000-0000-0000-0000-00000000000f', 'Fay F.', now());
    raise exception 'Fay created her profile with suspended_at set';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 2b. Explicit nulls are fine (a rejection fails this file).
insert into public.profiles (id, display_name, role, suspended_at, vetted_at)
values ('00000000-0000-0000-0000-00000000000f', 'Fay F.', 'driver', null, null);

-- 2c. Ada can't set either flag on her own row, with or without a WHERE clause.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
begin
  begin
    update public.profiles set vetted_at = now() where id = auth.uid();
    raise exception 'Ada vetted herself';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set vetted_at = now();
    raise exception 'Ada vetted herself (unfiltered update)';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set suspended_at = now() where id = auth.uid();
    raise exception 'Ada set her own suspended_at';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.profiles (id, display_name, role, vetted_at)
    values ('00000000-0000-0000-0000-00000000000a', 'Ada A.', 'passenger', now())
    on conflict (id) do update set vetted_at = excluded.vetted_at;
    raise exception 'Ada vetted herself through an upsert';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 2d. Owner (here: admin, standing in for the service role) vets Eve.
select tests.as_admin();
update public.profiles set vetted_at = '2026-10-01 17:00+00'
where id = '00000000-0000-0000-0000-00000000000e';

-- 2e. Eve can read her own flag, but can't clear or move it.
select tests.as_user('00000000-0000-0000-0000-00000000000e');
do $$
begin
  if (select vetted_at from public.profiles where id = auth.uid())
     is distinct from '2026-10-01 17:00+00'::timestamptz then
    raise exception 'Eve should see her own vetted_at';
  end if;
  begin
    update public.profiles set vetted_at = null where id = auth.uid();
    raise exception 'Eve cleared her vetted_at';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.profiles set vetted_at = now() where id = auth.uid();
    raise exception 'Eve moved her vetted_at';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 2f. Ordinary edits still work while a flag is set, including the app's upsert
-- (id, display_name, role) and a statement that writes the flag's current value.
insert into public.profiles (id, display_name, role)
values ('00000000-0000-0000-0000-00000000000e', 'Eve Evans', 'driver')
on conflict (id) do update set display_name = excluded.display_name, role = excluded.role;
update public.profiles set vetted_at = vetted_at, discovery_opt_in = true where id = auth.uid();

do $$
begin
  if (select display_name from public.profiles where id = auth.uid()) is distinct from 'Eve Evans'
     or (select discovery_opt_in from public.profiles where id = auth.uid()) is not true
     or (select vetted_at from public.profiles where id = auth.uid())
        is distinct from '2026-10-01 17:00+00'::timestamptz then
    raise exception 'Eve''s ordinary edits should apply and leave vetted_at alone';
  end if;
end
$$;

-- 3. is_active and is_vetted (as admin; clients can't call them).
select tests.as_admin();
do $$
begin
  if public.is_active('00000000-0000-0000-0000-00000000000a') is not true then
    raise exception 'Ada should be active';
  end if;
  if public.is_active(null) is not false then
    raise exception 'is_active(null) should be false';
  end if;
  if public.is_active('00000000-0000-0000-0000-0000000000ff') is not false then
    raise exception 'is_active of an unknown id should be false';
  end if;
  if public.is_vetted('00000000-0000-0000-0000-00000000000e') is not true then
    raise exception 'Eve should be vetted';
  end if;
  if public.is_vetted('00000000-0000-0000-0000-00000000000b') is not false then
    raise exception 'Bea is not vetted';
  end if;
  if public.is_vetted(null) is not false
     or public.is_vetted('00000000-0000-0000-0000-0000000000ff') is not false then
    raise exception 'is_vetted of null or an unknown id should be false';
  end if;
end
$$;

-- 4. public_name: first word plus the last word's initial.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('Priya Sharma', 'Priya S.'),
      ('Priya', 'Priya'),
      ('  Priya   Sharma  ', 'Priya S.'),
      ('Priya Devi Sharma', 'Priya S.'),
      ('priya sharma', 'priya S.'),
      ('Priya S.', 'Priya S.'),
      (E'Priya\tSharma\n', 'Priya S.'),
      ('Mary-Jane O''Neil', 'Mary-Jane O.'),
      ('Priya (Sharma)', 'Priya S.'),
      ('Priya ...', 'Priya'),
      ('Zoë Ångström', 'Zoë Å.'),
      ('   ', null),
      ('', null),
      (null, null)
    ) as t(input, expected)
  loop
    if public.public_name(c.input) is distinct from c.expected then
      raise exception 'public_name(%) = %, expected %',
        coalesce(quote_literal(c.input), 'null'),
        coalesce(quote_literal(public.public_name(c.input)), 'null'),
        coalesce(quote_literal(c.expected), 'null');
    end if;
  end loop;
end
$$;

-- A signed-in member can call it on their own name.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
begin
  if (select public.public_name(display_name) from public.profiles where id = auth.uid())
     is distinct from 'Ada L.' then
    raise exception 'Ada''s public name should be Ada L.';
  end if;
end
$$;

-- 5. Setup for suspension: everything Sam shares with others, plus a control pair.
select tests.as_admin();

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-00000000000b',
  'driver',
  'SRID=4326;POINT(-122.2830 37.7650)',
  'SRID=4326;POINT(-122.3990 37.7890)',
  '07:30',
  '{1,2,3,4}',
  1
);

create temporary table today_la as
  select (now() at time zone 'America/Los_Angeles')::date as d;

-- i1..i9: invitations. Pending ones with Sam (i2 sent, i3 received) must be withdrawn;
-- i4 declined and the accepted ones stay; i5 is the control pair's and stays pending.
insert into public.invitations (id, sender_id, recipient_id, commute_id, status, ride_date)
select v.id::uuid, v.sender::uuid, v.recipient::uuid, '30000000-0000-0000-0000-000000000001', v.status, t.d + v.offset_days
from today_la t, (values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'accepted', -10),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b', 'pending', 5),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', 'pending', 6),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'declined', 4),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', 'pending', 5),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', 'accepted', 0),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'accepted', 7),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', 'accepted', -3),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', 'accepted', 7)
) as v(id, sender, recipient, status, offset_days);

-- r1 Ada+Sam completed 10 days ago. r6 Sam+Dan today and r7 Bea+Sam next week are
-- confirmed and must be cancelled. r8 Dan+Sam 3 days ago is still confirmed (awaiting
-- completion) and stays. r9 is the control pair's and stays.
insert into public.rides (id, invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind, completed_at)
select v.id::uuid, v.inv::uuid, v.driver::uuid, v.passenger::uuid, t.d + v.offset_days, '07:30', v.status, v.kind,
       case when v.status = 'completed' then now() end
from today_la t, (values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', -10, 'completed', 'first_ride'),
  ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', 0, 'confirmed', 'first_ride'),
  ('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 7, 'confirmed', 'ride_again'),
  ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', -3, 'confirmed', 'first_ride'),
  ('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', 7, 'confirmed', 'first_ride')
) as v(id, inv, driver, passenger, offset_days, status, kind);

-- Ada and Sam connect the real way: yes + yes on r1, then an active Crew via the RPCs.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-00000000000c');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'great', 'yes');

select tests.as_user('00000000-0000-0000-0000-00000000000a');
select public.propose_crew('00000000-0000-0000-0000-00000000000c', array[1, 2, 3], '07:30');
select tests.as_user('00000000-0000-0000-0000-00000000000c');
select public.respond_to_crew(
  (select id from public.commute_crews where status = 'proposed'), true);

select tests.as_admin();
insert into public.commute_crews (id, user_low, user_high, proposed_by, weekdays, departure_time, status, responded_at, ended_at) values
  -- Ada+Sam history: an ended Crew and a not_started one stay exactly as they are.
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', '{1}', '07:30', 'ended', '2026-09-01 08:00+00', '2026-09-15 08:00+00'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', '{2}', '07:30', 'not_started', '2026-09-20 08:00+00', null),
  -- Bea+Sam paused, Sam+Dan proposed: both end.
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b', '{3}', '08:00', 'paused', '2026-09-20 08:00+00', null),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d', '{1,2}', '07:45', 'proposed', null, null),
  -- Control pair: active, stays.
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', '{4}', '08:15', 'active', '2026-09-20 08:00+00', null);

insert into public.connections (user_low, user_high, crew_eligible) values
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', true),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', true),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', true);

do $$
begin
  if (select count(*) from public.connections
      where '00000000-0000-0000-0000-00000000000c' in (user_low, user_high)) <> 3 then
    raise exception 'Setup: Sam should have three connections';
  end if;
  if (select count(*) from public.commute_crews
      where '00000000-0000-0000-0000-00000000000c' in (user_low, user_high)
        and status in ('proposed','active','paused')) <> 3 then
    raise exception 'Setup: Sam should have three open Crews';
  end if;
end
$$;

-- 6. The owner suspends Sam.
update public.profiles set suspended_at = now()
where id = '00000000-0000-0000-0000-00000000000c';

do $$
declare
  sam constant uuid := '00000000-0000-0000-0000-00000000000c';
begin
  if public.is_active(sam) is not false then
    raise exception 'Sam should no longer be active';
  end if;
  if public.is_active('00000000-0000-0000-0000-00000000000a') is not true then
    raise exception 'Ada should still be active';
  end if;

  -- Invitations: only Sam's pending ones are withdrawn, in both directions.
  if (select string_agg(id::text || '=' || status, ',' order by id) from public.invitations) is distinct from
     '20000000-0000-0000-0000-000000000001=accepted,'
     '20000000-0000-0000-0000-000000000002=cancelled,'
     '20000000-0000-0000-0000-000000000003=cancelled,'
     '20000000-0000-0000-0000-000000000004=declined,'
     '20000000-0000-0000-0000-000000000005=pending,'
     '20000000-0000-0000-0000-000000000006=accepted,'
     '20000000-0000-0000-0000-000000000007=accepted,'
     '20000000-0000-0000-0000-000000000008=accepted,'
     '20000000-0000-0000-0000-000000000009=accepted' then
    raise exception 'Unexpected invitation statuses after suspension: %',
      (select string_agg(id::text || '=' || status, ',' order by id) from public.invitations);
  end if;

  -- Rides: Sam's confirmed rides from today on are cancelled; past and others' stay.
  if (select string_agg(id::text || '=' || status, ',' order by id) from public.rides) is distinct from
     '10000000-0000-0000-0000-000000000001=completed,'
     '10000000-0000-0000-0000-000000000006=cancelled,'
     '10000000-0000-0000-0000-000000000007=cancelled,'
     '10000000-0000-0000-0000-000000000008=confirmed,'
     '10000000-0000-0000-0000-000000000009=confirmed' then
    raise exception 'Unexpected ride statuses after suspension: %',
      (select string_agg(id::text || '=' || status, ',' order by id) from public.rides);
  end if;

  -- Connections: all of Sam's are gone, the control pair's stays.
  if exists (select 1 from public.connections where sam in (user_low, user_high)) then
    raise exception 'Sam still has a connection';
  end if;
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-000000000010'
                   and user_high = '00000000-0000-0000-0000-000000000011') then
    raise exception 'The control pair lost its connection';
  end if;

  -- Crews: Sam's open Crews end now; history and the control pair are untouched.
  if exists (select 1 from public.commute_crews
             where sam in (user_low, user_high) and status in ('proposed','active','paused')) then
    raise exception 'Sam still has an open Crew';
  end if;
  if (select count(*) from public.commute_crews
      where sam in (user_low, user_high) and status = 'ended' and ended_at = now()) <> 3 then
    raise exception 'Sam''s three open Crews should have ended now';
  end if;
  if (select status || ':' || ended_at::text from public.commute_crews
      where id = '40000000-0000-0000-0000-000000000001')
     is distinct from 'ended:' || '2026-09-15 08:00+00'::timestamptz::text then
    raise exception 'An already-ended Crew was changed';
  end if;
  if (select status from public.commute_crews where id = '40000000-0000-0000-0000-000000000002')
     is distinct from 'not_started'
     or (select ended_at from public.commute_crews where id = '40000000-0000-0000-0000-000000000002') is not null then
    raise exception 'A not_started Crew was changed';
  end if;
  if (select status from public.commute_crews where id = '40000000-0000-0000-0000-000000000005')
     is distinct from 'active' then
    raise exception 'The control pair''s Crew was changed';
  end if;
end
$$;

-- 7. Nothing brings Sam back while he's suspended.
-- 7a. Ada edits her feedback on r1. resolve_connection re-runs and would upsert the
-- yes/yes connection; the write is skipped silently.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
update public.ride_feedback set experience = 'good'
where ride_id = '10000000-0000-0000-0000-000000000001' and author_id = auth.uid();

-- 7b. Neither side can propose a Crew.
do $$
begin
  perform public.propose_crew('00000000-0000-0000-0000-00000000000c', array[1], '07:30');
  raise exception 'Ada proposed a Crew to suspended Sam';
exception when insufficient_privilege then
  null;
end
$$;
select tests.as_user('00000000-0000-0000-0000-00000000000c');
do $$
begin
  perform public.propose_crew('00000000-0000-0000-0000-00000000000a', array[1], '07:30');
  raise exception 'Suspended Sam proposed a Crew';
exception when insufficient_privilege then
  null;
end
$$;

-- 7c. Sam can't lift his own suspension.
do $$
begin
  update public.profiles set suspended_at = null where id = auth.uid();
  raise exception 'Sam cleared his own suspension';
exception when insufficient_privilege then
  null;
end
$$;

-- 7d. A direct write to connections is skipped too.
select tests.as_admin();
insert into public.connections (user_low, user_high, crew_eligible)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', true);

do $$
begin
  if exists (select 1 from public.connections
             where '00000000-0000-0000-0000-00000000000c' in (user_low, user_high)) then
    raise exception 'A suspended member was reconnected';
  end if;
end
$$;

-- 8. Clearing the suspension restores nothing, but the guard lifts with it.
update public.profiles set suspended_at = null
where id = '00000000-0000-0000-0000-00000000000c';

do $$
begin
  if exists (select 1 from public.connections
             where '00000000-0000-0000-0000-00000000000c' in (user_low, user_high)) then
    raise exception 'Clearing the suspension restored a connection';
  end if;
  if (select status from public.invitations where id = '20000000-0000-0000-0000-000000000002')
     is distinct from 'cancelled'
     or (select status from public.rides where id = '10000000-0000-0000-0000-000000000007')
     is distinct from 'cancelled'
     or (select status from public.commute_crews
         where id = (select id from public.commute_crews
                     where user_low = '00000000-0000-0000-0000-00000000000a'
                       and user_high = '00000000-0000-0000-0000-00000000000c'
                       and proposed_by = '00000000-0000-0000-0000-00000000000a'
                       and weekdays = '{1,2,3}'))
     is distinct from 'ended' then
    raise exception 'Clearing the suspension restored an invitation, ride or Crew';
  end if;
  if public.is_active('00000000-0000-0000-0000-00000000000c') is not true then
    raise exception 'Sam should be active again';
  end if;
end
$$;

-- Once active again, a connection can be written (the guard depends on suspension).
insert into public.connections (user_low, user_high, crew_eligible)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', true);

do $$
begin
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-00000000000a'
                   and user_high = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'An active member''s connection was skipped';
  end if;
end
$$;

-- 9. A suspended member isn't vetted, even with vetted_at set.
update public.profiles set suspended_at = now()
where id = '00000000-0000-0000-0000-00000000000e';

do $$
begin
  if public.is_vetted('00000000-0000-0000-0000-00000000000e') is not false then
    raise exception 'A suspended member should not count as vetted';
  end if;
  if (select vetted_at from public.profiles where id = '00000000-0000-0000-0000-00000000000e') is null then
    raise exception 'Suspension should not clear vetted_at';
  end if;
end
$$;

rollback;

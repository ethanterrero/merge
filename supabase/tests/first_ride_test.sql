-- First Ride: private post-ride feedback, mutual Ride Again, Commute Crews.
-- Spec: docs/superpowers/specs/2026-10-08-first-ride-design.md, "Testing" 1–8.
--
-- People come in pairs, one pair per scenario:
--   Ada 0a + Bea 0b   yes + yes, then a Crew, then Bea changes to No   (1, 2, 5, 6)
--   Cal 0c + Dan 0d   yes + no                                         (3)
--   Eve 0e + Fay 0f   yes + no answer                                  (3)
--   Gil 10 + Hal 11   yes + individual                                 (4, 7, 8)
--   Ivy 12 + Jo  13   yes + yes, a proposed Crew                       (8, rule 4)
--   Kim 14 + Lu  15   two rides; the latest answer wins                (rule 1 regression)
-- Ride completion is not implemented yet (D-01), so rides are set up as admin.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cal@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.test'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.test'),
  ('00000000-0000-0000-0000-00000000000f', 'fay@example.test'),
  ('00000000-0000-0000-0000-000000000010', 'gil@example.test'),
  ('00000000-0000-0000-0000-000000000011', 'hal@example.test'),
  ('00000000-0000-0000-0000-000000000012', 'ivy@example.test'),
  ('00000000-0000-0000-0000-000000000013', 'jo@example.test'),
  ('00000000-0000-0000-0000-000000000014', 'kim@example.test'),
  ('00000000-0000-0000-0000-000000000015', 'lu@example.test');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada A.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver'),
  ('00000000-0000-0000-0000-00000000000c', 'Cal C.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000d', 'Dan D.', 'driver'),
  ('00000000-0000-0000-0000-00000000000e', 'Eve E.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000f', 'Fay F.', 'driver'),
  ('00000000-0000-0000-0000-000000000010', 'Gil G.', 'passenger'),
  ('00000000-0000-0000-0000-000000000011', 'Hal H.', 'driver'),
  ('00000000-0000-0000-0000-000000000012', 'Ivy I.', 'passenger'),
  ('00000000-0000-0000-0000-000000000013', 'Jo J.', 'driver'),
  ('00000000-0000-0000-0000-000000000014', 'Kim K.', 'passenger'),
  ('00000000-0000-0000-0000-000000000015', 'Lu L.', 'driver');

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

insert into public.invitations (id, sender_id, recipient_id, commute_id, status, ride_date) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-12'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-13'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-14'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-12'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-12'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-12'),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-12'),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-20'),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-13');

-- r1 Ada+Bea completed, r2 Ada+Bea confirmed, r3 Ada+Bea completed (cancelled in 2d),
-- r4 Cal+Dan, r5 Eve+Fay, r6 Gil+Hal, r7 Ivy+Jo, all completed.
-- r8 and r9 Kim+Lu, completed. r8 is answered first but has the later ride_date, so
-- the ride_date tie-breaker can't make the rule 1 regression test pass by accident.
insert into public.rides (id, invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind, completed_at) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-10-12', '07:30', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-10-13', '07:30', 'confirmed', 'ride_again', null),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-10-14', '07:30', 'completed', 'ride_again', now()),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', '2026-10-12', '07:45', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000000e', '2026-10-12', '08:00', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', '2026-10-12', '08:15', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000012', '2026-10-12', '08:30', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000014', '2026-10-20', '08:45', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000014', '2026-10-13', '08:45', 'completed', 'ride_again', now());

-- 1. Only the author can read their ride_feedback. The other rider gets zero rows.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'great', 'yes');

select tests.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'good', 'yes');

do $$
declare
  n integer;
begin
  if (select count(*) from public.ride_feedback) <> 1 then
    raise exception 'Bea should see exactly one feedback row (her own), saw %',
      (select count(*) from public.ride_feedback);
  end if;
  if exists (select 1 from public.ride_feedback where author_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'Bea can read Ada''s feedback on their shared ride';
  end if;
  -- No WHERE clause: only the UPDATE policy decides which rows are touched.
  update public.ride_feedback set experience = 'not_a_fit';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'An unfiltered feedback update by Bea should touch only her own row, but touched % rows', n;
  end if;
end
$$;

select tests.as_user('00000000-0000-0000-0000-00000000000c');
do $$
begin
  if (select count(*) from public.ride_feedback) <> 0 then
    raise exception 'Cal can read feedback he did not write';
  end if;
end
$$;

select tests.as_anon();
do $$
begin
  if (select count(*) from public.ride_feedback) <> 0 then
    raise exception 'anon can read ride feedback';
  end if;
end
$$;

select tests.as_admin();
do $$
begin
  if (select experience from public.ride_feedback
      where ride_id = '10000000-0000-0000-0000-000000000001'
        and author_id = '00000000-0000-0000-0000-00000000000a') is distinct from 'great' then
    raise exception 'Bea changed Ada''s feedback';
  end if;
end
$$;

-- 2. Feedback can't be submitted for a ride that isn't completed or that the author wasn't on.
select tests.as_user('00000000-0000-0000-0000-00000000000a');

-- 2a. r2 is confirmed, not completed.
do $$
begin
  begin
    insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
    values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'great', 'yes');
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'Ada submitted feedback for a ride that is not completed';
end
$$;

-- 2b. Ada answers for Bea, who was on r3 but has not answered.
do $$
begin
  begin
    insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
    values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', 'great', 'yes');
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'Ada submitted feedback as Bea';
end
$$;

-- 2c. Cal was not on r1.
select tests.as_user('00000000-0000-0000-0000-00000000000c');
do $$
begin
  begin
    insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'great', 'yes');
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'Cal submitted feedback for a ride he was not on';
end
$$;

-- 2d. Updating is submitting too: once r3 is no longer completed, Ada can't change
-- her feedback on it (an accepted insert first, so the row exists and she can see it).
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.ride_feedback (ride_id, author_id, experience)
values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'good');

select tests.as_admin();
update public.rides set status = 'cancelled', completed_at = null
where id = '10000000-0000-0000-0000-000000000003';

select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  n integer;
begin
  begin
    update public.ride_feedback set experience = 'great'
    where ride_id = '10000000-0000-0000-0000-000000000003';
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'Ada updated feedback on a ride that is not completed';
  end if;
end
$$;

select tests.as_admin();
do $$
begin
  if (select experience from public.ride_feedback
      where ride_id = '10000000-0000-0000-0000-000000000003'
        and author_id = '00000000-0000-0000-0000-00000000000a') is distinct from 'good' then
    raise exception 'Feedback on a cancelled ride changed';
  end if;
  if (select count(*) from public.ride_feedback) <> 3 then
    raise exception 'Expected 3 feedback rows (Ada r1, Bea r1, Ada r3), found %',
      (select count(*) from public.ride_feedback);
  end if;
end
$$;

-- 3. Yes + No -> no connection. Yes + (no answer) -> no connection. Both look identical to the client.
select tests.as_user('00000000-0000-0000-0000-00000000000c');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-00000000000d');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000d', 'good', 'no');

select tests.as_user('00000000-0000-0000-0000-00000000000e');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000e', 'great', 'yes');
-- Fay rates the ride but doesn't answer "ride again".
select tests.as_user('00000000-0000-0000-0000-00000000000f');
insert into public.ride_feedback (ride_id, author_id, experience)
values ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000f', 'good');

select tests.as_admin();
do $$
begin
  if exists (
    select 1 from public.connections
    where (user_low = '00000000-0000-0000-0000-00000000000c' and user_high = '00000000-0000-0000-0000-00000000000d')
       or (user_low = '00000000-0000-0000-0000-00000000000e' and user_high = '00000000-0000-0000-0000-00000000000f')
  ) then
    raise exception 'Yes + No or Yes + no answer created a connection';
  end if;
end
$$;

do $$
declare
  cal_view text;
  eve_view text;
begin
  perform tests.as_user('00000000-0000-0000-0000-00000000000c');
  cal_view := format('connections=%s partner_feedback=%s crews=%s',
    (select count(*) from public.connections),
    (select count(*) from public.ride_feedback where author_id <> auth.uid()),
    (select count(*) from public.commute_crews));

  perform tests.as_user('00000000-0000-0000-0000-00000000000e');
  eve_view := format('connections=%s partner_feedback=%s crews=%s',
    (select count(*) from public.connections),
    (select count(*) from public.ride_feedback where author_id <> auth.uid()),
    (select count(*) from public.commute_crews));

  perform tests.as_admin();
  if cal_view <> 'connections=0 partner_feedback=0 crews=0' then
    raise exception 'Cal, whose partner said No, sees %', cal_view;
  end if;
  if eve_view <> cal_view then
    raise exception 'No (%) and no answer (%) look different to the client', cal_view, eve_view;
  end if;
end
$$;

-- 4. Yes + Individual -> connection, crew_eligible = false.
select tests.as_user('00000000-0000-0000-0000-000000000010');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-000000000011');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000011', 'good', 'individual');

select tests.as_admin();
do $$
begin
  if (select crew_eligible from public.connections
      where user_low = '00000000-0000-0000-0000-000000000010'
        and user_high = '00000000-0000-0000-0000-000000000011') is distinct from false then
    raise exception 'Yes + Individual should create a connection with crew_eligible = false';
  end if;

  -- Both members see it.
  perform tests.as_user('00000000-0000-0000-0000-000000000010');
  if (select count(*) from public.connections where not crew_eligible) <> 1 then
    raise exception 'Gil should see his Ride Again connection';
  end if;
  perform tests.as_user('00000000-0000-0000-0000-000000000011');
  if (select count(*) from public.connections where not crew_eligible) <> 1 then
    raise exception 'Hal should see his Ride Again connection';
  end if;
  perform tests.as_admin();
end
$$;

-- 5. Yes + Yes -> connection, crew_eligible = true (Ada and Bea, from 1).
do $$
begin
  if (select crew_eligible from public.connections
      where user_low = '00000000-0000-0000-0000-00000000000a'
        and user_high = '00000000-0000-0000-0000-00000000000b') is distinct from true then
    raise exception 'Yes + Yes should create a connection with crew_eligible = true';
  end if;

  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  if (select count(*) from public.connections where crew_eligible) <> 1 then
    raise exception 'Ada should see her Crew-eligible connection';
  end if;
  -- Members only: Cal sees no one else's connections.
  perform tests.as_user('00000000-0000-0000-0000-00000000000c');
  if (select count(*) from public.connections) <> 0 then
    raise exception 'Cal can see connections he is not part of';
  end if;
  perform tests.as_admin();
end
$$;

-- 6. Changing an answer to No removes the connection and moves an active Crew to ended.
do $$
declare
  crew uuid;
  n integer;
begin
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  crew := public.propose_crew('00000000-0000-0000-0000-00000000000b', array[1, 2, 3, 4], '07:30');

  perform tests.as_user('00000000-0000-0000-0000-00000000000b');
  perform public.respond_to_crew(crew, true);
  if (select status from public.commute_crews where id = crew) is distinct from 'active' then
    raise exception 'Bea accepted, so the Crew should be active';
  end if;

  -- Either member can pause and resume.
  perform public.set_crew_status(crew, 'paused');
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  perform public.set_crew_status(crew, 'active');
  if (select status from public.commute_crews where id = crew) is distinct from 'active' then
    raise exception 'Ada should be able to resume the paused Crew';
  end if;
  -- A Crew can't go back to proposed.
  begin
    perform public.set_crew_status(crew, 'proposed');
    raise exception 'set_crew_status allowed active -> proposed';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_user('00000000-0000-0000-0000-00000000000b');
  update public.ride_feedback set ride_again = 'no'
  where ride_id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Bea should be able to change her answer, but % rows changed', n;
  end if;

  perform tests.as_admin();
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Changing an answer to No should remove the connection';
  end if;
  if (select status from public.commute_crews where id = crew) is distinct from 'ended'
     or (select ended_at from public.commute_crews where id = crew) is null then
    raise exception 'Changing an answer to No should end the active Crew';
  end if;

  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  if (select count(*) from public.connections) <> 0 then
    raise exception 'Ada still sees a connection after Bea said No';
  end if;
  perform tests.as_admin();
end
$$;

-- 7. Clients can't insert, update, or delete connections directly.
do $$
declare
  r text;
  p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(r, 'public.connections', p) then
        raise exception '% has % on connections', r, p;
      end if;
      -- Crews are written only through the RPCs, rides only by the booking API (later).
      if has_table_privilege(r, 'public.commute_crews', p) then
        raise exception '% has % on commute_crews', r, p;
      end if;
      if has_table_privilege(r, 'public.rides', p) then
        raise exception '% has % on rides', r, p;
      end if;
    end loop;
  end loop;
end
$$;

-- Gil is a member of the Gil+Hal connection (crew_eligible = false).
select tests.as_user('00000000-0000-0000-0000-000000000010');
do $$
declare
  n integer;
begin
  begin
    insert into public.connections (user_low, user_high, crew_eligible)
    values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000012', true);
    raise exception 'Gil inserted a connection';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.connections set crew_eligible = true;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'Gil updated % connection rows', n;
  end if;

  begin
    delete from public.connections;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'Gil deleted % connection rows', n;
  end if;
end
$$;

select tests.as_admin();
do $$
begin
  if (select crew_eligible from public.connections
      where user_low = '00000000-0000-0000-0000-000000000010'
        and user_high = '00000000-0000-0000-0000-000000000011') is distinct from false then
    raise exception 'Gil changed or removed the Gil+Hal connection';
  end if;
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-000000000010'
               and user_high = '00000000-0000-0000-0000-000000000012') then
    raise exception 'Gil created a Gil+Ivy connection';
  end if;
end
$$;

-- 8. propose_crew is refused without crew_eligible. respond_to_crew is refused for the proposer.
do $$
begin
  if not has_function_privilege('authenticated', 'public.propose_crew(uuid, integer[], time)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.respond_to_crew(uuid, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_crew_status(uuid, text)', 'EXECUTE') then
    raise exception 'Signed-in members should be able to call the Crew RPCs';
  end if;
  if has_function_privilege('anon', 'public.propose_crew(uuid, integer[], time)', 'EXECUTE')
     or has_function_privilege('anon', 'public.respond_to_crew(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_crew_status(uuid, text)', 'EXECUTE') then
    raise exception 'anon can call the Crew RPCs';
  end if;
  if has_function_privilege('anon', 'public.resolve_connection(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_connection(uuid, uuid)', 'EXECUTE') then
    raise exception 'Clients can call resolve_connection directly';
  end if;
end
$$;

-- 8a. Gil and Hal are connected, but not Crew-eligible. Cal and Dan aren't connected.
do $$
begin
  perform tests.as_user('00000000-0000-0000-0000-000000000010');
  begin
    perform public.propose_crew('00000000-0000-0000-0000-000000000011', array[1, 2], '08:15');
    raise exception 'Gil proposed a Crew without crew_eligible';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_user('00000000-0000-0000-0000-000000000011');
  begin
    perform public.propose_crew('00000000-0000-0000-0000-000000000010', array[1, 2], '08:15');
    raise exception 'Hal proposed a Crew without crew_eligible';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_user('00000000-0000-0000-0000-00000000000c');
  begin
    perform public.propose_crew('00000000-0000-0000-0000-00000000000d', array[1, 2], '07:45');
    raise exception 'Cal proposed a Crew without a connection';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_admin();
  if exists (select 1 from public.commute_crews
             where user_low in ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000000c')) then
    raise exception 'A refused proposal left a Crew behind';
  end if;
end
$$;

-- 8b. Ivy and Jo both say Yes. Ivy proposes and can't answer her own proposal.
select tests.as_user('00000000-0000-0000-0000-000000000012');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000012', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-000000000013');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000013', 'great', 'yes');

do $$
declare
  crew uuid;
begin
  perform tests.as_user('00000000-0000-0000-0000-000000000012');
  crew := public.propose_crew('00000000-0000-0000-0000-000000000013', array[2, 4], '08:30');

  begin
    perform public.respond_to_crew(crew, true);
    raise exception 'The proposer accepted her own Crew';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.respond_to_crew(crew, false);
    raise exception 'The proposer declined her own Crew';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_admin();
  if (select status from public.commute_crews where id = crew) is distinct from 'proposed' then
    raise exception 'The proposer''s response changed the Crew';
  end if;
end
$$;

-- Rule 4. Jo changes Yes to Individual: the connection stays, crew_eligible becomes
-- false, and the proposed Crew becomes not_started.
select tests.as_user('00000000-0000-0000-0000-000000000013');
update public.ride_feedback set ride_again = 'individual'
where ride_id = '10000000-0000-0000-0000-000000000007';

select tests.as_admin();
do $$
begin
  if (select crew_eligible from public.connections
      where user_low = '00000000-0000-0000-0000-000000000012'
        and user_high = '00000000-0000-0000-0000-000000000013') is distinct from false then
    raise exception 'Yes -> Individual should keep the connection with crew_eligible = false';
  end if;
  if (select status from public.commute_crews
      where user_low = '00000000-0000-0000-0000-000000000012'
        and user_high = '00000000-0000-0000-0000-000000000013') is distinct from 'not_started' then
    raise exception 'Losing crew_eligible should move a proposed Crew to not_started';
  end if;
end
$$;

-- Rule 1 regression: the most recent *answer* wins. Editing only the experience
-- (or dismissing) on an older ride must not bring back that ride's old answer.
-- Kim says No on r8, then Yes on r9; Lu says Yes on r9.
select tests.as_user('00000000-0000-0000-0000-000000000014');
-- The client-supplied ride_again_at is ignored: the server sets it.
insert into public.ride_feedback (ride_id, author_id, experience, ride_again, ride_again_at)
values ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000014', 'good', 'no', '2999-01-01');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000014', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-000000000015');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000015', 'great', 'yes');

select tests.as_admin();
do $$
begin
  if (select ride_again_at from public.ride_feedback
      where ride_id = '10000000-0000-0000-0000-000000000008'
        and author_id = '00000000-0000-0000-0000-000000000014') > now() + interval '1 day' then
    raise exception 'A client set ride_again_at';
  end if;
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-000000000014'
                   and user_high = '00000000-0000-0000-0000-000000000015') then
    raise exception 'Kim''s latest answer is Yes and Lu''s is Yes, so they should be connected';
  end if;
end
$$;

-- Kim edits only the experience, then dismisses, on r8. Her answer there doesn't change.
select tests.as_user('00000000-0000-0000-0000-000000000014');
update public.ride_feedback set experience = 'great'
where ride_id = '10000000-0000-0000-0000-000000000008';
update public.ride_feedback set dismissed_at = now()
where ride_id = '10000000-0000-0000-0000-000000000008';

select tests.as_admin();
do $$
begin
  if (select crew_eligible from public.connections
      where user_low = '00000000-0000-0000-0000-000000000014'
        and user_high = '00000000-0000-0000-0000-000000000015') is distinct from true then
    raise exception 'Editing only the experience on an older ride brought back its old No';
  end if;
end
$$;

-- Kim really answers No on r8 again. ride_again_at moves only when the answer
-- changes, so she clears it first (r9's Yes is then her only answer), then says No.
select tests.as_user('00000000-0000-0000-0000-000000000014');
update public.ride_feedback set ride_again = null
where ride_id = '10000000-0000-0000-0000-000000000008';

select tests.as_admin();
do $$
begin
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-000000000014'
                   and user_high = '00000000-0000-0000-0000-000000000015') then
    raise exception 'Clearing an older answer should leave the connection from the newer Yes';
  end if;
end
$$;

select tests.as_user('00000000-0000-0000-0000-000000000014');
update public.ride_feedback set ride_again = 'no'
where ride_id = '10000000-0000-0000-0000-000000000008';

select tests.as_admin();
do $$
begin
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-000000000014'
               and user_high = '00000000-0000-0000-0000-000000000015') then
    raise exception 'Changing r8''s answer to No (now the latest) should remove the connection';
  end if;
end
$$;

rollback;

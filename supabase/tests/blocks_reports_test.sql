-- Blocks and safety reports.
-- Spec: docs/superpowers/specs/2026-10-08-blocks-reports-design.md, "Testing".
--
-- People and what each pair starts with:
--   Ada 0a + Bea 0b   yes + yes on r1 -> connection, active Crew (via the RPCs),
--                     plus an old ended Crew and a not_started Crew. Ada blocks Bea.
--   Cal 0c + Dan 0d   connection, proposed Crew. Dan (user_high) blocks Cal.
--   Eve 0e + Fay 0f   connection, paused Crew. Eve blocks Fay.
--   Ada 0a + Cal 0c   connection, never blocked (same person, other pair).
--   Gil 10 + Hal 11   connection, active Crew, never blocked.
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
  ('00000000-0000-0000-0000-000000000011', 'hal@example.test');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada A.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver'),
  ('00000000-0000-0000-0000-00000000000c', 'Cal C.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000d', 'Dan D.', 'driver'),
  ('00000000-0000-0000-0000-00000000000e', 'Eve E.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000f', 'Fay F.', 'driver'),
  ('00000000-0000-0000-0000-000000000010', 'Gil G.', 'passenger'),
  ('00000000-0000-0000-0000-000000000011', 'Hal H.', 'driver');

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
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '30000000-0000-0000-0000-000000000001', 'accepted', '2026-10-12');

-- r1 Ada+Bea completed. r2 Ada+Bea confirmed (completed after the block). r3 Cal+Dan completed.
insert into public.rides (id, invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind, completed_at) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-10-12', '07:30', 'completed', 'first_ride', now()),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-10-13', '07:30', 'confirmed', 'ride_again', null),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', '2026-10-12', '07:45', 'completed', 'first_ride', now());

-- Ada and Bea connect the real way: yes + yes, then an active Crew through the RPCs.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'great', 'yes');

select tests.as_user('00000000-0000-0000-0000-00000000000a');
select public.propose_crew('00000000-0000-0000-0000-00000000000b', array[1, 2, 3], '07:30');
select tests.as_user('00000000-0000-0000-0000-00000000000b');
select public.respond_to_crew(
  (select id from public.commute_crews where status = 'proposed'), true);

-- Everything else is set up directly.
select tests.as_admin();
insert into public.commute_crews (id, user_low, user_high, proposed_by, weekdays, departure_time, status, responded_at, ended_at) values
  -- Ada+Bea history: an ended Crew and a not_started one, both must stay as they are.
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '{1}', '07:30', 'ended', '2026-09-01 08:00+00', '2026-09-15 08:00+00'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', '{2}', '07:30', 'not_started', '2026-09-20 08:00+00', null),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c', '{1,2}', '07:45', 'proposed', null, null),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000000e', '{3}', '08:00', 'paused', '2026-09-20 08:00+00', null),
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', '{4}', '08:15', 'active', '2026-09-20 08:00+00', null);

insert into public.connections (user_low, user_high, crew_eligible) values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', true),
  ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', true),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', false),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', true);

do $$
begin
  if (select crew_eligible from public.connections
      where user_low = '00000000-0000-0000-0000-00000000000a'
        and user_high = '00000000-0000-0000-0000-00000000000b') is distinct from true then
    raise exception 'Setup: Ada and Bea should be connected and Crew-eligible';
  end if;
  if (select count(*) from public.commute_crews
      where user_low = '00000000-0000-0000-0000-00000000000a'
        and user_high = '00000000-0000-0000-0000-00000000000b'
        and status = 'active') <> 1 then
    raise exception 'Setup: Ada and Bea should have one active Crew';
  end if;
end
$$;

-- 1. Privileges. Checked directly, so RLS default-deny can't hide a missing revoke.
do $$
declare
  t text;
  p text;
  c text;
begin
  foreach t in array array['public.blocks', 'public.safety_reports'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('anon', t, p) then
        raise exception 'anon has % on %', p, t;
      end if;
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege('anon', t, p) then
        raise exception 'anon has column-level % on %', p, t;
      end if;
    end loop;
  end loop;

  -- blocks: the blocker reads, inserts (two columns) and deletes. Nothing else.
  if not has_table_privilege('authenticated', 'public.blocks', 'SELECT')
     or not has_table_privilege('authenticated', 'public.blocks', 'DELETE') then
    raise exception 'Signed-in members should be able to read and delete their blocks';
  end if;
  foreach p in array array['UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.blocks', p) then
      raise exception 'authenticated has % on blocks', p;
    end if;
  end loop;
  if has_any_column_privilege('authenticated', 'public.blocks', 'UPDATE')
     or has_any_column_privilege('authenticated', 'public.blocks', 'REFERENCES') then
    raise exception 'authenticated has column-level UPDATE or REFERENCES on blocks';
  end if;
  if has_table_privilege('authenticated', 'public.blocks', 'INSERT')
     or has_column_privilege('authenticated', 'public.blocks', 'created_at', 'INSERT') then
    raise exception 'Clients can write blocks.created_at';
  end if;
  foreach c in array array['blocker_id', 'blocked_id'] loop
    if not has_column_privilege('authenticated', 'public.blocks', c, 'INSERT') then
      raise exception 'authenticated can''t insert blocks.%', c;
    end if;
  end loop;

  -- safety_reports: insert only, on the five client columns.
  foreach p in array array['SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('authenticated', 'public.safety_reports', p) then
      raise exception 'authenticated has % on safety_reports', p;
    end if;
  end loop;
  foreach p in array array['SELECT', 'UPDATE', 'REFERENCES'] loop
    if has_any_column_privilege('authenticated', 'public.safety_reports', p) then
      raise exception 'authenticated has column-level % on safety_reports', p;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.safety_reports', 'INSERT')
     or has_column_privilege('authenticated', 'public.safety_reports', 'id', 'INSERT')
     or has_column_privilege('authenticated', 'public.safety_reports', 'created_at', 'INSERT') then
    raise exception 'Clients can write safety_reports.id or created_at';
  end if;
  foreach c in array array['reporter_id', 'reported_user_id', 'ride_id', 'category', 'details'] loop
    if not has_column_privilege('authenticated', 'public.safety_reports', c, 'INSERT') then
      raise exception 'authenticated can''t insert safety_reports.%', c;
    end if;
  end loop;

  -- is_blocked would tell a blocked person who blocked them, so clients can't call it.
  if has_function_privilege('anon', 'public.is_blocked(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.is_blocked(uuid, uuid)', 'EXECUTE') then
    raise exception 'Clients can call is_blocked';
  end if;
  if has_function_privilege('anon', 'public.blocks_end_pair()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.blocks_end_pair()', 'EXECUTE')
     or has_function_privilege('anon', 'public.connections_skip_blocked()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.connections_skip_blocked()', 'EXECUTE') then
    raise exception 'Clients can call the block trigger functions';
  end if;
end
$$;

-- 2. Ada blocks Bea and manages her own block.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');

do $$
begin
  if (select count(*) from public.blocks) <> 1
     or not exists (select 1 from public.blocks
                    where blocker_id = '00000000-0000-0000-0000-00000000000a'
                      and blocked_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Ada should see exactly her block of Bea';
  end if;

  -- Duplicate: rejected.
  begin
    insert into public.blocks (blocker_id, blocked_id)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
    raise exception 'A duplicate block was accepted';
  exception when unique_violation then
    null;
  end;

  -- ...but the idempotent client path (upsert with ignoreDuplicates) works.
  insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')
  on conflict do nothing;
  if (select count(*) from public.blocks) <> 1 then
    raise exception 'on conflict do nothing left % blocks', (select count(*) from public.blocks);
  end if;

  -- Can't block yourself.
  begin
    insert into public.blocks (blocker_id, blocked_id)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');
    raise exception 'Ada blocked herself';
  exception when check_violation then
    null;
  end;

  -- Can't block on someone else's behalf.
  begin
    insert into public.blocks (blocker_id, blocked_id)
    values ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d');
    raise exception 'Ada inserted a block as Cal';
  exception when insufficient_privilege then
    null;
  end;

  -- Can't set created_at.
  begin
    insert into public.blocks (blocker_id, blocked_id, created_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', '2000-01-01');
    raise exception 'Ada set blocks.created_at';
  exception when insufficient_privilege then
    null;
  end;

  -- No update.
  begin
    update public.blocks set blocked_id = '00000000-0000-0000-0000-00000000000c';
    raise exception 'Ada updated a block';
  exception when insufficient_privilege then
    null;
  end;

  -- Clients can't call is_blocked.
  begin
    perform public.is_blocked('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
    raise exception 'Ada called is_blocked';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 3. Bea, the blocked person, can't see, change, remove or detect the block.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  n integer;
begin
  if (select count(*) from public.blocks) <> 0 then
    raise exception 'Bea can read Ada''s block of her';
  end if;

  delete from public.blocks;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Bea deleted % block rows she did not create', n;
  end if;

  begin
    update public.blocks set blocked_id = '00000000-0000-0000-0000-00000000000c';
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'Bea updated % block rows', n;
  end if;

  begin
    perform public.is_blocked('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');
    raise exception 'Bea called is_blocked';
  exception when insufficient_privilege then
    null;
  end;

  -- Ride Again is gone, exactly as after a No.
  if (select count(*) from public.connections) <> 0 then
    raise exception 'Bea still sees a connection with Ada';
  end if;
  if exists (select 1 from public.commute_crews where status in ('proposed', 'active', 'paused')) then
    raise exception 'Bea still sees an open Crew with Ada';
  end if;
end
$$;

-- 4. The block's effects, checked as admin.
select tests.as_admin();
do $$
begin
  if not exists (select 1 from public.blocks
                 where blocker_id = '00000000-0000-0000-0000-00000000000a'
                   and blocked_id = '00000000-0000-0000-0000-00000000000b'
                   and created_at is not null) then
    raise exception 'Ada''s block is missing after Bea''s attempts';
  end if;

  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'A block should delete the pair''s connection';
  end if;
  if exists (select 1 from public.commute_crews
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b'
               and status in ('proposed', 'active', 'paused')) then
    raise exception 'A block should end the pair''s active Crew';
  end if;
  if (select count(*) from public.commute_crews
      where user_low = '00000000-0000-0000-0000-00000000000a'
        and user_high = '00000000-0000-0000-0000-00000000000b'
        and status = 'ended' and ended_at = now()) <> 1 then
    raise exception 'The active Crew should be ended with ended_at = now()';
  end if;
  if (select ended_at from public.commute_crews where id = '40000000-0000-0000-0000-000000000001')
     is distinct from '2026-09-15 08:00+00'::timestamptz then
    raise exception 'A block changed an already ended Crew';
  end if;
  if (select status || coalesce(ended_at::text, '-') from public.commute_crews
      where id = '40000000-0000-0000-0000-000000000002') is distinct from 'not_started-' then
    raise exception 'A block changed a not_started Crew';
  end if;

  -- Other pairs are untouched, including Ada's other connection.
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-00000000000a'
                   and user_high = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'Ada blocking Bea removed Ada''s connection with Cal';
  end if;
  if (select status from public.commute_crews where id = '40000000-0000-0000-0000-000000000003') is distinct from 'proposed'
     or (select status from public.commute_crews where id = '40000000-0000-0000-0000-000000000004') is distinct from 'paused' then
    raise exception 'Ada blocking Bea changed other pairs'' Crews';
  end if;

  -- is_blocked, both directions.
  if not public.is_blocked('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') then
    raise exception 'is_blocked(blocker, blocked) should be true';
  end if;
  if not public.is_blocked('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a') then
    raise exception 'is_blocked(blocked, blocker) should be true';
  end if;
  if public.is_blocked('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c')
     or public.is_blocked('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000b') then
    raise exception 'is_blocked is true for a pair nobody blocked';
  end if;
  if public.is_blocked('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a')
     or coalesce(public.is_blocked(null, '00000000-0000-0000-0000-00000000000a'), true)
     or coalesce(public.is_blocked('00000000-0000-0000-0000-00000000000a', null), true) then
    raise exception 'is_blocked should be false for self and nulls';
  end if;
end
$$;

-- 5. A proposed Crew and a paused Crew end too, whichever side of the pair blocks.
-- Dan is Cal+Dan's user_high; Eve is Eve+Fay's user_low.
select tests.as_user('00000000-0000-0000-0000-00000000000d');
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000c');
select tests.as_user('00000000-0000-0000-0000-00000000000e');
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f');

select tests.as_admin();
do $$
begin
  if exists (select 1 from public.connections
             where (user_low = '00000000-0000-0000-0000-00000000000c' and user_high = '00000000-0000-0000-0000-00000000000d')
                or (user_low = '00000000-0000-0000-0000-00000000000e' and user_high = '00000000-0000-0000-0000-00000000000f')) then
    raise exception 'Dan''s or Eve''s block left the connection';
  end if;
  if (select status || ':' || (ended_at = now())::text from public.commute_crews
      where id = '40000000-0000-0000-0000-000000000003') is distinct from 'ended:true' then
    raise exception 'A block should end a proposed Crew';
  end if;
  if (select status || ':' || (ended_at = now())::text from public.commute_crews
      where id = '40000000-0000-0000-0000-000000000004') is distinct from 'ended:true' then
    raise exception 'A block should end a paused Crew';
  end if;
  if not public.is_blocked('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d') then
    raise exception 'is_blocked(Cal, Dan) should be true after Dan blocks Cal';
  end if;

  -- The never-blocked pair is untouched by all of this.
  if (select status from public.commute_crews where id = '40000000-0000-0000-0000-000000000005') is distinct from 'active'
     or not exists (select 1 from public.connections
                    where user_low = '00000000-0000-0000-0000-000000000010'
                      and user_high = '00000000-0000-0000-0000-000000000011') then
    raise exception 'Blocks changed Gil and Hal''s connection or Crew';
  end if;
end
$$;

-- 6. A blocked pair can't be reconnected.
-- 6a. Bea edits her answer (Yes -> Individual -> Yes). Each edit re-runs
-- resolve_connection over the pair's yes/yes; the write must be skipped, not raise.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  n integer;
begin
  update public.ride_feedback set ride_again = 'individual'
  where ride_id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Bea should still be able to edit her feedback, % rows changed', n;
  end if;
  update public.ride_feedback set ride_again = 'yes'
  where ride_id = '10000000-0000-0000-0000-000000000001';
end
$$;

-- 6b. A new completed ride with fresh yes + yes.
select tests.as_admin();
update public.rides set status = 'completed', completed_at = now()
where id = '10000000-0000-0000-0000-000000000002';

select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'great', 'yes');
select tests.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.ride_feedback (ride_id, author_id, experience, ride_again)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'great', 'yes');

select tests.as_admin();
do $$
declare
  n integer;
begin
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Feedback changes re-created a connection for a blocked pair';
  end if;

  -- 6c. Any other writer is skipped too, even the owner.
  insert into public.connections (user_low, user_high, crew_eligible)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', true);
  get diagnostics n = row_count;
  if n <> 0 or exists (select 1 from public.connections
                       where user_low = '00000000-0000-0000-0000-00000000000a'
                         and user_high = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'A direct insert connected a blocked pair';
  end if;

  -- ...while an unblocked pair can still be connected.
  insert into public.connections (user_low, user_high, crew_eligible)
  values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000010', false);
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'The connections guard skipped a pair nobody blocked';
  end if;
end
$$;

-- 6d. propose_crew fails for the blocked pair, from either side, like any pair without
-- a Crew-eligible connection.
do $$
begin
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
  begin
    perform public.propose_crew('00000000-0000-0000-0000-00000000000b', array[1, 2], '07:30');
    raise exception 'Ada proposed a Crew to Bea, whom she blocked';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_user('00000000-0000-0000-0000-00000000000b');
  begin
    perform public.propose_crew('00000000-0000-0000-0000-00000000000a', array[1, 2], '07:30');
    raise exception 'Bea proposed a Crew to Ada, who blocked her';
  exception when insufficient_privilege then
    null;
  end;

  perform tests.as_admin();
  if exists (select 1 from public.commute_crews
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b'
               and status in ('proposed', 'active', 'paused')) then
    raise exception 'A blocked pair has an open Crew';
  end if;
end
$$;

-- 7. Bea can block Ada back (a different row; nothing reveals Ada's block), and
-- sees only her own block.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a');

do $$
declare
  n integer;
begin
  if (select count(*) from public.blocks) <> 1
     or exists (select 1 from public.blocks where blocker_id <> auth.uid()) then
    raise exception 'Bea should see only her own block';
  end if;
  -- Unblock: an unfiltered delete removes only her own row.
  delete from public.blocks;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Bea''s unfiltered delete removed % rows, expected her one block', n;
  end if;
end
$$;

-- 8. Ada unblocks. Nothing comes back.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  n integer;
begin
  delete from public.blocks;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Ada''s unfiltered delete removed % rows, expected her one block', n;
  end if;
  if (select count(*) from public.blocks) <> 0 then
    raise exception 'Ada still sees a block after unblocking';
  end if;
end
$$;

select tests.as_admin();
do $$
begin
  if public.is_blocked('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') then
    raise exception 'is_blocked is still true after both unblocked';
  end if;
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Unblocking restored the connection';
  end if;
  if exists (select 1 from public.commute_crews
             where user_low = '00000000-0000-0000-0000-00000000000a'
               and user_high = '00000000-0000-0000-0000-00000000000b'
               and status <> 'ended' and status <> 'not_started') then
    raise exception 'Unblocking reopened a Crew';
  end if;
  -- Dan's block of Cal is untouched by Ada and Bea unblocking.
  if not exists (select 1 from public.blocks
                 where blocker_id = '00000000-0000-0000-0000-00000000000d'
                   and blocked_id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'Dan''s block disappeared';
  end if;
end
$$;

-- 9. Safety reports: insert-only for the reporter, one per category.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.safety_reports (reporter_id, reported_user_id, ride_id, category, details) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'unsafe_driving', 'Ran two red lights on the approach.');
insert into public.safety_reports (reporter_id, reported_user_id, category, details) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'harassment', 'Kept messaging after I said no.');
insert into public.safety_reports (reporter_id, reported_user_id, ride_id, category) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'no_show');
insert into public.safety_reports (reporter_id, reported_user_id, category) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c', 'vehicle_identity_mismatch');
insert into public.safety_reports (reporter_id, category, details) values
  ('00000000-0000-0000-0000-00000000000a', 'other', repeat('x', 4000));

do $$
declare
  n integer;
  report uuid;
begin
  -- The reporter can't read her own reports back.
  begin
    perform count(*) from public.safety_reports;
    raise exception 'Ada read safety reports';
  exception when insufficient_privilege then
    null;
  end;
  -- ...including through RETURNING.
  begin
    insert into public.safety_reports (reporter_id, category)
    values ('00000000-0000-0000-0000-00000000000a', 'other')
    returning id into strict report;
    raise exception 'Ada read a report back through RETURNING';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.safety_reports set details = 'edited';
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'Ada updated % safety reports', n;
  end if;
  begin
    delete from public.safety_reports;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'Ada deleted % safety reports', n;
  end if;

  -- reporter_id must be the caller.
  begin
    insert into public.safety_reports (reporter_id, reported_user_id, category)
    values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', 'harassment');
    raise exception 'Ada filed a report as Bea';
  exception when insufficient_privilege then
    null;
  end;
  -- ride_id must be one of the reporter's rides (r3 is Cal and Dan's).
  begin
    insert into public.safety_reports (reporter_id, reported_user_id, ride_id, category)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000003', 'unsafe_driving');
    raise exception 'Ada reported on a ride she was not on';
  exception when insufficient_privilege then
    null;
  end;
  -- Can't report yourself.
  begin
    insert into public.safety_reports (reporter_id, reported_user_id, category)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'other');
    raise exception 'Ada reported herself';
  exception when check_violation then
    null;
  end;
  -- Only the five categories.
  begin
    insert into public.safety_reports (reporter_id, category)
    values ('00000000-0000-0000-0000-00000000000a', 'rude');
    raise exception 'A report with an unknown category was accepted';
  exception when check_violation then
    null;
  end;
  -- Details are capped at 4000 characters.
  begin
    insert into public.safety_reports (reporter_id, category, details)
    values ('00000000-0000-0000-0000-00000000000a', 'other', repeat('x', 4001));
    raise exception 'A report with 4001 characters of details was accepted';
  exception when check_violation then
    null;
  end;
  -- id and created_at are the server's.
  begin
    insert into public.safety_reports (id, reporter_id, category)
    values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'other');
    raise exception 'Ada chose a report id';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.safety_reports (reporter_id, category, created_at)
    values ('00000000-0000-0000-0000-00000000000a', 'other', '2000-01-01');
    raise exception 'Ada set a report''s created_at';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- The reported person can't read reports about them either.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
begin
  begin
    perform count(*) from public.safety_reports;
    raise exception 'Bea read safety reports';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 10. anon can't insert reports or blocks.
select tests.as_anon();
do $$
begin
  begin
    insert into public.safety_reports (reporter_id, category)
    values ('00000000-0000-0000-0000-00000000000a', 'other');
    raise exception 'anon filed a safety report';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.blocks (blocker_id, blocked_id)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c');
    raise exception 'anon inserted a block';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform count(*) from public.blocks;
    raise exception 'anon read blocks';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 11. Staff (here: admin) see exactly the five accepted reports.
select tests.as_admin();
do $$
begin
  if (select count(*) from public.safety_reports) <> 5 then
    raise exception 'Expected 5 safety reports, found %', (select count(*) from public.safety_reports);
  end if;
  if (select count(distinct category) from public.safety_reports) <> 5 then
    raise exception 'Expected one report per category';
  end if;
  if exists (select 1 from public.safety_reports
             where reporter_id <> '00000000-0000-0000-0000-00000000000a'
                or id is null or created_at is null) then
    raise exception 'A report has the wrong reporter or no id / created_at';
  end if;
  if (select ride_id from public.safety_reports where category = 'unsafe_driving')
     is distinct from '10000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'The unsafe_driving report lost its ride';
  end if;
end
$$;

rollback;

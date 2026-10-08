-- Account deletion (D-15).
-- Spec: docs/superpowers/specs/2026-10-08-account-deletion-design.md, "Deletion policy" and "Testing".
--
-- People:
--   Ada 0a  the account deleted in section 3. Profile, vehicle, both commute rows,
--           invitations both ways, rides both ways, feedback, a connection and
--           Crews with Bea, blocks both ways with Cal, safety reports by and about her.
--   Bea 0b  Ada's rider. Her rows must stay, showing Ada as a Former member.
--   Cal 0c  blocks Ada and is blocked by her; reports Ada; has an invitation from Bea.
--   Dan 0d  deleted first (section 2), so Ada has a ride, invitation and Crew whose
--           other side is already gone.
--   Eve 0e + Fay 0f   unrelated pair: ride, feedback, connection, Crew, report, invitations.
--   Gil 10 + Hal 11   staff feedback deletes (section 5).
--   Ivy 12  an account with no profile.
begin;

-- 1. Policy guards over the whole schema ------------------------------------------

-- 1a. Every foreign key into a table that an account deletion deletes from has an
-- on-delete action, except rides.invitation_id (deliberately no action).
do $$
declare
  bad text;
begin
  select string_agg(format('%s.%s -> %s (%s)', c.conrelid::regclass, c.conname, c.confrelid::regclass, c.confdeltype), ', ')
  into bad
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid in (
      'auth.users'::regclass, 'public.profiles'::regclass, 'public.vehicles'::regclass,
      'public.commutes'::regclass, 'public.rides'::regclass, 'public.commute_crews'::regclass,
      'public.invitations'::regclass)
    and c.confdeltype not in ('c', 'n')
    and not (c.conrelid = 'public.rides'::regclass and c.conname = 'rides_invitation_id_fkey');
  if bad is not null then
    raise exception 'Foreign keys without a cascade or set-null action (deletion policy rule 1): %', bad;
  end if;
end
$$;

-- 1b. Every set-null column is nullable, or the set null would fail mid-deletion.
do $$
declare
  bad text;
begin
  select string_agg(format('%s.%s (%s)', c.conrelid::regclass, a.attname, c.conname), ', ')
  into bad
  from pg_constraint c
  cross join lateral unnest(coalesce(c.confdelsetcols, c.conkey)) as k(attnum)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.contype = 'f'
    and c.confdeltype = 'n'
    and a.attnotnull;
  if bad is not null then
    raise exception 'Set-null foreign key columns that are not null (deletion policy rule 2): %', bad;
  end if;
end
$$;

-- 1c. Clients can't run the deletion machinery or the purge, or write the stamp.
do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.profiles_apply_deletion_policy()',
    'public.require_on_insert()',
    'public.safety_reports_stamp_account_deleted()',
    'public.purge_expired_safety_reports()',
    'public.ride_feedback_resolve_connection()'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'execute') then
        raise exception '% can execute %', r, f;
      end if;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.safety_reports', 'account_deleted_at', 'INSERT')
       or has_column_privilege(r, 'public.safety_reports', 'account_deleted_at', 'UPDATE')
       or has_column_privilege(r, 'public.safety_reports', 'account_deleted_at', 'SELECT') then
      raise exception '% can read or write safety_reports.account_deleted_at', r;
    end if;
  end loop;
end
$$;

-- Fixture -----------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cal@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.test'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.test'),
  ('00000000-0000-0000-0000-00000000000f', 'fay@example.test'),
  ('00000000-0000-0000-0000-000000000010', 'gil@example.test'),
  ('00000000-0000-0000-0000-000000000011', 'hal@example.test'),
  ('00000000-0000-0000-0000-000000000012', 'ivy@example.test');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada A.', 'both'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver'),
  ('00000000-0000-0000-0000-00000000000c', 'Cal C.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000d', 'Dan D.', 'driver'),
  ('00000000-0000-0000-0000-00000000000e', 'Eve E.', 'passenger'),
  ('00000000-0000-0000-0000-00000000000f', 'Fay F.', 'driver'),
  ('00000000-0000-0000-0000-000000000010', 'Gil G.', 'passenger'),
  ('00000000-0000-0000-0000-000000000011', 'Hal H.', 'driver');

insert into public.vehicles (id, owner_id, make, model, passenger_seats) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Honda', 'Fit', 2);

-- Ada is "Both": a driver row with her vehicle and a passenger row.
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'driver',
   'SRID=4326;POINT(-122.2600 37.7660)', 'SRID=4326;POINT(-122.3990 37.7930)', '07:30', '{1,2,3}', 2,
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000b', 'driver',
   'SRID=4326;POINT(-122.2830 37.7650)', 'SRID=4326;POINT(-122.3990 37.7890)', '07:30', '{1,2,3,4}', 1, null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000d', 'driver',
   'SRID=4326;POINT(-122.2700 37.7700)', 'SRID=4326;POINT(-122.3990 37.7900)', '08:00', '{1,2}', 1, null),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000f', 'driver',
   'SRID=4326;POINT(-122.2500 37.7600)', 'SRID=4326;POINT(-122.4000 37.7900)', '08:15', '{3,4}', 1, null),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000011', 'driver',
   'SRID=4326;POINT(-122.2400 37.7650)', 'SRID=4326;POINT(-122.3950 37.7920)', '07:00', '{1,5}', 1, null);
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'passenger',
   'SRID=4326;POINT(-122.2600 37.7660)', 'SRID=4326;POINT(-122.3990 37.7930)', '17:30', '{4,5}');

-- Invitations. i1–i4 led to rides; i5–i8 didn't (pending, pending, declined, Crew).
insert into public.invitations (id, sender_id, recipient_id, commute_id, status, ride_date) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b2', 'accepted', '2026-10-05'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'accepted', '2026-10-06'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b2', 'accepted', '2099-01-05'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b2', 'accepted', '2026-01-05'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b2', 'pending', '2099-01-06'),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'pending', '2099-01-07'),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'declined', '2026-10-07'),
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d2', 'accepted', '2026-10-02'),
  ('20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000f2', 'accepted', '2026-10-05'),
  ('20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000f2', 'pending', '2099-01-05'),
  ('20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000b2', 'pending', '2099-01-05'),
  ('20000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000112', 'accepted', '2026-09-01'),
  ('20000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000112', 'accepted', '2026-09-02');

-- r1 Bea drives Ada (completed). r2 Ada drives Bea (completed). r3 future confirmed.
-- r4 past confirmed, never completed. r5 Dan drives Ada. r6 Fay drives Eve. r7, r8 Hal drives Gil.
insert into public.rides (id, invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind, completed_at) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-10-05', '07:30', 'completed', 'first_ride', '2026-10-05 16:00+00'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '2026-10-06', '07:30', 'completed', 'ride_again', '2026-10-06 16:00+00'),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2099-01-05', '07:30', 'confirmed', 'ride_again', null),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '2026-01-05', '07:30', 'confirmed', 'first_ride', null),
  ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', '2026-10-02', '08:00', 'completed', 'first_ride', '2026-10-02 16:00+00'),
  ('10000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000000e', '2026-10-05', '08:15', 'completed', 'first_ride', '2026-10-05 16:00+00'),
  ('10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', '2026-09-01', '07:00', 'completed', 'first_ride', '2026-09-01 15:00+00'),
  ('10000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000010', '2026-09-02', '07:00', 'completed', 'ride_again', '2026-09-02 15:00+00');

-- Feedback (the triggers stamp it and resolve connections).
insert into public.ride_feedback (ride_id, author_id, experience, ride_again) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'great', 'yes'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'great', 'yes'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'good', 'yes'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', 'good', 'yes'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000d', 'good', 'yes'),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000e', 'great', 'yes'),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000000f', 'great', 'yes'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000011', 'great', 'yes'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000010', 'great', 'yes');
-- Gil's later answer on r8 is "no", so Gil and Hal aren't connected.
insert into public.ride_feedback (ride_id, author_id, experience, ride_again) values
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000010', 'not_a_fit', 'no');

-- Crews. c1 Ada+Bea active (Ada proposed). c2 Ada+Bea ended earlier. c3 Ada+Dan active
-- (Dan proposed). c4 Eve+Fay active.
insert into public.commute_crews (id, user_low, user_high, proposed_by, weekdays, departure_time, status, responded_at, ended_at) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '{1,2}', '07:30', 'active', '2026-10-07 08:00+00', null),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '{3}', '07:30', 'ended', '2026-09-01 08:00+00', '2026-09-15 08:00+00'),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d', '{1}', '08:00', 'active', '2026-10-03 08:00+00', null),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000000e', '{3,4}', '08:15', 'active', '2026-10-06 08:00+00', null);

insert into public.invitations (id, sender_id, recipient_id, commute_id, status, ride_date, crew_id) values
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'pending', '2099-01-08', '40000000-0000-0000-0000-000000000001');

-- Blocks: Ada and Cal both ways; Cal blocks Eve (unrelated to Ada).
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000e');

-- Safety reports. s1 Ada about Bea on r1. s2 Cal about Ada. s3 Ada about Dan.
-- s4 Ada about Dan on r5. s5 Eve about Fay on r6.
insert into public.safety_reports (id, reporter_id, reported_user_id, ride_id, category, details) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'unsafe_driving', 'Phone in hand on the bridge.'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', null, 'harassment', null),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', null, 'other', null),
  ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000005', 'no_show', null),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-000000000006', 'other', null);

do $$
begin
  if (select count(*) from public.connections
      where (user_low, user_high, crew_eligible) in (
        ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, true),
        ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000d'::uuid, true),
        ('00000000-0000-0000-0000-00000000000e'::uuid, '00000000-0000-0000-0000-00000000000f'::uuid, true))) <> 3 then
    raise exception 'Setup: Ada+Bea, Ada+Dan and Eve+Fay should be connected and Crew-eligible';
  end if;
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-000000000010'
               and user_high = '00000000-0000-0000-0000-000000000011') then
    raise exception 'Setup: Gil''s later "no" should leave Gil and Hal unconnected';
  end if;
end
$$;

-- Clients can't start any of this themselves. Unfiltered statements, as Bea.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  n integer;
begin
  delete from public.profiles;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Bea deleted % profiles from the client', n;
  end if;
  delete from public.invitations;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Bea deleted % invitations from the client', n;
  end if;
  begin
    update public.rides set driver_id = null;
    raise exception 'Bea cleared a ride''s driver from the client';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.commute_crews set user_low = null;
    raise exception 'Bea cleared a Crew member from the client';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.purge_expired_safety_reports();
    raise exception 'Bea purged safety reports';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
select tests.as_admin();

-- 2. Dan deletes his account first ------------------------------------------------

delete from auth.users where id = '00000000-0000-0000-0000-00000000000d';

do $$
begin
  if not exists (select 1 from public.rides
                 where id = '10000000-0000-0000-0000-000000000005'
                   and driver_id is null
                   and passenger_id = '00000000-0000-0000-0000-00000000000a'
                   and status = 'completed') then
    raise exception 'r5 should stay for Ada with Dan cleared';
  end if;
  if not exists (select 1 from public.invitations
                 where id = '20000000-0000-0000-0000-000000000009'
                   and sender_id is null
                   and recipient_id = '00000000-0000-0000-0000-00000000000a'
                   and commute_id is null) then
    raise exception 'Dan''s invitation for r5 should stay with Dan and his commute cleared';
  end if;
  if exists (select 1 from public.ride_feedback where author_id = '00000000-0000-0000-0000-00000000000d') then
    raise exception 'Dan''s feedback should be deleted';
  end if;
  if not exists (select 1 from public.ride_feedback
                 where ride_id = '10000000-0000-0000-0000-000000000005'
                   and author_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'Ada''s feedback on r5 is hers and should stay while she exists';
  end if;
  if exists (select 1 from public.connections
             where '00000000-0000-0000-0000-00000000000d' in (user_low, user_high)) then
    raise exception 'Ada and Dan''s connection should be deleted';
  end if;
  if not exists (select 1 from public.commute_crews
                 where id = '40000000-0000-0000-0000-000000000003'
                   and status = 'ended' and ended_at is not null
                   and user_low = '00000000-0000-0000-0000-00000000000a'
                   and user_high is null and proposed_by is null) then
    raise exception 'Ada and Dan''s active Crew should be ended with Dan cleared';
  end if;
  if not exists (select 1 from public.safety_reports
                 where id = '50000000-0000-0000-0000-000000000003'
                   and reporter_id = '00000000-0000-0000-0000-00000000000a'
                   and reported_user_id is null
                   and account_deleted_at is not null) then
    raise exception 'Ada''s report about Dan should stay, with Dan cleared and the deletion stamped';
  end if;
end
$$;

-- Ada still reads r5 and the ended Crew as a client; Dan shows as a null (Former member).
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
begin
  if not exists (select 1 from public.rides
                 where id = '10000000-0000-0000-0000-000000000005' and driver_id is null) then
    raise exception 'Ada can''t read her ride with a Former member';
  end if;
  if not exists (select 1 from public.commute_crews
                 where id = '40000000-0000-0000-0000-000000000003' and user_high is null) then
    raise exception 'Ada can''t read her Crew with a Former member';
  end if;
end
$$;
select tests.as_admin();

-- 3. Ada deletes her account ------------------------------------------------------

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';

-- 3a. Nothing anywhere references Ada (every foreign key to profiles, whatever table).
do $$
declare
  fk record;
  n bigint;
  checked integer := 0;
begin
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'Ada''s profile should be deleted';
  end if;
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    cross join lateral unnest(c.conkey) as k(attnum)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col)
      into n using '00000000-0000-0000-0000-00000000000a'::uuid;
    if n <> 0 then
      raise exception '% row(s) in %.% still reference Ada', n, fk.tbl, fk.col;
    end if;
    checked := checked + 1;
  end loop;
  if checked < 16 then
    raise exception 'Expected at least 16 foreign key columns to profiles, found %', checked;
  end if;
end
$$;

-- 3b. Owned rows are gone.
do $$
begin
  if exists (select 1 from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1')
     or exists (select 1 from public.commutes where id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')) then
    raise exception 'Ada''s vehicle and commutes should be deleted';
  end if;
  if exists (select 1 from public.invitations
             where id in ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006',
                          '20000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000008')) then
    raise exception 'Ada''s invitations that led to no ride (pending, declined, Crew) should be deleted';
  end if;
  if exists (select 1 from public.blocks
             where '00000000-0000-0000-0000-00000000000c' in (blocker_id, blocked_id)
               and '00000000-0000-0000-0000-00000000000e' not in (blocker_id, blocked_id)) then
    raise exception 'Blocks between Ada and Cal should be deleted both ways';
  end if;
end
$$;

-- 3c. Bea's shared history stays, with Ada as a Former member.
do $$
begin
  if (select count(*) from public.rides
      where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004')
        and driver_id = '00000000-0000-0000-0000-00000000000b' and passenger_id is null) <> 3
     or not exists (select 1 from public.rides
                    where id = '10000000-0000-0000-0000-000000000002'
                      and driver_id is null and passenger_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Bea''s four rides with Ada should stay with Ada cleared';
  end if;
  if (select status from public.rides where id = '10000000-0000-0000-0000-000000000001') <> 'completed'
     or (select status from public.rides where id = '10000000-0000-0000-0000-000000000002') <> 'completed' then
    raise exception 'Completed rides should stay completed';
  end if;
  if (select status from public.rides where id = '10000000-0000-0000-0000-000000000003') <> 'cancelled' then
    raise exception 'A future confirmed ride with Ada should be cancelled';
  end if;
  if (select status from public.rides where id = '10000000-0000-0000-0000-000000000004') <> 'confirmed' then
    raise exception 'A past confirmed ride should be left for ride completion to decide';
  end if;

  if (select count(*) from public.invitations
      where id in ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004')
        and sender_id is null and recipient_id = '00000000-0000-0000-0000-00000000000b'
        and commute_id = '00000000-0000-0000-0000-0000000000b2') <> 3
     or not exists (select 1 from public.invitations
                    where id = '20000000-0000-0000-0000-000000000002'
                      and sender_id = '00000000-0000-0000-0000-00000000000b' and recipient_id is null
                      and commute_id is null) then
    raise exception 'Invitations behind Bea''s rides should stay with Ada (and Ada''s commute) cleared';
  end if;

  if (select count(*) from public.ride_feedback where author_id = '00000000-0000-0000-0000-00000000000b') <> 2 then
    raise exception 'Bea''s feedback should stay';
  end if;

  if not exists (select 1 from public.commute_crews
                 where id = '40000000-0000-0000-0000-000000000001'
                   and status = 'ended' and ended_at is not null
                   and user_low is null and user_high = '00000000-0000-0000-0000-00000000000b'
                   and proposed_by is null) then
    raise exception 'Ada and Bea''s active Crew should be ended with Ada cleared';
  end if;
  if not exists (select 1 from public.commute_crews
                 where id = '40000000-0000-0000-0000-000000000002'
                   and status = 'ended' and ended_at = '2026-09-15 08:00+00'
                   and user_low is null and user_high = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Ada and Bea''s earlier ended Crew should keep its end date';
  end if;
end
$$;

-- 3d. Records with nobody left are deleted.
do $$
begin
  if exists (select 1 from public.rides where id = '10000000-0000-0000-0000-000000000005')
     or exists (select 1 from public.ride_feedback where ride_id = '10000000-0000-0000-0000-000000000005') then
    raise exception 'r5 (Dan and Ada both gone) should be deleted with its feedback';
  end if;
  if exists (select 1 from public.invitations where id = '20000000-0000-0000-0000-000000000009') then
    raise exception 'r5''s invitation should be deleted';
  end if;
  if exists (select 1 from public.commute_crews where id = '40000000-0000-0000-0000-000000000003') then
    raise exception 'Ada and Dan''s Crew (both gone) should be deleted';
  end if;
end
$$;

-- 3e. Safety reports stay, de-identified and stamped.
do $$
begin
  if (select count(*) from public.safety_reports) <> 5 then
    raise exception 'All five safety reports should stay, found %', (select count(*) from public.safety_reports);
  end if;
  if not exists (select 1 from public.safety_reports
                 where id = '50000000-0000-0000-0000-000000000001' and reporter_id is null
                   and reported_user_id = '00000000-0000-0000-0000-00000000000b'
                   and ride_id = '10000000-0000-0000-0000-000000000001'
                   and details = 'Phone in hand on the bridge.'
                   and account_deleted_at is not null) then
    raise exception 'Ada''s report about Bea should stay with Ada cleared';
  end if;
  if not exists (select 1 from public.safety_reports
                 where id = '50000000-0000-0000-0000-000000000002'
                   and reporter_id = '00000000-0000-0000-0000-00000000000c'
                   and reported_user_id is null and account_deleted_at is not null) then
    raise exception 'Cal''s report about Ada should stay with Ada cleared';
  end if;
  if (select count(*) from public.safety_reports
      where id in ('50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000004')
        and reporter_id is null and reported_user_id is null and ride_id is null
        and account_deleted_at is not null) <> 2 then
    raise exception 'Reports between Ada and Dan should stay with both (and r5) cleared';
  end if;
  if not exists (select 1 from public.safety_reports
                 where id = '50000000-0000-0000-0000-000000000005'
                   and reporter_id = '00000000-0000-0000-0000-00000000000e'
                   and reported_user_id = '00000000-0000-0000-0000-00000000000f'
                   and ride_id = '10000000-0000-0000-0000-000000000006'
                   and account_deleted_at is null) then
    raise exception 'Eve''s report about Fay should be untouched';
  end if;
end
$$;

-- 3f. Unrelated rows are unchanged.
do $$
begin
  if (select count(*) from public.profiles) <> 6 then
    raise exception 'Only Ada''s and Dan''s profiles should be gone';
  end if;
  if not exists (select 1 from public.rides
                 where id = '10000000-0000-0000-0000-000000000006'
                   and driver_id = '00000000-0000-0000-0000-00000000000f'
                   and passenger_id = '00000000-0000-0000-0000-00000000000e' and status = 'completed') then
    raise exception 'Eve and Fay''s ride changed';
  end if;
  if (select count(*) from public.invitations
      where id in ('20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012')
        and sender_id is not null and recipient_id is not null and commute_id is not null) <> 3 then
    raise exception 'Invitations between other people changed';
  end if;
  if not exists (select 1 from public.commute_crews
                 where id = '40000000-0000-0000-0000-000000000004' and status = 'active'
                   and ended_at is null and proposed_by = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'Eve and Fay''s Crew changed';
  end if;
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-00000000000e'
                   and user_high = '00000000-0000-0000-0000-00000000000f' and crew_eligible) then
    raise exception 'Eve and Fay''s connection changed';
  end if;
  if (select count(*) from public.blocks) <> 1
     or not exists (select 1 from public.blocks
                    where blocker_id = '00000000-0000-0000-0000-00000000000c'
                      and blocked_id = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'Cal''s block of Eve should be the only block left';
  end if;
  if (select count(*) from public.commutes) <> 3 or (select count(*) from public.ride_feedback) <> 7 then
    raise exception 'Other people''s commutes or feedback changed';
  end if;
end
$$;

-- 3g. Bea still reads her history as a client.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
begin
  if (select count(*) from public.rides) <> 4 then
    raise exception 'Bea should read her 4 rides with a Former member, read %', (select count(*) from public.rides);
  end if;
  if (select count(*) from public.commute_crews) <> 2 then
    raise exception 'Bea should read her 2 ended Crews with a Former member';
  end if;
  if exists (select 1 from public.connections) then
    raise exception 'Bea should have no connections left';
  end if;
end
$$;
select tests.as_admin();

-- 3h. Connections match what the remaining feedback gives.
create temp table connections_before on commit drop as
  select user_low, user_high, crew_eligible from public.connections;

do $$
declare
  p record;
begin
  for p in
    select least(r.driver_id, r.passenger_id) as lo, greatest(r.driver_id, r.passenger_id) as hi
    from public.rides r
    where r.driver_id is not null and r.passenger_id is not null
    union
    select c.user_low, c.user_high from public.connections c
  loop
    perform public.resolve_connection(p.lo, p.hi);
  end loop;
  if exists (select * from connections_before
             except select user_low, user_high, crew_eligible from public.connections)
     or exists (select user_low, user_high, crew_eligible from public.connections
                except select * from connections_before) then
    raise exception 'Connections after the deletions don''t match the remaining feedback';
  end if;
end
$$;

-- 4. An account with no profile, and one with only a profile ---------------------

delete from auth.users where id = '00000000-0000-0000-0000-000000000012';
delete from auth.users where id = '00000000-0000-0000-0000-00000000000c';
do $$
begin
  if exists (select 1 from auth.users where id in ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000c')) then
    raise exception 'Ivy''s and Cal''s accounts should be deleted';
  end if;
  if exists (select 1 from public.blocks)
     or exists (select 1 from public.invitations where id = '20000000-0000-0000-0000-000000000012') then
    raise exception 'Cal''s block and pending invitation should be deleted with him';
  end if;
  if not exists (select 1 from public.safety_reports
                 where id = '50000000-0000-0000-0000-000000000002'
                   and reporter_id is null and reported_user_id is null) then
    raise exception 'Cal''s report about Ada should stay with both cleared';
  end if;
end
$$;

-- 5. Staff feedback deletes recompute the connection -----------------------------

-- 5a. Removing Gil's later "no" leaves yes + yes on r7: Gil and Hal connect.
delete from public.ride_feedback
where ride_id = '10000000-0000-0000-0000-000000000008'
  and author_id = '00000000-0000-0000-0000-000000000010';
do $$
begin
  if not exists (select 1 from public.connections
                 where user_low = '00000000-0000-0000-0000-000000000010'
                   and user_high = '00000000-0000-0000-0000-000000000011' and crew_eligible) then
    raise exception 'Deleting Gil''s "no" should connect Gil and Hal from their remaining yes + yes';
  end if;
end
$$;

-- 5b. Removing Hal's only answer disconnects them and ends their open Crew.
insert into public.commute_crews (id, user_low, user_high, proposed_by, weekdays, departure_time, status, responded_at) values
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '{1}', '07:00', 'active', now());
delete from public.ride_feedback
where ride_id = '10000000-0000-0000-0000-000000000007'
  and author_id = '00000000-0000-0000-0000-000000000011';
do $$
begin
  if exists (select 1 from public.connections
             where user_low = '00000000-0000-0000-0000-000000000010'
               and user_high = '00000000-0000-0000-0000-000000000011') then
    raise exception 'Deleting Hal''s only answer should disconnect Gil and Hal';
  end if;
  if (select status from public.commute_crews where id = '40000000-0000-0000-0000-000000000005') <> 'ended' then
    raise exception 'Disconnecting Gil and Hal should end their Crew';
  end if;
end
$$;

-- 5c. Deleting a ride takes its feedback with it.
delete from public.rides where id = '10000000-0000-0000-0000-000000000007';
do $$
begin
  if exists (select 1 from public.ride_feedback where ride_id = '10000000-0000-0000-0000-000000000007') then
    raise exception 'Deleting a ride should delete its feedback';
  end if;
end
$$;

-- 6. People are still required on new rows ---------------------------------------

do $$
begin
  begin
    insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, kind)
    values ('20000000-0000-0000-0000-000000000011', null, '00000000-0000-0000-0000-00000000000e', '2099-01-05', '08:15', 'first_ride');
    raise exception 'A ride with no driver was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, kind)
    values ('20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000f', null, '2099-01-05', '08:15', 'first_ride');
    raise exception 'A ride with no passenger was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.invitations (sender_id, recipient_id, commute_id, ride_date)
    values (null, '00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000f2', '2099-01-09');
    raise exception 'An invitation with no sender was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.invitations (sender_id, recipient_id, commute_id, ride_date)
    values ('00000000-0000-0000-0000-00000000000e', null, '00000000-0000-0000-0000-0000000000f2', '2099-01-09');
    raise exception 'An invitation with no recipient was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.invitations (sender_id, recipient_id, commute_id, ride_date)
    values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', null, '2099-01-09');
    raise exception 'An invitation with no commute was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.commute_crews (user_low, user_high, proposed_by, weekdays, departure_time)
    values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', null, '{1}', '07:00');
    raise exception 'A Crew with no proposer was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.commute_crews (user_low, user_high, proposed_by, weekdays, departure_time)
    values (null, '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '{1}', '07:00');
    raise exception 'A Crew with a missing member was created';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.safety_reports (reporter_id, category) values (null, 'other');
    raise exception 'A safety report with no reporter was created';
  exception when not_null_violation then
    null;
  end;
  -- Still no self-reports.
  begin
    insert into public.safety_reports (reporter_id, reported_user_id, category)
    values ('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000e', 'other');
    raise exception 'A self-report was accepted';
  exception when check_violation then
    null;
  end;
end
$$;

-- A signed-in client can't file a report with no reporter either.
select tests.as_user('00000000-0000-0000-0000-00000000000e');
do $$
begin
  insert into public.safety_reports (reporter_id, category) values (null, 'other');
  raise exception 'Eve filed a report with no reporter';
exception when insufficient_privilege or not_null_violation then
  null;
end
$$;
select tests.as_admin();

-- 7. Safety report retention -------------------------------------------------------

-- r1: filed 13 months ago, nobody deleted          -> purged
-- r2: filed 13 months ago, account deleted 1 month ago -> kept
-- r3: filed 13 months ago, account deleted 13 months ago -> purged
-- s1..s5: filed now                                -> kept
insert into public.safety_reports (id, reporter_id, reported_user_id, category, created_at, account_deleted_at) values
  ('50000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000f', 'other', now() - interval '13 months', null),
  ('50000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000e', null, 'other', now() - interval '13 months', now() - interval '1 month'),
  ('50000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-00000000000e', null, 'other', now() - interval '13 months', now() - interval '13 months');

do $$
declare
  n integer;
begin
  n := public.purge_expired_safety_reports();
  if n <> 2 then
    raise exception 'The purge should delete 2 expired reports, deleted %', n;
  end if;
  if exists (select 1 from public.safety_reports
             where id in ('50000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000013')) then
    raise exception 'Expired reports survived the purge';
  end if;
  if (select count(*) from public.safety_reports) <> 6 then
    raise exception 'The purge deleted reports that aren''t expired';
  end if;
end
$$;

rollback;

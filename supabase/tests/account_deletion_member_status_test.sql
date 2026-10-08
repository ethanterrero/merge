-- Account deletion of suspended and vetted members (M-56's part of the deletion policy).
-- Spec: docs/superpowers/specs/2026-10-08-member-status-design.md, "Account deletion (M-17a) notes".
--
-- Suspension and vetting are two columns on profiles, so they go with the profile row;
-- 0011 adds no table and no foreign key. This proves it: deleting the auth.users row of
-- a suspended member and of a vetted driver leaves no profile, and no row in any table
-- with a foreign key into profiles still points at them.
--
-- People:
--   Sam 0c  suspended; owns a vehicle and a driver commute
--   Eve 0e  vetted driver; owns a passenger commute
--   Bea 0b  stays, to show deletion is limited to the two accounts
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'sam@example.test'),
  ('00000000-0000-0000-0000-00000000000e', 'eve@example.test');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver'),
  ('00000000-0000-0000-0000-00000000000c', 'Sam Sample', 'driver'),
  ('00000000-0000-0000-0000-00000000000e', 'Eve Evans', 'driver');

insert into public.vehicles (id, owner_id, make, model, passenger_seats) values
  ('50000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'Toyota', 'Prius', 3);

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id) values
  ('30000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'driver',
   'SRID=4326;POINT(-122.2830 37.7650)', 'SRID=4326;POINT(-122.3990 37.7890)', '07:30', '{1,2,3}', 2,
   '50000000-0000-0000-0000-00000000000c');
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays) values
  ('30000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000e', 'passenger',
   'SRID=4326;POINT(-122.2700 37.7700)', 'SRID=4326;POINT(-122.4000 37.7900)', '08:00', '{1,2}');

-- The owner vets Eve and suspends Sam.
update public.profiles set vetted_at = now() where id = '00000000-0000-0000-0000-00000000000e';
update public.profiles set suspended_at = now() where id = '00000000-0000-0000-0000-00000000000c';

do $$
begin
  if public.is_active('00000000-0000-0000-0000-00000000000c') is not false
     or public.is_vetted('00000000-0000-0000-0000-00000000000e') is not true then
    raise exception 'Setup: Sam should be suspended and Eve vetted';
  end if;
end
$$;

-- Deleting the accounts (M-17b's Edge Function deletes auth.users as the service role).
delete from auth.users
where id in ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000e');

-- Nothing of theirs remains: no profile (so no suspended_at or vetted_at), and no row
-- in any table with a foreign key into profiles names either of them.
do $$
declare
  fk record;
  n bigint;
begin
  if exists (select 1 from public.profiles
             where id in ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000e')) then
    raise exception 'A deleted member''s profile (and its status flags) remains';
  end if;
  if exists (select 1 from public.profiles where suspended_at is not null or vetted_at is not null) then
    raise exception 'A suspension or vetting record outlived the deletion';
  end if;

  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_catalog.pg_constraint c
    cross join lateral unnest(c.conkey) as k(attnum)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
  loop
    execute format('select count(*) from %s where %I in ($1, $2)', fk.tbl, fk.col)
      into n
      using '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000e'::uuid;
    if n <> 0 then
      raise exception '%.% still names a deleted member (% rows)', fk.tbl, fk.col, n;
    end if;
  end loop;

  if public.is_active('00000000-0000-0000-0000-00000000000c') is not false
     or public.is_vetted('00000000-0000-0000-0000-00000000000e') is not false then
    raise exception 'Deleted members should be neither active nor vetted';
  end if;

  if not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000b')
     or public.is_active('00000000-0000-0000-0000-00000000000b') is not true then
    raise exception 'Bea should be untouched';
  end if;
end
$$;

rollback;

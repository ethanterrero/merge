-- Vehicles and commutes: each signed-in person can read, create, edit and
-- delete only their own rows, and a commute can only use its owner's vehicle.
begin;

-- Ada (…a) and Bea (…b) have rows; Cal (…c) has none.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cal@example.test');

insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada A.'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.'),
  ('00000000-0000-0000-0000-00000000000c', 'Cal C.');

-- Bea's vehicle (…b1) and commute (…b2), created as admin.
insert into public.vehicles (id, owner_id, make, model, passenger_seats) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Honda', 'Fit', 3);

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000b', 'driver',
   'SRID=4326;POINT(-122.2833 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '07:30', '{1,2,3,4,5}', 2,
   '00000000-0000-0000-0000-0000000000b1');

-- 1. Ada can create, read and update her own vehicle and commute, and the
-- commute can use her own vehicle. (A rejection here fails this file.)
select tests.as_user('00000000-0000-0000-0000-00000000000a');

insert into public.vehicles (id, owner_id, make, model, passenger_seats) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Toyota', 'Prius', 3);

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'driver',
   'SRID=4326;POINT(-122.2416 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '08:00', '{1,2,3,4,5}', 2,
   '00000000-0000-0000-0000-0000000000a1');

-- 1a. SELECT shows exactly her own rows; an unfiltered UPDATE touches exactly
-- her own rows (the UPDATE policy's USING clause excludes Bea's).
do $$
declare
  n integer;
begin
  if (select count(*) from public.vehicles) <> 1
     or not exists (select 1 from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1') then
    raise exception 'Ada should see exactly one vehicle (her own)';
  end if;
  if (select count(*) from public.commutes) <> 1
     or not exists (select 1 from public.commutes where id = '00000000-0000-0000-0000-0000000000a2') then
    raise exception 'Ada should see exactly one commute (her own)';
  end if;

  update public.vehicles set color = 'Blue';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'An unfiltered vehicle update by Ada should touch only her own row, but touched % rows', n;
  end if;

  update public.commutes set departure_flex_minutes = 10;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'An unfiltered commute update by Ada should touch only her own row, but touched % rows', n;
  end if;

  if (select color from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1') is distinct from 'Blue' then
    raise exception 'Ada should be able to update her own vehicle';
  end if;
  if (select departure_flex_minutes from public.commutes where id = '00000000-0000-0000-0000-0000000000a2') is distinct from 10 then
    raise exception 'Ada should be able to update her own commute';
  end if;
end
$$;

-- 2. Ada cannot create rows for someone else (INSERT policy WITH CHECK).
do $$
begin
  begin
    insert into public.vehicles (owner_id, make, model, passenger_seats)
    values ('00000000-0000-0000-0000-00000000000b', 'Ford', 'Focus', 4);
    raise exception 'Ada created a vehicle owned by Bea';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays)
    values ('00000000-0000-0000-0000-00000000000b', 'passenger',
            'SRID=4326;POINT(-122.2833 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '09:00', '{1}');
    raise exception 'Ada created a commute owned by Bea';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 3. Ada cannot hand her own rows to someone else (UPDATE policy WITH CHECK).
-- No WHERE clause and a constant SET value, so the SELECT policy is not
-- applied and only the UPDATE policy can reject the new owner.
do $$
begin
  begin
    update public.vehicles set owner_id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'Ada gave her vehicle to Bea';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.commutes set owner_id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'Ada gave her commute to Bea';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 4. A commute cannot use someone else's vehicle, on insert or on update.
-- Cal and Ada know the id of Bea's vehicle; the foreign key alone would accept it.
-- (Cal inserts, because Ada already has a driver commute and 0008 allows one per role.)
select tests.as_user('00000000-0000-0000-0000-00000000000c');
do $$
begin
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id)
  values ('00000000-0000-0000-0000-00000000000c', 'driver',
          'SRID=4326;POINT(-122.2416 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '17:30', '{1}', 1,
          '00000000-0000-0000-0000-0000000000b1');
  raise exception 'Cal created a commute that uses Bea''s vehicle';
exception when foreign_key_violation then
  null;
end
$$;

select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
begin
  begin
    update public.commutes set vehicle_id = '00000000-0000-0000-0000-0000000000b1';
    raise exception 'Ada pointed her commute at Bea''s vehicle';
  exception when foreign_key_violation then
    null;
  end;
end
$$;

-- 5. Cal, who owns nothing, sees nothing and changes nothing. No WHERE clauses,
-- so only the policies decide which rows each statement may touch.
select tests.as_user('00000000-0000-0000-0000-00000000000c');
do $$
declare
  n integer;
begin
  if (select count(*) from public.vehicles) <> 0 then
    raise exception 'Cal can read other people''s vehicles';
  end if;
  if (select count(*) from public.commutes) <> 0 then
    raise exception 'Cal can read other people''s commutes';
  end if;

  update public.vehicles set color = 'Hacked';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Cal updated % vehicles he does not own', n;
  end if;
  update public.commutes set departure_flex_minutes = 60;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Cal updated % commutes he does not own', n;
  end if;

  delete from public.commutes;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Cal deleted % commutes he does not own', n;
  end if;
  delete from public.vehicles;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Cal deleted % vehicles he does not own', n;
  end if;
end
$$;

-- 6. Anonymous visitors have no access at all.
select tests.as_anon();
do $$
begin
  begin
    perform 1 from public.vehicles;
    raise exception 'anon can query vehicles';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.commutes;
    raise exception 'anon can query commutes';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 7. Even outside the client's policies (as admin), a vehicle cannot change
-- owner while someone else's commute uses it, and a commute cannot change owner
-- while it uses a vehicle the new owner doesn't own.
select tests.as_admin();
do $$
begin
  begin
    update public.vehicles set owner_id = '00000000-0000-0000-0000-00000000000c'
    where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'A vehicle in use by Ada''s commute moved to Cal';
  exception when foreign_key_violation then
    null;
  end;
  begin
    update public.commutes set owner_id = '00000000-0000-0000-0000-00000000000c'
    where id = '00000000-0000-0000-0000-0000000000a2';
    raise exception 'Ada''s commute moved to Cal while still using Ada''s vehicle';
  exception when foreign_key_violation then
    null;
  end;
end
$$;

-- 8. Ada can delete her own rows, and an unfiltered DELETE touches only hers.
-- 8a. Deleting the vehicle her commute uses succeeds and detaches it from the
-- commute (vehicle_id becomes null; the commute stays hers).
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  n integer;
begin
  delete from public.vehicles;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'An unfiltered vehicle delete by Ada should remove only her own row, but removed % rows', n;
  end if;
  if not exists (
    select 1 from public.commutes
    where id = '00000000-0000-0000-0000-0000000000a2'
      and owner_id = '00000000-0000-0000-0000-00000000000a'
      and vehicle_id is null
  ) then
    raise exception 'Deleting Ada''s vehicle should leave her commute in place with no vehicle';
  end if;
end
$$;

-- 8b. Deleting her commute.
do $$
declare
  n integer;
begin
  delete from public.commutes;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'An unfiltered commute delete by Ada should remove only her own row, but removed % rows', n;
  end if;
end
$$;

-- 9. Bea's rows survived everything above, unchanged.
select tests.as_admin();
do $$
begin
  if not exists (
    select 1 from public.vehicles
    where id = '00000000-0000-0000-0000-0000000000b1'
      and owner_id = '00000000-0000-0000-0000-00000000000b'
      and color is null
  ) then
    raise exception 'Bea''s vehicle was changed or removed';
  end if;
  if not exists (
    select 1 from public.commutes
    where id = '00000000-0000-0000-0000-0000000000b2'
      and owner_id = '00000000-0000-0000-0000-00000000000b'
      and vehicle_id = '00000000-0000-0000-0000-0000000000b1'
      and departure_flex_minutes = 15
  ) then
    raise exception 'Bea''s commute was changed or removed';
  end if;
  if (select count(*) from public.vehicles) <> 1 or (select count(*) from public.commutes) <> 1 then
    raise exception 'Ada''s rows should be gone and only Bea''s should remain';
  end if;
end
$$;

-- 10. Deleting an account still cascades to a commute that uses its vehicle
-- (the vehicle's set-null action and the commute's cascade don't conflict).
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  if exists (select 1 from public.vehicles) or exists (select 1 from public.commutes) then
    raise exception 'Deleting Bea''s account should remove her vehicle and commute';
  end if;
end
$$;

rollback;

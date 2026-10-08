-- Saved commutes and vehicles: generalized areas, boundary labels, schedule,
-- seats, cargo, plate and preferences (0008).
-- Spec: docs/superpowers/specs/2026-10-08-commute-privacy-design.md, "Tests".
begin;

-- Ada (…a), Bea (…b) and Cal (…c) stay for the whole file; Dee (…d) is deleted in 19.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cal@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'dee@example.test');

insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-00000000000a', 'Ada A.'),
  ('00000000-0000-0000-0000-00000000000b', 'Bea B.'),
  ('00000000-0000-0000-0000-00000000000c', 'Cal C.'),
  ('00000000-0000-0000-0000-00000000000d', 'Dee D.');

insert into public.vehicles (id, owner_id, make, model, passenger_seats) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Toyota', 'Prius', 3),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Honda', 'Fit', 4);

-- Places used below:
--   home     POINT(-122.2580 37.7650)  central Alameda, 1.8 km inside the city limit
--   fidi     POINT(-122.3990 37.7930)  Financial District, San Francisco
--   mission  POINT(-122.4180 37.7487)  Mission, 55 m north of its border with Bernal Heights

-- 20. A profile saved without discovery_opt_in is not discoverable (D-14).
do $$
begin
  if (select discovery_opt_in from public.profiles where id = '00000000-0000-0000-0000-00000000000d') is distinct from false then
    raise exception 'discovery_opt_in should default to false';
  end if;
end
$$;

-- 1. Saving a commute stores both areas, each within 402 m of its exact point,
-- and labels them from the area, not the pin.
select tests.as_user('00000000-0000-0000-0000-00000000000a');

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'driver',
        'SRID=4326;POINT(-122.2580 37.7650)', 'SRID=4326;POINT(-122.3990 37.7930)', '07:30', '{1,2,3}', 2,
        '00000000-0000-0000-0000-0000000000a1');

-- The area helpers are owner-only (0009), so the checks run as admin.
select tests.as_admin();
do $$
declare
  c public.commutes;
begin
  select * into c from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  if c.origin_area is null or c.destination_area is null then
    raise exception 'Both areas should be set on insert';
  end if;
  if extensions.st_distance(c.origin, c.origin_area) > public.area_radius_m()
     or extensions.st_distance(c.destination, c.destination_area) > public.area_radius_m() then
    raise exception 'Each exact point should be within % m of its area center', public.area_radius_m();
  end if;
  if public.area_radius_m() <> 402 then
    raise exception 'The area radius should be 402 m (0.5 mi wide), got %', public.area_radius_m();
  end if;
  if c.origin_area_label is distinct from public.area_label(c.origin_area)
     or not (c.origin_area_label = 'Alameda' or c.origin_area_label like '% area, Alameda') then
    raise exception 'An area in central Alameda should be labelled in Alameda, from its center, got %', c.origin_area_label;
  end if;
  if c.destination_area_label is distinct from public.area_label(c.destination_area)
     or c.destination_area_label not like '% area, San Francisco' then
    raise exception 'The destination label should come from its area center, got %', c.destination_area_label;
  end if;
end
$$;

select tests.as_user('00000000-0000-0000-0000-00000000000a');

-- 5. Ada's passenger row ("Both") with the same points reuses the driver row's
-- areas, so one home never yields two independent circles.
-- 2 (insert). Areas and labels sent by the client are ignored.
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays,
                             origin_area, destination_area, origin_area_label, destination_area_label)
values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'passenger',
        'SRID=4326;POINT(-122.2580 37.7650)', 'SRID=4326;POINT(-122.3990 37.7930)', '07:30', '{4,5}',
        'SRID=4326;POINT(0 0)', 'SRID=4326;POINT(0 0)', 'Hacked', 'Hacked');

do $$
declare
  d public.commutes;
  p public.commutes;
begin
  select * into d from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  select * into p from public.commutes where id = '00000000-0000-0000-0000-0000000000a3';
  if p.origin_area::text is distinct from d.origin_area::text
     or p.destination_area::text is distinct from d.destination_area::text then
    raise exception 'A second commute from the same points should reuse the first commute''s areas';
  end if;
  if p.origin_area_label = 'Hacked' or p.destination_area_label = 'Hacked' then
    raise exception 'A client-sent area label was stored';
  end if;
end
$$;

-- 2 (update) and 3. Client-sent areas and labels are ignored on update, areas
-- never change on re-read or when other fields change, and a label is not
-- recomputed while its area stays the same.
select tests.as_admin();
-- Rename every Alameda boundary (city and neighborhoods), so a recomputed label would differ.
update public.place_boundaries set city = 'Renamed' where city = 'Alameda';
update public.place_boundaries set name = 'Renamed' where id = 'tiger2025-place:0600562';
select tests.as_user('00000000-0000-0000-0000-00000000000a');

do $$
declare
  before public.commutes;
  after public.commutes;
  n integer;
begin
  select * into before from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';

  update public.commutes
  set origin_area = 'SRID=4326;POINT(0 0)', destination_area = 'SRID=4326;POINT(0 0)',
      origin_area_label = 'Hacked', destination_area_label = 'Hacked', departure_time = '07:40'
  where id = '00000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Ada should be able to update her commute';
  end if;

  select * into after from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  if after.origin_area::text is distinct from before.origin_area::text
     or after.destination_area::text is distinct from before.destination_area::text then
    raise exception 'Areas changed although the exact points did not';
  end if;
  if after.origin_area_label is distinct from before.origin_area_label
     or after.origin_area_label like '%Renamed%'
     or after.destination_area_label is distinct from before.destination_area_label then
    raise exception 'Labels changed although the areas did not (got %, %)', after.origin_area_label, after.destination_area_label;
  end if;
  if (select origin_area::text from public.commutes where id = '00000000-0000-0000-0000-0000000000a2')
     is distinct from before.origin_area::text then
    raise exception 'Re-reading returned a different area';
  end if;
end
$$;

select tests.as_admin();
update public.place_boundaries set city = 'Alameda' where city = 'Renamed';
update public.place_boundaries set name = 'Alameda' where id = 'tiger2025-place:0600562';
select tests.as_user('00000000-0000-0000-0000-00000000000a');

-- 4. Moving the pin 100 m toward its area center keeps the area. Moving it
-- 1 km draws a new area around the new point.
do $$
declare
  before public.commutes;
  after public.commutes;
begin
  select * into before from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';

  update public.commutes
  set origin = extensions.st_project(origin, 100, extensions.st_azimuth(origin, origin_area))
  where id = '00000000-0000-0000-0000-0000000000a2';
  select * into after from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  if after.origin_area::text is distinct from before.origin_area::text then
    raise exception 'A small move inside the area should keep the area';
  end if;

  update public.commutes
  set origin = 'SRID=4326;POINT(-122.2466 37.7650)'
  where id = '00000000-0000-0000-0000-0000000000a2';
  select * into after from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  if after.origin_area::text = before.origin_area::text then
    raise exception 'A 1 km move should draw a new area';
  end if;
  perform tests.as_admin();  -- the area helpers are owner-only (0009)
  if extensions.st_distance(after.origin, after.origin_area) > public.area_radius_m() then
    raise exception 'The new area should contain the new point';
  end if;
  if after.origin_area_label is distinct from public.area_label(after.origin_area)
     or not (after.origin_area_label = 'Alameda' or after.origin_area_label like '% area, Alameda') then
    raise exception 'The new area should be labelled again, got %', after.origin_area_label;
  end if;
  perform tests.as_user('00000000-0000-0000-0000-00000000000a');
end
$$;

-- 5 (reverse commute). Cal's passenger row ends where his driver row starts,
-- and that destination reuses the driver row's origin area.
select tests.as_user('00000000-0000-0000-0000-00000000000c');

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c', 'driver',
        'SRID=4326;POINT(-122.2700 37.7700)', 'SRID=4326;POINT(-122.3990 37.7930)', '08:00', '{1}', 1);
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000000c', 'passenger',
        'SRID=4326;POINT(-122.4000 37.7900)', 'SRID=4326;POINT(-122.2700 37.7700)', '17:30', '{1}');

do $$
begin
  if (select destination_area::text from public.commutes where id = '00000000-0000-0000-0000-0000000000c3')
     is distinct from (select origin_area::text from public.commutes where id = '00000000-0000-0000-0000-0000000000c2') then
    raise exception 'A destination at an existing origin should reuse that origin''s area';
  end if;
end
$$;

-- 6. Area centers are spread evenly over the disk: 100 draws all fall within R,
-- their mean distance is about 2R/3, and every quadrant gets some.
select tests.as_admin();
do $$
declare
  home extensions.geography := 'SRID=4326;POINT(-122.2580 37.7650)';
  r double precision := public.area_radius_m();
  c extensions.geography;
  d double precision;
  total double precision := 0;
  quadrant integer[] := array[0,0,0,0];
  q integer;
begin
  for i in 1..100 loop
    c := public.random_area_center(home);
    d := extensions.st_distance(home, c);
    if d > r then
      raise exception 'A drawn center was % m away, outside R', d;
    end if;
    total := total + d;
    q := floor(extensions.st_azimuth(home, c) / (pi() / 2))::integer + 1;
    quadrant[least(q, 4)] := quadrant[least(q, 4)] + 1;
  end loop;
  if total / 100 not between 0.55 * r and 0.78 * r then
    raise exception 'Mean distance % m is not about 2R/3', total / 100;
  end if;
  if (select min(x) from unnest(quadrant) x) < 10 then
    raise exception 'Draws are not spread over all directions: %', quadrant;
  end if;
end
$$;

-- 7. Nobody else can read a commute (exact points or areas), and anon can't query.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  n integer;
begin
  if (select count(*) from public.commutes) <> 0 then
    raise exception 'Bea can read other people''s commutes';
  end if;
  update public.commutes set origin_area_label = 'Hacked';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Bea updated % commutes she does not own', n;
  end if;
end
$$;

select tests.as_anon();
do $$
begin
  begin
    perform 1 from public.commutes;
    raise exception 'anon can query commutes';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- 8. within_area: true inside R of the area center, false outside, and a spot
-- near the exact point but more than R from the center is outside. (Owner-only
-- since 0009, so this runs as admin.)
select tests.as_admin();
do $$
declare
  center extensions.geography := 'SRID=4326;POINT(-122.2580 37.7650)';
  exact extensions.geography := extensions.st_project('SRID=4326;POINT(-122.2580 37.7650)'::extensions.geography, 300, 0);
begin
  if not public.within_area(center, extensions.st_project(center, 300, 1)) then
    raise exception 'A spot 300 m from the center should be inside';
  end if;
  if public.within_area(center, extensions.st_project(center, 500, 1)) then
    raise exception 'A spot 500 m from the center should be outside';
  end if;
  if public.within_area(center, extensions.st_project(exact, 300, 0)) then
    raise exception 'A spot 300 m from the exact point but 600 m from the center should be outside';
  end if;
end
$$;

-- 9. Weekdays are ISO 1–5, non-empty, one-dimensional, with no nulls, and are
-- stored sorted and de-duplicated.
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  bad text;
begin
  foreach bad in array array['{}', '{0}', '{6}', '{7}', '{{1,2},{3,4}}', '{1,NULL}'] loop
    begin
      insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays)
      values ('00000000-0000-0000-0000-00000000000b', 'passenger',
              'SRID=4326;POINT(-122.2833 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '07:30', bad::integer[]);
      raise exception 'weekdays % was accepted', bad;
    exception when check_violation then
      null;
    end;
  end loop;
  begin
    insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays)
    values ('00000000-0000-0000-0000-00000000000b', 'passenger',
            'SRID=4326;POINT(-122.2833 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '07:30', null);
    raise exception 'null weekdays was accepted';
  exception when not_null_violation then
    null;
  end;
  begin
    insert into public.commutes (owner_id, role, origin, destination, departure_time)
    values ('00000000-0000-0000-0000-00000000000b', 'passenger',
            'SRID=4326;POINT(-122.2833 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '07:30');
    raise exception 'A commute with no weekdays was accepted';
  exception when not_null_violation or check_violation then
    null;
  end;
end
$$;

insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays, brings_scooter)
values ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000b', 'passenger',
        'SRID=4326;POINT(-122.2833 37.7652)', 'SRID=4326;POINT(-122.3959 37.7936)', '07:30', '{3,1,1}', true);

do $$
begin
  if (select weekdays from public.commutes where id = '00000000-0000-0000-0000-0000000000b3') is distinct from '{1,3}'::integer[] then
    raise exception 'weekdays {3,1,1} should be stored as {1,3}';
  end if;
end
$$;

-- 10. Departure is a whole minute, and the time zone is Los Angeles.
-- 11. A driver commute offers 1–8 seats; a passenger commute offers none and has no vehicle.
-- 14. Only a passenger brings a scooter.
-- 13. At most one commute per role per person.
do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    -- 10
    $q$insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
       values ('00000000-0000-0000-0000-00000000000b', 'driver', 'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '07:30:15', '{1}', 1)$q$,
    $q$insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered, timezone)
       values ('00000000-0000-0000-0000-00000000000b', 'driver', 'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '07:30', '{1}', 1, 'America/New_York')$q$,
    -- 11
    $q$insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays)
       values ('00000000-0000-0000-0000-00000000000b', 'driver', 'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '07:30', '{1}')$q$,
    $q$insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
       values ('00000000-0000-0000-0000-00000000000b', 'driver', 'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '07:30', '{1}', 0)$q$,
    $q$insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
       values ('00000000-0000-0000-0000-00000000000b', 'driver', 'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '07:30', '{1}', 9)$q$,
    $q$update public.commutes set seats_offered = 1 where id = '00000000-0000-0000-0000-0000000000b3'$q$,
    $q$update public.commutes set vehicle_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000b3'$q$,
    -- 14
    $q$insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered, brings_scooter)
       values ('00000000-0000-0000-0000-00000000000b', 'driver', 'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '07:30', '{1}', 1, true)$q$
  ] loop
    begin
      execute stmt;
      raise exception 'Accepted: %', stmt;
    exception when check_violation then
      null;
    end;
  end loop;

  -- 13
  begin
    insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays)
    values ('00000000-0000-0000-0000-00000000000b', 'passenger',
            'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '08:00', '{2}');
    raise exception 'Bea saved a second passenger commute';
  exception when unique_violation then
    null;
  end;
end
$$;

-- 12. Seats can't exceed the vehicle's, and lowering the vehicle's seats lowers the offer.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
begin
  begin
    update public.commutes set seats_offered = 4 where id = '00000000-0000-0000-0000-0000000000a2';
    raise exception 'Ada offered 4 seats in a 3-seat car';
  exception when check_violation then
    null;
  end;

  update public.vehicles set passenger_seats = 1 where id = '00000000-0000-0000-0000-0000000000a1';
  if (select seats_offered from public.commutes where id = '00000000-0000-0000-0000-0000000000a2') is distinct from 1 then
    raise exception 'Lowering the car to 1 seat should lower the commute''s offer to 1';
  end if;
end
$$;

-- 13 (driver). A second driver commute for Ada is rejected.
do $$
begin
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
  values ('00000000-0000-0000-0000-00000000000a', 'driver',
          'SRID=4326;POINT(-122.28 37.76)', 'SRID=4326;POINT(-122.39 37.79)', '08:00', '{2}', 1);
  raise exception 'Ada saved a second driver commute';
exception when unique_violation then
  null;
end
$$;

-- 22. Known centers get the expected labels: a San Francisco neighborhood, a
-- city with no neighborhood data, and the regional fallback outside every polygon.
-- (East Bay neighborhood labels are tested in east_bay_neighborhoods_test.sql.)
select tests.as_admin();
do $$
declare
  got text;
begin
  got := public.area_label('SRID=4326;POINT(-122.4180 37.7600)');
  if got is distinct from 'Mission area, San Francisco' then
    raise exception 'Mission center labelled %', got;
  end if;
  got := public.area_label('SRID=4326;POINT(-122.3990 37.7930)');
  if got is distinct from 'Financial District/South Beach area, San Francisco' then
    raise exception 'Financial District center labelled %', got;
  end if;
  got := public.area_label('SRID=4326;POINT(-122.2950 37.8390)');  -- Emeryville
  if got is distinct from 'Emeryville' then
    raise exception 'Emeryville center labelled %', got;
  end if;
  got := public.area_label('SRID=4326;POINT(-122.0650 37.9100)');  -- Walnut Creek
  if got is distinct from 'East Bay' then
    raise exception 'A center outside every polygon, nearest the East Bay, labelled %', got;
  end if;
  got := public.area_label('SRID=4326;POINT(-122.4700 37.6880)');  -- Daly City
  if got is distinct from 'San Francisco' then
    raise exception 'A center outside every polygon, nearest San Francisco, labelled %', got;
  end if;
end
$$;

-- 23. The label comes from the area center, never the pin. Bea's pin sits in
-- the Mission 55 m from Bernal Heights; redraw until the center lands outside
-- the Mission, and check the label follows the center. Every draw must match
-- area_label(center). (Chance of no crossing in 40 draws: about 1e-9.)
select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
declare
  pin extensions.geography := 'SRID=4326;POINT(-122.4180 37.7487)';
  pin_label text;
  c public.commutes;
  crossed boolean := false;
begin
  -- area_label is owner-only (0009): read labels as admin, save commutes as Bea.
  perform tests.as_admin();
  pin_label := public.area_label('SRID=4326;POINT(-122.4180 37.7487)');
  perform tests.as_user('00000000-0000-0000-0000-00000000000b');
  if pin_label is distinct from 'Mission area, San Francisco' then
    raise exception 'Test setup: the pin should be in the Mission, got %', pin_label;
  end if;
  for i in 1..40 loop
    insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered)
    values ('00000000-0000-0000-0000-00000000000b', 'driver', pin, 'SRID=4326;POINT(-122.3990 37.7930)', '07:30', '{1}', 1)
    returning * into c;
    perform tests.as_admin();
    if c.origin_area_label is distinct from public.area_label(c.origin_area) then
      raise exception 'Label % does not match its center''s label %', c.origin_area_label, public.area_label(c.origin_area);
    end if;
    perform tests.as_user('00000000-0000-0000-0000-00000000000b');
    if c.origin_area_label <> pin_label then
      crossed := true;
    end if;
    delete from public.commutes where id = c.id;
    exit when crossed;
  end loop;
  if not crossed then
    raise exception 'In 40 draws no label differed from the pin''s; the label may come from the pin';
  end if;
end
$$;

-- 15. place_boundaries is reference data: clients can neither read nor write it.
do $$
begin
  begin
    perform 1 from public.place_boundaries;
    raise exception 'authenticated can read place_boundaries';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.place_boundaries (id, kind, name, city, source, license, geom)
    values ('x', 'city', 'X', 'X', 'x', 'x', 'SRID=4326;MULTIPOLYGON(((0 0,0 1,1 1,0 0)))');
    raise exception 'authenticated can insert into place_boundaries';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.place_boundaries set name = 'Hacked';
    raise exception 'authenticated can update place_boundaries';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.place_boundaries;
    raise exception 'authenticated can delete from place_boundaries';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

select tests.as_anon();
do $$
begin
  begin
    perform 1 from public.place_boundaries;
    raise exception 'anon can read place_boundaries';
  exception when insufficient_privilege then
    null;
  end;
  begin
    delete from public.place_boundaries;
    raise exception 'anon can delete from place_boundaries';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

select tests.as_admin();
do $$
begin
  if (select count(*) from public.place_boundaries where kind = 'city') <> 9
     or (select count(*) from public.place_boundaries where kind = 'neighborhood') < 30 then
    raise exception 'Expected 9 cities and the San Francisco neighborhoods';
  end if;
  if exists (select 1 from public.place_boundaries
             where coalesce(btrim(source), '') = '' or coalesce(btrim(license), '') = ''
                or not extensions.st_isvalid(geom)) then
    raise exception 'Every boundary needs a source, a licence and valid geometry';
  end if;
end
$$;

-- 16. Ride preferences are quiet and smoke_free only, and no gender data exists.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  bad text;
begin
  update public.profiles set ride_prefs = '{quiet,smoke_free}' where id = '00000000-0000-0000-0000-00000000000a';
  foreach bad in array array['{women_only}', '{loud}', '{quiet,NULL}', '{{quiet}}'] loop
    begin
      update public.profiles set ride_prefs = bad::text[] where id = '00000000-0000-0000-0000-00000000000a';
      raise exception 'ride_prefs % was accepted', bad;
    exception when check_violation then
      null;
    end;
  end loop;
  if (select ride_prefs from public.profiles where id = '00000000-0000-0000-0000-00000000000a') is distinct from '{quiet,smoke_free}'::text[] then
    raise exception 'Ada''s ride preferences should be saved';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and column_name ~* '(gender|sex)') then
    raise exception 'A gender column exists (D-05)';
  end if;
end
$$;

-- 17. Plates are stored uppercase without spaces or dashes, bad ones are
-- rejected, colors are trimmed, and nobody else can read the plate.
do $$
declare
  bad text;
begin
  update public.vehicles set plate = ' 7abc-123 ', color = '  Blue  ' where id = '00000000-0000-0000-0000-0000000000a1';
  if (select plate from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1') is distinct from '7ABC123'
     or (select color from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1') is distinct from 'Blue' then
    raise exception 'Plate and color should be normalized';
  end if;
  foreach bad in array array['X', 'ABC!12', 'ABCDEFGHI'] loop
    begin
      update public.vehicles set plate = bad where id = '00000000-0000-0000-0000-0000000000a1';
      raise exception 'Plate % was accepted', bad;
    exception when check_violation then
      null;
    end;
  end loop;
  begin
    update public.vehicles set color = repeat('x', 31) where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'A 31-character color was accepted';
  exception when check_violation then
    null;
  end;
  update public.vehicles set color = '   ' where id = '00000000-0000-0000-0000-0000000000a1';
  if (select color from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1') is not null then
    raise exception 'A blank color should be stored as null';
  end if;
end
$$;

select tests.as_user('00000000-0000-0000-0000-00000000000b');
do $$
begin
  if exists (select 1 from public.vehicles where owner_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'Bea can read Ada''s vehicle and plate';
  end if;
end
$$;

-- 18. Deleting the vehicle a driver commute uses detaches it and leaves the
-- areas and seats alone.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
do $$
declare
  before public.commutes;
  after public.commutes;
begin
  select * into before from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  delete from public.vehicles where id = '00000000-0000-0000-0000-0000000000a1';
  select * into after from public.commutes where id = '00000000-0000-0000-0000-0000000000a2';
  if after.vehicle_id is not null
     or after.seats_offered is distinct from before.seats_offered
     or after.origin_area::text is distinct from before.origin_area::text
     or after.destination_area::text is distinct from before.destination_area::text
     or after.origin_area_label is distinct from before.origin_area_label then
    raise exception 'Deleting the vehicle should only detach it from the commute';
  end if;
end
$$;

-- 19. Deleting an account with a vehicle and both commute rows cascades cleanly.
select tests.as_user('00000000-0000-0000-0000-00000000000d');
insert into public.vehicles (id, owner_id, make, model, passenger_seats) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000d', 'Kia', 'Niro', 2);
insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, seats_offered, vehicle_id)
values ('00000000-0000-0000-0000-00000000000d', 'driver',
        'SRID=4326;POINT(-122.2600 37.7660)', 'SRID=4326;POINT(-122.3990 37.7930)', '07:30', '{1,2}', 2,
        '00000000-0000-0000-0000-0000000000d1');
insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, brings_scooter)
values ('00000000-0000-0000-0000-00000000000d', 'passenger',
        'SRID=4326;POINT(-122.2600 37.7660)', 'SRID=4326;POINT(-122.3990 37.7930)', '07:30', '{3}', true);

select tests.as_admin();
delete from auth.users where id = '00000000-0000-0000-0000-00000000000d';
do $$
begin
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000d')
     or exists (select 1 from public.vehicles where owner_id = '00000000-0000-0000-0000-00000000000d')
     or exists (select 1 from public.commutes where owner_id = '00000000-0000-0000-0000-00000000000d') then
    raise exception 'Deleting Dee''s account should remove her profile, vehicle and commutes';
  end if;
end
$$;

-- 21. Trigger functions aren't callable by clients, and anon can't call the
-- area helpers. (Since 0009 signed-in users can't either; that's checked in
-- east_bay_neighborhoods_test.sql.)
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.commutes_set_areas()', 'public.commutes_normalize()', 'public.commutes_check_seats()',
    'public.vehicles_normalize()', 'public.vehicles_clamp_seats()'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception '% is executable by a client role', f;
    end if;
  end loop;
  foreach f in array array[
    'public.area_label(extensions.geography)', 'public.random_area_center(extensions.geography)',
    'public.commute_area_for(uuid, uuid, extensions.geography, extensions.geography)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% is executable by anon', f;
    end if;
  end loop;
end
$$;

rollback;

-- Detour estimate (M-33): straight-line distances in PostGIS, times a 1.35
-- road factor at 25 mph, in whole minutes. The pickup must come before the
-- drop-off along the driver's route. Clients can't call any of it.
-- Expected values were worked out with a WGS84 geodesic (Vincenty), and every
-- asserted minute is at least 0.2 min away from a rounding boundary.
begin;

select tests.as_admin();

-- 1. The constants are named and hold the decided values (D-08).
do $$
begin
  if public.detour_road_factor() is distinct from 1.35::double precision then
    raise exception 'Road factor is %, expected 1.35', public.detour_road_factor();
  end if;
  if public.detour_speed_mph() is distinct from 25::double precision then
    raise exception 'Speed is % mph, expected 25', public.detour_speed_mph();
  end if;
  if public.detour_limit_minutes() is distinct from 5 then
    raise exception 'Detour limit is % min, expected 5', public.detour_limit_minutes();
  end if;
end
$$;

-- 2. The estimates return only an integer (minutes) or a boolean: one value,
-- no set, no OUT columns, so no distance or point can come back. They're
-- immutable and pin search_path.
do $$
declare
  t record;
  p record;
begin
  for t in
    select * from (values
      ('public.estimate_trip_minutes(extensions.geography, extensions.geography)', 'integer'),
      ('public.estimate_detour_minutes(extensions.geography, extensions.geography, extensions.geography, extensions.geography)', 'integer'),
      ('public.is_detour_within_limit(extensions.geography, extensions.geography, extensions.geography, extensions.geography)', 'boolean')
    ) v(f, want)
  loop
    select f.prorettype::regtype::text as rettype, f.proretset, f.proallargtypes, f.provolatile, f.proconfig
      into p
      from pg_proc f
     where f.oid = t.f::regprocedure;
    if p.rettype is distinct from t.want or p.proretset or p.proallargtypes is not null then
      raise exception '% returns % (set: %, out args: %), expected a single %',
        t.f, p.rettype, p.proretset, p.proallargtypes, t.want;
    end if;
    if p.provolatile <> 'i' then
      raise exception '% must be immutable', t.f;
    end if;
    if p.proconfig is null or not ('search_path=""' = any (p.proconfig)) then
      raise exception '% must set search_path to empty, has %', t.f, p.proconfig;
    end if;
  end loop;
end
$$;

-- Places used below (lon lat):
--   Park St & Central Ave, Alameda     -122.2446 37.7638  (driver's home)
--   Market & Fremont St, SF (FiDi)     -122.3966 37.7910  (driver's work)
--   Webster St & Central Ave, Alameda  -122.2777 37.7665  (on the way)
--   Webster St, 300 m east             -122.2744 37.7663
--   Montgomery St BART, SF (FiDi)      -122.4021 37.7894
--   Rockridge BART, Oakland            -122.2518 37.8445  (off corridor)
--   Lake Merritt, Oakland              -122.2575 37.8030  (off corridor)
--   West Oakland BART                  -122.2950 37.8050
create temporary table place (name text primary key, pt extensions.geography) on commit drop;
insert into place values
  ('park',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)')),
  ('fremont', extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)')),
  ('webster', extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)')),
  ('webE',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2744 37.7663)')),
  ('mont',    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)')),
  ('rock',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2518 37.8445)')),
  ('lake',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2575 37.8030)')),
  ('wobart',  extensions.st_geogfromtext('SRID=4326;POINT(-122.2950 37.8050)'));

create function pg_temp.pt(n text) returns extensions.geography
language sql stable as $$ select p.pt from place p where p.name = n $$;

-- 3. estimate_trip_minutes: direct distance x 1.35 at 25 mph, nearest minute.
do $$
declare
  t record;
  got integer;
begin
  for t in
    select * from (values
      ('park', 'fremont', 28),   -- 13.73 km -> 27.64 min
      ('webster', 'mont', 23),   -- 11.25 km -> 22.65 min
      ('park', 'park', 0)
    ) v(o, d, want)
  loop
    got := public.estimate_trip_minutes(pg_temp.pt(t.o), pg_temp.pt(t.d));
    if got is distinct from t.want then
      raise exception 'Trip % -> % is % min, expected %', t.o, t.d, got, t.want;
    end if;
  end loop;
  if public.estimate_trip_minutes(null, pg_temp.pt('park')) is not null then
    raise exception 'Trip with a missing point should be null';
  end if;
end
$$;

-- 4-6. estimate_detour_minutes and is_detour_within_limit for an Alameda ->
-- FiDi driver (Park St -> Market & Fremont).
do $$
declare
  t record;
  got integer;
  ok boolean;
begin
  for t in
    select * from (values
      -- 4. On the way: Alameda passengers headed downtown.
      ('webster', 'mont',    2,    true),   -- 1.95 min
      ('webster', 'fremont', 0,    true),   -- 0.05 min
      ('park',    'fremont', 0,    true),   -- same trip as the driver
      -- 5. Off corridor: Oakland pickups.
      ('rock',    'mont',    21,   false),  -- 20.83 min
      ('lake',    'mont',    8,    false),  -- 8.28 min
      -- 6. Reversed: the pickup comes after the drop-off along the driver's route.
      ('mont',    'webster', null, false),
      -- Same two Webster St points as the forward pair below, swapped: the
      -- insertion formula alone gives 1.22 min (within), so only the direction
      -- check can reject it.
      ('webster', 'webE',    null, false),
      ('webE',    'webster', 0,    true)    -- 0.05 min
    ) v(po, pd, want, within)
  loop
    got := public.estimate_detour_minutes(pg_temp.pt('park'), pg_temp.pt('fremont'), pg_temp.pt(t.po), pg_temp.pt(t.pd));
    if got is distinct from t.want then
      raise exception 'Detour for % -> % is % min, expected %', t.po, t.pd, got, t.want;
    end if;
    ok := public.is_detour_within_limit(pg_temp.pt('park'), pg_temp.pt('fremont'), pg_temp.pt(t.po), pg_temp.pt(t.pd));
    if ok is distinct from t.within then
      raise exception 'Within-limit for % -> % is %, expected %', t.po, t.pd, ok, t.within;
    end if;
  end loop;
end
$$;

-- 7. Degenerate input: a driver with no route (origin = destination) has no
-- direction, so nothing qualifies; a missing point gives null / false.
do $$
begin
  if public.estimate_detour_minutes(pg_temp.pt('park'), pg_temp.pt('park'), pg_temp.pt('park'), pg_temp.pt('webster')) is not null then
    raise exception 'A zero-length driver route should give no estimate';
  end if;
  if public.estimate_detour_minutes(pg_temp.pt('park'), pg_temp.pt('fremont'), null, pg_temp.pt('mont')) is not null then
    raise exception 'A detour with a missing point should be null';
  end if;
  if public.is_detour_within_limit(pg_temp.pt('park'), pg_temp.pt('fremont'), null, pg_temp.pt('mont')) is distinct from false then
    raise exception 'Within-limit with a missing point should be false';
  end if;
end
$$;

-- Sample estimates for the CI log (not assertions beyond the cases above).
do $$
declare
  t record;
begin
  for t in select * from (values ('webster'), ('wobart'), ('lake'), ('rock')) v(po) loop
    raise notice 'sample: Park St, Alameda -> Market & Fremont; pickup % -> Montgomery BART: % min detour, within: %',
      t.po,
      public.estimate_detour_minutes(pg_temp.pt('park'), pg_temp.pt('fremont'), pg_temp.pt(t.po), pg_temp.pt('mont')),
      public.is_detour_within_limit(pg_temp.pt('park'), pg_temp.pt('fremont'), pg_temp.pt(t.po), pg_temp.pt('mont'));
  end loop;
end
$$;

-- 8. Clients (anon, authenticated) can't execute any of it: these take exact
-- points, so only security definer functions and the service role call them.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.estimate_trip_minutes(extensions.geography, extensions.geography)',
    'public.estimate_detour_minutes(extensions.geography, extensions.geography, extensions.geography, extensions.geography)',
    'public.is_detour_within_limit(extensions.geography, extensions.geography, extensions.geography, extensions.geography)',
    'public.detour_road_factor()',
    'public.detour_speed_mph()',
    'public.detour_limit_minutes()',
    'public.road_minutes(double precision)'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is executable by authenticated', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% is executable by anon', f;
    end if;
  end loop;
end
$$;

-- A security definer function (as M-26's matching will be) can still call them
-- for a signed-in person, without handing out the inputs.
create function public.test_detour_via_definer() returns integer
language sql security definer set search_path = '' as $$
  select public.estimate_detour_minutes(
    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)'),
    extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)'),
    extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)'),
    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)'))
$$;
grant execute on function public.test_detour_via_definer() to authenticated;

-- Runs each estimate as the current role and expects a privilege error.
create function pg_temp.expect_denied(who text) returns void
language plpgsql as $$
declare
  call text;
begin
  foreach call in array array[
    'select public.estimate_trip_minutes(''SRID=4326;POINT(-122.2446 37.7638)'', ''SRID=4326;POINT(-122.3966 37.7910)'')',
    'select public.estimate_detour_minutes(''SRID=4326;POINT(-122.2446 37.7638)'', ''SRID=4326;POINT(-122.3966 37.7910)'', ''SRID=4326;POINT(-122.2777 37.7665)'', ''SRID=4326;POINT(-122.4021 37.7894)'')',
    'select public.is_detour_within_limit(''SRID=4326;POINT(-122.2446 37.7638)'', ''SRID=4326;POINT(-122.3966 37.7910)'', ''SRID=4326;POINT(-122.2777 37.7665)'', ''SRID=4326;POINT(-122.4021 37.7894)'')',
    'select public.road_minutes(1000)',
    'select public.detour_road_factor()'
  ] loop
    begin
      execute call;
      raise exception '% can run: %', who, call;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end
$$;

select tests.as_user('00000000-0000-0000-0000-0000000000d1');
do $$
begin
  if public.test_detour_via_definer() is distinct from 2 then
    raise exception 'A security definer caller should get the estimate';
  end if;
end
$$;

-- Calling them directly fails, signed in or not.
select pg_temp.expect_denied('authenticated');

select tests.as_anon();
select pg_temp.expect_denied('anon');

rollback;

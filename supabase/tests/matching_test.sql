-- Matching (M-26): public.find_matches and its internal helpers.
-- Spec: docs/superpowers/specs/2026-10-10-matching-rpc-design.md, section 10.
--
-- The ride date is the next Wednesday after today in America/Los_Angeles. Every
-- driver below goes Park St -> Market & Fremont at 7:40 (flex 15, Mon-Fri, 3 seats,
-- trunk fits a scooter, vetted, opted in) unless noted. Ada's pickup is Webster St
-- -> Montgomery BART, so the Park St route is a 2-minute detour (1.95 min, M-33's
-- test). Expected minutes were worked out with a WGS84 geodesic (Vincenty) and are
-- at least 0.2 min from a rounding boundary.
--
-- Callers and candidates (ids end in 26xx):
--   01 Ada   passenger, Webster -> Montgomery 7:45, Mon-Thu, brings a scooter, prefers quiet
--   Included for Ada, in rank order. Rank starts from the detour BAND (0-2 min, then
--   3-5 min), never the exact minutes, then the time gap and the other keys:
--   12 Dee   Webster -> Montgomery 7:45, Wed only        0 min (same trip)
--   13 Bel   connected with Ada (Ride Again)
--   14 Ben   prefers quiet and smoke-free
--   15 Hov   one confirmed passenger (Hop) that date: 2 of 3 seats open, reaches 3 people
--   10 Bea   the plain match
--   11 Tia   max_detour_minutes 2 (2-minute pair: included); same keys as Bea, higher id
--   16 Bry   Mon-Wed (shares 3 days)
--   17 Bo    "Both": drives Wed and Fri; rides Webster -> Montgomery 7:45 Mon-Fri
--   18 Gus   7:55 (10 min later)
--   1c Dex   Webster -> Montgomery 7:55: 0 min, same band as Gus's 2 min, so it
--            follows Gus on the next keys (id), and ranks after Bea despite fewer minutes
--   1b Ear   7:20 (25 min earlier)
--   19 Hal   8:15 (30 min later: the window boundary, included)
--   1a Cal   from near Laney College, Oakland, 7:45: 4 min (4.02), the 3-5 band
--   1d Tre   from near Lake Merritt Channel -> Montgomery, 7:45: exactly 3 min (3.00),
--            the 3-5 band's lower edge; after Cal (4 min) on id, not before it on minutes
--   Excluded for Ada, one rule each:
--   20 Opal opted out; 21 Sam suspended (also rides); 22 Bob blocked by Ada;
--   23 Bix blocked Ada; 24 Uma unvetted (also rides, and is visible as a passenger);
--   25 Nov no vehicle; 26 Wen Mon-Tue only; 27 Lat 8:16 (31 min, outside);
--   28 Far from Lake Merritt (8 min); 29 Rev reversed (Fremont -> Park St);
--   2a Max the Laney route with max_detour_minutes 3; 2b Full 1 seat, booked by Rid;
--   2c Box trunk doesn't fit a scooter; 2d Pas has a confirmed ride as a passenger (Zed)
--   Passengers: 30 Pia (plain; a cancelled ride with Bea that date counts for nothing), 32 Rid (has a ride that date), 33 Hop (opted out, no commute)
--   Others: 34 Zed (opted-out driver), 35 Cy ("Both", opted out), 36 Nop (no profile)
begin;

select tests.as_admin();

-- Helpers --------------------------------------------------------------------------

create temporary table place (name text primary key, pt extensions.geography) on commit drop;
insert into place values
  ('park',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)')),  -- Park St & Central Ave, Alameda
  ('fremont', extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)')),  -- Market & Fremont St, SF
  ('webster', extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)')),  -- Webster St & Central Ave, Alameda
  ('mont',    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)')),  -- Montgomery St BART, SF
  ('lake',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2575 37.8030)')),  -- Lake Merritt, Oakland
  ('laney',   extensions.st_geogfromtext('SRID=4326;POINT(-122.2560 37.7830)')),  -- near Laney College, Oakland
  ('tre',     extensions.st_geogfromtext('SRID=4326;POINT(-122.2600 37.7870)')),  -- near Lake Merritt Channel, Oakland
  ('wc',      extensions.st_geogfromtext('SRID=4326;POINT(-122.0652 37.9101)'));  -- Walnut Creek

create function pg_temp.pt(n text) returns extensions.geography
language sql stable as $$ select p.pt from place p where p.name = n $$;

create function pg_temp.uid(n text) returns uuid
language sql immutable as $$ select ('00000000-0000-0000-0000-0000000026' || n)::uuid $$;

create function pg_temp.la_today() returns date
language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- The next Wednesday strictly after today.
create function pg_temp.day() returns date
language sql stable as $$
  select pg_temp.la_today()
    + ((3 - extract(isodow from pg_temp.la_today())::integer + 6) % 7) + 1
$$;

create function pg_temp.member(
  n text, display text, opt_in boolean default true, vetted boolean default true,
  prefs text[] default '{}'
) returns void
language sql as $$
  insert into auth.users (id, email) values (pg_temp.uid(n), 'm' || n || '@example.test');
  insert into public.profiles (id, display_name, discovery_opt_in, vetted_at, ride_prefs)
  values (pg_temp.uid(n), display, opt_in, case when vetted then now() end, prefs);
$$;

create function pg_temp.driver(
  n text, o text default 'park', dest text default 'fremont', dep time default '07:40',
  days integer[] default '{1,2,3,4,5}', seats integer default 3, fits boolean default true,
  max_detour integer default 5, with_vehicle boolean default true
) returns uuid
language plpgsql as $$
declare
  vid uuid;
  cid uuid;
begin
  if with_vehicle then
    insert into public.vehicles (owner_id, make, model, color, plate, passenger_seats, accepts_foldable_scooters)
    values (pg_temp.uid(n), 'Toyota', 'Prius', 'Blue', 'BEA123', seats, fits)
    returning id into vid;
  end if;
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays,
                               departure_flex_minutes, vehicle_id, seats_offered, max_detour_minutes)
  values (pg_temp.uid(n), 'driver', pg_temp.pt(o), pg_temp.pt(dest), dep, days,
          15, vid, seats, max_detour)
  returning id into cid;
  return cid;
end
$$;

create function pg_temp.passenger(
  n text, dep time default '07:45', days integer[] default '{1,2,3,4,5}', scooter boolean default false
) returns uuid
language plpgsql as $$
declare
  cid uuid;
begin
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays,
                               departure_flex_minutes, brings_scooter)
  values (pg_temp.uid(n), 'passenger', pg_temp.pt('webster'), pg_temp.pt('mont'), dep, days,
          15, scooter)
  returning id into cid;
  return cid;
end
$$;

-- A ride (confirmed unless st says otherwise) on the test date, behind an accepted invitation on the driver's commute.
create function pg_temp.ride(drv text, pax text, st text default 'confirmed') returns void
language plpgsql as $$
declare
  inv uuid;
begin
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date)
  select pg_temp.uid(pax), pg_temp.uid(drv), c.id, 'accepted', pg_temp.day()
  from public.commutes c
  where c.owner_id = pg_temp.uid(drv) and c.role = 'driver'
  returning id into inv;
  insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind)
  values (inv, pg_temp.uid(drv), pg_temp.uid(pax), pg_temp.day(), '07:40', st, 'first_ride');
end
$$;

-- find_matches as member n, as a jsonb array in rank order. Back to admin afterwards.
create function pg_temp.matches(n text, filter text default 'all', on_date date default null)
returns jsonb
language plpgsql as $$
declare
  res jsonb;
begin
  perform tests.as_user(pg_temp.uid(n));
  select coalesce(jsonb_agg(to_jsonb(m) order by m.rank), '[]'::jsonb) into res
  from public.find_matches(coalesce(on_date, pg_temp.day()), filter) m;
  perform tests.as_admin();
  return res;
end
$$;

-- 'id:role' keys in rank order, ids shortened to their last two characters.
create function pg_temp.keys(res jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(right(x.e ->> 'other_id', 2) || ':' || (x.e ->> 'role') order by x.i), '{}')
  from jsonb_array_elements(res) with ordinality as x(e, i)
$$;

create function pg_temp.row_for(res jsonb, n text, r text default 'driver') returns jsonb
language sql immutable as $$
  select x.e from jsonb_array_elements(res) as x(e)
  where right(x.e ->> 'other_id', 2) = n and x.e ->> 'role' = r
$$;

-- The SQLSTATE find_matches raises for a caller ('admin', 'anon' or a member code),
-- or null when it returns.
create function pg_temp.match_error(who text, on_date date, filter text default 'all')
returns text
language plpgsql as $$
begin
  if who = 'admin' then
    perform tests.as_admin();
  elsif who = 'anon' then
    perform tests.as_anon();
  else
    perform tests.as_user(pg_temp.uid(who));
  end if;
  begin
    perform 1 from public.find_matches(on_date, filter);
  exception when others then
    perform tests.as_admin();
    return sqlstate;
  end;
  perform tests.as_admin();
  return null;
end
$$;

-- Fixture ------------------------------------------------------------------------------

select pg_temp.member('01', 'Ada Lovelace', vetted => false, prefs => '{quiet}');
select pg_temp.passenger('01', days => '{1,2,3,4}', scooter => true);

select pg_temp.member('10', 'Bea Brown');      select pg_temp.driver('10');
select pg_temp.member('11', 'Tia Tan');        select pg_temp.driver('11', max_detour => 2);
select pg_temp.member('12', 'Dee Diaz');       select pg_temp.driver('12', 'webster', 'mont', '07:45', '{3}');
select pg_temp.member('13', 'Bel Bell');       select pg_temp.driver('13');
select pg_temp.member('14', 'Ben Bond', prefs => '{quiet,smoke_free}'); select pg_temp.driver('14');
select pg_temp.member('15', 'Hov Hill');       select pg_temp.driver('15');
select pg_temp.member('16', 'Bry Burr');       select pg_temp.driver('16', days => '{1,2,3}');
select pg_temp.member('17', 'Bo Bose');        select pg_temp.driver('17', days => '{3,5}');
                                               select pg_temp.passenger('17');
select pg_temp.member('18', 'Gus Gray');       select pg_temp.driver('18', dep => '07:55');
select pg_temp.member('1b', 'Ear Earl');       select pg_temp.driver('1b', dep => '07:20');
select pg_temp.member('19', 'Hal Hart');       select pg_temp.driver('19', dep => '08:15');
select pg_temp.member('1a', 'Cal Cole');       select pg_temp.driver('1a', 'laney', 'fremont', '07:45');
select pg_temp.member('1c', 'Dex Dunn');       select pg_temp.driver('1c', 'webster', 'mont', '07:55');
select pg_temp.member('1d', 'Tre Tate');       select pg_temp.driver('1d', 'tre', 'mont', '07:45');

select pg_temp.member('20', 'Opal Ortiz', opt_in => false); select pg_temp.driver('20');
select pg_temp.member('21', 'Sam Stone');      select pg_temp.driver('21');
                                               select pg_temp.passenger('21');
select pg_temp.member('22', 'Bob Boyd');       select pg_temp.driver('22');
select pg_temp.member('23', 'Bix Bauer');      select pg_temp.driver('23');
select pg_temp.member('24', 'Uma Ueda', vetted => false); select pg_temp.driver('24');
                                               select pg_temp.passenger('24');
select pg_temp.member('25', 'Nov Noel');       select pg_temp.driver('25', with_vehicle => false);
select pg_temp.member('26', 'Wen Wong');       select pg_temp.driver('26', days => '{1,2}');
select pg_temp.member('27', 'Lat Lane');       select pg_temp.driver('27', dep => '08:16');
select pg_temp.member('28', 'Far Ford');       select pg_temp.driver('28', 'lake', 'fremont');
select pg_temp.member('29', 'Rev Reed');       select pg_temp.driver('29', 'fremont', 'park');
select pg_temp.member('2a', 'Max Moss');       select pg_temp.driver('2a', 'laney', 'fremont', '07:45', max_detour => 3);
select pg_temp.member('2b', 'Full Fox');       select pg_temp.driver('2b', seats => 1);
select pg_temp.member('2c', 'Box Boxer');      select pg_temp.driver('2c', fits => false);
select pg_temp.member('2d', 'Pas Page');       select pg_temp.driver('2d');

select pg_temp.member('30', 'Pia Park');       select pg_temp.passenger('30');
select pg_temp.member('32', 'Rid Rhee');       select pg_temp.passenger('32');
select pg_temp.member('33', 'Hop Hope', opt_in => false);
select pg_temp.member('34', 'Zed Zane', opt_in => false); select pg_temp.driver('34');
select pg_temp.member('35', 'Cy Chen', opt_in => false); select pg_temp.driver('35');
                                               select pg_temp.passenger('35');
insert into auth.users (id, email) values (pg_temp.uid('36'), 'm36@example.test');

select pg_temp.ride('15', '33');   -- Hov drives Hop
select pg_temp.ride('2b', '32');   -- Full drives Rid (Full's only seat)
select pg_temp.ride('34', '2d');   -- Zed drives Pas
select pg_temp.ride('10', '30', 'cancelled');   -- cancelled: uses neither Bea's seat nor Pia's date

insert into public.connections (user_low, user_high, crew_eligible)
values (pg_temp.uid('01'), pg_temp.uid('13'), false);

insert into public.blocks (blocker_id, blocked_id) values
  (pg_temp.uid('01'), pg_temp.uid('22')),   -- Ada blocked Bob
  (pg_temp.uid('23'), pg_temp.uid('01'));   -- Bix blocked Ada

update public.profiles set suspended_at = now() where id = pg_temp.uid('21');

-- 1. Privileges and shape --------------------------------------------------------------
do $$
declare
  f record;
  p record;
begin
  for f in
    select * from (values
      ('public.find_matches(date, text)', true, true),
      ('public.match_candidates(uuid, date)', false, false),
      ('public.match_prefilter(extensions.geography, extensions.geography, extensions.geography, extensions.geography)', false, false),
      ('public.match_days_label(integer[])', false, false)
    ) v(sig, client, definer)
  loop
    if has_function_privilege('anon', f.sig, 'execute') then
      raise exception '% is executable by anon', f.sig;
    end if;
    if has_function_privilege('authenticated', f.sig, 'execute') is distinct from f.client then
      raise exception '% execute by authenticated should be %', f.sig, f.client;
    end if;
    select pr.prosecdef, pr.proconfig into p from pg_proc pr where pr.oid = f.sig::regprocedure;
    if p.prosecdef is distinct from f.definer then
      raise exception '% security definer should be %', f.sig, f.definer;
    end if;
    if p.proconfig is null or not ('search_path=""' = any (p.proconfig)) then
      raise exception '% must set search_path to empty, has %', f.sig, p.proconfig;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc pr, unnest(pr.proallargtypes, pr.proargmodes) as u(t, m)
    where pr.oid in ('public.find_matches(date, text)'::regprocedure,
                     'public.match_candidates(uuid, date)'::regprocedure)
      and u.m = 't'
      and u.t in ('extensions.geography'::regtype, 'extensions.geometry'::regtype)
  ) then
    raise exception 'A matching function returns a geography or geometry column';
  end if;
end
$$;

-- 2. No exact detour minutes leave find_matches (owner, Q8) -------------------------------
do $$
declare
  cols text[];
  res jsonb := pg_temp.matches('01', 'driver') || pg_temp.matches('10', 'passenger');
begin
  select array_agg(u.n order by u.i) into cols
  from pg_proc pr, unnest(pr.proargnames, pr.proargmodes) with ordinality as u(n, m, i)
  where pr.oid = 'public.find_matches(date, text)'::regprocedure and u.m = 't';

  if cols is distinct from array[
    'other_id', 'role', 'name', 'vetted', 'ride_prefs',
    'origin_area_lat', 'origin_area_lng', 'origin_area_label',
    'destination_area_lat', 'destination_area_lng', 'destination_area_label',
    'area_radius_m', 'shared_weekdays', 'departure_time', 'window_start', 'window_end',
    'departure_gap_minutes', 'detour_band', 'seats_offered', 'seats_open',
    'brings_scooter', 'scooter_fits', 'connected', 'reasons', 'rank'] then
    raise exception 'find_matches output columns are %', cols;
  end if;

  if exists (select 1 from unnest(cols) c where c like '%minute%' and c <> 'departure_gap_minutes') then
    raise exception 'An output column carries minutes: %', cols;
  end if;

  if exists (
    select 1 from jsonb_array_elements(res) e
    where e ->> 'detour_band' not in ('under_3', '3_to_5') or e ->> 'detour_band' is null
  ) then
    raise exception 'detour_band outside its two values: %', res;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(res) e, jsonb_array_elements(e -> 'reasons') r
    where r ->> 'code' = 'detour'
      and r ->> 'label' not in ('Under 3 min detour', '3–5 min detour')
  ) then
    raise exception 'A detour reason shows something other than a band: %', res;
  end if;

  if (select count(*) from jsonb_array_elements(res) e) < 10 then
    raise exception 'Expected the fixture rows, got %', res;
  end if;
end
$$;

-- 3. Caller checks ----------------------------------------------------------------------
do $$
declare
  saturday date := pg_temp.la_today() + ((6 - extract(isodow from pg_temp.la_today())::integer + 7) % 7);
begin
  if pg_temp.match_error('admin', pg_temp.day()) is distinct from '42501' then
    raise exception 'No signed-in member should raise 42501';
  end if;
  if pg_temp.match_error('anon', pg_temp.day()) is distinct from '42501' then
    raise exception 'anon should be refused with 42501';
  end if;
  if pg_temp.match_error('01', null) is distinct from '22023' then
    raise exception 'A null date should raise 22023';
  end if;
  if pg_temp.match_error('01', pg_temp.la_today() - 1) is distinct from '22023' then
    raise exception 'A past date should raise 22023';
  end if;
  if pg_temp.match_error('01', pg_temp.day(), 'drivers') is distinct from '22023' then
    raise exception 'An unknown role filter should raise 22023';
  end if;
  if pg_temp.match_error('01', pg_temp.la_today()) is not null then
    raise exception 'Today is a valid date';
  end if;

  if pg_temp.matches('01', 'all', saturday) <> '[]'::jsonb then
    raise exception 'A Saturday should return nothing';
  end if;
  if pg_temp.matches('36') <> '[]'::jsonb then
    raise exception 'A member with no profile should get nothing';
  end if;
  if pg_temp.matches('26') <> '[]'::jsonb then
    raise exception 'A member with no commute on that weekday should get nothing';
  end if;
  if pg_temp.matches('21') <> '[]'::jsonb then
    raise exception 'A suspended member should get nothing';
  end if;
  if pg_temp.matches('01', 'passenger') <> '[]'::jsonb then
    raise exception 'Ada only rides, so she has no passenger matches';
  end if;
  if not (pg_temp.keys(pg_temp.matches('20', 'passenger')) @> array['01:passenger']) then
    raise exception 'An opted-out member can still browse (D-14)';
  end if;
end
$$;

-- 4. Every hard filter and the ranking, for Ada ------------------------------------------
do $$
declare
  got text[] := pg_temp.keys(pg_temp.matches('01', 'driver'));
  want text[] := array[
    '12:driver', '13:driver', '14:driver', '15:driver', '10:driver', '11:driver',
    '16:driver', '17:driver', '18:driver', '1c:driver', '1b:driver', '19:driver', '1a:driver', '1d:driver'];
  excluded text;
begin
  foreach excluded in array array['20', '21', '22', '23', '24', '25', '26', '27', '28', '29',
                                  '2a', '2b', '2c', '2d', '30', '32', '34', '35', '01'] loop
    if exists (select 1 from unnest(got) k where k like excluded || ':%') then
      raise exception 'Ada should not see % (got %)', excluded, got;
    end if;
  end loop;
  if got is distinct from want then
    raise exception 'Ada''s drivers are %, expected %', got, want;
  end if;
  if pg_temp.keys(pg_temp.matches('01')) is distinct from want
     or pg_temp.keys(pg_temp.matches('01', null)) is distinct from want then
    raise exception 'all and null should return the same as driver for Ada';
  end if;
  if (select array_agg((e ->> 'rank')::integer order by i)
      from jsonb_array_elements(pg_temp.matches('01')) with ordinality x(e, i))
     is distinct from (select array_agg(g) from generate_series(1, 14) g) then
    raise exception 'rank should run 1..n with no gaps';
  end if;
end
$$;

-- 5. Both directions, and the driver's view ------------------------------------------------
do $$
declare
  bea text[] := pg_temp.keys(pg_temp.matches('10', 'passenger'));
  cy text[] := pg_temp.keys(pg_temp.matches('35'));
begin
  -- Bea sees opted-in, active, unbooked passengers: Uma's unvetted status only hides her
  -- as a driver. Sam (suspended), Rid (booked), Cy and Hop (opted out) aren't there.
  if bea is distinct from array['17:passenger', '24:passenger', '30:passenger', '01:passenger'] then
    raise exception 'Bea''s passengers are %', bea;
  end if;
  if pg_temp.keys(pg_temp.matches('10', 'driver')) <> '{}' then
    raise exception 'Bea only drives, so she has no driver matches';
  end if;

  -- Blocks hide the pair from both sides, whoever blocked.
  if pg_temp.keys(pg_temp.matches('22', 'passenger')) @> array['01:passenger']
     or not (pg_temp.keys(pg_temp.matches('22', 'passenger')) @> array['30:passenger']) then
    raise exception 'Bob (blocked by Ada) should see Pia but not Ada';
  end if;
  if pg_temp.keys(pg_temp.matches('23', 'passenger')) @> array['01:passenger']
     or not (pg_temp.keys(pg_temp.matches('23', 'passenger')) @> array['30:passenger']) then
    raise exception 'Bix (who blocked Ada) should see Pia but not Ada';
  end if;

  -- Cargo from the driver side: Box's trunk doesn't fit Ada's scooter.
  if pg_temp.keys(pg_temp.matches('2c', 'passenger')) @> array['01:passenger']
     or not (pg_temp.keys(pg_temp.matches('2c', 'passenger')) @> array['30:passenger']) then
    raise exception 'Box should see Pia but not Ada (scooter)';
  end if;

  -- "Both": Cy sees Bo once per role, and never herself.
  if (select count(*) from unnest(cy) k where k = '17:driver') <> 1
     or (select count(*) from unnest(cy) k where k = '17:passenger') <> 1 then
    raise exception 'Cy should see Bo once as a driver and once as a passenger, got %', cy;
  end if;
  if exists (select 1 from unnest(cy) k where k like '35:%') then
    raise exception 'Cy sees herself: %', cy;
  end if;
  if (select count(distinct k) from unnest(cy) k) <> cardinality(cy) then
    raise exception 'Duplicate (other_id, role) rows: %', cy;
  end if;
end
$$;

-- 6. What a row holds ----------------------------------------------------------------------
do $$
declare
  ada jsonb := pg_temp.matches('01', 'driver');
  bea jsonb := pg_temp.matches('10', 'passenger');
  r jsonb;
begin
  r := pg_temp.row_for(ada, '10');
  if r ->> 'name' <> 'Bea B.'
     or (r ->> 'vetted')::boolean is distinct from true
     or r -> 'ride_prefs' <> '[]'::jsonb
     or r -> 'shared_weekdays' <> '[1, 2, 3, 4]'::jsonb
     or r ->> 'departure_time' <> '07:40:00'
     or r ->> 'window_start' <> '07:25:00'
     or r ->> 'window_end' <> '07:55:00'
     or (r ->> 'departure_gap_minutes')::integer <> -5
     or r ->> 'detour_band' <> 'under_3'
     or (r ->> 'seats_offered')::integer <> 3
     or (r ->> 'seats_open')::integer <> 3
     or r -> 'brings_scooter' <> 'null'::jsonb
     or (r ->> 'scooter_fits')::boolean is distinct from true
     or (r ->> 'connected')::boolean is distinct from false
     or (r ->> 'area_radius_m')::integer <> 402
     or (r ->> 'rank')::integer <> 5 then
    raise exception 'Bea''s row is %', r;
  end if;
  if r -> 'reasons' <> '[
      {"code": "detour", "label": "Under 3 min detour", "ok": true},
      {"code": "time", "label": "Same departure window", "ok": true},
      {"code": "days", "label": "Mon–Thu overlap", "ok": true},
      {"code": "cargo", "label": "Your scooter fits", "ok": true}]'::jsonb then
    raise exception 'Bea''s reasons are %', r -> 'reasons';
  end if;

  -- Bands: Cal's 4-minute detour is 3_to_5; Tia's own limit of 2 still admits a 2-minute pair.
  r := pg_temp.row_for(ada, '1a');
  if r ->> 'detour_band' <> '3_to_5'
     or r -> 'reasons' -> 0 <> '{"code": "detour", "label": "3–5 min detour", "ok": true}'::jsonb
     or r -> 'reasons' -> 1 <> '{"code": "time", "label": "Same departure window", "ok": true}'::jsonb then
    raise exception 'Cal''s row is %', r;
  end if;
  if pg_temp.row_for(ada, '11') ->> 'detour_band' <> 'under_3' then
    raise exception 'Tia should be under_3';
  end if;

  -- Band edges: exactly 2 minutes is under_3 (Bea, 1.95), exactly 3 is 3_to_5 (Tre, 3.00).
  if pg_temp.row_for(ada, '1d') ->> 'detour_band' <> '3_to_5'
     or pg_temp.row_for(ada, '1d') -> 'reasons' -> 0 <> '{"code": "detour", "label": "3–5 min detour", "ok": true}'::jsonb
     or pg_temp.row_for(ada, '10') ->> 'detour_band' <> 'under_3' then
    raise exception 'Band edges: Tre % / Bea %', pg_temp.row_for(ada, '1d'), pg_temp.row_for(ada, '10');
  end if;

  -- Within a band, exact minutes don't order anything (Q8): Dex (0 min) ranks after
  -- Bea (2 min, smaller time gap) and right after Gus (2 min, same gap, lower id);
  -- Tre (3 min) ranks after Cal (4 min, same gap, lower id).
  if (pg_temp.row_for(ada, '1c') ->> 'rank')::integer <> (pg_temp.row_for(ada, '18') ->> 'rank')::integer + 1
     or (pg_temp.row_for(ada, '1c') ->> 'rank')::integer < (pg_temp.row_for(ada, '10') ->> 'rank')::integer
     or (pg_temp.row_for(ada, '1d') ->> 'rank')::integer <> (pg_temp.row_for(ada, '1a') ->> 'rank')::integer + 1 then
    raise exception 'Same-band candidates were ordered by minutes: Dex %, Gus %, Tre %, Cal %',
      pg_temp.row_for(ada, '1c') ->> 'rank', pg_temp.row_for(ada, '18') ->> 'rank',
      pg_temp.row_for(ada, '1d') ->> 'rank', pg_temp.row_for(ada, '1a') ->> 'rank';
  end if;
  if pg_temp.row_for(ada, '1c') - array['other_id', 'name', 'origin_area_lat', 'origin_area_lng',
       'origin_area_label', 'destination_area_lat', 'destination_area_lng', 'destination_area_label', 'rank']
     <> pg_temp.row_for(ada, '18') - array['other_id', 'name', 'origin_area_lat', 'origin_area_lng',
       'origin_area_label', 'destination_area_lat', 'destination_area_lng', 'destination_area_label', 'rank'] then
    raise exception 'Dex (0 min) and Gus (2 min) should differ only in identity, areas and rank: % / %',
      pg_temp.row_for(ada, '1c'), pg_temp.row_for(ada, '18');
  end if;

  -- Seats net of confirmed rides that date; a ride on another date doesn't count.
  r := pg_temp.row_for(ada, '15');
  if (r ->> 'seats_offered')::integer <> 3 or (r ->> 'seats_open')::integer <> 2 then
    raise exception 'Hov should have 2 of 3 seats open, got %', r;
  end if;
  r := pg_temp.row_for(pg_temp.matches('01', 'driver', pg_temp.day() + 7), '15');
  if (r ->> 'seats_open')::integer <> 3 then
    raise exception 'Hov''s ride is on another date, so a week later all 3 seats are open, got %', r;
  end if;

  if pg_temp.row_for(ada, '14') -> 'reasons' -> 4 <> '{"code": "pref_quiet", "label": "Both prefer quiet rides", "ok": true}'::jsonb
     or jsonb_array_length(pg_temp.row_for(ada, '14') -> 'reasons') <> 5 then
    raise exception 'Ben should share the quiet preference only, got %', pg_temp.row_for(ada, '14') -> 'reasons';
  end if;
  r := pg_temp.row_for(ada, '13');
  if (r ->> 'connected')::boolean is distinct from true
     or r -> 'reasons' -> 4 <> '{"code": "connected", "label": "You''ve ridden together", "ok": true}'::jsonb then
    raise exception 'Bel should be connected, got %', r;
  end if;
  if pg_temp.row_for(ada, '18') -> 'reasons' -> 1 <> '{"code": "time", "label": "Leaves 10 min later", "ok": false}'::jsonb then
    raise exception 'Gus''s time reason is %', pg_temp.row_for(ada, '18') -> 'reasons' -> 1;
  end if;
  if pg_temp.row_for(ada, '1b') -> 'reasons' -> 1 <> '{"code": "time", "label": "Leaves 25 min earlier", "ok": false}'::jsonb then
    raise exception 'Ear''s time reason is %', pg_temp.row_for(ada, '1b') -> 'reasons' -> 1;
  end if;
  if pg_temp.row_for(ada, '12') -> 'reasons' -> 2 <> '{"code": "days", "label": "Wed overlap", "ok": true}'::jsonb then
    raise exception 'Dee''s days reason is %', pg_temp.row_for(ada, '12') -> 'reasons' -> 2;
  end if;

  -- The driver's view of a passenger.
  r := pg_temp.row_for(bea, '01', 'passenger');
  if r ->> 'name' <> 'Ada L.'
     or (r ->> 'vetted')::boolean is distinct from false
     or r -> 'ride_prefs' <> '["quiet"]'::jsonb
     or (r ->> 'brings_scooter')::boolean is distinct from true
     or r -> 'scooter_fits' <> 'null'::jsonb
     or r -> 'seats_offered' <> 'null'::jsonb
     or r -> 'seats_open' <> 'null'::jsonb
     or (r ->> 'departure_gap_minutes')::integer <> 5 then
    raise exception 'Bea''s view of Ada is %', r;
  end if;
  if r -> 'reasons' <> '[
      {"code": "detour", "label": "Under 3 min detour", "ok": true},
      {"code": "time", "label": "Same departure window", "ok": true},
      {"code": "days", "label": "Mon–Thu overlap", "ok": true},
      {"code": "cargo", "label": "Brings a foldable scooter", "ok": true}]'::jsonb then
    raise exception 'Bea''s reasons for Ada are %', r -> 'reasons';
  end if;
  r := pg_temp.row_for(bea, '30', 'passenger');
  if (r ->> 'brings_scooter')::boolean is distinct from false
     or r -> 'reasons' -> 2 <> '{"code": "days", "label": "Every weekday", "ok": true}'::jsonb
     or jsonb_array_length(r -> 'reasons') <> 3 then
    raise exception 'Bea''s view of Pia is %', r;
  end if;

  -- No reason mentions vetting or carpool lanes (Q7: occupancy only ranks).
  if exists (
    select 1
    from jsonb_array_elements(ada || bea) e, jsonb_array_elements(e -> 'reasons') x
    where x::text ~* 'vet|hov|carpool|lane|license|insurance'
  ) then
    raise exception 'A reason mentions vetting or carpool lanes';
  end if;
end
$$;

-- 7. Privacy: stored areas only, nothing exact, nothing from the vehicle or the account ------
do $$
declare
  res jsonb := pg_temp.matches('01', 'driver') || pg_temp.matches('10', 'passenger');
  e jsonb;
  c record;
  k text;
begin
  for e in select * from jsonb_array_elements(res) loop
    select
      extensions.st_y(t.origin_area::extensions.geometry) as oy,
      extensions.st_x(t.origin_area::extensions.geometry) as ox,
      extensions.st_y(t.destination_area::extensions.geometry) as dy,
      extensions.st_x(t.destination_area::extensions.geometry) as dx,
      t.origin_area_label, t.destination_area_label,
      public.area_label(t.origin_area) as olabel, public.area_label(t.destination_area) as dlabel,
      array[extensions.st_y(t.origin::extensions.geometry), extensions.st_x(t.origin::extensions.geometry),
            extensions.st_y(t.destination::extensions.geometry), extensions.st_x(t.destination::extensions.geometry)] as exact
      into c
    from public.commutes t
    where t.owner_id = (e ->> 'other_id')::uuid and t.role = e ->> 'role';

    if (e ->> 'origin_area_lat')::double precision is distinct from c.oy
       or (e ->> 'origin_area_lng')::double precision is distinct from c.ox
       or (e ->> 'destination_area_lat')::double precision is distinct from c.dy
       or (e ->> 'destination_area_lng')::double precision is distinct from c.dx then
      raise exception 'Row % areas differ from the stored areas', e;
    end if;
    if e ->> 'origin_area_label' is distinct from c.origin_area_label
       or e ->> 'origin_area_label' is distinct from c.olabel
       or e ->> 'destination_area_label' is distinct from c.destination_area_label
       or e ->> 'destination_area_label' is distinct from c.dlabel then
      raise exception 'Row % labels differ from the stored labels', e;
    end if;
    for k in select key from jsonb_each(e) where jsonb_typeof(value) = 'number' loop
      if (e ->> k)::double precision = any (c.exact) then
        raise exception 'Row % column % equals an exact coordinate', e, k;
      end if;
    end loop;
  end loop;

  if res::text ~ '(Toyota|Prius|Blue|BEA123|example\.test)' then
    raise exception 'A vehicle detail or email reached the result';
  end if;
  -- No fixture member's surname appears anywhere but the public area labels (which
  -- come from boundary data: "Park Street area, Alameda" is not Pia Park's name).
  for k in
    select split_part(p.display_name, ' ', 2)
    from public.profiles p
    where p.id::text like '00000000-0000-0000-0000-0000000026%'
  loop
    if exists (
      select 1 from jsonb_array_elements(res) as x(item)
      where (x.item - 'origin_area_label' - 'destination_area_label')::text ~ ('\m' || k || '\M')
    ) then
      raise exception 'The surname % reached the result', k;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(res) as x(item), jsonb_object_keys(x.item) as k(key)
    where k.key in ('origin', 'destination', 'display_name', 'email', 'vetted_at', 'suspended_at',
                  'make', 'model', 'color', 'plate', 'vehicle_id', 'detour_minutes',
                  'max_detour_minutes', 'departure_flex_minutes', 'weekdays')
  ) then
    raise exception 'A private column name reached the result';
  end if;
end
$$;

-- 8. Stable results ------------------------------------------------------------------------
do $$
begin
  if pg_temp.matches('01') <> pg_temp.matches('01')
     or pg_temp.matches('10', 'passenger') <> pg_temp.matches('10', 'passenger') then
    raise exception 'Two calls in a row returned different rows';
  end if;
end
$$;

-- 9. Shared-days label ------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('{1,2,3,4,5}'::integer[], 'Every weekday'),
      ('{1,2,3,4}', 'Mon–Thu overlap'),
      ('{2,3,4}', 'Tue–Thu overlap'),
      ('{1,3}', 'Mon, Wed overlap'),
      ('{1,2}', 'Mon, Tue overlap'),
      ('{1,2,3,5}', 'Mon–Wed, Fri overlap'),
      ('{1,2,4,5}', 'Mon, Tue, Thu, Fri overlap'),
      ('{3}', 'Wed overlap')
    ) v(days, want)
  loop
    if public.match_days_label(t.days) is distinct from t.want then
      raise exception 'Days % labelled %, expected %', t.days, public.match_days_label(t.days), t.want;
    end if;
  end loop;
end
$$;

-- 10. The area prefilter never drops a pair the detour estimate accepts -----------------------
-- Each passing pair is checked with both areas pushed 401 m from the exact point in eight
-- directions, the worst an area center can sit.
do $$
declare
  rt record;
  po extensions.geography;
  pd extensions.geography;
  az double precision;
  passed integer := 0;
begin
  for rt in
    select * from (values ('park', 'fremont'), ('laney', 'fremont'), ('webster', 'mont'), ('lake', 'mont')) v(o, d)
  loop
    for po in
      select extensions.st_geogfromtext(format('SRID=4326;POINT(%s %s)', lon, lat))
      from generate_series(-122.42, -122.22, 0.02) lon, generate_series(37.74, 37.84, 0.02) lat
    loop
      for pd in
        select extensions.st_geogfromtext(p)
        from unnest(array['SRID=4326;POINT(-122.4021 37.7894)', 'SRID=4326;POINT(-122.3966 37.7910)',
                          'SRID=4326;POINT(-122.4100 37.7750)', 'SRID=4326;POINT(-122.2700 37.8000)']) p
      loop
        if public.estimate_detour_minutes(pg_temp.pt(rt.o), pg_temp.pt(rt.d), po, pd)
           <= public.detour_limit_minutes() then
          passed := passed + 1;
          for az in select g * pi() / 4 from generate_series(0, 7) g loop
            if not public.match_prefilter(pg_temp.pt(rt.o), pg_temp.pt(rt.d),
                                          extensions.st_project(po, 401, az),
                                          extensions.st_project(pd, 401, az)) then
              raise exception 'Prefilter dropped a pair within the limit: route %->%, pickup %, drop-off %',
                rt.o, rt.d, extensions.st_astext(po::extensions.geometry), extensions.st_astext(pd::extensions.geometry);
            end if;
          end loop;
        end if;
      end loop;
    end loop;
  end loop;
  raise notice 'prefilter: % pairs within the limit checked', passed;
  if passed < 5 then
    raise exception 'Too few pairs within the limit (%) to test the prefilter', passed;
  end if;

  if public.match_prefilter(pg_temp.pt('park'), pg_temp.pt('fremont'), pg_temp.pt('wc'), pg_temp.pt('wc')) then
    raise exception 'Prefilter should reject Walnut Creek for an Alameda -> FiDi driver';
  end if;
  -- A driver whose origin and destination coincide has no direction: no error, a plain yes/no.
  if public.match_prefilter(pg_temp.pt('park'), pg_temp.pt('park'), pg_temp.pt('park'), pg_temp.pt('webster')) is null then
    raise exception 'Prefilter should answer for a zero-length route';
  end if;
end
$$;

-- 11. Deleting a member removes them from results -----------------------------------------------
delete from auth.users where id = pg_temp.uid('11');

do $$
begin
  if pg_temp.keys(pg_temp.matches('01', 'driver')) @> array['11:driver'] then
    raise exception 'A deleted member still appears';
  end if;
  if cardinality(pg_temp.keys(pg_temp.matches('01', 'driver'))) <> 13 then
    raise exception 'Deleting Tia should leave Ada 13 drivers';
  end if;
end
$$;

rollback;

-- Booking (M-32): confirm_ride, ride_pickup, cancel_ride, cant_drive, driver_day, and the
-- booking, block and suspension hooks in *_booking.sql.
-- Spec: docs/superpowers/specs/2026-10-10-booking-design.md, sections 2, 6, 7 and 9.
--
-- now() is fixed for the whole transaction. Ride dates are D (the next Wednesday at least
-- two days out) and Dt (the next Thursday at least two days out), so the 8 PM reply cutoff
-- and the 9 PM cancel cutoff never interfere and both are within the 14-day horizon. The
-- fixture flows linearly: each group builds on the rides and invitations the groups before
-- it left, and sends happen before the bookings that would hide their recipient from
-- matching. Ids that later groups need are kept in the `ids` table.
--
-- Members (ids end in 32xx). Drivers go Park St -> Market & Fremont at 7:40 (flex 15,
-- Mon-Fri, 3 seats, trunk fits a scooter, vetted, opted in) unless noted; passengers go
-- Webster St -> Montgomery at 7:45 (flex 15, Mon-Fri, opted in), a 2-minute detour.
--   01 Ada  02 Abe  03 Cat  04 Dot (scooter)  05 Eli (scooter)  06 Ivy  07 Jo (scooter)
--   08 Mia  09 Zed                                                       passengers
--   10 Bea  2 seats              11 Cy                 12 Fay  1 seat
--   13 Gus  3 seats, fits        14 Hal  fits (trunk later stops fitting)
--   15 Lu   (later suspended)    16 Kit  "Both": a driver and a passenger commute
--   17 Uma  vetted, later un-vetted                    18 Nov  vehicle later detached
begin;

select tests.as_admin();

-- Helpers --------------------------------------------------------------------------

create temporary table place (name text primary key, pt extensions.geography) on commit drop;
insert into place values
  ('park',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)')),
  ('fremont', extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)')),
  ('webster', extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)')),
  ('mont',    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)'));

-- Ids one group leaves for a later one.
create temporary table ids (name text primary key, id uuid not null) on commit drop;

create function pg_temp.keep(k text, v uuid) returns uuid
language sql as $$ insert into ids (name, id) values (k, v) returning id $$;

create function pg_temp.kept(k text) returns uuid
language sql stable as $$ select i.id from ids i where i.name = k $$;

create function pg_temp.pt(n text) returns extensions.geography
language sql stable as $$ select p.pt from place p where p.name = n $$;

create function pg_temp.uid(n text) returns uuid
language sql immutable as $$ select ('00000000-0000-0000-0000-0000000032' || n)::uuid $$;

create function pg_temp.la_today() returns date
language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- The first date at least two days out whose ISO weekday is dow.
create function pg_temp.next_dow(dow integer) returns date
language sql stable as $$
  select pg_temp.la_today() + 2
    + ((dow - extract(isodow from pg_temp.la_today() + 2)::integer + 7) % 7)
$$;

create function pg_temp.d() returns date language sql stable as $$ select pg_temp.next_dow(3) $$;   -- Wednesday
create function pg_temp.dt() returns date language sql stable as $$ select pg_temp.next_dow(4) $$;  -- Thursday

create function pg_temp.member(n text, display text, opt_in boolean default true, vetted boolean default true)
returns void language sql as $$
  insert into auth.users (id, email) values (pg_temp.uid(n), 'b' || n || '@example.test');
  insert into public.profiles (id, display_name, discovery_opt_in, vetted_at)
  values (pg_temp.uid(n), display, opt_in, case when vetted then now() end);
$$;

create function pg_temp.driver(
  n text, o text default 'park', seats integer default 3, fits boolean default true,
  with_vehicle boolean default true
) returns uuid
language plpgsql as $$
declare
  vid uuid;
  cid uuid;
begin
  if with_vehicle then
    insert into public.vehicles (owner_id, make, model, color, plate, passenger_seats, accepts_foldable_scooters)
    values (pg_temp.uid(n), 'Toyota', 'Prius', 'Blue', 'MRG' || n, seats, fits)
    returning id into vid;
  end if;
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays,
                               departure_flex_minutes, vehicle_id, seats_offered)
  values (pg_temp.uid(n), 'driver', pg_temp.pt(o), pg_temp.pt('fremont'), '07:40', '{1,2,3,4,5}',
          15, vid, seats)
  returning id into cid;
  return cid;
end
$$;

create function pg_temp.passenger(n text, scooter boolean default false) returns uuid
language plpgsql as $$
declare
  cid uuid;
begin
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays,
                               departure_flex_minutes, brings_scooter)
  values (pg_temp.uid(n), 'passenger', pg_temp.pt('webster'), pg_temp.pt('mont'), '07:45', '{1,2,3,4,5}',
          15, scooter)
  returning id into cid;
  return cid;
end
$$;

create function pg_temp.commute_of(n text, r text) returns public.commutes
language sql stable as $$
  select c.* from public.commutes c where c.owner_id = pg_temp.uid(n) and c.role = r
$$;

-- An admin-inserted ride between drv and pax on day d, behind a booked invitation.
create function pg_temp.ride(drv text, pax text, d date, st text default 'confirmed') returns uuid
language plpgsql as $$
declare
  inv uuid;
  rid uuid;
begin
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date, direction)
  values (pg_temp.uid(pax), pg_temp.uid(drv), (pg_temp.commute_of(pax, 'passenger')).id, 'booked', d, 'request')
  returning id into inv;
  -- Sent long ago, so it doesn't count toward today's sends.
  update public.invitations set created_at = now() - interval '30 days' where id = inv;
  insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind)
  values (inv, pg_temp.uid(drv), pg_temp.uid(pax), d, '07:45', st, 'first_ride')
  returning id into rid;
  return rid;
end
$$;

-- An admin-inserted pickup for an admin-inserted ride.
create function pg_temp.add_pickup(rid uuid, plate text) returns void
language plpgsql as $$
begin
  insert into public.ride_pickups (ride_id, spot, note, vehicle_make, vehicle_model, vehicle_color, vehicle_plate)
  values (rid, pg_temp.pt('park'), 'By the bus stop', 'Toyota', 'Prius', 'Blue', plate);
end
$$;

create function pg_temp.as_who(who text) returns void
language plpgsql as $$
begin
  if who = 'anon' then
    perform tests.as_anon();
  elsif who = 'admin' then
    perform tests.as_admin();
  elsif who = 'nobody' then
    -- The authenticated role with no sub: can't happen through PostgREST.
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform tests.as_user(pg_temp.uid(who));
  end if;
end
$$;

-- send_invitation as `who`: the new id, or raises.
create function pg_temp.send(
  who text, rcpt text, other_role text, d date, t time default null,
  scooter boolean default null, crew uuid default null
) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  perform pg_temp.as_who(who);
  id := public.send_invitation(pg_temp.uid(rcpt), other_role, d, t, scooter, crew);
  perform tests.as_admin();
  return id;
end
$$;

-- send_invitation as `who`: 'ok', or 'SQLSTATE|hint|message'.
create function pg_temp.send_err(
  who text, rcpt uuid, other_role text, d date, t time default null,
  scooter boolean default null, crew uuid default null
) returns text
language plpgsql as $$
declare
  st text;
  h text;
  m text;
begin
  perform pg_temp.as_who(who);
  begin
    perform public.send_invitation(rcpt, other_role, d, t, scooter, crew);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, h = pg_exception_hint, m = message_text;
    perform tests.as_admin();
    return st || '|' || coalesce(h, '') || '|' || m;
  end;
  perform tests.as_admin();
  return 'ok';
end
$$;

-- accept / decline / withdraw as `who`: 'ok', or 'SQLSTATE|hint|message'.
create function pg_temp.act(who text, action text, inv uuid) returns text
language plpgsql as $$
declare
  st text;
  h text;
  m text;
begin
  perform pg_temp.as_who(who);
  begin
    execute format('select public.%s_invitation($1)', action) using inv;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, h = pg_exception_hint, m = message_text;
    perform tests.as_admin();
    return st || '|' || coalesce(h, '') || '|' || m;
  end;
  perform tests.as_admin();
  return 'ok';
end
$$;

-- The invitation's pickup area (its center), and a point `meters` from it at `azimuth`
-- (radians, clockwise from north).
create function pg_temp.center(inv uuid) returns extensions.geography
language sql stable as $$ select i.pickup_area from public.invitations i where i.id = inv $$;

create function pg_temp.area_pt(inv uuid, meters double precision, azimuth double precision)
returns extensions.geography
language sql stable as $$
  select extensions.st_project(i.pickup_area, meters, azimuth) from public.invitations i where i.id = inv
$$;

create function pg_temp.lat(g extensions.geography) returns double precision
language sql immutable as $$ select extensions.st_y(g::extensions.geometry) $$;

create function pg_temp.lng(g extensions.geography) returns double precision
language sql immutable as $$ select extensions.st_x(g::extensions.geometry) $$;

-- confirm_ride as `who`: the ride id, or raises.
create function pg_temp.confirm(
  who text, inv uuid, lat double precision, lng double precision,
  note text default null, scooter_ok boolean default false
) returns uuid
language plpgsql as $$
declare
  rid uuid;
begin
  perform pg_temp.as_who(who);
  rid := public.confirm_ride(inv, lat, lng, note, scooter_ok);
  perform tests.as_admin();
  return rid;
end
$$;

-- confirm_ride as `who`: 'ok', or 'SQLSTATE|hint|message' (pg_temp.code gives 'SQLSTATE|hint').
create function pg_temp.confirm_err(
  who text, inv uuid, lat double precision, lng double precision,
  note text default null, scooter_ok boolean default false
) returns text
language plpgsql as $$
declare
  st text;
  h text;
  m text;
begin
  perform pg_temp.as_who(who);
  begin
    perform public.confirm_ride(inv, lat, lng, note, scooter_ok);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, h = pg_exception_hint, m = message_text;
    perform tests.as_admin();
    return st || '|' || coalesce(h, '') || '|' || m;
  end;
  perform tests.as_admin();
  return 'ok';
end
$$;

-- The same two, with the spot at the invitation's area center and no note.
create function pg_temp.confirm_center(who text, inv uuid, scooter_ok boolean default false) returns uuid
language plpgsql as $$
declare
  c extensions.geography := pg_temp.center(inv);
begin
  return pg_temp.confirm(who, inv, pg_temp.lat(c), pg_temp.lng(c), null, scooter_ok);
end
$$;

create function pg_temp.try_center(who text, inv uuid, scooter_ok boolean default false) returns text
language plpgsql as $$
declare
  c extensions.geography := pg_temp.center(inv);
begin
  return pg_temp.confirm_err(who, inv, pg_temp.lat(c), pg_temp.lng(c), null, scooter_ok);
end
$$;

-- cancel_ride / cant_drive as `who`: 'ok', or 'SQLSTATE|hint|message'.
create function pg_temp.cancel_err(who text, rid uuid) returns text
language plpgsql as $$
declare
  st text;
  h text;
  m text;
begin
  perform pg_temp.as_who(who);
  begin
    perform public.cancel_ride(rid);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, h = pg_exception_hint, m = message_text;
    perform tests.as_admin();
    return st || '|' || coalesce(h, '') || '|' || m;
  end;
  perform tests.as_admin();
  return 'ok';
end
$$;

create function pg_temp.cant_err(who text, rd date) returns text
language plpgsql as $$
declare
  st text;
  h text;
  m text;
begin
  perform pg_temp.as_who(who);
  begin
    perform public.cant_drive(rd);
  exception when others then
    get stacked diagnostics st = returned_sqlstate, h = pg_exception_hint, m = message_text;
    perform tests.as_admin();
    return st || '|' || coalesce(h, '') || '|' || m;
  end;
  perform tests.as_admin();
  return 'ok';
end
$$;

-- How many rows ride_pickup gives `who` for rid. Raises what ride_pickup raises.
create function pg_temp.pickups(who text, rid uuid) returns integer
language plpgsql as $$
declare
  n integer;
begin
  perform pg_temp.as_who(who);
  select count(*) into n from public.ride_pickup(rid);
  perform tests.as_admin();
  return n;
end
$$;

-- driver_day as `who`, as '(seats_total,seats_booked,scooter_booked,day_off)'; null for no row.
create function pg_temp.driver_day_of(who text, rd date) returns text
language plpgsql as $$
declare
  res text;
begin
  perform pg_temp.as_who(who);
  select row(x.seats_total, x.seats_booked, x.scooter_booked, x.day_off)::text into res
  from public.driver_day(rd) x;
  perform tests.as_admin();
  return res;
end
$$;

-- my_invitations as `who`, as a jsonb array in the function's order.
create function pg_temp.view(who text) returns jsonb
language plpgsql as $$
declare
  res jsonb;
begin
  perform pg_temp.as_who(who);
  select coalesce(jsonb_agg(to_jsonb(m) order by m.ride_date, m.created_at, m.id), '[]'::jsonb)
  into res
  from public.my_invitations() m;
  perform tests.as_admin();
  return res;
end
$$;

create function pg_temp.row_of(who text, inv uuid) returns jsonb
language sql as $$
  select e from jsonb_array_elements(pg_temp.view(who)) e where e ->> 'id' = inv::text
$$;

-- The state `who` sees for inv, or null when the row isn't in their view.
create function pg_temp.state(who text, inv uuid) returns text
language sql as $$ select pg_temp.row_of(who, inv) ->> 'state' $$;

-- find_matches as `who`: the other_ids returned, as a jsonb array.
create function pg_temp.match_ids(who text, d date, filter text) returns jsonb
language plpgsql as $$
declare
  res jsonb;
begin
  perform pg_temp.as_who(who);
  select coalesce(jsonb_agg(m.other_id), '[]'::jsonb) into res from public.find_matches(d, filter) m;
  perform tests.as_admin();
  return res;
end
$$;

create function pg_temp.inv(id uuid) returns public.invitations
language sql stable as $$ select i.* from public.invitations i where i.id = $1 $$;

create function pg_temp.ride_row(rid uuid) returns public.rides
language sql stable as $$ select r.* from public.rides r where r.id = rid $$;

create function pg_temp.has_ride(inv uuid) returns boolean
language sql stable as $$ select exists (select 1 from public.rides r where r.invitation_id = inv) $$;

create function pg_temp.expect(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception '%: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
end
$$;

-- 'SQLSTATE|hint' of an error string from the *_err helpers.
create function pg_temp.code(err text) returns text
language sql immutable as $$ select split_part(err, '|', 1) || '|' || split_part(err, '|', 2) $$;

-- Fixture ------------------------------------------------------------------------------

select pg_temp.member('01', 'Ada Lovelace', vetted => false);  select pg_temp.passenger('01');
select pg_temp.member('02', 'Abe Adams', vetted => false);     select pg_temp.passenger('02');
select pg_temp.member('03', 'Cat Cole', vetted => false);      select pg_temp.passenger('03');
select pg_temp.member('04', 'Dot Dunn', vetted => false);      select pg_temp.passenger('04', scooter => true);
select pg_temp.member('05', 'Eli Egan', vetted => false);      select pg_temp.passenger('05', scooter => true);
select pg_temp.member('06', 'Ivy Ito', vetted => false);       select pg_temp.passenger('06');
select pg_temp.member('07', 'Jo Jones', vetted => false);      select pg_temp.passenger('07', scooter => true);
select pg_temp.member('08', 'Mia Moss', vetted => false);      select pg_temp.passenger('08');
select pg_temp.member('09', 'Zed Zane', vetted => false);      select pg_temp.passenger('09');
select pg_temp.member('10', 'Bea Brown');                      select pg_temp.driver('10', seats => 2);
select pg_temp.member('11', 'Cy Chen');                        select pg_temp.driver('11');
select pg_temp.member('12', 'Fay Fox');                        select pg_temp.driver('12', seats => 1);
select pg_temp.member('13', 'Gus Gray');                       select pg_temp.driver('13', seats => 3, fits => true);
select pg_temp.member('14', 'Hal Hart');                       select pg_temp.driver('14', fits => true);
select pg_temp.member('15', 'Lu Lim');                         select pg_temp.driver('15');
select pg_temp.member('16', 'Kit Kim');                        select pg_temp.driver('16');
                                                               select pg_temp.passenger('16');
select pg_temp.member('17', 'Uma Ueda');                       select pg_temp.driver('17');
select pg_temp.member('18', 'Nov Noel');                       select pg_temp.driver('18');

-- 1. Privileges and shape --------------------------------------------------------------

do $$
declare
  f record;
  p record;
  who text;
  priv text;
  c text;
begin
  for f in
    select * from (values
      ('public.confirm_ride(uuid, double precision, double precision, text, boolean)', true),
      ('public.ride_pickup(uuid)', true),
      ('public.cancel_ride(uuid)', true),
      ('public.cant_drive(date)', true),
      ('public.driver_day(date)', true),
      ('public.day_lock(uuid, date)', false),
      ('public.blocks_cancel_rides()', false)
    ) v(sig, client)
  loop
    if has_function_privilege('anon', f.sig, 'execute') then
      raise exception '% is executable by anon', f.sig;
    end if;
    if has_function_privilege('authenticated', f.sig, 'execute') is distinct from f.client then
      raise exception '% execute by authenticated should be %', f.sig, f.client;
    end if;
    if f.client then
      select pr.prosecdef, pr.proconfig into p from pg_proc pr where pr.oid = f.sig::regprocedure;
      if p.prosecdef is distinct from true then
        raise exception '% should be security definer', f.sig;
      end if;
      if p.proconfig is distinct from array['search_path=""']::text[] then
        raise exception '% must set only search_path to empty, has %', f.sig, p.proconfig;
      end if;
    end if;
  end loop;

  foreach who in array array['anon', 'authenticated'] loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(who, 'public.ride_pickups', priv) then
        raise exception '% has % on ride_pickups', who, priv;
      end if;
      if has_table_privilege(who, 'public.driver_days_off', priv)
         is distinct from (who = 'authenticated' and priv = 'SELECT') then
        raise exception '% has the wrong % privilege on driver_days_off', who, priv;
      end if;
    end loop;
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege(who, 'public.ride_pickups', priv) then
        raise exception '% has a column % privilege on ride_pickups', who, priv;
      end if;
    end loop;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.ride_pickups'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.driver_days_off'::regclass) then
    raise exception 'RLS should be on for ride_pickups and driver_days_off';
  end if;

  -- The other participant sees "Ride cancelled", never why, when or by whom.
  foreach c in array array['cancelled_at', 'cancelled_by', 'cancel_reason', 'cancelled_late'] loop
    if has_column_privilege('authenticated', 'public.rides', c, 'SELECT') then
      raise exception 'authenticated can read rides.%', c;
    end if;
  end loop;
  foreach c in array array['id', 'invitation_id', 'driver_id', 'passenger_id', 'ride_date', 'pickup_time',
                           'status', 'kind', 'created_at', 'completed_at', 'seats', 'brings_scooter'] loop
    if not has_column_privilege('authenticated', 'public.rides', c, 'SELECT') then
      raise exception 'authenticated can''t read rides.%', c;
    end if;
  end loop;
end
$$;

-- 2. Confirm a request --------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  dt date := pg_temp.dt();
  req uuid;
  rid uuid;
  c extensions.geography;
  i public.invitations;
  r public.rides;
  pk public.ride_pickups;
  w jsonb;
begin
  req := pg_temp.keep('ada_bea', pg_temp.send('01', '10', 'driver', d));
  perform pg_temp.keep('ada_cy', pg_temp.send('01', '11', 'driver', d));
  perform pg_temp.keep('cat_bea', pg_temp.send('03', '10', 'driver', d));
  perform pg_temp.keep('ada_hal', pg_temp.send('01', '14', 'driver', dt));

  c := pg_temp.center(req);
  rid := pg_temp.confirm('10', req, pg_temp.lat(c), pg_temp.lng(c), '  North side of Park St  ');
  perform pg_temp.keep('ride_ada', rid);

  i := pg_temp.inv(req);
  r := pg_temp.ride_row(rid);
  if r.id is null then
    raise exception 'confirm_ride returned %, but there is no such ride', rid;
  end if;
  perform pg_temp.expect('ride invitation', r.invitation_id::text, req::text);
  perform pg_temp.expect('ride driver', r.driver_id::text, pg_temp.uid('10')::text);
  perform pg_temp.expect('ride passenger', r.passenger_id::text, pg_temp.uid('01')::text);
  perform pg_temp.expect('ride date', r.ride_date::text, d::text);
  perform pg_temp.expect('ride time', r.pickup_time::text, i.pickup_time::text);
  perform pg_temp.expect('ride kind', r.kind, 'first_ride');
  perform pg_temp.expect('ride seats', r.seats::text, '1');
  perform pg_temp.expect('ride scooter', r.brings_scooter::text, 'false');
  perform pg_temp.expect('ride status', r.status, 'confirmed');
  perform pg_temp.expect('ride cancel_reason', r.cancel_reason, null);

  select * into pk from public.ride_pickups x where x.ride_id = rid;
  if not found then
    raise exception 'No ride_pickups row for the confirmed ride';
  end if;
  perform pg_temp.expect('pickup note', pk.note, 'North side of Park St');
  perform pg_temp.expect('pickup make', pk.vehicle_make, 'Toyota');
  perform pg_temp.expect('pickup model', pk.vehicle_model, 'Prius');
  perform pg_temp.expect('pickup color', pk.vehicle_color, 'Blue');
  perform pg_temp.expect('pickup plate', pk.vehicle_plate, 'MRG10');
  if extensions.st_distance(pk.spot, i.pickup_area) > 1 then
    raise exception 'The stored spot is % m from the spot given', extensions.st_distance(pk.spot, i.pickup_area);
  end if;

  perform pg_temp.expect('invitation status', i.status, 'booked');
  foreach w in array array[pg_temp.row_of('01', req), pg_temp.row_of('10', req)] loop
    perform pg_temp.expect('my_invitations state', w ->> 'state', 'booked');
    perform pg_temp.expect('my_invitations ride_id', w ->> 'ride_id', rid::text);
  end loop;
end
$$;

-- 3. Q1: one ride per passenger and date, and no riding in both roles -------------------

do $$
declare
  d date := pg_temp.d();
  dt date := pg_temp.dt();
  ac uuid := pg_temp.kept('ada_cy');
  kl uuid;
  mk uuid;
  mk2 uuid;
  raised boolean;
begin
  perform pg_temp.expect('Ada sees Ada->Cy', pg_temp.state('01', ac), 'unavailable');
  perform pg_temp.expect('Cy sees Ada->Cy', pg_temp.state('11', ac), 'unavailable');
  perform pg_temp.expect('Ada->Cy reason', (pg_temp.inv(ac)).cancel_reason, 'booked_elsewhere');
  perform pg_temp.expect('Cy confirms Ada', pg_temp.code(pg_temp.try_center('11', ac)), '42501|unavailable');
  if pg_temp.has_ride(ac) then
    raise exception 'Cy got a second ride for Ada';
  end if;
  perform pg_temp.expect('Ada''s Thursday request', pg_temp.state('01', pg_temp.kept('ada_hal')), 'waiting_for_them');

  -- The backstop index.
  raised := false;
  begin
    perform pg_temp.ride('11', '01', d);
  exception when unique_violation then
    raised := true;
  end;
  if not raised then
    raise exception 'A second confirmed ride for Ada on D was inserted';
  end if;

  -- Kit ("Both") asks Lu as a passenger while Mia asks Kit as a driver, same date.
  kl := pg_temp.send('16', '15', 'driver', d);
  mk := pg_temp.send('08', '16', 'driver', d);
  perform pg_temp.keep('ride_lu_kit', pg_temp.confirm_center('15', kl));
  perform pg_temp.expect('Mia->Kit status', (pg_temp.inv(mk)).status, 'cancelled');
  perform pg_temp.expect('Mia->Kit reason', (pg_temp.inv(mk)).cancel_reason, 'booked_elsewhere');

  -- Kit booked as a passenger on Dt can't confirm a ride as a driver that day.
  mk2 := pg_temp.send('08', '16', 'driver', dt);
  perform pg_temp.ride('11', '16', dt);
  perform pg_temp.expect('Kit confirms Mia on Dt', pg_temp.code(pg_temp.try_center('16', mk2)), 'P0001|already_booked');
  if pg_temp.has_ride(mk2) then
    raise exception 'Kit drove Mia while booked as a passenger';
  end if;
end
$$;

-- 4. Invites: the driver confirms after the passenger accepts ----------------------------

do $$
declare
  d date := pg_temp.d();
  inv uuid;
  rid uuid;
  r public.rides;
begin
  inv := pg_temp.send('10', '02', 'passenger', d);
  perform pg_temp.expect('Bea confirms before Abe accepts', pg_temp.code(pg_temp.try_center('10', inv)), '42501|unavailable');
  if pg_temp.has_ride(inv) then
    raise exception 'An unaccepted invite was booked';
  end if;
  perform pg_temp.expect('Abe accepts', pg_temp.act('02', 'accept', inv), 'ok');
  rid := pg_temp.keep('ride_bea_abe', pg_temp.confirm_center('10', inv));
  r := pg_temp.ride_row(rid);
  perform pg_temp.expect('invite ride kind', r.kind, (pg_temp.inv(inv)).kind);
  perform pg_temp.expect('invite ride driver', r.driver_id::text, pg_temp.uid('10')::text);
  perform pg_temp.expect('invite ride passenger', r.passenger_id::text, pg_temp.uid('02')::text);
  perform pg_temp.expect('invite status', (pg_temp.inv(inv)).status, 'booked');
end
$$;

-- 5. Seats ------------------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  cb uuid := pg_temp.kept('cat_bea');
  cf uuid;
begin
  -- Bea's two seats hold Ada and Abe: Cat's request closed when the last seat went.
  perform pg_temp.expect('Cat sees Cat->Bea', pg_temp.state('03', cb), 'unavailable');
  perform pg_temp.expect('Bea sees Cat->Bea', pg_temp.state('10', cb), 'unavailable');
  perform pg_temp.expect('Cat->Bea reason', (pg_temp.inv(cb)).cancel_reason, 'full');
  perform pg_temp.expect('Bea confirms Cat', pg_temp.code(pg_temp.try_center('10', cb)), '42501|unavailable');
  if pg_temp.has_ride(cb) then
    raise exception 'Bea got a third passenger in two seats';
  end if;

  -- A seat taken behind the request's back (here by an admin insert): car_full.
  cf := pg_temp.send('03', '12', 'driver', d);
  perform pg_temp.ride('12', '09', d);
  perform pg_temp.expect('Fay confirms Cat', pg_temp.code(pg_temp.try_center('12', cf)), 'P0001|car_full');
  if pg_temp.has_ride(cf) then
    raise exception 'Fay got a second passenger in one seat';
  end if;
end
$$;

-- 6. Cargo (D-04) -------------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  dg uuid;
  eg uuid;
  ig uuid;
  jh uuid;
  rid uuid;
begin
  dg := pg_temp.send('04', '13', 'driver', d);
  eg := pg_temp.send('05', '13', 'driver', d);
  ig := pg_temp.keep('ivy_gus', pg_temp.send('06', '13', 'driver', d));
  perform pg_temp.expect('Dot''s request carries the scooter', (pg_temp.inv(dg)).brings_scooter::text, 'true');

  perform pg_temp.expect('Gus confirms Dot unapproved', pg_temp.code(pg_temp.try_center('13', dg, false)), 'P0001|cargo_not_approved');
  if pg_temp.has_ride(dg) then
    raise exception 'A scooter was booked without the driver''s approval';
  end if;
  rid := pg_temp.keep('ride_gus_dot', pg_temp.confirm_center('13', dg, true));
  perform pg_temp.expect('Dot ride scooter', (pg_temp.ride_row(rid)).brings_scooter::text, 'true');

  -- The scooter slot is taken: Eli's scooter request closes, Ivy's stays.
  perform pg_temp.expect('Eli->Gus status', (pg_temp.inv(eg)).status, 'cancelled');
  perform pg_temp.expect('Eli->Gus reason', (pg_temp.inv(eg)).cancel_reason, 'full');
  perform pg_temp.expect('Ivy->Gus for Gus', pg_temp.state('13', ig), 'waiting_for_me');

  -- Hal's trunk stops fitting a scooter after Jo asked.
  jh := pg_temp.send('07', '14', 'driver', d);
  update public.vehicles set accepts_foldable_scooters = false where owner_id = pg_temp.uid('14');
  perform pg_temp.expect('Hal confirms Jo', pg_temp.code(pg_temp.try_center('14', jh, true)), 'P0001|no_cargo_room');
  if pg_temp.has_ride(jh) then
    raise exception 'A scooter was booked into a trunk that doesn''t fit one';
  end if;

  perform pg_temp.expect('Gus driver_day', pg_temp.driver_day_of('13', d), '(3,1,t,f)');
end
$$;

-- 7. The pickup spot (D-16): inside the copied area, not near the exact origin ------------

do $$
declare
  dt date := pg_temp.dt();
  zh uuid;
  origin extensions.geography := (pg_temp.commute_of('09', 'passenger')).origin;
  ctr extensions.geography;
  far extensions.geography;
  near extensions.geography;
  az double precision;
begin
  zh := pg_temp.send('09', '14', 'driver', dt);
  ctr := pg_temp.center(zh);

  far := pg_temp.area_pt(zh, 1000, 0);
  perform pg_temp.expect('1000 m out', pg_temp.code(pg_temp.confirm_err('14', zh, pg_temp.lat(far), pg_temp.lng(far))),
    'P0001|spot_outside_area');
  if pg_temp.has_ride(zh) then
    raise exception 'A spot outside the area created a ride';
  end if;

  -- 390 m from the center, on the far side from Zed's exact origin.
  az := coalesce(extensions.st_azimuth(origin, ctr), 0);
  near := pg_temp.area_pt(zh, 390, az);
  if extensions.st_distance(origin, ctr) > 13 and extensions.st_distance(origin, near) <= 402 then
    raise exception 'Fixture: the spot should be over 402 m from the exact origin, is %',
      extensions.st_distance(origin, near);
  end if;
  perform pg_temp.expect('390 m out, away from the origin',
    pg_temp.confirm_err('14', zh, pg_temp.lat(near), pg_temp.lng(near)), 'ok');
  if not pg_temp.has_ride(zh) then
    raise exception 'The accepted spot created no ride';
  end if;
end
$$;

-- 8. Refusals ---------------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  dt date := pg_temp.dt();
  want text := '42501|unavailable|This ride isn''t available anymore';
  r1 uuid;
  r2 uuid;
  r3 uuid;
  r4 uuid;
  r5 uuid;
  r6 uuid;
  la double precision;
  ln double precision;
begin
  r1 := pg_temp.send('07', '11', 'driver', dt);                -- Jo asks Cy
  la := pg_temp.lat(pg_temp.center(r1));
  ln := pg_temp.lng(pg_temp.center(r1));

  perform pg_temp.expect('anon', split_part(pg_temp.confirm_err('anon', r1, la, ln), '|', 1), '42501');
  perform pg_temp.expect('no sub', pg_temp.code(pg_temp.confirm_err('nobody', r1, la, ln)), '42501|not_signed_in');
  perform pg_temp.expect('null lat', pg_temp.code(pg_temp.confirm_err('11', r1, null, ln, null, true)), '22023|invalid_input');
  perform pg_temp.expect('null lng', pg_temp.code(pg_temp.confirm_err('11', r1, la, null, null, true)), '22023|invalid_input');
  perform pg_temp.expect('lat 91', pg_temp.code(pg_temp.confirm_err('11', r1, 91, ln, null, true)), '22023|invalid_input');
  perform pg_temp.expect('lng 181', pg_temp.code(pg_temp.confirm_err('11', r1, la, 181, null, true)), '22023|invalid_input');
  perform pg_temp.expect('281-char note', pg_temp.code(pg_temp.confirm_err('11', r1, la, ln, repeat('x', 281), true)),
    '22023|note_too_long');

  -- Not the driver, or no such row: one answer.
  perform pg_temp.expect('the passenger', pg_temp.confirm_err('07', r1, la, ln, null, true), want);
  perform pg_temp.expect('a third party', pg_temp.confirm_err('10', r1, la, ln, null, true), want);
  perform pg_temp.expect('unknown id', pg_temp.confirm_err('11', gen_random_uuid(), la, ln, null, true), want);
  if pg_temp.has_ride(r1) then
    raise exception 'A refused confirm created a ride';
  end if;

  r2 := pg_temp.send('05', '15', 'driver', dt);                -- Eli asks Lu; Lu declines
  perform pg_temp.expect('Lu declines', pg_temp.act('15', 'decline', r2), 'ok');
  perform pg_temp.expect('declined', pg_temp.try_center('15', r2, true), want);

  r3 := pg_temp.send('05', '11', 'driver', dt);                -- Eli asks Cy; the cutoff passes
  update public.invitations set expires_at = now() - interval '1 minute' where id = r3;
  perform pg_temp.expect('expired', pg_temp.try_center('11', r3, true), want);

  r4 := pg_temp.send('06', '17', 'driver', d);                 -- Ivy asks Uma; Uma loses vetting
  update public.profiles set vetted_at = null where id = pg_temp.uid('17');
  perform pg_temp.expect('not vetted', pg_temp.code(pg_temp.try_center('17', r4)), 'P0001|not_vetted');

  r5 := pg_temp.send('03', '18', 'driver', dt);                -- Cat asks Nov; Nov's car comes off
  update public.commutes set vehicle_id = null where owner_id = pg_temp.uid('18') and role = 'driver';
  perform pg_temp.expect('no vehicle', pg_temp.code(pg_temp.try_center('18', r5)), 'P0001|no_vehicle');
  update public.profiles set suspended_at = now() where id = pg_temp.uid('18');
  perform pg_temp.expect('suspended driver', pg_temp.try_center('18', r5), want);

  r6 := pg_temp.send('04', '11', 'driver', dt);                -- Dot asks Cy; Cy blocks Dot
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('11'), pg_temp.uid('04'));
  perform pg_temp.expect('blocked pair', pg_temp.try_center('11', r6, true), want);

  if pg_temp.has_ride(r2) or pg_temp.has_ride(r3) or pg_temp.has_ride(r4)
     or pg_temp.has_ride(r5) or pg_temp.has_ride(r6) then
    raise exception 'A refused confirm created a ride';
  end if;
end
$$;

-- 9. The pickup reveal: participants of a confirmed ride only -----------------------------

do $$
declare
  rid uuid := pg_temp.kept('ride_ada');
  pk public.ride_pickups;
  who text;
  n integer;
  la double precision;
  ln double precision;
  plate text;
  nt text;
  raised boolean;
begin
  select * into pk from public.ride_pickups x where x.ride_id = rid;

  foreach who in array array['01', '10'] loop
    perform pg_temp.as_who(who);
    select count(*), min(x.spot_lat), min(x.spot_lng), min(x.vehicle_plate), min(x.note)
    into n, la, ln, plate, nt
    from public.ride_pickup(rid) x;
    perform tests.as_admin();
    perform pg_temp.expect(who || ' rows', n::text, '1');
    perform pg_temp.expect(who || ' lat', la::text, pg_temp.lat(pk.spot)::text);
    perform pg_temp.expect(who || ' lng', ln::text, pg_temp.lng(pk.spot)::text);
    perform pg_temp.expect(who || ' plate', plate, 'MRG10');
    perform pg_temp.expect(who || ' note', nt, 'North side of Park St');
  end loop;

  -- The other passenger in Bea's car, a closed requester (Cat, closed `full`), a stranger:
  -- nothing, and no error.
  foreach who in array array['02', '03', '06'] loop
    perform pg_temp.expect(who || ' sees the pickup', pg_temp.pickups(who, rid)::text, '0');
  end loop;
  perform pg_temp.expect('unknown ride', pg_temp.pickups('01', gen_random_uuid())::text, '0');

  -- A pending requester: Ivy's request to Gus is still open (closed only in group 12), and
  -- Gus+Dot was booked through confirm_ride, so it has a pickups row.
  perform pg_temp.expect('Ivy''s request still pending', pg_temp.state('06', pg_temp.kept('ivy_gus')), 'waiting_for_them');
  perform pg_temp.expect('Gus+Dot has pickups',
    (select count(*) from public.ride_pickups x where x.ride_id = pg_temp.kept('ride_gus_dot'))::text, '1');
  perform pg_temp.expect('Ivy (pending to Gus)', pg_temp.pickups('06', pg_temp.kept('ride_gus_dot'))::text, '0');

  raised := false;
  begin
    perform pg_temp.pickups('anon', rid);
  exception when insufficient_privilege then
    raised := true;
  end;
  perform tests.as_admin();
  if not raised then
    raise exception 'anon could call ride_pickup';
  end if;

  foreach who in array array['anon', '01', '10'] loop
    raised := false;
    begin
      perform pg_temp.as_who(who);
      execute 'select * from public.ride_pickups';
    exception when insufficient_privilege then
      raised := true;
    end;
    perform tests.as_admin();
    if not raised then
      raise exception '% could read ride_pickups', who;
    end if;
  end loop;
end
$$;

-- 10. Hiding: blocks and suspensions --------------------------------------------------------

do $$
declare
  past_ac uuid;
  past_cl uuid;
  fut_ac uuid;
  lk uuid := pg_temp.kept('ride_lu_kit');
  r public.rides;
  st text;
  c text;
  raised boolean;
begin
  past_ac := pg_temp.ride('11', '02', pg_temp.la_today() - 7);   -- Cy drove Abe last week
  perform pg_temp.add_pickup(past_ac, 'MRG11');
  past_cl := pg_temp.ride('15', '03', pg_temp.la_today() - 7);   -- Lu drove Cat last week
  perform pg_temp.add_pickup(past_cl, 'MRG15');
  fut_ac := pg_temp.ride('11', '02', pg_temp.dt());              -- Cy drives Abe on Dt

  perform pg_temp.expect('Abe before', pg_temp.pickups('02', past_ac)::text, '1');
  perform pg_temp.expect('Cy before', pg_temp.pickups('11', past_ac)::text, '1');
  perform pg_temp.expect('Cat before', pg_temp.pickups('03', past_cl)::text, '1');
  perform pg_temp.expect('Lu before', pg_temp.pickups('15', past_cl)::text, '1');

  -- Abe blocks Cy.
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('02'), pg_temp.uid('11'));
  perform pg_temp.expect('past ride after the block', (pg_temp.ride_row(past_ac)).status, 'confirmed');
  perform pg_temp.expect('Abe after the block', pg_temp.pickups('02', past_ac)::text, '0');
  perform pg_temp.expect('Cy after the block', pg_temp.pickups('11', past_ac)::text, '0');
  r := pg_temp.ride_row(fut_ac);
  perform pg_temp.expect('future ride after the block', r.status, 'cancelled');
  perform pg_temp.expect('future ride reason', r.cancel_reason, 'safety');
  if r.cancelled_at is null then
    raise exception 'A safety cancellation should set cancelled_at';
  end if;

  -- Lu is suspended.
  update public.profiles set suspended_at = now() where id = pg_temp.uid('15');
  perform pg_temp.expect('past ride after the suspension', (pg_temp.ride_row(past_cl)).status, 'confirmed');
  perform pg_temp.expect('Cat after the suspension', pg_temp.pickups('03', past_cl)::text, '0');
  r := pg_temp.ride_row(lk);
  perform pg_temp.expect('Lu+Kit after the suspension', r.status, 'cancelled');
  perform pg_temp.expect('Lu+Kit reason', r.cancel_reason, 'safety');

  -- Kit sees the ride cancelled, and nothing about why, when or by whom.
  perform tests.as_user(pg_temp.uid('16'));
  select x.status into st from public.rides x where x.id = lk;
  perform tests.as_admin();
  perform pg_temp.expect('Kit reads the status', st, 'cancelled');
  foreach c in array array['cancel_reason', 'cancelled_at', 'cancelled_by', 'cancelled_late'] loop
    raised := false;
    begin
      perform tests.as_user(pg_temp.uid('16'));
      execute format('select x.%I from public.rides x where x.id = $1', c) using lk;
    exception when insufficient_privilege then
      raised := true;
    end;
    perform tests.as_admin();
    if not raised then
      raise exception 'Kit could read rides.%', c;
    end if;
  end loop;
end
$$;

-- 11. Cancel -----------------------------------------------------------------------------

do $$
declare
  ba uuid := pg_temp.kept('ride_bea_abe');
  bz uuid;
  hj uuid;
  r public.rides;
begin
  perform pg_temp.expect('Abe sees the pickup', pg_temp.pickups('02', ba)::text, '1');
  perform pg_temp.expect('a third party cancels', pg_temp.code(pg_temp.cancel_err('03', ba)), '42501|unavailable');
  perform pg_temp.expect('still confirmed', (pg_temp.ride_row(ba)).status, 'confirmed');

  perform pg_temp.expect('Abe cancels', pg_temp.cancel_err('02', ba), 'ok');
  r := pg_temp.ride_row(ba);
  perform pg_temp.expect('cancelled status', r.status, 'cancelled');
  perform pg_temp.expect('cancelled_by', r.cancelled_by::text, pg_temp.uid('02')::text);
  perform pg_temp.expect('cancel_reason', r.cancel_reason, 'participant');
  perform pg_temp.expect('cancelled_late', r.cancelled_late::text, 'false');
  if r.cancelled_at is null then
    raise exception 'A cancellation should set cancelled_at';
  end if;
  perform pg_temp.expect('Abe after cancel', pg_temp.pickups('02', ba)::text, '0');
  perform pg_temp.expect('Bea after cancel', pg_temp.pickups('10', ba)::text, '0');
  perform pg_temp.expect('Abe cancels again', pg_temp.code(pg_temp.cancel_err('02', ba)), '42501|unavailable');

  -- Today's ride: after the 9 PM cutoff, so late (allowed, no penalty).
  bz := pg_temp.ride('10', '09', pg_temp.la_today());
  perform pg_temp.expect('Bea cancels today', pg_temp.cancel_err('10', bz), 'ok');
  r := pg_temp.ride_row(bz);
  perform pg_temp.expect('today status', r.status, 'cancelled');
  perform pg_temp.expect('today late', r.cancelled_late::text, 'true');
  perform pg_temp.expect('today cancelled_by', r.cancelled_by::text, pg_temp.uid('10')::text);

  -- Yesterday's ride is left for completion.
  hj := pg_temp.ride('14', '07', pg_temp.la_today() - 1);
  perform pg_temp.expect('past ride', pg_temp.code(pg_temp.cancel_err('07', hj)), '42501|unavailable');
  perform pg_temp.expect('past ride status', (pg_temp.ride_row(hj)).status, 'confirmed');
end
$$;

-- 12. Can't drive (Q11) ---------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  dt date := pg_temp.dt();
  gd uuid := pg_temp.kept('ride_gus_dot');
  ig uuid := pg_temp.kept('ivy_gus');
  ge uuid;
  hm uuid;
  r public.rides;
  n integer;
  res jsonb;
begin
  ge := pg_temp.ride('13', '05', dt);    -- Gus drives Eli on Dt
  hm := pg_temp.ride('14', '08', d);     -- Hal drives Mia on D

  perform pg_temp.expect('Gus can''t drive D', pg_temp.cant_err('13', d), 'ok');
  r := pg_temp.ride_row(gd);
  perform pg_temp.expect('Gus+Dot status', r.status, 'cancelled');
  perform pg_temp.expect('Gus+Dot reason', r.cancel_reason, 'cant_drive');
  perform pg_temp.expect('Gus+Dot cancelled_by', r.cancelled_by::text, pg_temp.uid('13')::text);
  perform pg_temp.expect('Gus+Eli on Dt', (pg_temp.ride_row(ge)).status, 'confirmed');
  perform pg_temp.expect('Hal+Mia on D', (pg_temp.ride_row(hm)).status, 'confirmed');
  perform pg_temp.expect('Ivy->Gus status', (pg_temp.inv(ig)).status, 'cancelled');
  perform pg_temp.expect('Ivy->Gus reason', (pg_temp.inv(ig)).cancel_reason, 'cant_drive');
  perform pg_temp.expect('Ivy sees Ivy->Gus', pg_temp.state('06', ig), 'unavailable');

  if not exists (select 1 from public.driver_days_off x where x.driver_id = pg_temp.uid('13') and x.ride_date = d) then
    raise exception 'The day off wasn''t recorded';
  end if;
  perform tests.as_user(pg_temp.uid('13'));
  select count(*) into n from public.driver_days_off x where x.ride_date = d;
  perform tests.as_admin();
  perform pg_temp.expect('Gus reads his day off', n::text, '1');
  perform tests.as_user(pg_temp.uid('06'));
  select count(*) into n from public.driver_days_off x;
  perform tests.as_admin();
  perform pg_temp.expect('Ivy reads days off', n::text, '0');

  res := pg_temp.match_ids('06', d, 'driver');
  if res @> to_jsonb(array[pg_temp.uid('13')]) then
    raise exception 'Gus matches as a driver on his day off: %', res;
  end if;
  res := pg_temp.match_ids('06', dt, 'driver');
  if not res @> to_jsonb(array[pg_temp.uid('13')]) then
    raise exception 'Gus should still match as a driver on Dt: %', res;
  end if;
  perform pg_temp.expect('Ivy asks Gus on D', pg_temp.code(pg_temp.send_err('06', pg_temp.uid('13'), 'driver', d)),
    '42501|unavailable');

  perform pg_temp.expect('Gus driver_day', pg_temp.driver_day_of('13', d), '(3,0,f,t)');
  perform pg_temp.expect('yesterday', pg_temp.code(pg_temp.cant_err('13', pg_temp.la_today() - 1)), '22023|invalid_input');
  perform pg_temp.expect('past the 14-day horizon', pg_temp.code(pg_temp.cant_err('13', pg_temp.la_today() + 15)),
    '22023|invalid_input');
  perform pg_temp.expect('twice', pg_temp.cant_err('13', d), 'ok');
  perform pg_temp.expect('one day off row',
    (select count(*) from public.driver_days_off x where x.driver_id = pg_temp.uid('13'))::text, '1');
end
$$;

-- 13. Q1 at confirm: the passenger is already booked that date, in either role ------------
-- Fresh members, so nothing above changes: 20 Pip, 24 Vic and 27 Zoe passengers; 21 Rex,
-- 22 Sol and 26 Ken drivers; 23 Tia and 25 Yan "Both". Every send comes before the
-- booking that would hide its people from matching.

do $$
declare
  d date := pg_temp.d();
  want text := '42501|unavailable|This ride isn''t available anymore';
  pr uuid;
  tr uuid;
  yk uuid;
  vy uuid;
begin
  perform pg_temp.member('20', 'Pip Park', vetted => false);  perform pg_temp.passenger('20');
  perform pg_temp.member('21', 'Rex Reed');                   perform pg_temp.driver('21');
  perform pg_temp.member('22', 'Sol Soto');                   perform pg_temp.driver('22');
  perform pg_temp.member('23', 'Tia Tran');                   perform pg_temp.driver('23');
                                                              perform pg_temp.passenger('23');
  perform pg_temp.member('24', 'Vic Vale', vetted => false);  perform pg_temp.passenger('24');
  perform pg_temp.member('25', 'Yan Yu');                     perform pg_temp.driver('25');
                                                              perform pg_temp.passenger('25');
  perform pg_temp.member('26', 'Ken Kerr');                   perform pg_temp.driver('26');
  perform pg_temp.member('27', 'Zoe Zhu', vetted => false);   perform pg_temp.passenger('27');

  pr := pg_temp.send('20', '21', 'driver', d);   -- Pip asks Rex
  tr := pg_temp.send('23', '21', 'driver', d);   -- Tia (as a passenger) asks Rex
  yk := pg_temp.send('25', '26', 'driver', d);   -- Yan (as a passenger) asks Ken
  vy := pg_temp.send('24', '25', 'driver', d);   -- Vic asks Yan (as a driver)

  -- a. Pip is booked with Sol behind Rex's back: Rex's confirm is the neutral refusal.
  perform pg_temp.ride('22', '20', d);
  perform pg_temp.expect('Pip''s request open for Rex', pg_temp.state('21', pr), 'waiting_for_me');
  perform pg_temp.expect('Rex confirms Pip', pg_temp.try_center('21', pr), want);
  if pg_temp.has_ride(pr) then
    raise exception 'Rex got a ride with Pip, who is booked with Sol';
  end if;

  -- b. Tia drives Zoe that date: her own request to Rex as a passenger is refused the same way.
  perform pg_temp.ride('23', '27', d);
  perform pg_temp.expect('Tia''s request open for Rex', pg_temp.state('21', tr), 'waiting_for_me');
  perform pg_temp.expect('Rex confirms Tia', pg_temp.try_center('21', tr), want);
  if pg_temp.has_ride(tr) then
    raise exception 'Rex got a ride with Tia, who drives that day';
  end if;

  -- c. Yan confirms Vic as a driver while asking Ken as a passenger: that request closes.
  perform pg_temp.confirm_center('25', vy);
  perform pg_temp.expect('Yan->Ken status', (pg_temp.inv(yk)).status, 'cancelled');
  perform pg_temp.expect('Yan->Ken reason', (pg_temp.inv(yk)).cancel_reason, 'booked_elsewhere');
  perform pg_temp.expect('Ken sees Yan->Ken', pg_temp.state('26', yk), 'unavailable');
end
$$;

rollback;

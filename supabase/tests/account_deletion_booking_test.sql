-- Account deletion and booking (M-32, D-15).
-- Spec: docs/superpowers/specs/2026-10-10-booking-design.md, section 9 ("Deletion").
--
-- Ada (deleted first) has: a ride with Bea on D, confirmed through confirm_ride (so it
-- has pickup details), and a past confirmed ride with Bea with a pickup row. Dee also
-- rides with Bea on D. Cy (deleted second) has a recorded day off on D and a ride with
-- Dee on Dt that he cancelled himself.
-- After Ada's auth.users row is deleted: her future ride is cancelled for account
-- deletion with her column null, no pickup details of any ride she was in remain, and
-- Dee's ride with Bea is untouched. After Cy's: his days off are gone, and the ride he
-- cancelled stays for Dee with his columns null and its reason unchanged.
begin;

select tests.as_admin();

create temporary table place (name text primary key, pt extensions.geography) on commit drop;
insert into place values
  ('park',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)')),
  ('fremont', extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)')),
  ('webster', extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)')),
  ('mont',    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)'));

create temporary table ids (name text primary key, id uuid not null) on commit drop;

create function pg_temp.keep(k text, v uuid) returns uuid
language sql as $$ insert into ids (name, id) values (k, v) returning id $$;

create function pg_temp.kept(k text) returns uuid
language sql stable as $$ select i.id from ids i where i.name = k $$;

create function pg_temp.pt(n text) returns extensions.geography
language sql stable as $$ select p.pt from place p where p.name = n $$;

create function pg_temp.uid(n text) returns uuid
language sql immutable as $$ select ('00000000-0000-0000-0000-0000000033' || n)::uuid $$;

create function pg_temp.la_today() returns date
language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

create function pg_temp.next_dow(dow integer) returns date
language sql stable as $$
  select pg_temp.la_today() + 2
    + ((dow - extract(isodow from pg_temp.la_today() + 2)::integer + 7) % 7)
$$;

create function pg_temp.d() returns date language sql stable as $$ select pg_temp.next_dow(3) $$;   -- Wednesday
create function pg_temp.dt() returns date language sql stable as $$ select pg_temp.next_dow(4) $$;  -- Thursday

create function pg_temp.member(n text, display text, vetted boolean) returns void
language sql as $$
  insert into auth.users (id, email) values (pg_temp.uid(n), 'k' || n || '@example.test');
  insert into public.profiles (id, display_name, discovery_opt_in, vetted_at)
  values (pg_temp.uid(n), display, true, case when vetted then now() end);
$$;

create function pg_temp.driver(n text) returns void
language plpgsql as $$
declare
  vid uuid;
begin
  insert into public.vehicles (owner_id, make, model, color, plate, passenger_seats, accepts_foldable_scooters)
  values (pg_temp.uid(n), 'Honda', 'Fit', 'Red', 'DEL' || n, 3, true)
  returning id into vid;
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays,
                               departure_flex_minutes, vehicle_id, seats_offered)
  values (pg_temp.uid(n), 'driver', pg_temp.pt('park'), pg_temp.pt('fremont'), '07:40', '{1,2,3,4,5}', 15, vid, 3);
end
$$;

create function pg_temp.passenger(n text) returns void
language sql as $$
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, departure_flex_minutes)
  values (pg_temp.uid(n), 'passenger', pg_temp.pt('webster'), pg_temp.pt('mont'), '07:45', '{1,2,3,4,5}', 15);
$$;

-- An admin-inserted ride between drv and pax on day d, behind a booked invitation.
create function pg_temp.ride(drv text, pax text, d date) returns uuid
language plpgsql as $$
declare
  inv uuid;
  rid uuid;
begin
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date, direction)
  select pg_temp.uid(pax), pg_temp.uid(drv), c.id, 'booked', d, 'request'
  from public.commutes c where c.owner_id = pg_temp.uid(pax) and c.role = 'passenger'
  returning id into inv;
  update public.invitations set created_at = now() - interval '30 days' where id = inv;
  insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind)
  values (inv, pg_temp.uid(drv), pg_temp.uid(pax), d, '07:45', 'confirmed', 'first_ride')
  returning id into rid;
  return rid;
end
$$;

create function pg_temp.send(who text, rcpt text, other_role text, d date) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  perform tests.as_user(pg_temp.uid(who));
  id := public.send_invitation(pg_temp.uid(rcpt), other_role, d);
  perform tests.as_admin();
  return id;
end
$$;

-- confirm_ride as `who`, with the spot at the invitation's area center: the ride id.
create function pg_temp.confirm_center(who text, inv uuid) returns uuid
language plpgsql as $$
declare
  c extensions.geography;
  rid uuid;
begin
  select i.pickup_area into c from public.invitations i where i.id = inv;
  perform tests.as_user(pg_temp.uid(who));
  rid := public.confirm_ride(inv, extensions.st_y(c::extensions.geometry), extensions.st_x(c::extensions.geometry),
                             'By the gate', false);
  perform tests.as_admin();
  return rid;
end
$$;

create function pg_temp.cancel(who text, rid uuid) returns void
language plpgsql as $$
begin
  perform tests.as_user(pg_temp.uid(who));
  perform public.cancel_ride(rid);
  perform tests.as_admin();
end
$$;

create function pg_temp.cant_drive(who text, rd date) returns void
language plpgsql as $$
begin
  perform tests.as_user(pg_temp.uid(who));
  perform public.cant_drive(rd);
  perform tests.as_admin();
end
$$;

-- How many rows ride_pickup gives `who` for rid.
create function pg_temp.pickups(who text, rid uuid) returns integer
language plpgsql as $$
declare
  n integer;
begin
  perform tests.as_user(pg_temp.uid(who));
  select count(*) into n from public.ride_pickup(rid);
  perform tests.as_admin();
  return n;
end
$$;

create function pg_temp.ride_row(rid uuid) returns public.rides
language sql stable as $$ select r.* from public.rides r where r.id = rid $$;

-- Fixture ------------------------------------------------------------------------------

select pg_temp.member('01', 'Ada Lovelace', false);  select pg_temp.passenger('01');
select pg_temp.member('02', 'Dee Diaz', false);      select pg_temp.passenger('02');
select pg_temp.member('10', 'Bea Brown', true);      select pg_temp.driver('10');
select pg_temp.member('11', 'Cy Chen', true);        select pg_temp.driver('11');

do $$
declare
  d date := pg_temp.d();
  dt date := pg_temp.dt();
  ada_req uuid;
  dee_req uuid;
  past uuid;
  cd uuid;
begin
  ada_req := pg_temp.send('01', '10', 'driver', d);
  dee_req := pg_temp.send('02', '10', 'driver', d);
  perform pg_temp.keep('ab', pg_temp.confirm_center('10', ada_req));

  past := pg_temp.keep('past', pg_temp.ride('10', '01', pg_temp.la_today() - 7));
  insert into public.ride_pickups (ride_id, spot, note, vehicle_make, vehicle_model, vehicle_color, vehicle_plate)
  values (past, pg_temp.pt('webster'), 'Last week', 'Honda', 'Fit', 'Red', 'DEL10');

  perform pg_temp.keep('db', pg_temp.confirm_center('10', dee_req));

  perform pg_temp.cant_drive('11', d);
  cd := pg_temp.keep('cd', pg_temp.ride('11', '02', dt));
  perform pg_temp.cancel('11', cd);

  -- The fixture is what the checks below assume.
  if (select count(*) from public.ride_pickups x
      where x.ride_id in (pg_temp.kept('ab'), past, pg_temp.kept('db'))) <> 3 then
    raise exception 'Fixture: every ride should have pickup details';
  end if;
  if (pg_temp.ride_row(pg_temp.kept('ab'))).status <> 'confirmed'
     or (pg_temp.ride_row(pg_temp.kept('db'))).status <> 'confirmed' then
    raise exception 'Fixture: both of Bea''s rides on D should be confirmed';
  end if;
  if not exists (select 1 from public.driver_days_off x where x.driver_id = pg_temp.uid('11') and x.ride_date = d) then
    raise exception 'Fixture: Cy''s day off wasn''t recorded';
  end if;
  if (pg_temp.ride_row(cd)).cancelled_by is distinct from pg_temp.uid('11')
     or (pg_temp.ride_row(cd)).cancel_reason is distinct from 'participant' then
    raise exception 'Fixture: Cy should have cancelled his ride with Dee';
  end if;
  if pg_temp.pickups('10', pg_temp.kept('ab')) <> 1 then
    raise exception 'Fixture: Bea should see the pickup of her ride with Ada';
  end if;
end
$$;

-- 1. Deleting Ada succeeds ------------------------------------------------------------------

delete from auth.users where id = '00000000-0000-0000-0000-000000003301';

do $$
declare
  ab uuid := pg_temp.kept('ab');
  past uuid := pg_temp.kept('past');
  db uuid := pg_temp.kept('db');
  r public.rides;
begin
  if exists (select 1 from public.profiles p where p.id = pg_temp.uid('01')) then
    raise exception 'Ada''s profile survived';
  end if;

  -- 2. Her future ride is cancelled for account deletion and stays for Bea.
  r := pg_temp.ride_row(ab);
  if r.id is null then
    raise exception 'Ada''s future ride was deleted';
  end if;
  if r.status is distinct from 'cancelled' or r.cancel_reason is distinct from 'account_deleted' then
    raise exception 'Ada''s future ride should be cancelled for account_deleted, is % / %', r.status, r.cancel_reason;
  end if;
  if r.passenger_id is not null or r.driver_id is distinct from pg_temp.uid('10') then
    raise exception 'Ada''s future ride should keep Bea and clear Ada: % / %', r.driver_id, r.passenger_id;
  end if;

  -- 3. No pickup details of any ride she was in remain, future or past.
  if exists (select 1 from public.ride_pickups x where x.ride_id in (ab, past)) then
    raise exception 'Pickup details of a ride with Ada outlived her account';
  end if;
  if pg_temp.pickups('10', ab) <> 0 then
    raise exception 'Bea still sees the pickup of the ride with Ada';
  end if;

  -- 4. Dee's ride with Bea is untouched.
  r := pg_temp.ride_row(db);
  if r.status is distinct from 'confirmed' or r.passenger_id is distinct from pg_temp.uid('02')
     or r.driver_id is distinct from pg_temp.uid('10') or r.cancel_reason is not null then
    raise exception 'Dee''s ride with Bea changed: % / % / %', r.status, r.passenger_id, r.cancel_reason;
  end if;
  if not exists (select 1 from public.ride_pickups x where x.ride_id = db and x.note = 'By the gate') then
    raise exception 'The pickup of Dee''s ride with Bea changed';
  end if;
  if pg_temp.pickups('02', db) <> 1 or pg_temp.pickups('10', db) <> 1 then
    raise exception 'Dee and Bea should still see their pickup';
  end if;
end
$$;

-- 5. Deleting Cy: his days off go; the ride he cancelled stays for Dee ------------------------

delete from auth.users where id = '00000000-0000-0000-0000-000000003311';

do $$
declare
  cd uuid := pg_temp.kept('cd');
  r public.rides;
begin
  if exists (select 1 from public.driver_days_off) then
    raise exception 'Cy''s days off outlived his account';
  end if;

  r := pg_temp.ride_row(cd);
  if r.id is null then
    raise exception 'The ride Cy cancelled was deleted, though Dee is still there';
  end if;
  if r.driver_id is not null or r.cancelled_by is not null then
    raise exception 'Cy''s columns should be null: driver % / cancelled_by %', r.driver_id, r.cancelled_by;
  end if;
  if r.passenger_id is distinct from pg_temp.uid('02') then
    raise exception 'The ride should keep Dee, has %', r.passenger_id;
  end if;
  if r.status is distinct from 'cancelled' or r.cancel_reason is distinct from 'participant' then
    raise exception 'The cancelled ride should keep its reason, is % / %', r.status, r.cancel_reason;
  end if;
end
$$;

rollback;

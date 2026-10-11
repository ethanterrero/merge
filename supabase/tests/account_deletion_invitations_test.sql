-- Account deletion and invitations (M-27, D-15).
-- Spec: docs/superpowers/specs/2026-10-10-booking-design.md, section 10.
--
-- Ada (deleted) has: a pending request to Bea, an invite from Cy she accepted, a
-- request Dee declined (held), a request she withdrew (to Eve), and an invitation
-- behind a completed ride with Bea last week. Bea also has an unrelated invite to Abe.
-- After Ada's auth.users row is deleted: every invitation of hers with no ride is
-- gone, both ways; the ride's invitation stays with her column null and her pickup
-- area cleared; nobody else sees or can act on anything of hers.
begin;

select tests.as_admin();

create temporary table place (name text primary key, pt extensions.geography) on commit drop;
insert into place values
  ('park',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)')),
  ('fremont', extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)')),
  ('webster', extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)')),
  ('mont',    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)'));

create function pg_temp.uid(n text) returns uuid
language sql immutable as $$ select ('00000000-0000-0000-0000-0000000029' || n)::uuid $$;

create function pg_temp.la_today() returns date
language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- The next Wednesday at least two days out.
create function pg_temp.d() returns date
language sql stable as $$
  select pg_temp.la_today() + 2
    + ((3 - extract(isodow from pg_temp.la_today() + 2)::integer + 7) % 7)
$$;

create function pg_temp.member(n text, display text, vetted boolean) returns void
language sql as $$
  insert into auth.users (id, email) values (pg_temp.uid(n), 'd' || n || '@example.test');
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
  select pg_temp.uid(n), 'driver', a.pt, b.pt, '07:40', '{1,2,3,4,5}', 15, vid, 3
  from place a, place b where a.name = 'park' and b.name = 'fremont';
end
$$;

create function pg_temp.passenger(n text) returns void
language sql as $$
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays, departure_flex_minutes)
  select pg_temp.uid(n), 'passenger', a.pt, b.pt, '07:45', '{1,2,3,4,5}', 15
  from place a, place b where a.name = 'webster' and b.name = 'mont';
$$;

create function pg_temp.send(who text, rcpt text, other_role text) returns uuid
language plpgsql as $$
declare
  id uuid;
begin
  perform tests.as_user(pg_temp.uid(who));
  id := public.send_invitation(pg_temp.uid(rcpt), other_role, pg_temp.d());
  perform tests.as_admin();
  return id;
end
$$;

create function pg_temp.act(who text, action text, inv uuid) returns text
language plpgsql as $$
declare
  h text;
begin
  perform tests.as_user(pg_temp.uid(who));
  begin
    execute format('select public.%s_invitation($1)', action) using inv;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    perform tests.as_admin();
    return sqlstate || '|' || coalesce(h, '');
  end;
  perform tests.as_admin();
  return 'ok';
end
$$;

create function pg_temp.view(who text) returns jsonb
language plpgsql as $$
declare
  res jsonb;
begin
  perform tests.as_user(pg_temp.uid(who));
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into res from public.my_invitations() m;
  perform tests.as_admin();
  return res;
end
$$;

-- Fixture ------------------------------------------------------------------------------

select pg_temp.member('01', 'Ada Lovelace', false);  select pg_temp.passenger('01');
select pg_temp.member('02', 'Abe Adams', false);     select pg_temp.passenger('02');
select pg_temp.member('10', 'Bea Brown', true);      select pg_temp.driver('10');
select pg_temp.member('11', 'Cy Chen', true);        select pg_temp.driver('11');
select pg_temp.member('12', 'Dee Diaz', true);       select pg_temp.driver('12');
select pg_temp.member('13', 'Eve Eden', true);       select pg_temp.driver('13');

create temporary table inv (name text primary key, id uuid) on commit drop;

do $$
declare
  ada public.commutes;
  i uuid;
  r text;
begin
  insert into inv values ('pending', pg_temp.send('01', '10', 'driver'));
  insert into inv values ('accepted', pg_temp.send('11', '01', 'passenger'));
  r := pg_temp.act('01', 'accept', (select id from inv where name = 'accepted'));
  if r <> 'ok' then raise exception 'Ada couldn''t accept: %', r; end if;
  insert into inv values ('declined', pg_temp.send('01', '12', 'driver'));
  r := pg_temp.act('12', 'decline', (select id from inv where name = 'declined'));
  if r <> 'ok' then raise exception 'Dee couldn''t decline: %', r; end if;
  insert into inv values ('withdrawn', pg_temp.send('01', '13', 'driver'));
  r := pg_temp.act('01', 'withdraw', (select id from inv where name = 'withdrawn'));
  if r <> 'ok' then raise exception 'Ada couldn''t withdraw: %', r; end if;
  insert into inv values ('unrelated', pg_temp.send('10', '02', 'passenger'));

  -- The ride's invitation, as M-32 will write it, with Ada's area copied onto it.
  select * into ada from public.commutes c where c.owner_id = pg_temp.uid('01') and c.role = 'passenger';
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date, direction,
                                  pickup_area, pickup_area_label, pickup_time)
  values (pg_temp.uid('01'), pg_temp.uid('10'), ada.id, 'booked', pg_temp.la_today() - 7, 'request',
          ada.origin_area, ada.origin_area_label, '07:45')
  returning id into i;
  insert into inv values ('ride', i);
  insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind, completed_at)
  values (i, pg_temp.uid('10'), pg_temp.uid('01'), pg_temp.la_today() - 7, '07:45', 'completed', 'first_ride', now());

  if (select count(*) from public.invitations) <> 6 then
    raise exception 'Fixture should have 6 invitations, has %', (select count(*) from public.invitations);
  end if;
end
$$;

-- 1. The delete succeeds ------------------------------------------------------------------

delete from auth.users where id = '00000000-0000-0000-0000-000000002901';

do $$
declare
  kept public.invitations;
begin
  if exists (select 1 from public.profiles where id = pg_temp.uid('01')) then
    raise exception 'Ada''s profile survived';
  end if;

  -- 2. Every invitation of Ada's with no ride is gone, both ways and every status.
  if exists (select 1 from public.invitations i join inv on inv.id = i.id
             where inv.name in ('pending', 'accepted', 'declined', 'withdrawn')) then
    raise exception 'An invitation of Ada''s with no ride survived';
  end if;

  -- 3. The ride's invitation stays, with Ada's column and her area cleared.
  select i.* into kept from public.invitations i where i.id = (select id from inv where name = 'ride');
  if not found then
    raise exception 'The invitation behind the ride was deleted';
  end if;
  if kept.sender_id is not null or kept.recipient_id is distinct from pg_temp.uid('10') then
    raise exception 'The kept invitation should have Ada null and Bea kept: % / %', kept.sender_id, kept.recipient_id;
  end if;
  if kept.pickup_area is not null or kept.pickup_area_label is not null then
    raise exception 'Ada''s pickup area outlived her account';
  end if;
  if not exists (select 1 from public.rides r where r.invitation_id = kept.id and r.passenger_id is null
                 and r.driver_id = pg_temp.uid('10')) then
    raise exception 'The ride should stay for Bea with the passenger cleared';
  end if;

  -- The unrelated invitation is untouched.
  if (select status from public.invitations where id = (select id from inv where name = 'unrelated')) <> 'pending' then
    raise exception 'Bea''s invite to Abe changed';
  end if;
end
$$;

-- 4. Nobody sees anything of Ada's, and the others carry on ----------------------------

do $$
declare
  v jsonb;
  r text;
begin
  v := pg_temp.view('10');
  if jsonb_array_length(v) <> 1 or v -> 0 ->> 'id' <> (select id::text from inv where name = 'unrelated') then
    raise exception 'Bea should see only her invite to Abe: %', v;
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'other_id' is null) then
    raise exception 'A row with no counterpart is visible';
  end if;
  foreach r in array array['11', '12', '13'] loop
    if pg_temp.view(r) <> '[]'::jsonb then
      raise exception 'Member % still sees an invitation: %', r, pg_temp.view(r);
    end if;
  end loop;

  -- Cy, Dee and Eve can invite Abe on the same date; nothing of Ada's is in their way.
  perform pg_temp.send('11', '02', 'passenger');
  perform tests.as_user(pg_temp.uid('02'));
  perform public.send_invitation(pg_temp.uid('12'), 'driver', pg_temp.d());
  perform tests.as_admin();

  -- 5. Every action on the kept invitation is refused, the same way.
  foreach r in array array['accept', 'decline', 'withdraw'] loop
    if pg_temp.act('10', r, (select id from inv where name = 'ride')) <> '42501|unavailable' then
      raise exception 'Bea could % the kept invitation: %', r, pg_temp.act('10', r, (select id from inv where name = 'ride'));
    end if;
  end loop;
end
$$;

rollback;

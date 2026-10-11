-- Invitations (M-27): send, accept, decline, withdraw, my_invitations, and the
-- block, suspension and matching hooks in *_invitations.sql.
-- Spec: docs/superpowers/specs/2026-10-10-booking-design.md, section 10.
--
-- now() is fixed for the whole transaction, so cutoffs and holds are tested by
-- passing a time to invitation_state and by moving expires_at / held_until into
-- the past as admin. Ride dates are the next Tue/Wed/Thu at least two days out,
-- so the 8 PM cutoff never interferes, and all are within the 14-day horizon.
-- pg_temp.reset() deletes every invitation not behind a ride between groups, so
-- the daily and open counts start from zero.
--
-- Members (ids end in 27xx). Drivers go Park St -> Market & Fremont at 7:40 (flex 15,
-- Mon-Fri, 3 seats, trunk fits a scooter, vetted, opted in) unless noted; passengers
-- go Webster St -> Montgomery at 7:45 (flex 15, Mon-Fri, opted in), a 2-minute detour.
--   01 Ada  passenger (unvetted)          02 Abe  passenger
--   03 Rid  passenger, booked with Full on D
--   04 Uma  unvetted driver               05 Nov  vetted driver, no vehicle
--   10 Bea, 11 Cy, 12 Dee, 13 Eve, 14 Fay, 15 Gus   plain drivers
--   16 Box  trunk doesn't fit a scooter
--   20 Opal opted out     21 Sam suspended     22 Bob blocked by Ada    23 Bix blocked Ada
--   25 Far  Lake Merritt -> FiDi (8 min)      26 Full one seat, booked by Rid on D
--   30 Ken  opted out, connected with Ada (Ride Again)
--   31 Liv  a completed ride with Ada and no connection (Q5)
--   32 Mo   opted out, connected with Ada, active Crew on Wednesdays
begin;

select tests.as_admin();

-- Helpers --------------------------------------------------------------------------

create temporary table place (name text primary key, pt extensions.geography) on commit drop;
insert into place values
  ('park',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2446 37.7638)')),
  ('fremont', extensions.st_geogfromtext('SRID=4326;POINT(-122.3966 37.7910)')),
  ('webster', extensions.st_geogfromtext('SRID=4326;POINT(-122.2777 37.7665)')),
  ('mont',    extensions.st_geogfromtext('SRID=4326;POINT(-122.4021 37.7894)')),
  ('lake',    extensions.st_geogfromtext('SRID=4326;POINT(-122.2575 37.8030)'));

create function pg_temp.pt(n text) returns extensions.geography
language sql stable as $$ select p.pt from place p where p.name = n $$;

create function pg_temp.uid(n text) returns uuid
language sql immutable as $$ select ('00000000-0000-0000-0000-0000000027' || n)::uuid $$;

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
  insert into auth.users (id, email) values (pg_temp.uid(n), 'm' || n || '@example.test');
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

create function pg_temp.passenger(n text) returns uuid
language plpgsql as $$
declare
  cid uuid;
begin
  insert into public.commutes (owner_id, role, origin, destination, departure_time, weekdays,
                               departure_flex_minutes)
  values (pg_temp.uid(n), 'passenger', pg_temp.pt('webster'), pg_temp.pt('mont'), '07:45', '{1,2,3,4,5}', 15)
  returning id into cid;
  return cid;
end
$$;

create function pg_temp.commute_of(n text, r text) returns public.commutes
language sql stable as $$
  select c.* from public.commutes c where c.owner_id = pg_temp.uid(n) and c.role = r
$$;

-- A ride between drv and pax on day d, behind a booked invitation (as M-32 will write it).
create function pg_temp.ride(drv text, pax text, d date, st text default 'confirmed') returns uuid
language plpgsql as $$
declare
  inv uuid;
  rid uuid;
begin
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date, direction)
  values (pg_temp.uid(pax), pg_temp.uid(drv), (pg_temp.commute_of(pax, 'passenger')).id, 'booked', d, 'request')
  returning id into inv;
  insert into public.rides (invitation_id, driver_id, passenger_id, ride_date, pickup_time, status, kind)
  values (inv, pg_temp.uid(drv), pg_temp.uid(pax), d, '07:45', st, 'first_ride')
  returning id into rid;
  return rid;
end
$$;

create function pg_temp.reset() returns void
language sql as $$
  delete from public.invitations i
  where not exists (select 1 from public.rides r where r.invitation_id = i.id);
$$;

create function pg_temp.as_who(who text) returns void
language plpgsql as $$
begin
  if who = 'anon' then
    perform tests.as_anon();
  elsif who = 'admin' then
    perform tests.as_admin();
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

create function pg_temp.expect(label text, got text, want text) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception '%: got %, want %', label, coalesce(got, 'null'), coalesce(want, 'null');
  end if;
end
$$;

-- 'SQLSTATE|hint' of an error string from send_err / act.
create function pg_temp.code(err text) returns text
language sql immutable as $$ select split_part(err, '|', 1) || '|' || split_part(err, '|', 2) $$;

-- Fixture ------------------------------------------------------------------------------

select pg_temp.member('01', 'Ada Lovelace', vetted => false);  select pg_temp.passenger('01');
select pg_temp.member('02', 'Abe Adams', vetted => false);     select pg_temp.passenger('02');
select pg_temp.member('03', 'Rid Rhee', vetted => false);      select pg_temp.passenger('03');
select pg_temp.member('04', 'Uma Ueda', vetted => false);      select pg_temp.driver('04');
select pg_temp.member('05', 'Nov Noel');                       select pg_temp.driver('05', with_vehicle => false);
select pg_temp.member('10', 'Bea Brown');                      select pg_temp.driver('10');
select pg_temp.member('11', 'Cy Chen');                        select pg_temp.driver('11');
select pg_temp.member('12', 'Dee Diaz');                       select pg_temp.driver('12');
select pg_temp.member('13', 'Eve Eden');                       select pg_temp.driver('13');
select pg_temp.member('14', 'Fay Fox');                        select pg_temp.driver('14');
select pg_temp.member('15', 'Gus Gray');                       select pg_temp.driver('15');
select pg_temp.member('16', 'Box Boxer');                      select pg_temp.driver('16', fits => false);
select pg_temp.member('20', 'Opal Ortiz', opt_in => false);    select pg_temp.driver('20');
select pg_temp.member('21', 'Sam Stone');                      select pg_temp.driver('21');
select pg_temp.member('22', 'Bob Boyd');                       select pg_temp.driver('22');
select pg_temp.member('23', 'Bix Bauer');                      select pg_temp.driver('23');
select pg_temp.member('25', 'Far Ford');                       select pg_temp.driver('25', 'lake');
select pg_temp.member('26', 'Full Fox');                       select pg_temp.driver('26', seats => 1);
select pg_temp.member('30', 'Ken Kerr', opt_in => false);      select pg_temp.driver('30');
select pg_temp.member('31', 'Liv Lee');                        select pg_temp.driver('31');
select pg_temp.member('32', 'Mo Moss', opt_in => false);       select pg_temp.driver('32');

update public.profiles set suspended_at = now() where id = pg_temp.uid('21');
insert into public.blocks (blocker_id, blocked_id) values
  (pg_temp.uid('01'), pg_temp.uid('22')),
  (pg_temp.uid('23'), pg_temp.uid('01'));
insert into public.connections (user_low, user_high, crew_eligible) values
  (pg_temp.uid('01'), pg_temp.uid('30'), false),
  (pg_temp.uid('01'), pg_temp.uid('32'), true);
insert into public.commute_crews (id, user_low, user_high, proposed_by, weekdays, departure_time, status, responded_at)
values ('40000000-0000-0000-0000-000000002701', pg_temp.uid('01'), pg_temp.uid('32'), pg_temp.uid('32'),
        '{3}', '07:40', 'active', now());

select pg_temp.ride('26', '03', pg_temp.d());                              -- Full drives Rid on D
select pg_temp.ride('31', '01', pg_temp.la_today() - 7, 'completed');      -- Liv drove Ada last week

-- 1. Privileges and shape --------------------------------------------------------------

do $$
declare
  f record;
  p record;
  priv text;
  cols text[];
begin
  foreach priv in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('authenticated', 'public.invitations', priv)
       or has_table_privilege('anon', 'public.invitations', priv) then
      raise exception 'A client role has % on invitations', priv;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'invitations' and cmd = 'SELECT') <> 1
     or exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'invitations' and cmd <> 'SELECT') then
    raise exception 'invitations should have exactly one policy, a participant select';
  end if;

  for f in
    select * from (values
      ('public.send_invitation(uuid, text, date, time, boolean, uuid)', true, true),
      ('public.accept_invitation(uuid)', true, true),
      ('public.decline_invitation(uuid)', true, true),
      ('public.withdraw_invitation(uuid)', true, true),
      ('public.my_invitations()', true, true),
      ('public.invitation_state(public.invitations, uuid, timestamptz)', false, false),
      ('public.invitation_counterpart_visible(public.invitations, uuid)', false, false),
      ('public.invitation_open_for(public.invitations, uuid, timestamptz)', false, false),
      ('public.invitation_for_action(uuid, uuid)', false, false),
      ('public.invitation_unavailable()', false, false),
      ('public.close_invitations(uuid[], text)', false, false),
      ('public.reply_cutoff_minutes()', false, false),
      ('public.cancel_cutoff_minutes()', false, false),
      ('public.ride_cutoff(date, integer)', false, false),
      ('public.reply_cutoff(date)', false, false),
      ('public.match_candidates(uuid, date, boolean)', false, false),
      ('public.match_candidates(uuid, date)', false, false),
      ('public.blocks_close_invitations()', false, true),
      ('public.invitations_fill_defaults()', false, false),
      ('public.invitations_set_updated_at()', false, false),
      ('public.withdraw_member(uuid)', false, true),
      ('public.profiles_apply_deletion_policy()', false, true)
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

  select array_agg(u.n order by u.i) into cols
  from pg_proc pr, unnest(pr.proargnames, pr.proargmodes) with ordinality as u(n, m, i)
  where pr.oid = 'public.my_invitations()'::regprocedure and u.m = 't';
  if cols is distinct from array[
    'id', 'ride_date', 'kind', 'direction', 'my_role', 'other_id', 'state', 'reply_by',
    'pickup_area_lat', 'pickup_area_lng', 'pickup_area_label', 'area_radius_m',
    'pickup_time', 'seats', 'brings_scooter', 'crew_id', 'ride_id', 'created_at'] then
    raise exception 'my_invitations output columns are %', cols;
  end if;
  if exists (
    select 1 from pg_proc pr, unnest(pr.proallargtypes, pr.proargmodes) as u(t, m)
    where pr.oid = 'public.my_invitations()'::regprocedure and u.m = 't'
      and u.t in ('extensions.geography'::regtype, 'extensions.geometry'::regtype)
  ) then
    raise exception 'my_invitations returns a geography or geometry column';
  end if;

  if (select count(*) from pg_indexes where schemaname = 'public' and indexname in (
        'invitations_sender_id_idx', 'invitations_recipient_id_idx', 'invitations_commute_id_idx',
        'invitations_crew_id_idx', 'invitations_sender_ride_date_idx', 'invitations_recipient_ride_date_idx')) <> 6 then
    raise exception 'An invitations index is missing';
  end if;
end
$$;

-- A raw server-side insert with only the 0001/0003 columns gets every new column filled.
do $$
declare
  bea public.commutes := pg_temp.commute_of('10', 'driver');
  i public.invitations;
begin
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date, expires_at)
  values (pg_temp.uid('01'), pg_temp.uid('10'), bea.id, 'pending', pg_temp.d(), now() + interval '1 year')
  returning * into i;
  perform pg_temp.expect('legacy expires_at', i.expires_at::text, public.reply_cutoff(pg_temp.d())::text);
  perform pg_temp.expect('legacy kind', i.kind, 'first_ride');
  perform pg_temp.expect('legacy direction', i.direction, 'request');
  perform pg_temp.expect('legacy pickup_time', i.pickup_time::text, '07:40:00');
  perform pg_temp.expect('legacy pickup_area', extensions.st_astext(i.pickup_area), extensions.st_astext(bea.origin_area));
  perform pg_temp.expect('legacy label', i.pickup_area_label, bea.origin_area_label);
  perform pg_temp.expect('legacy seats', i.seats::text, '1');
end
$$;
select pg_temp.reset();

-- 2. Cutoffs (D-02, mirrors M-08) -----------------------------------------------------

do $$
begin
  perform pg_temp.expect('reply minutes', public.reply_cutoff_minutes()::text, '1200');
  perform pg_temp.expect('cancel minutes', public.cancel_cutoff_minutes()::text, '1260');
  if public.reply_cutoff('2026-10-13') <> '2026-10-13 03:00:00+00'::timestamptz then
    raise exception 'PDT cutoff is %', public.reply_cutoff('2026-10-13');
  end if;
  if public.reply_cutoff('2026-11-02') <> '2026-11-02 04:00:00+00'::timestamptz then
    raise exception 'Cutoff on the Sunday DST ends is %', public.reply_cutoff('2026-11-02');
  end if;
  if public.reply_cutoff('2027-03-15') <> '2027-03-15 03:00:00+00'::timestamptz then
    raise exception 'Cutoff on the Sunday DST starts is %', public.reply_cutoff('2027-03-15');
  end if;
  if public.ride_cutoff('2026-10-13', public.cancel_cutoff_minutes())
     <> public.reply_cutoff('2026-10-13') + interval '1 hour' then
    raise exception 'The cancel cutoff should be an hour after the reply cutoff';
  end if;
end
$$;

-- 3. Send, both directions ------------------------------------------------------------

do $$
declare
  ada public.commutes := pg_temp.commute_of('01', 'passenger');
  abe public.commutes := pg_temp.commute_of('02', 'passenger');
  bea public.commutes := pg_temp.commute_of('10', 'driver');
  req uuid;
  inv uuid;
  i public.invitations;
  r jsonb;
begin
  req := pg_temp.send('01', '10', 'driver', pg_temp.d());
  i := pg_temp.inv(req);
  perform pg_temp.expect('request sender', i.sender_id::text, pg_temp.uid('01')::text);
  perform pg_temp.expect('request recipient', i.recipient_id::text, pg_temp.uid('10')::text);
  perform pg_temp.expect('request direction', i.direction, 'request');
  perform pg_temp.expect('request kind', i.kind, 'first_ride');
  perform pg_temp.expect('request status', i.status, 'pending');
  perform pg_temp.expect('request commute', i.commute_id::text, ada.id::text);
  perform pg_temp.expect('request area', extensions.st_astext(i.pickup_area), extensions.st_astext(ada.origin_area));
  perform pg_temp.expect('request label', i.pickup_area_label, ada.origin_area_label);
  perform pg_temp.expect('request time', i.pickup_time::text, '07:45:00');
  perform pg_temp.expect('request seats', i.seats::text, '1');
  perform pg_temp.expect('request scooter', i.brings_scooter::text, 'false');
  perform pg_temp.expect('request crew', i.crew_id::text, null);
  perform pg_temp.expect('request expires', i.expires_at::text, public.reply_cutoff(pg_temp.d())::text);

  r := pg_temp.row_of('01', req);
  perform pg_temp.expect('Ada state', r ->> 'state', 'waiting_for_them');
  perform pg_temp.expect('Ada role', r ->> 'my_role', 'passenger');
  perform pg_temp.expect('Ada other', r ->> 'other_id', pg_temp.uid('10')::text);
  perform pg_temp.expect('Ada reply_by', (r ->> 'reply_by')::timestamptz::text, i.expires_at::text);
  perform pg_temp.expect('Ada kind', r ->> 'kind', 'first_ride');
  perform pg_temp.expect('Ada lat', (r ->> 'pickup_area_lat')::double precision::text,
    extensions.st_y(ada.origin_area::extensions.geometry)::text);
  perform pg_temp.expect('Ada lng', (r ->> 'pickup_area_lng')::double precision::text,
    extensions.st_x(ada.origin_area::extensions.geometry)::text);
  perform pg_temp.expect('Ada radius', r ->> 'area_radius_m', '402');
  r := pg_temp.row_of('10', req);
  perform pg_temp.expect('Bea state', r ->> 'state', 'waiting_for_me');
  perform pg_temp.expect('Bea role', r ->> 'my_role', 'driver');
  perform pg_temp.expect('Bea other', r ->> 'other_id', pg_temp.uid('01')::text);

  -- The area is a copy: Ada moving her pin out of her area doesn't move the request.
  update public.commutes set origin = pg_temp.pt('park') where id = ada.id;
  if extensions.st_astext(pg_temp.inv(req).pickup_area) <> extensions.st_astext(ada.origin_area)
     or extensions.st_astext((pg_temp.commute_of('01', 'passenger')).origin_area) = extensions.st_astext(ada.origin_area) then
    raise exception 'The request''s area should stay put when the commute area changes';
  end if;
  update public.commutes set origin = pg_temp.pt('webster') where id = ada.id;

  inv := pg_temp.send('10', '02', 'passenger', pg_temp.d());
  i := pg_temp.inv(inv);
  perform pg_temp.expect('invite direction', i.direction, 'invite');
  perform pg_temp.expect('invite commute', i.commute_id::text, bea.id::text);
  perform pg_temp.expect('invite area', extensions.st_astext(i.pickup_area), extensions.st_astext(abe.origin_area));
  perform pg_temp.expect('Bea invite state', pg_temp.state('10', inv), 'waiting_for_them');
  perform pg_temp.expect('Abe invite state', pg_temp.state('02', inv), 'waiting_for_me');
  perform pg_temp.expect('Abe role', pg_temp.row_of('02', inv) ->> 'my_role', 'passenger');
end
$$;
select pg_temp.reset();

-- 4. Refusals about the caller's own situation -----------------------------------------

do $$
declare
  d date := pg_temp.d();
  ada uuid := pg_temp.uid('01');
  bea uuid := pg_temp.uid('10');
  abe uuid := pg_temp.uid('02');
begin
  perform pg_temp.expect('anon', split_part(pg_temp.send_err('anon', bea, 'driver', d), '|', 1), '42501');
  perform pg_temp.expect('no uid', pg_temp.code(pg_temp.send_err('admin', bea, 'driver', d)), '42501|not_signed_in');
  perform pg_temp.expect('self', pg_temp.code(pg_temp.send_err('01', ada, 'driver', d)), '22023|invalid_input');
  perform pg_temp.expect('null recipient', pg_temp.code(pg_temp.send_err('01', null, 'driver', d)), '22023|invalid_input');
  perform pg_temp.expect('bad role', pg_temp.code(pg_temp.send_err('01', bea, 'both', d)), '22023|invalid_input');
  perform pg_temp.expect('null date', pg_temp.code(pg_temp.send_err('01', bea, 'driver', null)), '22023|invalid_input');
  perform pg_temp.expect('seconds', pg_temp.code(pg_temp.send_err('01', bea, 'driver', d, '07:45:30')), '22023|invalid_input');
  perform pg_temp.expect('suspended caller', pg_temp.code(pg_temp.send_err('21', abe, 'passenger', d)), '42501|unavailable');
  perform pg_temp.expect('today', pg_temp.code(pg_temp.send_err('01', bea, 'driver', pg_temp.la_today())), 'P0001|past_cutoff');
  perform pg_temp.expect('yesterday', pg_temp.code(pg_temp.send_err('01', bea, 'driver', pg_temp.la_today() - 1)), 'P0001|past_cutoff');
  perform pg_temp.expect('15 days', pg_temp.code(pg_temp.send_err('01', bea, 'driver', pg_temp.la_today() + 15)), 'P0001|too_far_ahead');
  perform pg_temp.expect('Saturday', pg_temp.code(pg_temp.send_err('01', bea, 'driver', pg_temp.next_dow(6))), 'P0001|no_commute_that_day');
  perform pg_temp.expect('Ada as driver', pg_temp.code(pg_temp.send_err('01', abe, 'passenger', d)), 'P0001|no_commute_that_day');
  perform pg_temp.expect('unvetted driver', pg_temp.code(pg_temp.send_err('04', abe, 'passenger', d)), 'P0001|not_vetted');
  perform pg_temp.expect('no vehicle', pg_temp.code(pg_temp.send_err('05', abe, 'passenger', d)), 'P0001|no_vehicle');
  perform pg_temp.expect('already booked', pg_temp.code(pg_temp.send_err('03', bea, 'driver', d)), 'P0001|already_booked');
  perform pg_temp.expect('car full', pg_temp.code(pg_temp.send_err('26', abe, 'passenger', d)), 'P0001|car_full');
  perform pg_temp.expect('late time', pg_temp.code(pg_temp.send_err('01', bea, 'driver', d, '07:56')), 'P0001|time_outside_window');
  perform pg_temp.expect('early time', pg_temp.code(pg_temp.send_err('01', bea, 'driver', d, '07:29')), 'P0001|time_outside_window');
  perform pg_temp.expect('scooter', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('16'), 'driver', d, null, true)), 'P0001|scooter_doesnt_fit');

  if exists (select 1 from public.invitations where status <> 'booked') then
    raise exception 'A refused send created an invitation';
  end if;

  -- The window edges are inside: Ada 7:30-8:00 and Bea 7:25-7:55 share 7:30-7:55.
  perform pg_temp.expect('7:55', pg_temp.send_err('01', bea, 'driver', d, '07:55'), 'ok');
  perform pg_temp.reset();
  perform pg_temp.expect('7:30', pg_temp.send_err('01', bea, 'driver', d, '07:30'), 'ok');
  perform pg_temp.reset();
  perform pg_temp.expect('Box without a scooter', pg_temp.send_err('01', pg_temp.uid('16'), 'driver', d), 'ok');
  perform pg_temp.reset();
end
$$;

-- 5. Refusals about the other person are identical -------------------------------------

do $$
declare
  d date := pg_temp.d();
  want text := '42501|unavailable|This ride isn''t available anymore';
  n text;
  got text;
  cards integer;
begin
  foreach n in array array['20', '21', '22', '23', '04', '25', '26', '31'] loop
    got := pg_temp.send_err('01', pg_temp.uid(n), 'driver', d);
    if got is distinct from want then
      raise exception 'Ada -> % gave %, want %', n, got, want;
    end if;
  end loop;
  got := pg_temp.send_err('01', '00000000-0000-0000-0000-00000000ffff', 'driver', d);
  perform pg_temp.expect('unknown id', got, want);
  perform pg_temp.expect('Bea -> Rid (booked)', pg_temp.send_err('10', pg_temp.uid('03'), 'passenger', d), want);
  perform pg_temp.expect('Liv -> Ada (Q5)', pg_temp.send_err('31', pg_temp.uid('01'), 'passenger', d), want);

  if exists (select 1 from public.invitations where status <> 'booked') then
    raise exception 'A refused send created an invitation';
  end if;

  perform tests.as_user(pg_temp.uid('01'));
  select count(*) into cards
  from public.profile_cards(array[pg_temp.uid('20'), pg_temp.uid('21'), pg_temp.uid('22'), pg_temp.uid('23'),
                                  pg_temp.uid('04'), pg_temp.uid('25'), pg_temp.uid('26')]);
  perform tests.as_admin();
  if cards <> 0 then
    raise exception 'A refused send unlocked % profile cards', cards;
  end if;
end
$$;

-- 6. Rate limits and their order ----------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  id uuid;
  k integer;
  dee uuid;
  cy uuid;
begin
  -- 10 sends a day, withdrawn ones included.
  for k in 1..10 loop
    id := pg_temp.send('01', '10', 'driver', d);
    perform pg_temp.expect('withdraw ' || k, pg_temp.act('01', 'withdraw', id), 'ok');
  end loop;
  perform pg_temp.expect('11th send', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('10'), 'driver', d)), 'P0001|daily_limit');
  -- The limit comes before anything about the recipient: a blocked or opted-out person
  -- gives the same answer as anyone else.
  perform pg_temp.expect('limit vs blocked', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('22'), 'driver', d)), 'P0001|daily_limit');
  perform pg_temp.expect('limit vs blocker', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('23'), 'driver', d)), 'P0001|daily_limit');
  perform pg_temp.expect('limit vs opted out', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('20'), 'driver', d)), 'P0001|daily_limit');
  perform pg_temp.reset();

  -- 5 open at once. A secretly declined request counts; withdrawn and expired ones don't.
  id := pg_temp.send('01', '10', 'driver', d);
  perform pg_temp.expect('Bea declines', pg_temp.act('10', 'decline', id), 'ok');
  cy := pg_temp.send('01', '11', 'driver', d);
  dee := pg_temp.send('01', '12', 'driver', d);
  perform pg_temp.send('01', '13', 'driver', d);
  perform pg_temp.send('01', '14', 'driver', d);
  perform pg_temp.expect('6th open', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('15'), 'driver', d)), 'P0001|pending_limit');
  perform pg_temp.expect('withdraw Cy', pg_temp.act('01', 'withdraw', cy), 'ok');
  perform pg_temp.expect('after a withdrawal', pg_temp.send_err('01', pg_temp.uid('15'), 'driver', d), 'ok');
  update public.invitations set expires_at = now() - interval '1 minute' where id = dee;
  perform pg_temp.expect('after an expiry', pg_temp.send_err('01', pg_temp.uid('11'), 'driver', d), 'ok');
  perform pg_temp.expect('5 open again', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('16'), 'driver', d)), 'P0001|pending_limit');
  perform pg_temp.reset();

  -- One open first_ride invitation per recipient, any date.
  perform pg_temp.send('01', '10', 'driver', d);
  perform pg_temp.expect('same recipient, other date', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('10'), 'driver', pg_temp.dt())), 'P0001|already_requested');
  -- One open invitation per pair and date, either direction.
  perform pg_temp.expect('crossed invite', pg_temp.code(pg_temp.send_err('10', pg_temp.uid('01'), 'passenger', d)), 'P0001|already_requested');
  perform pg_temp.expect('crossed invite, other date', pg_temp.send_err('10', pg_temp.uid('01'), 'passenger', pg_temp.dt()), 'ok');
  perform pg_temp.reset();

  -- A driver's held withdrawal still occupies the pair's date for both.
  id := pg_temp.send('10', '02', 'passenger', d);
  perform pg_temp.expect('Abe accepts', pg_temp.act('02', 'accept', id), 'ok');
  perform pg_temp.expect('Bea withdraws', pg_temp.act('10', 'withdraw', id), 'ok');
  perform pg_temp.expect('Bea re-invites', pg_temp.code(pg_temp.send_err('10', pg_temp.uid('02'), 'passenger', d)), 'P0001|already_requested');
  perform pg_temp.expect('Abe requests', pg_temp.code(pg_temp.send_err('02', pg_temp.uid('10'), 'driver', d)), 'P0001|already_requested');
  perform pg_temp.reset();

  -- Ride Again: one per recipient per date (Q4).
  perform pg_temp.expect('Ken D', pg_temp.send_err('01', pg_temp.uid('30'), 'driver', d), 'ok');
  perform pg_temp.expect('Ken DT', pg_temp.send_err('01', pg_temp.uid('30'), 'driver', pg_temp.dt()), 'ok');
  perform pg_temp.expect('Ken D again', pg_temp.code(pg_temp.send_err('01', pg_temp.uid('30'), 'driver', d)), 'P0001|already_requested');
  perform pg_temp.reset();
end
$$;

-- 7. Accept --------------------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  inv uuid;
  req uuid;
  late uuid;
  gus uuid;
  rid uuid;
begin
  inv := pg_temp.send('10', '02', 'passenger', d);
  perform pg_temp.expect('accept', pg_temp.act('02', 'accept', inv), 'ok');
  perform pg_temp.expect('driver after accept', pg_temp.state('10', inv), 'accepted_confirm_seat');
  perform pg_temp.expect('passenger after accept', pg_temp.state('02', inv), 'accepted_waiting_for_driver');
  if pg_temp.inv(inv).accepted_at is null then
    raise exception 'accepted_at not set';
  end if;
  perform pg_temp.expect('repeat accept', pg_temp.code(pg_temp.act('02', 'accept', inv)), '42501|unavailable');
  perform pg_temp.expect('third party', pg_temp.code(pg_temp.act('11', 'accept', inv)), '42501|unavailable');
  perform pg_temp.expect('sender accepts', pg_temp.code(pg_temp.act('10', 'accept', inv)), '42501|unavailable');
  perform pg_temp.expect('anon accepts', split_part(pg_temp.act('anon', 'accept', inv), '|', 1), '42501');
  perform pg_temp.expect('unknown id', pg_temp.code(pg_temp.act('02', 'accept', gen_random_uuid())), '42501|unavailable');

  req := pg_temp.send('01', '11', 'driver', d);
  perform pg_temp.expect('driver accepts a request', pg_temp.code(pg_temp.act('11', 'accept', req)), 'P0001|driver_confirms');
  perform pg_temp.expect('requester accepts', pg_temp.code(pg_temp.act('01', 'accept', req)), '42501|unavailable');

  late := pg_temp.send('12', '01', 'passenger', pg_temp.dt());
  update public.invitations set expires_at = now() - interval '1 minute' where id = late;
  perform pg_temp.expect('after the cutoff', pg_temp.code(pg_temp.act('01', 'accept', late)), '42501|unavailable');

  inv := pg_temp.send('13', '01', 'passenger', d);
  update public.profiles set vetted_at = null where id = pg_temp.uid('13');
  perform pg_temp.expect('driver lost vetting', pg_temp.code(pg_temp.act('01', 'accept', inv)), '42501|unavailable');
  update public.profiles set vetted_at = now() where id = pg_temp.uid('13');

  -- Booked elsewhere that date: the passenger's own situation.
  inv := pg_temp.send('14', '02', 'passenger', pg_temp.dt());
  rid := pg_temp.ride('15', '02', pg_temp.dt());
  perform pg_temp.expect('already booked', pg_temp.code(pg_temp.act('02', 'accept', inv)), 'P0001|already_booked');
  select invitation_id into gus from public.rides where id = rid;
  delete from public.rides where id = rid;
  delete from public.invitations where id = gus;
  perform pg_temp.reset();
end
$$;

-- 8. Decline and withdraw ---------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  r uuid;
  i uuid;
begin
  r := pg_temp.send('01', '10', 'driver', d);
  perform pg_temp.expect('decline', pg_temp.act('10', 'decline', r), 'ok');
  perform pg_temp.expect('decliner sees', pg_temp.state('10', r), 'closed_by_me');
  perform pg_temp.expect('requester sees', pg_temp.state('01', r), 'waiting_for_them');
  perform pg_temp.expect('decline twice', pg_temp.code(pg_temp.act('10', 'decline', r)), '42501|unavailable');
  perform pg_temp.expect('recipient withdraws', pg_temp.code(pg_temp.act('10', 'withdraw', r)), '42501|unavailable');
  perform pg_temp.expect('sender declines', pg_temp.code(pg_temp.act('01', 'decline', r)), '42501|unavailable');
  if pg_temp.inv(r).held_until is distinct from pg_temp.inv(r).expires_at then
    raise exception 'A decline should be held until the reply cutoff';
  end if;

  r := pg_temp.send('01', '11', 'driver', d);
  perform pg_temp.expect('withdraw', pg_temp.act('01', 'withdraw', r), 'ok');
  perform pg_temp.expect('withdrawer sees', pg_temp.state('01', r), 'closed_by_me');
  perform pg_temp.expect('recipient sees', pg_temp.state('11', r), 'unavailable');
  perform pg_temp.expect('withdraw twice', pg_temp.code(pg_temp.act('01', 'withdraw', r)), '42501|unavailable');
  perform pg_temp.expect('decline after withdraw', pg_temp.code(pg_temp.act('11', 'decline', r)), '42501|unavailable');

  i := pg_temp.send('12', '02', 'passenger', d);
  perform pg_temp.expect('accept', pg_temp.act('02', 'accept', i), 'ok');
  perform pg_temp.expect('un-accept', pg_temp.act('02', 'decline', i), 'ok');
  perform pg_temp.expect('passenger after un-accept', pg_temp.state('02', i), 'closed_by_me');
  perform pg_temp.expect('driver after un-accept', pg_temp.state('12', i), 'unavailable');

  i := pg_temp.send('13', '02', 'passenger', d);
  perform pg_temp.expect('passenger declines', pg_temp.act('02', 'decline', i), 'ok');
  perform pg_temp.expect('passenger sees', pg_temp.state('02', i), 'closed_by_me');
  perform pg_temp.expect('inviting driver sees', pg_temp.state('13', i), 'waiting_for_them');
  perform pg_temp.reset();
end
$$;

-- 9. D-22: a declined request reads exactly like an unanswered one, and changes with it -----

do $$
declare
  d date := pg_temp.d();
  a uuid;
  b uuid;
  ra jsonb;
  rb jsonb;
  x timestamptz;
begin
  a := pg_temp.send('01', '10', 'driver', d);
  b := pg_temp.send('01', '11', 'driver', d);
  perform pg_temp.expect('Bea declines', pg_temp.act('10', 'decline', a), 'ok');
  x := pg_temp.inv(a).expires_at;

  perform pg_temp.expect('declined, before', public.invitation_state(pg_temp.inv(a), pg_temp.uid('01'), x - interval '1 second'), 'waiting_for_them');
  perform pg_temp.expect('unanswered, before', public.invitation_state(pg_temp.inv(b), pg_temp.uid('01'), x - interval '1 second'), 'waiting_for_them');
  perform pg_temp.expect('declined, at', public.invitation_state(pg_temp.inv(a), pg_temp.uid('01'), x), 'unavailable');
  perform pg_temp.expect('unanswered, at', public.invitation_state(pg_temp.inv(b), pg_temp.uid('01'), x), 'unavailable');
  perform pg_temp.expect('declined, later', public.invitation_state(pg_temp.inv(a), pg_temp.uid('01'), x + interval '1 day'), 'unavailable');
  perform pg_temp.expect('unanswered, later', public.invitation_state(pg_temp.inv(b), pg_temp.uid('01'), x + interval '1 day'), 'unavailable');

  ra := pg_temp.row_of('01', a) - 'id' - 'other_id' - 'created_at';
  rb := pg_temp.row_of('01', b) - 'id' - 'other_id' - 'created_at';
  if ra is distinct from rb then
    raise exception 'Before the cutoff, declined % differs from unanswered %', ra, rb;
  end if;

  -- Move the cutoff into the past for both rows.
  update public.invitations set expires_at = now() - interval '1 minute', held_until = now() - interval '1 minute' where id = a;
  update public.invitations set expires_at = now() - interval '1 minute' where id = b;
  ra := pg_temp.row_of('01', a) - 'id' - 'other_id' - 'created_at';
  rb := pg_temp.row_of('01', b) - 'id' - 'other_id' - 'created_at';
  perform pg_temp.expect('declined after the cutoff', ra ->> 'state', 'unavailable');
  if ra is distinct from rb then
    raise exception 'After the cutoff, declined % differs from expired %', ra, rb;
  end if;

  -- A later expiry sweep (M-37) writing 'expired' changes nothing.
  update public.invitations set status = 'expired' where id = b;
  if (pg_temp.row_of('01', b) - 'id' - 'other_id' - 'created_at') is distinct from rb then
    raise exception 'A stored expired status changed the requester''s view';
  end if;
  perform pg_temp.reset();
end
$$;

-- 10-11. Held "no" from the driver after an acceptance, and the waiting party closing a held row

do $$
declare
  d date := pg_temp.d();
  x uuid;
  z uuid;
  a uuid;
  b uuid;
  t timestamptz;
begin
  -- Bea withdraws an invite Abe accepted; Cy ignores one Ada accepted. Same dates, same view.
  x := pg_temp.send('10', '02', 'passenger', d);
  z := pg_temp.send('11', '01', 'passenger', d);
  perform pg_temp.expect('Abe accepts', pg_temp.act('02', 'accept', x), 'ok');
  perform pg_temp.expect('Ada accepts', pg_temp.act('01', 'accept', z), 'ok');
  perform pg_temp.expect('Bea withdraws', pg_temp.act('10', 'withdraw', x), 'ok');
  perform pg_temp.expect('Bea sees', pg_temp.state('10', x), 'closed_by_me');
  perform pg_temp.expect('Abe sees', pg_temp.state('02', x), 'accepted_waiting_for_driver');
  if pg_temp.inv(x).held_until is distinct from pg_temp.inv(x).expires_at then
    raise exception 'A driver''s withdrawal after acceptance should be held';
  end if;
  t := pg_temp.inv(x).expires_at;
  perform pg_temp.expect('withdrawn, before', public.invitation_state(pg_temp.inv(x), pg_temp.uid('02'), t - interval '1 second'),
    public.invitation_state(pg_temp.inv(z), pg_temp.uid('01'), t - interval '1 second'));
  perform pg_temp.expect('withdrawn, at', public.invitation_state(pg_temp.inv(x), pg_temp.uid('02'), t),
    public.invitation_state(pg_temp.inv(z), pg_temp.uid('01'), t));
  perform pg_temp.expect('ignored, at', public.invitation_state(pg_temp.inv(z), pg_temp.uid('01'), t), 'unavailable');

  -- Abe un-accepts the held row: it works as on a live one, and Bea's view doesn't move.
  perform pg_temp.expect('Abe declines held', pg_temp.act('02', 'decline', x), 'ok');
  perform pg_temp.expect('Abe after', pg_temp.state('02', x), 'closed_by_me');
  perform pg_temp.expect('Bea after', pg_temp.state('10', x), 'closed_by_me');
  perform pg_temp.expect('Ada un-accepts live', pg_temp.act('01', 'decline', z), 'ok');
  perform pg_temp.expect('Ada after', pg_temp.state('01', z), 'closed_by_me');
  perform pg_temp.reset();

  -- Ada withdraws a secretly declined request and an unanswered one: both just work.
  a := pg_temp.send('01', '10', 'driver', d);
  b := pg_temp.send('01', '11', 'driver', d);
  perform pg_temp.expect('Bea declines', pg_temp.act('10', 'decline', a), 'ok');
  perform pg_temp.expect('withdraw declined', pg_temp.act('01', 'withdraw', a), 'ok');
  perform pg_temp.expect('withdraw unanswered', pg_temp.act('01', 'withdraw', b), 'ok');
  perform pg_temp.expect('Ada a', pg_temp.state('01', a), 'closed_by_me');
  perform pg_temp.expect('Ada b', pg_temp.state('01', b), 'closed_by_me');
  perform pg_temp.expect('Bea a', pg_temp.state('10', a), 'closed_by_me');
  perform pg_temp.expect('Cy b', pg_temp.state('11', b), 'unavailable');
  perform pg_temp.expect('stored a', pg_temp.inv(a).status, 'declined');
  perform pg_temp.expect('withdraw again', pg_temp.code(pg_temp.act('01', 'withdraw', a)), '42501|unavailable');
  perform pg_temp.reset();
end
$$;

-- 12. Ride Again, Crew, and no second First Ride (Q5, Q6) --------------------------------------

do $$
declare
  d date := pg_temp.d();
  crew uuid := '40000000-0000-0000-0000-000000002701';
  want text := '42501|unavailable|This ride isn''t available anymore';
  id uuid;
  res jsonb;
begin
  id := pg_temp.send('01', '30', 'driver', d);
  perform pg_temp.expect('Ride Again to an opted-out connection', pg_temp.inv(id).kind, 'ride_again');
  perform pg_temp.expect('Ken sees it', pg_temp.state('30', id), 'waiting_for_me');

  id := pg_temp.send('01', '32', 'driver', d, null, null, crew);
  perform pg_temp.expect('Crew kind', pg_temp.inv(id).kind, 'crew');
  perform pg_temp.expect('Crew id', pg_temp.inv(id).crew_id::text, crew::text);
  perform pg_temp.expect('Crew view', pg_temp.row_of('01', id) ->> 'crew_id', crew::text);
  perform pg_temp.expect('Crew off-day', pg_temp.send_err('01', pg_temp.uid('32'), 'driver', pg_temp.dt(), null, null, crew), want);
  perform pg_temp.expect('Crew unknown', pg_temp.send_err('01', pg_temp.uid('32'), 'driver', pg_temp.dt(), null, null, gen_random_uuid()), want);
  perform pg_temp.expect('Crew of another pair', pg_temp.send_err('01', pg_temp.uid('30'), 'driver', pg_temp.dt(), null, null, crew), want);
  perform pg_temp.expect('withdraw', pg_temp.act('01', 'withdraw', id), 'ok');
  update public.commute_crews set status = 'paused' where id = crew;
  perform pg_temp.expect('Crew paused', pg_temp.send_err('01', pg_temp.uid('32'), 'driver', d, null, null, crew), want);
  update public.commute_crews set status = 'active' where id = crew;
  perform pg_temp.reset();

  -- Liv and Ada rode together and didn't reach Ride Again: neither can ask again, and
  -- matching hides them from each other. Bea, otherwise the same, is still there.
  res := pg_temp.match_ids('01', d, 'driver');
  if res @> to_jsonb(array[pg_temp.uid('31')]) or not res @> to_jsonb(array[pg_temp.uid('10')]) then
    raise exception 'Ada''s matches should include Bea and not Liv: %', res;
  end if;
  res := pg_temp.match_ids('31', d, 'passenger');
  if res @> to_jsonb(array[pg_temp.uid('01')]) or not res @> to_jsonb(array[pg_temp.uid('02')]) then
    raise exception 'Liv''s matches should include Abe and not Ada: %', res;
  end if;

  -- With Ride Again they're back.
  insert into public.connections (user_low, user_high) values (pg_temp.uid('01'), pg_temp.uid('31'));
  res := pg_temp.match_ids('01', d, 'driver');
  if not res @> to_jsonb(array[pg_temp.uid('31')]) then
    raise exception 'A connected pair with a completed ride should match: %', res;
  end if;
  id := pg_temp.send('01', '31', 'driver', d);
  perform pg_temp.expect('Liv Ride Again', pg_temp.inv(id).kind, 'ride_again');
  delete from public.connections where user_low = pg_temp.uid('01') and user_high = pg_temp.uid('31');
  perform pg_temp.reset();
end
$$;

-- 13. Blocks close everything between the pair, both ways -------------------------------------

do $$
declare
  d date := pg_temp.d();
  want text := '42501|unavailable|This ride isn''t available anymore';
  p uuid;
  q uuid;
  h uuid;
  k uuid;
begin
  p := pg_temp.send('01', '10', 'driver', d);                 -- pending
  q := pg_temp.send('11', '01', 'passenger', d);              -- accepted
  perform pg_temp.expect('accept q', pg_temp.act('01', 'accept', q), 'ok');
  h := pg_temp.send('01', '12', 'driver', d);                 -- held decline
  perform pg_temp.expect('decline h', pg_temp.act('12', 'decline', h), 'ok');

  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('10'), pg_temp.uid('01'));  -- Bea blocks Ada
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('01'), pg_temp.uid('11'));  -- Ada blocks Cy
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('12'), pg_temp.uid('01'));  -- Dee blocks Ada

  perform pg_temp.expect('p status', pg_temp.inv(p).status, 'cancelled');
  perform pg_temp.expect('p reason', pg_temp.inv(p).cancel_reason, 'block');
  perform pg_temp.expect('q status', pg_temp.inv(q).status, 'cancelled');
  perform pg_temp.expect('h status', pg_temp.inv(h).status, 'declined');
  perform pg_temp.expect('h reason', pg_temp.inv(h).cancel_reason, 'block');
  if pg_temp.inv(h).held_until > now() then
    raise exception 'A block should end a hold';
  end if;

  if pg_temp.row_of('01', p) is not null or pg_temp.row_of('10', p) is not null
     or pg_temp.row_of('01', q) is not null or pg_temp.row_of('11', q) is not null
     or pg_temp.row_of('01', h) is not null or pg_temp.row_of('12', h) is not null then
    raise exception 'A blocked pair still sees its invitations';
  end if;
  perform pg_temp.expect('Ada withdraws p', pg_temp.act('01', 'withdraw', p), want);
  perform pg_temp.expect('Bea declines p', pg_temp.act('10', 'decline', p), want);
  perform pg_temp.expect('Ada declines q', pg_temp.act('01', 'decline', q), want);
  perform pg_temp.expect('Cy withdraws q', pg_temp.act('11', 'withdraw', q), want);
  perform pg_temp.expect('Ada -> Bea', pg_temp.send_err('01', pg_temp.uid('10'), 'driver', pg_temp.dt()), want);
  perform pg_temp.expect('Bea -> Ada', pg_temp.send_err('10', pg_temp.uid('01'), 'passenger', pg_temp.dt()), want);
  perform pg_temp.expect('Ada -> Cy', pg_temp.send_err('01', pg_temp.uid('11'), 'driver', pg_temp.dt()), want);

  -- A block also ends a Ride Again invitation, and refuses the connected exception.
  k := pg_temp.send('01', '30', 'driver', d);
  insert into public.blocks (blocker_id, blocked_id) values (pg_temp.uid('30'), pg_temp.uid('01'));
  perform pg_temp.expect('Ken invitation', pg_temp.inv(k).status, 'cancelled');
  perform pg_temp.expect('Ada -> Ken', pg_temp.send_err('01', pg_temp.uid('30'), 'driver', pg_temp.dt()), want);

  -- Unblocking restores nothing.
  delete from public.blocks where blocker_id = pg_temp.uid('10') and blocked_id = pg_temp.uid('01');
  perform pg_temp.expect('p after unblock', pg_temp.inv(p).status, 'cancelled');
  perform pg_temp.expect('Ada sees p after unblock', pg_temp.state('01', p), 'unavailable');
  perform pg_temp.reset();
end
$$;

-- 14. Suspension ------------------------------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  s1 uuid;
  s2 uuid;
  s3 uuid;
  legacy uuid;
begin
  s1 := pg_temp.send('01', '13', 'driver', d);                 -- pending with Eve
  s2 := pg_temp.send('14', '02', 'passenger', d);              -- accepted invite from Fay
  perform pg_temp.expect('Abe accepts', pg_temp.act('02', 'accept', s2), 'ok');
  s3 := pg_temp.send('01', '15', 'driver', d);                 -- Gus declines (held)
  perform pg_temp.expect('Gus declines', pg_temp.act('15', 'decline', s3), 'ok');
  -- A legacy-shaped accepted request (no such state in the new model) with Eve.
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date)
  values (pg_temp.uid('02'), pg_temp.uid('13'), (pg_temp.commute_of('02', 'passenger')).id, 'accepted', pg_temp.dt())
  returning id into legacy;

  update public.profiles set suspended_at = now() where id in (pg_temp.uid('13'), pg_temp.uid('14'), pg_temp.uid('15'));

  perform pg_temp.expect('s1', pg_temp.inv(s1).status, 'cancelled');
  perform pg_temp.expect('s1 reason', pg_temp.inv(s1).cancel_reason, 'suspension');
  perform pg_temp.expect('s2', pg_temp.inv(s2).status, 'cancelled');
  perform pg_temp.expect('s2 reason', pg_temp.inv(s2).cancel_reason, 'suspension');
  perform pg_temp.expect('s3', pg_temp.inv(s3).status, 'declined');
  if pg_temp.inv(s3).held_until > now() then
    raise exception 'A suspension should end a hold';
  end if;
  perform pg_temp.expect('legacy', pg_temp.inv(legacy).status, 'accepted');

  if pg_temp.row_of('01', s1) is not null or pg_temp.row_of('02', s2) is not null
     or pg_temp.row_of('01', s3) is not null or pg_temp.row_of('02', legacy) is not null then
    raise exception 'A suspended member''s invitations are still visible';
  end if;
  perform pg_temp.expect('Eve sees nothing', pg_temp.view('13')::text, '[]');
  perform pg_temp.expect('Eve sends', pg_temp.code(pg_temp.send_err('13', pg_temp.uid('02'), 'passenger', d)), '42501|unavailable');
  perform pg_temp.expect('Abe acts on legacy', pg_temp.code(pg_temp.act('02', 'withdraw', legacy)), '42501|unavailable');
  -- Abe's open count doesn't include the hidden legacy row: he can still send 5.
  perform pg_temp.send('02', '10', 'driver', d);
  perform pg_temp.send('02', '11', 'driver', d);
  perform pg_temp.send('02', '12', 'driver', d);
  perform pg_temp.send('02', '16', 'driver', d);
  perform pg_temp.expect('Abe 5th', pg_temp.send_err('02', pg_temp.uid('31'), 'driver', d), 'ok');

  update public.profiles set suspended_at = null where id in (pg_temp.uid('13'), pg_temp.uid('14'), pg_temp.uid('15'));
  perform pg_temp.expect('s2 stays cancelled', pg_temp.inv(s2).status, 'cancelled');
  delete from public.invitations where id = legacy;
  perform pg_temp.reset();
end
$$;

-- 15. What the projection never shows ----------------------------------------------------------

do $$
declare
  d date := pg_temp.d();
  r uuid;
  past uuid;
  v jsonb;
  ada public.commutes := pg_temp.commute_of('01', 'passenger');
  w text;
begin
  r := pg_temp.send('01', '16', 'driver', d);
  perform pg_temp.expect('Box declines', pg_temp.act('16', 'decline', r), 'ok');
  insert into public.invitations (sender_id, recipient_id, commute_id, status, ride_date)
  values (pg_temp.uid('01'), pg_temp.uid('10'), ada.id, 'pending', pg_temp.la_today() - 1)
  returning id into past;

  v := pg_temp.view('01');
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'id' = past::text) then
    raise exception 'A past ride date is in the view';
  end if;
  foreach w in array array['declined', 'withdrawn', 'cancelled', 'expired', 'pending', 'Lovelace', 'Boxer', 'held', 'reason'] loop
    if position(w in v::text) > 0 then
      raise exception 'Ada''s view contains "%": %', w, v;
    end if;
  end loop;
  if position(extensions.st_x(ada.origin::extensions.geometry)::text in v::text) > 0
     or position(extensions.st_y(ada.origin::extensions.geometry)::text in v::text) > 0 then
    raise exception 'An exact coordinate is in the view';
  end if;
  if exists (select 1 from jsonb_array_elements(v) e where e ->> 'ride_id' is not null) then
    raise exception 'ride_id should be null for an invitation without a ride';
  end if;
  if (pg_temp.row_of('03', (select r2.invitation_id from public.rides r2 where r2.passenger_id = pg_temp.uid('03')))) ->> 'state'
     is distinct from 'booked'
     or (pg_temp.row_of('03', (select r2.invitation_id from public.rides r2 where r2.passenger_id = pg_temp.uid('03')))) ->> 'ride_id'
     is distinct from (select r2.id::text from public.rides r2 where r2.passenger_id = pg_temp.uid('03')) then
    raise exception 'A booked invitation should show its ride';
  end if;
  delete from public.invitations where id = past;
  perform pg_temp.reset();
end
$$;

rollback;

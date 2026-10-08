-- East Bay neighborhoods (0009): hand-drawn Alameda, Oakland and Berkeley
-- neighborhoods label commute areas, stay inside their city, never overlap,
-- and saved labels are refreshed when the boundaries change.
-- Spec: docs/superpowers/specs/2026-10-08-commute-privacy-design.md, "Boundary data".
begin;

select tests.as_admin();

-- 1. Known centers get their neighborhood label. Every point is at least 300 m
-- inside its hand-drawn polygon, so small redraws don't break this.
do $$
declare
  t record;
  got text;
begin
  for t in
    select * from (values
      ('Park St & Central Ave, Alameda', 'POINT(-122.2446 37.7638)', 'Park Street area, Alameda'),
      ('Webster St & Central Ave, Alameda', 'POINT(-122.2777 37.7665)', 'West End area, Alameda'),
      ('Bay Farm Island', 'POINT(-122.2450 37.7455)', 'Bay Farm Island area, Alameda'),
      ('Harbor Bay Isle', 'POINT(-122.2520 37.7320)', 'Harbor Bay area, Alameda'),
      ('Fruitvale BART', 'POINT(-122.2241 37.7748)', 'Fruitvale area, Oakland'),
      ('Rockridge BART', 'POINT(-122.2518 37.8445)', 'Rockridge area, Oakland'),
      ('12th St Oakland City Center BART', 'POINT(-122.2717 37.8033)', 'Downtown area, Oakland'),
      ('Lake Merritt', 'POINT(-122.2575 37.8030)', 'Lake Merritt area, Oakland'),
      ('West Oakland BART', 'POINT(-122.2950 37.8050)', 'West Oakland area, Oakland'),
      ('Shattuck Ave by Downtown Berkeley BART', 'POINT(-122.2700 37.8700)', 'Downtown area, Berkeley'),
      ('College Ave & Ashby Ave, Berkeley', 'POINT(-122.2527 37.8577)', 'Elmwood area, Berkeley')
    ) v(place, wkt, want)
  loop
    got := public.area_label(extensions.st_geogfromtext('SRID=4326;' || t.wkt));
    if got is distinct from t.want then
      raise exception '% labelled %, expected %', t.place, got, t.want;
    end if;
  end loop;
end
$$;

-- 2. East Bay cities without neighborhood polygons keep the city label.
do $$
declare
  got text;
begin
  got := public.area_label('SRID=4326;POINT(-122.2950 37.8390)');
  if got is distinct from 'Emeryville' then
    raise exception 'Emeryville center labelled %', got;
  end if;
  got := public.area_label('SRID=4326;POINT(-122.2320 37.8240)');
  if got is distinct from 'Piedmont' then
    raise exception 'Piedmont center labelled %', got;
  end if;
end
$$;

-- 3. The hand-drawn set covers Alameda, Oakland and Berkeley, and each row is a
-- valid, non-empty multipolygon with the Merge CC0 source and licence.
do $$
declare
  bad text;
begin
  if (select count(*) from public.place_boundaries where source = 'Merge (hand-drawn, approximate)' and city = 'Alameda') < 8
     or (select count(*) from public.place_boundaries where source = 'Merge (hand-drawn, approximate)' and city = 'Oakland') < 15
     or (select count(*) from public.place_boundaries where source = 'Merge (hand-drawn, approximate)' and city = 'Berkeley') < 8 then
    raise exception 'Expected at least 8 Alameda, 15 Oakland and 8 Berkeley hand-drawn neighborhoods';
  end if;
  select string_agg(id, ', ') into bad
  from public.place_boundaries
  where source = 'Merge (hand-drawn, approximate)'
    and (kind <> 'neighborhood' or license <> 'CC0-1.0'
         or city not in ('Alameda', 'Oakland', 'Berkeley')
         or extensions.st_isempty(geom) or not extensions.st_isvalid(geom)
         or extensions.geometrytype(geom) <> 'MULTIPOLYGON');
  if bad is not null then
    raise exception 'Bad hand-drawn rows: %', bad;
  end if;
end
$$;

-- 4. Every hand-drawn neighborhood lies inside its city's TIGER limits.
do $$
declare
  bad text;
begin
  select string_agg(n.id || ' (' || round(extensions.st_area(extensions.st_difference(n.geom, c.geom)::extensions.geography)) || ' m2 outside)', ', ')
  into bad
  from public.place_boundaries n
  join public.place_boundaries c on c.kind = 'city' and c.city = n.city
  where n.source = 'Merge (hand-drawn, approximate)'
    and extensions.st_area(extensions.st_difference(n.geom, c.geom)::extensions.geography) > 1;
  if bad is not null then
    raise exception 'Neighborhoods outside their city: %', bad;
  end if;
end
$$;

-- 5. No hand-drawn neighborhood overlaps another neighborhood.
do $$
declare
  bad text;
begin
  select string_agg(a.id || ' & ' || b.id, ', ')
  into bad
  from public.place_boundaries a
  join public.place_boundaries b
    on b.kind = 'neighborhood' and b.id <> a.id
   and (b.source <> a.source or b.id > a.id)
   and extensions.st_intersects(a.geom, b.geom)
  where a.kind = 'neighborhood'
    and a.source = 'Merge (hand-drawn, approximate)'
    and extensions.st_area(extensions.st_intersection(a.geom, b.geom)::extensions.geography) > 1;
  if bad is not null then
    raise exception 'Overlapping neighborhoods: %', bad;
  end if;
end
$$;

-- 6. relabel_commute_areas() refreshes stale saved labels from each area's
-- center, leaves areas alone, re-enables the area trigger, and is idempotent.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'eve@example.test');
insert into public.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000e1', 'Eve E.');

select tests.as_user('00000000-0000-0000-0000-0000000000e1');
insert into public.commutes (id, owner_id, role, origin, destination, departure_time, weekdays)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'passenger',
        'SRID=4326;POINT(-122.2446 37.7638)', 'SRID=4326;POINT(-122.2717 37.8033)', '07:30', '{1,2}');

select tests.as_admin();
do $$
declare
  before public.commutes;
  after public.commutes;
  n integer;
begin
  select * into before from public.commutes where id = '00000000-0000-0000-0000-0000000000e2';

  -- Simulate labels saved before the boundaries changed.
  alter table public.commutes disable trigger commutes_set_areas;
  update public.commutes set origin_area_label = 'Stale', destination_area_label = 'Stale'
  where id = '00000000-0000-0000-0000-0000000000e2';
  alter table public.commutes enable trigger commutes_set_areas;

  n := public.relabel_commute_areas();
  if n <> 1 then
    raise exception 'relabel_commute_areas should update the 1 stale commute, updated %', n;
  end if;

  select * into after from public.commutes where id = '00000000-0000-0000-0000-0000000000e2';
  if after.origin_area_label is distinct from public.area_label(after.origin_area)
     or after.destination_area_label is distinct from public.area_label(after.destination_area) then
    raise exception 'Labels should match their area centers, got %, %', after.origin_area_label, after.destination_area_label;
  end if;
  if after.origin_area::text is distinct from before.origin_area::text
     or after.destination_area::text is distinct from before.destination_area::text then
    raise exception 'Relabelling changed an area';
  end if;

  if public.relabel_commute_areas() <> 0 then
    raise exception 'A second relabel should change nothing';
  end if;
  if (select tgenabled from pg_trigger
      where tgrelid = 'public.commutes'::regclass and tgname = 'commutes_set_areas') <> 'O' then
    raise exception 'commutes_set_areas should be enabled again after relabelling';
  end if;
end
$$;

-- 7. Clients can't call relabel_commute_areas.
do $$
begin
  if has_function_privilege('authenticated', 'public.relabel_commute_areas()', 'execute')
     or has_function_privilege('anon', 'public.relabel_commute_areas()', 'execute') then
    raise exception 'relabel_commute_areas is executable by a client role';
  end if;
end
$$;

rollback;

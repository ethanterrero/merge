-- East Bay neighborhood labels (M-18 follow-up).
-- Spec: docs/superpowers/specs/2026-10-08-commute-privacy-design.md, section 3 (area labels).
--
-- 0008 labels East Bay areas only by city, because no open, cleanly licensed
-- neighborhood polygons exist there. These are Merge's own approximate outlines
-- for Alameda, Oakland and Berkeley (CC0), drawn from general knowledge of
-- streets, BART stations, freeways and shoreline. Each is clipped to its
-- city's TIGER limits and they never overlap, so area_label (0008) picks at
-- most one. Gaps between outlines fall back to the city label.
--
-- It also makes the area helpers owner-only (the commute trigger now runs as
-- its owner), so clients can't use area_label as a reverse-geocoder.
--
-- Safe to run again: the generated block replaces any earlier hand-drawn rows,
-- the functions are replaced and the revokes repeat, and the relabel only
-- touches labels that differ.

-- BEGIN GENERATED east_bay_neighborhoods (scripts/boundaries/build.py --east-bay; do not edit by hand)
-- Source: scripts/boundaries/east-bay-neighborhoods.geojson (sha256 792152899821056b335c85e8ccd7ede32897db62217a5a8001f1d3a5482c552d).
-- Replaces any earlier hand-drawn rows, so it can run again. Outlines are in
-- priority order: each is clipped to its city's TIGER limits, loses whatever an
-- earlier outline already covers, and drops slivers under 2000 m2.
delete from public.place_boundaries where source = 'Merge (hand-drawn, approximate)';

do $$
declare
  r record;
  g extensions.geometry;
  taken extensions.geometry := extensions.st_geomfromtext('MULTIPOLYGON EMPTY', 4326);
begin
  for r in
    select * from (values
      (1, 'merge-eastbay:alameda:park-street', 'Park Street', 'Alameda',
       'POLYGON((-122.25300 37.75850,-122.24350 37.77300,-122.24200 37.78000,-122.23100 37.78000,-122.23500 37.77300,-122.24400 37.75680,-122.25300 37.75850))'),
      (2, 'merge-eastbay:alameda:west-end', 'West End', 'Alameda',
       'POLYGON((-122.29450 37.75100,-122.29450 37.80000,-122.27150 37.80000,-122.27150 37.75100,-122.29450 37.75100))'),
      (3, 'merge-eastbay:alameda:alameda-point', 'Alameda Point', 'Alameda',
       'POLYGON((-122.34000 37.75000,-122.34000 37.80000,-122.29450 37.80000,-122.29450 37.75100,-122.34000 37.75000))'),
      (4, 'merge-eastbay:alameda:gold-coast', 'Gold Coast', 'Alameda',
       'POLYGON((-122.27150 37.76630,-122.26000 37.76530,-122.24900 37.76450,-122.25300 37.75850,-122.26370 37.76050,-122.26370 37.75100,-122.27150 37.75100,-122.27150 37.76630))'),
      (5, 'merge-eastbay:alameda:central-alameda', 'Central Alameda', 'Alameda',
       'POLYGON((-122.27150 37.76630,-122.27150 37.80000,-122.24200 37.80000,-122.24200 37.78000,-122.24350 37.77300,-122.24900 37.76450,-122.26000 37.76530,-122.27150 37.76630))'),
      (6, 'merge-eastbay:alameda:south-shore', 'South Shore', 'Alameda',
       'POLYGON((-122.26370 37.76050,-122.25300 37.75850,-122.24400 37.75680,-122.24200 37.75100,-122.26370 37.75100,-122.26370 37.76050))'),
      (7, 'merge-eastbay:alameda:east-end', 'East End', 'Alameda',
       'POLYGON((-122.23100 37.78000,-122.23500 37.77300,-122.24400 37.75680,-122.24200 37.75100,-122.21500 37.75100,-122.21500 37.78000,-122.23100 37.78000))'),
      (8, 'merge-eastbay:alameda:bay-farm-island', 'Bay Farm Island', 'Alameda',
       'POLYGON((-122.27000 37.75000,-122.21500 37.75000,-122.21500 37.74250,-122.24500 37.74050,-122.27000 37.73850,-122.27000 37.75000))'),
      (9, 'merge-eastbay:alameda:harbor-bay', 'Harbor Bay', 'Alameda',
       'POLYGON((-122.27000 37.73850,-122.24500 37.74050,-122.21500 37.74250,-122.21500 37.71500,-122.27000 37.71500,-122.27000 37.73850))'),
      (10, 'merge-eastbay:oakland:jack-london-square', 'Jack London Square', 'Oakland',
       'POLYGON((-122.28700 37.79000,-122.28700 37.79950,-122.28300 37.80100,-122.27480 37.79800,-122.26500 37.79450,-122.26200 37.79350,-122.26200 37.78800,-122.28700 37.79000))'),
      (11, 'merge-eastbay:oakland:old-oakland', 'Old Oakland', 'Oakland',
       'POLYGON((-122.28300 37.80100,-122.27480 37.79800,-122.27350 37.80030,-122.28100 37.80260,-122.28300 37.80100))'),
      (12, 'merge-eastbay:oakland:chinatown', 'Chinatown', 'Oakland',
       'POLYGON((-122.27480 37.79800,-122.26500 37.79450,-122.26200 37.79350,-122.26250 37.79880,-122.27350 37.80030,-122.27480 37.79800))'),
      (13, 'merge-eastbay:oakland:lake-merritt', 'Lake Merritt', 'Oakland',
       'POLYGON((-122.26250 37.79880,-122.26350 37.80550,-122.26120 37.81000,-122.25600 37.81080,-122.25020 37.80950,-122.24900 37.80550,-122.25200 37.79900,-122.25800 37.79580,-122.26250 37.79880))'),
      (14, 'merge-eastbay:oakland:downtown', 'Downtown', 'Oakland',
       'POLYGON((-122.28100 37.80260,-122.27350 37.80030,-122.26250 37.79880,-122.26350 37.80550,-122.26980 37.80650,-122.27950 37.81000,-122.28100 37.80260))'),
      (15, 'merge-eastbay:oakland:uptown', 'Uptown', 'Oakland',
       'POLYGON((-122.27950 37.81000,-122.26980 37.80650,-122.26350 37.80550,-122.26120 37.81000,-122.26050 37.81600,-122.26500 37.81650,-122.27700 37.81650,-122.27950 37.81000))'),
      (16, 'merge-eastbay:oakland:koreatown-northgate', 'Koreatown/Northgate', 'Oakland',
       'POLYGON((-122.27700 37.81650,-122.26500 37.81650,-122.26050 37.81600,-122.25950 37.82050,-122.25800 37.82700,-122.27150 37.82900,-122.27250 37.82550,-122.27700 37.81650))'),
      (17, 'merge-eastbay:oakland:west-oakland', 'West Oakland', 'Oakland',
       'POLYGON((-122.28700 37.79950,-122.28300 37.80100,-122.28100 37.80260,-122.27950 37.81000,-122.27700 37.81650,-122.27250 37.82550,-122.28500 37.82850,-122.29600 37.83000,-122.31000 37.82000,-122.31000 37.80000,-122.29500 37.79600,-122.28700 37.79950))'),
      (18, 'merge-eastbay:oakland:adams-point', 'Adams Point', 'Oakland',
       'POLYGON((-122.26120 37.81000,-122.26050 37.81600,-122.25950 37.82050,-122.25850 37.81950,-122.24900 37.81350,-122.25020 37.80950,-122.25600 37.81080,-122.26120 37.81000))'),
      (19, 'merge-eastbay:oakland:piedmont-avenue', 'Piedmont Avenue', 'Oakland',
       'POLYGON((-122.25950 37.82050,-122.25800 37.82700,-122.25600 37.83600,-122.24800 37.83550,-122.24000 37.83000,-122.24400 37.81800,-122.24900 37.81350,-122.25850 37.81950,-122.25950 37.82050))'),
      (20, 'merge-eastbay:oakland:grand-lake', 'Grand Lake', 'Oakland',
       'POLYGON((-122.25020 37.80950,-122.24900 37.81350,-122.24400 37.81800,-122.23400 37.82000,-122.23400 37.81100,-122.23850 37.80650,-122.24400 37.80450,-122.24900 37.80550,-122.25020 37.80950))'),
      (21, 'merge-eastbay:oakland:temescal', 'Temescal', 'Oakland',
       'POLYGON((-122.27150 37.82900,-122.25800 37.82700,-122.25600 37.83600,-122.25850 37.83800,-122.25950 37.84400,-122.27200 37.84400,-122.27150 37.82900))'),
      (22, 'merge-eastbay:oakland:rockridge', 'Rockridge', 'Oakland',
       'POLYGON((-122.25950 37.84400,-122.25850 37.83800,-122.25600 37.83600,-122.24800 37.83550,-122.24000 37.83000,-122.23350 37.83000,-122.23200 37.84600,-122.23300 37.85800,-122.24800 37.85800,-122.26000 37.85300,-122.25950 37.84400))'),
      (23, 'merge-eastbay:oakland:north-oakland', 'North Oakland', 'Oakland',
       'POLYGON((-122.29600 37.83000,-122.28500 37.82850,-122.27250 37.82550,-122.27150 37.82900,-122.27200 37.84400,-122.25950 37.84400,-122.26000 37.85300,-122.27000 37.85600,-122.29600 37.85600,-122.29600 37.83000))'),
      (24, 'merge-eastbay:oakland:eastlake', 'Eastlake', 'Oakland',
       'POLYGON((-122.25800 37.79580,-122.25200 37.79900,-122.24900 37.80550,-122.24400 37.80450,-122.23850 37.80650,-122.23400 37.80460,-122.24500 37.78800,-122.25800 37.78800,-122.26200 37.79350,-122.26250 37.79880,-122.25800 37.79580))'),
      (25, 'merge-eastbay:oakland:san-antonio', 'San Antonio', 'Oakland',
       'POLYGON((-122.23400 37.80460,-122.23000 37.80300,-122.22500 37.80100,-122.24100 37.77100,-122.25000 37.78000,-122.24500 37.78800,-122.23400 37.80460))'),
      (26, 'merge-eastbay:oakland:fruitvale', 'Fruitvale', 'Oakland',
       'POLYGON((-122.22500 37.80100,-122.21700 37.79800,-122.20100 37.79050,-122.22750 37.76500,-122.23300 37.76400,-122.24100 37.77100,-122.22500 37.80100))'),
      (27, 'merge-eastbay:oakland:glenview', 'Glenview', 'Oakland',
       'POLYGON((-122.23850 37.80650,-122.23400 37.81100,-122.23400 37.81600,-122.22300 37.81300,-122.22400 37.80070,-122.23000 37.80300,-122.23850 37.80650))'),
      (28, 'merge-eastbay:oakland:dimond', 'Dimond', 'Oakland',
       'POLYGON((-122.22400 37.80070,-122.22300 37.81300,-122.21000 37.81150,-122.20850 37.79400,-122.21700 37.79800,-122.22400 37.80070))'),
      (29, 'merge-eastbay:oakland:laurel', 'Laurel', 'Oakland',
       'POLYGON((-122.20850 37.79400,-122.21000 37.81150,-122.19800 37.81500,-122.19600 37.80100,-122.19600 37.78820,-122.20100 37.79050,-122.20850 37.79400))'),
      (30, 'merge-eastbay:oakland:montclair', 'Montclair', 'Oakland',
       'POLYGON((-122.23400 37.82000,-122.23200 37.84600,-122.21500 37.84600,-122.20000 37.83500,-122.19800 37.81500,-122.21000 37.81150,-122.22300 37.81300,-122.23400 37.81600,-122.23400 37.82000))'),
      (31, 'merge-eastbay:oakland:coliseum', 'Coliseum', 'Oakland',
       'POLYGON((-122.21800 37.76500,-122.21400 37.76900,-122.19600 37.75600,-122.17000 37.73400,-122.15000 37.72400,-122.15000 37.71500,-122.18500 37.73000,-122.20500 37.74000,-122.22000 37.75600,-122.21800 37.76500))'),
      (32, 'merge-eastbay:oakland:east-oakland', 'East Oakland', 'Oakland',
       'POLYGON((-122.22750 37.76500,-122.20100 37.79050,-122.18600 37.78350,-122.17000 37.77200,-122.15000 37.75700,-122.13500 37.74500,-122.12000 37.73500,-122.12000 37.72000,-122.15000 37.72400,-122.17000 37.73400,-122.19600 37.75600,-122.21400 37.76900,-122.21800 37.76500,-122.22750 37.76500))'),
      (33, 'merge-eastbay:oakland:oakland-hills', 'Oakland Hills', 'Oakland',
       'POLYGON((-122.24800 37.85800,-122.23300 37.85800,-122.23200 37.84600,-122.21500 37.84600,-122.20000 37.83500,-122.19800 37.81500,-122.19600 37.80100,-122.19600 37.78820,-122.18600 37.78350,-122.17000 37.77200,-122.15000 37.75700,-122.13500 37.74500,-122.12000 37.73500,-122.10000 37.75000,-122.15000 37.81000,-122.20000 37.86500,-122.24000 37.89000,-122.24800 37.85800))'),
      (34, 'merge-eastbay:berkeley:uc-berkeley', 'UC Berkeley', 'Berkeley',
       'POLYGON((-122.26650 37.86900,-122.26650 37.87480,-122.25600 37.87550,-122.24700 37.87700,-122.24400 37.87300,-122.24700 37.86900,-122.26650 37.86900))'),
      (35, 'merge-eastbay:berkeley:downtown', 'Downtown', 'Berkeley',
       'POLYGON((-122.27400 37.86400,-122.27400 37.87400,-122.26650 37.87480,-122.26650 37.86400,-122.27400 37.86400))'),
      (36, 'merge-eastbay:berkeley:southside', 'Southside', 'Berkeley',
       'POLYGON((-122.26650 37.86900,-122.24700 37.86900,-122.24800 37.86300,-122.26650 37.86300,-122.26650 37.86900))'),
      (37, 'merge-eastbay:berkeley:elmwood', 'Elmwood', 'Berkeley',
       'POLYGON((-122.26000 37.86300,-122.24800 37.86300,-122.24400 37.85300,-122.24400 37.84700,-122.26000 37.84700,-122.26000 37.86300))'),
      (38, 'merge-eastbay:berkeley:claremont', 'Claremont', 'Berkeley',
       'POLYGON((-122.24800 37.86300,-122.23000 37.86600,-122.23000 37.84700,-122.24400 37.84700,-122.24400 37.85300,-122.24800 37.86300))'),
      (39, 'merge-eastbay:berkeley:south-berkeley', 'South Berkeley', 'Berkeley',
       'POLYGON((-122.29150 37.86400,-122.27400 37.86400,-122.26650 37.86400,-122.26650 37.86300,-122.26000 37.86300,-122.26000 37.84500,-122.29000 37.84500,-122.29150 37.86400))'),
      (40, 'merge-eastbay:berkeley:west-berkeley', 'West Berkeley', 'Berkeley',
       'POLYGON((-122.29000 37.84500,-122.29150 37.86400,-122.29350 37.87000,-122.29750 37.89200,-122.33500 37.89200,-122.33500 37.84500,-122.29000 37.84500))'),
      (41, 'merge-eastbay:berkeley:north-berkeley', 'North Berkeley', 'Berkeley',
       'POLYGON((-122.29350 37.87000,-122.27400 37.87050,-122.27400 37.87400,-122.26650 37.87480,-122.25600 37.87550,-122.26100 37.87900,-122.26500 37.88500,-122.27000 37.89200,-122.29750 37.89200,-122.29350 37.87000))'),
      (42, 'merge-eastbay:berkeley:berkeley-hills', 'Berkeley Hills', 'Berkeley',
       'POLYGON((-122.27000 37.89200,-122.26500 37.88500,-122.26100 37.87900,-122.25600 37.87550,-122.24700 37.87700,-122.24400 37.87300,-122.24700 37.86900,-122.24800 37.86300,-122.23000 37.86600,-122.21500 37.87500,-122.23000 37.90500,-122.27000 37.90500,-122.27000 37.89200))')
    ) v(ord, id, name, city, wkt)
    order by ord
  loop
    select extensions.st_difference(
             extensions.st_intersection(extensions.st_makevalid(extensions.st_geomfromtext(r.wkt, 4326)), c.geom),
             taken)
      into g
      from public.place_boundaries c
     where c.kind = 'city' and c.city = r.city;
    if not found then
      raise exception 'No city boundary for %', r.city;
    end if;

    select extensions.st_multi(extensions.st_union(d.geom))
      into g
      from extensions.st_dump(extensions.st_collectionextract(extensions.st_makevalid(g), 3)) d
     where extensions.st_area(d.geom::extensions.geography) >= 2000;
    if g is null then
      raise exception '% is empty after clipping', r.id;
    end if;

    insert into public.place_boundaries (id, kind, name, city, source, license, geom)
    values (r.id, 'neighborhood', r.name, r.city, 'Merge (hand-drawn, approximate)', 'CC0-1.0', g);
    taken := extensions.st_union(taken, g);
  end loop;
end
$$;
-- END GENERATED east_bay_neighborhoods

-- Area helpers are owner-only ----------------------------------------------------

-- 0008 left the area helpers executable by authenticated, because the commute
-- trigger ran as the signed-in person. Through /rest/v1/rpc that made
-- area_label an open reverse-geocoder (flagged by the hosted security advisor).
-- The trigger now runs as its owner, so no client role needs the helpers.
--
-- Same body as 0008, plus an owner check. As its owner the trigger bypasses
-- RLS, so commute_area_for could see every person's areas. It's only ever
-- asked for new.owner_id's areas, and the insert/update policies reject a row
-- the signed-in person doesn't own, but only after this trigger has run. So it
-- refuses such a row first, with the same error code as the policy.
-- (auth.uid() is null for the service role and migrations, which may write any row.)
create or replace function public.commutes_set_areas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r double precision := public.area_radius_m();
begin
  if auth.uid() is not null and new.owner_id is distinct from auth.uid() then
    raise exception 'new row violates row-level security policy for table "commutes"'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and old.origin_area is not null
     and extensions.st_dwithin(new.origin, old.origin_area, r) then
    new.origin_area := old.origin_area;
    new.origin_area_label := old.origin_area_label;
  else
    new.origin_area := public.commute_area_for(
      new.owner_id, new.id, new.origin,
      case when tg_op = 'UPDATE' then old.destination_area end);
    new.origin_area_label := public.area_label(new.origin_area);
  end if;

  if tg_op = 'UPDATE' and old.destination_area is not null
     and extensions.st_dwithin(new.destination, old.destination_area, r) then
    new.destination_area := old.destination_area;
    new.destination_area_label := old.destination_area_label;
  else
    new.destination_area := public.commute_area_for(new.owner_id, new.id, new.destination, new.origin_area);
    new.destination_area_label := public.area_label(new.destination_area);
  end if;

  return new;
end
$$;

-- Triggers fire without an execute check; nobody calls these directly.
revoke execute on function public.commutes_set_areas() from public, anon, authenticated;
revoke execute on function public.area_radius_m() from public, anon, authenticated;
revoke execute on function public.within_area(extensions.geography, extensions.geography) from public, anon, authenticated;
revoke execute on function public.random_area_center(extensions.geography) from public, anon, authenticated;
revoke execute on function public.commute_area_for(uuid, uuid, extensions.geography, extensions.geography) from public, anon, authenticated;
revoke execute on function public.area_label(extensions.geography) from public, anon, authenticated;

-- Saved labels -----------------------------------------------------------------

-- Re-label saved commute areas from the current boundaries, keeping the areas.
-- commutes_set_areas keeps a stored label while its area is unchanged, so it
-- is switched off for this one statement (inside the caller's transaction).
-- Returns the number of commutes updated. Owner-only: run it from a migration
-- after changing place_boundaries.
create or replace function public.relabel_commute_areas()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  alter table public.commutes disable trigger commutes_set_areas;
  update public.commutes c
  set origin_area_label = public.area_label(c.origin_area),
      destination_area_label = public.area_label(c.destination_area)
  where c.origin_area_label is distinct from public.area_label(c.origin_area)
     or c.destination_area_label is distinct from public.area_label(c.destination_area);
  get diagnostics n = row_count;
  alter table public.commutes enable trigger commutes_set_areas;
  return n;
end
$$;

revoke execute on function public.relabel_commute_areas() from public, anon, authenticated;

select public.relabel_commute_areas();

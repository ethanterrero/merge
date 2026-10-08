-- Detour estimate (M-33). D-08: tiles only, no routing provider in the pilot.
-- Research: docs/research/2026-10-08-m01-map-provider.md.
--
-- Everything is straight-line distance on the WGS84 spheroid (PostGIS
-- geography), stretched by a road factor and timed at a flat speed:
--
--   detour = d(Do,Po) + d(Po,Pd) + d(Pd,Dd) - d(Do,Dd)    (insertion cost)
--   minutes = meters x 1.35 / 25 mph, to the nearest whole minute
--
-- plus a direction check: along the driver's origin -> destination, the
-- pickup must come before the drop-off. Known weak spot: Bay water crossings
-- (a straight line across the water is not a road).
--
-- Privacy (commute privacy spec, decision 12): these take exact points, so no
-- client may call them. Matching (M-26) and the ride lifecycle (M-37) call
-- them from security definer functions, and the service role may too. They
-- return whole minutes or a yes/no, never a distance or a point, so whatever
-- wraps them can show "within 5 min" and "about N min" without leaking more.
-- Real routing can replace the bodies later behind the same signatures.

-- Constants ----------------------------------------------------------------------

-- Circuity: road distance per straight-line distance.
create function public.detour_road_factor()
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 1.35::double precision
$$;

-- Average speed, door to door.
create function public.detour_speed_mph()
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 25::double precision
$$;

-- Largest detour a driver is asked to make, pickup and drop-off included (docs/mvp.md).
create function public.detour_limit_minutes()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 5
$$;

-- Straight-line meters -> estimated road minutes, to the nearest whole minute
-- (half up). Negative input is treated as zero.
create function public.road_minutes(meters double precision)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select floor(
    greatest(meters, 0) * public.detour_road_factor()
      / (public.detour_speed_mph() * 1609.344 / 60)
    + 0.5
  )::integer
$$;

-- Estimates ----------------------------------------------------------------------

-- Direct trip time. D-01's fallback completes a ride at
-- pickup_time + estimate_trip_minutes + 30 min.
create function public.estimate_trip_minutes(origin extensions.geography, dest extensions.geography)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select public.road_minutes(extensions.st_distance(origin, dest))
$$;

-- Extra minutes for a driver going driver_origin -> driver_dest to pick up at
-- pax_origin and drop off at pax_dest. Null when the pickup doesn't come
-- before the drop-off along the driver's route (including a driver whose
-- origin and destination coincide, which has no direction). Matching treats
-- null as "not within the limit".
--
-- "Along the route" is the along-track distance from the driver's origin:
-- d(Do,P) x cos(bearing Do->P - bearing Do->Dd). A point at the driver's
-- origin has no bearing and sits at 0.
create function public.estimate_detour_minutes(
  driver_origin extensions.geography,
  driver_dest extensions.geography,
  pax_origin extensions.geography,
  pax_dest extensions.geography
)
returns integer
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when along.pickup < along.dropoff then
      public.road_minutes(
        extensions.st_distance(driver_origin, pax_origin)
        + extensions.st_distance(pax_origin, pax_dest)
        + extensions.st_distance(pax_dest, driver_dest)
        - extensions.st_distance(driver_origin, driver_dest))
  end
  from (
    select
      coalesce(
        extensions.st_distance(driver_origin, pax_origin)
          * cos(extensions.st_azimuth(driver_origin, pax_origin) - route.bearing),
        0) as pickup,
      coalesce(
        extensions.st_distance(driver_origin, pax_dest)
          * cos(extensions.st_azimuth(driver_origin, pax_dest) - route.bearing),
        0) as dropoff
    from (select extensions.st_azimuth(driver_origin, driver_dest) as bearing) route
  ) along
$$;

-- The yes/no matching filters on: a detour estimate exists and is at most
-- detour_limit_minutes(). Missing points or a failed direction check give false.
create function public.is_detour_within_limit(
  driver_origin extensions.geography,
  driver_dest extensions.geography,
  pax_origin extensions.geography,
  pax_dest extensions.geography
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    public.estimate_detour_minutes(driver_origin, driver_dest, pax_origin, pax_dest)
      <= public.detour_limit_minutes(),
    false)
$$;

-- No client calls any of these (exact points in, and no reason to expose the
-- constants). Security definer functions and the service role keep execute.
revoke execute on function public.detour_road_factor() from public, anon, authenticated;
revoke execute on function public.detour_speed_mph() from public, anon, authenticated;
revoke execute on function public.detour_limit_minutes() from public, anon, authenticated;
revoke execute on function public.road_minutes(double precision) from public, anon, authenticated;
revoke execute on function public.estimate_trip_minutes(extensions.geography, extensions.geography)
  from public, anon, authenticated;
revoke execute on function public.estimate_detour_minutes(
  extensions.geography, extensions.geography, extensions.geography, extensions.geography)
  from public, anon, authenticated;
revoke execute on function public.is_detour_within_limit(
  extensions.geography, extensions.geography, extensions.geography, extensions.geography)
  from public, anon, authenticated;

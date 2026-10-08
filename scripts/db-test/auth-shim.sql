-- Test-only stand-in for the parts of Supabase that our migrations and tests
-- rely on. Never apply this to a real database.

-- The postgis/postgis image's init script (initdb-postgis.sh) already ran
-- CREATE EXTENSION for postgis, postgis_topology, fuzzystrmatch and
-- postgis_tiger_geocoder in this database, with no schema, so PostGIS sits in
-- public. Hosted Supabase keeps it in the extensions schema, and 0001 asks for
-- exactly that, but "create extension if not exists" would be a no-op here.
-- Drop the image's copy so 0001 really installs PostGIS into extensions.
drop extension if exists postgis_tiger_geocoder, postgis_topology, fuzzystrmatch, postgis cascade;

create schema extensions;
create schema auth;

-- Don't add extensions to the search path. The Supabase CLI applies migrations
-- as a login role whose search_path is only "$user", public, so migrations must
-- schema-qualify extension objects (extensions.geography, extensions.st_*).
-- Leaving the default here makes CI fail the same way the hosted push would.

create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;

grant usage on schema public, auth, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase grants table access to API roles by default; RLS is what restricts it.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Helpers for switching identity inside a test transaction.
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.as_user(uid uuid) returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end
$$;

create function tests.as_anon() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create function tests.as_admin() returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

grant execute on all functions in schema tests to anon, authenticated;

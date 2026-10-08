-- Test-only stand-in for the parts of Supabase that our migrations and tests
-- rely on. Never apply this to a real database.

create schema extensions;
create schema auth;

-- Supabase puts extensions (PostGIS) on the default search path.
alter database postgres set search_path = "$user", public, extensions;

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

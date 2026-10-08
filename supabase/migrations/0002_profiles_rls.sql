-- Profiles: each signed-in person can read, create and edit only their own row.
-- Deletion happens through auth.users (on delete cascade), never from the client.

alter table public.profiles
  add constraint profiles_display_name_length
  check (char_length(btrim(display_name)) between 2 and 40);

create policy "Read own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "Create own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "Update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Vehicles and commutes: each signed-in person can read, create, edit and
-- delete only their own rows. Discovery never reads commutes directly; it goes
-- through a security definer matching function, so there is no cross-user read.

-- A commute may only use a vehicle its own owner owns. The single-column
-- foreign key from 0001 accepted any existing vehicle id, including someone
-- else's. Replace it with a composite key on (vehicle_id, owner_id). Unlike a
-- policy check, this holds for every role, and it also blocks a later change of
-- the vehicle's owner (or the commute's) that would break the pairing.
-- MATCH SIMPLE (the default) leaves a commute with no vehicle unchecked.
-- The 0001 key had no delete action, so deleting a vehicle failed while any
-- commute used it. Deleting a vehicle now just detaches it: only vehicle_id is
-- set to null (owner_id is not null and stays).
alter table public.vehicles
  add constraint vehicles_id_owner_id_key unique (id, owner_id);

alter table public.commutes
  drop constraint commutes_vehicle_id_fkey,
  add constraint commutes_vehicle_owner_fkey
    foreign key (vehicle_id, owner_id) references public.vehicles (id, owner_id)
    on delete set null (vehicle_id);

-- Policies filter on owner_id; the composite key needs an index on the
-- referencing side for vehicle deletes and owner changes.
create index if not exists vehicles_owner_id_idx on public.vehicles (owner_id);
create index if not exists commutes_owner_id_idx on public.commutes (owner_id);
create index if not exists commutes_vehicle_id_owner_id_idx on public.commutes (vehicle_id, owner_id);

-- Signed-out visitors have no business with either table.
revoke all on public.vehicles, public.commutes from anon;

create policy "Read own vehicles"
  on public.vehicles for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Create own vehicles"
  on public.vehicles for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Update own vehicles"
  on public.vehicles for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Delete own vehicles"
  on public.vehicles for delete
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Read own commutes"
  on public.commutes for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Create own commutes"
  on public.commutes for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Update own commutes"
  on public.commutes for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Delete own commutes"
  on public.commutes for delete
  to authenticated
  using (owner_id = (select auth.uid()));

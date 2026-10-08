-- Starter data model. Review and test RLS before connecting production users.
create extension if not exists postgis with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'both' check (role in ('driver','passenger','both')),
  discovery_opt_in boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  make text not null,
  model text not null,
  model_year integer,
  color text,
  passenger_seats integer not null check (passenger_seats between 1 and 8),
  accepts_foldable_scooters boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.commutes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('driver','passenger')),
  origin geography(point,4326) not null,
  destination geography(point,4326) not null,
  departure_time time not null,
  timezone text not null default 'America/Los_Angeles',
  weekdays integer[] not null default '{}',
  max_detour_minutes integer not null default 5 check (max_detour_minutes between 0 and 60),
  departure_flex_minutes integer not null default 15 check (departure_flex_minutes between 0 and 60),
  vehicle_id uuid references public.vehicles(id),
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  recipient_id uuid not null references public.profiles(id),
  commute_id uuid not null references public.commutes(id),
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired','cancelled')),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

-- Default deny. Explicit policies for discovery and invitations come with the API implementation.
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.commutes enable row level security;
alter table public.invitations enable row level security;

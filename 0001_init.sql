-- IOCL Fleet: core schema. Timestamps are timestamptz; app timezone Asia/Kolkata.
create extension if not exists pg_trgm;
create type trip_state as enum ('AT_PLANT','LOADED','ON_ROUTE_TO_AGENCY','AT_AGENCY','UNLOADING','EMPTY',
  'RETURNING_TO_PLANT','AT_PLANT_WAITING_FOR_LOAD');
-- NO_RESPONSE is a flag (vehicles.no_response_since), not a state, so the last real state is never lost.

create table profiles(id uuid primary key references auth.users on delete cascade, name text not null,
  role text not null check (role in ('ADMIN','SUPERVISOR','DRIVER')), active boolean not null default true);
create table plants(id uuid primary key default gen_random_uuid(), name text unique not null, lat double precision,
  lng double precision, radius_m int not null default 500, active boolean not null default true, is_demo boolean not null default false);
create table agencies(id uuid primary key default gen_random_uuid(), name text not null, name_norm text unique not null,
  address text, lat double precision, lng double precision, radius_m int not null default 300, phone text,
  active boolean not null default true, is_demo boolean not null default false);
create index on agencies using gin (name_norm gin_trgm_ops);
create table drivers(id uuid primary key default gen_random_uuid(), user_id uuid unique references profiles,
  name text not null, mobile text, active boolean not null default true, is_demo boolean not null default false);
create table vehicles(id uuid primary key default gen_random_uuid(), reg_no text unique not null,
  driver_id uuid references drivers, plant_id uuid references plants, active boolean not null default true,
  state trip_state not null default 'AT_PLANT', current_trip_id uuid, current_agency_id uuid references agencies,
  expected_empty_at timestamptz, last_response_at timestamptz, reminder_sent_at timestamptz,
  no_response_since timestamptz, last_lat double precision, last_lng double precision, last_location_source text,
  last_location_at timestamptz, is_demo boolean not null default false);
create table trips(id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references vehicles,
  driver_id uuid references drivers, plant_id uuid references plants, agency_id uuid references agencies,
  trip_no int not null, status text not null default 'ACTIVE' check (status in ('ACTIVE','COMPLETE','CANCELLED')),
  started_at timestamptz not null default now(), completed_at timestamptz, is_demo boolean not null default false,
  unique(vehicle_id, trip_no));
create unique index one_active_trip on trips(vehicle_id) where status='ACTIVE';
alter table vehicles add foreign key (current_trip_id) references trips;
create table agency_requests(id uuid primary key default gen_random_uuid(), submitted_name text not null,
  submitted_by uuid references profiles, vehicle_id uuid references vehicles, trip_id uuid references trips,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','MERGED')),
  possible_duplicate_ids uuid[] not null default '{}', resolved_agency_id uuid references agencies,
  resolved_by uuid references profiles, resolved_at timestamptz, created_at timestamptz not null default now());
create table trip_events(id uuid primary key default gen_random_uuid(), trip_id uuid references trips,
  vehicle_id uuid not null references vehicles, driver_id uuid references drivers, agency_id uuid references agencies,
  type text not null, occurred_at timestamptz not null, recorded_at timestamptz not null default now(),
  lat double precision, lng double precision,
  source text not null check (source in ('DRIVER','DRIVER_GPS','MAPPLS','ADMIN','SYSTEM')), notes text,
  client_event_id uuid unique, -- idempotency key for offline retries
  is_demo boolean not null default false);
create index on trip_events(trip_id, occurred_at);
create index on trip_events(vehicle_id, occurred_at desc);
create table vehicle_locations(id bigserial primary key, vehicle_id uuid not null references vehicles,
  lat double precision not null, lng double precision not null,
  source text not null check (source in ('DRIVER_GPS','MAPPLS','ADMIN','SYSTEM')), captured_at timestamptz not null);
create index on vehicle_locations(vehicle_id, captured_at desc);
create table feedback(id uuid primary key default gen_random_uuid(), trip_id uuid references trips,
  vehicle_id uuid references vehicles, driver_id uuid references drivers, agency_id uuid references agencies,
  text text not null, important boolean not null default false, lat double precision, lng double precision,
  created_at timestamptz not null default now(), is_demo boolean not null default false);
create index on feedback using gin (to_tsvector('simple', text));
create table notification_recipients(id uuid primary key default gen_random_uuid(), name text not null, mobile text,
  email text, role text, active boolean not null default true);
create table notification_preferences(type text not null, recipient_id uuid references notification_recipients on delete cascade,
  channel text not null check (channel in ('WHATSAPP','SMS','EMAIL','PUSH')), enabled boolean not null default true,
  primary key(type, recipient_id, channel));
create table notifications(id uuid primary key default gen_random_uuid(), type text not null,
  recipient_id uuid references notification_recipients, channel text not null, payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','sent','failed')), attempts int not null default 0,
  error text, created_at timestamptz not null default now(), sent_at timestamptz);
create table audit_logs(id bigserial primary key, user_id uuid references profiles, action text not null,
  entity text not null, entity_id text, old_value jsonb, new_value jsonb, created_at timestamptz not null default now());
create table integrations(name text primary key, enabled boolean not null default false, notes text);
create table settings(key text primary key, value jsonb not null);
insert into settings values ('report_interval_hours','8'),('no_response_grace_minutes','30'),
  ('timezone','"Asia/Kolkata"'),('plant_radius_m','500'),('agency_radius_m','300');
insert into integrations(name) values ('MAPPLS'),('WHATSAPP'),('SMS'),('EMAIL'),('WEBPUSH');
-- Server uses the service-role key only; RLS on with no policies = browsers cannot read tables directly.
do $$ declare t text; begin for t in select tablename from pg_tables where schemaname='public' loop
  execute format('alter table %I enable row level security', t); end loop; end $$;

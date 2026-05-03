-- Travel-ID initial schema (Indonesia + Malaysia, 7 languages)
--
-- IMPORTANT: This migration co-tenants with the existing TravelKo project on
-- the same Supabase instance. All Travel-ID tables live in a dedicated
-- `travelid` schema; TravelKo's `public.*` tables remain untouched.
-- The `auth.users` table is shared (single sign-in pool).
--
-- After running this, expose the schema:
--   Supabase Dashboard → Project Settings → API → Exposed schemas
--   → add `travelid` (alongside `public`) → Save → Restart API
--
-- Idempotent: safe to re-run during development.

-- ─────────────────────────────────────────────────────────
-- Schema + extensions
-- ─────────────────────────────────────────────────────────
create schema if not exists travelid;

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- profiles  (extends auth.users with Travel-ID-specific fields)
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  preferred_lang text check (preferred_lang in ('en','id','ms','ko','zh','ja','ar')),
  signup_source text,
  planner_usage jsonb not null default '{}'::jsonb,
                                       -- { "YYYY-MM-DD": <int>, ... } last 7 days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function travelid.handle_new_user()
returns trigger language plpgsql security definer set search_path = travelid, public as $$
begin
  insert into travelid.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Distinct trigger name from TravelKo's `on_auth_user_created` so both fire.
drop trigger if exists on_auth_user_created_travelid on auth.users;
create trigger on_auth_user_created_travelid
  after insert on auth.users
  for each row execute function travelid.handle_new_user();

-- ─────────────────────────────────────────────────────────
-- spots
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.spots (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  category text not null check (category in (
    'beach','temple','cultural','volcano','nature','diving',
    'food','cafe','shopping','nightlife',
    'mosque','museum','adventure','wellness'
  )),
  region text,
  country text not null default 'ID' check (country in ('ID','MY')),
  latitude double precision,
  longitude double precision,
  address text,
  cover_image text,
  photos text[] not null default '{}',
  tags text[] not null default '{}',
  instagram text,
  website text,
  google_map_link text,
  rating numeric(3,2) check (rating is null or (rating >= 0 and rating <= 5)),
  featured boolean not null default false,
  published boolean not null default false,
  halal boolean not null default false,
  prayer_room boolean not null default false,
  veg_friendly boolean not null default false,
  entry_fee numeric(12,2),
  best_time_to_visit text check (best_time_to_visit is null or best_time_to_visit in (
    'All Year','Dry Season (May-Sep)','Wet Season (Oct-Apr)',
    'Sunrise','Sunset','Early Morning','Evening'
  )),
  local_tips text,
  opening_hours text,
  submitted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists spots_name_lower_uniq
  on travelid.spots (lower(name));

create index if not exists spots_published_idx
  on travelid.spots (published) where published = true;
create index if not exists spots_country_idx on travelid.spots (country);
create index if not exists spots_category_idx on travelid.spots (category);
create index if not exists spots_region_idx on travelid.spots (region);
create index if not exists spots_featured_idx on travelid.spots (featured) where featured = true;
create index if not exists spots_halal_idx on travelid.spots (halal) where halal = true;
create index if not exists spots_created_idx on travelid.spots (created_at desc);

-- ─────────────────────────────────────────────────────────
-- spot_translations
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.spot_translations (
  spot_id uuid not null references travelid.spots(id) on delete cascade,
  lang text not null check (lang in ('en','id','ms','ko','zh','ja','ar')),
  name text,
  description text,
  primary key (spot_id, lang)
);

create index if not exists spot_translations_lang_idx on travelid.spot_translations (lang);

-- ─────────────────────────────────────────────────────────
-- bookmarks
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references travelid.spots(id) on delete cascade,
  type text not null check (type in ('want_to_visit','interested')),
  created_at timestamptz not null default now(),
  primary key (user_id, spot_id, type)
);

create index if not exists bookmarks_user_idx on travelid.bookmarks (user_id, created_at desc);
create index if not exists bookmarks_spot_idx on travelid.bookmarks (spot_id);

-- ─────────────────────────────────────────────────────────
-- shared_plans
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.shared_plans (
  id uuid primary key default gen_random_uuid(),
  share_id text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  days int,
  budget text,
  style text,
  lang text,
  spot_names text[] not null default '{}',
  plan_html text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists shared_plans_user_idx on travelid.shared_plans (user_id, created_at desc);
create index if not exists shared_plans_created_idx on travelid.shared_plans (created_at desc);

-- ─────────────────────────────────────────────────────────
-- spot_submissions
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.spot_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references auth.users(id) on delete set null,
  submitter_email text,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_spot_id uuid references travelid.spots(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists submissions_status_idx
  on travelid.spot_submissions (status, created_at desc);

-- ─────────────────────────────────────────────────────────
-- events  (append-only)
-- ─────────────────────────────────────────────────────────
create table if not exists travelid.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  session_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  ip_country text,
  ua_device text,
  lang text,
  occurred_at timestamptz not null default now()
);

create index if not exists events_user_idx
  on travelid.events (user_id, occurred_at desc);
create index if not exists events_type_idx
  on travelid.events (event_type, occurred_at desc);
create index if not exists events_session_idx
  on travelid.events (session_id, occurred_at desc) where session_id is not null;

create or replace function travelid.events_no_update_delete()
returns trigger language plpgsql security definer set search_path = travelid, public as $$
begin
  raise exception 'travelid.events table is append-only';
end;
$$;

drop trigger if exists events_no_update on travelid.events;
create trigger events_no_update before update on travelid.events
  for each row execute function travelid.events_no_update_delete();

drop trigger if exists events_no_delete on travelid.events;
create trigger events_no_delete before delete on travelid.events
  for each row execute function travelid.events_no_update_delete();

-- ─────────────────────────────────────────────────────────
-- updated_at maintenance
-- ─────────────────────────────────────────────────────────
create or replace function travelid.touch_updated_at()
returns trigger language plpgsql security definer set search_path = travelid, public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on travelid.profiles;
create trigger profiles_touch before update on travelid.profiles
  for each row execute function travelid.touch_updated_at();

drop trigger if exists spots_touch on travelid.spots;
create trigger spots_touch before update on travelid.spots
  for each row execute function travelid.touch_updated_at();

-- ─────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────
alter table travelid.profiles          enable row level security;
alter table travelid.spots             enable row level security;
alter table travelid.spot_translations enable row level security;
alter table travelid.bookmarks         enable row level security;
alter table travelid.shared_plans      enable row level security;
alter table travelid.spot_submissions  enable row level security;
alter table travelid.events            enable row level security;

drop policy if exists profiles_self_read on travelid.profiles;
create policy profiles_self_read on travelid.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on travelid.profiles;
create policy profiles_self_update on travelid.profiles
  for update using (auth.uid() = id);

drop policy if exists spots_public_read on travelid.spots;
create policy spots_public_read on travelid.spots
  for select using (published = true);

drop policy if exists translations_public_read on travelid.spot_translations;
create policy translations_public_read on travelid.spot_translations
  for select using (
    exists (
      select 1 from travelid.spots s
      where s.id = spot_translations.spot_id and s.published = true
    )
  );

drop policy if exists bookmarks_self_select on travelid.bookmarks;
create policy bookmarks_self_select on travelid.bookmarks
  for select using (auth.uid() = user_id);

drop policy if exists bookmarks_self_insert on travelid.bookmarks;
create policy bookmarks_self_insert on travelid.bookmarks
  for insert with check (auth.uid() = user_id);

drop policy if exists bookmarks_self_delete on travelid.bookmarks;
create policy bookmarks_self_delete on travelid.bookmarks
  for delete using (auth.uid() = user_id);

drop policy if exists shared_plans_public_read on travelid.shared_plans;
create policy shared_plans_public_read on travelid.shared_plans
  for select using (true);

drop policy if exists shared_plans_self_insert on travelid.shared_plans;
create policy shared_plans_self_insert on travelid.shared_plans
  for insert with check (
    user_id is null or auth.uid() = user_id
  );

drop policy if exists shared_plans_self_delete on travelid.shared_plans;
create policy shared_plans_self_delete on travelid.shared_plans
  for delete using (auth.uid() = user_id);

drop policy if exists submissions_self_select on travelid.spot_submissions;
create policy submissions_self_select on travelid.spot_submissions
  for select using (auth.uid() = submitted_by);

drop policy if exists submissions_self_insert on travelid.spot_submissions;
create policy submissions_self_insert on travelid.spot_submissions
  for insert with check (
    submitted_by is null or auth.uid() = submitted_by
  );

drop policy if exists events_self_read on travelid.events;
create policy events_self_read on travelid.events
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────
-- Backfill profiles for users who signed up via TravelKo BEFORE Travel-ID
-- existed. Future signups are handled by the trigger above.
-- ─────────────────────────────────────────────────────────
insert into travelid.profiles (id, display_name, avatar_url)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'name', u.email),
  u.raw_user_meta_data->>'avatar_url'
from auth.users u
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────
-- Helper: log_event (called from server with service_role)
-- ─────────────────────────────────────────────────────────
create or replace function travelid.log_event(
  p_event_type text,
  p_user_id uuid default null,
  p_session_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_ip_country text default null,
  p_ua_device text default null,
  p_lang text default null
) returns uuid language plpgsql security definer set search_path = travelid, public as $$
declare
  v_id uuid;
begin
  insert into travelid.events (
    user_id, session_id, event_type, payload, ip_country, ua_device, lang
  ) values (
    p_user_id, p_session_id, p_event_type, p_payload, p_ip_country, p_ua_device, p_lang
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function travelid.log_event(text,uuid,text,jsonb,text,text,text) from public;
grant execute on function travelid.log_event(text,uuid,text,jsonb,text,text,text) to service_role;

-- ─────────────────────────────────────────────────────────
-- Grant minimum required for PostgREST (anon + authenticated roles)
-- to query the schema. Without these, the client gets
-- "permission denied for schema travelid".
-- ─────────────────────────────────────────────────────────
grant usage on schema travelid to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema travelid to anon, authenticated;
grant all on all tables in schema travelid to service_role;
grant usage, select on all sequences in schema travelid to anon, authenticated, service_role;

alter default privileges in schema travelid
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema travelid
  grant all on tables to service_role;
alter default privileges in schema travelid
  grant usage, select on sequences to anon, authenticated, service_role;

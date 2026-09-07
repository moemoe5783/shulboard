-- Local-only stand-in for the parts of a Supabase database the migrations depend
-- on: the auth schema, auth.uid(), and the anon / authenticated / service_role
-- roles. A real Supabase project ships all of this.
--
-- THIS FILE IS NOT A MIGRATION. It is never applied to a Supabase project; it
-- exists so `npm run test:db` can run the migrations and the RLS tests against a
-- throwaway local Postgres.

-- A real Supabase project installs this into its own `extensions` schema, not
-- `public` -- matched here so a type-generation run against this shim (see
-- scripts/generate-db-types.sh) does not pick up pgcrypto's functions
-- (dearmor, gen_salt, ...) as if they belonged to the app's own public
-- schema. Nothing in the migrations actually calls a pgcrypto function
-- directly; gen_random_uuid() has been a Postgres core builtin since 13.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to current_user;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase resolves the current user from the request's JWT claims, which
-- PostgREST puts in the request.jwt.claims GUC.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', ''),
    current_setting('role', true)
  );
$$;

-- Real Supabase's own auth.jwt(): the full claim set, for policies that read
-- more than sub or role (the realtime channel-authorization policy reads
-- screen_id, a claim that only ever exists on the token
-- /api/screen/[token]/realtime-auth mints -- there is no Supabase Auth user
-- behind it).
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- A minimal stand-in for the `realtime` schema a real Supabase project already
-- ships. Only enough to test the RLS policy our own migration adds to
-- realtime.messages -- not a reimplementation of Realtime itself.
create schema if not exists realtime;

create table if not exists realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  inserted_at timestamptz not null default now()
);

-- The topic a client is attempting to subscribe to. On a real project the
-- Realtime server sets this before checking whether the request may proceed;
-- our SQL tests set it the same way (tests.set_realtime_topic).
create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

-- RLS is enabled on realtime.messages by default on a real Supabase project;
-- our own migration only ever adds a policy to it, never enables RLS itself,
-- so the shim has to do that part.
alter table realtime.messages enable row level security;

grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated, service_role;
grant usage on sequence realtime.messages_id_seq to anon, authenticated, service_role;

-- PostgREST grants table privileges separately from RLS; without these the roles
-- cannot reach the tables at all and every RLS test would pass vacuously.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

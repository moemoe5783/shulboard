-- Local-only stand-in for the parts of a Supabase database the migrations depend
-- on: the auth schema, auth.uid(), and the anon / authenticated / service_role
-- roles. A real Supabase project ships all of this.
--
-- THIS FILE IS NOT A MIGRATION. It is never applied to a Supabase project; it
-- exists so `npm run test:db` can run the migrations and the RLS tests against a
-- throwaway local Postgres.

create extension if not exists pgcrypto;

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

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

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

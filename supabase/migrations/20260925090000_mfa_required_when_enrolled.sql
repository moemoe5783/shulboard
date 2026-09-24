-- Two-step sign-in, enforced by the database and not only by the app.
--
-- Two-step sign-in is optional per account (app/(app)/account). Once an account
-- has a verified authenticator app, a session that has only given its password
-- (aal1) must not reach any shul's data: the proxy redirects it to the code
-- step (lib/supabase/proxy.ts), but that is a courtesy — the anon key is
-- public, and an aal1 access token sent straight to PostgREST would otherwise
-- read and write everything that account can. These RESTRICTIVE policies are
-- the lock: AND-ed with every permissive policy, they refuse a signed-in
-- request unless it is aal2 or its account has no verified factor.
--
-- SECURITY DEFINER functions skip these policies, so any that reads or writes
-- tenant data on a user's behalf calls mfa_satisfied() itself
-- (accept_org_invite, org_member_directory in 20260925090100).
--
-- Anon requests and the service role are unaffected: anon has no uid (so no
-- factors), and the service role bypasses RLS.
--
-- EVERY TENANT TABLE NEEDS ONE. Added here to every table that has RLS on; a
-- table created later must add its own in the same migration — the SQL test
-- supabase/tests/mfa.test.sql fails if any RLS table in public is missing it.

create function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      );
$$;

revoke all on function public.mfa_satisfied() from public;
grant execute on function public.mfa_satisfied() to anon, authenticated;

do $$
declare
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and c.relrowsecurity
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format(
      'create policy "two-step sign-in, when on" on %I.%I as restrictive for all to authenticated '
      'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      t.schema_name, t.table_name
    );
  end loop;
end;
$$;

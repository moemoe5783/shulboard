-- The platform admin (20260926090000): sees every shul and every account,
-- changes a shul's plan and makes other admins — and nobody else can, not a
-- shul's own owner, and not an admin on a password-only session once their
-- authenticator app is on.
--
-- Run with: npm run test:db. Rolled back at the end.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;
\o /dev/null

insert into auth.users (id, email) values
  ('c1111111-1111-4111-8111-111111111111', 'staff@example.test'),
  ('c2222222-2222-4222-8222-222222222222', 'gabbai@example.test'),
  ('c3333333-3333-4333-8333-333333333333', 'helper@example.test');

insert into public.platform_admins (user_id) values ('c1111111-1111-4111-8111-111111111111');

insert into public.orgs (id, name, slug, created_by) values
  ('0e000000-0000-4000-8000-000000000001', 'Beis Menachem', 'beis-menachem-pa', 'c2222222-2222-4222-8222-222222222222'),
  ('0e000000-0000-4000-8000-000000000002', 'Ohel Yosef', 'ohel-yosef-pa', 'c3333333-3333-4333-8333-333333333333');
insert into public.screens (org_id, name, token, last_seen_at) values
  ('0e000000-0000-4000-8000-000000000001', 'Main lobby', 'abcdefghijkmnpqrstuvwxyz2345678a', now()),
  ('0e000000-0000-4000-8000-000000000001', 'Simcha hall', 'abcdefghijkmnpqrstuvwxyz2345678b', now() - interval '3 days');
insert into storage.buckets (id, name) values ('other', 'other') on conflict do nothing;
insert into storage.objects (bucket_id, name, metadata) values
  ('assets', '0e000000-0000-4000-8000-000000000001/a1/large.webp', '{"size": 1000}'),
  ('assets', '0e000000-0000-4000-8000-000000000001/a1/display.webp', '{"size": 200}'),
  ('assets', '0e000000-0000-4000-8000-000000000001/a1/thumb.webp', '{"size": 50}'),
  -- Left behind: no photo record points at it.
  ('assets', '0e000000-0000-4000-8000-000000000001/gone/original.jpg', '{"size": 5000}'),
  ('assets', '0e000000-0000-4000-8000-00000000dead/x/original.jpg', '{"size": 700}'),
  ('other', 'readme.txt', '{"size": 30}');
-- The shape the upload writes (lib/media/upload.ts): no separate original, and
-- byte_size is the largest size's own bytes. Plus an older row with no sizes
-- listed, and an upload that failed.
insert into public.assets (org_id, kind, storage_path, mime_type, byte_size, variants, status) values
  ('0e000000-0000-4000-8000-000000000001', 'image', 'x/a1/large.webp', 'image/webp', 1000,
   '{"large": {"bytes": 1000}, "display": {"bytes": 200}, "thumb": {"bytes": 50}}', 'ready'),
  ('0e000000-0000-4000-8000-000000000001', 'image', 'x/old/original.jpg', 'image/jpeg', 300, '{}', 'ready'),
  ('0e000000-0000-4000-8000-000000000001', 'image', 'x/failed/', 'image/webp', null, '{}', 'failed');

select tests.eq((select count(*) from public.orgs where plan = 'trial' and trial_ends_at > now() + interval '29 days'), 2::bigint,
  'a new shul starts on a 30-day free trial');

-- A shul's own owner.
select tests.authenticate_with('c2222222-2222-4222-8222-222222222222', 'gabbai@example.test', 'aal1');
set local role authenticated;
select tests.eq((select count(*) from public.platform_orgs()), 0::bigint, 'a shul''s owner sees no platform view');
select tests.eq((select count(*) from public.platform_users()), 0::bigint, 'nor the list of accounts');
select tests.eq((select count(*) from public.platform_usage()), 0::bigint, 'nor the project''s usage');
select tests.allowed($$update public.orgs set name = 'Beis Menachem Chabad' where id = '0e000000-0000-4000-8000-000000000001'$$,
  'an owner can still rename the shul');
select tests.denied($$update public.orgs set plan = 'pro' where id = '0e000000-0000-4000-8000-000000000001'$$,
  'but not give it a plan');
select tests.denied($$update public.orgs set trial_ends_at = now() + interval '10 years' where id = '0e000000-0000-4000-8000-000000000001'$$,
  'nor stretch its trial');
select tests.denied($$select public.platform_set_org_plan('0e000000-0000-4000-8000-000000000001', 'pro', null)$$,
  'nor use the admin''s function to');
select tests.denied($$select public.platform_set_admin('c2222222-2222-4222-8222-222222222222', true)$$,
  'nor make itself a platform admin');
select tests.denied($$insert into public.platform_admins (user_id) values ('c2222222-2222-4222-8222-222222222222')$$,
  'nor write the admin list directly');
select tests.allowed($$insert into public.orgs (name, slug, plan, trial_ends_at) values ('Sneaky', 'sneaky-pa', 'pro', null)$$,
  'a new shul made from the dashboard is allowed');
reset role;
select tests.eq((select count(*) from public.orgs where slug = 'sneaky-pa' and plan = 'trial' and trial_ends_at is not null), 1::bigint,
  'but starts on the trial, whatever the insert said');

-- The platform admin.
select tests.authenticate_with('c1111111-1111-4111-8111-111111111111', 'staff@example.test', 'aal1');
set local role authenticated;
select tests.eq((select count(*) from public.platform_orgs()), 3::bigint, 'the platform admin sees every shul');
select tests.eq((select screen_count from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001'), 2::bigint,
  'with its screens');
select tests.eq((select screens_live from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001'), 1::bigint,
  'how many are live');
select tests.eq((select storage_bytes from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001'), 6250::bigint,
  'and the storage its files really take, left-behind files included');
select tests.eq((select file_count from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001'), 4::bigint,
  'in how many files');
select tests.eq((select recorded_bytes from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001'), 1550::bigint,
  'beside what its photo records account for: each size once, the largest not counted twice, a sizeless row by its byte_size');
select tests.eq((select photo_count from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001'), 2::bigint,
  'and its photos, not counting an upload that failed');
select tests.eq((select storage_bytes from public.platform_usage()), 6980::bigint, 'the whole project''s storage, every bucket');
select tests.eq((select unattributed_bytes from public.platform_usage()), 730::bigint,
  'and what belongs to no shul');
select tests.ok((select database_bytes from public.platform_usage()) > 0, 'and the database''s own size');
select tests.ok((select owner_email from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001') = 'gabbai@example.test',
  'and who owns it');
select tests.allowed($$select public.platform_set_org_plan('0e000000-0000-4000-8000-000000000001', 'pro', null)$$,
  'the admin moves a shul to Pro');
select tests.eq((select count(*) from public.platform_orgs() where org_id = '0e000000-0000-4000-8000-000000000001' and plan = 'pro' and trial_ends_at is null), 1::bigint,
  'and its trial end clears with it');
select tests.eq((select count(*) from public.orgs), 0::bigint,
  'being a platform admin doesn''t make you a member — a shul''s own tables stay closed');
do $$
begin
  perform public.platform_set_org_plan('0e000000-0000-4000-8000-000000000001', 'gold', null);
  perform tests.fail('an unknown plan is refused -- it was accepted');
exception when invalid_parameter_value then
  perform tests.pass('an unknown plan is refused');
end
$$;
select tests.eq((select count(*) from public.platform_users()), 3::bigint, 'the admin sees every account');
select tests.eq((select count(*) from public.platform_users('helper')), 1::bigint, 'and can search them');
select tests.allowed($$select public.platform_set_admin('c3333333-3333-4333-8333-333333333333', true)$$,
  'the admin makes another account an admin');
select tests.eq((select count(*) from public.platform_admins), 2::bigint, 'and the admins can see who the admins are');
select tests.denied($$select public.platform_set_admin('c1111111-1111-4111-8111-111111111111', false)$$,
  'but can''t remove themselves, which is how the last admin locks everyone out');
select tests.allowed($$select public.platform_set_admin('c3333333-3333-4333-8333-333333333333', false)$$,
  'and can remove another');
reset role;

-- The same admin, with an authenticator app on, on a password-only session.
insert into auth.mfa_factors (user_id, status) values ('c1111111-1111-4111-8111-111111111111', 'verified');
select tests.authenticate_with('c1111111-1111-4111-8111-111111111111', 'staff@example.test', 'aal1');
set local role authenticated;
select tests.eq((select count(*) from public.platform_orgs()), 0::bigint, 'with an app on, a password-only session sees nothing');
select tests.denied($$select public.platform_set_org_plan('0e000000-0000-4000-8000-000000000002', 'basic', null)$$,
  'and changes nothing');
reset role;
select tests.authenticate_with('c1111111-1111-4111-8111-111111111111', 'staff@example.test', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.platform_orgs()), 3::bigint, 'after the code, it sees every shul again');
reset role;

\o
do $$
declare failed bigint;
begin
  select count(*) into failed from tests.log where not ok;
  if failed > 0 then
    raise exception '% assertion(s) failed', failed;
  end if;
  raise notice 'all % platform admin assertions passed', (select count(*) from tests.log);
end
$$;

rollback;

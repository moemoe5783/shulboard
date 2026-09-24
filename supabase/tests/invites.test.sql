-- Invitations and member management.
--
-- invite_preview shows an invite to whoever holds its token; accept_org_invite
-- joins the signed-in account to the shul if (and only if) its email is the one
-- invited and the invite is live; org_member_directory lists a shul's people to
-- its own members only. And the tightened guard: only an owner may change or
-- remove an owner.
--
-- Run with: npm run test:db. Rolled back at the end.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

-- Only the summary at the end is worth printing.
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-4111-8111-111111111111', 'owner@example.test', '{"full_name": "Rabbi Owner"}'),
  ('a2222222-2222-4222-8222-222222222222', 'new.gabbai@example.test', '{}'),
  ('a3333333-3333-4333-8333-333333333333', 'someone.else@example.test', '{}'),
  ('a4444444-4444-4444-8444-444444444444', 'admin@example.test', '{}');

insert into public.orgs (id, name, slug, created_by) values
  ('0c000000-0000-4000-8000-000000000001', 'Beis Menachem', 'bm-invites', 'a1111111-1111-4111-8111-111111111111');

insert into public.org_members (org_id, user_id, role) values
  ('0c000000-0000-4000-8000-000000000001', 'a4444444-4444-4444-8444-444444444444', 'admin');

insert into public.org_invites (org_id, email, role, token, invited_by, expires_at) values
  ('0c000000-0000-4000-8000-000000000001', 'new.gabbai@example.test', 'editor',
   'live-token-000000000000000000000000', 'a1111111-1111-4111-8111-111111111111', now() + interval '14 days'),
  ('0c000000-0000-4000-8000-000000000001', 'late@example.test', 'viewer',
   'expired-token-0000000000000000000000', 'a1111111-1111-4111-8111-111111111111', now() + interval '1 second'),
  ('0c000000-0000-4000-8000-000000000001', 'withdrawn@example.test', 'viewer',
   'revoked-token-0000000000000000000000', 'a1111111-1111-4111-8111-111111111111', now() + interval '14 days');
update public.org_invites set revoked_at = now() where token = 'revoked-token-0000000000000000000000';
-- Expire one without waiting: created_at back, then expires_at before now.
update public.org_invites set created_at = now() - interval '20 days', expires_at = now() - interval '1 day'
  where token = 'expired-token-0000000000000000000000';

-- ---------------------------------------------------------------------------
-- invite_preview, as anyone (anon)
-- ---------------------------------------------------------------------------
set local role anon;
select tests.ok(
  (select org_name = 'Beis Menachem' and role = 'editor' and status = 'pending' and invited_by_name = 'Rabbi Owner'
     from public.invite_preview('live-token-000000000000000000000000')),
  'the link shows who is inviting, to which shul, as what');
select tests.ok((select status from public.invite_preview('expired-token-0000000000000000000000')) = 'expired', 'an expired invite says so');
select tests.ok((select status from public.invite_preview('revoked-token-0000000000000000000000')) = 'revoked', 'a withdrawn invite says so');
select tests.eq((select count(*) from public.invite_preview('not-a-real-token-0000000000000000000')), 0::bigint, 'a wrong token shows nothing');
select tests.eq((select count(*) from public.invite_preview('live')), 0::bigint, 'a short prefix of a token shows nothing');
select tests.denied($$select public.accept_org_invite('live-token-000000000000000000000000')$$, 'signed out, an invite cannot be accepted');
reset role;

-- ---------------------------------------------------------------------------
-- accept_org_invite
-- ---------------------------------------------------------------------------

-- The wrong account.
select tests.authenticate_with('a3333333-3333-4333-8333-333333333333', 'someone.else@example.test');
set local role authenticated;
select tests.denied($$select public.accept_org_invite('live-token-000000000000000000000000')$$,
  'an account with a different email cannot use the invite');
reset role;

-- The invited account, whose email differs only in case.
select tests.authenticate_with('a2222222-2222-4222-8222-222222222222', 'New.Gabbai@Example.test');
set local role authenticated;
select tests.ok(
  public.accept_org_invite('live-token-000000000000000000000000') = '0c000000-0000-4000-8000-000000000001',
  'the invited account joins the shul');
select tests.ok(
  (select role = 'editor' from public.org_members where org_id = '0c000000-0000-4000-8000-000000000001'
     and user_id = 'a2222222-2222-4222-8222-222222222222'),
  'with the role it was invited as');
select tests.ok(
  public.accept_org_invite('live-token-000000000000000000000000') = '0c000000-0000-4000-8000-000000000001',
  'clicking the link again is harmless');
select tests.eq((select count(*) from public.org_member_directory('0c000000-0000-4000-8000-000000000001')), 3::bigint,
  'a member sees the shul''s people');
select tests.ok(
  (select full_name = 'Rabbi Owner' and email = 'owner@example.test' and role = 'owner'
     from public.org_member_directory('0c000000-0000-4000-8000-000000000001') where user_id = 'a1111111-1111-4111-8111-111111111111'),
  'with their names and emails');
reset role;

select tests.authenticate_with('a3333333-3333-4333-8333-333333333333', 'someone.else@example.test');
set local role authenticated;
select tests.eq((select count(*) from public.org_member_directory('0c000000-0000-4000-8000-000000000001')), 0::bigint,
  'someone outside the shul sees nobody');
reset role;

do $$
begin
  perform tests.authenticate_with('a3333333-3333-4333-8333-333333333333', 'late@example.test');
  set local role authenticated;
  begin
    perform public.accept_org_invite('expired-token-0000000000000000000000');
    perform tests.fail('an expired invite cannot be accepted -- it was');
  exception when sqlstate '22023' then
    perform tests.pass('an expired invite cannot be accepted');
  end;
  begin
    perform tests.authenticate_with('a3333333-3333-4333-8333-333333333333', 'someone.else@example.test');
    perform public.accept_org_invite('live-token-000000000000000000000000');
    perform tests.fail('a used invite cannot be used by another account -- it was');
  exception when sqlstate '22023' then
    perform tests.pass('a used invite cannot be used by another account');
  end;
  begin
    perform tests.authenticate_with('a3333333-3333-4333-8333-333333333333', 'withdrawn@example.test');
    perform public.accept_org_invite('revoked-token-0000000000000000000000');
    perform tests.fail('a withdrawn invite cannot be accepted -- it was');
  exception when sqlstate '22023' then
    perform tests.pass('a withdrawn invite cannot be accepted');
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Only an owner may change or remove an owner
-- ---------------------------------------------------------------------------

select tests.authenticate_with('a4444444-4444-4444-8444-444444444444', 'admin@example.test');
set local role authenticated;
select tests.allowed($$update public.org_members set role = 'viewer' where user_id = 'a2222222-2222-4222-8222-222222222222'$$,
  'an admin changes an editor''s role');
select tests.denied($$update public.org_members set role = 'admin' where user_id = 'a1111111-1111-4111-8111-111111111111'$$,
  'an admin cannot demote the owner');
select tests.denied($$delete from public.org_members where user_id = 'a1111111-1111-4111-8111-111111111111'$$,
  'an admin cannot remove the owner');
reset role;

\o
do $$
declare failed bigint;
begin
  select count(*) into failed from tests.log where not ok;
  if failed > 0 then
    raise exception '% assertion(s) failed', failed;
  end if;
  raise notice 'all % invite assertions passed', (select count(*) from tests.log);
end
$$;

rollback;

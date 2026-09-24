-- Connecting a TV with a code (20260925090200).
--
-- claim_pairing binds a waiting TV to a screen for an admin of that screen's
-- shul, once: not for an editor, not with a wrong or expired code, not onto a
-- screen that already has a TV, and not the same TV onto two screens. Nobody
-- signed in can read the pairing requests directly.
--
-- Run with: npm run test:db. Rolled back at the end.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;
\o /dev/null

insert into auth.users (id, email) values
  ('c1111111-1111-4111-8111-111111111111', 'admin@example.test'),
  ('c2222222-2222-4222-8222-222222222222', 'editor@example.test'),
  ('c3333333-3333-4333-8333-333333333333', 'elsewhere@example.test');
insert into public.orgs (id, name, slug, created_by) values
  ('0e000000-0000-4000-8000-000000000001', 'Anshei Lubavitch', 'anshei-pairing', 'c1111111-1111-4111-8111-111111111111'),
  ('0f000000-0000-4000-8000-000000000001', 'Other shul', 'other-pairing', 'c3333333-3333-4333-8333-333333333333');
insert into public.org_members (org_id, user_id, role) values
  ('0e000000-0000-4000-8000-000000000001', 'c2222222-2222-4222-8222-222222222222', 'editor');
insert into public.screens (id, org_id, name, token) values
  ('0e000000-0000-4000-8000-0000000000d1', '0e000000-0000-4000-8000-000000000001', 'Main lobby', 'pairing-token-lobby-000000000000000'),
  ('0e000000-0000-4000-8000-0000000000d2', '0e000000-0000-4000-8000-000000000001', 'Simcha hall', 'pairing-token-hall-0000000000000000');

insert into public.pairing_requests (code, device_secret_hash, device_label, expires_at) values
  ('482915', repeat('a', 64), 'Samsung TV', now() + interval '10 minutes'),
  ('111111', repeat('b', 64), 'LG TV', now() - interval '1 minute');

select tests.authenticate_with('c2222222-2222-4222-8222-222222222222', 'editor@example.test');
set local role authenticated;
select tests.denied($$select public.claim_pairing('482915', '0e000000-0000-4000-8000-0000000000d1')$$, 'an editor cannot connect a TV');
select tests.eq((select count(*) from public.pairing_requests), 0::bigint, 'nobody signed in reads the pairing requests');
reset role;

select tests.authenticate_with('c3333333-3333-4333-8333-333333333333', 'elsewhere@example.test');
set local role authenticated;
select tests.denied($$select public.claim_pairing('482915', '0e000000-0000-4000-8000-0000000000d1')$$, 'an admin of another shul cannot either');
reset role;

select tests.authenticate_with('c1111111-1111-4111-8111-111111111111', 'admin@example.test');
set local role authenticated;
select tests.ok(public.claim_pairing('482 915', '0e000000-0000-4000-8000-0000000000d1') = 'Main lobby', 'an admin connects the TV, spaces in the code and all');
reset role;
select tests.ok((select device_secret_hash = repeat('a', 64) and device_label = 'Samsung TV' and device_paired_at is not null
                   from public.screens where id = '0e000000-0000-4000-8000-0000000000d1'),
  'the screen is now bound to that TV');
select tests.ok((select claimed_screen_id = '0e000000-0000-4000-8000-0000000000d1' from public.pairing_requests where code = '482915'),
  'and the request says which screen, for the TV''s next poll');

insert into public.pairing_requests (code, device_secret_hash, expires_at) values
  ('222222', repeat('c', 64), now() + interval '10 minutes'),
  ('333333', repeat('a', 64), now() + interval '10 minutes');

do $$
begin
  perform tests.authenticate_with('c1111111-1111-4111-8111-111111111111', 'admin@example.test');
  set local role authenticated;
  begin
    perform public.claim_pairing('222222', '0e000000-0000-4000-8000-0000000000d1');
    perform tests.fail('a screen with a TV cannot take a second one -- it did');
  exception when sqlstate '22023' then
    perform tests.pass('a screen with a TV cannot take a second one');
  end;
  begin
    perform public.claim_pairing('111111', '0e000000-0000-4000-8000-0000000000d2');
    perform tests.fail('an expired code does nothing -- it connected');
  exception when sqlstate '22023' then
    perform tests.pass('an expired code does nothing');
  end;
  begin
    perform public.claim_pairing('999999', '0e000000-0000-4000-8000-0000000000d2');
    perform tests.fail('a wrong code does nothing -- it connected');
  exception when sqlstate '22023' then
    perform tests.pass('a wrong code does nothing');
  end;
  begin
    perform public.claim_pairing('333333', '0e000000-0000-4000-8000-0000000000d2');
    perform tests.fail('the same TV cannot be two screens -- it was');
  exception when sqlstate '22023' then
    perform tests.pass('the same TV cannot be two screens');
  end;
  reset role;
end;
$$;

-- Disconnecting is an ordinary admin update (the dashboard's action).
select tests.authenticate_with('c1111111-1111-4111-8111-111111111111', 'admin@example.test');
set local role authenticated;
select tests.allowed($$update public.screens set device_secret_hash = null, device_label = null, device_paired_at = null
                       where id = '0e000000-0000-4000-8000-0000000000d1'$$, 'an admin disconnects the TV');
select tests.ok(public.claim_pairing('222222', '0e000000-0000-4000-8000-0000000000d1') = 'Main lobby', 'and can then connect a new one');
reset role;

\o
do $$
declare failed bigint;
begin
  select count(*) into failed from tests.log where not ok;
  if failed > 0 then
    raise exception '% assertion(s) failed', failed;
  end if;
  raise notice 'all % pairing assertions passed', (select count(*) from tests.log);
end
$$;

rollback;

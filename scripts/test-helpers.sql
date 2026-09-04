-- Shared assertion harness for the SQL tests in supabase/tests.
--
-- Applied by scripts/test-db.sh before the test files. pgTAP is not assumed to be
-- installed, so this is the whole framework: a log table, a handful of assertions
-- that raise on failure, and a way to run as a given user.
--
-- NOT A MIGRATION. This never reaches a Supabase project.

create schema tests;

create table tests.log (
  id serial primary key,
  ok boolean not null,
  label text not null
);

create function tests.pass(label text) returns void language sql as $$
  insert into tests.log (ok, label) values (true, label);
$$;

create function tests.fail(label text) returns void language plpgsql as $$
begin
  insert into tests.log (ok, label) values (false, label);
  raise exception 'FAILED: %', label;
end;
$$;

create function tests.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then perform tests.pass(label); else perform tests.fail(label); end if;
end;
$$;

create function tests.eq(actual bigint, expected bigint, label text)
returns void language plpgsql as $$
begin
  if actual is not distinct from expected then
    perform tests.pass(label);
  else
    perform tests.fail(format('%s -- expected %s, got %s', label, expected, actual));
  end if;
end;
$$;

-- Asserts that a statement is rejected by RLS (42501) rather than succeeding.
create function tests.denied(stmt text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception
    when insufficient_privilege then
      perform tests.pass(label);
      return;
    when others then
      perform tests.fail(format('%s -- rejected, but with %s: %s', label, sqlstate, sqlerrm));
      return;
  end;
  perform tests.fail(label || ' -- the write was ALLOWED and should not have been');
end;
$$;

-- Asserts that a statement succeeds, so that the matching denial above is not
-- passing vacuously.
create function tests.allowed(stmt text, label text) returns void
language plpgsql as $$
begin
  execute stmt;
  perform tests.pass(label);
exception when others then
  perform tests.fail(format('%s -- was rejected with %s: %s', label, sqlstate, sqlerrm));
end;
$$;

-- Every tenant table, checked the same way: exactly its own row is visible and
-- none of the other org's rows are.
create function tests.isolated(tbl text, org_col text, theirs uuid) returns void
language plpgsql as $$
declare
  total bigint;
  leaked bigint;
begin
  execute format('select count(*) from %s', tbl) into total;
  execute format('select count(*) from %s where %I = $1', tbl, org_col)
    using theirs into leaked;

  perform tests.eq(total, 1::bigint, tbl || ': sees exactly its own row');
  perform tests.eq(leaked, 0::bigint, tbl || ': sees none of the other org''s rows');
end;
$$;

create function tests.authenticate_as(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
$$;

grant usage on schema tests to authenticated;
grant insert, select on tests.log to authenticated;
grant usage, select on sequence tests.log_id_seq to authenticated;

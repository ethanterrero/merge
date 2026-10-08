-- Profiles: each signed-in person can read, create and edit only their own row.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bea@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'cal@example.test');

insert into public.profiles (id, display_name, role)
values ('00000000-0000-0000-0000-00000000000b', 'Bea B.', 'driver');

-- 1. A user can create, read, and update their own profile.
select tests.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.profiles (id, display_name, role)
values ('00000000-0000-0000-0000-00000000000a', 'Ada A.', 'passenger');

do $$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'Ada should see exactly one profile (her own)';
  end if;
  update public.profiles set display_name = 'Ada L.' where id = auth.uid();
  if (select display_name from public.profiles where id = auth.uid()) is distinct from 'Ada L.' then
    raise exception 'Ada should be able to update her own profile';
  end if;
end
$$;

-- 2. A user cannot read, update, or delete another user's profile.
do $$
declare
  n integer;
begin
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'Ada can read Bea''s profile';
  end if;
  -- Naming Bea's row in the WHERE clause means the SELECT policy hides it before
  -- the UPDATE policy is consulted, so this alone cannot test the UPDATE policy.
  -- The unfiltered update below does.
  update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Ada updated Bea''s profile';
  end if;
  delete from public.profiles where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'Profiles must not be deletable from the client';
  end if;
end
$$;

-- 2 (UPDATE policy USING). With no WHERE clause, only the policy decides which
-- rows an update may touch: Ada's own row, and not Bea's.
do $$
declare
  n integer;
begin
  update public.profiles set display_name = 'Hacked';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'An unfiltered update by Ada should touch only her own row, but touched % rows', n;
  end if;
end
$$;

select tests.as_admin();
do $$
begin
  if (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') is distinct from 'Bea B.' then
    raise exception 'Ada changed Bea''s display name';
  end if;
end
$$;
select tests.as_user('00000000-0000-0000-0000-00000000000a');

-- 3. A user cannot create a profile for someone else, or hand their own to someone else.
-- 3a. Insert (INSERT policy WITH CHECK).
do $$
begin
  begin
    insert into public.profiles (id, display_name)
    values ('00000000-0000-0000-0000-00000000000c', 'Cal C.');
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'Ada created a profile for Cal';
end
$$;

-- 3b. Change her own row's id to Cal's, with a WHERE clause. Cal exists in
-- auth.users, so the foreign key would not stop this. The WHERE clause reads the
-- id column, so Postgres also applies the SELECT policy to the new row: either
-- that or the UPDATE policy's WITH CHECK may be what rejects it. 3c isolates
-- the UPDATE WITH CHECK.
do $$
begin
  update public.profiles set id = '00000000-0000-0000-0000-00000000000c' where id = auth.uid();
  raise exception 'Ada''s update of her own id to Cal''s was not rejected';
exception when insufficient_privilege then
  null;
end
$$;

-- 3c. The same change with no WHERE clause and a constant SET value. The
-- statement reads no columns, so it needs no SELECT rights and the SELECT policy
-- is not applied: the UPDATE policy's USING clause alone picks Ada's row, and
-- only its WITH CHECK clause can reject the new id.
do $$
begin
  update public.profiles set id = '00000000-0000-0000-0000-00000000000c';
  raise exception 'Ada''s unfiltered update of her own id to Cal''s was not rejected';
exception when insufficient_privilege then
  null;
end
$$;

-- 4. Anonymous visitors cannot read any profile.
select tests.as_anon();
do $$
begin
  if (select count(*) from public.profiles) <> 0 then
    raise exception 'anon can read profiles';
  end if;
end
$$;

-- 5. Display names must be 2–40 characters after trimming.
select tests.as_admin();

-- 5a. One character after trimming is rejected.
do $$
begin
  insert into public.profiles (id, display_name)
  values ('00000000-0000-0000-0000-00000000000c', '  C  ');
  raise exception 'A 1-character display name was accepted';
exception when check_violation then
  null;
end
$$;

-- 5b. 41 characters is rejected.
do $$
begin
  insert into public.profiles (id, display_name)
  values ('00000000-0000-0000-0000-00000000000c', repeat('x', 41));
  raise exception 'A 41-character display name was accepted';
exception when check_violation then
  null;
end
$$;

-- 5c. Two characters after trimming is accepted (a rejection fails this file).
insert into public.profiles (id, display_name)
values ('00000000-0000-0000-0000-00000000000c', '  Ab  ');

-- 5d. 40 characters is accepted (a rejection fails this file).
update public.profiles
set display_name = repeat('x', 40)
where id = '00000000-0000-0000-0000-00000000000c';

rollback;

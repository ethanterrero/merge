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
  if (select display_name from public.profiles where id = auth.uid()) <> 'Ada L.' then
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

-- 3. A user cannot create a profile for someone else.
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
do $$
begin
  begin
    insert into public.profiles (id, display_name)
    values ('00000000-0000-0000-0000-00000000000c', '  C  ');
  exception when check_violation then
    begin
      insert into public.profiles (id, display_name)
      values ('00000000-0000-0000-0000-00000000000c', repeat('x', 41));
    exception when check_violation then
      return;
    end;
    raise exception 'A 41-character display name was accepted';
  end;
  raise exception 'A 1-character display name was accepted';
end
$$;

rollback;

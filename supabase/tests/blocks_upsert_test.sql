-- The app's block write (M-24): supabase-js upsert(..., { onConflict: 'blocker_id,blocked_id',
-- ignoreDuplicates: true }) with no select, which PostgREST runs as
--   insert into blocks (blocker_id, blocked_id) values (...)
--   on conflict (blocker_id, blocked_id) do nothing
-- with no RETURNING. Checks that exact form works for the blocker under RLS and the
-- column grants (0005), is idempotent, and can't write a row for someone else.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ann@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'ben@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'cy@example.test');

insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Ann A.', 'passenger'),
  ('00000000-0000-0000-0000-0000000000b2', 'Ben B.', 'driver'),
  ('00000000-0000-0000-0000-0000000000c3', 'Cy C.', 'driver');

select tests.as_user('00000000-0000-0000-0000-0000000000a1');

do $$
begin
  -- First block: the row is created.
  insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2')
  on conflict (blocker_id, blocked_id) do nothing;
  if (select count(*) from public.blocks) <> 1 then
    raise exception 'upsert did not create the block (% rows visible)', (select count(*) from public.blocks);
  end if;

  -- Blocking again: no error, still one row.
  insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2')
  on conflict (blocker_id, blocked_id) do nothing;
  if (select count(*) from public.blocks) <> 1 then
    raise exception 'a repeated upsert left % blocks', (select count(*) from public.blocks);
  end if;

  -- The same form can't write a row for someone else (RLS with check).
  begin
    insert into public.blocks (blocker_id, blocked_id)
    values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b2')
    on conflict (blocker_id, blocked_id) do nothing;
    raise exception 'Ann upserted a block as Cy';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

-- The blocked person can't see the row, and their own upsert of the reverse pair is
-- independent (a different key), so it succeeds and reveals nothing.
select tests.as_user('00000000-0000-0000-0000-0000000000b2');

do $$
begin
  if (select count(*) from public.blocks) <> 0 then
    raise exception 'Ben can see a block he did not create';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1')
  on conflict (blocker_id, blocked_id) do nothing;
  if (select count(*) from public.blocks) <> 1 then
    raise exception 'Ben''s reverse block was not created';
  end if;
end
$$;

select tests.as_admin();

do $$
begin
  if (select count(*) from public.blocks) <> 2 then
    raise exception 'expected 2 blocks in total, found %', (select count(*) from public.blocks);
  end if;
end
$$;

rollback;

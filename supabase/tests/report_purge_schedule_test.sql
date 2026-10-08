-- 0013: the daily report purge is scheduled wherever pg_cron is available, and the purge
-- function stays off limits to clients either way.

do $$
declare
  n integer;
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    execute $q$
      select count(*) from cron.job
      where jobname = 'purge-expired-safety-reports'
        and schedule = '30 10 * * *'
        and command = 'select public.purge_expired_safety_reports()'
        and active
    $q$ into n;
    if n <> 1 then
      raise exception 'expected one active purge-expired-safety-reports job, found %', n;
    end if;
  else
    raise notice 'pg_cron not installed in this database; schedule check skipped';
  end if;
end
$$;

do $$
begin
  if has_function_privilege('authenticated', 'public.purge_expired_safety_reports()', 'execute') then
    raise exception 'authenticated must not be able to run the report purge';
  end if;
  if has_function_privilege('anon', 'public.purge_expired_safety_reports()', 'execute') then
    raise exception 'anon must not be able to run the report purge';
  end if;
end
$$;

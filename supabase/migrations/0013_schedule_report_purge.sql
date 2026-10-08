-- Daily purge of expired safety reports (owner decision D-15, settled 2026-10-08).
-- purge_expired_safety_reports() (0010) deletes reports 12 months after the later of
-- filing and the reporter's or reported person's account deletion. This schedules it
-- with pg_cron once a day at 10:30 UTC (3:30 AM Pacific in summer, 2:30 AM in winter).
--
-- The job runs as the role that schedules it, which also owns the purge function, so the
-- function's revoke from public/anon/authenticated still holds.
--
-- pg_cron is available on hosted Supabase but not in the CI test image. Enabling and
-- scheduling are skipped, with a notice, wherever the extension can't be used, so this
-- migration never fails on that account.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here; the report purge is not scheduled';
    return;
  end if;

  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when insufficient_privilege then
    raise notice 'could not enable pg_cron (%); enable it in the dashboard and re-run the schedule', sqlerrm;
    return;
  end;

  -- cron.schedule with an existing job name updates that job, so re-running is safe.
  perform cron.schedule(
    'purge-expired-safety-reports',
    '30 10 * * *',
    'select public.purge_expired_safety_reports()'
  );
end
$$;

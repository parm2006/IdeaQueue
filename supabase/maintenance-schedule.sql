-- Run after maintenance.sql. Schedules permanent deletion of all reviewed
-- notes at the top of each hour; no pending ideas are deleted.
begin;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'ideaqueue-reviewed-cleanup', '0 * * * *',
  'select ideaqueue_private.delete_reviewed_ideas();'
);
-- Cron logs also consume space. Prune only this app's completed job logs.
select cron.schedule(
  'ideaqueue-cron-history-cleanup', '15 0 * * *',
  $job$delete from cron.job_run_details
    where jobid in (select jobid from cron.job
      where jobname in ('ideaqueue-reviewed-cleanup', 'ideaqueue-cron-history-cleanup'))
    and end_time < now() - interval '7 days';$job$
);
commit;

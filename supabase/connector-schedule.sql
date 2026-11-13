-- Run after connector-limits.sql. Only connector metadata is cleaned here.
begin;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('ideaqueue-connector-cleanup','10 * * * *','select ideaqueue_private.cleanup_connectors();');
commit;

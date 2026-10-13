-- Run after maintenance.sql. Keeps the existing hourly cron schedule.
-- No notes are deleted by installing this migration.
begin;
create table if not exists public.ideaqueue_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  hourly_cleanup boolean not null default true
);
alter table public.ideaqueue_settings enable row level security;
revoke all on public.ideaqueue_settings from public, anon, authenticated;
grant select, insert, update on public.ideaqueue_settings to authenticated;
drop policy if exists "Read own settings" on public.ideaqueue_settings;
drop policy if exists "Insert own settings" on public.ideaqueue_settings;
drop policy if exists "Update own settings" on public.ideaqueue_settings;
create policy "Read own settings" on public.ideaqueue_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Insert own settings" on public.ideaqueue_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own settings" on public.ideaqueue_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function ideaqueue_private.delete_reviewed_ideas()
returns bigint language plpgsql security definer set search_path = ''
as $$
declare removed bigint;
begin
  delete from public.ideas i
  where i.reviewed_at is not null and (
    coalesce((select s.hourly_cleanup from public.ideaqueue_settings s where s.user_id = i.user_id), true)
    or i.reviewed_at <= pg_catalog.now() - interval '7 days'
  );
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function ideaqueue_private.delete_reviewed_ideas() from public, anon, authenticated;

commit;

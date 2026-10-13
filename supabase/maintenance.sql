-- Run after setup.sql in the Supabase SQL Editor. This does not delete notes.
begin;
create schema if not exists ideaqueue_private;
revoke all on schema ideaqueue_private from public, anon, authenticated;

create table if not exists ideaqueue_private.storage_policy (
  singleton boolean primary key default true check (singleton),
  write_limit_bytes bigint not null check (write_limit_bytes > 0)
);
alter table ideaqueue_private.storage_policy enable row level security;
revoke all on ideaqueue_private.storage_policy from public, anon, authenticated;
-- Conservative headroom under the free plan's 500 MB database quota.
insert into ideaqueue_private.storage_policy(singleton, write_limit_bytes)
values (true, 450000000) on conflict (singleton) do nothing;

create or replace function ideaqueue_private.guard_idea_storage()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare write_limit bigint;
begin
  -- Allow pop/restore and metadata edits even when new content is blocked.
  if tg_op = 'UPDATE' then
    if pg_catalog.octet_length(new.text) + pg_catalog.octet_length(new.context)
       <= pg_catalog.octet_length(old.text) + pg_catalog.octet_length(old.context) then
      return new;
    end if;
  end if;
  -- Serialize idea writes across accounts before checking allocated DB bytes.
  perform pg_catalog.pg_advisory_xact_lock(740192, 1);
  select p.write_limit_bytes into strict write_limit
    from ideaqueue_private.storage_policy p where p.singleton;
  -- Reserve a further 64 KiB for this row and its indexes/page allocations.
  if pg_catalog.pg_database_size(pg_catalog.current_database())
     + pg_catalog.pg_column_size(new) + 65536 >= write_limit then
    raise exception using errcode = '53100',
      message = 'Cloud storage is nearly full. This idea was not saved. Try again after space is freed.';
  end if;
  return new;
end;
$$;
revoke all on function ideaqueue_private.guard_idea_storage() from public, anon, authenticated;
drop trigger if exists ideas_storage_guard on public.ideas;
create trigger ideas_storage_guard before insert or update on public.ideas
for each row execute function ideaqueue_private.guard_idea_storage();

-- Admin-only cleanup. Pending ideas (reviewed_at is null) are never deleted.
create or replace function ideaqueue_private.delete_reviewed_ideas()
returns bigint language plpgsql security definer set search_path = ''
as $$
declare removed bigint;
begin
  delete from public.ideas where reviewed_at is not null;
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function ideaqueue_private.delete_reviewed_ideas() from public, anon, authenticated;
create index if not exists ideas_reviewed_cleanup on public.ideas(reviewed_at)
where reviewed_at is not null;
commit;

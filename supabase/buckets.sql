-- Run after reviewed-retention.sql. Installation preserves all notes.
begin;
alter table public.ideaqueue_settings
  add column if not exists deleted_buckets text[] not null default '{}'
  check (deleted_buckets <@ array['Projects','Computer science','Mathematics','Reading','Personal']::text[]);

-- A per-account lock also serializes captures from other devices/Shortcuts.
create or replace function ideaqueue_private.route_idea_bucket()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 521904));
  if exists (select 1 from public.ideaqueue_settings s
    where s.user_id = new.user_id and new.category = any(s.deleted_buckets)) then
    new.category := 'General';
  end if;
  return new;
end;
$$;
revoke all on function ideaqueue_private.route_idea_bucket() from public, anon, authenticated;
drop trigger if exists ideas_bucket_guard on public.ideas;
create trigger ideas_bucket_guard before insert or update of category, user_id on public.ideas
for each row execute function ideaqueue_private.route_idea_bucket();

create or replace function public.delete_idea_bucket(p_category text)
returns void language plpgsql security invoker set search_path = ''
as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  if p_category is null or p_category not in ('Projects','Computer science','Mathematics','Reading','Personal') then
    raise exception using errcode = '22023', message = 'Choose a bucket to delete. General is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 521904));
  insert into public.ideaqueue_settings(user_id, deleted_buckets) values (owner_id, array[p_category])
  on conflict (user_id) do update set deleted_buckets =
    case when p_category = any(ideaqueue_settings.deleted_buckets) then ideaqueue_settings.deleted_buckets
    else pg_catalog.array_append(ideaqueue_settings.deleted_buckets, p_category) end;
  update public.ideas set category = 'General' where user_id = owner_id and category = p_category;
end;
$$;
revoke all on function public.delete_idea_bucket(text) from public, anon, authenticated;
grant execute on function public.delete_idea_bucket(text) to authenticated;
commit;

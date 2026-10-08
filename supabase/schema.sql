-- Run once in your Supabase SQL editor. No service-role key is used in the app.
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (length(btrim(text)) between 1 and 2000),
  context text not null default '' check (length(context) <= 4000),
  category text not null default 'General' check (category in ('General','Projects','Computer science','Mathematics','Reading','Personal')),
  priority integer not null default 5 check (priority between 1 and 10),
  color text not null default 'yellow' check (color in ('yellow','pink','green','blue','purple')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists ideas_user_active on public.ideas(user_id, created_at) where reviewed_at is null;
-- Adjust the UTC creation day by the unchanged base priority; no daily writes.
create index if not exists ideas_user_queue_day on public.ideas(
  user_id, (((created_at at time zone 'UTC')::date) - priority), priority desc, created_at, id
) where reviewed_at is null;
alter table public.ideas enable row level security;
drop policy if exists "Read own ideas" on public.ideas;
drop policy if exists "Insert own ideas" on public.ideas;
drop policy if exists "Update own ideas" on public.ideas;
create policy "Read own ideas" on public.ideas for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own ideas" on public.ideas for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own ideas" on public.ideas for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.ideas to authenticated;
revoke all on public.ideas from anon;

-- Database ordering matches the browser heap. Row locking makes a pop atomic.
drop function if exists public.pop_idea(text);
create or replace function public.pop_idea(p_category text default null, p_expected_id uuid default null)
returns setof public.ideas
language plpgsql security invoker set search_path = public
as $$
declare selected_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to pop an idea'; end if;
  if p_category is not null and p_category not in ('General','Projects','Computer science','Mathematics','Reading','Personal') then
    raise exception 'Invalid category';
  end if;
  select id into selected_id from public.ideas
  where user_id = auth.uid() and reviewed_at is null and (p_category is null or category = p_category)
  order by ((created_at at time zone 'UTC')::date - priority) asc, priority desc, created_at asc, id asc
  limit 1 for update skip locked;
  if p_expected_id is not null and selected_id is distinct from p_expected_id then
    raise exception 'Your queue changed. The latest upcoming idea is now shown; tap Pop again.';
  end if;
  if selected_id is null then return; end if;
  return query update public.ideas set reviewed_at = now() where id = selected_id and user_id = auth.uid() returning *;
end;
$$;
revoke all on function public.pop_idea(text, uuid) from public, anon;
grant execute on function public.pop_idea(text, uuid) to authenticated;

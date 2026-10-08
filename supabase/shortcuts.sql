-- Run after schema.sql. Capture tokens can only create notes for their owner.
-- Run the entire file as one transaction to keep function grants atomic.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists ideaqueue_private;
revoke all on schema ideaqueue_private from public, anon, authenticated;

create table if not exists ideaqueue_private.shortcut_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table ideaqueue_private.shortcut_tokens enable row level security;
revoke all on ideaqueue_private.shortcut_tokens from public, anon, authenticated;

create or replace function public.create_shortcut_token(p_label text default 'iPhone Shortcut')
returns table(id uuid, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, token text)
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  raw_token text;
begin
  if owner_id is null then raise exception using errcode = '28000', message = 'Sign in to create a Shortcut token'; end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Choose a label of 1–80 characters';
  end if;
  raw_token := 'iqc_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  return query insert into ideaqueue_private.shortcut_tokens as t(user_id, label, token_hash)
    values (owner_id, btrim(p_label), extensions.digest(raw_token, 'sha256'))
    returning t.id, t.label, t.created_at, t.last_used_at, t.revoked_at, raw_token;
end;
$$;

create or replace function public.list_shortcut_tokens()
returns table(id uuid, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign in to view Shortcut tokens'; end if;
  return query select t.id, t.label, t.created_at, t.last_used_at, t.revoked_at
    from ideaqueue_private.shortcut_tokens t where t.user_id = auth.uid()
    order by t.created_at desc, t.id desc;
end;
$$;

create or replace function public.revoke_shortcut_token(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign in to revoke a Shortcut token'; end if;
  update ideaqueue_private.shortcut_tokens t set revoked_at = pg_catalog.now()
    where t.id = p_id and t.user_id = auth.uid() and t.revoked_at is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

-- No caller can supply a user_id, id, capture time or reviewed status.
-- Return only the receipt for the newly inserted note, never existing notes.
create or replace function public.capture_idea_with_token(
  p_token text, p_text text, p_context text default '', p_category text default null,
  p_priority integer default 5, p_color text default 'yellow'
)
returns table(id uuid, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  token_id uuid;
  owner_id uuid;
  bucket text := p_category;
begin
  if p_token is null or p_token !~ '^iqc_[a-f0-9]{64}$' then
    raise exception using errcode = '28000', message = 'Invalid capture token';
  end if;
  -- Lock coordinates revocation with capture, so a revoked token cannot race a write.
  select t.id, t.user_id into token_id, owner_id
    from ideaqueue_private.shortcut_tokens t
    where t.token_hash = extensions.digest(p_token, 'sha256') and t.revoked_at is null
    for update;
  if owner_id is null then raise exception using errcode = '28000', message = 'Invalid capture token'; end if;
  if p_text is null or length(btrim(p_text)) not between 1 and 2000
    or p_context is null or length(btrim(p_context)) > 4000
    or p_priority is null or p_priority not between 1 and 10
    or p_color is null or p_color not in ('yellow','pink','green','blue','purple') then
    raise exception using errcode = '22023', message = 'Invalid idea details';
  end if;
  -- This mirrors inferCategory(text): only the supplied note text selects a bucket.
  if bucket is null then
    bucket := case
      when p_text ~* '\m(math|mathematics|calculus|algebra|theorem|geometry|probability|integral|derivative|proof)\M' then 'Mathematics'
      when p_text ~* '\m(computer science|code|coding|python|javascript|typescript|database|algorithm|algorithms|programming|compiler|software)\M' then 'Computer science'
      when p_text ~* '\m(project|projects|prototype|app|website|startup|side project|build)\M' then 'Projects'
      when p_text ~* '\m(read|reading|book|books|novel|article|essay|literature)\M' then 'Reading'
      when p_text ~* '\m(personal|family|friend|friends|health|exercise|workout|journal|holiday|vacation|birthday)\M' then 'Personal'
      else 'General' end;
  elsif bucket not in ('General','Projects','Computer science','Mathematics','Reading','Personal') then
    raise exception using errcode = '22023', message = 'Invalid category';
  end if;
  update ideaqueue_private.shortcut_tokens t set last_used_at = pg_catalog.now() where t.id = token_id;
  return query insert into public.ideas as i(user_id, text, context, category, priority, color)
    values (owner_id, btrim(p_text), btrim(p_context), bucket, p_priority, p_color)
    returning i.id, i.created_at;
end;
$$;

revoke all on function public.create_shortcut_token(text) from public, anon, authenticated;
revoke all on function public.list_shortcut_tokens() from public, anon, authenticated;
revoke all on function public.revoke_shortcut_token(uuid) from public, anon, authenticated;
revoke all on function public.capture_idea_with_token(text, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.create_shortcut_token(text) to authenticated;
grant execute on function public.list_shortcut_tokens() to authenticated;
grant execute on function public.revoke_shortcut_token(uuid) to authenticated;
grant execute on function public.capture_idea_with_token(text, text, text, text, integer, text) to anon, authenticated;
commit;

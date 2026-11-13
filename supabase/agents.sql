-- Run after schema.sql and shortcuts.sql. Separate read-only agent credentials.
-- Run the entire file as one transaction to keep function grants atomic.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists ideaqueue_private;
revoke all on schema ideaqueue_private from public, anon, authenticated;

create table if not exists ideaqueue_private.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  client_id text,
  resource text,
  refresh_hash bytea unique,
  refresh_expires_at timestamptz
);
alter table ideaqueue_private.agent_tokens enable row level security;
revoke all on ideaqueue_private.agent_tokens from public, anon, authenticated;

create or replace function public.create_agent_token(p_label text default 'AI agent')
returns table(id uuid, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, token text)
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  raw_token text;
begin
  if owner_id is null then raise exception using errcode = '28000', message = 'Sign in to create an agent token'; end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Choose a label of 1–80 characters';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,71942002));
  if (select count(*) from ideaqueue_private.agent_tokens t where t.user_id=owner_id)>=50 then
    raise exception using errcode='54000',message='Disconnect unused agent tokens before creating another';
  end if;
  raw_token := 'iqa_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  return query insert into ideaqueue_private.agent_tokens as t(user_id, label, token_hash)
    values (owner_id, btrim(p_label), extensions.digest(raw_token, 'sha256'))
    returning t.id, t.label, t.created_at, t.last_used_at, t.revoked_at, raw_token;
end;
$$;

create or replace function public.list_agent_tokens()
returns table(id uuid, label text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign in to view Agent tokens'; end if;
  return query select t.id, t.label, t.created_at, t.last_used_at, t.revoked_at
    from ideaqueue_private.agent_tokens t where t.user_id = auth.uid()
    order by t.created_at desc, t.id desc;
end;
$$;

create or replace function public.revoke_agent_token(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'Sign in to revoke a Agent token'; end if;
  update ideaqueue_private.agent_tokens t set revoked_at = pg_catalog.now()
    where t.id = p_id and t.user_id = auth.uid() and t.revoked_at is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;


create or replace function public.read_agent_ideas(p_token text)
returns table(id uuid, text text, context text, category text, priority integer, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare owner_id uuid; token_id uuid;
begin
  if p_token is null or p_token !~ '^iqa_[a-f0-9]{64}$' then
    raise exception using errcode = '28000', message = 'Invalid agent token';
  end if;
  select t.id, t.user_id into token_id, owner_id from ideaqueue_private.agent_tokens t
    where t.token_hash = extensions.digest(p_token, 'sha256') and t.revoked_at is null and (t.expires_at is null or t.expires_at > pg_catalog.now()) and coalesce(t.last_used_at,t.created_at)>pg_catalog.now()-interval '14 days' for update;
  if owner_id is null then raise exception using errcode = '28000', message = 'Invalid agent token'; end if;
  perform ideaqueue_private.consume_connector_limit(owner_id,'read');
  update ideaqueue_private.oauth_clients c set last_used_at=pg_catalog.now() where c.id=(select t.client_id from ideaqueue_private.agent_tokens t where t.id=token_id);
  update ideaqueue_private.agent_tokens t set last_used_at = pg_catalog.now() where t.id = token_id;
  return query select i.id, i.text, i.context, i.category, i.priority, i.created_at
    from public.ideas i where i.user_id = owner_id and i.reviewed_at is null
      and btrim(i.text) ~* '(^|[[:space:]])(ai|agent)[[:space:]]*$'
    order by ((i.created_at at time zone 'UTC')::date - i.priority), i.priority desc, i.created_at, i.id
    limit 100;
end;
$$;
revoke all on function public.create_agent_token(text) from public, anon, authenticated;
revoke all on function public.list_agent_tokens() from public, anon, authenticated;
revoke all on function public.revoke_agent_token(uuid) from public, anon, authenticated;
revoke all on function public.read_agent_ideas(text) from public, anon, authenticated;
grant execute on function public.create_agent_token(text) to authenticated;
grant execute on function public.list_agent_tokens() to authenticated;
grant execute on function public.revoke_agent_token(uuid) to authenticated;
grant execute on function public.read_agent_ideas(text) to service_role;
commit;

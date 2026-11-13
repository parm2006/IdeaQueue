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

-- Run after agents.sql, before deploying account-based connectors.
begin;
alter table ideaqueue_private.agent_tokens add column if not exists expires_at timestamptz;
alter table ideaqueue_private.agent_tokens add column if not exists client_id text;
alter table ideaqueue_private.agent_tokens add column if not exists resource text;
alter table ideaqueue_private.agent_tokens add column if not exists refresh_hash bytea unique;
alter table ideaqueue_private.agent_tokens add column if not exists refresh_expires_at timestamptz;

create table if not exists ideaqueue_private.oauth_clients (
 id text primary key, name text not null, redirect_uris text[] not null,
 created_at timestamptz not null default now(),
 user_id uuid references auth.users(id) on delete cascade
);
alter table ideaqueue_private.oauth_clients add column if not exists user_id uuid references auth.users(id) on delete cascade;
create table if not exists ideaqueue_private.oauth_codes (
 code_hash bytea primary key, user_id uuid not null references auth.users(id) on delete cascade,
 client_id text not null references ideaqueue_private.oauth_clients(id) on delete cascade,
 redirect_uri text not null, challenge text not null, resource text not null,
 expires_at timestamptz not null default (now() + interval '5 minutes'), consumed_at timestamptz
);
create table if not exists ideaqueue_private.used_refresh_tokens (
 token_hash bytea primary key, token_id uuid not null references ideaqueue_private.agent_tokens(id) on delete cascade
);
alter table ideaqueue_private.oauth_clients enable row level security;
alter table ideaqueue_private.oauth_codes enable row level security;
alter table ideaqueue_private.used_refresh_tokens enable row level security;
revoke all on all tables in schema ideaqueue_private from public, anon, authenticated;

create or replace function public.register_agent_oauth_client(p_name text, p_redirect_uris text[])
returns text language plpgsql security definer set search_path = '' as $$
declare new_id text;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Sign in to create a connector'; end if;
 if p_name is null or length(p_name) not between 1 and 80 or p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 10
  or exists(select 1 from unnest(p_redirect_uris) r where r is null or length(r)>2048 or r !~ '^https://[^/@#[:space:]]+([/?][^#[:space:]]*)?$' and r !~ '^http://(127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?/[^#[:space:]]*$') then
  raise exception using errcode='22023',message='Invalid client or return address';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,71942002));
 if (select count(*) from ideaqueue_private.oauth_clients where user_id=auth.uid())>=50 then
  raise exception using errcode='54000',message='Too many account connectors';
 end if;
 new_id := 'iqclient_' || encode(extensions.gen_random_bytes(24),'hex');
 insert into ideaqueue_private.oauth_clients(id,name,redirect_uris,user_id) values(new_id,p_name,p_redirect_uris,auth.uid());
 return new_id;
end $$;

create or replace function public.get_agent_oauth_client(p_client_id text,p_redirect_uri text)
returns table(client_name text) language sql security definer set search_path = '' as $$
 select c.name from ideaqueue_private.oauth_clients c where c.id=p_client_id and c.user_id is not null and exists(
  select 1 from unnest(c.redirect_uris) registered where registered=p_redirect_uri
   or (registered ~ '^http://(127\.0\.0\.1|\[::1\])/'
    and regexp_replace(p_redirect_uri,'^(http://(127\.0\.0\.1|\[::1\])):[0-9]{1,5}/','\1/')=registered)
   or (registered ~ '^http://(127\.0\.0\.1|\[::1\])/callback$'
    and regexp_replace(p_redirect_uri,'^(http://(127\.0\.0\.1|\[::1\]))(:[0-9]{1,5})?/callback/[A-Za-z0-9_-]{1,128}$','\1/callback')=registered)
 );
$$;

create or replace function public.get_own_agent_oauth_client(p_client_id text,p_redirect_uri text)
returns table(client_name text) language sql security definer set search_path = '' as $$
 select c.name from ideaqueue_private.oauth_clients c where c.id=p_client_id and c.user_id=auth.uid()
  and exists(select 1 from public.get_agent_oauth_client(p_client_id,p_redirect_uri));
$$;
revoke all on function public.get_own_agent_oauth_client(text,text) from public,anon,authenticated;
grant execute on function public.get_own_agent_oauth_client(text,text) to authenticated;

create or replace function public.approve_agent_oauth(p_client_id text,p_redirect_uri text,p_challenge text,p_resource text)
returns text language plpgsql security definer set search_path = '' as $$
declare raw_code text;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Sign in to connect'; end if;
 if not exists(select 1 from ideaqueue_private.oauth_clients where id=p_client_id and user_id=auth.uid()) then
  raise exception using errcode='42501',message='Connect using the IQ account that created this connector';
 end if;
 if p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$' or p_resource is null or length(p_resource)>2048
  or not exists(select 1 from public.get_agent_oauth_client(p_client_id,p_redirect_uri)) then
  raise exception using errcode='22023',message='Invalid authorization request';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,71942002));
 if (select count(*) from ideaqueue_private.oauth_codes where user_id=auth.uid() and expires_at>now())>=100 then
  raise exception using errcode='54000',message='Too many pending connections';
 end if;
 update ideaqueue_private.oauth_clients set last_used_at=now() where id=p_client_id;
 raw_code := 'iqcode_' || encode(extensions.gen_random_bytes(32),'hex');
 insert into ideaqueue_private.oauth_codes(code_hash,user_id,client_id,redirect_uri,challenge,resource)
  values(extensions.digest(raw_code,'sha256'),auth.uid(),p_client_id,p_redirect_uri,p_challenge,p_resource);
 return raw_code;
end $$;

create or replace function public.exchange_agent_oauth_code(p_client_id text,p_code text,p_redirect_uri text,p_verifier text,p_resource text)
returns table(access_token text, refresh_token text) language plpgsql security definer set search_path = '' as $$
declare c ideaqueue_private.oauth_codes%rowtype; raw_access text; raw_refresh text; expected_challenge text; client_label text;
begin
 if p_code is null or p_code !~ '^iqcode_[a-f0-9]{64}$' or p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' then return; end if;
 select * into c from ideaqueue_private.oauth_codes where code_hash=extensions.digest(p_code,'sha256') for update;
 expected_challenge := rtrim(translate(encode(extensions.digest(p_verifier,'sha256'),'base64'),'+/','-_'),'=');
 if c.code_hash is null or c.consumed_at is not null or c.expires_at<=now() or c.client_id is distinct from p_client_id
  or c.redirect_uri is distinct from p_redirect_uri or c.resource is distinct from p_resource or c.challenge<>expected_challenge then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.user_id::text,71942002));
 if (select count(*) from ideaqueue_private.agent_tokens where user_id=c.user_id)>=50 then
  raise exception using errcode='54000',message='Too many agent connections';
 end if;
 update ideaqueue_private.oauth_codes set consumed_at=now() where code_hash=c.code_hash;
 select name into client_label from ideaqueue_private.oauth_clients where id=c.client_id;
 raw_access := 'iqa_' || encode(extensions.gen_random_bytes(32),'hex');
 raw_refresh := 'iqr_' || encode(extensions.gen_random_bytes(32),'hex');
 update ideaqueue_private.oauth_clients set last_used_at=now() where id=c.client_id;
 insert into ideaqueue_private.agent_tokens(user_id,label,token_hash,expires_at,client_id,resource,refresh_hash,refresh_expires_at)
  values(c.user_id,client_label,extensions.digest(raw_access,'sha256'),now()+interval '1 hour',c.client_id,c.resource,extensions.digest(raw_refresh,'sha256'),now()+interval '30 days');
 return query select raw_access,raw_refresh;
end $$;

create or replace function public.refresh_agent_oauth_token(p_client_id text,p_refresh text,p_resource text)
returns table(access_token text, refresh_token text) language plpgsql security definer set search_path = '' as $$
declare t ideaqueue_private.agent_tokens%rowtype; raw_access text; raw_refresh text; hashed bytea;
begin
 if p_refresh is null or p_refresh !~ '^iqr_[a-f0-9]{64}$' then return; end if;
 hashed := extensions.digest(p_refresh,'sha256');
 select * into t from ideaqueue_private.agent_tokens where refresh_hash=hashed for update;
 if t.id is null then
  -- Reuse of a rotated refresh token revokes its connection, without rolling back the revocation.
  update ideaqueue_private.agent_tokens a set revoked_at=now()
   where a.client_id=p_client_id and a.resource=p_resource and a.id in
    (select u.token_id from ideaqueue_private.used_refresh_tokens u where u.token_hash=hashed);
  return;
 end if;
 if t.client_id is distinct from p_client_id or t.resource is distinct from p_resource or t.revoked_at is not null or t.refresh_expires_at<=now() or coalesce(t.last_used_at,t.created_at)<=now()-interval '14 days' then return; end if;
 perform ideaqueue_private.consume_connector_limit(t.user_id,'refresh');
 update ideaqueue_private.oauth_clients set last_used_at=now() where id=t.client_id;
 raw_access := 'iqa_' || encode(extensions.gen_random_bytes(32),'hex');
 raw_refresh := 'iqr_' || encode(extensions.gen_random_bytes(32),'hex');
 insert into ideaqueue_private.used_refresh_tokens values(hashed,t.id);
 update ideaqueue_private.agent_tokens set token_hash=extensions.digest(raw_access,'sha256'),expires_at=now()+interval '1 hour',
  refresh_hash=extensions.digest(raw_refresh,'sha256'),last_used_at=now() where id=t.id;
 return query select raw_access,raw_refresh;
end $$;

create or replace function public.revoke_agent_oauth_token(p_client_id text,p_token text)
returns void language sql security definer set search_path = '' as $$
 update ideaqueue_private.agent_tokens set revoked_at=now() where client_id=p_client_id
  and (token_hash=extensions.digest(p_token,'sha256') or refresh_hash=extensions.digest(p_token,'sha256'));
$$;

-- The caller must be IQ's backend. Agent credentials have no database role or table grants.
create or replace function public.read_connector_ideas(p_token text,p_resource text)
returns table(id uuid,text text,context text,category text,priority integer,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from ideaqueue_private.agent_tokens t where t.token_hash=extensions.digest(p_token,'sha256')
   and (t.resource is null or t.resource=p_resource) and t.revoked_at is null and (t.expires_at is null or t.expires_at>now())) then
  raise exception using errcode='28000', message='Invalid agent token';
 end if;
 return query select * from public.read_agent_ideas(p_token);
end $$;

revoke all on function public.read_agent_ideas(text) from public,anon,authenticated;
revoke all on function public.register_agent_oauth_client(text,text[]) from public,anon,authenticated;
revoke all on function public.get_agent_oauth_client(text,text) from public,anon,authenticated;
revoke all on function public.approve_agent_oauth(text,text,text,text) from public,anon,authenticated;
revoke all on function public.exchange_agent_oauth_code(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.refresh_agent_oauth_token(text,text,text) from public,anon,authenticated;
revoke all on function public.revoke_agent_oauth_token(text,text) from public,anon,authenticated;
revoke all on function public.read_connector_ideas(text,text) from public,anon,authenticated;
grant execute on function public.approve_agent_oauth(text,text,text,text) to authenticated;
grant execute on function public.read_agent_ideas(text) to service_role;
revoke all on function public.register_agent_oauth_client(text,text[]) from service_role;
grant execute on function public.register_agent_oauth_client(text,text[]) to authenticated;
grant execute on function public.get_agent_oauth_client(text,text) to service_role;
grant execute on function public.exchange_agent_oauth_code(text,text,text,text,text) to service_role;
grant execute on function public.refresh_agent_oauth_token(text,text,text) to service_role;
grant execute on function public.revoke_agent_oauth_token(text,text) to service_role;
grant execute on function public.read_connector_ideas(text,text) to service_role;
commit;

-- Run after agents.sql and agent-oauth.sql. No notes or accounts are deleted.
begin;
alter table ideaqueue_private.oauth_clients add column if not exists last_used_at timestamptz not null default now();
create table if not exists ideaqueue_private.connector_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('read','refresh')),
 hour_start timestamptz not null, hour_count integer not null,
 day_start timestamptz not null, day_count integer not null,
 last_used_at timestamptz not null default now(), primary key(user_id,kind)
);
alter table ideaqueue_private.connector_usage enable row level security;
revoke all on ideaqueue_private.connector_usage from public,anon,authenticated;

create or replace function ideaqueue_private.consume_connector_limit(p_user uuid,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare h timestamptz:=date_trunc('hour',now(),'UTC'); d timestamptz:=date_trunc('day',now(),'UTC');
 hourly integer; daily integer; u ideaqueue_private.connector_usage%rowtype;
begin
 if p_user is null or p_kind is null or p_kind not in ('read','refresh') then raise exception 'Invalid connector quota'; end if;
 hourly:=case when p_kind='read' then 500 else 20 end;
 daily:=case when p_kind='read' then 5000 else 100 end;
 if not exists(select 1 from ideaqueue_private.connector_usage where user_id=p_user and kind=p_kind) then
  insert into ideaqueue_private.connector_usage(user_id,kind,hour_start,hour_count,day_start,day_count)
  values(p_user,p_kind,h,0,d,0) on conflict do nothing;
 end if;
 select * into strict u from ideaqueue_private.connector_usage where user_id=p_user and kind=p_kind for update;
 if u.hour_start<>h then u.hour_count:=0; end if;
 if u.day_start<>d then u.day_count:=0; end if;
 if u.hour_count>=hourly or u.day_count>=daily then
  raise exception using errcode='P0429',message='Account connector rate limit reached';
 end if;
 update ideaqueue_private.connector_usage set hour_start=h,hour_count=u.hour_count+1,
  day_start=d,day_count=u.day_count+1,last_used_at=now() where user_id=p_user and kind=p_kind;
end $$;
revoke all on function ideaqueue_private.consume_connector_limit(uuid,text) from public,anon,authenticated;

create or replace function ideaqueue_private.cleanup_connectors()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from ideaqueue_private.oauth_codes where expires_at<=now();
 delete from ideaqueue_private.agent_tokens where coalesce(last_used_at,created_at)<=now()-interval '14 days'
  or revoked_at is not null
  or (expires_at<=now() and (refresh_expires_at is null or refresh_expires_at<=now()));
 -- Token deletion cascades to its replay-detection history.
 delete from ideaqueue_private.oauth_clients c where c.last_used_at<=now()-interval '14 days'
  and not exists(select 1 from ideaqueue_private.agent_tokens t where t.client_id=c.id);
 delete from ideaqueue_private.connector_usage where last_used_at<=now()-interval '14 days';
end $$;
revoke all on function ideaqueue_private.cleanup_connectors() from public,anon,authenticated;

-- Connector metadata shares database capacity with notes; reserve the same headroom.
create or replace function ideaqueue_private.guard_connector_storage()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(740192,1);
 if pg_catalog.pg_database_size(pg_catalog.current_database())+pg_catalog.pg_column_size(new)+65536>=450000000 then
  raise exception using errcode='53100',message='Connector storage is full';
 end if;
 return new;
end $$;
revoke all on function ideaqueue_private.guard_connector_storage() from public,anon,authenticated;
do $$ declare table_name text; begin
 foreach table_name in array array['agent_tokens','oauth_clients','oauth_codes','used_refresh_tokens','connector_usage'] loop
  execute format('drop trigger if exists connector_storage_guard on ideaqueue_private.%I',table_name);
  execute format('create trigger connector_storage_guard before insert on ideaqueue_private.%I for each row execute function ideaqueue_private.guard_connector_storage()',table_name);
 end loop;
end $$;
commit;


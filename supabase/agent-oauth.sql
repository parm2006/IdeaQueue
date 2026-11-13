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

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

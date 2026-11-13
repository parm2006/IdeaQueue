-- Scratch database only; fixtures roll back. Requires agents.sql and agent-oauth.sql.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true) \gset
select public.register_agent_oauth_client('Codex test',array['http://127.0.0.1:9999/callback']) as client \gset
select set_config('test.client', :'client',true) \gset
select public.register_agent_oauth_client('Desktop',array['http://127.0.0.1/callback']) as desktop_client \gset
select set_config('test.desktop_client',:'desktop_client',true) \gset
set local role service_role;
do $$ begin
 if (select count(*) from public.get_agent_oauth_client(current_setting('test.desktop_client'),'http://127.0.0.1:43210/callback'))<>1 then raise exception 'Desktop ephemeral callback port rejected'; end if;
 if (select count(*) from public.get_agent_oauth_client(current_setting('test.desktop_client'),'http://127.0.0.1:43210/callback/A_2YWDKQj2gg'))<>1 then raise exception 'Codex callback identifier rejected'; end if;
 if exists(select 1 from public.get_agent_oauth_client(current_setting('test.desktop_client'),'http://127.0.0.1:43210/callback/id/other')) then raise exception 'Nested callback accepted'; end if;
 if exists(select 1 from public.get_agent_oauth_client(current_setting('test.desktop_client'),'http://127.0.0.1:43210/callback/id?evil=1')) then raise exception 'Callback query accepted'; end if;
 if exists(select 1 from public.get_agent_oauth_client(current_setting('test.desktop_client'),'http://127.0.0.1:43210/other')) then raise exception 'Different callback path accepted'; end if;
 if exists(select 1 from public.get_agent_oauth_client(current_setting('test.desktop_client'),'http://evil.example/callback')) then raise exception 'Different callback host accepted'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true) \gset
insert into public.ideas(text) values ('shared AI'),(E'shared aGeNt\n'),('not shared'),('reagent');
insert into public.ideas(text,reviewed_at) values('reviewed AGENT',now());
select public.approve_agent_oauth(:'client','http://127.0.0.1:9999/callback',
 rtrim(translate(encode(sha256(convert_to(repeat('a',64),'UTF8')),'base64'),'+/','-_'),'='),'https://iq.example/api/mcp') as code \gset
select set_config('test.code',:'code',true) \gset
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true) \gset
insert into public.ideas(text) values ('Bob private AI');
do $$ begin
 begin
  perform public.approve_agent_oauth(current_setting('test.client'),'http://127.0.0.1:9999/callback',repeat('a',43),'https://iq.example/api/mcp');
  raise exception 'Other account authorized this connector';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.get_own_agent_oauth_client(current_setting('test.client'),'http://127.0.0.1:9999/callback')) then raise exception 'Other account inspected connector'; end if;
 if has_function_privilege('anon','public.get_own_agent_oauth_client(text,text)','execute') then raise exception 'Anonymous connector details grant'; end if;
 if has_function_privilege('anon','public.register_agent_oauth_client(text,text[])','execute') or has_function_privilege('service_role','public.register_agent_oauth_client(text,text[])','execute') then raise exception 'Unauthenticated registration grant remains'; end if;
 if has_function_privilege('anon','public.read_agent_ideas(text)','execute')
  or has_function_privilege('authenticated','public.read_agent_ideas(text)','execute')
  or has_function_privilege('anon','public.read_connector_ideas(text,text)','execute')
  or has_function_privilege('authenticated','public.read_connector_ideas(text,text)','execute')
  or has_function_privilege('authenticated','public.exchange_agent_oauth_code(text,text,text,text,text)','execute') then
  raise exception 'Database connector access exposed to clients';
 end if;
end $$;
set local role service_role;
do $$ begin
 if exists(select 1 from public.exchange_agent_oauth_code(current_setting('test.client'),current_setting('test.code'),'http://127.0.0.1:9999/callback',repeat('b',64),'https://iq.example/api/mcp')) then raise exception 'Wrong verifier accepted'; end if;
 if exists(select 1 from public.exchange_agent_oauth_code('other',current_setting('test.code'),'http://127.0.0.1:9999/callback',repeat('a',64),'https://iq.example/api/mcp')) then raise exception 'Wrong client accepted'; end if;
 if exists(select 1 from public.exchange_agent_oauth_code(current_setting('test.client'),current_setting('test.code'),'http://127.0.0.1:9999/evil',repeat('a',64),'https://iq.example/api/mcp')) then raise exception 'Wrong redirect accepted'; end if;
 if exists(select 1 from public.exchange_agent_oauth_code(current_setting('test.client'),current_setting('test.code'),'http://127.0.0.1:9999/callback',repeat('a',64),'https://wrong.example')) then raise exception 'Wrong resource accepted'; end if;
end $$;
select * from public.exchange_agent_oauth_code(:'client',:'code','http://127.0.0.1:9999/callback',repeat('a',64),'https://iq.example/api/mcp') \gset first_
select set_config('test.access',:'first_access_token',true),set_config('test.refresh',:'first_refresh_token',true) \gset
do $$ begin
 if (select count(*) from public.read_connector_ideas(current_setting('test.access'),'https://iq.example/api/mcp'))<>2 then raise exception 'Suffix or account isolation failed'; end if;
 if exists(select 1 from public.read_connector_ideas(current_setting('test.access'),'https://iq.example/api/mcp') where text not like 'shared%') then raise exception 'Other owner or reviewed card leaked'; end if;
 if exists(select 1 from public.exchange_agent_oauth_code(current_setting('test.client'),current_setting('test.code'),'http://127.0.0.1:9999/callback',repeat('a',64),'https://iq.example/api/mcp')) then raise exception 'Code replay accepted'; end if;
 begin
  perform * from public.read_connector_ideas(current_setting('test.access'),'https://wrong.example');
  raise exception 'Token used for wrong resource';
 exception when invalid_authorization_specification then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true) \gset
update public.ideas set text='suffix removed' where text='shared AI';
set local role service_role;
do $$ begin
 if (select count(*) from public.read_connector_ideas(current_setting('test.access'),'https://iq.example/api/mcp'))<>1 then raise exception 'Removing suffix failed'; end if;
end $$;
-- Expired access cannot be used, but a valid refresh can renew it.
reset role;
update ideaqueue_private.agent_tokens set expires_at=now()-interval '1 second' where token_hash=extensions.digest(:'first_access_token','sha256');
set local role service_role;
do $$ begin
 begin
  perform * from public.read_connector_ideas(current_setting('test.access'),'https://iq.example/api/mcp');
  raise exception 'Expired access accepted';
 exception when invalid_authorization_specification then null; end;
end $$;
select * from public.refresh_agent_oauth_token(:'client',:'first_refresh_token','https://iq.example/api/mcp') \gset rotated_
select set_config('test.rotated',:'rotated_access_token',true) \gset
do $$ begin
 if (select count(*) from public.read_connector_ideas(current_setting('test.rotated'),'https://iq.example/api/mcp'))<>1 then raise exception 'Refresh failed'; end if;
 -- Reusing the first refresh revokes the entire connection.
 if exists(select 1 from public.refresh_agent_oauth_token(current_setting('test.client'),current_setting('test.refresh'),'https://iq.example/api/mcp')) then raise exception 'Refresh replay accepted'; end if;
 begin
  perform * from public.read_connector_ideas(current_setting('test.rotated'),'https://iq.example/api/mcp');
  raise exception 'Replay did not revoke connection';
 exception when invalid_authorization_specification then null; end;
end $$;
-- The refresh endpoint enforces quotas itself; rejection does not rotate the token.
reset role;
update ideaqueue_private.agent_tokens set revoked_at=null where client_id=:'client';
update ideaqueue_private.connector_usage set hour_count=20 where user_id='10000000-0000-4000-8000-000000000001' and kind='refresh';
select set_config('test.rotated_refresh',:'rotated_refresh_token',true) \gset
set local role service_role;
do $$ begin
 begin
  perform * from public.refresh_agent_oauth_token(current_setting('test.client'),current_setting('test.rotated_refresh'),'https://iq.example/api/mcp');
  raise exception 'Refresh endpoint bypassed account quota';
 exception when sqlstate 'P0429' then null; end;
end $$;
reset role;
update ideaqueue_private.agent_tokens set last_used_at=now()-interval '14 days' where client_id=:'client';
set local role service_role;
do $$ begin
 if exists(select 1 from public.refresh_agent_oauth_token(current_setting('test.client'),current_setting('test.rotated_refresh'),'https://iq.example/api/mcp')) then raise exception 'Inactive connection refreshed'; end if;
end $$;
-- Even with a valid opaque token, anonymous direct RPC access is denied.
set local role anon;
do $$ begin
 begin
  perform * from public.read_connector_ideas(current_setting('test.access'),'https://iq.example/api/mcp');
  raise exception 'Agent bypassed plugin endpoint';
 exception when insufficient_privilege then null; end;
end $$;
rollback;

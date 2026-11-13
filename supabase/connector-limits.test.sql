-- Scratch only. Run after setup.sql. All fixtures roll back.
begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true) \gset
insert into public.ideas(text) values('Test AI');
select id,token from public.create_agent_token('First') \gset first_
select id,token from public.create_agent_token('Second') \gset second_
select set_config('test.first',:'first_token',true),set_config('test.second',:'second_token',true) \gset
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true) \gset
select token from public.create_agent_token('Other account') \gset other_
select set_config('test.other',:'other_token',true) \gset
reset role;
select * from public.read_agent_ideas(:'first_token');
update ideaqueue_private.connector_usage set hour_count=500 where user_id='10000000-0000-4000-8000-000000000001' and kind='read';
do $$ begin
 begin perform * from public.read_agent_ideas(current_setting('test.second')); raise exception 'Hourly limit bypassed with another token'; exception when sqlstate 'P0429' then null; end;
 perform * from public.read_agent_ideas(current_setting('test.other'));
end $$;
-- A new UTC hour resets hourly counts but not the daily budget.
update ideaqueue_private.connector_usage set hour_start=now()-interval '2 hours',day_count=5000 where user_id='10000000-0000-4000-8000-000000000001';
do $$ begin
 begin perform * from public.read_agent_ideas(current_setting('test.first')); raise exception 'Daily limit bypassed by hourly reset'; exception when sqlstate 'P0429' then null; end;
end $$;
-- Ordinary signed-in website reads/writes still work while agent requests are limited.
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true) \gset
do $$ begin
 if (select count(*) from public.ideas where text='Test AI')<>1 then raise exception 'Website read blocked'; end if;
 update public.ideas set text='Still available AI' where text='Test AI';
 if not found then raise exception 'Website write blocked'; end if;
end $$;
reset role;
update ideaqueue_private.connector_usage set hour_start=now()-interval '2 days',day_start=now()-interval '2 days' where user_id='10000000-0000-4000-8000-000000000001';
select * from public.read_agent_ideas(:'first_token');
do $$ begin
 if not exists(select 1 from ideaqueue_private.connector_usage where user_id='10000000-0000-4000-8000-000000000001' and hour_count=1 and day_count=1) then raise exception 'Window reset failed'; end if;
end $$;
-- Refresh and read quotas are separate; refresh limits still aggregate by owner.
do $$ begin
 perform ideaqueue_private.consume_connector_limit('10000000-0000-4000-8000-000000000001','refresh');
 update ideaqueue_private.connector_usage set hour_count=20 where user_id='10000000-0000-4000-8000-000000000001' and kind='refresh';
 begin perform ideaqueue_private.consume_connector_limit('10000000-0000-4000-8000-000000000001','refresh'); raise exception 'Refresh hourly limit failed'; exception when sqlstate 'P0429' then null; end;
 update ideaqueue_private.connector_usage set hour_start=now()-interval '2 hours',day_count=100 where user_id='10000000-0000-4000-8000-000000000001' and kind='refresh';
 begin perform ideaqueue_private.consume_connector_limit('10000000-0000-4000-8000-000000000001','refresh'); raise exception 'Refresh daily limit failed'; exception when sqlstate 'P0429' then null; end;
end $$;
-- At exactly 14 inactive days a token is unusable before the scheduled deletion.
update ideaqueue_private.agent_tokens set created_at=now()-interval '15 days',last_used_at=now()-interval '14 days' where id=:'second_id';
insert into ideaqueue_private.used_refresh_tokens(token_hash,token_id) values(extensions.digest('synthetic-old-refresh','sha256'),:'second_id');
do $$ begin
 begin perform * from public.read_agent_ideas(current_setting('test.second')); raise exception 'Inactive token accepted'; exception when invalid_authorization_specification then null; end;
end $$;
-- Recent use keeps a token even when it was created long ago.
update ideaqueue_private.agent_tokens set created_at=now()-interval '30 days',last_used_at=now()-interval '13 days' where id=:'first_id';
select public.register_agent_oauth_client('Unused',array['https://example.test/callback']) as client \gset unused_
update ideaqueue_private.oauth_clients set created_at=now()-interval '15 days',last_used_at=now()-interval '14 days' where id=:'unused_client';
select ideaqueue_private.cleanup_connectors();
do $$ begin
 if exists(select 1 from ideaqueue_private.agent_tokens where label='Second') then raise exception 'Inactive token retained'; end if;
 if exists(select 1 from ideaqueue_private.used_refresh_tokens where token_hash=extensions.digest('synthetic-old-refresh','sha256')) then raise exception 'Inactive token history retained'; end if;
 if not exists(select 1 from ideaqueue_private.agent_tokens where label='First') then raise exception 'Recently active token removed'; end if;
 if exists(select 1 from ideaqueue_private.oauth_clients where name='Unused') then raise exception 'Inactive client retained'; end if;
 if not exists(select 1 from public.ideas where text='Still available AI') then raise exception 'Cleanup deleted a note'; end if;
 if (select count(*) from auth.users where id in ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'))<>2 then raise exception 'Cleanup deleted an account'; end if;
 if has_function_privilege('authenticated','ideaqueue_private.consume_connector_limit(uuid,text)','execute') or has_table_privilege('authenticated','ideaqueue_private.connector_usage','update') then raise exception 'User can tamper with quotas'; end if;
end $$;
rollback;

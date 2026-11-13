-- Run only in an isolated database after schema.sql, shortcuts.sql, agents.sql.
-- Synthetic fixtures are rolled back.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000002') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select id, token from public.create_agent_token('Alice') \gset alice_
select set_config('test.agent_id', :'alice_id', true), set_config('test.agent_token', :'alice_token', true) \gset
insert into public.ideas(text,reviewed_at) values
 ('shared AI',null),(E'shared aGeNt\n',null),('manual AI',null),
 ('private',null),('reagent',null),('reviewed AGENT',now());
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
insert into public.ideas(text) values ('Other owner AGENT');
do $$ begin
 if public.revoke_agent_token(current_setting('test.agent_id')::uuid) then raise exception 'Cross-owner revocation'; end if;
 if exists(select 1 from public.list_agent_tokens()) then raise exception 'Cross-owner token listing'; end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin
 if (select count(*) from public.read_agent_ideas(current_setting('test.agent_token'))) <> 3 then raise exception 'Visibility or owner isolation failed'; end if;
 if exists(select 1 from public.read_agent_ideas(current_setting('test.agent_token')) where text not in ('shared AI',E'shared aGeNt\n','manual AI')) then raise exception 'Private card leak'; end if;
 begin
  perform * from public.read_agent_ideas('iqc_' || repeat('a',64));
  raise exception 'Capture token accepted';
 exception when invalid_authorization_specification then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
update public.ideas set text='suffix removed' where text='shared AI';
set local role service_role;
do $$ begin
 if (select count(*) from public.read_agent_ideas(current_setting('test.agent_token'))) <> 2 then raise exception 'Unshare failed'; end if;
end $$;
set local role authenticated;
select public.revoke_agent_token(:'alice_id');
set local role service_role;
do $$ begin
 begin
  perform * from public.read_agent_ideas(current_setting('test.agent_token'));
  raise exception 'Revoked token accepted';
 exception when invalid_authorization_specification then null; end;
end $$;
rollback;

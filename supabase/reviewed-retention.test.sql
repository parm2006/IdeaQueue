-- Isolated scratch DB only. Run after reviewed-retention.sql; fixtures roll back.
begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002'),
 ('30000000-0000-4000-8000-000000000003') on conflict (id) do nothing;
insert into public.ideas(user_id,text,created_at,reviewed_at) values
 ('10000000-0000-4000-8000-000000000001','Default recent',now(),now()),
 ('10000000-0000-4000-8000-000000000001','Default pending',now()-interval '30 days',null),
 ('20000000-0000-4000-8000-000000000002','Old reviewed',now()-interval '30 days',now()-interval '8 days'),
 ('20000000-0000-4000-8000-000000000002','Seven day boundary',now()-interval '30 days',now()-interval '7 days'),
 ('20000000-0000-4000-8000-000000000002','Six day review',now()-interval '30 days',now()-interval '6 days'),
 ('20000000-0000-4000-8000-000000000002','Old capture recent review',now()-interval '30 days',now()-interval '1 minute'),
 ('20000000-0000-4000-8000-000000000002','Keep pending',now()-interval '30 days',null),
 ('30000000-0000-4000-8000-000000000003','Other account review',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
insert into public.ideaqueue_settings(hourly_cleanup) values (false);
do $$ begin
  begin
    insert into public.ideaqueue_settings(user_id,hourly_cleanup)
    values ('10000000-0000-4000-8000-000000000001',false);
    raise exception 'Spoofed another account preference';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
insert into public.ideaqueue_settings(hourly_cleanup) values (false);
do $$ begin
  if (select count(*) from public.ideaqueue_settings) <> 1 then raise exception 'Settings leaked across accounts'; end if;
  update public.ideaqueue_settings set hourly_cleanup=true
    where user_id='20000000-0000-4000-8000-000000000002';
  if found then raise exception 'Changed another account preference'; end if;
end $$;
reset role;
do $$ declare removed bigint; begin
  removed := ideaqueue_private.delete_reviewed_ideas();
  if removed <> 3 then raise exception 'Expected 3 expired reviewed notes, got %',removed; end if;
  if not exists(select 1 from public.ideas where text='Old capture recent review') then
    raise exception 'Used capture date instead of review date'; end if;
  if not exists(select 1 from public.ideas where text='Six day review') then
    raise exception 'Deleted a review younger than 7 days'; end if;
  if (select count(*) from public.ideas where reviewed_at is null) <> 2 then
    raise exception 'Scheduled cleanup removed pending notes'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
do $$ begin
  update public.ideaqueue_settings set hourly_cleanup=true where user_id=auth.uid();
end $$;
reset role;
do $$ begin
  if ideaqueue_private.delete_reviewed_ideas() <> 2 then
    raise exception 'Re-enabled hourly cleanup did not clear the account reviews'; end if;
  if not exists(select 1 from public.ideas where text='Keep pending') then
    raise exception 'Re-enabled hourly cleanup removed pending notes'; end if;
  if not exists(select 1 from public.ideas where text='Other account review') then
    raise exception 'Changing preference cleared another account reviews'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.ideaqueue_settings;
    raise exception 'Anonymous settings access was allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

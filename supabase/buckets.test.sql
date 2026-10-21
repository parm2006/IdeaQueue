-- Isolated scratch DB only; fixtures roll back. Run after buckets.sql.
begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002') on conflict do nothing;
insert into public.ideas(user_id,text,category,created_at,reviewed_at,priority) values
 ('10000000-0000-4000-8000-000000000001','Bucket pending','Projects',now()-interval '3 days',null,8),
 ('10000000-0000-4000-8000-000000000001','Bucket reviewed','Projects',now()-interval '8 days',now()-interval '1 day',4),
 ('20000000-0000-4000-8000-000000000002','Other owner','Projects',now(),null,5);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into public.ideaqueue_settings(hourly_cleanup) values (false)
on conflict(user_id) do update set hourly_cleanup=false;
select public.delete_idea_bucket('Projects');
select public.delete_idea_bucket('Projects');
do $$ begin
  if (select deleted_buckets from public.ideaqueue_settings) <> array['Projects'] then
    raise exception 'Deletion preference missing or duplicated'; end if;
  if (select hourly_cleanup from public.ideaqueue_settings) then raise exception 'Retention preference changed'; end if;
  if (select count(*) from public.ideas where text like 'Bucket %' and category='General') <> 2 then
    raise exception 'Queued or reviewed notes were lost instead of moved'; end if;
  if not exists(select 1 from public.ideas where text='Bucket pending' and priority=8 and reviewed_at is null and created_at=now()-interval '3 days') then
    raise exception 'Moving bucket changed queue ranking'; end if;
  if not exists(select 1 from public.ideas where text='Bucket reviewed' and reviewed_at=now()-interval '1 day') then
    raise exception 'Moving bucket changed review age'; end if;
  begin
    perform public.delete_idea_bucket('General');
    raise exception 'General was deletable';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.delete_idea_bucket(null);
    raise exception 'Null category was accepted';
  exception when invalid_parameter_value then null; end;
end $$;
insert into public.ideas(user_id,text,category) values
 (auth.uid(),'Stale browser capture','Projects');
do $$ begin
  if not exists(select 1 from public.ideas where text='Stale browser capture' and category='General') then
    raise exception 'Deleted bucket was recreated by a stale insert'; end if;
end $$;
select token from public.create_shortcut_token('Bucket test') \gset bucket_
set local role anon;
select id from public.capture_idea_with_token(:'bucket_token','Shortcut after bucket deletion','','Projects') \gset capture_
reset role;
do $$ begin
  if not exists(select 1 from public.ideas where text='Shortcut after bucket deletion' and category='General') then
    raise exception 'Shortcut recreated a deleted bucket'; end if;
  if not exists(select 1 from public.ideas where text='Other owner' and category='Projects') then
    raise exception 'Another account notes changed'; end if;
  if exists(select 1 from public.ideaqueue_settings where user_id='20000000-0000-4000-8000-000000000002' and 'Projects'=any(deleted_buckets)) then
    raise exception 'Another account bucket was deleted'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.delete_idea_bucket('Reading');
    raise exception 'Anonymous bucket deletion was allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

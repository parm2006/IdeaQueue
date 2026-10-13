-- Scratch DB only, after schema.sql, shortcuts.sql and maintenance.sql.
-- Fixtures and forced capacity limits roll back. Never run against production.
begin;
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002') on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
insert into public.ideas(text, reviewed_at) values ('Reviewed A', now());
insert into public.ideas(text) values ('Pending A');
select id, token from public.create_shortcut_token('Capacity test') \gset cap_
select set_config('test.capture_token', :'cap_token', true);
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
insert into public.ideas(text, reviewed_at) values ('Reviewed B', now());
insert into public.ideas(text) values ('Pending B');
do $$ begin
  begin
    perform ideaqueue_private.delete_reviewed_ideas();
    raise exception 'User could run cross-account cleanup';
  exception when insufficient_privilege then null; end;
  begin
    update ideaqueue_private.storage_policy set write_limit_bytes = 1;
    raise exception 'User could change the capacity policy';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update ideaqueue_private.storage_policy set write_limit_bytes = 1;
set local role authenticated;
do $$ begin
  begin
    insert into public.ideas(text) values ('Must reject');
    raise exception 'Browser write bypassed capacity guard';
  exception when disk_full then null; end;
  begin
    update public.ideas set text = repeat('x', 2000) where text = 'Pending B';
    raise exception 'Growing update bypassed capacity guard';
  exception when disk_full then null; end;
  -- Metadata changes and reducing content remain possible above the limit.
  update public.ideas set reviewed_at = now() where text = 'Pending B';
  update public.ideas set reviewed_at = null, text = 'B' where text = 'Pending B';
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.capture_idea_with_token(current_setting('test.capture_token'), 'Must reject capture');
    raise exception 'Shortcut bypassed capacity guard';
  exception when disk_full then null; end;
end $$;
reset role;
select ideaqueue_private.delete_reviewed_ideas();
do $$ begin
  if exists (select 1 from public.ideas where reviewed_at is not null) then
    raise exception 'Cleanup retained reviewed notes';
  end if;
  if (select count(*) from public.ideas where text in ('Pending A','B')) <> 2 then
    raise exception 'Cleanup removed pending notes';
  end if;
end $$;
rollback;

-- Integration checks for an isolated scratch database only.
-- Prerequisites: auth.users, auth.uid(), anon/authenticated roles, schema.sql,
-- shortcuts.sql, and these two synthetic auth.users IDs. All changes roll back.
-- Run with psql -v ON_ERROR_STOP=1 -f supabase/shortcuts.test.sql.
begin;
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002') on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select id, token from public.create_shortcut_token('Alice test') \gset alice_
insert into public.ideas(text) values ('Alice private');
do $$ begin
  if (select count(*) from public.list_shortcut_tokens()) <> 1 then raise exception 'Alice token listing failed'; end if;
end $$;

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select id, token from public.create_shortcut_token('Bob test') \gset bob_
insert into public.ideas(text) values ('Bob private');
select set_config('test.alice_id', :'alice_id', true);
select set_config('test.alice_token', :'alice_token', true) \gset
do $$ begin
  if (select count(*) from public.ideas) <> 1 or (select text from public.ideas limit 1) <> 'Bob private' then
    raise exception 'Cross-user read leaked';
  end if;
  if (select count(*) from public.list_shortcut_tokens()) <> 1 then raise exception 'Cross-user token listing leaked'; end if;
  if public.revoke_shortcut_token(current_setting('test.alice_id')::uuid) then raise exception 'Bob revoked Alice token'; end if;
  begin
    insert into public.ideas(user_id, text) values ('10000000-0000-4000-8000-000000000001', 'Spoofed');
    raise exception 'Cross-user insert succeeded';
  exception when insufficient_privilege then null;
  end;
  update public.ideas set text = 'Changed by Bob' where user_id = '10000000-0000-4000-8000-000000000001';
  if found then raise exception 'Cross-user update succeeded'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
select id from public.capture_idea_with_token(:'alice_token', 'Calculus proof') \gset captured_
do $$ begin
  begin
    perform * from public.ideas;
    raise exception 'Anonymous read succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform * from ideaqueue_private.shortcut_tokens;
    raise exception 'Token hashes leaked';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.create_shortcut_token('Anonymous');
    raise exception 'Anonymous token creation succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.list_shortcut_tokens();
    raise exception 'Anonymous token listing succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.pop_idea();
    raise exception 'Anonymous pop succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.capture_idea_with_token('iqc_' || repeat('0', 64), 'Invalid token');
    raise exception 'Wrong token created a note';
  exception when invalid_authorization_specification then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true) \gset
select set_config('test.captured_id', :'captured_id', true) \gset
do $$ begin
  if not exists (select 1 from public.ideas where id = current_setting('test.captured_id')::uuid
    and user_id = auth.uid() and context = '' and category = 'Mathematics'
    and priority = 5 and color = 'yellow' and reviewed_at is null and created_at >= transaction_timestamp()) then
    raise exception 'Capture ownership/defaults/time incorrect';
  end if;
  if not public.revoke_shortcut_token(current_setting('test.alice_id')::uuid) then raise exception 'Owner revocation failed'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin
  begin
    perform * from public.capture_idea_with_token(current_setting('test.alice_token'), 'Revoked token');
    raise exception 'Revoked token created a note';
  exception when invalid_authorization_specification then null; end;
end $$;
reset role;
do $$ begin
  if current_setting('test.alice_token') !~ '^iqc_[a-f0-9]{64}$' then raise exception 'Token entropy format incorrect'; end if;
  if not exists (select 1 from ideaqueue_private.shortcut_tokens
    where id = current_setting('test.alice_id')::uuid
    and token_hash = extensions.digest(current_setting('test.alice_token'), 'sha256')
    and octet_length(token_hash) = 32 and revoked_at is not null and last_used_at is not null) then
    raise exception 'Hash storage/revocation/usage tracking incorrect';
  end if;
  if (select count(*) from public.ideas where user_id in (
    '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002')) <> 3 then
    raise exception 'Unexpected note mutations';
  end if;
end $$;
rollback;

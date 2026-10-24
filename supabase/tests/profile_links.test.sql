begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
insert into public.profiles(id,username,display_name) values
 ('a9400000-0000-4000-8000-000000000001','link_viewer_20261024','Viewer'),
 ('a9400000-0000-4000-8000-000000000002','link_target_20261024','Target');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a9400000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.join_chat_by_invite('link_target_20261024')$$,'a public profile link opens a conversation');
select set_config('test.profile_link_chat', public.join_chat_by_invite('@LINK_TARGET_20261024')->>'chat_id',true);
select is(public.join_chat_by_invite('link_target_20261024')->>'type','personal','profile links resolve to personal chats');
select is(public.join_chat_by_invite('@LINK_TARGET_20261024')->>'chat_id',current_setting('test.profile_link_chat'),'username case and @ reuse the same conversation');
select is((select count(*)::int from public.chat_members where chat_id=current_setting('test.profile_link_chat')::uuid),2,'both participants are present');
select is((select count(*)::int from public.chat_members where chat_id=current_setting('test.profile_link_chat')::uuid and role='admin'),0,'profile links grant no administrator role');
select is((select count(*)::int from public.messages where chat_id=current_setting('test.profile_link_chat')::uuid),0,'opening a profile sends no message');
select throws_ok($$select public.join_chat_by_invite('link_missing_20261024')$$,'P0002','Чат или профиль с никнеймом link_missing_20261024 не найден','a missing profile is reported');
select throws_ok($$select public.join_chat_by_invite('a9400000-0000-4000-8000-000000000002')$$,'22023','Chat UUIDs are not invite links. Generate a new invite link.','raw UUIDs do not bypass invite rules');
select is(public.join_chat_by_invite('link_viewer_20261024')->>'status','self','a self link opens personal notes');
select set_config('test.self_link_chat',public.join_chat_by_invite('link_viewer_20261024')->>'chat_id',true);
select is(public.join_chat_by_invite('@LINK_VIEWER_20261024')->>'chat_id',current_setting('test.self_link_chat'),'a repeated self link preserves notes');
select is((select count(*)::int from public.chat_members where chat_id=current_setting('test.self_link_chat')::uuid),1,'notes remain private to the owner');
reset role;
select ok(not has_function_privilege('anon','public.join_chat_by_invite(text)','execute'),'anonymous users cannot open a private chat');
select ok(not has_table_privilege('authenticated','public.chat_invites','select'),'invitation hashes remain inaccessible');
select * from finish();
rollback;

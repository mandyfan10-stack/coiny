-- Synthetic fixtures are rolled back; no existing account is modified.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);
insert into public.profiles(id,username,display_name) values
 ('a9100000-0000-4000-8000-000000000001','saved_test_new','New notes'),
 ('a9100000-0000-4000-8000-000000000002','saved_test_legacy','Legacy notes');
insert into public.chats(id,name,type,created_by) values
 ('a9200000-0000-4000-8000-000000000002','Избранное','personal','a9100000-0000-4000-8000-000000000002');
insert into public.chat_members(chat_id,profile_id,role,pinned,notifications) values
 ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002','admin',true,false);
insert into public.messages(chat_id,sender_id,text) values
 ('a9200000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002','Existing note');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a9100000-0000-4000-8000-000000000001',true);
select lives_ok('select public.ensure_saved_messages_chat()','new notes are created');
select is((select count(*)::int from public.chats where created_by=auth.uid()),1,'one notes chat exists');
select is((select role from public.chat_members where profile_id=auth.uid()),'member','new notes need no administrator role');
select lives_ok('select public.ensure_saved_messages_chat()','reopening notes succeeds under membership hardening');
select lives_ok('select public.ensure_saved_messages_chat()','repeated opening is idempotent');
select is((select count(*)::int from public.chats where created_by=auth.uid()),1,'reopening creates no duplicate');
select is((select count(*)::int from public.messages where sender_id=auth.uid()),1,'welcome message is not duplicated');
select throws_ok($$update public.chat_members set role='admin' where profile_id=auth.uid()$$,'42501','Members cannot change their own role','self promotion is still forbidden');
select set_config('request.jwt.claims','{"sub":"a9100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a9100000-0000-4000-8000-000000000002',true);
select is(public.ensure_saved_messages_chat(),'a9200000-0000-4000-8000-000000000002'::uuid,'legacy notes keep their ID');
select is((select role from public.chat_members where profile_id=auth.uid()),'admin','legacy role is preserved');
select ok((select pinned and not notifications from public.chat_members where profile_id=auth.uid()),'pin and notifications remain unchanged');
select is((select text from public.messages where sender_id=auth.uid()),'Existing note','existing note is preserved');
select is((select count(*)::int from public.chats where created_by <> auth.uid()),0,'other accounts notes stay private');
reset role;
select ok(not has_function_privilege('anon','public.ensure_saved_messages_chat()','execute'),'anonymous callers cannot open notes');
select ok(not (select prosecdef from pg_proc where oid='public.ensure_saved_messages_chat()'::regprocedure),'RPC keeps invoker permissions');
select * from finish();
rollback;

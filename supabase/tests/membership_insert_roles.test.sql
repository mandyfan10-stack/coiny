begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
insert into public.profiles(id,username,display_name) values
 ('a8100000-0000-4000-8000-000000000001','role_owner','Owner'),
 ('a8100000-0000-4000-8000-000000000002','role_member','Member'),
 ('a8100000-0000-4000-8000-000000000003','role_alt','Alt'),
 ('a8100000-0000-4000-8000-000000000004','role_admin','Admin'),
 ('a8100000-0000-4000-8000-000000000005','role_guest','Guest');
insert into public.chats(id,name,type,created_by,username,settings) values
 ('a8200000-0000-4000-8000-000000000001','Private','group','a8100000-0000-4000-8000-000000000001',null,'{"allow_add_members":true}'),
 ('a8200000-0000-4000-8000-000000000002','Public','channel','a8100000-0000-4000-8000-000000000001','role_public','{}'),
 ('a8200000-0000-4000-8000-000000000003','Personal','personal','a8100000-0000-4000-8000-000000000001',null,'{}');
insert into public.chat_members(chat_id,profile_id,role) values
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','admin'),
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002','member');
select is((select role from public.chat_members where chat_id='a8200000-0000-4000-8000-000000000001' and profile_id='a8100000-0000-4000-8000-000000000001'),'admin','trusted fixture writes preserve role');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000002',true);
select lives_ok($$insert into public.chat_members(chat_id,profile_id,role) values('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000003','admin')$$,'ordinary member can still invite another member');
select is((select role from public.chat_members where chat_id='a8200000-0000-4000-8000-000000000001' and profile_id='a8100000-0000-4000-8000-000000000003'),'member','ordinary member cannot grant admin to another account');
select lives_ok($$insert into public.chat_members(chat_id,profile_id,role) values('a8200000-0000-4000-8000-000000000002','a8100000-0000-4000-8000-000000000002','admin')$$,'existing public self-join path still works');
select is((select role from public.chat_members where chat_id='a8200000-0000-4000-8000-000000000002' and profile_id='a8100000-0000-4000-8000-000000000002'),'member','public self-join cannot grant admin');
select set_config('request.jwt.claims','{"sub":"a8100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000001',true);
insert into public.chat_members(chat_id,profile_id,role) values('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000004','admin');
select is((select role from public.chat_members where chat_id='a8200000-0000-4000-8000-000000000001' and profile_id='a8100000-0000-4000-8000-000000000004'),'admin','owner can assign an administrator');
insert into public.chat_members(chat_id,profile_id,role) values('a8200000-0000-4000-8000-000000000003','a8100000-0000-4000-8000-000000000001','admin');
select is((select role from public.chat_members where chat_id='a8200000-0000-4000-8000-000000000003' and profile_id='a8100000-0000-4000-8000-000000000001'),'member','personal memberships remain ordinary members');
select set_config('request.jwt.claims','{"sub":"a8100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000004',true);
insert into public.chat_members(chat_id,profile_id,role) values('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000005','admin');
select is((select role from public.chat_members where chat_id='a8200000-0000-4000-8000-000000000001' and profile_id='a8100000-0000-4000-8000-000000000005'),'admin','existing administrator can assign another administrator');
reset role;
select ok(not has_function_privilege('authenticated','public.normalize_chat_member_insert()','execute'),'trigger helper is not an authenticated RPC');
select * from finish();
rollback;

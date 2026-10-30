-- Synthetic users only; all changes are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.profiles(id,username) values
 ('a8100000-0000-4000-8000-000000000001','remediation_owner'),
 ('a8100000-0000-4000-8000-000000000002','remediation_member'),
 ('a8100000-0000-4000-8000-000000000003','remediation_quota');
insert into public.chats(id,name,type,created_by,settings) values
 ('a8200000-0000-4000-8000-000000000001','Channel','channel','a8100000-0000-4000-8000-000000000001','{}'),
 ('a8200000-0000-4000-8000-000000000002','Restricted','group','a8100000-0000-4000-8000-000000000001','{"only_admins_can_post":true}'),
 ('a8200000-0000-4000-8000-000000000003','No media','group','a8100000-0000-4000-8000-000000000001','{"allow_media":false}'),
 ('a8200000-0000-4000-8000-000000000004','Ordinary','group','a8100000-0000-4000-8000-000000000001','{}'),
 ('a8200000-0000-4000-8000-000000000005','Personal','personal','a8100000-0000-4000-8000-000000000001','{}'),
 ('a8200000-0000-4000-8000-000000000006','Saved','personal','a8100000-0000-4000-8000-000000000002','{}');
insert into public.chat_members(chat_id,profile_id,role)
 select id,'a8100000-0000-4000-8000-000000000001','admin' from public.chats where id::text like 'a8200000-%' and id::text not like '%000006';
insert into public.chat_members(chat_id,profile_id,role)
 select id,'a8100000-0000-4000-8000-000000000002','member' from public.chats where id::text like 'a8200000-%';
insert into public.user_devices(id,user_id,device_name,credential,certificate,certificate_signature,status,approved_at) values
 ('a8300000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','Owner',decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',64),'hex'),'active',now()),
 ('a8300000-0000-4000-8000-000000000002','a8100000-0000-4000-8000-000000000002','Member',decode(repeat('04',32),'hex'),decode(repeat('05',32),'hex'),decode(repeat('06',64),'hex'),'active',now());
insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-attachments','a8200000-0000-4000-8000-000000000003/a8100000-0000-4000-8000-000000000002/msg_a8400000-0000-4000-8000-000000000001.jpg','a8100000-0000-4000-8000-000000000002');
-- Messages authored before posting permissions changed.
insert into public.messages(chat_id,sender_id,text) values
 ('a8200000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002','old channel post'),
 ('a8200000-0000-4000-8000-000000000002','a8100000-0000-4000-8000-000000000002','old group post');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a8100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000002',true);
select throws_ok($$insert into public.e2ee_conversations(chat_id,mls_group_id,created_by) values('a8200000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),auth.uid())$$,'42501',null,'member cannot directly activate a conversation');
select throws_ok($$select public.activate_e2ee_conversation('a8200000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),0,'a8300000-0000-4000-8000-000000000002',decode(repeat('01',32),'hex'),digest(decode(repeat('01',32),'hex'),'sha256'))$$,'42501','E2EE v2 activation is disabled','RPC rollout defaults to disabled');
select throws_ok($$update private.e2ee_runtime_config set activation_enabled=true$$,'42501',null,'client cannot enable the rollout');
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values('a8200000-0000-4000-8000-000000000001',auth.uid(),'bypass')$$,'42501',null,'channel subscriber cannot post');
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values('a8200000-0000-4000-8000-000000000002',auth.uid(),'bypass')$$,'42501',null,'admin-only group rejects ordinary members');
select lives_ok($$insert into public.messages(chat_id,sender_id,text) values('a8200000-0000-4000-8000-000000000004',auth.uid(),'ordinary')$$,'default group posting remains allowed');
select lives_ok($$insert into public.messages(chat_id,sender_id,text) values('a8200000-0000-4000-8000-000000000005',auth.uid(),'personal'),('a8200000-0000-4000-8000-000000000006',auth.uid(),'note')$$,'personal and saved messages remain allowed');
select lives_ok($$insert into public.messages(chat_id,sender_id,text) values('a8200000-0000-4000-8000-000000000003',auth.uid(),'text allowed')$$,'media restriction preserves text');
select throws_ok($$insert into public.messages(chat_id,sender_id,text,media) values('a8200000-0000-4000-8000-000000000003',auth.uid(),'media','storage://chat-attachments/test.jpg')$$,'42501',null,'media field cannot bypass restriction');
select throws_ok($$insert into public.messages(chat_id,sender_id,text,media_path) values('a8200000-0000-4000-8000-000000000003',auth.uid(),'media','test.jpg')$$,'42501',null,'media_path cannot bypass restriction');
select throws_ok($$update public.messages set media='https://example.invalid/sticker.json' where chat_id='a8200000-0000-4000-8000-000000000003'$$,'42501',null,'text followed by media UPDATE cannot bypass restriction');
select throws_ok($$update public.messages set media_path='test.jpg' where chat_id='a8200000-0000-4000-8000-000000000003'$$,'42501',null,'media_path UPDATE cannot bypass restriction');
select throws_ok($$update public.messages set text='channel bypass' where chat_id='a8200000-0000-4000-8000-000000000001'$$,'42501',null,'old channel message cannot bypass current posting permissions');
select throws_ok($$update public.messages set text='group bypass' where chat_id='a8200000-0000-4000-8000-000000000002'$$,'42501',null,'old group message cannot bypass current posting permissions');
select lives_ok($$update public.messages set text='edited ordinary' where chat_id='a8200000-0000-4000-8000-000000000004'$$,'ordinary author edits remain allowed');
select lives_ok($$update public.messages set read=true where chat_id='a8200000-0000-4000-8000-000000000001'$$,'posting restrictions preserve read receipts');
select lives_ok($$select public.toggle_message_reaction((select id from public.messages where chat_id='a8200000-0000-4000-8000-000000000001'),'👍')$$,'posting restrictions preserve reaction RPC');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values('chat-attachments','a8200000-0000-4000-8000-000000000003/a8100000-0000-4000-8000-000000000002/msg_a8400000-0000-4000-8000-000000000002.jpg',auth.uid()::text)$$,'42501',null,'restricted media upload is denied');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values('chat-attachments','a8200000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000002/msg_a8400000-0000-4000-8000-000000000003.jpg',auth.uid()::text)$$,'42501',null,'subscriber cannot upload channel attachments');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('chat-attachments','a8200000-0000-4000-8000-000000000004/a8100000-0000-4000-8000-000000000002/msg_a8400000-0000-4000-8000-000000000004.jpg',auth.uid()::text)$$,'ordinary attachment upload remains allowed');
select results_eq($$update storage.objects set metadata='{"bypass":true}' where name='a8200000-0000-4000-8000-000000000003/a8100000-0000-4000-8000-000000000002/msg_a8400000-0000-4000-8000-000000000001.jpg' returning name$$,array[]::text[],'existing attachment cannot be overwritten after media is disabled');

reset role;
update private.e2ee_runtime_config set activation_enabled=true;
set local role authenticated;
select throws_ok($$select public.activate_e2ee_conversation('a8200000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),0,'a8300000-0000-4000-8000-000000000002',decode(repeat('01',32),'hex'),digest(decode(repeat('01',32),'hex'),'sha256'))$$,'42501','Only chat administrators can activate E2EE v2','member cannot activate even when rollout is enabled');
select set_config('request.jwt.claims','{"sub":"a8100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000001',true);
select lives_ok($$insert into public.messages(chat_id,sender_id,text,media) values('a8200000-0000-4000-8000-000000000001',auth.uid(),'admin channel','test.jpg'),('a8200000-0000-4000-8000-000000000002',auth.uid(),'admin group',null),('a8200000-0000-4000-8000-000000000003',auth.uid(),'owner media','test.jpg')$$,'administrator and owner posting exceptions remain allowed');
select throws_ok($$select public.activate_e2ee_conversation('a8200000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),0,'a8300000-0000-4000-8000-000000000002',decode(repeat('01',32),'hex'),digest(decode(repeat('01',32),'hex'),'sha256'))$$,'42501','An active owned device is required','owner cannot borrow another device');
select throws_ok($$select public.activate_e2ee_conversation('a8200000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),0,'a8300000-0000-4000-8000-000000000001',decode(repeat('01',32),'hex'),decode(repeat('00',32),'hex'))$$,'22023','E2EE payload hash mismatch','invalid commit is rejected atomically');
select is((select count(*) from public.e2ee_conversations where chat_id='a8200000-0000-4000-8000-000000000001'),0::bigint,'failed commit leaves no activation row');
select lives_ok($$select public.activate_e2ee_conversation('a8200000-0000-4000-8000-000000000001',decode(repeat('aa',32),'hex'),0,'a8300000-0000-4000-8000-000000000001',decode(repeat('01',32),'hex'),digest(decode(repeat('01',32),'hex'),'sha256'))$$,'authorized activation with complete commit succeeds');
select is((select count(*) from public.e2ee_handshake_events where chat_id='a8200000-0000-4000-8000-000000000001'),1::bigint,'successful activation includes initial commit');
select lives_ok($$insert into public.messages(chat_id,sender_id,text) values('a8200000-0000-4000-8000-000000000004',auth.uid(),'legacy still works')$$,'unactivated legacy chats remain usable');

select set_config('request.jwt.claims','{"sub":"a8100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000003',true);
select lives_ok($$insert into public.chats(id,name,type,created_by,created_at) values('a8500000-0000-4000-8000-000000000001','Backdated','group',auth.uid(),'2000-01-01')$$,'ordinary chat creation remains allowed');
select ok((select created_at >= statement_timestamp()-interval '1 minute' from public.chats where id='a8500000-0000-4000-8000-000000000001'),'server replaces attacker-supplied creation timestamp');
select throws_ok($$update public.chats set created_at='2000-01-01' where id='a8500000-0000-4000-8000-000000000001'$$,'42501',null,'timestamp remains immutable after creation');
delete from public.chats where id='a8500000-0000-4000-8000-000000000001';
do $$declare i integer; chat uuid; begin
 for i in 1..19 loop
  chat:=gen_random_uuid();
  insert into public.chats(id,name,type,created_by,created_at) values(chat,'Quota','group',auth.uid(),'2000-01-01');
  delete from public.chats where id=chat;
 end loop;
end$$;
select throws_ok($$insert into public.chats(name,type,created_by,created_at) values('Over limit','group',auth.uid(),'2000-01-01')$$,'P0001','Chat creation rate limit exceeded','backdating and deleting chats cannot reset the quota');
select throws_ok($$delete from private.chat_creation_events$$,'42501',null,'client cannot clear quota accounting');
reset role;
select is((select count(*) from private.chat_creation_events where actor='a8100000-0000-4000-8000-000000000003'),20::bigint,'successful creations remain counted after deletion');
select * from finish();
rollback;

-- Reproduce a hosted upgrade missing September's bindings. All fixture rows
-- and DDL are rolled back; the real migration must restore enforcement.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

drop trigger if exists before_chat_creation_limit_hardening on public.chats;
drop trigger if exists before_e2ee_handshake_validation on public.e2ee_handshake_events;
drop trigger if exists before_e2ee_welcome_validation on public.e2ee_welcomes;
drop function if exists public.validate_e2ee_v2_event();
\ir ../migrations/20261031055057_restore_security_remediation_dependencies.sql

insert into public.profiles(id,username) values
 ('a9100000-0000-4000-8000-000000000001','dependency_owner'),
 ('a9100000-0000-4000-8000-000000000002','dependency_member'),
 ('a9100000-0000-4000-8000-000000000003','dependency_outsider'),
 ('a9100000-0000-4000-8000-000000000004','dependency_quota');
insert into public.chats(id,name,type,created_by) values
 ('a9200000-0000-4000-8000-000000000001','Dependency fixture','personal','a9100000-0000-4000-8000-000000000001');
insert into public.chat_members(chat_id,profile_id,role) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','admin'),
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000002','member');
insert into public.user_devices(id,user_id,device_name,credential,certificate,certificate_signature,status,approved_at,revoked_at)
 select id,owner_id,'Dependency device',decode(repeat('01',32),'hex'),decode(repeat('02',32),'hex'),decode(repeat('03',64),'hex'),status,now(),case when status='revoked' then now() else null end
 from (values
  ('a9300000-0000-4000-8000-000000000001'::uuid,'a9100000-0000-4000-8000-000000000001'::uuid,'active'),
  ('a9300000-0000-4000-8000-000000000002'::uuid,'a9100000-0000-4000-8000-000000000002'::uuid,'active'),
  ('a9300000-0000-4000-8000-000000000003'::uuid,'a9100000-0000-4000-8000-000000000003'::uuid,'active'),
  ('a9300000-0000-4000-8000-000000000004'::uuid,'a9100000-0000-4000-8000-000000000002'::uuid,'revoked')
 ) devices(id,owner_id,status);
insert into public.e2ee_conversations(chat_id,mls_group_id,activation_epoch,created_by) values
 ('a9200000-0000-4000-8000-000000000001',decode(repeat('91',32),'hex'),2,'a9100000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a9100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a9100000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into public.e2ee_handshake_events(chat_id,epoch,sender_device_id,event_type,encrypted_payload,payload_hash) values('a9200000-0000-4000-8000-000000000001',2,'a9300000-0000-4000-8000-000000000001','commit',decode(repeat('01',32),'hex'),decode(repeat('00',32),'hex'))$$,'22023','E2EE payload hash mismatch','restored trigger rejects a direct handshake with an invalid hash');
select throws_ok($$insert into public.e2ee_handshake_events(chat_id,epoch,sender_device_id,event_type,encrypted_payload,payload_hash) values('a9200000-0000-4000-8000-000000000001',1,'a9300000-0000-4000-8000-000000000001','commit',decode(repeat('01',32),'hex'),digest(decode(repeat('01',32),'hex'),'sha256'))$$,'40001','E2EE event epoch is stale','restored trigger rejects stale epochs');
select lives_ok($$insert into public.e2ee_handshake_events(chat_id,epoch,sender_device_id,event_type,encrypted_payload,payload_hash) values('a9200000-0000-4000-8000-000000000001',2,'a9300000-0000-4000-8000-000000000001','commit',decode(repeat('01',32),'hex'),digest(decode(repeat('01',32),'hex'),'sha256'))$$,'valid owned handshake remains allowed');
select lives_ok($$insert into public.e2ee_welcomes(chat_id,epoch,sender_device_id,recipient_device_id,encrypted_payload) values('a9200000-0000-4000-8000-000000000001',2,'a9300000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000002',decode(repeat('01',32),'hex'))$$,'welcome to another member remains allowed');
select throws_ok($$insert into public.e2ee_welcomes(chat_id,epoch,sender_device_id,recipient_device_id,encrypted_payload) values('a9200000-0000-4000-8000-000000000001',2,'a9300000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000003',decode(repeat('01',32),'hex'))$$,'42501',null,'nonmember welcome recipient is rejected');
select throws_ok($$insert into public.e2ee_welcomes(chat_id,epoch,sender_device_id,recipient_device_id,encrypted_payload) values('a9200000-0000-4000-8000-000000000001',2,'a9300000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000004',decode(repeat('01',32),'hex'))$$,'42501',null,'revoked welcome recipient is rejected');

select set_config('request.jwt.claims','{"sub":"a9100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a9100000-0000-4000-8000-000000000004',true);
select lives_ok($$select public.create_managed_chat('Dependency group','group')$$,'managed chat creation works after restoring the quota binding');
select is(public.ensure_personal_chat('a9100000-0000-4000-8000-000000000001'),public.ensure_personal_chat('a9100000-0000-4000-8000-000000000001'),'personal chat creation works and reopening reuses the chat');
select is(public.ensure_saved_messages_chat(),public.ensure_saved_messages_chat(),'Saved creation works and reopening reuses the chat');
reset role;
select is((select count(*) from private.chat_creation_events where actor='a9100000-0000-4000-8000-000000000004'),3::bigint,'all three creation RPCs are counted exactly once');
set local role authenticated;
do $$ declare i integer; chat uuid; begin
 for i in 1..17 loop
  insert into public.chats(name,type,created_by,created_at) values('Dependency quota','group',auth.uid(),'2000-01-01') returning id into chat;
  delete from public.chats where id=chat;
 end loop;
end $$;
select throws_ok($$select public.create_managed_chat('Over quota','channel')$$,'P0001','Chat creation rate limit exceeded','managed creation cannot bypass a quota filled by deleted backdated chats');
select throws_ok($$select public.ensure_personal_chat('a9100000-0000-4000-8000-000000000002')$$,'P0001','Chat creation rate limit exceeded','security-definer personal creation cannot bypass the quota');
select lives_ok($$select public.ensure_personal_chat('a9100000-0000-4000-8000-000000000001')$$,'existing personal chat still opens at the quota');
select lives_ok($$select public.ensure_saved_messages_chat()$$,'existing Saved still opens at the quota');
reset role;
select is((select count(*) from private.chat_creation_events where actor='a9100000-0000-4000-8000-000000000004'),20::bigint,'reopening and failed attempts do not create quota events');
select * from finish();
rollback;

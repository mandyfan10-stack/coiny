begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into public.profiles(id,username) values
 ('ac100000-0000-4000-8000-000000000001','forward_owner'),
 ('ac100000-0000-4000-8000-000000000002','forward_outsider');
insert into public.chats(id,name,type,created_by) values
 ('ac200000-0000-4000-8000-000000000001','Forward destination','group','ac100000-0000-4000-8000-000000000001');
insert into public.chat_members(chat_id,profile_id,role) values
 ('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','admin');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000001/forward_ac300000-0000-4000-8000-000000000001.png',auth.uid()::text)$$,'42501',null,'former forward_ filename is rejected by the real policy');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000001/msg_ac300000-0000-4000-8000-000000000001.png',auth.uid()::text),
 ('chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000001/msg_ac300000-0000-4000-8000-000000000002.mp4',auth.uid()::text),
 ('chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000001/msg_ac300000-0000-4000-8000-000000000003.ogg',auth.uid()::text)$$,'forwarded image, video and voice names satisfy the real upload policy');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id)
 select 'chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000001/msg_' || gen_random_uuid() || '.' || ext, auth.uid()::text
 from (values('avif'),('aac'),('flac'),('ogv')) formats(ext)$$,'all additional accepted formats can be uploaded');
select lives_ok($$update storage.objects set name=replace(name,'.avif','.aac') where bucket_id='chat-attachments' and name like 'ac200000-%/%.avif'$$,'existing owned files can be replaced using an accepted format');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000001/msg_ac300000-0000-4000-8000-000000000099.exe',auth.uid()::text)$$,'42501',null,'unsupported executable extension stays rejected');
select set_config('request.jwt.claims','{"sub":"ac100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000002',true);
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-attachments','ac200000-0000-4000-8000-000000000001/ac100000-0000-4000-8000-000000000002/msg_ac300000-0000-4000-8000-000000000004.png',auth.uid()::text)$$,'42501',null,'allowed filename does not grant an outsider access to the destination');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

insert into public.profiles(id,username,display_name) values
 ('a7100000-0000-4000-8000-000000000001','storage_owner','Owner'),
 ('a7100000-0000-4000-8000-000000000002','storage_peer','Peer'),
 ('a7100000-0000-4000-8000-000000000003','storage_outsider','Outsider');
insert into public.chats(id,name,type,created_by) values
 ('a7200000-0000-4000-8000-000000000001','Private','group','a7100000-0000-4000-8000-000000000001'),
 ('a7200000-0000-4000-8000-000000000002','Unrelated','group','a7100000-0000-4000-8000-000000000003'),
 -- A client-supplied chat id must not authorize legacy user-folder reads.
 ('a7100000-0000-4000-8000-000000000001','Same UUID','group','a7100000-0000-4000-8000-000000000003');
insert into public.chat_members(chat_id,profile_id,role) values
 ('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','admin'),
 ('a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002','member'),
 ('a7200000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000003','admin'),
 ('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000003','admin');
insert into storage.objects(bucket_id,name,owner_id) values
 ('chat-attachments','a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000001/msg_a7300000-0000-4000-8000-000000000001.jpg','a7100000-0000-4000-8000-000000000001'),
 ('chat-attachments','a7100000-0000-4000-8000-000000000001/legacy.jpg','a7100000-0000-4000-8000-000000000001'),
 ('chat-attachments','a7100000-0000-4000-8000-000000000001/unreferenced.jpg','a7100000-0000-4000-8000-000000000001'),
 ('chat-attachments','a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000003/msg_a7300000-0000-4000-8000-000000000005.jpg','a7100000-0000-4000-8000-000000000001'),
 ('chat-attachments','a7100000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000003/msg_a7300000-0000-4000-8000-000000000006.jpg','a7100000-0000-4000-8000-000000000001'),
 ('avatars','a7100000-0000-4000-8000-000000000001/avatar_test.webp','a7100000-0000-4000-8000-000000000001'),
 ('banners','a7100000-0000-4000-8000-000000000001/banner_test.webp','a7100000-0000-4000-8000-000000000001');
insert into public.messages(id,chat_id,sender_id,text,media) values
 ('a7300000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','legacy','storage://chat-attachments/a7100000-0000-4000-8000-000000000001/legacy.jpg');

select ok(not has_function_privilege('anon','public.resolve_username_auth_email(text)','execute'),'anonymous email lookup is revoked');
select ok(not has_function_privilege('authenticated','public.resolve_username_auth_email(text)','execute'),'signed-in email lookup is revoked');
set local role anon;
select throws_ok($$select public.resolve_username_auth_email('storage_owner')$$,'42501',null,'anonymous RPC is denied before reading account data');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000003',true);
select is((select count(*) from storage.objects where bucket_id='chat-attachments'),0::bigint,'outsider cannot read modern or legacy attachments, including nested legacy chat/user UUID collision');
select lives_ok($$update public.profiles set avatar='storage://chat-attachments/a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000001/msg_a7300000-0000-4000-8000-000000000001.jpg' where id=auth.uid()$$,'mutable avatar value is not used as an authorization grant');
select is((select count(*) from storage.objects where bucket_id='chat-attachments'),0::bigint,'pointing own avatar at a foreign object grants no access');
update public.profiles set avatar='storage://chat-attachments/a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000003/msg_a7300000-0000-4000-8000-000000000005.jpg' where id=auth.uid();
select is((select count(*) from storage.objects where bucket_id='chat-attachments'),0::bigint,'matching path segment without real Storage ownership grants no avatar access');
insert into public.messages(id,chat_id,sender_id,text,media) values
 ('a7300000-0000-4000-8000-000000000002','a7200000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000003','forged modern','storage://chat-attachments/a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000001/msg_a7300000-0000-4000-8000-000000000001.jpg'),
 ('a7300000-0000-4000-8000-000000000003','a7200000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000003','forged legacy','storage://chat-attachments/a7100000-0000-4000-8000-000000000001/legacy.jpg');
select is((select count(*) from storage.objects where bucket_id='chat-attachments'),0::bigint,'copying a foreign path into own messages grants no access');
insert into public.stories(user_id,media) values
 ('a7100000-0000-4000-8000-000000000003','storage://chat-attachments/a7100000-0000-4000-8000-000000000001/legacy.jpg');
select is((select count(*) from storage.objects where bucket_id='chat-attachments'),0::bigint,'copying a foreign path into own story grants no access');
select is((select count(*) from storage.objects where bucket_id='avatars' and name like 'a7100000-%'),1::bigint,'dedicated avatar bucket remains readable');
select is((select count(*) from storage.objects where bucket_id='banners' and name like 'a7100000-%'),1::bigint,'dedicated banner bucket remains readable');
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000002',true);
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name like 'a7200000-%'),1::bigint,'chat member can read authentic modern attachment');
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name='a7100000-0000-4000-8000-000000000001/legacy.jpg'),1::bigint,'recipient can read authentic legacy message attachment');
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name='a7100000-0000-4000-8000-000000000001/unreferenced.jpg'),0::bigint,'chat membership does not expose unrelated sender legacy files');
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000001',true);
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and cardinality(storage.foldername(name))=1 and name like 'a7100000-%'),2::bigint,'uploader retains own legacy access');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('chat-attachments','a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000001/msg_a7300000-0000-4000-8000-000000000004.jpg',auth.uid()::text)$$,'ordinary modern member uploads remain permitted');
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name like 'a7200000-%'),2::bigint,'fresh upload remains readable');
update public.profiles set avatar='storage://chat-attachments/a7100000-0000-4000-8000-000000000001/legacy.jpg' where id=auth.uid();
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000003',true);
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name='a7100000-0000-4000-8000-000000000001/legacy.jpg'),1::bigint,'authentic owner-published legacy avatar remains visible');
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name='a7100000-0000-4000-8000-000000000001/unreferenced.jpg'),0::bigint,'publishing one legacy avatar does not expose other private uploads');
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000001',true);
update public.profiles set avatar='storage://chat-attachments/a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000001/msg_a7300000-0000-4000-8000-000000000001.jpg' where id=auth.uid();
select set_config('request.jwt.claims','{"sub":"a7100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','a7100000-0000-4000-8000-000000000003',true);
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name='a7200000-0000-4000-8000-000000000001/a7100000-0000-4000-8000-000000000001/msg_a7300000-0000-4000-8000-000000000001.jpg'),1::bigint,'authentic owner-published modern avatar remains visible');
select is((select count(*) from storage.objects where bucket_id='chat-attachments' and name='a7100000-0000-4000-8000-000000000001/legacy.jpg'),0::bigint,'replacing avatar revokes the old public avatar reference');
reset role;
select ok((select relrowsecurity from pg_class where oid='storage.objects'::regclass),'storage RLS remains enabled');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local storage.allow_delete_query = 'true';
select no_plan();

insert into public.profiles(id,username) values ('ad100000-0000-4000-8000-000000000001','attachment_quota_owner');
insert into public.chats(id,name,type,created_by) values ('ad200000-0000-4000-8000-000000000001','quota','group','ad100000-0000-4000-8000-000000000001');
insert into public.chat_members(chat_id,profile_id,role) values ('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','admin');
select ok((select relrowsecurity from pg_class where oid='private.attachment_upload_events'::regclass),'events have RLS');
select ok(not has_table_privilege('authenticated','private.attachment_upload_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'clients cannot access events');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ad100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000001',true);
select lives_ok($$do $b$ begin for i in 1..200 loop
  insert into storage.objects(bucket_id,name,owner_id,version) values ('chat-attachments',
    'ad200000-0000-4000-8000-000000000001/ad100000-0000-4000-8000-000000000001/msg_' || gen_random_uuid() || '.png',auth.uid()::text,gen_random_uuid()::text);
  delete from storage.objects where bucket_id='chat-attachments' and (storage.foldername(name))[2]=auth.uid()::text;
end loop; end $b$;$$,'200 successful uploads and deletions remain allowed');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,version) values ('chat-attachments','ad200000-0000-4000-8000-000000000001/ad100000-0000-4000-8000-000000000001/msg_ad300000-0000-4000-8000-000000000001.png',auth.uid()::text,'v1')$$,'P0001','Attachment upload quota exceeded','deleting files cannot reset quota');
reset role;
select is((select count(*) from private.attachment_upload_events where actor='ad100000-0000-4000-8000-000000000001'),200::bigint,'accepted uploads survive deletion');
delete from private.attachment_upload_events;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.sub','',true);

-- Storage completes a user upload with service credentials and a trusted owner.
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,version) values ('chat-attachments','ad200000-0000-4000-8000-000000000001/ad100000-0000-4000-8000-000000000001/msg_ad300000-0000-4000-8000-000000000001.png','ad100000-0000-4000-8000-000000000001','v1')$$,'service completion is counted');
update storage.objects set metadata='{"size":1}' where name like '%msg_ad300000-0000-4000-8000-000000000001.png';
select is((select count(*) from private.attachment_upload_events),1::bigint,'metadata update consumes no slot');
update storage.objects set version='v2' where name like '%msg_ad300000-0000-4000-8000-000000000001.png';
select is((select count(*) from private.attachment_upload_events),2::bigint,'replacement consumes a slot');
update storage.objects set version='v3',name=replace(name,'ad300000-0000-4000-8000-000000000001','ad300000-0000-4000-8000-000000000002') where name like '%msg_ad300000-0000-4000-8000-000000000001.png';
select is((select count(*) from private.attachment_upload_events),2::bigint,'moving an object within the bucket consumes no slot');
select * from finish();
rollback;

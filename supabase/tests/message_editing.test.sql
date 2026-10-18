begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);
insert into public.profiles(id,username,display_name) values
 ('91000000-0000-4000-8000-000000000001','edit_author','Author'),
 ('91000000-0000-4000-8000-000000000002','edit_peer','Peer'),
 ('91000000-0000-4000-8000-000000000003','edit_outsider','Outsider');
insert into public.chats(id,name,type,created_by) values
 ('92000000-0000-4000-8000-000000000001','Edit test','group','91000000-0000-4000-8000-000000000001');
insert into public.chat_members(chat_id,profile_id,role) values
 ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','admin'),
 ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','member');
insert into public.messages(id,chat_id,sender_id,text,created_at,forwarded_from) values
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','before','2026-10-18T10:00:00Z','e2ee:aes-gcm:encrypted-origin:iv');
select ok(not has_function_privilege('anon','public.edit_message_text(uuid,text,text,timestamptz)','execute'),'anonymous cannot edit');
select ok(has_function_privilege('authenticated','public.edit_message_text(uuid,text,text,timestamptz)','execute'),'authenticated can call edit RPC');
select ok(not has_column_privilege('authenticated','public.messages','edited_at','update'),'clients cannot forge edit time');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.edit_message_text('93000000-0000-4000-8000-000000000001','after','before',null)$$,'author can edit own text');
select is((select text from public.messages where id='93000000-0000-4000-8000-000000000001'),'after','updated text is stored');
select is((select forwarded_from from public.messages where id='93000000-0000-4000-8000-000000000001'),'e2ee:aes-gcm:encrypted-origin:iv','edit preserves encrypted forward attribution');
select ok((select edited_at is not null from public.messages where id='93000000-0000-4000-8000-000000000001'),'server stamps edit time');
select is((select created_at from public.messages where id='93000000-0000-4000-8000-000000000001'),'2026-10-18T10:00:00Z'::timestamptz,'edit preserves message order');
select is(public.edit_message_text('93000000-0000-4000-8000-000000000001','stale','after',null),null::jsonb,'stale editor cannot overwrite a newer edit');
select set_config('test.edit_time',(select edited_at::text from public.messages where id='93000000-0000-4000-8000-000000000001'),true);
select is(public.edit_message_text('93000000-0000-4000-8000-000000000001','stale','wrong',current_setting('test.edit_time')::timestamptz),null::jsonb,'expected wire text is checked too');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select is(public.edit_message_text('93000000-0000-4000-8000-000000000001','forged','after',current_setting('test.edit_time')::timestamptz),null::jsonb,'another member cannot edit through RPC');
select throws_ok($$update public.messages set text='forged' where id='93000000-0000-4000-8000-000000000001'$$,'42501',null,'another member cannot bypass RPC through direct update');
select lives_ok($$update public.messages set read=true where id='93000000-0000-4000-8000-000000000001'$$,'existing read updates remain available');
select is((select edited_at from public.messages where id='93000000-0000-4000-8000-000000000001'),current_setting('test.edit_time')::timestamptz,'read receipt does not mark message edited');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select is(public.edit_message_text('93000000-0000-4000-8000-000000000001','forged','after',current_setting('test.edit_time')::timestamptz),null::jsonb,'outsider cannot edit');
select is((select count(*) from public.messages where id='93000000-0000-4000-8000-000000000001'),0::bigint,'outsider cannot read edited text');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.edit_message_text('93000000-0000-4000-8000-000000000001',' ','after',current_setting('test.edit_time')::timestamptz)$$,'22023',null,'empty edit rejected');
select is((select text from public.messages where id='93000000-0000-4000-8000-000000000001'),'after','failed edits preserve original text');
select * from finish();
rollback;

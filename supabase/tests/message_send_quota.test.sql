begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.profiles(id,username) values
 ('ab100000-0000-4000-8000-000000000001','quota_sender'),
 ('ab100000-0000-4000-8000-000000000002','quota_peer');
insert into public.chats(id,name,type,created_by) values
 ('ab200000-0000-4000-8000-000000000001','Quota one','group','ab100000-0000-4000-8000-000000000001'),
 ('ab200000-0000-4000-8000-000000000002','Quota two','group','ab100000-0000-4000-8000-000000000001');
insert into public.chat_members(chat_id,profile_id,role)
 select id,'ab100000-0000-4000-8000-000000000001','admin' from public.chats where id::text like 'ab200000-%';

select is((select count(*) from pg_trigger where tgrelid='public.messages'::regclass and tgenabled='O'
 and ((tgname='before_message_rate_limit' and tgtype=7)
 or (tgname='after_message_send_accounting' and tgtype=5))),2::bigint,'both enabled row INSERT guards have the intended timing');
select ok((select relrowsecurity from pg_class where oid='private.message_send_events'::regclass),'quota events have RLS');
select ok(not has_table_privilege('authenticated','private.message_send_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'clients cannot access quota events');
select ok(not has_function_privilege('authenticated','private.record_message_send()','EXECUTE'),'clients cannot call accounting directly');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ab100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','ab100000-0000-4000-8000-000000000001',true);
select lives_ok($$do $body$ begin
 for i in 1..25 loop
  insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000001',auth.uid(),'delete cycle');
  delete from public.messages where chat_id='ab200000-0000-4000-8000-000000000001';
 end loop;
end $body$; $$,'first 25 sends and author deletes remain allowed');
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000002',auth.uid(),'26th')$$,'P0001','Message rate limit exceeded','deleting messages or changing chats cannot reset the short window');
reset role;
select is((select count(*) from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001'),25::bigint,'deleted sends retain their quota events');

-- A full statement and all its accounting roll back together.
delete from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001';
insert into private.message_send_events(actor) select 'ab100000-0000-4000-8000-000000000001' from generate_series(1,24);
set local role authenticated;
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values
 ('ab200000-0000-4000-8000-000000000001',auth.uid(),'bulk one'),
 ('ab200000-0000-4000-8000-000000000001',auth.uid(),'bulk two')$$,'P0001','Message rate limit exceeded','bulk insert crossing the cap fails atomically');
select is((select count(*) from public.messages where chat_id='ab200000-0000-4000-8000-000000000001'),0::bigint,'failed bulk leaves no messages');
select lives_ok($$insert into public.messages(id,chat_id,sender_id,text) values('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',auth.uid(),'last slot')$$,'one remaining slot remains usable');
select throws_ok($$insert into public.messages(id,chat_id,sender_id,text) values('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',auth.uid(),'retry')$$,'23505',null,'duplicate retry keeps its recoverable conflict at the cap');
select lives_ok($$insert into public.messages(id,chat_id,sender_id,text) values('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001',auth.uid(),'retry') on conflict(id) do nothing$$,'ignored duplicate succeeds at the cap');
select lives_ok($$update public.messages set text='edited',read=true where id='ab300000-0000-4000-8000-000000000001'$$,'legitimate edit and read remain available at the cap');
select lives_ok($$select public.toggle_message_reaction('ab300000-0000-4000-8000-000000000001','👍')$$,'reaction remains available at the cap');
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000001','ab100000-0000-4000-8000-000000000002','forged sender')$$,'42501','Message sender must match the authenticated user','sender identity check retains its error before quota accounting');
reset role;
select is((select count(*) from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001'),25::bigint,'conflicts, edits, reactions and failed sends consume no events');

-- Long window, cleanup and successful transaction rollback.
delete from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001';
insert into private.message_send_events(actor,created_at)
 select 'ab100000-0000-4000-8000-000000000001',clock_timestamp()-interval '20 seconds' from generate_series(1,299);
insert into private.message_send_events(actor,created_at) values('ab100000-0000-4000-8000-000000000001',clock_timestamp()-interval '6 minutes');
set local role authenticated;
select lives_ok($$insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000002',auth.uid(),'300th')$$,'last long-window slot is usable');
delete from public.messages where chat_id in ('ab200000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000002');
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000002',auth.uid(),'301st')$$,'P0001','Message rate limit exceeded','long window survives author deletion');
reset role;
select is((select count(*) from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001'),300::bigint,'expired events are cleaned and 300 accepted sends remain');
delete from public.chats where id='ab200000-0000-4000-8000-000000000001';
select is((select count(*) from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001'),300::bigint,'chat cascade cannot erase usage');
delete from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$do $body$ begin
 begin
  insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000002',auth.uid(),'rolled back');
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
end $body$; $$,'an explicitly rolled-back send does not commit');
select throws_ok($$insert into public.messages(chat_id,sender_id,text) values('ab200000-0000-4000-8000-000000000002',auth.uid(),repeat('x',65537))$$,'23514',null,'invalid payload still fails before accounting');
reset role;
select is((select count(*) from private.message_send_events where actor='ab100000-0000-4000-8000-000000000001'),0::bigint,'rollback and invalid payload leave no usage');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

insert into public.profiles(id,username,display_name) values
 ('bb100000-0000-4000-8000-000000000001','push_sender_test','Sender'),
 ('bb100000-0000-4000-8000-000000000002','push_recipient_test','Recipient'),
 ('bb100000-0000-4000-8000-000000000003','push_outsider_test','Outsider');
insert into public.chats(id,name,type,created_by) values
 ('bb200000-0000-4000-8000-000000000001','Push test','group','bb100000-0000-4000-8000-000000000001');
insert into public.chat_members(chat_id,profile_id,role,notifications) values
 ('bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','member',true),
 ('bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000002','member',true);
insert into public.messages(id,chat_id,sender_id,text) values
 ('bb300000-0000-4000-8000-000000000001','bb200000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000001','test message');

select ok(not has_function_privilege('anon','public.register_web_push_subscription(text,text,text)','execute'),'anonymous users cannot register subscriptions');
select ok(not has_function_privilege('authenticated','public.get_message_push_recipients(uuid,uuid)','execute'),'clients cannot enumerate recipient endpoints');
select ok(not has_table_privilege('authenticated','private.web_push_subscriptions','select'),'subscription credentials are private');
select ok((select relrowsecurity from pg_class where oid='private.web_push_subscriptions'::regclass),'subscription table has RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub','bb100000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/bob',repeat('A',87),repeat('B',22))$$,'authenticated recipient registers a device');
select lives_ok($$select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/bob',repeat('C',87),repeat('D',22))$$,'same account refreshes its device');
select throws_ok($$select public.register_web_push_subscription('https://127.0.0.1/private',repeat('A',87),repeat('B',22))$$,'22023','Invalid push subscription','private network endpoints are rejected');
select throws_ok($$select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/bad','bad','bad')$$,'22023','Invalid push subscription','malformed subscription keys are rejected');

select set_config('request.jwt.claim.sub','bb100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/bob',repeat('A',87),repeat('B',22))$$,'42501','Subscription belongs to another account','another account cannot overwrite a device');
select public.remove_web_push_subscription('https://fcm.googleapis.com/fcm/send/bob');
reset role;
select is((select count(*)::int from private.web_push_subscriptions),1,'another account cannot delete the device');

set local role authenticated;
select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/sender',repeat('A',87),repeat('B',22));
select set_config('request.jwt.claim.sub','bb100000-0000-4000-8000-000000000003',true);
select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/outsider',repeat('A',87),repeat('B',22));
reset role;
select is((select count(*)::int from public.get_message_push_recipients('bb300000-0000-4000-8000-000000000001')),1,'delivery includes the recipient and excludes outsiders');
update public.chat_members set notifications=false where profile_id='bb100000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.get_message_push_recipients('bb300000-0000-4000-8000-000000000001')),0,'muting a chat prevents delivery');
update public.chat_members set notifications=true where profile_id='bb100000-0000-4000-8000-000000000002';
insert into public.message_reads(message_id,profile_id) values
 ('bb300000-0000-4000-8000-000000000001','bb100000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.get_message_push_recipients('bb300000-0000-4000-8000-000000000001')),0,'read messages are not pushed');
delete from public.message_reads where message_id='bb300000-0000-4000-8000-000000000001';
delete from public.chat_members where profile_id='bb100000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.get_message_push_recipients('bb300000-0000-4000-8000-000000000001')),0,'leaving a chat prevents delayed delivery');
set local role authenticated;
select set_config('request.jwt.claim.sub','bb100000-0000-4000-8000-000000000002',true);
select public.remove_web_push_subscription('https://fcm.googleapis.com/fcm/send/bob');
reset role;
select is((select count(*)::int from private.web_push_subscriptions where owner_id='bb100000-0000-4000-8000-000000000002'),0,'recipient can remove its own device');
set local role authenticated;
do $$begin
  for i in 1..10 loop
    perform public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/quota-' || i,repeat('A',87),repeat('B',22));
  end loop;
end;$$;
select throws_ok($$select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/over-quota',repeat('A',87),repeat('B',22))$$,'54000','Too many push subscriptions','device limit is enforced');
select lives_ok($$select public.register_web_push_subscription('https://fcm.googleapis.com/fcm/send/quota-1',repeat('C',87),repeat('D',22))$$,'an existing device can refresh at the limit');
reset role;
select * from finish();
rollback;

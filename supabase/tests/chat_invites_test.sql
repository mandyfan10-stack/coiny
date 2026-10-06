begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

insert into public.profiles (id, username, display_name) values
  ('11000000-0000-4000-8000-000000000001', 'invite_owner', 'Owner'),
  ('11000000-0000-4000-8000-000000000002', 'invite_admin', 'Admin'),
  ('11000000-0000-4000-8000-000000000003', 'invite_member', 'Member'),
  ('11000000-0000-4000-8000-000000000004', 'invite_guest', 'Guest'),
  ('11000000-0000-4000-8000-000000000005', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Hex username');
insert into public.chats (id, name, type, created_by, username, settings) values
  ('22000000-0000-4000-8000-000000000001', 'Private group', 'group', '11000000-0000-4000-8000-000000000001', null, '{}'),
  ('22000000-0000-4000-8000-000000000002', 'Public group', 'group', '11000000-0000-4000-8000-000000000001', 'invite_public', '{}'),
  ('22000000-0000-4000-8000-000000000003', 'Personal chat', 'personal', '11000000-0000-4000-8000-000000000001', null, '{}'),
  ('22000000-0000-4000-8000-000000000004', 'Open group', 'group', '11000000-0000-4000-8000-000000000001', 'invite_open_group', '{}');
insert into public.chat_members (chat_id, profile_id, role) values
  ('22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'admin'),
  ('22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'admin'),
  ('22000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'member');

select ok(not has_function_privilege('anon', 'public.resolve_username_auth_email(text)', 'execute'), 'anonymous users cannot resolve account emails');
select ok(not has_function_privilege('authenticated', 'public.resolve_username_auth_email(text)', 'execute'), 'authenticated users cannot resolve account emails');
select ok(not has_function_privilege('anon', 'public.create_chat_invite(uuid)', 'execute'), 'anonymous users cannot create invites');
select ok(not has_function_privilege('anon', 'public.join_chat_by_invite(text)', 'execute'), 'anonymous users cannot join via the RPC');
select ok(not has_table_privilege('authenticated', 'public.chat_invites', 'select'), 'clients cannot read hashed invite records');
select ok(not has_table_privilege('authenticated', 'public.chat_invites', 'insert'), 'clients cannot insert invite records directly');
select ok((select relrowsecurity from pg_class where oid = 'public.chat_invites'::regclass), 'invite records have RLS enabled');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.create_chat_invite('22000000-0000-4000-8000-000000000001')$$, '42501', 'Only group and channel chats can have invites', 'an outsider cannot generate an invite for a private group');
select throws_ok($$insert into public.chat_members(chat_id, profile_id, role) values
  ('22000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', 'admin')$$,
  '42501', 'new row violates row-level security policy for table "chat_members"', 'RLS rejects an unauthorized direct join');
-- Exercise the trigger separately, including writes made by a definer RPC.
-- Keep the guest JWT while bypassing RLS as the fixture administrator.
reset role;
insert into public.chat_members(chat_id, profile_id, role) values
  ('22000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', 'admin');
select is((select role from public.chat_members where chat_id = '22000000-0000-4000-8000-000000000004' and profile_id = '11000000-0000-4000-8000-000000000004'), 'member', 'a self-join through a definer write cannot manufacture admin privileges');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select public.create_chat_invite('22000000-0000-4000-8000-000000000001')$$, '42501', 'Only group and channel chats can have invites', 'ordinary members cannot generate private invites');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.create_chat_invite('22000000-0000-4000-8000-000000000003')$$, '42501', 'Only group and channel chats can have invites', 'a personal chat cannot have an invite');
select lives_ok($$select public.create_chat_invite('22000000-0000-4000-8000-000000000001')$$, 'the owner can generate an invite');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok($$select public.create_chat_invite('22000000-0000-4000-8000-000000000001')$$, 'a group admin can generate an invite');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('test.invite_token', public.create_chat_invite('22000000-0000-4000-8000-000000000001'), true);
select ok(current_setting('test.invite_token') ~ '^[0-9a-f]{48}$', 'tokens have 192 bits of random entropy');

reset role;
select is((select count(*) from public.chat_invites where token_hash = extensions.digest(current_setting('test.invite_token'), 'sha256')), 1::bigint, 'only the hash is stored for the token');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok($$select public.join_chat_by_invite('22000000-0000-4000-8000-000000000001')$$, '22023', 'Chat UUIDs are not invite links. Generate a new invite link.', 'knowledge of a chat UUID is not an invitation');
select is(public.join_chat_by_invite(current_setting('test.invite_token'))->>'status', 'joined', 'a valid token adds the guest');
select is(public.join_chat_by_invite(current_setting('test.invite_token'))->>'status', 'already_member', 'reusing the invite is idempotent for an existing member');
reset role;
select is((select uses from public.chat_invites where token_hash = extensions.digest(current_setting('test.invite_token'), 'sha256')), 1, 'an existing member does not consume another invite use');
select is((select role from public.chat_members where chat_id = '22000000-0000-4000-8000-000000000001' and profile_id = '11000000-0000-4000-8000-000000000004'), 'member', 'the invited guest has no admin privileges');

update public.chat_invites set expires_at = now() - interval '1 second' where token_hash = extensions.digest(current_setting('test.invite_token'), 'sha256');
set local role authenticated;
select throws_ok($$select public.join_chat_by_invite(current_setting('test.invite_token'))$$, '42501', 'Invite link expired or revoked', 'expired tokens are rejected');
reset role;
update public.chat_invites set expires_at = now() + interval '1 day', revoked_at = now() where token_hash = extensions.digest(current_setting('test.invite_token'), 'sha256');
set local role authenticated;
select throws_ok($$select public.join_chat_by_invite(current_setting('test.invite_token'))$$, '42501', 'Invite link expired or revoked', 'revoked tokens are rejected');
reset role;
update public.chat_invites set revoked_at = null, max_uses = 1 where token_hash = extensions.digest(current_setting('test.invite_token'), 'sha256');
set local role authenticated;
select throws_ok($$select public.join_chat_by_invite(current_setting('test.invite_token'))$$, '42501', 'Invite link expired or revoked', 'exhausted tokens are rejected');
select is(public.join_chat_by_invite('@INVITE_PUBLIC')->>'status', 'joined', 'public usernames remain discoverable without a token');
select throws_ok($$select public.join_chat_by_invite('')$$, '22023', 'Chat UUIDs are not invite links. Generate a new invite link.', 'empty identifiers are rejected');
select is(public.join_chat_by_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')->>'status', 'personal_created', 'a valid 32-character hexadecimal username is not mistaken for an invite token');

select * from finish();
rollback;

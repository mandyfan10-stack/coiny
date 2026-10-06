-- Security hardening pass: close privilege escalation, bearer-id invites,
-- unbounded user data and storage path confusion.

create extension if not exists pgcrypto with schema extensions;

-- Username login no longer needs to expose auth.users.email through a public
-- resolver. Keep the function only for backwards-compatible deployments, but
-- make it unreachable from the Data API.
revoke all on function public.resolve_username_auth_email(text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  username_val text := lower(btrim(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))));
  display_name_val text := btrim(coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
begin
  if username_val !~ '^[a-z0-9_]{3,32}$' then
    raise exception 'Username must contain 3-32 lowercase letters, numbers or underscores' using errcode = '22023';
  end if;
  if username_val in ('admin', 'administrator', 'support', 'moderator', 'system', 'root', 'null', 'undefined') then
    raise exception 'This username is reserved' using errcode = '23505';
  end if;
  if char_length(display_name_val) > 128 then
    raise exception 'Display name is too long' using errcode = '22001';
  end if;
  insert into public.profiles (id, username, display_name, avatar, avatar_color, bio)
  values (new.id, username_val, nullif(display_name_val, ''), '🪙',
    'linear-gradient(135deg, #12c2e9 0%, #c471ed 50%, #f64f59 100%)', '');
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- A member may never grant their own account admin privileges by inserting a
-- row directly. The managed chat creation RPC still creates the owner as admin.
create or replace function public.normalize_chat_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  owner_id uuid;
begin
  if actor is not null and new.profile_id = actor then
    select c.created_by into owner_id from public.chats c where c.id = new.chat_id;
    if owner_id is distinct from actor or (select c.type from public.chats c where c.id = new.chat_id) = 'personal' then
      new.role := 'member';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_chat_member_insert() from public, anon, authenticated;
drop trigger if exists before_chat_member_insert_hardening on public.chat_members;
create trigger before_chat_member_insert_hardening
  before insert on public.chat_members
  for each row execute function public.normalize_chat_member_insert();

create or replace function public.enforce_chat_creation_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); created_count integer;
begin
  if actor is null then return new; end if;
  if new.created_by is distinct from actor then
    raise exception 'Chat owner must match the authenticated user' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':chat-create', 0));
  select count(*) into created_count from public.chats
    where created_by = actor and created_at >= statement_timestamp() - interval '1 hour';
  if created_count >= 20 then
    raise exception 'Chat creation rate limit exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_chat_creation_limit() from public, anon, authenticated;
drop trigger if exists before_chat_creation_limit_hardening on public.chats;
create trigger before_chat_creation_limit_hardening
  before insert on public.chats for each row execute function public.enforce_chat_creation_limit();

-- Validate the size and shape of values accepted through broad Data API grants.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format
      check (username ~ '^[a-z0-9_]{3,32}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_text_size_limits') then
    alter table public.profiles add constraint profiles_text_size_limits
      check (char_length(coalesce(display_name, '')) <= 128
        and char_length(coalesce(bio, '')) <= 4000
        and octet_length(coalesce(avatar, '')) <= 1048576
        and octet_length(coalesce(public_key, '')) <= 16384) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chats_text_size_limits') then
    alter table public.chats add constraint chats_text_size_limits
      check (char_length(name) between 1 and 100
        and char_length(coalesce(bio, '')) <= 4000
        and octet_length(coalesce(avatar, '')) <= 1048576
        and octet_length(coalesce(settings::text, '')) <= 32768
        and (username is null or username ~ '^[a-z0-9_]{3,32}$')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stories_text_size_limits') then
    alter table public.stories add constraint stories_text_size_limits
      check (char_length(coalesce(caption, '')) <= 4096
        and octet_length(coalesce(media, '')) <= 8192
        and octet_length(coalesce(media_path, '')) <= 512) not valid;
  end if;
end $$;

-- Prevent a client from claiming another user's story path. The image service
-- writes paths as <user uuid>/story_<uuid>.webp.
create or replace function public.validate_story_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then return new; end if;
  if new.user_id is distinct from actor then
    raise exception 'Story owner must match the authenticated user' using errcode = '42501';
  end if;
  if new.media_path is not null and new.media_path !~ ('^' || actor::text || '/story_[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$') then
    raise exception 'Invalid story media path' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_story_insert() from public, anon, authenticated;
drop trigger if exists before_story_insert_hardening on public.stories;
create trigger before_story_insert_hardening
  before insert on public.stories
  for each row execute function public.validate_story_insert();

-- Invite tokens are random, expiring and stored only as hashes. Usernames
-- remain public discovery handles; chat UUIDs are no longer bearer invites.
create table if not exists public.chat_invites (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz
);
alter table public.chat_invites enable row level security;
revoke all on public.chat_invites from anon, authenticated;

create or replace function private.create_chat_invite(p_chat_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  token text := encode(extensions.gen_random_bytes(24), 'hex');
  chat_type text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select type into chat_type from public.chats c
  where c.id = p_chat_id and (c.created_by = actor or exists (
    select 1 from public.chat_members m where m.chat_id = c.id and m.profile_id = actor and m.role = 'admin'));
  if chat_type not in ('group', 'channel') then
    raise exception 'Only group and channel chats can have invites' using errcode = '42501';
  end if;
  insert into public.chat_invites(chat_id, token_hash, created_by)
  values (p_chat_id, extensions.digest(token, 'sha256'), actor);
  return token;
end;
$$;

create or replace function public.create_chat_invite(p_chat_id uuid)
returns text language sql volatile security invoker set search_path = ''
as $$ select private.create_chat_invite(p_chat_id); $$;
revoke all on function private.create_chat_invite(uuid), public.create_chat_invite(uuid) from public, anon;
grant execute on function private.create_chat_invite(uuid), public.create_chat_invite(uuid) to authenticated;

-- Replace the old UUID-or-username resolver. UUIDs are deliberately rejected;
-- only an expiring token or a public username can be used.
create or replace function private.join_chat_by_invite(p_invite text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  clean text := btrim(regexp_replace(coalesce(p_invite, ''), '^@+', ''));
  hash bytea;
  invite public.chat_invites%rowtype;
  chat public.chats%rowtype;
  profile public.profiles%rowtype;
  allow_add boolean;
  result_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if clean = '' or clean ~* '^[0-9a-f]{8}-[0-9a-f-]{27}$' then
    raise exception 'Chat UUIDs are not invite links. Generate a new invite link.' using errcode = '22023';
  end if;

  hash := extensions.digest(clean, 'sha256');
  select * into invite from public.chat_invites where token_hash = hash for update;
  if found then
    if invite.revoked_at is not null or invite.expires_at <= now() or (invite.max_uses is not null and invite.uses >= invite.max_uses) then
      raise exception 'Invite link expired or revoked' using errcode = '42501';
    end if;
    select * into chat from public.chats where id = invite.chat_id;
    if chat.type not in ('group', 'channel') then raise exception 'Invalid invite target' using errcode = '42501'; end if;
    if exists (select 1 from public.chat_members where chat_id = chat.id and profile_id = actor) then
      return jsonb_build_object('chat_id', chat.id, 'type', chat.type, 'name', chat.name, 'username', chat.username, 'status', 'already_member');
    end if;
    allow_add := coalesce((chat.settings ->> 'allow_add_members')::boolean, true);
    if chat.type = 'group' and not allow_add then raise exception 'Приглашения в данную группу отключены' using errcode = '42501'; end if;
    insert into public.chat_members(chat_id, profile_id, role) values (chat.id, actor, 'member');
    update public.chat_invites set uses = uses + 1 where id = invite.id;
    return jsonb_build_object('chat_id', chat.id, 'type', chat.type, 'name', chat.name, 'username', chat.username, 'status', 'joined');
  end if;

  if clean ~* '^[0-9a-f]{32,}$' then raise exception 'Invalid invite token' using errcode = 'P0002'; end if;
  select * into chat from public.chats where lower(username) = lower(clean) and type in ('group', 'channel');
  if found then
    if exists (select 1 from public.chat_members where chat_id = chat.id and profile_id = actor) then
      return jsonb_build_object('chat_id', chat.id, 'type', chat.type, 'name', chat.name, 'username', chat.username, 'status', 'already_member');
    end if;
    allow_add := coalesce((chat.settings ->> 'allow_add_members')::boolean, true);
    if chat.type = 'group' and not allow_add then raise exception 'Приглашения в данную группу отключены' using errcode = '42501'; end if;
    insert into public.chat_members(chat_id, profile_id, role) values (chat.id, actor, 'member');
    return jsonb_build_object('chat_id', chat.id, 'type', chat.type, 'name', chat.name, 'username', chat.username, 'status', 'joined');
  end if;
  select * into profile from public.profiles where lower(username) = lower(clean);
  if found then
    if profile.id = actor then
      result_id := public.ensure_saved_messages_chat();
      return jsonb_build_object('chat_id', result_id, 'type', 'saved', 'name', 'Избранное', 'status', 'self');
    end if;
    result_id := private.ensure_personal_chat(profile.id);
    return jsonb_build_object('chat_id', result_id, 'type', 'personal', 'name', coalesce(profile.display_name, profile.username), 'username', profile.username, 'status', 'personal_created');
  end if;
  raise exception 'Чат или профиль с никнеймом % не найден', clean using errcode = 'P0002';
end;
$$;

-- Keep the public wrapper and grants after replacing the private function.
revoke all on function private.join_chat_by_invite(text), public.join_chat_by_invite(text) from public, anon;
grant execute on function private.join_chat_by_invite(text), public.join_chat_by_invite(text) to authenticated;

-- Storage paths are scoped to the authenticated uploader and have bounded,
-- predictable names. Remove the old auth-uid-as-chat-id read shortcut.
drop policy if exists "Users upload their own chat attachments" on storage.objects;
create policy "Users upload their own chat attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and storage.filename(name) ~* '^(msg|record)_[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|mp4|webm|ogg|m4a|mp3|wav)$'
    and public.is_chat_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

drop policy if exists "Chat members read referenced attachments" on storage.objects;
create policy "Chat members read referenced attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_chat_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

drop policy if exists "Users update their own chat attachments" on storage.objects;
create policy "Users update their own chat attachments"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_chat_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  )
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and storage.filename(name) ~* '^(msg|record)_[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|mp4|webm|ogg|m4a|mp3|wav)$'
    and public.is_chat_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

drop policy if exists "Users delete their own chat attachments" on storage.objects;
create policy "Users delete their own chat attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create or replace function public.enforce_chat_attachment_quota()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recent_count integer;
  object_size bigint := coalesce((new.metadata ->> 'size')::bigint, 0);
begin
  if new.bucket_id <> 'chat-attachments' or actor is null then return new; end if;
  if object_size < 0 or object_size > 52428800 then
    raise exception 'Attachment is too large' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':attachment-upload', 0));
  select count(*) into recent_count from storage.objects
    where bucket_id = 'chat-attachments'
      and (storage.foldername(name))[2] = actor::text
      and created_at >= statement_timestamp() - interval '24 hours';
  if recent_count >= 200 then
    raise exception 'Attachment upload quota exceeded' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_chat_attachment_quota() from public, anon, authenticated;
drop trigger if exists before_chat_attachment_quota on storage.objects;
create trigger before_chat_attachment_quota
  before insert on storage.objects for each row execute function public.enforce_chat_attachment_quota();

drop policy if exists "Authenticated users read active story media" on storage.objects;
create policy "Authenticated users read active story media"
  on storage.objects for select to authenticated
  using (bucket_id = 'stories' and exists (
    select 1 from public.stories s
    where s.media_path = name and s.expires_at > now()
      and (storage.foldername(name))[1] = s.user_id::text
  ));

-- Serialize the per-user message window so concurrent inserts cannot bypass it.
create or replace function public.enforce_message_rate_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid()); short_window_count integer; long_window_count integer;
begin
  if actor is null then return new; end if;
  if new.sender_id is distinct from actor then raise exception 'Message sender must match the authenticated user' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select count(*) filter (where created_at >= statement_timestamp() - interval '10 seconds'), count(*) filter (where created_at >= statement_timestamp() - interval '5 minutes')
    into short_window_count, long_window_count from public.messages where sender_id = actor and created_at >= statement_timestamp() - interval '5 minutes';
  if short_window_count >= 25 or long_window_count >= 300 then raise exception 'Message rate limit exceeded' using errcode = 'P0001'; end if;
  return new;
end;
$$;

-- Bind E2EE v2 rows to authenticated devices, chat membership and their
-- payload hash. This prevents a member from injecting another user's device
-- identity or replaying an event into an older epoch.
create or replace function public.validate_e2ee_v2_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sender_user uuid;
  recipient_user uuid;
  activation bigint;
begin
  select user_id into sender_user from public.user_devices where id = new.sender_device_id and status = 'active';
  if actor is null then return new; end if;
  if sender_user is distinct from actor then
    raise exception 'Sender device does not belong to the authenticated user' using errcode = '42501';
  end if;
  if not private.is_chat_member(new.chat_id, actor) then
    raise exception 'Device owner is not a chat member' using errcode = '42501';
  end if;
  select activation_epoch into activation from public.e2ee_conversations where chat_id = new.chat_id;
  if new.epoch < coalesce(activation, 0) then
    raise exception 'E2EE event epoch is stale' using errcode = '40001';
  end if;
  if tg_table_name = 'e2ee_handshake_events' then
    if new.payload_hash is distinct from extensions.digest(new.encrypted_payload, 'sha256') then
      raise exception 'E2EE payload hash mismatch' using errcode = '22023';
    end if;
  else
    select user_id into recipient_user from public.user_devices where id = new.recipient_device_id and status <> 'revoked';
    if recipient_user is null or not private.is_chat_member(new.chat_id, recipient_user) then
      raise exception 'Welcome recipient is not a chat member' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_e2ee_v2_event() from public, anon, authenticated;
drop trigger if exists before_e2ee_handshake_validation on public.e2ee_handshake_events;
create trigger before_e2ee_handshake_validation before insert on public.e2ee_handshake_events for each row execute function public.validate_e2ee_v2_event();
drop trigger if exists before_e2ee_welcome_validation on public.e2ee_welcomes;
create trigger before_e2ee_welcome_validation before insert on public.e2ee_welcomes for each row execute function public.validate_e2ee_v2_event();

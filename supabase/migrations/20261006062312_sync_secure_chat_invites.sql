-- Restore the invite API expected by the client on both fresh and existing schemas.
-- This migration is self-contained so the hosted project need not replay its
-- divergent historical migration timestamps to receive the invite fix.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Password login must not expose the account email through the Data API.
revoke all on function public.resolve_username_auth_email(text) from public, anon, authenticated;

-- Keep direct self-joins from manufacturing the admin role checked by the invite RPC.
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
  if chat_type is null or chat_type not in ('group', 'channel') then
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
    insert into public.chat_members(chat_id, profile_id, role) values (chat.id, actor, 'member')
      on conflict (chat_id, profile_id) do nothing;
    if found then
      update public.chat_invites set uses = uses + 1 where id = invite.id;
    end if;
    return jsonb_build_object('chat_id', chat.id, 'type', chat.type, 'name', chat.name, 'username', chat.username, 'status', 'joined');
  end if;

  if clean ~* '^[0-9a-f]{48}$' then raise exception 'Invalid invite token' using errcode = 'P0002'; end if;
  select * into chat from public.chats where lower(username) = lower(clean) and type in ('group', 'channel');
  if found then
    if exists (select 1 from public.chat_members where chat_id = chat.id and profile_id = actor) then
      return jsonb_build_object('chat_id', chat.id, 'type', chat.type, 'name', chat.name, 'username', chat.username, 'status', 'already_member');
    end if;
    allow_add := coalesce((chat.settings ->> 'allow_add_members')::boolean, true);
    if chat.type = 'group' and not allow_add then raise exception 'Приглашения в данную группу отключены' using errcode = '42501'; end if;
    insert into public.chat_members(chat_id, profile_id, role) values (chat.id, actor, 'member')
      on conflict (chat_id, profile_id) do nothing;
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

-- The hosted schema may not yet contain the September join RPC.
create or replace function public.join_chat_by_invite(p_invite text)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.join_chat_by_invite(p_invite); $$;
revoke all on function private.join_chat_by_invite(text), public.join_chat_by_invite(text) from public, anon;
grant execute on function private.join_chat_by_invite(text), public.join_chat_by_invite(text) to authenticated;

create index if not exists chat_invites_chat_id_idx on public.chat_invites(chat_id);
create index if not exists chat_invites_created_by_idx on public.chat_invites(created_by);

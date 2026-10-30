begin;

-- Client build flags do not authorize a server-side protocol transition.
-- Keep the unfinished MLS rollout disabled until an operator enables it.
create table if not exists private.e2ee_runtime_config (
  singleton boolean primary key default true check (singleton),
  activation_enabled boolean not null default false
);
revoke all on private.e2ee_runtime_config from public, anon, authenticated;
insert into private.e2ee_runtime_config(singleton) values (true) on conflict do nothing;

revoke insert on public.e2ee_conversations from authenticated;
drop policy if exists "Members activate E2EE conversations" on public.e2ee_conversations;

create or replace function private.activate_e2ee_conversation(
  p_chat_id uuid, p_mls_group_id bytea, p_activation_epoch bigint,
  p_sender_device_id uuid, p_initial_commit bytea, p_payload_hash bytea
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  owner_id uuid;
begin
  if actor is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not exists (select 1 from private.e2ee_runtime_config where singleton and activation_enabled) then
    raise exception 'E2EE v2 activation is disabled' using errcode = '42501';
  end if;
  select created_by into owner_id from public.chats where id = p_chat_id for update;
  if not exists (select 1 from public.chat_members where chat_id = p_chat_id and profile_id = actor) then
    raise exception 'Chat membership is required' using errcode = '42501';
  end if;
  if owner_id is distinct from actor and not exists (
    select 1 from public.chat_members where chat_id = p_chat_id and profile_id = actor and role = 'admin'
  ) then
    raise exception 'Only chat administrators can activate E2EE v2' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_devices where id = p_sender_device_id and user_id = actor and status = 'active') then
    raise exception 'An active owned device is required' using errcode = '42501';
  end if;
  insert into public.e2ee_conversations(chat_id, mls_group_id, activation_epoch, created_by)
    values (p_chat_id, p_mls_group_id, p_activation_epoch, actor);
  insert into public.e2ee_handshake_events(chat_id, epoch, sender_device_id, event_type, encrypted_payload, payload_hash)
    values (p_chat_id, p_activation_epoch, p_sender_device_id, 'commit', p_initial_commit, p_payload_hash);
end;
$$;
revoke all on function private.activate_e2ee_conversation(uuid, bytea, bigint, uuid, bytea, bytea) from public, anon;
grant execute on function private.activate_e2ee_conversation(uuid, bytea, bigint, uuid, bytea, bytea) to authenticated, service_role;

-- One server-owned posting decision for messages and attachment writes.
-- Encrypted v2 payloads expose no media metadata; do not infer their contents.
create or replace function private.can_post_to_chat(p_chat_id uuid, p_media boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chats c
    join public.chat_members m on m.chat_id = c.id and m.profile_id = (select auth.uid())
    where c.id = p_chat_id and (
      c.created_by = (select auth.uid()) or m.role = 'admin'
      or (c.type = 'personal')
      or (c.type = 'group' and not coalesce((c.settings ->> 'only_admins_can_post')::boolean, false))
    ) and (
      not p_media or c.type = 'personal' or c.created_by = (select auth.uid()) or m.role = 'admin'
      or coalesce((c.settings ->> 'allow_media')::boolean, true)
    )
  );
$$;
revoke all on function private.can_post_to_chat(uuid, boolean) from public, anon;
grant execute on function private.can_post_to_chat(uuid, boolean) to authenticated, service_role;

drop policy if exists "messages_insert_policy" on public.messages;
create policy "messages_insert_policy" on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.can_post_to_chat(chat_id, media is not null or media_path is not null));

-- Content edits can publish new text/media through the same table API. Keep
-- reactions/read receipts available without granting posting authority.
create or replace function public.guard_message_content_edit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.text is distinct from old.text or new.media is distinct from old.media
     or new.forwarded_from is distinct from old.forwarded_from
     or new.media_path is distinct from old.media_path or new.reply_to is distinct from old.reply_to then
    if (select auth.uid()) is null or old.sender_id <> (select auth.uid()) then
      raise exception 'Only the author may change message content' using errcode = '42501';
    end if;
    if old.crypto_version = 2 then
      raise exception 'V2 messages are immutable' using errcode = '42501';
    end if;
    if not private.can_post_to_chat(new.chat_id, new.media is not null or new.media_path is not null) then
      raise exception 'Chat posting permissions do not allow this edit' using errcode = '42501';
    end if;
    new.edited_at := clock_timestamp();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_message_content_edit() from public, anon, authenticated;

alter policy "Users upload their own chat attachments" on storage.objects
  with check (
    bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
    and storage.filename(name) ~* '^(msg|record)_[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|mp4|webm|ogg|m4a|mp3|wav)$'
    and private.can_post_to_chat(((storage.foldername(name))[1])::uuid, true)
  );
alter policy "Users update their own chat attachments" on storage.objects
  using (
    bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.can_post_to_chat(((storage.foldername(name))[1])::uuid, true)
  )
  with check (
    bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
    and storage.filename(name) ~* '^(msg|record)_[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|mp4|webm|ogg|m4a|mp3|wav)$'
    and private.can_post_to_chat(((storage.foldername(name))[1])::uuid, true)
  );

-- Count successful creations independently of mutable/deletable chat rows.
create table private.chat_creation_events (
  actor uuid not null,
  created_at timestamptz not null default statement_timestamp()
);
revoke all on private.chat_creation_events from public, anon, authenticated;
create index chat_creation_events_actor_time_idx on private.chat_creation_events(actor, created_at);
insert into private.chat_creation_events(actor, created_at)
  select created_by, created_at from public.chats
  where created_by is not null and created_at >= statement_timestamp() - interval '1 hour';

create or replace function public.enforce_chat_creation_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); created_count integer;
begin
  if actor_id is null then return new; end if;
  if new.created_by is distinct from actor_id then
    raise exception 'Chat owner must match the authenticated user' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':chat-create', 0));
  delete from private.chat_creation_events e where e.actor = actor_id and e.created_at < statement_timestamp() - interval '1 hour';
  select count(*) into created_count from private.chat_creation_events e where e.actor = actor_id;
  if created_count >= 20 then
    raise exception 'Chat creation rate limit exceeded' using errcode = 'P0001';
  end if;
  new.created_at := statement_timestamp();
  insert into private.chat_creation_events(actor) values (actor_id);
  return new;
end;
$$;
revoke all on function public.enforce_chat_creation_limit() from public, anon, authenticated;

commit;

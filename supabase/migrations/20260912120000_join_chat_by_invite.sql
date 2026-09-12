create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Функция join_chat_by_invite в схеме private с повышенными привилегиями (security definer)
create or replace function private.join_chat_by_invite(p_invite text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_target text;
  is_uuid boolean := false;
  target_chat public.chats%rowtype;
  target_profile public.profiles%rowtype;
  res_chat_id uuid;
  is_member boolean := false;
  allow_add boolean := true;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  clean_target := btrim(regexp_replace(coalesce(p_invite, ''), '^@+', ''));
  if clean_target = '' then
    raise exception 'Invalid invite identifier' using errcode = '22023';
  end if;

  is_uuid := clean_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  -- 1. Обработка UUID
  if is_uuid then
    select * into target_chat
    from public.chats
    where id = clean_target::uuid;

    if found then
      select exists (
        select 1 from public.chat_members
        where chat_id = target_chat.id and profile_id = caller_id
      ) into is_member;

      if is_member then
        return jsonb_build_object(
          'chat_id', target_chat.id,
          'type', target_chat.type,
          'name', target_chat.name,
          'username', target_chat.username,
          'status', 'already_member'
        );
      end if;

      if target_chat.type = 'channel' then
        insert into public.chat_members (chat_id, profile_id, role)
        values (target_chat.id, caller_id, 'member')
        on conflict (chat_id, profile_id) do nothing;

        return jsonb_build_object(
          'chat_id', target_chat.id,
          'type', 'channel',
          'name', target_chat.name,
          'username', target_chat.username,
          'status', 'joined'
        );
      elsif target_chat.type = 'group' then
        allow_add := coalesce((target_chat.settings ->> 'allow_add_members')::boolean, true);
        if not allow_add then
          raise exception 'Приглашения в данную группу отключены' using errcode = '42501';
        end if;

        insert into public.chat_members (chat_id, profile_id, role)
        values (target_chat.id, caller_id, 'member')
        on conflict (chat_id, profile_id) do nothing;

        return jsonb_build_object(
          'chat_id', target_chat.id,
          'type', 'group',
          'name', target_chat.name,
          'username', target_chat.username,
          'status', 'joined'
        );
      else
        raise exception 'Нельзя присоединиться к личному диалогу по идентификатору' using errcode = '42501';
      end if;
    end if;

    -- Если чат по UUID не найден, проверяем профиль пользователя
    select * into target_profile
    from public.profiles
    where id = clean_target::uuid;

    if found then
      if target_profile.id = caller_id then
        res_chat_id := public.ensure_saved_messages_chat();
        return jsonb_build_object(
          'chat_id', res_chat_id,
          'type', 'saved',
          'name', 'Избранное',
          'username', null,
          'status', 'self'
        );
      else
        res_chat_id := private.ensure_personal_chat(target_profile.id);
        return jsonb_build_object(
          'chat_id', res_chat_id,
          'type', 'personal',
          'name', coalesce(target_profile.display_name, target_profile.username),
          'username', target_profile.username,
          'status', 'personal_created'
        );
      end if;
    end if;

    raise exception 'Чат или профиль с указанным UUID не найден' using errcode = 'P0002';
  end if;

  -- 2. Обработка имени пользователя (username / slug)
  -- Поиск в каналах и группах
  select * into target_chat
  from public.chats
  where lower(username) = lower(clean_target);

  if found then
    select exists (
      select 1 from public.chat_members
      where chat_id = target_chat.id and profile_id = caller_id
    ) into is_member;

    if is_member then
      return jsonb_build_object(
        'chat_id', target_chat.id,
        'type', target_chat.type,
        'name', target_chat.name,
        'username', target_chat.username,
        'status', 'already_member'
      );
    end if;

    if target_chat.type = 'channel' then
      insert into public.chat_members (chat_id, profile_id, role)
      values (target_chat.id, caller_id, 'member')
      on conflict (chat_id, profile_id) do nothing;

      return jsonb_build_object(
        'chat_id', target_chat.id,
        'type', 'channel',
        'name', target_chat.name,
        'username', target_chat.username,
        'status', 'joined'
      );
    elsif target_chat.type = 'group' then
      allow_add := coalesce((target_chat.settings ->> 'allow_add_members')::boolean, true);
      if not allow_add then
        raise exception 'Приглашения в данную группу отключены' using errcode = '42501';
      end if;

      insert into public.chat_members (chat_id, profile_id, role)
      values (target_chat.id, caller_id, 'member')
      on conflict (chat_id, profile_id) do nothing;

      return jsonb_build_object(
        'chat_id', target_chat.id,
        'type', 'group',
        'name', target_chat.name,
        'username', target_chat.username,
        'status', 'joined'
      );
    end if;
  end if;

  -- Поиск в профилях пользователей
  select * into target_profile
  from public.profiles
  where lower(username) = lower(clean_target);

  if found then
    if target_profile.id = caller_id then
      res_chat_id := public.ensure_saved_messages_chat();
      return jsonb_build_object(
        'chat_id', res_chat_id,
        'type', 'saved',
        'name', 'Избранное',
        'username', null,
        'status', 'self'
      );
    else
      res_chat_id := private.ensure_personal_chat(target_profile.id);
      return jsonb_build_object(
        'chat_id', res_chat_id,
        'type', 'personal',
        'name', coalesce(target_profile.display_name, target_profile.username),
        'username', target_profile.username,
        'status', 'personal_created'
      );
    end if;
  end if;

  raise exception 'Чат или профиль с никнеймом % не найден', clean_target using errcode = 'P0002';
end;
$$;

revoke execute on function private.join_chat_by_invite(text) from public, anon;
grant execute on function private.join_chat_by_invite(text) to authenticated;

-- Публичная обертка с security invoker
create or replace function public.join_chat_by_invite(p_invite text)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.join_chat_by_invite(p_invite);
$$;

revoke execute on function public.join_chat_by_invite(text) from public, anon;
grant execute on function public.join_chat_by_invite(text) to authenticated;

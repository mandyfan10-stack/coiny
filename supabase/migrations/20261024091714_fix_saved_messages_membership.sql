-- Opening personal notes must not promote an existing membership.
-- Preserve legacy roles, messages and chat IDs; keep invoker RLS checks.
create or replace function public.ensure_saved_messages_chat()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  saved_chat_id uuid;
  created_saved boolean := false;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));

  select c.id
  into saved_chat_id
  from public.chats c
  where c.created_by = caller_id
    and c.type = 'personal'
    and c.name = 'Избранное'
  limit 1;

  if saved_chat_id is null then
    insert into public.chats (name, type, avatar, avatar_color, created_by)
    values (
      'Избранное',
      'personal',
      '🔖',
      'linear-gradient(135deg, #3a7bd5 0%, #3a6073 100%)',
      caller_id
    )
    returning id into saved_chat_id;
    created_saved := true;
  end if;

  insert into public.chat_members (chat_id, profile_id, role)
  values (saved_chat_id, caller_id, 'member')
  on conflict (chat_id, profile_id) do nothing;

  if created_saved then
    insert into public.messages (chat_id, sender_id, text)
    values (
      saved_chat_id,
      caller_id,
      'Добро пожаловать в Избранное! 🔖 Сохраняйте здесь нужные сообщения и файлы.'
    );
  end if;

  return saved_chat_id;
end;
$$;

revoke execute on function public.ensure_saved_messages_chat() from public, anon;
grant execute on function public.ensure_saved_messages_chat() to authenticated;

-- Version matches the migration applied to the hosted project.
begin;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists forwarded_from text check (octet_length(forwarded_from) <= 8192);
grant insert (forwarded_from) on public.messages to authenticated;
grant select (edited_at, forwarded_from) on public.messages to authenticated;

-- UPDATE also carries read receipts and reactions. Restrict content separately,
-- while retaining their existing policies and the append-only v2 guard.
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
    new.edited_at := clock_timestamp();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_message_content_edit() from public, anon, authenticated;
create trigger guard_message_content_edit before update on public.messages
for each row execute function public.guard_message_content_edit();

create or replace function public.edit_message_text(
  p_message_id uuid, p_text text, p_expected_text text, p_expected_edited_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare edited public.messages;
begin
  if (select auth.uid()) is null or p_text is null or length(btrim(p_text)) = 0 or octet_length(p_text) > 262144 then
    raise exception 'Invalid message edit' using errcode = '22023';
  end if;
  update public.messages set text = p_text
  where id = p_message_id and sender_id = (select auth.uid()) and crypto_version = 1
    and text is not distinct from p_expected_text
    and edited_at is not distinct from p_expected_edited_at
  returning * into edited;
  if edited.id is null then return null; end if;
  return jsonb_build_object('text', edited.text, 'edited_at', edited.edited_at);
end;
$$;
revoke all on function public.edit_message_text(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.edit_message_text(uuid, text, text, timestamptz) to authenticated;
commit;

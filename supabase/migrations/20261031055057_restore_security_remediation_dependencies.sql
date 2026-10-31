-- Some hosted installations predate the September trigger bindings. Restore
-- only the dependencies of the October remediation, without replaying older
-- membership policies over their later security fixes.
drop trigger if exists before_chat_creation_limit_hardening on public.chats;
create trigger before_chat_creation_limit_hardening
  before insert on public.chats
  for each row execute function public.enforce_chat_creation_limit();

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
create trigger before_e2ee_handshake_validation
  before insert on public.e2ee_handshake_events
  for each row execute function public.validate_e2ee_v2_event();
drop trigger if exists before_e2ee_welcome_validation on public.e2ee_welcomes;
create trigger before_e2ee_welcome_validation
  before insert on public.e2ee_welcomes
  for each row execute function public.validate_e2ee_v2_event();

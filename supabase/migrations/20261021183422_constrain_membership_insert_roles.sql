begin;

-- INSERT is an authorization boundary too: an invitation permission allows
-- adding a member, not assigning an administrator to another account.
create or replace function public.normalize_chat_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  chat_owner uuid;
  chat_type text;
begin
  -- Trusted service/migration writes have no user JWT and keep their role.
  if actor is null then return new; end if;

  if new.role = 'admin' then
    select c.created_by, c.type into chat_owner, chat_type
      from public.chats c where c.id = new.chat_id;
    if chat_type = 'personal'
       or (chat_owner is distinct from actor
           and not public.is_chat_admin(new.chat_id, actor)) then
      new.role := 'member';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_chat_member_insert()
  from public, anon, authenticated;
drop trigger if exists before_chat_member_insert_hardening on public.chat_members;
create trigger before_chat_member_insert_hardening
  before insert on public.chat_members
  for each row execute function public.normalize_chat_member_insert();

commit;

begin;

-- Switch accounting atomically with respect to message inserts and deletions.
-- Ordinary reads remain available. No message or account rows are changed.
lock table public.messages in share row exclusive mode;

create table private.message_send_events (
  actor uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.message_send_events enable row level security;
revoke all on private.message_send_events from public, anon, authenticated;
create index message_send_events_actor_time_idx
  on private.message_send_events (actor, created_at);

-- Preserve the active window on upgrade. Previously deleted sends cannot be
-- reconstructed, but every accepted send after the switch has its own event.
insert into private.message_send_events (actor, created_at)
select sender_id, least(created_at, statement_timestamp())
from public.messages
where created_at >= statement_timestamp() - interval '5 minutes';

create or replace function public.enforce_message_rate_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then return new; end if;
  if new.sender_id is distinct from actor then
    raise exception 'Message sender must match the authenticated user' using errcode = '42501';
  end if;
  -- Keep the existing lock-before-row order, including Saved creation and
  -- duplicate retries. Ignored conflicts must not consume a sending slot.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  return new;
end;
$$;
revoke all on function public.enforce_message_rate_limit() from public, anon, authenticated;
drop trigger if exists before_message_rate_limit on public.messages;
create trigger before_message_rate_limit before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

create function private.record_message_send()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  event_time timestamptz;
  short_count bigint;
  long_count bigint;
begin
  -- Trusted imports/fixtures keep their existing bypass and chronology, while
  -- still contributing to subsequent authenticated windows as before.
  if actor_id is null then
    insert into private.message_send_events (actor, created_at)
    values (new.sender_id, least(new.created_at, clock_timestamp()));
    return null;
  end if;
  event_time := clock_timestamp();
  delete from private.message_send_events e
  where e.actor = actor_id and e.created_at < event_time - interval '5 minutes';
  select count(*) filter (where e.created_at >= event_time - interval '10 seconds'), count(*)
    into short_count, long_count
    from private.message_send_events e
    where e.actor = actor_id;
  if short_count >= 25 or long_count >= 300 then
    raise exception 'Message rate limit exceeded' using errcode = 'P0001';
  end if;
  insert into private.message_send_events (actor, created_at) values (actor_id, event_time);
  return null;
end;
$$;
revoke all on function private.record_message_send() from public, anon, authenticated;
create trigger after_message_send_accounting after insert on public.messages
  for each row execute function private.record_message_send();

commit;

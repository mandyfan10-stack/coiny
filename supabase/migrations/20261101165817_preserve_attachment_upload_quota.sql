begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep the active window while switching accounting atomically. Deleted
-- historical objects cannot be reconstructed.
lock table storage.objects in share row exclusive mode;

create table private.attachment_upload_events (
  actor uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.attachment_upload_events enable row level security;
revoke all on private.attachment_upload_events from public, anon, authenticated;
create index attachment_upload_events_actor_time_idx on private.attachment_upload_events(actor, created_at);
create index attachment_upload_events_time_idx on private.attachment_upload_events(created_at);

insert into private.attachment_upload_events(actor, created_at)
select split_part(name, '/', 2)::uuid, least(created_at, clock_timestamp())
from storage.objects
where bucket_id = 'chat-attachments'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and created_at >= clock_timestamp() - interval '24 hours';

-- Leave size validation in place, but count only completed row operations.
create or replace function public.enforce_chat_attachment_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare object_size bigint := coalesce((new.metadata ->> 'size')::bigint, 0);
begin
  if new.bucket_id = 'chat-attachments' and (select auth.uid()) is not null
     and (object_size < 0 or object_size > 52428800) then
    raise exception 'Attachment is too large' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_chat_attachment_quota() from public, anon, authenticated;

create function private.record_attachment_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  path_actor text := split_part(new.name, '/', 2);
  event_time timestamptz;
begin
  if new.bucket_id <> 'chat-attachments' then return null; end if;
  if tg_op = 'UPDATE' and old.bucket_id = new.bucket_id
     and (new.version is not distinct from old.version or old.name is distinct from new.name) then
    return null;
  end if;
  if path_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  actor_id := path_actor::uuid;
  -- Storage commits as service_role after an RLS preflight; owner_id carries
  -- the uploader there. Skip unrelated trusted imports with no matching owner.
  if (select auth.uid()) is distinct from actor_id and new.owner_id is distinct from actor_id::text then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':attachment-upload', 0));
  event_time := clock_timestamp();
  delete from private.attachment_upload_events where attachment_upload_events.actor = actor_id
    and created_at < event_time - interval '24 hours';
  delete from private.attachment_upload_events where ctid in (
    select ctid from private.attachment_upload_events where created_at < event_time - interval '24 hours'
    limit 100 for update skip locked
  );
  if (select count(*) from private.attachment_upload_events e where e.actor = actor_id) >= 200 then
    raise exception 'Attachment upload quota exceeded' using errcode = 'P0001';
  end if;
  insert into private.attachment_upload_events(actor, created_at) values (actor_id, event_time);
  return null;
end;
$$;
revoke all on function private.record_attachment_upload() from public, anon, authenticated;
create trigger after_attachment_upload_insert after insert on storage.objects
  for each row execute function private.record_attachment_upload();
create trigger after_attachment_upload_update after update on storage.objects
  for each row execute function private.record_attachment_upload();

commit;

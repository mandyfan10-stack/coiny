-- Subscription endpoints and encryption keys are private delivery credentials.
create table private.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  updated_at timestamptz not null default now()
);
create index web_push_subscriptions_owner_idx on private.web_push_subscriptions(owner_id);
alter table private.web_push_subscriptions enable row level security;
revoke all on private.web_push_subscriptions from public, anon, authenticated;

create function public.register_web_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  subscription_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_endpoint is null or octet_length(p_endpoint) > 2048
    or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[^[:space:]#]+$'
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 7431));
  delete from private.web_push_subscriptions where owner_id = actor and updated_at <= now() - interval '90 days';
  if not exists (select 1 from private.web_push_subscriptions where endpoint = p_endpoint and owner_id = actor)
    and (select count(*) from private.web_push_subscriptions where owner_id = actor) >= 10 then
    raise exception 'Too many push subscriptions' using errcode = '54000';
  end if;
  insert into private.web_push_subscriptions as stored(owner_id, endpoint, p256dh, auth)
    values(actor, p_endpoint, p_p256dh, p_auth)
    on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now()
      where stored.owner_id = actor
    returning id into subscription_id;
  if subscription_id is null then raise exception 'Subscription belongs to another account' using errcode = '42501'; end if;
  return subscription_id;
end;
$$;

create function public.remove_web_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from private.web_push_subscriptions where owner_id = auth.uid() and endpoint = p_endpoint;
end;
$$;

-- Only the dispatcher can enumerate subscriptions. Re-check membership and reads
-- at delivery time so a delayed webhook cannot notify a former member.
create function public.get_message_push_recipients(p_message_id uuid, p_after uuid default null)
returns table(id uuid, owner_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.owner_id, s.endpoint, s.p256dh, s.auth
  from public.messages m
  join public.chat_members member on member.chat_id = m.chat_id
  join private.web_push_subscriptions s on s.owner_id = member.profile_id
  where m.id = p_message_id and m.sender_id <> s.owner_id
    and coalesce(member.notifications, true)
    and m.created_at > now() - interval '5 minutes'
    and s.updated_at > now() - interval '90 days'
    and (p_after is null or s.id > p_after)
    and not exists (select 1 from public.message_reads r where r.message_id = m.id and r.profile_id = s.owner_id)
  order by s.id limit 100;
$$;

create function public.delete_expired_push_subscription(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.web_push_subscriptions where id = p_id;
$$;

revoke all on function public.register_web_push_subscription(text,text,text), public.remove_web_push_subscription(text),
  public.get_message_push_recipients(uuid,uuid), public.delete_expired_push_subscription(uuid) from public, anon, authenticated;
grant execute on function public.register_web_push_subscription(text,text,text), public.remove_web_push_subscription(text) to authenticated;
grant execute on function public.get_message_push_recipients(uuid,uuid), public.delete_expired_push_subscription(uuid) to service_role;

create function private.notify_web_push_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  push_url text;
  webhook_secret text;
begin
  select decrypted_secret into push_url from vault.decrypted_secrets where name = 'coiny_push_url' order by created_at desc limit 1;
  select decrypted_secret into webhook_secret from vault.decrypted_secrets where name = 'coiny_push_webhook_secret' order by created_at desc limit 1;
  -- Optional until the Edge Function and VAPID keys have been configured.
  if push_url is null or webhook_secret is null then return new; end if;
  if push_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/send-web-push$' then return new; end if;
  perform net.http_post(url := push_url,
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret',webhook_secret),
    body := jsonb_build_object('messageId',new.id), timeout_milliseconds := 10000);
  return new;
exception when others then
  -- An optional notification transport must not roll back a delivered message.
  raise warning 'Web push enqueue failed';
  return new;
end;
$$;
revoke all on function private.notify_web_push_message() from public, anon, authenticated;
create trigger notify_web_push_message after insert on public.messages
for each row execute function private.notify_web_push_message();

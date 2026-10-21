begin;

-- This is deliberately self-contained: production has a different historical
-- migration timeline. Do not replay unrelated hardening/invite changes here.
-- Login already uses synthetic username addresses or an explicitly entered
-- email; the old resolver must not disclose auth.users.email to API clients.
revoke all on function public.resolve_username_auth_email(text)
  from public, anon, authenticated;

-- A mutable profile, story or newly posted URL is not evidence of ownership of
-- a private object. Modern paths are <chat>/<uploader>/<file>; legacy paths are
-- <uploader>/<file>. Keep legacy recipients working only when the recorded
-- sender actually owns that first path segment. The two shapes are separate
-- so creating a chat with an id equal to a user's id cannot expose old uploads.
drop policy if exists "Chat members read referenced attachments" on storage.objects;
create policy "Chat members read referenced attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      (
        cardinality(storage.foldername(name)) = 2
        and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and coalesce(storage.objects.owner_id, storage.objects.owner::text) = (storage.foldername(name))[2]
        and public.is_chat_member(
          case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then ((storage.foldername(name))[1])::uuid
            else null::uuid
          end,
          (select auth.uid())
        )
      )
      or (
        cardinality(storage.foldername(name)) = 1
        and (
          (storage.foldername(name))[1] = (select auth.uid())::text
          or exists (
            select 1 from public.messages m
            where m.sender_id::text = (storage.foldername(storage.objects.name))[1]
              and (
                m.media_path = storage.objects.name
                or split_part(split_part(m.media, 'chat-attachments/', 2), '?', 1) = storage.objects.name
              )
              and public.is_chat_member(m.chat_id, (select auth.uid()))
          )
        )
      )
      -- Legacy public avatars may still live in this bucket. Publishing one's
      -- own upload is allowed; a forged avatar reference to another uploader
      -- must not widen object access. Verify both Storage ownership and the
      -- uploader path segment rather than trusting a mutable URL alone.
      or exists (
        select 1 from public.profiles p
        where split_part(split_part(p.avatar, 'chat-attachments/', 2), '?', 1) = storage.objects.name
          and coalesce(storage.objects.owner_id, storage.objects.owner::text) = p.id::text
          and (
            (cardinality(storage.foldername(storage.objects.name)) = 1
              and (storage.foldername(storage.objects.name))[1] = p.id::text)
            or (cardinality(storage.foldername(storage.objects.name)) = 2
              and (storage.foldername(storage.objects.name))[2] = p.id::text)
          )
      )
    )
  );

commit;

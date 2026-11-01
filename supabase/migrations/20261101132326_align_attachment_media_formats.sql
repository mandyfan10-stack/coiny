begin;

-- Align accepted filenames with the existing client and bucket MIME allowlists.
alter policy "Users upload their own chat attachments" on storage.objects
  with check (
    bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
    and storage.filename(name) ~* '^(msg|record)_[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|avif|mp4|webm|ogg|ogv|m4a|mp3|wav|aac|flac)$'
    and private.can_post_to_chat(((storage.foldername(name))[1])::uuid, true)
  );
alter policy "Users update their own chat attachments" on storage.objects
  using (
    bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
    and private.can_post_to_chat(((storage.foldername(name))[1])::uuid, true)
  )
  with check (
    bucket_id = 'chat-attachments' and (storage.foldername(name))[2] = (select auth.uid())::text
    and storage.filename(name) ~* '^(msg|record)_[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp|avif|mp4|webm|ogg|ogv|m4a|mp3|wav|aac|flac)$'
    and private.can_post_to_chat(((storage.foldername(name))[1])::uuid, true)
  );


commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.consume_media_upload_quota(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':media-upload-quota', 0));
  delete from private.media_upload_attempts
  where user_id = p_user_id and attempted_at < clock_timestamp() - interval '1 hour';
  delete from private.media_upload_attempts where ctid in (
    select ctid from private.media_upload_attempts
    where attempted_at < clock_timestamp() - interval '1 hour'
    limit 100 for update skip locked
  );
  if (select count(*) from private.media_upload_attempts
      where user_id = p_user_id and attempted_at >= clock_timestamp() - interval '1 minute') >= 20 then
    return false;
  end if;
  insert into private.media_upload_attempts (user_id) values (p_user_id);
  return true;
end;
$function$;

create or replace function private.consume_sticker_import_quota(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':sticker-import-quota', 0));
  delete from private.sticker_import_attempts
  where user_id = p_user_id and attempted_at < clock_timestamp() - interval '1 hour';
  delete from private.sticker_import_attempts where ctid in (
    select ctid from private.sticker_import_attempts
    where attempted_at < clock_timestamp() - interval '1 hour'
    limit 100 for update skip locked
  );
  if (select count(*) from private.sticker_import_attempts
      where user_id = p_user_id and attempted_at >= clock_timestamp() - interval '10 minutes') >= 5 then
    return false;
  end if;
  insert into private.sticker_import_attempts (user_id) values (p_user_id);
  return true;
end;
$function$;

commit;

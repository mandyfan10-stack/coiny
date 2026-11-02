begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.consume_media_upload_quota(uuid)','EXECUTE'),'media quota RPC stays service-only');
select ok(not has_function_privilege('authenticated','public.consume_sticker_import_quota(uuid)','EXECUTE'),'sticker quota RPC stays service-only');
insert into private.media_upload_attempts(user_id,attempted_at)
select 'ae100000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours' from generate_series(1,3);
insert into private.media_upload_attempts(user_id)
select 'ae100000-0000-4000-8000-000000000001' from generate_series(1,19);
select ok(public.consume_media_upload_quota('ae100000-0000-4000-8000-000000000001'),'last media slot is accepted');
select ok(not public.consume_media_upload_quota('ae100000-0000-4000-8000-000000000001'),'next media attempt is rejected');
select is((select count(*) from private.media_upload_attempts where user_id='ae100000-0000-4000-8000-000000000001'),20::bigint,'expired attempts are removed');
select ok(public.consume_media_upload_quota('ae100000-0000-4000-8000-000000000002'),'another user has an independent media quota');
insert into private.sticker_import_attempts(user_id)
select 'ae100000-0000-4000-8000-000000000001' from generate_series(1,4);
select ok(public.consume_sticker_import_quota('ae100000-0000-4000-8000-000000000001'),'last sticker slot is independent and accepted');
select ok(not public.consume_sticker_import_quota('ae100000-0000-4000-8000-000000000001'),'next sticker attempt is rejected');
select * from finish();
rollback;

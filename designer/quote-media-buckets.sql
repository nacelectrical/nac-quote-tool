-- ─────────────────────────────────────────────────────────────────────────────
-- QUOTE PRESENTATION — IMAGE STORAGE
--
-- Two buckets, and the difference between them is the whole design.
--
--   nac-quote-media       PUBLIC. The re-encoded web copies only. A customer
--                         opens their quote link without logging in, so these
--                         have to be fetchable without a credential. They are
--                         re-encodes with the metadata already gone, sitting at
--                         128-bit random paths.
--
--   nac-quote-originals   PRIVATE. The files straight off a phone, EXIF and GPS
--                         intact. That is precisely why nothing serves them.
--                         Service role only, both ways.
--
-- Run this once in the Supabase SQL editor. Then POST {"action":"status"} to
-- /api/presentation-media, or open Quote Presentation → Product images, which
-- reports whether the buckets are reachable before you upload anything.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The buckets ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nac-quote-media', 'nac-quote-media', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nac-quote-originals', 'nac-quote-originals', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Who may do what ──────────────────────────────────────────────────────────
-- storage.objects already has RLS enabled by Supabase. These policies are
-- additive and scoped by bucket_id, so they cannot affect intake-uploads or any
-- other bucket.

drop policy if exists nac_quote_media_public_read   on storage.objects;
drop policy if exists nac_quote_media_staff_write   on storage.objects;
drop policy if exists nac_quote_media_staff_update  on storage.objects;
drop policy if exists nac_quote_media_staff_delete  on storage.objects;

-- The public bucket: anyone may READ a derivative. That is what makes a quote
-- link work for a customer who is not signed in. Nobody but staff may write.
create policy nac_quote_media_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'nac-quote-media');

create policy nac_quote_media_staff_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'nac-quote-media');

create policy nac_quote_media_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'nac-quote-media') with check (bucket_id = 'nac-quote-media');

create policy nac_quote_media_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'nac-quote-media');

-- The private bucket gets NO policy at all. With RLS on and no policy, every
-- role except the service role is refused — which is the intent. Uploads and
-- reads of an original go through the server, or they do not happen.

-- ── VERIFY ───────────────────────────────────────────────────────────────────
--
--   select id, public, file_size_limit from storage.buckets
--    where id in ('nac-quote-media','nac-quote-originals');
--
-- Expect: nac-quote-media public = true, nac-quote-originals public = false.
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'nac_quote_media%';
--
-- Expect four rows, and NOTHING naming nac-quote-originals.
--
-- Then, signed out, open the URL of an original directly. It must 400 or 404.
-- If it returns an image, the private bucket is not private — stop and fix it
-- before loading any customer photographs.

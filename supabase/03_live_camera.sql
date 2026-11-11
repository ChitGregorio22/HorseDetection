-- =====================================================================
--  Horse Thermal Monitor — Update 3: Live camera on the Dashboard
--  Run once in Supabase → SQL Editor (after 01 and 02).
--  Adds a place to store the Raspberry Pi camera stream address.
--  Safe to run more than once.
-- =====================================================================
alter table public.system_settings
  add column if not exists camera_stream_url text;

alter table public.system_settings
  drop constraint if exists camera_stream_url_format;
alter table public.system_settings
  add constraint camera_stream_url_format
  check (camera_stream_url is null or camera_stream_url ~* '^https?://');

comment on column public.system_settings.camera_stream_url is
  'Raspberry Pi live camera stream (MJPEG) shown on the Dashboard. Set by an admin in Settings.';

-- Check: should show the new column (empty for now)
select id, camera_stream_url from public.system_settings;

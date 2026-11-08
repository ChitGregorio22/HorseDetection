-- =====================================================================
--  RESET — deletes ALL Horse Thermal Monitor tables and data.
--  Only run this if you want to start over, then run 01 and 02 again.
--  (User accounts in Authentication are kept.)
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;

drop policy if exists "Anyone can view horse photos"                  on storage.objects;
drop policy if exists "Admins and caretakers can upload horse photos" on storage.objects;
drop policy if exists "Admins and caretakers can replace horse photos" on storage.objects;
drop policy if exists "Admins can delete horse photos"                on storage.objects;

drop view  if exists public.daily_temperature_summary;
drop view  if exists public.horse_current_status;

drop table if exists public.alerts               cascade;
drop table if exists public.temperature_readings cascade;
drop table if exists public.devices              cascade;
drop table if exists public.horses               cascade;
drop table if exists public.system_settings      cascade;
drop table if exists public.profiles             cascade;

drop function if exists public.submit_reading(text, text, numeric, numeric, text);
drop function if exists public.stamp_alert_status();
drop function if exists public.raise_fever_alert();
drop function if exists public.prepare_reading();
drop function if exists public.protect_profile_role();
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();
drop function if exists public.classify_temperature(numeric);
drop function if exists public.is_admin();
drop function if exists public.get_my_role();

drop type if exists public.alert_status;
drop type if exists public.health_status;
drop type if exists public.user_role;

-- Photos stay in the bucket; delete them from Storage → horse-photos if needed.

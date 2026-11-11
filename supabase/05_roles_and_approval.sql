-- =====================================================================
--  Horse Thermal Monitor — Update 5: roles, account approval, humidity
--  Run once in Supabase → SQL Editor (after 01–04). Safe to re-run.
--
--  Roles:
--    admin        → everything (superuser) + approve users / change roles
--    owner        → settings, thresholds, calibration, camera, register/edit/remove horses
--    caretaker    → view everything, acknowledge/resolve alerts
--    veterinarian → same as caretaker
--  New sign-ups are NOT approved: they see nothing until an admin approves them.
-- =====================================================================

-- 1. Approval flag (existing accounts stay approved; new sign-ups start unapproved)
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'approved') then
    alter table public.profiles add column approved boolean not null default true;  -- existing users → approved
    alter table public.profiles alter column approved set default false;            -- new sign-ups → pending
  end if;
end $$;

-- 2. Helper functions (used by every security rule below)
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select approved from public.profiles where id = auth.uid()), false) $$;

-- role only counts once the account is approved
create or replace function public.get_my_role()
returns public.user_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and approved $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.get_my_role() = 'admin', false) $$;

create or replace function public.can_manage()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.get_my_role() in ('admin', 'owner'), false) $$;

-- 3. Only an admin can change someone's role or approval
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.approved is distinct from old.approved)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change user roles or approval';
  end if;
  return new;
end $$;

-- 4. Security rules (replace the old ones)
drop policy if exists "Signed-in users can view profiles"          on public.profiles;
drop policy if exists "Users can update their own profile"         on public.profiles;
drop policy if exists "Admins can update any profile"              on public.profiles;
drop policy if exists "Approved users can view profiles"           on public.profiles;
create policy "Approved users can view profiles" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_approved());
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Admins can update any profile" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in users can view settings"          on public.system_settings;
drop policy if exists "Admins can change settings"                 on public.system_settings;
drop policy if exists "Approved users can view settings"           on public.system_settings;
drop policy if exists "Owners and admins can change settings"      on public.system_settings;
create policy "Approved users can view settings" on public.system_settings
  for select to authenticated using (public.is_approved());
create policy "Owners and admins can change settings" on public.system_settings
  for update to authenticated using (public.can_manage()) with check (public.can_manage());

drop policy if exists "Signed-in users can view horses"            on public.horses;
drop policy if exists "Admins and caretakers can register horses"  on public.horses;
drop policy if exists "Admins and caretakers can edit horses"      on public.horses;
drop policy if exists "Admins can delete horses"                   on public.horses;
drop policy if exists "Approved users can view horses"             on public.horses;
drop policy if exists "Owners and admins can register horses"      on public.horses;
drop policy if exists "Owners and admins can edit horses"          on public.horses;
create policy "Approved users can view horses" on public.horses
  for select to authenticated using (public.is_approved());
create policy "Owners and admins can register horses" on public.horses
  for insert to authenticated with check (public.can_manage());
create policy "Owners and admins can edit horses" on public.horses
  for update to authenticated using (public.can_manage()) with check (public.can_manage());
create policy "Admins can delete horses" on public.horses
  for delete to authenticated using (public.is_admin());

drop policy if exists "Admins manage devices"                      on public.devices;
drop policy if exists "Owners and admins can view devices"         on public.devices;
drop policy if exists "Owners and admins can calibrate devices"    on public.devices;
drop policy if exists "Admins can add devices"                     on public.devices;
drop policy if exists "Admins can delete devices"                  on public.devices;
create policy "Owners and admins can view devices" on public.devices
  for select to authenticated using (public.can_manage());
create policy "Owners and admins can calibrate devices" on public.devices
  for update to authenticated using (public.can_manage()) with check (public.can_manage());
create policy "Admins can add devices" on public.devices
  for insert to authenticated with check (public.is_admin());
create policy "Admins can delete devices" on public.devices
  for delete to authenticated using (public.is_admin());

drop policy if exists "Signed-in users can view readings"          on public.temperature_readings;
drop policy if exists "Staff can add manual readings"              on public.temperature_readings;
drop policy if exists "Approved users can view readings"           on public.temperature_readings;
drop policy if exists "Owners and admins can add manual readings"  on public.temperature_readings;
create policy "Approved users can view readings" on public.temperature_readings
  for select to authenticated using (public.is_approved());
create policy "Owners and admins can add manual readings" on public.temperature_readings
  for insert to authenticated with check (public.can_manage());
-- "Admins can delete readings" from 01 stays as is (uses is_admin)

drop policy if exists "Signed-in users can view alerts"            on public.alerts;
drop policy if exists "Staff can acknowledge or resolve alerts"    on public.alerts;
drop policy if exists "Approved users can view alerts"             on public.alerts;
drop policy if exists "Approved staff can acknowledge or resolve alerts" on public.alerts;
create policy "Approved users can view alerts" on public.alerts
  for select to authenticated using (public.is_approved());
create policy "Approved staff can acknowledge or resolve alerts" on public.alerts
  for update to authenticated using (public.get_my_role() is not null)
  with check (public.get_my_role() is not null);

drop policy if exists "Admins and caretakers can upload horse photos"  on storage.objects;
drop policy if exists "Admins and caretakers can replace horse photos" on storage.objects;
drop policy if exists "Owners and admins can upload horse photos"      on storage.objects;
drop policy if exists "Owners and admins can replace horse photos"     on storage.objects;
create policy "Owners and admins can upload horse photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'horse-photos' and public.can_manage());
create policy "Owners and admins can replace horse photos" on storage.objects
  for update to authenticated using (bucket_id = 'horse-photos' and public.can_manage());

-- 5. Pi connection status: approved users only
create or replace function public.get_device_status()
returns table (id uuid, name text, location text, last_seen_at timestamptz,
               seconds_since_seen integer, online boolean, status jsonb)
language sql stable security definer set search_path = public
as $$
  select d.id, d.name, d.location, d.last_seen_at,
         extract(epoch from (now() - d.last_seen_at))::int,
         coalesce(d.last_seen_at > now() - interval '90 seconds', false), d.status
  from public.devices d
  where d.is_active and public.is_approved()
  order by d.name
$$;
revoke all on function public.get_device_status() from public;
grant execute on function public.get_device_status() to authenticated;

-- 6. Users page (admin only): list accounts with their email
create or replace function public.admin_list_users()
returns table (id uuid, email text, full_name text, role public.user_role, approved boolean,
               created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can view users' using errcode = '42501';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.role, p.approved, u.created_at, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.approved, u.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- 7. Humidity from the DHT22 (for the CSV export and thesis results)
alter table public.temperature_readings
  add column if not exists humidity numeric(4,1) check (humidity between 0 and 100);

drop function if exists public.submit_reading(text, text, numeric, numeric, text);
create or replace function public.submit_reading(
  p_device_key  text,
  p_horse_code  text,
  p_body_temp   numeric,
  p_env_temp    numeric default null,
  p_thermal_image_path text default null,
  p_humidity    numeric default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_device public.devices%rowtype; v_horse_id uuid; v_reading public.temperature_readings%rowtype;
begin
  select * into v_device from public.devices where device_key = p_device_key and is_active;
  if not found then raise exception 'Unknown or inactive device' using errcode = '28000'; end if;

  select id into v_horse_id from public.horses where horse_code = p_horse_code and is_active;
  if v_horse_id is null then raise exception 'Unknown horse code: %', p_horse_code using errcode = 'P0002'; end if;

  insert into public.temperature_readings (horse_id, device_id, body_temp, env_temp, humidity, thermal_image_path)
  values (v_horse_id, v_device.id, p_body_temp, p_env_temp, p_humidity, p_thermal_image_path)
  returning * into v_reading;

  update public.devices set last_seen_at = now() where id = v_device.id;

  return json_build_object('reading_id', v_reading.id, 'horse_id', v_horse_id,
                           'body_temp', v_reading.body_temp, 'status', v_reading.status);
end $$;
revoke all on function public.submit_reading(text, text, numeric, numeric, text, numeric) from public;
grant execute on function public.submit_reading(text, text, numeric, numeric, text, numeric) to anon, authenticated;

create or replace view public.daily_temperature_summary with (security_invoker = true) as
select t.horse_id,
       (t.recorded_at at time zone 'Asia/Manila')::date                       as day,
       count(*)::int                                                          as reading_count,
       round(avg(t.body_temp), 1)                                             as avg_body_temp,
       max(t.body_temp)                                                       as peak_body_temp,
       min(t.body_temp)                                                       as min_body_temp,
       (array_agg(t.recorded_at order by t.body_temp desc, t.recorded_at))[1] as peak_time,
       round(avg(t.env_temp), 1)                                              as avg_env_temp,
       public.classify_temperature(max(t.body_temp))                          as status,
       round(avg(t.humidity), 1)                                              as avg_humidity
from public.temperature_readings t
group by t.horse_id, (t.recorded_at at time zone 'Asia/Manila')::date;

-- 8. Team rule: one name = one active horse (no duplicate names)
create unique index if not exists horses_active_name_unique
  on public.horses (lower(trim(name))) where is_active;

-- Check: everyone's role and approval
select u.email, p.full_name, p.role, p.approved
from public.profiles p join auth.users u on u.id = p.id
order by p.approved, p.role;

-- =====================================================================
--  Horse Thermal Monitor — Supabase backend
--  File 1 of 2: schema (tables, triggers, views, security, storage)
--
--  HOW TO RUN: Supabase Dashboard → SQL Editor → New query →
--  paste this whole file → Run. Then run 02_seed.sql (optional demo data).
--  Safe to re-run on an empty project. To start over, see "RESET" in SETUP.md.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ENUM TYPES
-- ---------------------------------------------------------------------
create type public.user_role     as enum ('admin', 'caretaker', 'veterinarian', 'owner');
create type public.health_status as enum ('normal', 'warning', 'fever');
create type public.alert_status  as enum ('active', 'acknowledged', 'resolved');


-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

-- 2.1 User profiles (one row per Supabase Auth user)
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  role        public.user_role not null default 'caretaker',
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'System users: admin, caretaker, veterinarian, owner.';

-- 2.2 System settings (exactly one row, id = 1)
create table public.system_settings (
  id                      smallint primary key default 1 check (id = 1),
  warning_threshold       numeric(4,1) not null default 37.5,
  fever_threshold         numeric(4,1) not null default 38.0,
  check_interval_seconds  integer      not null default 3 check (check_interval_seconds between 1 and 60),
  sound_alerts            boolean      not null default true,
  email_notifications     boolean      not null default true,
  updated_at              timestamptz  not null default now(),
  updated_by              uuid references public.profiles (id) on delete set null,
  constraint thresholds_in_order check (warning_threshold < fever_threshold),
  constraint thresholds_in_range check (warning_threshold between 35 and 42 and fever_threshold between 35 and 42)
);
comment on table public.system_settings is 'Global fever/warning thresholds and monitoring options (single row).';
insert into public.system_settings (id) values (1);

-- 2.3 Horses
create table public.horses (
  id             uuid primary key default gen_random_uuid(),
  horse_code     text not null unique
                 default ('HTM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  name           text not null check (char_length(trim(name)) between 1 and 60),
  age            integer check (age between 1 and 40),
  normal_temp    numeric(4,1) not null default 37.2 check (normal_temp between 35 and 40),
  photo_path     text,          -- path inside the "horse-photos" storage bucket
  is_active      boolean not null default true,
  registered_by  uuid references public.profiles (id) on delete set null,
  registered_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.horses is 'Registered horses. horse_code is printed on the QR tag.';

-- 2.4 Devices (thermal cameras / sensor units)
create table public.devices (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  location            text,
  device_key          text not null unique
                      default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  calibration_offset  numeric(3,1) not null default 0 check (calibration_offset between -5 and 5),
  last_calibrated_at  timestamptz,
  last_seen_at        timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
comment on table public.devices is 'Thermal camera units. device_key is the secret the hardware uses to submit readings.';

-- 2.5 Temperature readings (the core time-series data)
create table public.temperature_readings (
  id                  bigint generated always as identity primary key,
  horse_id            uuid not null references public.horses (id) on delete cascade,
  device_id           uuid references public.devices (id) on delete set null,
  body_temp           numeric(4,1) not null check (body_temp between 30 and 45),   -- after calibration
  raw_body_temp       numeric(4,1),                                               -- as measured
  env_temp            numeric(4,1) check (env_temp between -10 and 60),
  status              public.health_status not null default 'normal',             -- set by trigger
  thermal_image_path  text,
  recorded_at         timestamptz not null default now(),
  recorded_by         uuid references public.profiles (id) on delete set null
);
comment on table public.temperature_readings is 'Body + environment temperature readings per horse. status is computed from system_settings.';
create index temperature_readings_horse_time_idx on public.temperature_readings (horse_id, recorded_at desc);

-- 2.6 Alerts (created automatically when a fever reading arrives)
create table public.alerts (
  id               bigint generated always as identity primary key,
  horse_id         uuid not null references public.horses (id) on delete cascade,
  reading_id       bigint references public.temperature_readings (id) on delete set null,
  level            public.health_status not null default 'fever' check (level <> 'normal'),
  temperature      numeric(4,1) not null,
  status           public.alert_status not null default 'active',
  message          text,
  notes            text,
  created_at       timestamptz not null default now(),
  acknowledged_by  uuid references public.profiles (id) on delete set null,
  acknowledged_at  timestamptz,
  resolved_by      uuid references public.profiles (id) on delete set null,
  resolved_at      timestamptz
);
comment on table public.alerts is 'Fever alerts. One open (active/acknowledged) alert per horse at a time.';
create index alerts_status_idx on public.alerts (status, created_at desc);
create index alerts_horse_idx  on public.alerts (horse_id, created_at desc);


-- ---------------------------------------------------------------------
-- 3. HELPER FUNCTIONS (used by security policies)
-- ---------------------------------------------------------------------
create or replace function public.get_my_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.get_my_role() = 'admin', false) $$;

create or replace function public.classify_temperature(p_temp numeric)
returns public.health_status
language sql stable security definer set search_path = public
as $$
  select case
           when p_temp >= s.fever_threshold   then 'fever'::public.health_status
           when p_temp >= s.warning_threshold then 'warning'::public.health_status
           else 'normal'::public.health_status
         end
  from public.system_settings s where s.id = 1
$$;


-- ---------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------

-- 4.1 Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger horses_updated_at before update on public.horses
  for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.system_settings
  for each row execute function public.set_updated_at();

-- 4.2 Create a profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Give profiles to any accounts that already existed before this script
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1)) from auth.users
on conflict (id) do nothing;

-- 4.3 Stop non-admins from changing their own role
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change user roles';
  end if;
  return new;
end $$;

create trigger profiles_protect_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- 4.4 Before a reading is saved: apply device calibration + compute status
create or replace function public.prepare_reading()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_offset numeric := 0;
begin
  if new.raw_body_temp is null then
    new.raw_body_temp := new.body_temp;
    if new.device_id is not null then
      select calibration_offset into v_offset from public.devices where id = new.device_id;
      new.body_temp := new.raw_body_temp + coalesce(v_offset, 0);
    end if;
  end if;
  new.status := public.classify_temperature(new.body_temp);
  if new.recorded_by is null then new.recorded_by := auth.uid(); end if;
  return new;
end $$;

create trigger temperature_readings_prepare before insert on public.temperature_readings
  for each row execute function public.prepare_reading();

-- 4.5 After a fever reading: open an alert (or raise the existing open one)
create or replace function public.raise_fever_alert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_open public.alerts%rowtype; v_name text;
begin
  if new.status <> 'fever' then return new; end if;

  select * into v_open from public.alerts
   where horse_id = new.horse_id and status in ('active', 'acknowledged')
   order by created_at desc limit 1;

  if not found then
    select name into v_name from public.horses where id = new.horse_id;
    insert into public.alerts (horse_id, reading_id, level, temperature, message, created_at)
    values (new.horse_id, new.id, 'fever', new.body_temp,
            format('Possible fever detected for %s', v_name),
            new.recorded_at);
  elsif new.body_temp > v_open.temperature then
    update public.alerts set temperature = new.body_temp, reading_id = new.id where id = v_open.id;
  end if;
  return new;
end $$;

create trigger temperature_readings_alert after insert on public.temperature_readings
  for each row execute function public.raise_fever_alert();

-- 4.6 Stamp who acknowledged / resolved an alert and when
create or replace function public.stamp_alert_status()
returns trigger language plpgsql as $$
begin
  if new.status = 'acknowledged' and old.status = 'active' then
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
    new.acknowledged_by := coalesce(new.acknowledged_by, auth.uid());
  elsif new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
    new.resolved_by := coalesce(new.resolved_by, auth.uid());
  end if;
  return new;
end $$;

create trigger alerts_stamp_status before update on public.alerts
  for each row execute function public.stamp_alert_status();


-- ---------------------------------------------------------------------
-- 5. DEVICE API — lets the thermal camera submit readings with only the
--    public anon key + its own secret device_key (no user login needed).
--    Called as: POST /rest/v1/rpc/submit_reading
-- ---------------------------------------------------------------------
create or replace function public.submit_reading(
  p_device_key  text,
  p_horse_code  text,
  p_body_temp   numeric,
  p_env_temp    numeric default null,
  p_thermal_image_path text default null
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

  insert into public.temperature_readings (horse_id, device_id, body_temp, env_temp, thermal_image_path)
  values (v_horse_id, v_device.id, p_body_temp, p_env_temp, p_thermal_image_path)
  returning * into v_reading;

  update public.devices set last_seen_at = now() where id = v_device.id;

  return json_build_object('reading_id', v_reading.id, 'horse_id', v_horse_id,
                           'body_temp', v_reading.body_temp, 'status', v_reading.status);
end $$;

revoke all on function public.submit_reading(text, text, numeric, numeric, text) from public;
grant execute on function public.submit_reading(text, text, numeric, numeric, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. VIEWS (read-only shortcuts for the app screens)
--    security_invoker = true → the caller's security policies still apply
-- ---------------------------------------------------------------------

-- 6.1 Horses screen: each horse + its latest reading + open alerts
create view public.horse_current_status with (security_invoker = true) as
select h.id, h.horse_code, h.name, h.age, h.normal_temp, h.photo_path, h.is_active, h.registered_at,
       r.body_temp   as current_temp,
       r.env_temp    as current_env_temp,
       coalesce(r.status, 'normal'::public.health_status) as status,
       r.recorded_at as last_check,
       (select count(*) from public.alerts a
         where a.horse_id = h.id and a.status in ('active', 'acknowledged'))::int as open_alerts
from public.horses h
left join lateral (
  select body_temp, env_temp, status, recorded_at
  from public.temperature_readings t
  where t.horse_id = h.id
  order by t.recorded_at desc
  limit 1
) r on true;

-- 6.2 History screen: one row per horse per day (Philippine time)
create view public.daily_temperature_summary with (security_invoker = true) as
select t.horse_id,
       (t.recorded_at at time zone 'Asia/Manila')::date                       as day,
       count(*)::int                                                          as reading_count,
       round(avg(t.body_temp), 1)                                             as avg_body_temp,
       max(t.body_temp)                                                       as peak_body_temp,
       min(t.body_temp)                                                       as min_body_temp,
       (array_agg(t.recorded_at order by t.body_temp desc, t.recorded_at))[1] as peak_time,
       round(avg(t.env_temp), 1)                                              as avg_env_temp,
       public.classify_temperature(max(t.body_temp))                          as status
from public.temperature_readings t
group by t.horse_id, (t.recorded_at at time zone 'Asia/Manila')::date;


-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (who can do what)
--    admin        → everything
--    caretaker    → register/edit horses, add readings, handle alerts
--    veterinarian → add readings, handle alerts
--    owner        → read-only
--    Devices submit readings through submit_reading() above.
-- ---------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.system_settings      enable row level security;
alter table public.horses               enable row level security;
alter table public.devices              enable row level security;
alter table public.temperature_readings enable row level security;
alter table public.alerts               enable row level security;

-- profiles
create policy "Signed-in users can view profiles" on public.profiles
  for select to authenticated using (true);
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Admins can update any profile" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- system_settings
create policy "Signed-in users can view settings" on public.system_settings
  for select to authenticated using (true);
create policy "Admins can change settings" on public.system_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- horses
create policy "Signed-in users can view horses" on public.horses
  for select to authenticated using (true);
create policy "Admins and caretakers can register horses" on public.horses
  for insert to authenticated with check (public.get_my_role() in ('admin', 'caretaker'));
create policy "Admins and caretakers can edit horses" on public.horses
  for update to authenticated using (public.get_my_role() in ('admin', 'caretaker'))
  with check (public.get_my_role() in ('admin', 'caretaker'));
create policy "Admins can delete horses" on public.horses
  for delete to authenticated using (public.is_admin());

-- devices (contains secret keys → admin only)
create policy "Admins manage devices" on public.devices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- temperature_readings
create policy "Signed-in users can view readings" on public.temperature_readings
  for select to authenticated using (true);
create policy "Staff can add manual readings" on public.temperature_readings
  for insert to authenticated with check (public.get_my_role() in ('admin', 'caretaker', 'veterinarian'));
create policy "Admins can delete readings" on public.temperature_readings
  for delete to authenticated using (public.is_admin());

-- alerts (inserted only by the trigger)
create policy "Signed-in users can view alerts" on public.alerts
  for select to authenticated using (true);
create policy "Staff can acknowledge or resolve alerts" on public.alerts
  for update to authenticated using (public.get_my_role() in ('admin', 'caretaker', 'veterinarian'))
  with check (public.get_my_role() in ('admin', 'caretaker', 'veterinarian'));
create policy "Admins can delete alerts" on public.alerts
  for delete to authenticated using (public.is_admin());


-- ---------------------------------------------------------------------
-- 8. STORAGE — bucket for horse registration photos & thermal images
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('horse-photos', 'horse-photos', true)
on conflict (id) do nothing;

create policy "Anyone can view horse photos" on storage.objects
  for select using (bucket_id = 'horse-photos');
create policy "Admins and caretakers can upload horse photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'horse-photos' and public.get_my_role() in ('admin', 'caretaker'));
create policy "Admins and caretakers can replace horse photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'horse-photos' and public.get_my_role() in ('admin', 'caretaker'));
create policy "Admins can delete horse photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'horse-photos' and public.is_admin());


-- ---------------------------------------------------------------------
-- 9. REALTIME — push new readings and alerts to the dashboard instantly
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.temperature_readings;
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.horses;

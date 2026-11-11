-- =====================================================================
--  Horse Thermal Monitor — Update 9: readings from thesisv2.py
--  Run once in Supabase → SQL Editor (after 01–08). Safe to re-run.
--
--  thesisv2.py sends at most one reading per confirmed horse per minute through
--  web_link.py → device_submit_reading(). The body temperature is ALREADY FINAL
--  (compensated on the Pi with compensation.json + DHT22), so the database must
--  not add devices.calibration_offset to it again.
-- =====================================================================

-- 1. New columns (humidity may already exist from update 5)
alter table public.temperature_readings
  add column if not exists humidity     numeric(4,1) check (humidity between 0 and 100),
  add column if not exists surface_temp numeric(4,1) check (surface_temp between -10 and 60),
  add column if not exists id_method    text check (id_method in ('fingerprint', 'qr')),
  add column if not exists local_id     bigint;

comment on column public.temperature_readings.surface_temp is 'Raw coat temperature from the thermal camera (inside the horse outline).';
comment on column public.temperature_readings.id_method    is 'How the Pi named the horse: fingerprint or the stall QR plate.';
comment on column public.temperature_readings.local_id     is 'Row id in the Pi''s own horses.db (unique per device): a retried upload is not stored twice.';

-- A reading retried after a network error is stored only once
create unique index if not exists temperature_readings_device_local_unique
  on public.temperature_readings (device_id, local_id);

-- 2. Called BY THE PI (public key + device_key)
create or replace function public.device_submit_reading(
  p_device_key   text,
  p_horse_code   text,
  p_body_temp    numeric,
  p_surface_temp numeric     default null,
  p_env_temp     numeric     default null,
  p_humidity     numeric     default null,
  p_recorded_at  timestamptz default null,
  p_method       text        default null,
  p_local_id     bigint      default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_device  public.devices%rowtype;
  v_horse   uuid;
  v_id      bigint;
  v_status  public.health_status;
  v_dup     boolean := false;
begin
  select * into v_device from public.devices where device_key = p_device_key and is_active;
  if not found then raise exception 'Unknown or inactive device' using errcode = '28000'; end if;

  select id into v_horse from public.horses where upper(horse_code) = upper(trim(p_horse_code)) and is_active;
  if v_horse is null then raise exception 'Unknown horse code: %', p_horse_code using errcode = 'P0002'; end if;

  -- raw_body_temp = body_temp tells prepare_reading() the value is final: no calibration offset added
  insert into public.temperature_readings
         (horse_id, device_id, body_temp, raw_body_temp, surface_temp, env_temp, humidity,
          id_method, local_id, recorded_at)
  values (v_horse, v_device.id, p_body_temp, p_body_temp, p_surface_temp, p_env_temp, p_humidity,
          case when p_method in ('fingerprint', 'qr') then p_method end, p_local_id,
          coalesce(p_recorded_at, now()))
  on conflict (device_id, local_id) do nothing
  returning id, status into v_id, v_status;

  if v_id is null then                       -- already stored earlier (retry after a lost reply)
    v_dup := true;
    select id, status into v_id, v_status from public.temperature_readings
     where device_id = v_device.id and local_id = p_local_id;
  end if;

  update public.devices set last_seen_at = now() where id = v_device.id;

  return json_build_object('reading_id', v_id, 'status', v_status, 'duplicate', v_dup);
end $$;
revoke all on function public.device_submit_reading(text, text, numeric, numeric, numeric, numeric, timestamptz, text, bigint) from public;
grant execute on function public.device_submit_reading(text, text, numeric, numeric, numeric, numeric, timestamptz, text, bigint) to anon, authenticated;

-- 3. Horse cards: latest surface temperature, humidity and how the horse was named
--    (same columns as before, three new ones added at the end)
create or replace view public.horse_current_status with (security_invoker = true) as
select h.id, h.horse_code, h.name, h.age, h.normal_temp, h.photo_path, h.is_active, h.registered_at,
       r.body_temp   as current_temp,
       r.env_temp    as current_env_temp,
       coalesce(r.status, 'normal'::public.health_status) as status,
       r.recorded_at as last_check,
       (select count(*) from public.alerts a
         where a.horse_id = h.id and a.status in ('active', 'acknowledged'))::int as open_alerts,
       r.surface_temp as current_surface_temp,
       r.humidity     as current_humidity,
       r.id_method    as current_id_method
from public.horses h
left join lateral (
  select body_temp, env_temp, status, recorded_at, surface_temp, humidity, id_method
  from public.temperature_readings t
  where t.horse_id = h.id
  order by t.recorded_at desc
  limit 1
) r on true;

select 'Pi readings ready' as result;

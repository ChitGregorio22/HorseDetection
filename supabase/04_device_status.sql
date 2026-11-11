-- =====================================================================
--  Horse Thermal Monitor — Update 4: Raspberry Pi connection indicator
--  Run once in Supabase → SQL Editor (after 01–03). Safe to re-run.
--
--  The Pi calls device_heartbeat() every ~30 s ("I'm alive" + sensor status).
--  The website calls get_device_status() to show Online / Offline.
-- =====================================================================

-- 1. Where the latest status report from each Pi is stored
alter table public.devices
  add column if not exists status jsonb not null default '{}'::jsonb;

comment on column public.devices.status is
  'Latest heartbeat from the Pi: cpu_temp, camera, thermal, dht, uptime, ip, app version…';

-- 2. Called BY THE PI (public key + its secret device_key, no login)
create or replace function public.device_heartbeat(p_device_key text, p_status jsonb default '{}'::jsonb)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_device public.devices%rowtype;
begin
  update public.devices
     set last_seen_at = now(),
         status = coalesce(p_status, '{}'::jsonb)
   where device_key = p_device_key and is_active
  returning * into v_device;

  if not found then
    raise exception 'Unknown or inactive device' using errcode = '28000';
  end if;

  return json_build_object('device', v_device.name, 'last_seen_at', v_device.last_seen_at);
end $$;

revoke all on function public.device_heartbeat(text, jsonb) from public;
grant execute on function public.device_heartbeat(text, jsonb) to anon, authenticated;

-- 3. Called BY THE WEBSITE (any signed-in user). Never returns the secret device_key.
create or replace function public.get_device_status()
returns table (
  id uuid,
  name text,
  location text,
  last_seen_at timestamptz,
  seconds_since_seen integer,
  online boolean,
  status jsonb
)
language sql stable security definer set search_path = public
as $$
  select d.id, d.name, d.location, d.last_seen_at,
         extract(epoch from (now() - d.last_seen_at))::int,
         coalesce(d.last_seen_at > now() - interval '90 seconds', false),
         d.status
  from public.devices d
  where d.is_active and auth.uid() is not null
  order by d.name
$$;

revoke all on function public.get_device_status() from public;
grant execute on function public.get_device_status() to authenticated;

-- Check: lists your devices (run as admin in the SQL Editor shows all)
select name, last_seen_at, status from public.devices;

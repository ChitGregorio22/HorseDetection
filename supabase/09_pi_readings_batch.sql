-- =====================================================================
--  Horse Thermal Monitor — Update 9: readings from the Pi in batches
--  Run once in Supabase → SQL Editor, AFTER 08_pi_readings.sql. Safe to re-run.
--  Does NOT recreate anything from 08: it only adds what is missing.
--
--  The Pi's horses.db decides what still has to be sent: every 5 s it hands web_link.py
--  up to 30 unsent readings and marks a reading as sent only when this function says ok.
--  So: a reading the website already has (same device + local_id) counts as OK,
--  the reading's own recorded_at is used (readings from an outage can be days old),
--  and body_temp is final (no calibration offset added).
-- =====================================================================

-- 1. Only if 08 is somehow missing a piece (normally all of these already exist: nothing happens)
alter table public.temperature_readings
  add column if not exists humidity     numeric(4,1),
  add column if not exists surface_temp numeric(4,1),
  add column if not exists id_method    text,
  add column if not exists local_id     bigint;

do $$
begin
  -- a unique index on exactly (device_id, local_id), whatever 08 named it
  if not exists (
    select 1
      from pg_index i
      join pg_class t on t.oid = i.indrelid and t.relname = 'temperature_readings'
      join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
     where i.indisunique and i.indpred is null
       and (select array_agg(a.attname::text order by k.ord)
              from unnest(i.indkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum) = array['device_id', 'local_id']
  ) then
    create unique index temperature_readings_device_local_unique
      on public.temperature_readings (device_id, local_id);
  end if;
end $$;

-- 2. Batch RPC, called BY THE PI (public key + device_key)
--    p_readings = [{"local_id":1234,"horse_code":"HTM-…","body_temp":37.84,"surface_temp":33.1,
--                   "air_temp":26.4,"humidity":78,"recorded_at":"2026-11-11T20:45:52+08:00","method":"fingerprint"}, …]
--    returns     [{"local_id":1234,"ok":true}, {"local_id":1235,"ok":false,"error":"Unknown horse code: HTM-…"}, …]
create or replace function public.device_submit_readings(p_device_key text, p_readings jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_device  public.devices%rowtype;
  r         jsonb;
  v_out     jsonb := '[]'::jsonb;
  v_local   bigint;
  v_horse   uuid;
  v_body    numeric;
  v_rec     timestamptz;
  v_id      bigint;
  v_method  text;
begin
  -- device key checked ONCE for the whole batch
  select * into v_device from public.devices where device_key = p_device_key and is_active;
  if not found then raise exception 'Unknown or inactive device' using errcode = '28000'; end if;
  if p_readings is null or jsonb_typeof(p_readings) <> 'array' then
    raise exception 'p_readings must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_readings) > 500 then
    raise exception 'Too many readings in one call (max 500)' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_readings) loop
    begin                                         -- one bad reading never stops the others
      v_local := nullif(r ->> 'local_id', '')::bigint;

      select id into v_horse from public.horses
       where upper(horse_code) = upper(trim(r ->> 'horse_code')) and is_active;
      if v_horse is null then
        v_out := v_out || jsonb_build_object('local_id', r -> 'local_id', 'ok', false,
                                             'error', 'Unknown horse code: ' || coalesce(r ->> 'horse_code', '(none)'));
        continue;
      end if;

      v_body := nullif(r ->> 'body_temp', '')::numeric;
      if v_body is null then
        v_out := v_out || jsonb_build_object('local_id', r -> 'local_id', 'ok', false, 'error', 'body_temp missing');
        continue;
      end if;

      if v_body < 30 or v_body > 45 then
        v_out := v_out || jsonb_build_object('local_id', r -> 'local_id', 'ok', false,
                                             'error', format('body_temp %s is outside 30-45 C', v_body));
        continue;
      end if;

      -- the reading's OWN time (an outage backlog can be days old); a Pi clock ahead of real time is capped to now
      v_rec := least(coalesce(nullif(r ->> 'recorded_at', '')::timestamptz, now()), now());
      v_method := case when r ->> 'method' in ('fingerprint', 'qr') then r ->> 'method' end;

      -- already stored (sent before, reply lost) → OK, not an error
      if v_local is not null and exists (select 1 from public.temperature_readings
                                          where device_id = v_device.id and local_id = v_local) then
        v_out := v_out || jsonb_build_object('local_id', r -> 'local_id', 'ok', true, 'duplicate', true);
        continue;
      end if;

      -- raw_body_temp = body_temp tells prepare_reading() the value is final: no calibration offset
      insert into public.temperature_readings
             (horse_id, device_id, body_temp, raw_body_temp, surface_temp, env_temp, humidity,
              id_method, local_id, recorded_at)
      values (v_horse, v_device.id, v_body, v_body,
              nullif(r ->> 'surface_temp', '')::numeric,
              nullif(r ->> 'air_temp', '')::numeric,
              nullif(r ->> 'humidity', '')::numeric,
              v_method, v_local, v_rec)
      on conflict do nothing                      -- sent twice at the same moment → still OK
      returning id into v_id;

      v_out := v_out || case when v_id is null
                             then jsonb_build_object('local_id', r -> 'local_id', 'ok', true, 'duplicate', true)
                             else jsonb_build_object('local_id', r -> 'local_id', 'ok', true) end;
    exception when others then                    -- e.g. temperature outside the allowed range
      v_out := v_out || jsonb_build_object('local_id', r -> 'local_id', 'ok', false, 'error', sqlerrm);
    end;
  end loop;

  update public.devices set last_seen_at = now() where id = v_device.id;
  return v_out;
end $$;

revoke all on function public.device_submit_readings(text, jsonb) from public;
grant execute on function public.device_submit_readings(text, jsonb) to anon, authenticated;

select 'batch readings ready' as result;

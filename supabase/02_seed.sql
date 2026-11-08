-- =====================================================================
--  Horse Thermal Monitor — File 2 of 2: DEMO DATA (optional)
--  Run AFTER 01_schema.sql. Creates 4 horses, 1 demo camera, and
--  7 days of readings every 30 minutes. Fever alerts are generated
--  automatically by the triggers, exactly as with real data.
-- =====================================================================

-- Demo thermal camera. CHANGE this key before real deployment.
insert into public.devices (name, location, device_key, last_calibrated_at)
values ('Stall Camera 1', 'Main stable, stall row A', 'demo-device-key-change-me', now() - interval '3 days');

-- Horses (matching the names used in the app mockups)
insert into public.horses (horse_code, name, age, normal_temp, registered_at) values
  ('HTM-THUNDER1', 'Thunder',   5, 37.2, now() - interval '30 days'),
  ('HTM-LIGHTNG1', 'Lightning', 7, 37.0, now() - interval '30 days'),
  ('HTM-STORM001', 'Storm',     4, 37.3, now() - interval '30 days'),
  ('HTM-BLAZE001', 'Blaze',     6, 37.1, now() - interval '30 days');

-- 7 days of readings, every 30 minutes, ending now
select setseed(0.42);

with times as (
  select ts
  from generate_series(date_trunc('hour', now()) - interval '7 days',
                       date_trunc('hour', now()), interval '30 minutes') as ts
),
shaped as (
  select h.id as horse_id, h.name, t.ts,
         extract(epoch from (t.ts - (date_trunc('hour', now()) - interval '7 days'))) / 86400.0 as day_n,
         sin(2 * pi() * (extract(hour from t.ts at time zone 'Asia/Manila') - 9) / 24.0)   as diurnal
  from public.horses h cross join times t
)
insert into public.temperature_readings (horse_id, device_id, body_temp, env_temp, recorded_at)
select s.horse_id,
       (select id from public.devices limit 1),
       round((case s.name
         -- Thunder: slowly climbing into fever over the week
         when 'Thunder'   then 37.1 + 0.17 * s.day_n + 0.15 * s.diurnal + (random() - 0.5) * 0.2
         -- Lightning: healthy and steady
         when 'Lightning' then 37.0 + 0.15 * s.diurnal + (random() - 0.5) * 0.25
         -- Storm: borderline, sometimes in the warning range
         when 'Storm'     then 37.3 + 0.2 * s.diurnal + (random() - 0.5) * 0.3
         -- Blaze: short fever spike on day 2, then recovered
         when 'Blaze'     then 37.1 + 0.12 * s.diurnal + (random() - 0.5) * 0.2
                               + greatest(0, 1.2 - abs(s.day_n - 2.2) * 3)
       end)::numeric, 1),
       round((27 + 3.5 * s.diurnal + (random() - 0.5) * 1.5)::numeric, 1),
       s.ts
from shaped s
order by s.ts;

-- Blaze recovered: mark that alert as handled by the vet
update public.alerts a
   set status = 'resolved',
       acknowledged_at = a.created_at + interval '20 minutes',
       resolved_at     = a.created_at + interval '1 day',
       notes = 'Checked by vet. Mild infection treated; temperature back to normal.'
  from public.horses h
 where a.horse_id = h.id and h.name = 'Blaze';

-- Quick check: what was created
select h.name, s.status, s.current_temp, s.open_alerts
from public.horse_current_status s join public.horses h using (id)
order by h.name;

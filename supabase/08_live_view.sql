-- =====================================================================
--  Horse Thermal Monitor — Update 8: live view from the Pi
--  Run once in Supabase → SQL Editor (after 01–07). Safe to re-run.
--
--  Every ~2 s the Pi (thesisv2.py --web) reports what the camera sees right now:
--  which horse is in the stall, how sure it is, its temperature, air temp and humidity.
--  The Dashboard follows it live and switches to the identified horse.
-- =====================================================================

create table if not exists public.live_view (
  device_id   uuid primary key references public.devices (id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
comment on table public.live_view is
  'What each Pi sees right now (horse in the stall, ID confidence, temperatures). Overwritten every ~2 s.';

alter table public.live_view enable row level security;
drop policy if exists "Approved users can view the live state" on public.live_view;
create policy "Approved users can view the live state" on public.live_view
  for select to authenticated using (public.is_approved());

-- Called BY THE PI (public key + device_key)
create or replace function public.device_live(p_device_key text, p_state jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key);
begin
  insert into public.live_view (device_id, state, updated_at)
  values (v_dev, coalesce(p_state, '{}'::jsonb), now())
  on conflict (device_id) do update set state = excluded.state, updated_at = now();
  update public.devices set last_seen_at = now() where id = v_dev;
end $$;
revoke all on function public.device_live(text, jsonb) from public;
grant execute on function public.device_live(text, jsonb) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.live_view;
exception when duplicate_object then null;
end $$;

select 'live_view ready' as result;

-- =====================================================================
--  Horse Thermal Monitor — Update 7: register horses from the website
--  through the Raspberry Pi's stall camera. Run once (after 01–06). Safe to re-run.
--
--  1. Owner/admin fills in name, age, normal temp on the website → a request (pending)
--  2. horse_monitor.py (--web) on the Pi takes it → runs the 30-photo fingerprint
--     registration, reporting progress → the website shows it live
--  3. When done, the Pi creates the horse (with its photo) → website shows QR code
-- =====================================================================

create table if not exists public.registration_requests (
  id            bigint generated always as identity primary key,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  age           integer check (age between 1 and 40),
  normal_temp   numeric(4,1) not null default 37.2 check (normal_temp between 35 and 40),
  force         boolean not null default false,       -- "register anyway" even if it looks like another horse
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  progress      jsonb not null default '{}'::jsonb,   -- photos, needed, views, note … from the Pi
  message       text,
  horse_id      uuid references public.horses (id) on delete set null,
  device_id     uuid references public.devices (id) on delete set null,
  requested_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.registration_requests is
  'Horse registrations started on the website and carried out by the Pi camera (horse_monitor.py --web).';

-- only one registration at a time (the stall camera can only do one)
create unique index if not exists registration_requests_one_active
  on public.registration_requests ((true)) where status in ('pending', 'running');

drop trigger if exists registration_requests_updated_at on public.registration_requests;
create trigger registration_requests_updated_at before update on public.registration_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- security
alter table public.registration_requests enable row level security;

drop policy if exists "Approved users can view registrations"      on public.registration_requests;
drop policy if exists "Owners and admins can start registrations"  on public.registration_requests;
drop policy if exists "Owners and admins can cancel registrations" on public.registration_requests;
create policy "Approved users can view registrations" on public.registration_requests
  for select to authenticated using (public.is_approved());
create policy "Owners and admins can start registrations" on public.registration_requests
  for insert to authenticated with check (public.can_manage() and status = 'pending');
create policy "Owners and admins can cancel registrations" on public.registration_requests
  for update to authenticated using (public.can_manage()) with check (public.can_manage() and status = 'cancelled');

-- website check before starting: name must not belong to an active horse already
create or replace function public.check_registration_request()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.horses where is_active and lower(trim(name)) = lower(trim(new.name))) then
    raise exception 'A horse named % is already registered. Each name can only be used for one horse.', trim(new.name)
      using errcode = '23505';
  end if;
  new.name := trim(new.name);
  return new;
end $$;

drop trigger if exists registration_requests_check on public.registration_requests;
create trigger registration_requests_check before insert on public.registration_requests
  for each row execute function public.check_registration_request();

-- ---------------------------------------------------------------- Pi functions (public key + device_key)
create or replace function public._device_id(p_device_key text)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare v uuid;
begin
  select id into v from public.devices where device_key = p_device_key and is_active;
  if v is null then raise exception 'Unknown or inactive device' using errcode = '28000'; end if;
  return v;
end $$;
revoke all on function public._device_id(text) from public, anon, authenticated;

-- Pi asks: "anything to register?" → returns the request (now 'running') or null
create or replace function public.device_take_registration(p_device_key text)
returns json language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key); r public.registration_requests%rowtype;
begin
  update public.devices set last_seen_at = now() where id = v_dev;
  -- a request this Pi already started (e.g. after a restart) is handed back first
  select * into r from public.registration_requests
   where status = 'running' and device_id = v_dev order by id limit 1;
  if not found then
    update public.registration_requests
       set status = 'running', device_id = v_dev, message = 'Starting on the Pi…'
     where id = (select id from public.registration_requests where status = 'pending'
                 order by id limit 1 for update skip locked)
    returning * into r;
  end if;
  if r.id is null then return null; end if;
  return json_build_object('id', r.id, 'name', r.name, 'age', r.age,
                           'normal_temp', r.normal_temp, 'force', r.force);
end $$;

-- Pi reports progress / failure. Returns the request's status, so the Pi learns about 'cancelled'.
create or replace function public.device_update_registration(
  p_device_key text, p_id bigint, p_status text default 'running',
  p_progress jsonb default null, p_message text default null)
returns text language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key); v_status text;
begin
  if p_status not in ('running', 'failed', 'cancelled') then
    raise exception 'Bad status %', p_status;
  end if;
  update public.registration_requests
     set status   = case when status = 'running' then p_status else status end,
         progress = coalesce(p_progress, progress),
         message  = coalesce(p_message, message)
   where id = p_id and device_id = v_dev
  returning status into v_status;
  update public.devices set last_seen_at = now() where id = v_dev;
  return coalesce(v_status, 'missing');
end $$;

-- Pi finished: create the horse (or update the photo of the active horse with that name).
-- p_photo = small JPEG as a data URL ("data:image/jpeg;base64,…"). Returns the horse_code.
create or replace function public.device_register_horse(
  p_device_key text, p_name text, p_age integer default null, p_normal_temp numeric default 37.2,
  p_photo text default null, p_request_id bigint default null, p_photos integer default null)
returns json language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key); h public.horses%rowtype;
begin
  if p_photo is not null and (p_photo not like 'data:image/%' or length(p_photo) > 400000) then
    raise exception 'Photo must be a small data:image/… (under ~300 KB)';
  end if;
  select * into h from public.horses where is_active and lower(trim(name)) = lower(trim(p_name)) limit 1;
  if found then
    update public.horses set photo_path = coalesce(p_photo, photo_path) where id = h.id returning * into h;
  else
    insert into public.horses (name, age, normal_temp, photo_path)
    values (trim(p_name), p_age, coalesce(p_normal_temp, 37.2), p_photo)
    returning * into h;
  end if;
  if p_request_id is not null then
    update public.registration_requests
       set status = 'done', horse_id = h.id,
           message = format('%s registered with %s photos', h.name, coalesce(p_photos::text, 'the')),
           progress = progress || jsonb_build_object('done', true)
     where id = p_request_id and device_id = v_dev;
  end if;
  update public.devices set last_seen_at = now() where id = v_dev;
  return json_build_object('horse_id', h.id, 'horse_code', h.horse_code, 'name', h.name);
end $$;

revoke all on function public.device_take_registration(text) from public;
revoke all on function public.device_update_registration(text, bigint, text, jsonb, text) from public;
revoke all on function public.device_register_horse(text, text, integer, numeric, text, bigint, integer) from public;
grant execute on function public.device_take_registration(text) to anon, authenticated;
grant execute on function public.device_update_registration(text, bigint, text, jsonb, text) to anon, authenticated;
grant execute on function public.device_register_horse(text, text, integer, numeric, text, bigint, integer) to anon, authenticated;

-- a request that the Pi never picked up or that stopped reporting is cleaned up after 15 minutes
create or replace function public.expire_stale_registrations()
returns void language sql security definer set search_path = public
as $$
  update public.registration_requests
     set status = 'failed', message = 'The Pi stopped responding. Check that horse_monitor.py is running with --web.'
   where status in ('pending', 'running') and updated_at < now() - interval '15 minutes';
$$;
grant execute on function public.expire_stale_registrations() to authenticated;

-- ---------------------------------------------------------------- live updates on the website
do $$
begin
  alter publication supabase_realtime add table public.registration_requests;
exception when duplicate_object then null;
end $$;

select 'registration_requests ready' as result;

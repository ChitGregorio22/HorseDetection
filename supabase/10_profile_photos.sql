-- =====================================================================
--  Horse Thermal Monitor — Update 10: profile photos from the stall camera
--  Run once in Supabase → SQL Editor (after 01–09). Safe to re-run.
--
--  * At the end of a registration the Pi sends up to 6 whole-camera pictures of the horse
--    (about 1280 px, JPEG): the owner picks the profile photo on the website.
--  * "Take profile photo" on the horse profile: the website asks, the Pi takes the picture
--    when that horse is the confirmed horse in the stall (or the p key at the Pi).
--
--  Where the pictures live: in the table horse_photos (one row per picture, JPEG as a data URL).
--  The Pi only has the public key + device key, so it can't write to Storage safely; a database
--  function can check the device key. Each picture is sent in its own call (< 1.5 MB).
--  horses.photo_path keeps a small thumbnail (~400 px) so the horse list stays light.
-- =====================================================================

-- 1. Pictures
create table if not exists public.horse_photos (
  id          bigint generated always as identity primary key,
  horse_id    uuid not null references public.horses (id) on delete cascade,
  image       text not null check (image like 'data:image/%' and length(image) < 1500000),  -- ~1280 px
  thumb       text check (thumb like 'data:image/%' and length(thumb) < 200000),           -- ~400 px
  source      text not null default 'registration' check (source in ('registration', 'website', 'pi_key')),
  view        text,                                  -- angled / side / front-back (from registration)
  width       integer,
  height      integer,
  created_at  timestamptz not null default now()
);
create index if not exists horse_photos_horse_idx on public.horse_photos (horse_id, created_at desc);
comment on table public.horse_photos is 'Whole-camera pictures of each horse; one is the profile photo (horses.profile_photo_id).';

alter table public.horses add column if not exists profile_photo_id bigint references public.horse_photos (id) on delete set null;

alter table public.horse_photos enable row level security;
drop policy if exists "Approved users can view horse photos" on public.horse_photos;
create policy "Approved users can view horse photos" on public.horse_photos
  for select to authenticated using (public.is_approved());
drop policy if exists "Owners and admins can delete horse photos" on public.horse_photos;
create policy "Owners and admins can delete horse photos" on public.horse_photos
  for delete to authenticated using (public.can_manage());

-- 2. "Take profile photo" requests (website → Pi)
create table if not exists public.photo_requests (
  id            bigint generated always as identity primary key,
  horse_id      uuid not null references public.horses (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  message       text,
  photo_id      bigint references public.horse_photos (id) on delete set null,
  device_id     uuid references public.devices (id) on delete set null,
  requested_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.photo_requests enable row level security;
drop policy if exists "Approved users can view photo requests" on public.photo_requests;
create policy "Approved users can view photo requests" on public.photo_requests
  for select to authenticated using (public.is_approved());
drop policy if exists "Owners and admins can ask for a photo" on public.photo_requests;
create policy "Owners and admins can ask for a photo" on public.photo_requests
  for insert to authenticated with check (public.can_manage() and status = 'pending');
drop policy if exists "Owners and admins can cancel a photo request" on public.photo_requests;
create policy "Owners and admins can cancel a photo request" on public.photo_requests
  for update to authenticated using (public.can_manage()) with check (status = 'cancelled');

-- requests nobody answered (Pi off, or an older script) end by themselves after 2 minutes
create or replace function public.expire_photo_requests()
returns void language sql security definer set search_path = public
as $$
  update public.photo_requests
     set status = 'failed', updated_at = now(),
         message = 'The Pi didn''t answer. Is thesisv2.py running with --web?'
   where status in ('pending', 'running') and created_at < now() - interval '2 minutes';
$$;
grant execute on function public.expire_photo_requests() to authenticated;

-- 3. Called BY THE PI (public key + device_key)

-- Next "Take profile photo" request, or null
create or replace function public.device_take_photo_request(p_device_key text)
returns json language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key); r public.photo_requests%rowtype; v_code text;
begin
  perform public.expire_photo_requests();
  update public.photo_requests set status = 'running', device_id = v_dev, updated_at = now()
   where id = (select id from public.photo_requests where status = 'pending' order by created_at limit 1
               for update skip locked)
  returning * into r;
  if r.id is null then return null; end if;
  select horse_code into v_code from public.horses where id = r.horse_id;
  return json_build_object('id', r.id, 'horse_code', v_code);
end $$;

-- The Pi couldn't take it ("Jafar is not the confirmed horse in the stall right now")
create or replace function public.device_fail_photo_request(p_device_key text, p_id bigint, p_message text)
returns void language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key);
begin
  update public.photo_requests
     set status = 'failed', message = left(coalesce(p_message, 'The Pi could not take the photo.'), 300), updated_at = now()
   where id = p_id and status in ('pending', 'running');
end $$;

-- One picture of a horse. p_make_profile = it becomes the profile photo (and the card thumbnail).
-- p_request_id = it answers a "Take profile photo" request.
create or replace function public.device_add_horse_photo(
  p_device_key   text,
  p_horse_code   text,
  p_image        text,
  p_thumb        text    default null,
  p_source       text    default 'registration',
  p_view         text    default null,
  p_width        integer default null,
  p_height       integer default null,
  p_make_profile boolean default false,
  p_request_id   bigint  default null
)
returns json language plpgsql security definer set search_path = public
as $$
declare v_dev uuid := public._device_id(p_device_key); v_horse uuid; v_id bigint;
begin
  select id into v_horse from public.horses where upper(horse_code) = upper(trim(p_horse_code));
  if v_horse is null then raise exception 'Unknown horse code: %', p_horse_code using errcode = 'P0002'; end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) >= 1500000 then
    raise exception 'Photo missing or too big (max ~1.1 MB JPEG)' using errcode = '22023';
  end if;

  insert into public.horse_photos (horse_id, image, thumb, source, view, width, height)
  values (v_horse, p_image, p_thumb,
          case when p_source in ('registration', 'website', 'pi_key') then p_source else 'registration' end,
          p_view, p_width, p_height)
  returning id into v_id;

  if p_make_profile then
    update public.horses set profile_photo_id = v_id, photo_path = coalesce(p_thumb, photo_path) where id = v_horse;
  end if;
  if p_request_id is not null then
    update public.photo_requests set status = 'done', photo_id = v_id, message = 'New profile photo saved.',
           updated_at = now()
     where id = p_request_id;
  end if;
  update public.devices set last_seen_at = now() where id = v_dev;
  return json_build_object('photo_id', v_id);
end $$;

revoke all on function public.device_take_photo_request(text) from public;
revoke all on function public.device_fail_photo_request(text, bigint, text) from public;
revoke all on function public.device_add_horse_photo(text, text, text, text, text, text, integer, integer, boolean, bigint) from public;
grant execute on function public.device_take_photo_request(text) to anon, authenticated;
grant execute on function public.device_fail_photo_request(text, bigint, text) to anon, authenticated;
grant execute on function public.device_add_horse_photo(text, text, text, text, text, text, integer, integer, boolean, bigint) to anon, authenticated;

-- 4. Called BY THE WEBSITE (owner / admin): pick one of the saved pictures as the profile photo
create or replace function public.set_profile_photo(p_horse_id uuid, p_photo_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare v_thumb text;
begin
  if not public.can_manage() then
    raise exception 'Only an owner or admin can change the profile photo.' using errcode = '42501';
  end if;
  select coalesce(thumb, image) into v_thumb from public.horse_photos where id = p_photo_id and horse_id = p_horse_id;
  if not found then raise exception 'That photo does not belong to this horse.' using errcode = 'P0002'; end if;
  update public.horses set profile_photo_id = p_photo_id, photo_path = v_thumb where id = p_horse_id;
end $$;
revoke all on function public.set_profile_photo(uuid, bigint) from public;
grant execute on function public.set_profile_photo(uuid, bigint) to authenticated;

-- table access for signed-in users (Supabase usually grants this by itself; row rules above still apply)
grant select, delete on public.horse_photos to authenticated;
grant select, insert, update on public.photo_requests to authenticated;

-- 5. Realtime: the website sees the new photo / request status straight away
do $$
begin
  alter publication supabase_realtime add table public.photo_requests;
exception when duplicate_object then null;
end $$;

select 'profile photos ready' as result;

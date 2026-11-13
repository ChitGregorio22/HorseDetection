-- =====================================================================
--  Horse Thermal Monitor — Update 11: photos added on the website
--  Run once in Supabase → SQL Editor (after 10_profile_photos.sql). Safe to re-run.
--
--  Owners and admins can add up to 3 photos per horse on the website:
--    'upload' = picked from the phone / computer,  'device' = taken with this device's camera.
--  Pictures from the Pi (registration / stall camera / p key) don't count toward the 3.
-- =====================================================================

-- 1. New kinds of photo
alter table public.horse_photos drop constraint if exists horse_photos_source_check;
alter table public.horse_photos add constraint horse_photos_source_check
  check (source in ('registration', 'website', 'pi_key', 'upload', 'device'));
alter table public.horse_photos add column if not exists added_by uuid references public.profiles (id) on delete set null;

-- 2. Add a photo from the website (owner / admin)
create or replace function public.add_horse_photo(
  p_horse_id     uuid,
  p_image        text,
  p_thumb        text,
  p_source       text    default 'upload',
  p_width        integer default null,
  p_height       integer default null,
  p_make_profile boolean default false
)
returns json language plpgsql security definer set search_path = public
as $$
declare v_id bigint; v_count int; v_has_profile boolean;
begin
  if not public.can_manage() then
    raise exception 'Only an owner or admin can add photos.' using errcode = '42501';
  end if;
  if p_source not in ('upload', 'device') then
    raise exception 'Unknown photo source.' using errcode = '22023';
  end if;
  if p_image is null or p_image not like 'data:image/%' or length(p_image) >= 1500000 then
    raise exception 'Photo missing or too big.' using errcode = '22023';
  end if;
  perform 1 from public.horses where id = p_horse_id for update;   -- one upload at a time per horse
  if not found then raise exception 'Horse not found.' using errcode = 'P0002'; end if;

  select count(*) into v_count from public.horse_photos
   where horse_id = p_horse_id and source in ('upload', 'device');
  if v_count >= 3 then
    raise exception 'This horse already has 3 photos added on the website. Delete one first.' using errcode = '23514';
  end if;

  insert into public.horse_photos (horse_id, image, thumb, source, width, height, added_by)
  values (p_horse_id, p_image, p_thumb, p_source, p_width, p_height, auth.uid())
  returning id into v_id;

  select profile_photo_id is not null into v_has_profile from public.horses where id = p_horse_id;
  if p_make_profile or not v_has_profile then
    update public.horses set profile_photo_id = v_id, photo_path = coalesce(p_thumb, p_image) where id = p_horse_id;
  end if;
  return json_build_object('photo_id', v_id, 'website_photos', v_count + 1);
end $$;
revoke all on function public.add_horse_photo(uuid, text, text, text, integer, integer, boolean) from public;
grant execute on function public.add_horse_photo(uuid, text, text, text, integer, integer, boolean) to authenticated;

-- 3. Delete a photo (owner / admin). If it was the profile photo, the newest other photo takes over.
create or replace function public.delete_horse_photo(p_photo_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
declare v_horse uuid; v_was_profile boolean; v_next record;
begin
  if not public.can_manage() then
    raise exception 'Only an owner or admin can delete photos.' using errcode = '42501';
  end if;
  select p.horse_id, (h.profile_photo_id = p.id) into v_horse, v_was_profile
    from public.horse_photos p join public.horses h on h.id = p.horse_id where p.id = p_photo_id;
  if v_horse is null then return; end if;

  delete from public.horse_photos where id = p_photo_id;

  if coalesce(v_was_profile, false) then
    select id, coalesce(thumb, image) as pic into v_next from public.horse_photos
     where horse_id = v_horse order by created_at desc, id desc limit 1;
    update public.horses set profile_photo_id = v_next.id, photo_path = v_next.pic where id = v_horse;
  end if;
end $$;
revoke all on function public.delete_horse_photo(bigint) from public;
grant execute on function public.delete_horse_photo(bigint) to authenticated;

select 'photo uploads ready' as result;

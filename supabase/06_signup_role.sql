-- =====================================================================
--  Horse Thermal Monitor — Update 6: choose a role when signing up
--  Run once in Supabase → SQL Editor (after 05). Safe to re-run.
--
--  The Sign Up form asks: Owner, Caretaker or Veterinarian.
--  That choice is saved as the account's role, but the account still
--  starts UNAPPROVED — an admin confirms it on the Users page.
--  Nobody can sign up as admin.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_role public.user_role := 'caretaker';
begin
  if new.raw_user_meta_data ->> 'role' in ('owner', 'caretaker', 'veterinarian') then
    v_role := (new.raw_user_meta_data ->> 'role')::public.user_role;
  end if;

  insert into public.profiles (id, full_name, role, approved)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
          v_role,
          false)
  on conflict (id) do nothing;
  return new;
end $$;

-- Check: the newest accounts and the role they asked for
select u.email, p.full_name, p.role, p.approved
from public.profiles p join auth.users u on u.id = p.id
order by u.created_at desc
limit 5;

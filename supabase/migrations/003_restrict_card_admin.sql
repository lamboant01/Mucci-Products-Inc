-- Restrict the card administration tables and setup RPC to one administrator.
create or replace function public.is_mucci_card_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'anthony@mucciproducts.com';
$$;

revoke all on function public.is_mucci_card_admin() from public;
grant execute on function public.is_mucci_card_admin() to authenticated;

drop policy if exists "owners read own profiles" on public.profiles;
drop policy if exists "owners update own profiles" on public.profiles;
drop policy if exists "owners read cards for own profiles" on public.physical_cards;

create policy "admin reads own profiles" on public.profiles for select to authenticated
  using (public.is_mucci_card_admin() and owner_user_id = auth.uid());
create policy "admin updates own profiles" on public.profiles for update to authenticated
  using (public.is_mucci_card_admin() and owner_user_id = auth.uid())
  with check (public.is_mucci_card_admin() and owner_user_id = auth.uid());
create policy "admin reads cards for own profiles" on public.physical_cards for select to authenticated
  using (
    public.is_mucci_card_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.owner_user_id = auth.uid()
    )
  );

drop policy if exists "owners upload to own asset folder" on storage.objects;
drop policy if exists "owners update own asset folder" on storage.objects;
drop policy if exists "owners delete from own asset folder" on storage.objects;

create policy "admin uploads card assets" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'card-assets'
    and public.is_mucci_card_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "admin updates card assets" on storage.objects for update to authenticated
  using (
    bucket_id = 'card-assets'
    and public.is_mucci_card_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'card-assets'
    and public.is_mucci_card_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "admin deletes card assets" on storage.objects for delete to authenticated
  using (
    bucket_id = 'card-assets'
    and public.is_mucci_card_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.create_my_digital_card(
  p_name text,
  p_company text default null,
  p_title text default null,
  p_phone text default null,
  p_email text default null,
  p_website text default null,
  p_linkedin text default null,
  p_instagram text default null,
  p_address text default null,
  p_bio text default null
)
returns table(profile_id uuid, card_id uuid, public_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_profile_id uuid;
  created_card_id uuid;
  created_token text;
begin
  if auth.uid() is null or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'anthony@mucciproducts.com' then
    raise exception 'Administrator access required';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name is required'; end if;
  insert into public.profiles (
    owner_user_id, name, company, title, phone, email, website, linkedin, instagram, address, bio
  ) values (
    auth.uid(), trim(p_name), nullif(trim(p_company), ''), nullif(trim(p_title), ''),
    nullif(trim(p_phone), ''), nullif(trim(p_email), ''), nullif(trim(p_website), ''),
    nullif(trim(p_linkedin), ''), nullif(trim(p_instagram), ''), nullif(trim(p_address), ''),
    nullif(trim(p_bio), '')
  ) returning id into created_profile_id;

  insert into public.physical_cards (profile_id, card_label)
  values (created_profile_id, 'Primary card')
  returning id, physical_cards.public_token into created_card_id, created_token;

  return query select created_profile_id, created_card_id, created_token;
end;
$$;

revoke all on function public.create_my_digital_card(text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_my_digital_card(text,text,text,text,text,text,text,text,text,text) to authenticated;

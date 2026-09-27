-- Move all Mucci administration behind the Vercel server authorization layer.
-- Browser-authenticated users keep no direct administrator table or RPC access.

drop policy if exists "admin reads own profiles" on public.profiles;
drop policy if exists "admin updates own profiles" on public.profiles;
drop policy if exists "admin reads cards for own profiles" on public.physical_cards;
drop policy if exists "admin uploads card assets" on storage.objects;
drop policy if exists "admin updates card assets" on storage.objects;
drop policy if exists "admin deletes card assets" on storage.objects;
drop policy if exists "admin reads print estimates" on public.print_estimates;
drop policy if exists "admin updates print estimates" on public.print_estimates;
drop policy if exists "admin reads print estimate files" on storage.objects;
drop policy if exists "admin reads Etsy listing preparations" on public.etsy_listing_preparations;

revoke select, update on public.profiles from authenticated;
revoke select on public.physical_cards from authenticated;
revoke select, update on public.print_estimates from authenticated;
revoke select on public.etsy_listing_preparations from authenticated;

revoke all on function public.create_my_digital_card(text,text,text,text,text,text,text,text,text,text) from authenticated;
revoke all on function public.admin_find_print_estimate(text) from authenticated;
revoke all on function public.admin_recent_print_estimates(text,boolean) from authenticated;
revoke all on function public.admin_save_print_estimate_review(uuid,numeric,integer,text,text,text) from authenticated;
revoke all on function public.admin_set_print_estimate_status(uuid,text) from authenticated;
revoke all on function public.admin_prepare_etsy_listing(uuid,text,text,numeric,integer,integer,text) from authenticated;

-- This helper is no longer an email authorization check. It is retained only
-- for the existing RPC bodies, which are callable solely with the service role.
create or replace function public.is_mucci_card_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

revoke all on function public.is_mucci_card_admin() from public, anon, authenticated;
grant execute on function public.is_mucci_card_admin() to service_role;
grant execute on function public.admin_find_print_estimate(text) to service_role;
grant execute on function public.admin_recent_print_estimates(text,boolean) to service_role;
grant execute on function public.admin_save_print_estimate_review(uuid,numeric,integer,text,text,text) to service_role;
grant execute on function public.admin_set_print_estimate_status(uuid,text) to service_role;

drop function if exists public.admin_prepare_etsy_listing(uuid,text,text,numeric,integer,integer,text);

create function public.admin_prepare_etsy_listing(
  p_estimate_id uuid, p_generated_title text, p_generated_description text,
  p_final_price numeric, p_listing_quantity integer, p_physical_quantity integer,
  p_processing_time text, p_generated_by uuid
)
returns setof public.etsy_listing_preparations
language plpgsql volatile security definer set search_path = '' as $$
declare saved public.etsy_listing_preparations;
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if p_generated_title is null or char_length(trim(p_generated_title)) not between 1 and 140 then raise exception 'Invalid Etsy title'; end if;
  if p_generated_description is null or char_length(trim(p_generated_description)) not between 1 and 10000 then raise exception 'Invalid Etsy description'; end if;
  if p_final_price is null or p_final_price <= 0 or p_final_price <> round(p_final_price, 2) then raise exception 'Invalid final price'; end if;
  if p_listing_quantity is null or p_listing_quantity not between 1 and 999
    or p_physical_quantity is null or p_physical_quantity not between 1 and 999 then raise exception 'Invalid quantity'; end if;
  if p_processing_time is null or char_length(trim(p_processing_time)) not between 1 and 120 then raise exception 'Invalid processing time'; end if;
  if p_generated_by is null then raise exception 'Administrator identity is required'; end if;

  update public.print_estimates e set
    final_price = p_final_price,
    final_quantity = p_physical_quantity,
    status = 'etsy_prepared',
    etsy_prepared_at = now()
  where e.id = p_estimate_id;
  if not found then raise exception 'Estimate not found'; end if;

  insert into public.etsy_listing_preparations (
    estimate_id, quote_code, generated_title, generated_description,
    final_price, listing_quantity, physical_quantity, processing_time, generated_by
  )
  select e.id, e.quote_code, trim(p_generated_title), trim(p_generated_description),
    p_final_price, p_listing_quantity, p_physical_quantity, trim(p_processing_time), p_generated_by
  from public.print_estimates e where e.id = p_estimate_id
  returning * into saved;

  return next saved;
end;
$$;

revoke all on function public.admin_prepare_etsy_listing(uuid,text,text,numeric,integer,integer,text,uuid) from public, anon, authenticated;
grant execute on function public.admin_prepare_etsy_listing(uuid,text,text,numeric,integer,integer,text,uuid) to service_role;

create or replace function public.server_create_digital_card(
  p_owner_user_id uuid,
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
language plpgsql volatile security definer set search_path = '' as $$
declare created_profile_id uuid; created_card_id uuid; created_token text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise insufficient_privilege using message = 'Server access required'; end if;
  if p_owner_user_id is null then raise exception 'Owner identity is required'; end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 120 then raise exception 'Name is required'; end if;
  if exists (select 1 from public.profiles where owner_user_id = p_owner_user_id and lower(name) = lower(trim(p_name))) then raise exception 'A profile with this name already exists'; end if;

  insert into public.profiles (
    owner_user_id, name, company, title, phone, email, website, linkedin, instagram, address, bio
  ) values (
    p_owner_user_id, trim(p_name), nullif(trim(p_company), ''), nullif(trim(p_title), ''),
    nullif(trim(p_phone), ''), nullif(trim(p_email), ''), nullif(trim(p_website), ''),
    nullif(trim(p_linkedin), ''), nullif(trim(p_instagram), ''), nullif(trim(p_address), ''), nullif(trim(p_bio), '')
  ) returning id into created_profile_id;

  insert into public.physical_cards (profile_id, card_label)
  values (created_profile_id, 'Physical card')
  returning id, physical_cards.public_token into created_card_id, created_token;

  return query select created_profile_id, created_card_id, created_token;
end;
$$;

revoke all on function public.server_create_digital_card(uuid,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.server_create_digital_card(uuid,text,text,text,text,text,text,text,text,text,text) to service_role;

grant select, insert, update on public.profiles to service_role;
grant select, insert, update on public.physical_cards to service_role;
grant select, update on public.print_estimates to service_role;
grant select, insert on public.etsy_listing_preparations to service_role;

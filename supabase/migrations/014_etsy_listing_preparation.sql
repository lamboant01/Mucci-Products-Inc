-- Private Etsy-listing preparation workflow for the existing estimate admin.

alter table public.print_estimates add column if not exists final_price numeric(12,2)
  check (final_price is null or final_price > 0);
alter table public.print_estimates add column if not exists final_quantity integer
  check (final_quantity is null or final_quantity between 1 and 999);
alter table public.print_estimates add column if not exists admin_notes text
  check (admin_notes is null or char_length(admin_notes) <= 5000);
alter table public.print_estimates add column if not exists clarification_notes text
  check (clarification_notes is null or char_length(clarification_notes) <= 3000);
alter table public.print_estimates add column if not exists processing_time_override text
  check (processing_time_override is null or char_length(processing_time_override) <= 120);
alter table public.print_estimates add column if not exists reviewed_at timestamptz;
alter table public.print_estimates add column if not exists etsy_prepared_at timestamptz;
alter table public.print_estimates add column if not exists completed_at timestamptz;
alter table public.print_estimates add column if not exists declined_at timestamptz;
alter table public.print_estimates add column if not exists material text not null default 'PLA'
  check (char_length(material) between 2 and 50);
alter table public.print_estimates add column if not exists model_width_mm numeric(10,2)
  check (model_width_mm is null or model_width_mm > 0);
alter table public.print_estimates add column if not exists model_depth_mm numeric(10,2)
  check (model_depth_mm is null or model_depth_mm > 0);
alter table public.print_estimates add column if not exists model_height_mm numeric(10,2)
  check (model_height_mm is null or model_height_mm > 0);

update public.print_estimates
set final_price = coalesce(final_price, estimated_price_max),
    final_quantity = coalesce(final_quantity, quantity)
where final_price is null or final_quantity is null;

alter table public.print_estimates drop constraint if exists print_estimates_status_check;
alter table public.print_estimates add constraint print_estimates_status_check
  check (status in ('pending','reviewed','etsy_prepared','completed','declined'));

create index if not exists print_estimates_status_created_idx
  on public.print_estimates (status, created_at desc);

create table if not exists public.etsy_listing_preparations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.print_estimates(id) on delete cascade,
  quote_code text not null check (quote_code ~ '^MP-[A-HJ-NP-Z2-9]{5}$'),
  generated_title text not null check (char_length(generated_title) between 1 and 140),
  generated_description text not null check (char_length(generated_description) between 1 and 10000),
  final_price numeric(12,2) not null check (final_price > 0),
  listing_quantity integer not null default 1 check (listing_quantity between 1 and 999),
  physical_quantity integer not null check (physical_quantity between 1 and 999),
  processing_time text not null check (char_length(processing_time) between 1 and 120),
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id) on delete set null
);

create index if not exists etsy_listing_preparations_estimate_idx
  on public.etsy_listing_preparations (estimate_id, generated_at desc);

alter table public.etsy_listing_preparations enable row level security;
drop policy if exists "admin reads Etsy listing preparations" on public.etsy_listing_preparations;
create policy "admin reads Etsy listing preparations"
on public.etsy_listing_preparations for select to authenticated
using (public.is_mucci_card_admin());

revoke all on public.etsy_listing_preparations from public, anon;
grant select on public.etsy_listing_preparations to authenticated;

create or replace function public.admin_find_print_estimate(p_quote_code text)
returns setof public.print_estimates
language plpgsql stable security definer set search_path = '' as $$
declare clean_code text := upper(trim(coalesce(p_quote_code, '')));
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if clean_code !~ '^MP-[A-HJ-NP-Z2-9]{5}$' then raise exception 'Invalid quote code'; end if;
  return query select e.* from public.print_estimates e where e.quote_code = clean_code limit 1;
end;
$$;

revoke all on function public.admin_find_print_estimate(text) from public, anon;
grant execute on function public.admin_find_print_estimate(text) to authenticated;

create or replace function public.admin_recent_print_estimates(
  p_status text default null, p_manual_review boolean default false
)
returns setof public.print_estimates
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if p_status is not null and p_status not in ('pending','reviewed','etsy_prepared','completed','declined') then raise exception 'Invalid estimate status'; end if;
  return query
    select e.* from public.print_estimates e
    where (p_status is null or e.status = p_status)
      and (not p_manual_review or e.requires_manual_review)
    order by e.created_at desc limit 100;
end;
$$;

revoke all on function public.admin_recent_print_estimates(text,boolean) from public, anon;
grant execute on function public.admin_recent_print_estimates(text,boolean) to authenticated;

create or replace function public.admin_save_print_estimate_review(
  p_estimate_id uuid, p_final_price numeric, p_final_quantity integer,
  p_admin_notes text default null, p_clarification_notes text default null,
  p_processing_time_override text default null
)
returns setof public.print_estimates
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if p_final_price is null or p_final_price <= 0 or p_final_price <> round(p_final_price, 2) then raise exception 'Final price must be positive with no more than two decimal places'; end if;
  if p_final_quantity is null or p_final_quantity < 1 or p_final_quantity > 999 then raise exception 'Final quantity must be between 1 and 999'; end if;
  if p_admin_notes is not null and char_length(p_admin_notes) > 5000 then raise exception 'Admin notes are too long'; end if;
  if p_clarification_notes is not null and char_length(p_clarification_notes) > 3000 then raise exception 'Clarification notes are too long'; end if;
  if p_processing_time_override is not null and char_length(p_processing_time_override) > 120 then raise exception 'Processing time is too long'; end if;
  return query
    update public.print_estimates e set
      final_price = p_final_price,
      final_quantity = p_final_quantity,
      admin_notes = nullif(trim(p_admin_notes), ''),
      clarification_notes = nullif(trim(p_clarification_notes), ''),
      processing_time_override = nullif(trim(p_processing_time_override), '')
    where e.id = p_estimate_id returning e.*;
end;
$$;

revoke all on function public.admin_save_print_estimate_review(uuid,numeric,integer,text,text,text) from public, anon;
grant execute on function public.admin_save_print_estimate_review(uuid,numeric,integer,text,text,text) to authenticated;

create or replace function public.admin_set_print_estimate_status(p_estimate_id uuid, p_status text)
returns setof public.print_estimates
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if p_status not in ('pending','reviewed','completed','declined') then raise exception 'Invalid estimate status'; end if;
  return query
    update public.print_estimates e set
      status = p_status,
      reviewed_at = case when p_status = 'reviewed' then now() else e.reviewed_at end,
      completed_at = case when p_status = 'completed' then now() else e.completed_at end,
      declined_at = case when p_status = 'declined' then now() else e.declined_at end
    where e.id = p_estimate_id returning e.*;
end;
$$;

revoke all on function public.admin_set_print_estimate_status(uuid,text) from public, anon;
grant execute on function public.admin_set_print_estimate_status(uuid,text) to authenticated;

create or replace function public.admin_prepare_etsy_listing(
  p_estimate_id uuid, p_generated_title text, p_generated_description text,
  p_final_price numeric, p_listing_quantity integer, p_physical_quantity integer,
  p_processing_time text
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
    or p_physical_quantity is null or p_physical_quantity not between 1 and 999 then
    raise exception 'Invalid quantity';
  end if;
  if p_processing_time is null or char_length(trim(p_processing_time)) not between 1 and 120 then raise exception 'Invalid processing time'; end if;

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
    p_final_price, p_listing_quantity, p_physical_quantity, trim(p_processing_time), auth.uid()
  from public.print_estimates e where e.id = p_estimate_id
  returning * into saved;

  return next saved;
end;
$$;

revoke all on function public.admin_prepare_etsy_listing(uuid,text,text,numeric,integer,integer,text) from public, anon;
grant execute on function public.admin_prepare_etsy_listing(uuid,text,text,numeric,integer,integer,text) to authenticated;

-- Preserve model dimensions on new public submissions without exposing any
-- new read capability to anonymous users.
do $$
begin
  if to_regprocedure('public.submit_print_estimate(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text)') is not null
     and to_regprocedure('public.submit_print_estimate_without_dimensions(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text)') is null then
    execute 'alter function public.submit_print_estimate(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text) rename to submit_print_estimate_without_dimensions';
  end if;
end;
$$;

revoke all on function public.submit_print_estimate_without_dimensions(
  text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text
) from public, anon, authenticated;

create or replace function public.submit_print_estimate(
  p_file_path text, p_file_status text, p_quantity integer,
  p_print_hours_per_item integer default null, p_print_minutes_per_item integer default null,
  p_filament_grams_per_item numeric default null, p_size_category text default null,
  p_colour_count text default '1', p_design_level text default 'none',
  p_assembly_required boolean default false, p_print_time_source text default 'unknown',
  p_print_profile text default null, p_name text default null, p_notes text default null,
  p_original_file_name text default null, p_model_width_mm numeric default null,
  p_model_depth_mm numeric default null, p_model_height_mm numeric default null
)
returns table(quote_code text, estimated_price_min numeric, estimated_price_max numeric, notification_token uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare submitted record;
begin
  if (p_model_width_mm is not null and (p_model_width_mm <= 0 or p_model_width_mm > 250))
    or (p_model_depth_mm is not null and (p_model_depth_mm <= 0 or p_model_depth_mm > 250))
    or (p_model_height_mm is not null and (p_model_height_mm <= 0 or p_model_height_mm > 250)) then
    raise exception 'Invalid model dimensions';
  end if;
  if p_file_path is null and (p_model_width_mm is not null or p_model_depth_mm is not null or p_model_height_mm is not null) then
    raise exception 'Model dimensions require an uploaded file';
  end if;

  select * into submitted from public.submit_print_estimate_without_dimensions(
    p_file_path,p_file_status,p_quantity,p_print_hours_per_item,p_print_minutes_per_item,
    p_filament_grams_per_item,p_size_category,p_colour_count,p_design_level,
    p_assembly_required,p_print_time_source,p_print_profile,p_name,p_notes,p_original_file_name
  );

  update public.print_estimates e set
    model_width_mm = round(p_model_width_mm, 2),
    model_depth_mm = round(p_model_depth_mm, 2),
    model_height_mm = round(p_model_height_mm, 2),
    final_price = submitted.estimated_price_max,
    final_quantity = p_quantity
  where e.quote_code = submitted.quote_code;

  quote_code := submitted.quote_code;
  estimated_price_min := submitted.estimated_price_min;
  estimated_price_max := submitted.estimated_price_max;
  notification_token := submitted.notification_token;
  return next;
end;
$$;

revoke all on function public.submit_print_estimate(
  text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text,numeric,numeric,numeric
) from public;
grant execute on function public.submit_print_estimate(
  text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text,numeric,numeric,numeric
) to anon, authenticated;

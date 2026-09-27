-- Price sliced models from both production time and slicer-reported material.
-- PLA weight uses the browser-supplied gram estimate. The existing colour
-- allowance is applied to both hours and grams before pricing.

alter table public.print_estimator_config
  add column if not exists material_rate_per_gram numeric(10,2) not null default 1.20
  check (material_rate_per_gram >= 0);

update public.print_estimator_config
set hourly_production_factor = 2.00,
    material_rate_per_gram = 1.20,
    updated_at = now()
where singleton = true;

alter table public.print_estimates
  add column if not exists filament_grams_per_item numeric(12,3)
  check (filament_grams_per_item is null or filament_grams_per_item > 0);

alter table public.print_estimates
  add column if not exists estimated_material_grams numeric(14,3) not null default 0
  check (estimated_material_grams >= 0);

drop function if exists public.calculate_print_estimate(text,integer,integer,integer,text,text,text,boolean);
drop function if exists public.submit_print_estimate(text,text,integer,integer,integer,text,text,text,boolean,text,text,text,text);
drop function if exists public.compute_print_estimate(text,integer,integer,integer,text,text,text,boolean);

create or replace function public.compute_print_estimate(
  p_file_status text, p_quantity integer, p_print_hours_per_item integer,
  p_print_minutes_per_item integer, p_filament_grams_per_item numeric,
  p_size_category text, p_colour_count text, p_design_level text,
  p_assembly_required boolean
)
returns table(production_hours_min numeric, production_hours_max numeric,
  material_grams numeric, price_min numeric, price_max numeric,
  per_item_min numeric, per_item_max numeric, manual_review boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.print_estimator_config%rowtype;
  hours_min numeric;
  hours_max numeric;
  design_price numeric;
  purge_percent numeric;
  purge_factor numeric;
begin
  select * into cfg from public.print_estimator_config where singleton = true;
  if p_file_status not in ('ready','modify','design') then raise exception 'Select a valid file status'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'Quantity must be between 1 and 999'; end if;
  if p_colour_count not in ('1','2','3','4') then raise exception 'Select between 1 and 4 colours'; end if;
  if (p_file_status = 'ready' and p_design_level <> 'none') or (p_file_status <> 'ready' and p_design_level not in ('simple','medium','complex')) then raise exception 'Select a valid design level'; end if;

  if p_size_category is not null then
    if not (cfg.size_hours ? p_size_category) then raise exception 'Select a valid size'; end if;
    if p_filament_grams_per_item is not null then raise exception 'File review cannot include sliced material'; end if;
    hours_min := ((cfg.size_hours -> p_size_category ->> 'min')::numeric) * p_quantity;
    hours_max := ((cfg.size_hours -> p_size_category ->> 'max')::numeric) * p_quantity;
    material_grams := 0;
  else
    if p_print_hours_per_item is null or p_print_minutes_per_item is null or p_print_hours_per_item < 0 or p_print_hours_per_item > 1000 or p_print_minutes_per_item < 0 or p_print_minutes_per_item > 59 or (p_print_hours_per_item = 0 and p_print_minutes_per_item = 0) then raise exception 'Enter a valid print time for one item'; end if;
    if p_filament_grams_per_item is null or p_filament_grams_per_item <= 0 or p_filament_grams_per_item > 100000 then raise exception 'The slicer returned invalid filament usage'; end if;
    hours_min := (p_print_hours_per_item + p_print_minutes_per_item / 60.0) * p_quantity;
    hours_max := hours_min;
    material_grams := p_filament_grams_per_item * p_quantity;
  end if;

  purge_percent := coalesce((cfg.colour_purge_percent ->> p_colour_count)::numeric, 0);
  if purge_percent < 0 or purge_percent > 100 then raise exception 'Invalid purge allowance configuration'; end if;
  purge_factor := 1 + purge_percent / 100.0;
  hours_min := hours_min * purge_factor;
  hours_max := hours_max * purge_factor;
  material_grams := material_grams * purge_factor;

  design_price := case p_design_level when 'none' then 0 when 'simple' then cfg.design_simple when 'medium' then cfg.design_medium when 'complex' then cfg.design_complex else null end;
  production_hours_min := round(hours_min, 2);
  production_hours_max := round(hours_max, 2);
  material_grams := round(material_grams, 3);
  price_min := round(cfg.base_price + hours_min * cfg.hourly_production_factor + material_grams * cfg.material_rate_per_gram + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end, 2);
  price_max := round(cfg.base_price + hours_max * cfg.hourly_production_factor + material_grams * cfg.material_rate_per_gram + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end, 2);
  per_item_min := round(price_min / p_quantity, 2);
  per_item_max := round(price_max / p_quantity, 2);
  manual_review := p_assembly_required or p_size_category is not null or p_colour_count in ('3','4') or p_file_status <> 'ready';
  return next;
end;
$$;

revoke all on function public.compute_print_estimate(text,integer,integer,integer,numeric,text,text,text,boolean) from public;

create or replace function public.calculate_print_estimate(
  p_file_status text, p_quantity integer, p_print_hours_per_item integer default null,
  p_print_minutes_per_item integer default null, p_filament_grams_per_item numeric default null,
  p_size_category text default null, p_colour_count text default '1',
  p_design_level text default 'none', p_assembly_required boolean default false
)
returns table(estimated_price_min numeric, estimated_price_max numeric,
  price_per_item_min numeric, price_per_item_max numeric,
  requires_manual_review boolean, material_grams_per_item numeric,
  estimated_material_grams numeric)
language sql stable security definer set search_path = '' as $$
  select calc.price_min, calc.price_max, calc.per_item_min, calc.per_item_max,
    calc.manual_review,
    case when p_filament_grams_per_item is null then null else round(calc.material_grams / p_quantity, 3) end,
    calc.material_grams
  from public.compute_print_estimate(p_file_status,p_quantity,p_print_hours_per_item,
    p_print_minutes_per_item,p_filament_grams_per_item,p_size_category,
    p_colour_count,p_design_level,p_assembly_required) calc;
$$;

revoke all on function public.calculate_print_estimate(text,integer,integer,integer,numeric,text,text,text,boolean) from public;
grant execute on function public.calculate_print_estimate(text,integer,integer,integer,numeric,text,text,text,boolean) to anon, authenticated;

create or replace function public.submit_print_estimate(
  p_file_path text, p_file_status text, p_quantity integer,
  p_print_hours_per_item integer default null, p_print_minutes_per_item integer default null,
  p_filament_grams_per_item numeric default null, p_size_category text default null,
  p_colour_count text default '1', p_design_level text default 'none',
  p_assembly_required boolean default false, p_print_time_source text default 'unknown',
  p_print_profile text default null, p_name text default null, p_notes text default null
)
returns table(quote_code text, estimated_price_min numeric, estimated_price_max numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare
  calc record;
  cfg public.print_estimator_config%rowtype;
  generated_code text;
  attempts integer := 0;
  clean_name text;
  purge_percent numeric;
begin
  clean_name := nullif(trim(p_name), '');
  if clean_name is not null and char_length(clean_name) > 120 then raise exception 'Name is too long'; end if;
  if p_notes is not null and char_length(p_notes) > 3000 then raise exception 'Notes are too long'; end if;
  if p_file_path is not null and p_file_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(stl|3mf|obj|step|stp)$' then raise exception 'Invalid uploaded file path'; end if;
  if p_print_time_source not in ('slicer','unknown') then raise exception 'Select a valid print time method'; end if;
  if p_print_time_source = 'unknown' and (p_print_profile is not null or p_size_category is distinct from 'not_sure' or p_print_hours_per_item is not null or p_print_minutes_per_item is not null or p_filament_grams_per_item is not null) then raise exception 'Unknown print time must use file review'; end if;
  if p_print_time_source = 'slicer' and (p_print_profile not in ('detailed','standard','draft') or p_size_category is not null or p_print_hours_per_item is null or p_print_minutes_per_item is null or p_filament_grams_per_item is null) then raise exception 'Sliced time, material, and profile are required'; end if;

  select * into calc from public.compute_print_estimate(p_file_status,p_quantity,
    p_print_hours_per_item,p_print_minutes_per_item,p_filament_grams_per_item,
    p_size_category,p_colour_count,p_design_level,p_assembly_required);
  select * into cfg from public.print_estimator_config where singleton = true;
  purge_percent := coalesce((cfg.colour_purge_percent ->> p_colour_count)::numeric, 0);

  loop
    attempts := attempts + 1;
    generated_code := public.generate_print_quote_code();
    begin
      insert into public.print_estimates (
        quote_code,name,email,file_path,file_status,quantity,print_hours_per_item,
        print_minutes_per_item,filament_grams_per_item,size_category,colour_count,
        design_level,assembly_required,notes,estimated_production_hours,
        estimated_production_hours_max,estimated_material_grams,estimated_price,
        estimated_price_max,estimated_price_per_item,estimated_price_per_item_max,
        requires_manual_review,print_time_source,print_profile,purge_waste_percent
      ) values (
        generated_code,clean_name,null,p_file_path,p_file_status,p_quantity,
        p_print_hours_per_item,p_print_minutes_per_item,p_filament_grams_per_item,
        p_size_category,p_colour_count,p_design_level,p_assembly_required,
        nullif(trim(p_notes),''),calc.production_hours_min,calc.production_hours_max,
        calc.material_grams,calc.price_min,calc.price_max,calc.per_item_min,
        calc.per_item_max,calc.manual_review,p_print_time_source,p_print_profile,
        purge_percent
      );
      exit;
    exception when unique_violation then
      if attempts >= 10 then raise exception 'Could not generate a quote code'; end if;
    end;
  end loop;

  quote_code := generated_code;
  estimated_price_min := calc.price_min;
  estimated_price_max := calc.price_max;
  return next;
end;
$$;

revoke all on function public.submit_print_estimate(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text) from public;
grant execute on function public.submit_print_estimate(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text) to anon, authenticated;

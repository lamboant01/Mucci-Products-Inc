-- Treat the configured base price as a minimum order, not an added fee.

update public.print_estimator_config
set base_price = 40.00,
    updated_at = now()
where singleton = true;

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
  price_min := round(greatest(cfg.base_price, hours_min * cfg.hourly_production_factor + material_grams * cfg.material_rate_per_gram + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end), 2);
  price_max := round(greatest(cfg.base_price, hours_max * cfg.hourly_production_factor + material_grams * cfg.material_rate_per_gram + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end), 2);
  per_item_min := round(price_min / p_quantity, 2);
  per_item_max := round(price_max / p_quantity, 2);
  manual_review := p_assembly_required or p_size_category is not null or p_colour_count in ('3','4') or p_file_status <> 'ready';
  return next;
end;
$$;

revoke all on function public.compute_print_estimate(text,integer,integer,integer,numeric,text,text,text,boolean) from public;

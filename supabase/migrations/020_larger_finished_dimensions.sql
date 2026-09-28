-- Allow no-file design requests up to 2.5 metres per dimension. Parts larger
-- than the A1 build volume still require split-and-assembly approval, and the
-- existing 64-section submission limit remains in force.

create or replace function public.calculate_service_estimate(
  p_file_status text, p_service_intent text, p_quantity integer,
  p_print_hours_per_item integer, p_print_minutes_per_item integer,
  p_filament_grams_per_item numeric, p_colour_count text, p_material text,
  p_design_level text, p_assembly_required boolean,
  p_split_and_assembly_accepted boolean,
  p_model_length_mm numeric, p_model_width_mm numeric, p_model_height_mm numeric
)
returns table(
  design_estimate_min numeric, design_estimate_max numeric,
  print_estimate_min numeric, print_estimate_max numeric,
  estimated_total_min numeric, estimated_total_max numeric,
  print_price_per_item_min numeric, print_price_per_item_max numeric,
  requires_manual_review boolean, estimated_production_hours_min numeric,
  estimated_production_hours_max numeric, material_grams_per_item numeric,
  estimated_material_grams numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.print_estimator_config%rowtype;
  print_calc record;
  design_price numeric := 0;
begin
  select * into cfg from public.print_estimator_config where singleton = true;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'Quantity must be between 1 and 999'; end if;
  if (p_file_status = 'ready' and p_service_intent <> 'PRINT_ONLY')
    or (p_file_status = 'modify' and p_service_intent <> 'MODIFY_AND_PRINT')
    or (p_file_status = 'design' and p_service_intent not in ('DESIGN_ONLY','DESIGN_AND_PRINT'))
    or p_file_status not in ('ready','modify','design') then raise exception 'Select a valid service'; end if;
  if (p_service_intent = 'PRINT_ONLY' and p_design_level <> 'none')
    or (p_service_intent <> 'PRINT_ONLY' and p_design_level not in ('simple','medium','complex')) then raise exception 'Select a valid design level'; end if;
  if (p_service_intent = 'DESIGN_ONLY' and p_material is not null)
    or (p_service_intent <> 'DESIGN_ONLY' and p_material not in ('PLA','PETG')) then raise exception 'Choose PLA or PETG for printing'; end if;
  if p_file_status = 'design' and (
    p_model_length_mm is null or p_model_width_mm is null or p_model_height_mm is null
    or p_model_length_mm <= 0 or p_model_width_mm <= 0 or p_model_height_mm <= 0
    or p_model_length_mm > 2500 or p_model_width_mm > 2500 or p_model_height_mm > 2500
  ) then raise exception 'Enter finished dimensions no larger than 2500 mm'; end if;
  if p_file_status = 'design'
    and greatest(p_model_length_mm,p_model_width_mm,p_model_height_mm) > 250
    and not coalesce(p_split_and_assembly_accepted,false)
  then raise exception 'Confirm that splitting and assembly is acceptable for this oversized part'; end if;
  if p_file_status <> 'design' and coalesce(p_split_and_assembly_accepted,false)
  then raise exception 'Split acceptance is only available for projects without a model file'; end if;

  design_price := case p_design_level
    when 'none' then 0 when 'simple' then cfg.design_simple
    when 'medium' then cfg.design_medium when 'complex' then cfg.design_complex
    else null end;
  design_estimate_min := design_price;
  design_estimate_max := design_price;

  if p_service_intent = 'DESIGN_ONLY' then
    if p_quantity <> 1 or p_print_hours_per_item is not null or p_print_minutes_per_item is not null
      or p_filament_grams_per_item is not null or p_assembly_required then raise exception 'Design-only estimates cannot include physical printing'; end if;
    print_estimate_min := null;
    print_estimate_max := null;
    print_price_per_item_min := null;
    print_price_per_item_max := null;
    estimated_production_hours_min := 0;
    estimated_production_hours_max := 0;
    material_grams_per_item := null;
    estimated_material_grams := 0;
  else
    select * into print_calc from public.compute_print_estimate(
      'ready',p_quantity,p_print_hours_per_item,p_print_minutes_per_item,
      p_filament_grams_per_item,null,p_colour_count,'none',p_assembly_required
    );
    print_estimate_min := print_calc.price_min;
    print_estimate_max := print_calc.price_max;
    print_price_per_item_min := print_calc.per_item_min;
    print_price_per_item_max := print_calc.per_item_max;
    estimated_production_hours_min := print_calc.production_hours_min;
    estimated_production_hours_max := print_calc.production_hours_max;
    material_grams_per_item := round(print_calc.material_grams / p_quantity, 3);
    estimated_material_grams := print_calc.material_grams;
  end if;

  estimated_total_min := round(design_price + coalesce(print_estimate_min, 0), 2);
  estimated_total_max := round(design_price + coalesce(print_estimate_max, 0), 2);
  requires_manual_review := p_service_intent <> 'PRINT_ONLY' or p_assembly_required or p_colour_count in ('3','4');
  return next;
end;
$$;

revoke all on function public.calculate_service_estimate(
  text,text,integer,integer,integer,numeric,text,text,text,boolean,boolean,numeric,numeric,numeric
) from public;
grant execute on function public.calculate_service_estimate(
  text,text,integer,integer,integer,numeric,text,text,text,boolean,boolean,numeric,numeric,numeric
) to anon, authenticated;

notify pgrst, 'reload schema';

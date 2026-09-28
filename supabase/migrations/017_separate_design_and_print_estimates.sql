-- Keep design work and physical printing as separate priced services.
-- Existing estimates remain readable; new submissions use the service-specific
-- RPCs below so a design charge is never hidden inside a printing amount.

alter table public.print_estimates add column if not exists service_intent text;
update public.print_estimates
set service_intent = case file_status
  when 'ready' then 'PRINT_ONLY'
  when 'modify' then 'MODIFY_AND_PRINT'
  else 'DESIGN_AND_PRINT'
end
where service_intent is null;
alter table public.print_estimates alter column service_intent set not null;
alter table public.print_estimates drop constraint if exists print_estimates_service_intent_check;
alter table public.print_estimates add constraint print_estimates_service_intent_check
  check (service_intent in ('DESIGN_ONLY','DESIGN_AND_PRINT','PRINT_ONLY','MODIFY_AND_PRINT'));

alter table public.print_estimates add column if not exists submitted_length numeric(10,3)
  check (submitted_length is null or submitted_length > 0);
alter table public.print_estimates add column if not exists submitted_width numeric(10,3)
  check (submitted_width is null or submitted_width > 0);
alter table public.print_estimates add column if not exists submitted_height numeric(10,3)
  check (submitted_height is null or submitted_height > 0);
alter table public.print_estimates add column if not exists dimension_unit text
  check (dimension_unit is null or dimension_unit in ('mm','cm','inches'));
alter table public.print_estimates add column if not exists split_and_assembly_accepted boolean not null default false;
alter table public.print_estimates add column if not exists estimated_section_count integer not null default 1
  check (estimated_section_count between 1 and 64);
alter table public.print_estimates add column if not exists desired_colours text
  check (desired_colours is null or char_length(desired_colours) between 1 and 200);

alter table public.print_estimates add column if not exists design_estimate_min numeric(12,2) not null default 0
  check (design_estimate_min >= 0);
alter table public.print_estimates add column if not exists design_estimate_max numeric(12,2) not null default 0
  check (design_estimate_max >= design_estimate_min);
alter table public.print_estimates add column if not exists print_estimate_min numeric(12,2)
  check (print_estimate_min is null or print_estimate_min >= 0);
alter table public.print_estimates add column if not exists print_estimate_max numeric(12,2)
  check (print_estimate_max is null or print_estimate_max >= print_estimate_min);
alter table public.print_estimates add column if not exists estimated_total_min numeric(12,2);
alter table public.print_estimates add column if not exists estimated_total_max numeric(12,2);

update public.print_estimates e
set design_estimate_min = case e.design_level
      when 'simple' then cfg.design_simple when 'medium' then cfg.design_medium
      when 'complex' then cfg.design_complex else 0 end,
    design_estimate_max = case e.design_level
      when 'simple' then cfg.design_simple when 'medium' then cfg.design_medium
      when 'complex' then cfg.design_complex else 0 end,
    estimated_total_min = e.estimated_price,
    estimated_total_max = e.estimated_price_max
from public.print_estimator_config cfg
where cfg.singleton = true;

update public.print_estimates
set print_estimate_min = greatest(0, estimated_total_min - design_estimate_min),
    print_estimate_max = greatest(0, estimated_total_max - design_estimate_max)
where service_intent <> 'DESIGN_ONLY';

alter table public.print_estimates alter column estimated_total_min set not null;
alter table public.print_estimates alter column estimated_total_max set not null;
alter table public.print_estimates drop constraint if exists print_estimates_total_range_check;
alter table public.print_estimates add constraint print_estimates_total_range_check
  check (estimated_total_min >= 0 and estimated_total_max >= estimated_total_min);

alter table public.print_estimates drop constraint if exists print_estimates_check;
alter table public.print_estimates drop constraint if exists print_estimates_print_inputs_check;
alter table public.print_estimates add constraint print_estimates_print_inputs_check check (
  (service_intent = 'DESIGN_ONLY' and size_category is null and print_hours_per_item is null
    and print_minutes_per_item is null and filament_grams_per_item is null)
  or
  (service_intent <> 'DESIGN_ONLY' and (
    (size_category is not null and print_hours_per_item is null and print_minutes_per_item is null and filament_grams_per_item is null)
    or (size_category is null and print_hours_per_item is not null and print_minutes_per_item is not null and filament_grams_per_item is not null)
  ))
);

alter table public.print_estimates drop constraint if exists print_estimates_print_time_source_check;
alter table public.print_estimates add constraint print_estimates_print_time_source_check
  check (print_time_source in ('slicer','virtual_bounding_box','gcode','manual','unknown'));

create or replace function public.set_print_estimate_service_breakdown()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cfg public.print_estimator_config%rowtype;
  design_price numeric;
begin
  select * into cfg from public.print_estimator_config where singleton = true;
  new.service_intent := coalesce(new.service_intent, case new.file_status
    when 'ready' then 'PRINT_ONLY' when 'modify' then 'MODIFY_AND_PRINT' else 'DESIGN_AND_PRINT' end);
  design_price := case new.design_level when 'simple' then cfg.design_simple
    when 'medium' then cfg.design_medium when 'complex' then cfg.design_complex else 0 end;
  if new.design_level <> 'none' and coalesce(new.design_estimate_min, 0) = 0 then new.design_estimate_min := design_price; end if;
  if new.design_level <> 'none' and coalesce(new.design_estimate_max, 0) = 0 then new.design_estimate_max := design_price; end if;
  new.estimated_total_min := coalesce(new.estimated_total_min, new.estimated_price);
  new.estimated_total_max := coalesce(new.estimated_total_max, new.estimated_price_max);
  if new.service_intent <> 'DESIGN_ONLY' then
    new.print_estimate_min := coalesce(new.print_estimate_min, greatest(0, new.estimated_total_min - new.design_estimate_min));
    new.print_estimate_max := coalesce(new.print_estimate_max, greatest(0, new.estimated_total_max - new.design_estimate_max));
  end if;
  return new;
end;
$$;

revoke all on function public.set_print_estimate_service_breakdown() from public, anon, authenticated;

drop trigger if exists set_print_estimate_service_breakdown on public.print_estimates;
create trigger set_print_estimate_service_breakdown
before insert on public.print_estimates for each row execute function public.set_print_estimate_service_breakdown();

create or replace function public.calculate_service_estimate(
  p_file_status text, p_service_intent text, p_quantity integer,
  p_print_hours_per_item integer, p_print_minutes_per_item integer,
  p_filament_grams_per_item numeric, p_colour_count text,
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
  if p_file_status = 'design' and (
    p_model_length_mm is null or p_model_width_mm is null or p_model_height_mm is null
    or p_model_length_mm <= 0 or p_model_width_mm <= 0 or p_model_height_mm <= 0
    or p_model_length_mm > 1000 or p_model_width_mm > 1000 or p_model_height_mm > 1000
  ) then raise exception 'Enter finished dimensions no larger than 1000 mm'; end if;
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
  text,text,integer,integer,integer,numeric,text,text,boolean,boolean,numeric,numeric,numeric
) from public;
grant execute on function public.calculate_service_estimate(
  text,text,integer,integer,integer,numeric,text,text,boolean,boolean,numeric,numeric,numeric
) to anon, authenticated;

create or replace function public.submit_service_estimate(
  p_file_path text, p_original_file_name text, p_file_status text, p_service_intent text,
  p_quantity integer, p_print_hours_per_item integer, p_print_minutes_per_item integer,
  p_filament_grams_per_item numeric, p_colour_count text, p_desired_colours text, p_design_level text,
  p_assembly_required boolean, p_split_and_assembly_accepted boolean,
  p_estimated_section_count integer, p_print_time_source text, p_print_profile text,
  p_name text, p_notes text, p_model_length_mm numeric, p_model_width_mm numeric,
  p_model_height_mm numeric, p_submitted_length numeric, p_submitted_width numeric,
  p_submitted_height numeric, p_dimension_unit text
)
returns table(
  quote_code text, design_estimate_min numeric, design_estimate_max numeric,
  print_estimate_min numeric, print_estimate_max numeric,
  estimated_total_min numeric, estimated_total_max numeric, notification_token uuid
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  calc record;
  cfg public.print_estimator_config%rowtype;
  generated_code text;
  saved_token uuid;
  attempts integer := 0;
  clean_name text := nullif(trim(p_name), '');
  clean_file_name text := nullif(trim(p_original_file_name), '');
  unit_factor numeric;
  purge_percent numeric;
begin
  if clean_name is not null and char_length(clean_name) > 120 then raise exception 'Name is too long'; end if;
  if p_notes is not null and char_length(p_notes) > 3000 then raise exception 'Notes are too long'; end if;
  if p_service_intent <> 'DESIGN_ONLY' and (nullif(trim(p_desired_colours),'') is null or char_length(trim(p_desired_colours)) > 200) then raise exception 'Enter the wanted colours using 200 characters or fewer'; end if;
  if p_service_intent = 'DESIGN_ONLY' and nullif(trim(p_desired_colours),'') is not null then raise exception 'Design-only estimates cannot include printing colours'; end if;
  if p_estimated_section_count is null or p_estimated_section_count < 1 or p_estimated_section_count > 64 then raise exception 'Invalid printable section count'; end if;
  if p_file_path is not null and p_file_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(stl|3mf|obj|step|stp)$' then raise exception 'Invalid uploaded file path'; end if;
  if clean_file_name is not null and (p_file_path is null or char_length(clean_file_name) > 255 or clean_file_name ~ '[[:cntrl:]]') then raise exception 'Invalid model filename'; end if;
  if p_service_intent in ('PRINT_ONLY','MODIFY_AND_PRINT') and (p_file_path is null or p_print_time_source <> 'slicer' or p_print_profile not in ('standard','draft')) then raise exception 'A sliced model file is required'; end if;
  if p_service_intent in ('DESIGN_ONLY','DESIGN_AND_PRINT') and p_file_path is not null then raise exception 'No uploaded file is expected for this service'; end if;
  if p_service_intent = 'DESIGN_ONLY' and (p_print_time_source <> 'unknown' or p_print_profile is not null) then raise exception 'Design-only estimates cannot include a print profile'; end if;
  if p_service_intent = 'DESIGN_AND_PRINT' and (p_print_time_source <> 'virtual_bounding_box' or p_print_profile <> 'standard') then raise exception 'Preliminary printing must use the standard virtual model profile'; end if;

  if p_file_status = 'design' then
    if p_dimension_unit not in ('mm','cm','inches') or p_submitted_length is null or p_submitted_width is null or p_submitted_height is null
      or p_submitted_length <= 0 or p_submitted_width <= 0 or p_submitted_height <= 0 then raise exception 'Finished dimensions and unit are required'; end if;
    unit_factor := case p_dimension_unit when 'mm' then 1 when 'cm' then 10 when 'inches' then 25.4 end;
    if abs(p_model_length_mm - p_submitted_length * unit_factor) > 0.02
      or abs(p_model_width_mm - p_submitted_width * unit_factor) > 0.02
      or abs(p_model_height_mm - p_submitted_height * unit_factor) > 0.02 then raise exception 'Finished dimensions do not match the selected unit'; end if;
    if greatest(p_model_length_mm,p_model_width_mm,p_model_height_mm) > 250 then
      if not coalesce(p_split_and_assembly_accepted,false) then raise exception 'Oversized parts require split and assembly acceptance'; end if;
      if p_estimated_section_count <> ceil(p_model_length_mm / 250.0)::integer
        * ceil(p_model_width_mm / 250.0)::integer
        * ceil(p_model_height_mm / 250.0)::integer then raise exception 'Invalid printable section count'; end if;
    elsif coalesce(p_split_and_assembly_accepted,false) or p_estimated_section_count <> 1 then
      raise exception 'Split acceptance is only required for oversized parts';
    end if;
  elsif p_submitted_length is not null or p_submitted_width is not null or p_submitted_height is not null or p_dimension_unit is not null then
    raise exception 'Submitted dimensions are only accepted when no model file exists';
  end if;
  if p_file_status <> 'design' and (coalesce(p_split_and_assembly_accepted,false) or p_estimated_section_count <> 1)
  then raise exception 'Split acceptance is only available for projects without a model file'; end if;

  select * into calc from public.calculate_service_estimate(
    p_file_status,p_service_intent,p_quantity,p_print_hours_per_item,
    p_print_minutes_per_item,p_filament_grams_per_item,p_colour_count,
    p_design_level,p_assembly_required,p_split_and_assembly_accepted,
    p_model_length_mm,p_model_width_mm,p_model_height_mm
  );
  select * into cfg from public.print_estimator_config where singleton = true;
  purge_percent := coalesce((cfg.colour_purge_percent ->> p_colour_count)::numeric, 0);

  loop
    attempts := attempts + 1;
    generated_code := public.generate_print_quote_code();
    begin
      insert into public.print_estimates (
        quote_code,name,email,file_path,original_file_name,file_status,service_intent,
        quantity,print_hours_per_item,print_minutes_per_item,filament_grams_per_item,
        size_category,colour_count,desired_colours,design_level,assembly_required,notes,
        estimated_production_hours,estimated_production_hours_max,estimated_material_grams,
        estimated_price,estimated_price_max,estimated_price_per_item,estimated_price_per_item_max,
        requires_manual_review,print_time_source,print_profile,purge_waste_percent,
        model_width_mm,model_depth_mm,model_height_mm,submitted_length,submitted_width,
        submitted_height,dimension_unit,split_and_assembly_accepted,estimated_section_count,
        design_estimate_min,design_estimate_max,
        print_estimate_min,print_estimate_max,estimated_total_min,estimated_total_max,
        final_price,final_quantity
      ) values (
        generated_code,clean_name,null,p_file_path,clean_file_name,p_file_status,p_service_intent,
        p_quantity,p_print_hours_per_item,p_print_minutes_per_item,p_filament_grams_per_item,
        null,p_colour_count,nullif(trim(p_desired_colours),''),p_design_level,p_assembly_required,nullif(trim(p_notes),''),
        calc.estimated_production_hours_min,calc.estimated_production_hours_max,
        calc.estimated_material_grams,calc.estimated_total_min,calc.estimated_total_max,
        round(calc.estimated_total_min / p_quantity,2),round(calc.estimated_total_max / p_quantity,2),
        calc.requires_manual_review,p_print_time_source,p_print_profile,purge_percent,
        round(p_model_length_mm,2),round(p_model_width_mm,2),round(p_model_height_mm,2),
        p_submitted_length,p_submitted_width,p_submitted_height,p_dimension_unit,
        coalesce(p_split_and_assembly_accepted,false),p_estimated_section_count,
        calc.design_estimate_min,calc.design_estimate_max,calc.print_estimate_min,
        calc.print_estimate_max,calc.estimated_total_min,calc.estimated_total_max,
        calc.estimated_total_max,p_quantity
      ) returning print_estimates.notification_token into saved_token;
      exit;
    exception when unique_violation then
      if attempts >= 10 then raise exception 'Could not generate a quote code'; end if;
    end;
  end loop;

  quote_code := generated_code;
  design_estimate_min := calc.design_estimate_min;
  design_estimate_max := calc.design_estimate_max;
  print_estimate_min := calc.print_estimate_min;
  print_estimate_max := calc.print_estimate_max;
  estimated_total_min := calc.estimated_total_min;
  estimated_total_max := calc.estimated_total_max;
  notification_token := saved_token;
  return next;
end;
$$;

revoke all on function public.submit_service_estimate(
  text,text,text,text,integer,integer,integer,numeric,text,text,text,boolean,boolean,integer,text,text,text,text,
  numeric,numeric,numeric,numeric,numeric,numeric,text
) from public;
grant execute on function public.submit_service_estimate(
  text,text,text,text,integer,integer,integer,numeric,text,text,text,boolean,boolean,integer,text,text,text,text,
  numeric,numeric,numeric,numeric,numeric,numeric,text
) to anon, authenticated;

-- Intended-use preliminary manufacturing estimates for requests without a 3D file.
-- Uploaded STL/3MF pricing remains on the existing slicer-backed calculation path.

alter table public.print_estimates
  add column if not exists application_category text,
  add column if not exists application_description text,
  add column if not exists ai_geometry_classification text,
  add column if not exists geometry_utilization_factor numeric(5,3),
  add column if not exists recommended_infill_percent integer,
  add column if not exists recommended_wall_loops integer,
  add column if not exists recommended_top_bottom_layers integer,
  add column if not exists estimation_method text;

alter table public.print_estimates drop constraint if exists print_estimates_print_time_source_check;
alter table public.print_estimates add constraint print_estimates_print_time_source_check
  check (print_time_source in ('slicer','intended_use','virtual_bounding_box','gcode','manual','unknown'));

alter table public.print_estimates drop constraint if exists print_estimates_application_category_check;
alter table public.print_estimates add constraint print_estimates_application_category_check check (
  application_category is null or application_category in (
    'organizer_tray','box_enclosure','holder_mount','replacement_part',
    'bracket_structural','decorative_item','prototype','sign_display','other'
  )
);
alter table public.print_estimates drop constraint if exists print_estimates_geometry_classification_check;
alter table public.print_estimates add constraint print_estimates_geometry_classification_check check (
  ai_geometry_classification is null or ai_geometry_classification in (
    'open_tray','enclosure','thin_shell','holder','bracket','structural','decorative','mostly_solid','unknown'
  )
);
alter table public.print_estimates drop constraint if exists print_estimates_intended_use_assumptions_check;
alter table public.print_estimates add constraint print_estimates_intended_use_assumptions_check check (
  (geometry_utilization_factor is null or geometry_utilization_factor between 0.05 and 0.85)
  and (recommended_infill_percent is null or recommended_infill_percent between 5 and 60)
  and (recommended_wall_loops is null or recommended_wall_loops between 2 and 6)
  and (recommended_top_bottom_layers is null or recommended_top_bottom_layers between 3 and 8)
  and (estimation_method is null or estimation_method in ('ai','fallback'))
  and (application_description is null or char_length(application_description) <= 1000)
);

do $$
begin
  if to_regprocedure('public.calculate_multi_file_estimate_core_023(jsonb,jsonb)') is null then
    alter function public.calculate_multi_file_estimate(jsonb,jsonb) rename to calculate_multi_file_estimate_core_023;
  end if;
  if to_regprocedure('public.submit_multi_file_estimate_core_023(jsonb,jsonb,jsonb)') is null then
    alter function public.submit_multi_file_estimate(jsonb,jsonb,jsonb) rename to submit_multi_file_estimate_core_023;
  end if;
end;
$$;

create or replace function public.calculate_multi_file_estimate(
  p_request jsonb, p_analysis jsonb
)
returns table(
  design_fee numeric, assembly_fee numeric, shipping numeric,
  risk_multiplier numeric, setup_charge numeric, time_charge numeric,
  material_charge numeric, plate_charge numeric,
  manufacturing_subtotal numeric, manufacturing_total numeric,
  estimated_total_min numeric, estimated_total_max numeric,
  requires_manual_review boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  calc record;
  cfg public.print_estimator_config%rowtype;
  is_intended_use boolean := p_request ->> 'fileStatus' = 'design' and p_request ->> 'serviceIntent' = 'DESIGN_AND_PRINT';
  intended_subtotal numeric;
  intended_manufacturing numeric;
begin
  select * into calc from public.calculate_multi_file_estimate_core_023(p_request, p_analysis);
  if is_intended_use then
    select * into cfg from public.print_estimator_config where singleton = true;
    intended_subtotal := round(
      cfg.manufacturing_setup_charge
      + coalesce((p_analysis ->> 'totalHours')::numeric, 0) * cfg.hourly_production_factor
      + coalesce((p_analysis ->> 'totalGrams')::numeric, 0) * cfg.material_rate_per_gram,
      2
    );
    intended_manufacturing := round(greatest(cfg.base_price, intended_subtotal), 2);
    design_fee := calc.design_fee;
    assembly_fee := calc.assembly_fee;
    shipping := calc.shipping;
    risk_multiplier := 1;
    setup_charge := cfg.manufacturing_setup_charge;
    time_charge := round(coalesce((p_analysis ->> 'totalHours')::numeric, 0) * cfg.hourly_production_factor, 2);
    material_charge := round(coalesce((p_analysis ->> 'totalGrams')::numeric, 0) * cfg.material_rate_per_gram, 2);
    plate_charge := 0;
    manufacturing_subtotal := intended_subtotal;
    manufacturing_total := intended_manufacturing;
    estimated_total_min := round(intended_manufacturing + calc.design_fee + calc.assembly_fee + calc.shipping, 2);
    estimated_total_max := estimated_total_min;
    requires_manual_review := true;
    return next;
    return;
  end if;
  design_fee := calc.design_fee;
  assembly_fee := calc.assembly_fee;
  shipping := calc.shipping;
  risk_multiplier := calc.risk_multiplier;
  setup_charge := calc.setup_charge;
  time_charge := calc.time_charge;
  material_charge := calc.material_charge;
  plate_charge := calc.plate_charge;
  manufacturing_subtotal := calc.manufacturing_subtotal;
  manufacturing_total := calc.manufacturing_total;
  estimated_total_min := calc.estimated_total_min;
  estimated_total_max := calc.estimated_total_max;
  requires_manual_review := calc.requires_manual_review;
  return next;
end;
$$;

create or replace function public.submit_multi_file_estimate(
  p_request jsonb, p_analysis jsonb, p_customer jsonb
)
returns table(
  quote_code text, manufacturing_total numeric, design_fee numeric,
  assembly_fee numeric, shipping numeric,
  estimated_total_min numeric, estimated_total_max numeric,
  notification_token uuid
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  saved record;
  assumptions jsonb := p_analysis -> 'manufacturingAssumptions';
begin
  select * into saved from public.submit_multi_file_estimate_core_023(p_request, p_analysis, p_customer);
  update public.print_estimates as estimate
  set application_category = coalesce(nullif(p_request ->> 'applicationCategory',''), nullif(assumptions ->> 'category','')),
      application_description = nullif(trim(p_request ->> 'applicationDescription'),''),
      ai_geometry_classification = nullif(assumptions ->> 'geometryType',''),
      geometry_utilization_factor = nullif(assumptions ->> 'geometryUtilizationFactor','')::numeric,
      recommended_infill_percent = nullif(assumptions ->> 'recommendedInfillPercent','')::integer,
      recommended_wall_loops = nullif(assumptions ->> 'wallLoops','')::integer,
      recommended_top_bottom_layers = nullif(assumptions ->> 'topBottomLayers','')::integer,
      estimation_method = nullif(assumptions ->> 'source',''),
      print_time_source = case when p_request ->> 'fileStatus' = 'design' and p_request ->> 'serviceIntent' = 'DESIGN_AND_PRINT'
        then 'intended_use' else estimate.print_time_source end
  where estimate.quote_code = saved.quote_code;

  quote_code := saved.quote_code;
  manufacturing_total := saved.manufacturing_total;
  design_fee := saved.design_fee;
  assembly_fee := saved.assembly_fee;
  shipping := saved.shipping;
  estimated_total_min := saved.estimated_total_min;
  estimated_total_max := saved.estimated_total_max;
  notification_token := saved.notification_token;
  return next;
end;
$$;

revoke all on function public.calculate_multi_file_estimate_core_023(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.submit_multi_file_estimate_core_023(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.calculate_multi_file_estimate(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.submit_multi_file_estimate(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.calculate_multi_file_estimate_core_023(jsonb,jsonb) to service_role;
grant execute on function public.submit_multi_file_estimate_core_023(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.calculate_multi_file_estimate(jsonb,jsonb) to service_role;
grant execute on function public.submit_multi_file_estimate(jsonb,jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';

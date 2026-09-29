-- Server-authoritative multi-file analysis, manufacturing pricing, and quote
-- submission. Run after 020_larger_finished_dimensions.sql.

alter table public.print_estimator_config
  add column if not exists manufacturing_setup_charge numeric(10,2) not null default 10
    check (manufacturing_setup_charge >= 0),
  add column if not exists plate_charge numeric(10,2) not null default 4
    check (plate_charge >= 0);

update public.print_estimator_config
set base_price = 40,
    hourly_production_factor = 5,
    material_rate_per_gram = 0.28,
    manufacturing_setup_charge = 10,
    plate_charge = 4,
    updated_at = now()
where singleton = true;

alter table public.print_estimates
  add column if not exists model_files jsonb not null default '[]'::jsonb,
  add column if not exists upload_mode text,
  add column if not exists uploaded_file_count integer not null default 0,
  add column if not exists total_print_hours numeric(14,4) not null default 0,
  add column if not exists total_filament_grams numeric(14,3) not null default 0,
  add column if not exists print_plate_count integer not null default 0,
  add column if not exists max_single_plate_hours numeric(14,4) not null default 0,
  add column if not exists risk_multiplier numeric(5,2) not null default 1,
  add column if not exists manufacturing_setup_charge numeric(12,2) not null default 0,
  add column if not exists machine_time_charge numeric(12,2) not null default 0,
  add column if not exists material_charge numeric(12,2) not null default 0,
  add column if not exists per_plate_charge numeric(12,2) not null default 0,
  add column if not exists manufacturing_subtotal numeric(12,2) not null default 0,
  add column if not exists manufacturing_total numeric(12,2) not null default 0,
  add column if not exists design_fee numeric(12,2) not null default 0,
  add column if not exists assembly_fee numeric(12,2) not null default 0,
  add column if not exists shipping_amount numeric(12,2) not null default 0,
  add column if not exists drive_model_files jsonb not null default '[]'::jsonb;

alter table public.print_estimates drop constraint if exists print_estimates_model_files_check;
alter table public.print_estimates add constraint print_estimates_model_files_check
  check (jsonb_typeof(model_files) = 'array' and jsonb_array_length(model_files) <= 8);
alter table public.print_estimates drop constraint if exists print_estimates_drive_model_files_check;
alter table public.print_estimates add constraint print_estimates_drive_model_files_check
  check (jsonb_typeof(drive_model_files) = 'array' and jsonb_array_length(drive_model_files) <= 8);
alter table public.print_estimates drop constraint if exists print_estimates_upload_mode_check;
alter table public.print_estimates add constraint print_estimates_upload_mode_check
  check (upload_mode is null or upload_mode in ('individual','project','virtual'));
alter table public.print_estimates drop constraint if exists print_estimates_multi_file_values_check;
alter table public.print_estimates add constraint print_estimates_multi_file_values_check check (
  uploaded_file_count between 0 and 8
  and total_print_hours >= 0 and total_filament_grams >= 0
  and print_plate_count >= 0 and max_single_plate_hours >= 0
  and risk_multiplier >= 1
  and manufacturing_setup_charge >= 0 and machine_time_charge >= 0
  and material_charge >= 0 and per_plate_charge >= 0
  and manufacturing_subtotal >= 0 and manufacturing_total >= 0
  and design_fee >= 0 and assembly_fee >= 0 and shipping_amount >= 0
);

alter table public.print_estimates drop constraint if exists print_estimates_print_profile_check;
alter table public.print_estimates add constraint print_estimates_print_profile_check
  check (print_profile is null or print_profile in ('detailed','standard','draft','preliminary'));

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
  cfg public.print_estimator_config%rowtype;
  intent text;
  file_status text;
  upload_mode text;
  design_level text;
  material_name text;
  colours text;
  desired_colours text;
  model_files jsonb;
  analyzed_files jsonb;
  requested_quantity integer;
  analyzed_quantity integer;
  section_count integer;
  hours numeric;
  grams numeric;
  plates integer;
  longest numeric;
  assembly_required boolean;
  manual_review boolean;
  design_amount numeric;
  assembly_amount numeric;
  risk numeric := 1;
  setup_amount numeric := 0;
  time_amount numeric := 0;
  material_amount numeric := 0;
  plates_amount numeric := 0;
  subtotal_amount numeric := 0;
  manufacturing_amount numeric := 0;
  total_amount numeric := 0;
begin
  if jsonb_typeof(p_request) <> 'object' or jsonb_typeof(p_analysis) <> 'object' then
    raise exception 'Invalid estimate analysis request';
  end if;

  select * into cfg from public.print_estimator_config where singleton = true;
  if not found then raise exception 'Estimator pricing is not configured'; end if;

  intent := p_request ->> 'serviceIntent';
  file_status := p_request ->> 'fileStatus';
  upload_mode := p_request ->> 'uploadMode';
  design_level := p_request ->> 'designLevel';
  material_name := p_request ->> 'material';
  colours := p_request ->> 'colourCount';
  desired_colours := nullif(trim(p_request ->> 'desiredColours'), '');
  model_files := coalesce(p_request -> 'modelFiles', '[]'::jsonb);
  analyzed_files := coalesce(p_analysis -> 'files', '[]'::jsonb);
  requested_quantity := coalesce((p_request ->> 'quantity')::integer, 0);
  section_count := coalesce((p_request ->> 'estimatedSectionCount')::integer, 1);
  hours := coalesce((p_analysis ->> 'totalHours')::numeric, 0);
  grams := coalesce((p_analysis ->> 'totalGrams')::numeric, 0);
  plates := coalesce((p_analysis ->> 'plateCount')::integer, 0);
  longest := coalesce((p_analysis ->> 'maxSinglePlateHours')::numeric, 0);
  assembly_required := coalesce((p_request ->> 'assemblyRequired')::boolean, false);
  manual_review := coalesce((p_analysis ->> 'manualReview')::boolean, false);

  if intent not in ('DESIGN_ONLY','DESIGN_AND_PRINT','PRINT_ONLY','MODIFY_AND_PRINT') then raise exception 'Invalid estimate service'; end if;
  if (file_status = 'ready' and intent <> 'PRINT_ONLY')
    or (file_status = 'modify' and intent <> 'MODIFY_AND_PRINT')
    or (file_status = 'design' and intent not in ('DESIGN_ONLY','DESIGN_AND_PRINT'))
    or file_status not in ('ready','modify','design') then raise exception 'Invalid estimate service'; end if;
  if requested_quantity < 1 or requested_quantity > 999 then raise exception 'Quantity must be between 1 and 999'; end if;
  if section_count < 1 or section_count > 64 then raise exception 'Invalid printable section count'; end if;
  if design_level not in ('none','simple','medium','complex')
    or (intent = 'PRINT_ONLY' and design_level <> 'none')
    or (intent <> 'PRINT_ONLY' and design_level = 'none') then raise exception 'Invalid design level'; end if;

  if jsonb_typeof(model_files) <> 'array' or jsonb_typeof(analyzed_files) <> 'array' then raise exception 'Invalid model file details'; end if;
  if intent in ('PRINT_ONLY','MODIFY_AND_PRINT') then
    if upload_mode = 'individual' and (jsonb_array_length(model_files) < 1 or jsonb_array_length(model_files) > 8) then raise exception 'Upload between 1 and 8 model files'; end if;
    if upload_mode = 'project' and jsonb_array_length(model_files) <> 1 then raise exception 'Upload one 3MF project'; end if;
    if upload_mode not in ('individual','project') then raise exception 'Choose a model upload mode'; end if;
    if jsonb_array_length(analyzed_files) <> jsonb_array_length(model_files) then raise exception 'Model analysis is incomplete'; end if;
  elsif intent = 'DESIGN_AND_PRINT' then
    if upload_mode <> 'virtual' or jsonb_array_length(model_files) <> 0 or jsonb_array_length(analyzed_files) < 1 then raise exception 'Invalid preliminary model analysis'; end if;
  else
    if upload_mode is not null or jsonb_array_length(model_files) <> 0 or jsonb_array_length(analyzed_files) <> 0 then raise exception 'Design-only estimates cannot include model files'; end if;
  end if;

  if intent = 'DESIGN_ONLY' then
    if hours <> 0 or grams <> 0 or plates <> 0 or assembly_required then raise exception 'Design-only estimates cannot include manufacturing'; end if;
  else
    if material_name not in ('PLA','PETG') then raise exception 'Choose PLA or PETG for printing'; end if;
    if colours not in ('1','2','3','4') then raise exception 'Choose a valid colour count'; end if;
    if desired_colours is null or char_length(desired_colours) > 200 then raise exception 'Enter the wanted colours using 200 characters or fewer'; end if;
    if hours <= 0 or grams <= 0 or plates < 1 or longest < 0 then raise exception 'Invalid manufacturing analysis'; end if;
    select coalesce(sum((item ->> 'quantity')::integer), 0) into analyzed_quantity
    from jsonb_array_elements(analyzed_files) item;
    if analyzed_quantity < 1 or analyzed_quantity > 999 then raise exception 'Invalid analyzed quantity'; end if;
    if upload_mode in ('individual','project') and analyzed_quantity <> requested_quantity then raise exception 'Model quantities do not match the request'; end if;
    if upload_mode = 'virtual' and analyzed_quantity <> requested_quantity * section_count then raise exception 'Preliminary model quantity does not match the request'; end if;

    risk := case when hours >= 72 or plates >= 8 then 1.15
      when hours >= 36 or plates >= 5 then 1.10
      when hours >= 12 or plates >= 3 then 1.05 else 1.00 end;
    if longest >= 20 then risk := greatest(risk, 1.10); end if;
    setup_amount := cfg.manufacturing_setup_charge;
    time_amount := round(hours * cfg.hourly_production_factor, 2);
    material_amount := round(grams * cfg.material_rate_per_gram, 2);
    plates_amount := round(plates * cfg.plate_charge, 2);
    subtotal_amount := round(setup_amount + time_amount + material_amount + plates_amount, 2);
    manufacturing_amount := round(greatest(cfg.base_price, subtotal_amount * risk), 2);
  end if;

  design_amount := case design_level when 'simple' then cfg.design_simple
    when 'medium' then cfg.design_medium when 'complex' then cfg.design_complex else 0 end;
  assembly_amount := case when assembly_required then cfg.assembly_starting_price else 0 end;
  total_amount := round(manufacturing_amount + design_amount + assembly_amount, 2);

  design_fee := round(design_amount, 2);
  assembly_fee := round(assembly_amount, 2);
  shipping := 0;
  risk_multiplier := risk;
  setup_charge := round(setup_amount, 2);
  time_charge := time_amount;
  material_charge := material_amount;
  plate_charge := plates_amount;
  manufacturing_subtotal := subtotal_amount;
  manufacturing_total := manufacturing_amount;
  estimated_total_min := total_amount;
  estimated_total_max := total_amount;
  requires_manual_review := manual_review or intent <> 'PRINT_ONLY' or assembly_required or colours in ('3','4');
  return next;
end;
$$;

revoke all on function public.calculate_multi_file_estimate(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.calculate_multi_file_estimate(jsonb,jsonb) to service_role;

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
  calc record;
  generated_code text;
  saved_token uuid;
  attempts integer := 0;
  intent text := p_request ->> 'serviceIntent';
  file_status text := p_request ->> 'fileStatus';
  upload_mode_value text := p_request ->> 'uploadMode';
  model_files_value jsonb := coalesce(p_analysis -> 'files', '[]'::jsonb);
  request_model_files jsonb := coalesce(p_request -> 'modelFiles', '[]'::jsonb);
  reference_files_value jsonb := coalesce(p_customer -> 'referenceFiles', '[]'::jsonb);
  clean_name text := nullif(trim(p_customer ->> 'name'), '');
  clean_notes text := nullif(trim(p_customer ->> 'notes'), '');
  first_model jsonb;
  first_path text;
  first_name text;
  item jsonb;
  attachment jsonb;
  quantity_value integer := (p_request ->> 'quantity')::integer;
  hours numeric := coalesce((p_analysis ->> 'totalHours')::numeric, 0);
  grams numeric := coalesce((p_analysis ->> 'totalGrams')::numeric, 0);
  plates integer := coalesce((p_analysis ->> 'plateCount')::integer, 0);
  longest numeric := coalesce((p_analysis ->> 'maxSinglePlateHours')::numeric, 0);
  total_minutes_per_item integer;
  hours_per_item integer;
  minutes_per_item integer;
  filament_per_item numeric;
  print_source text;
  print_profile_value text;
  upload_root text := p_request ->> 'uploadRoot';
begin
  select * into calc from public.calculate_multi_file_estimate(p_request, p_analysis);
  if clean_name is not null and char_length(clean_name) > 120 then raise exception 'Name is too long'; end if;
  if clean_notes is not null and char_length(clean_notes) > 3000 then raise exception 'Notes are too long'; end if;
  if upload_root !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid private upload folder'; end if;

  if jsonb_typeof(reference_files_value) <> 'array' or jsonb_array_length(reference_files_value) > 10 then raise exception 'Upload no more than 10 reference images'; end if;
  for attachment in select value from jsonb_array_elements(reference_files_value)
  loop
    if jsonb_typeof(attachment) <> 'object'
      or coalesce(attachment ->> 'path','') !~ '^[0-9a-f-]{36}/references/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|heic|heif|gif)$'
      or coalesce(attachment ->> 'name','') = '' or char_length(attachment ->> 'name') > 255
      or coalesce(attachment ->> 'size_bytes','') !~ '^[0-9]+$'
      or (attachment ->> 'size_bytes')::bigint < 1 or (attachment ->> 'size_bytes')::bigint > 10485760
      or split_part(attachment ->> 'path','/',1) <> upload_root
    then raise exception 'Invalid reference image details'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(reference_files_value)) <>
     (select count(distinct value ->> 'path') from jsonb_array_elements(reference_files_value)) then raise exception 'Duplicate reference image path'; end if;

  for item in select value from jsonb_array_elements(model_files_value)
  loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'analysis_path','') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.stl$'
      or coalesce(item ->> 'name','') = '' or char_length(item ->> 'name') > 255
      or coalesce(item ->> 'quantity','') !~ '^[0-9]+$'
      or (item ->> 'quantity')::integer < 1 or (item ->> 'quantity')::integer > 999
      or split_part(item ->> 'analysis_path','/',1) <> upload_root
    then raise exception 'Invalid model analysis details'; end if;
    if upload_mode_value in ('individual','project')
      and coalesce(item ->> 'path','') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(stl|3mf|obj|step|stp)$'
    then raise exception 'Invalid uploaded model path'; end if;
    if nullif(item ->> 'path','') is not null and split_part(item ->> 'path','/',1) <> upload_root
    then raise exception 'Invalid uploaded model folder'; end if;
  end loop;

  first_model := case when jsonb_array_length(request_model_files) > 0 then request_model_files -> 0 else null end;
  first_path := nullif(first_model ->> 'path','');
  first_name := nullif(trim(first_model ->> 'name'),'');
  total_minutes_per_item := case when intent = 'DESIGN_ONLY' then null else round(hours * 60 / quantity_value)::integer end;
  hours_per_item := case when total_minutes_per_item is null then null else total_minutes_per_item / 60 end;
  minutes_per_item := case when total_minutes_per_item is null then null else mod(total_minutes_per_item, 60) end;
  filament_per_item := case when intent = 'DESIGN_ONLY' then null else round(grams / quantity_value, 3) end;
  print_source := case when intent = 'DESIGN_ONLY' then 'unknown' when upload_mode_value = 'virtual' then 'virtual_bounding_box' else 'slicer' end;
  print_profile_value := case when intent = 'DESIGN_ONLY' then null else p_request ->> 'printProfile' end;

  loop
    attempts := attempts + 1;
    generated_code := public.generate_print_quote_code();
    begin
      insert into public.print_estimates (
        quote_code,name,email,file_path,original_file_name,file_status,service_intent,
        quantity,print_hours_per_item,print_minutes_per_item,filament_grams_per_item,
        size_category,colour_count,material,desired_colours,design_level,assembly_required,notes,
        estimated_production_hours,estimated_production_hours_max,estimated_material_grams,
        estimated_price,estimated_price_max,estimated_price_per_item,estimated_price_per_item_max,
        requires_manual_review,print_time_source,print_profile,purge_waste_percent,
        model_width_mm,model_depth_mm,model_height_mm,submitted_length,submitted_width,
        submitted_height,dimension_unit,split_and_assembly_accepted,estimated_section_count,
        design_estimate_min,design_estimate_max,print_estimate_min,print_estimate_max,
        estimated_total_min,estimated_total_max,final_price,final_quantity,reference_files,
        model_files,upload_mode,uploaded_file_count,total_print_hours,total_filament_grams,
        print_plate_count,max_single_plate_hours,risk_multiplier,manufacturing_setup_charge,
        machine_time_charge,material_charge,per_plate_charge,manufacturing_subtotal,
        manufacturing_total,design_fee,assembly_fee,shipping_amount
      ) values (
        generated_code,clean_name,null,first_path,first_name,file_status,intent,
        quantity_value,hours_per_item,minutes_per_item,filament_per_item,
        null,coalesce(p_request ->> 'colourCount','1'),p_request ->> 'material',nullif(trim(p_request ->> 'desiredColours'),''),
        p_request ->> 'designLevel',coalesce((p_request ->> 'assemblyRequired')::boolean,false),clean_notes,
        hours,hours,grams,calc.estimated_total_min,calc.estimated_total_max,
        round(calc.estimated_total_min / quantity_value,2),round(calc.estimated_total_max / quantity_value,2),
        calc.requires_manual_review,print_source,print_profile_value,0,
        (p_request ->> 'modelLengthMm')::numeric,(p_request ->> 'modelWidthMm')::numeric,(p_request ->> 'modelHeightMm')::numeric,
        (p_request ->> 'submittedLength')::numeric,(p_request ->> 'submittedWidth')::numeric,
        (p_request ->> 'submittedHeight')::numeric,p_request ->> 'dimensionUnit',
        coalesce((p_request ->> 'splitAccepted')::boolean,false),coalesce((p_request ->> 'estimatedSectionCount')::integer,1),
        calc.design_fee,calc.design_fee,case when intent = 'DESIGN_ONLY' then null else calc.manufacturing_total end,
        case when intent = 'DESIGN_ONLY' then null else calc.manufacturing_total end,
        calc.estimated_total_min,calc.estimated_total_max,calc.estimated_total_max,quantity_value,reference_files_value,
        model_files_value,upload_mode_value,jsonb_array_length(request_model_files),hours,grams,plates,longest,
        calc.risk_multiplier,calc.setup_charge,calc.time_charge,calc.material_charge,calc.plate_charge,
        calc.manufacturing_subtotal,calc.manufacturing_total,calc.design_fee,calc.assembly_fee,calc.shipping
      ) returning print_estimates.notification_token into saved_token;
      exit;
    exception when unique_violation then
      if attempts >= 10 then raise exception 'Could not generate a quote code'; end if;
    end;
  end loop;

  quote_code := generated_code;
  manufacturing_total := calc.manufacturing_total;
  design_fee := calc.design_fee;
  assembly_fee := calc.assembly_fee;
  shipping := calc.shipping;
  estimated_total_min := calc.estimated_total_min;
  estimated_total_max := calc.estimated_total_max;
  notification_token := saved_token;
  return next;
end;
$$;

revoke all on function public.submit_multi_file_estimate(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.submit_multi_file_estimate(jsonb,jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';

-- Follow-up for installations where 004_print_estimator.sql was already run.
-- Contact stays in Etsy; the website stores only an optional customer name.
-- Uploaded models are sliced in the browser. Pricing adds a centrally managed
-- multi-colour purge allowance to the generated per-item print time.

alter table public.print_estimator_config
  add column if not exists colour_purge_percent jsonb not null
  default '{"1":0,"2":10,"3":18,"4":25}'::jsonb;

alter table public.print_estimates alter column name drop not null;
alter table public.print_estimates alter column email drop not null;

alter table public.print_estimates add column if not exists print_profile text;
alter table public.print_estimates drop constraint if exists print_estimates_print_profile_check;
alter table public.print_estimates add constraint print_estimates_print_profile_check
  check (print_profile is null or print_profile in ('detailed','standard','draft'));

alter table public.print_estimates
  add column if not exists purge_waste_percent numeric(5,2) not null default 0
  check (purge_waste_percent between 0 and 100);

alter table public.print_estimates drop constraint if exists print_estimates_colour_count_check;
update public.print_estimates set colour_count = '4' where colour_count = '4+';
alter table public.print_estimates add constraint print_estimates_colour_count_check
  check (colour_count in ('1','2','3','4'));

alter table public.print_estimates add column if not exists print_time_source text;
update public.print_estimates
set print_time_source = case when size_category is not null then 'unknown' else 'manual' end
where print_time_source is null;
alter table public.print_estimates alter column print_time_source set default 'unknown';
alter table public.print_estimates alter column print_time_source set not null;
alter table public.print_estimates drop constraint if exists print_estimates_print_time_source_check;
alter table public.print_estimates add constraint print_estimates_print_time_source_check
  check (print_time_source in ('slicer','gcode','manual','unknown'));

create or replace function public.compute_print_estimate(
  p_file_status text, p_quantity integer, p_print_hours_per_item integer,
  p_print_minutes_per_item integer, p_size_category text, p_colour_count text,
  p_design_level text, p_assembly_required boolean
)
returns table(production_hours_min numeric, production_hours_max numeric,
  price_min numeric, price_max numeric, per_item_min numeric, per_item_max numeric,
  manual_review boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.print_estimator_config%rowtype;
  hours_min numeric;
  hours_max numeric;
  design_price numeric;
  purge_percent numeric;
begin
  select * into cfg from public.print_estimator_config where singleton = true;
  if p_file_status not in ('ready','modify','design') then raise exception 'Select a valid file status'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'Quantity must be between 1 and 999'; end if;
  if p_colour_count not in ('1','2','3','4') then raise exception 'Select between 1 and 4 colours'; end if;
  if (p_file_status = 'ready' and p_design_level <> 'none') or (p_file_status <> 'ready' and p_design_level not in ('simple','medium','complex')) then raise exception 'Select a valid design level'; end if;
  if p_size_category is not null then
    if not (cfg.size_hours ? p_size_category) then raise exception 'Select a valid size'; end if;
    hours_min := ((cfg.size_hours -> p_size_category ->> 'min')::numeric) * p_quantity;
    hours_max := ((cfg.size_hours -> p_size_category ->> 'max')::numeric) * p_quantity;
  else
    if p_print_hours_per_item is null or p_print_minutes_per_item is null or p_print_hours_per_item < 0 or p_print_hours_per_item > 1000 or p_print_minutes_per_item < 0 or p_print_minutes_per_item > 59 or (p_print_hours_per_item = 0 and p_print_minutes_per_item = 0) then raise exception 'Enter a valid print time for one item'; end if;
    hours_min := (p_print_hours_per_item + p_print_minutes_per_item / 60.0) * p_quantity;
    hours_max := hours_min;
  end if;
  purge_percent := coalesce((cfg.colour_purge_percent ->> p_colour_count)::numeric, 0);
  if purge_percent < 0 or purge_percent > 100 then raise exception 'Invalid purge allowance configuration'; end if;
  hours_min := hours_min * (1 + purge_percent / 100.0);
  hours_max := hours_max * (1 + purge_percent / 100.0);
  design_price := case p_design_level when 'none' then 0 when 'simple' then cfg.design_simple when 'medium' then cfg.design_medium when 'complex' then cfg.design_complex else null end;
  production_hours_min := round(hours_min, 2);
  production_hours_max := round(hours_max, 2);
  price_min := round(cfg.base_price + hours_min * cfg.hourly_production_factor + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end, 2);
  price_max := round(cfg.base_price + hours_max * cfg.hourly_production_factor + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end, 2);
  per_item_min := round(price_min / p_quantity, 2);
  per_item_max := round(price_max / p_quantity, 2);
  manual_review := p_assembly_required or p_size_category is not null or p_colour_count in ('3','4') or p_file_status <> 'ready';
  return next;
end;
$$;

drop function if exists public.submit_print_estimate(text,text,text,text,integer,integer,integer,text,text,text,boolean,text);
drop function if exists public.submit_print_estimate(text,text,integer,integer,integer,text,text,text,boolean,text,text,text);
drop function if exists public.submit_print_estimate(text,text,integer,integer,integer,text,text,text,boolean,text,text,text,text);

create or replace function public.submit_print_estimate(
  p_file_path text, p_file_status text, p_quantity integer,
  p_print_hours_per_item integer default null, p_print_minutes_per_item integer default null,
  p_size_category text default null, p_colour_count text default '1',
  p_design_level text default 'none', p_assembly_required boolean default false,
  p_print_time_source text default 'unknown', p_print_profile text default null,
  p_name text default null, p_notes text default null
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
  if p_print_time_source = 'unknown' and (p_print_profile is not null or p_size_category is distinct from 'not_sure' or p_print_hours_per_item is not null or p_print_minutes_per_item is not null) then raise exception 'Unknown print time must use file review'; end if;
  if p_print_time_source = 'slicer' and (p_print_profile not in ('detailed','standard','draft') or p_size_category is not null or p_print_hours_per_item is null or p_print_minutes_per_item is null) then raise exception 'A sliced print time and profile are required'; end if;
  select * into calc from public.compute_print_estimate(p_file_status,p_quantity,p_print_hours_per_item,p_print_minutes_per_item,p_size_category,p_colour_count,p_design_level,p_assembly_required);
  select * into cfg from public.print_estimator_config where singleton = true;
  purge_percent := coalesce((cfg.colour_purge_percent ->> p_colour_count)::numeric, 0);
  loop
    attempts := attempts + 1; generated_code := public.generate_print_quote_code();
    begin
      insert into public.print_estimates (quote_code,name,email,file_path,file_status,quantity,print_hours_per_item,print_minutes_per_item,size_category,colour_count,design_level,assembly_required,notes,estimated_production_hours,estimated_production_hours_max,estimated_price,estimated_price_max,estimated_price_per_item,estimated_price_per_item_max,requires_manual_review,print_time_source,print_profile,purge_waste_percent)
      values (generated_code,clean_name,null,p_file_path,p_file_status,p_quantity,p_print_hours_per_item,p_print_minutes_per_item,p_size_category,p_colour_count,p_design_level,p_assembly_required,nullif(trim(p_notes),''),calc.production_hours_min,calc.production_hours_max,calc.price_min,calc.price_max,calc.per_item_min,calc.per_item_max,calc.manual_review,p_print_time_source,p_print_profile,purge_percent);
      exit;
    exception when unique_violation then if attempts >= 10 then raise exception 'Could not generate a quote code'; end if;
    end;
  end loop;
  quote_code := generated_code; estimated_price_min := calc.price_min; estimated_price_max := calc.price_max; return next;
end;
$$;

revoke all on function public.submit_print_estimate(text,text,integer,integer,integer,text,text,text,boolean,text,text,text,text) from public;
grant execute on function public.submit_print_estimate(text,text,integer,integer,integer,text,text,text,boolean,text,text,text,text) to anon, authenticated;

-- Mucci Products 3D printing estimator.
-- Run after 003_restrict_card_admin.sql. Pricing and size assumptions live only
-- in print_estimator_config; the public roles cannot read this table.

create table public.print_estimator_config (
  singleton boolean primary key default true check (singleton),
  base_price numeric(10,2) not null check (base_price >= 0),
  hourly_production_factor numeric(10,2) not null check (hourly_production_factor >= 0),
  design_simple numeric(10,2) not null check (design_simple >= 0),
  design_medium numeric(10,2) not null check (design_medium >= 0),
  design_complex numeric(10,2) not null check (design_complex >= 0),
  assembly_starting_price numeric(10,2) not null check (assembly_starting_price >= 0),
  size_hours jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.print_estimator_config (
  singleton, base_price, hourly_production_factor, design_simple, design_medium,
  design_complex, assembly_starting_price, size_hours
) values (
  true, 40, 2, 50, 100, 250, 650,
  '{"small":{"min":1,"max":4},"medium":{"min":4,"max":12},"large":{"min":12,"max":30},"extra_large":{"min":30,"max":60},"not_sure":{"min":1,"max":60}}'::jsonb
);

revoke all on public.print_estimator_config from public, anon, authenticated;

-- Only values that are intentionally displayed beside public options are returned.
-- Base price, hourly factor, and size assumptions remain private.
create or replace function public.get_print_estimator_public_options()
returns table(design_simple numeric, design_medium numeric, design_complex numeric, assembly_starting_price numeric)
language sql stable security definer set search_path = '' as $$
  select cfg.design_simple, cfg.design_medium, cfg.design_complex, cfg.assembly_starting_price
  from public.print_estimator_config cfg where cfg.singleton = true;
$$;

revoke all on function public.get_print_estimator_public_options() from public;
grant execute on function public.get_print_estimator_public_options() to anon, authenticated;

create table public.print_estimates (
  id uuid primary key default gen_random_uuid(),
  quote_code text unique not null check (quote_code ~ '^MP-[A-HJ-NP-Z2-9]{5}$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  file_path text check (char_length(file_path) <= 500),
  file_status text not null check (file_status in ('ready','modify','design')),
  quantity integer not null check (quantity between 1 and 999),
  print_hours_per_item integer check (print_hours_per_item between 0 and 1000),
  print_minutes_per_item integer check (print_minutes_per_item between 0 and 59),
  size_category text check (size_category in ('small','medium','large','extra_large','not_sure')),
  colour_count text not null check (colour_count in ('1','2','3','4+')),
  design_level text not null check (design_level in ('none','simple','medium','complex')),
  assembly_required boolean not null default false,
  notes text check (char_length(notes) <= 3000),
  estimated_production_hours numeric(12,2) not null,
  estimated_production_hours_max numeric(12,2) not null,
  estimated_price numeric(12,2) not null,
  estimated_price_max numeric(12,2) not null,
  estimated_price_per_item numeric(12,2) not null,
  estimated_price_per_item_max numeric(12,2) not null,
  requires_manual_review boolean not null default false,
  status text not null default 'pending' check (status in ('pending','reviewed','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (size_category is not null and print_hours_per_item is null and print_minutes_per_item is null)
    or
    (size_category is null and print_hours_per_item is not null and print_minutes_per_item is not null)
  )
);

create index print_estimates_created_idx on public.print_estimates (created_at desc);
create index print_estimates_quote_code_idx on public.print_estimates (quote_code);
alter table public.print_estimates enable row level security;

create policy "admin reads print estimates" on public.print_estimates for select to authenticated
  using (public.is_mucci_card_admin());
create policy "admin updates print estimates" on public.print_estimates for update to authenticated
  using (public.is_mucci_card_admin()) with check (public.is_mucci_card_admin());

revoke all on public.print_estimates from anon;
grant select, update on public.print_estimates to authenticated;

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
begin
  select * into cfg from public.print_estimator_config where singleton = true;
  if p_file_status not in ('ready','modify','design') then raise exception 'Select a valid file status'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then raise exception 'Quantity must be between 1 and 999'; end if;
  if p_colour_count not in ('1','2','3','4+') then raise exception 'Select a valid colour count'; end if;
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
  design_price := case p_design_level when 'none' then 0 when 'simple' then cfg.design_simple when 'medium' then cfg.design_medium when 'complex' then cfg.design_complex else null end;
  production_hours_min := round(hours_min, 2);
  production_hours_max := round(hours_max, 2);
  price_min := round(cfg.base_price + hours_min * cfg.hourly_production_factor + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end, 2);
  price_max := round(cfg.base_price + hours_max * cfg.hourly_production_factor + design_price + case when p_assembly_required then cfg.assembly_starting_price else 0 end, 2);
  per_item_min := round(price_min / p_quantity, 2);
  per_item_max := round(price_max / p_quantity, 2);
  manual_review := p_assembly_required or p_size_category is not null or p_colour_count in ('3','4+') or p_file_status <> 'ready';
  return next;
end;
$$;

revoke all on function public.compute_print_estimate(text,integer,integer,integer,text,text,text,boolean) from public;

create or replace function public.calculate_print_estimate(
  p_file_status text, p_quantity integer, p_print_hours_per_item integer default null,
  p_print_minutes_per_item integer default null, p_size_category text default null,
  p_colour_count text default '1', p_design_level text default 'none',
  p_assembly_required boolean default false
)
returns table(estimated_price_min numeric, estimated_price_max numeric,
  price_per_item_min numeric, price_per_item_max numeric, requires_manual_review boolean)
language sql stable security definer set search_path = '' as $$
  select price_min, price_max, per_item_min, per_item_max, manual_review
  from public.compute_print_estimate(p_file_status,p_quantity,p_print_hours_per_item,
    p_print_minutes_per_item,p_size_category,p_colour_count,p_design_level,p_assembly_required);
$$;

revoke all on function public.calculate_print_estimate(text,integer,integer,integer,text,text,text,boolean) from public;
grant execute on function public.calculate_print_estimate(text,integer,integer,integer,text,text,text,boolean) to anon, authenticated;

create or replace function public.generate_print_quote_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; generated text := 'MP-'; i integer;
begin
  for i in 1..5 loop generated := generated || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1); end loop;
  return generated;
end;
$$;
revoke all on function public.generate_print_quote_code() from public;

create or replace function public.submit_print_estimate(
  p_name text, p_email text, p_file_path text, p_file_status text, p_quantity integer,
  p_print_hours_per_item integer default null, p_print_minutes_per_item integer default null,
  p_size_category text default null, p_colour_count text default '1',
  p_design_level text default 'none', p_assembly_required boolean default false,
  p_notes text default null
)
returns table(quote_code text, estimated_price_min numeric, estimated_price_max numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare calc record; generated_code text; attempts integer := 0;
begin
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 120 then raise exception 'Enter a valid name'; end if;
  if p_email is null or p_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or char_length(p_email) > 254 then raise exception 'Enter a valid email address'; end if;
  if p_notes is not null and char_length(p_notes) > 3000 then raise exception 'Notes are too long'; end if;
  if p_file_path is not null and p_file_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(stl|3mf|obj|step|stp)$' then raise exception 'Invalid uploaded file path'; end if;
  select * into calc from public.compute_print_estimate(p_file_status,p_quantity,p_print_hours_per_item,p_print_minutes_per_item,p_size_category,p_colour_count,p_design_level,p_assembly_required);
  loop
    attempts := attempts + 1; generated_code := public.generate_print_quote_code();
    begin
      insert into public.print_estimates (quote_code,name,email,file_path,file_status,quantity,print_hours_per_item,print_minutes_per_item,size_category,colour_count,design_level,assembly_required,notes,estimated_production_hours,estimated_production_hours_max,estimated_price,estimated_price_max,estimated_price_per_item,estimated_price_per_item_max,requires_manual_review)
      values (generated_code,trim(p_name),lower(trim(p_email)),p_file_path,p_file_status,p_quantity,p_print_hours_per_item,p_print_minutes_per_item,p_size_category,p_colour_count,p_design_level,p_assembly_required,nullif(trim(p_notes),''),calc.production_hours_min,calc.production_hours_max,calc.price_min,calc.price_max,calc.per_item_min,calc.per_item_max,calc.manual_review);
      exit;
    exception when unique_violation then if attempts >= 10 then raise exception 'Could not generate a quote code'; end if;
    end;
  end loop;
  quote_code := generated_code; estimated_price_min := calc.price_min; estimated_price_max := calc.price_max; return next;
end;
$$;

revoke all on function public.submit_print_estimate(text,text,text,text,integer,integer,integer,text,text,text,boolean,text) from public;
grant execute on function public.submit_print_estimate(text,text,text,text,integer,integer,integer,text,text,text,boolean,text) to anon, authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('print-estimate-files','print-estimate-files',false,26214400,null)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=null;

create policy "anonymous uploads print estimate files" on storage.objects for insert to anon
  with check (bucket_id='print-estimate-files' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(stl|3mf|obj|step|stp)$');
create policy "admin reads print estimate files" on storage.objects for select to authenticated
  using (bucket_id='print-estimate-files' and public.is_mucci_card_admin());

create trigger print_estimates_updated_at before update on public.print_estimates
for each row execute function public.touch_updated_at();

-- Preserve the customer-facing filename and issue a private, single-estimate
-- notification token. Email credentials remain in the server environment.

alter table public.print_estimates
  add column if not exists original_file_name text
  check (original_file_name is null or char_length(original_file_name) between 1 and 255);

alter table public.print_estimates
  add column if not exists notification_token uuid not null default gen_random_uuid();

alter table public.print_estimates
  add column if not exists email_notification_sent_at timestamptz;

create or replace function public.submit_print_estimate(
  p_file_path text, p_file_status text, p_quantity integer,
  p_print_hours_per_item integer default null, p_print_minutes_per_item integer default null,
  p_filament_grams_per_item numeric default null, p_size_category text default null,
  p_colour_count text default '1', p_design_level text default 'none',
  p_assembly_required boolean default false, p_print_time_source text default 'unknown',
  p_print_profile text default null, p_name text default null, p_notes text default null,
  p_original_file_name text default null
)
returns table(quote_code text, estimated_price_min numeric, estimated_price_max numeric,
  notification_token uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare
  submitted record;
  saved_token uuid;
  clean_file_name text;
begin
  clean_file_name := nullif(trim(p_original_file_name), '');
  if clean_file_name is not null and (char_length(clean_file_name) > 255 or clean_file_name ~ '[[:cntrl:]]') then raise exception 'Invalid model filename'; end if;
  if p_file_path is null and clean_file_name is not null then raise exception 'A filename requires an uploaded model'; end if;

  select * into submitted from public.submit_print_estimate(
    p_file_path,p_file_status,p_quantity,p_print_hours_per_item,
    p_print_minutes_per_item,p_filament_grams_per_item,p_size_category,
    p_colour_count,p_design_level,p_assembly_required,p_print_time_source,
    p_print_profile,p_name,p_notes
  );

  update public.print_estimates
  set original_file_name = clean_file_name
  where print_estimates.quote_code = submitted.quote_code
  returning print_estimates.notification_token into saved_token;

  quote_code := submitted.quote_code;
  estimated_price_min := submitted.estimated_price_min;
  estimated_price_max := submitted.estimated_price_max;
  notification_token := saved_token;
  return next;
end;
$$;

revoke all on function public.submit_print_estimate(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text) from public;
grant execute on function public.submit_print_estimate(text,text,integer,integer,integer,numeric,text,text,text,boolean,text,text,text,text,text) to anon, authenticated;

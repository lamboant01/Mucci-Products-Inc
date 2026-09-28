-- Add private reference-image attachments to an estimate. The browser stores
-- these beside the model under the same per-submission UUID folder and the
-- Drive mirror places every file in the same quote-code folder.

alter table public.print_estimates
  add column if not exists reference_files jsonb not null default '[]'::jsonb;

alter table public.print_estimates
  add column if not exists drive_reference_files jsonb not null default '[]'::jsonb;

alter table public.print_estimates
  drop constraint if exists print_estimates_reference_files_check;
alter table public.print_estimates
  add constraint print_estimates_reference_files_check
  check (jsonb_typeof(reference_files) = 'array' and jsonb_array_length(reference_files) <= 10);

alter table public.print_estimates
  drop constraint if exists print_estimates_drive_reference_files_check;
alter table public.print_estimates
  add constraint print_estimates_drive_reference_files_check
  check (jsonb_typeof(drive_reference_files) = 'array' and jsonb_array_length(drive_reference_files) <= 10);

drop policy if exists "anonymous uploads print estimate reference images" on storage.objects;
create policy "anonymous uploads print estimate reference images"
on storage.objects for insert to anon
with check (
  bucket_id = 'print-estimate-files'
  and name ~ '^[0-9a-f-]{36}/references/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|heic|heif|gif)$'
);

drop policy if exists "authenticated uploads print estimate reference images" on storage.objects;
create policy "authenticated uploads print estimate reference images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'print-estimate-files'
  and name ~ '^[0-9a-f-]{36}/references/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|heic|heif|gif)$'
);

create or replace function public.submit_service_estimate(
  p_file_path text, p_original_file_name text, p_file_status text, p_service_intent text,
  p_quantity integer, p_print_hours_per_item integer, p_print_minutes_per_item integer,
  p_filament_grams_per_item numeric, p_colour_count text, p_material text,
  p_desired_colours text, p_design_level text,
  p_assembly_required boolean, p_split_and_assembly_accepted boolean,
  p_estimated_section_count integer, p_print_time_source text, p_print_profile text,
  p_name text, p_notes text, p_model_length_mm numeric, p_model_width_mm numeric,
  p_model_height_mm numeric, p_submitted_length numeric, p_submitted_width numeric,
  p_submitted_height numeric, p_dimension_unit text, p_reference_files jsonb
)
returns table(
  quote_code text, design_estimate_min numeric, design_estimate_max numeric,
  print_estimate_min numeric, print_estimate_max numeric,
  estimated_total_min numeric, estimated_total_max numeric, notification_token uuid
)
language plpgsql volatile security definer set search_path = '' as $$
declare
  submitted record;
  attachment jsonb;
  attachment_path text;
  attachment_name text;
  attachment_type text;
  attachment_size_text text;
begin
  p_reference_files := coalesce(p_reference_files, '[]'::jsonb);
  if jsonb_typeof(p_reference_files) <> 'array' or jsonb_array_length(p_reference_files) > 10 then
    raise exception 'Upload no more than 10 reference images';
  end if;

  for attachment in select value from jsonb_array_elements(p_reference_files)
  loop
    if jsonb_typeof(attachment) <> 'object' then raise exception 'Invalid reference image details'; end if;
    attachment_path := attachment ->> 'path';
    attachment_name := attachment ->> 'name';
    attachment_type := attachment ->> 'content_type';
    attachment_size_text := attachment ->> 'size_bytes';
    if attachment_path is null or attachment_path !~ '^[0-9a-f-]{36}/references/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|heic|heif|gif)$' then
      raise exception 'Invalid reference image path';
    end if;
    if attachment_name is null or char_length(trim(attachment_name)) < 1
      or char_length(attachment_name) > 255 or attachment_name ~ '[[:cntrl:]]' then
      raise exception 'Invalid reference image filename';
    end if;
    if attachment_type not in ('image/png','image/jpeg','image/webp','image/heic','image/heif','image/gif') then
      raise exception 'Unsupported reference image type';
    end if;
    if attachment_size_text is null or attachment_size_text !~ '^[0-9]+$' then
      raise exception 'Each reference image must be 10 MB or smaller';
    end if;
    if attachment_size_text::numeric < 1 or attachment_size_text::numeric > 10485760 then
      raise exception 'Each reference image must be 10 MB or smaller';
    end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_reference_files)) <>
     (select count(distinct value ->> 'path') from jsonb_array_elements(p_reference_files)) then
    raise exception 'Duplicate reference image path';
  end if;

  select * into submitted from public.submit_service_estimate(
    p_file_path,p_original_file_name,p_file_status,p_service_intent,p_quantity,
    p_print_hours_per_item,p_print_minutes_per_item,p_filament_grams_per_item,
    p_colour_count,p_material,p_desired_colours,p_design_level,p_assembly_required,
    p_split_and_assembly_accepted,p_estimated_section_count,p_print_time_source,
    p_print_profile,p_name,p_notes,p_model_length_mm,p_model_width_mm,p_model_height_mm,
    p_submitted_length,p_submitted_width,p_submitted_height,p_dimension_unit
  );

  update public.print_estimates
  set reference_files = p_reference_files
  where print_estimates.quote_code = submitted.quote_code;

  quote_code := submitted.quote_code;
  design_estimate_min := submitted.design_estimate_min;
  design_estimate_max := submitted.design_estimate_max;
  print_estimate_min := submitted.print_estimate_min;
  print_estimate_max := submitted.print_estimate_max;
  estimated_total_min := submitted.estimated_total_min;
  estimated_total_max := submitted.estimated_total_max;
  notification_token := submitted.notification_token;
  return next;
end;
$$;

revoke all on function public.submit_service_estimate(
  text,text,text,text,integer,integer,integer,numeric,text,text,text,text,boolean,boolean,integer,text,text,text,text,
  numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb
) from public;
grant execute on function public.submit_service_estimate(
  text,text,text,text,integer,integer,integer,numeric,text,text,text,text,boolean,boolean,integer,text,text,text,text,
  numeric,numeric,numeric,numeric,numeric,numeric,text,jsonb
) to anon, authenticated;

notify pgrst, 'reload schema';

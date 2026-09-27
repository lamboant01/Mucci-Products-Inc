-- Store the private Google Drive mirror created by the server after a model is
-- safely stored in the private Supabase bucket.

alter table public.print_estimates
  add column if not exists drive_file_id text
  check (drive_file_id is null or char_length(drive_file_id) between 10 and 255);

alter table public.print_estimates
  add column if not exists drive_web_view_link text
  check (drive_web_view_link is null or drive_web_view_link ~ '^https://drive\.google\.com/');

alter table public.print_estimates
  add column if not exists drive_mirrored_at timestamptz;

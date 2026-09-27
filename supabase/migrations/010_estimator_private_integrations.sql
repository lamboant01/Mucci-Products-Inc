-- Store the Google OAuth refresh token server-side. RLS is enabled with no
-- customer or administrator policies; only the service role can read or write.

create table if not exists public.estimate_private_integrations (
  singleton boolean primary key default true check (singleton),
  google_drive_refresh_token text not null
    check (char_length(google_drive_refresh_token) between 20 and 4096),
  updated_at timestamptz not null default now()
);

alter table public.estimate_private_integrations enable row level security;

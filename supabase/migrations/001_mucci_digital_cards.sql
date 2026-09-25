-- Mucci Digital Cards: run once in the Supabase SQL editor.
-- The frontend must use only the anon key. Never expose the service-role key.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  company text check (char_length(company) <= 160), title text check (char_length(title) <= 160),
  phone text check (char_length(phone) <= 50), email text check (char_length(email) <= 254),
  website text check (char_length(website) <= 500), linkedin text check (char_length(linkedin) <= 500),
  instagram text check (char_length(instagram) <= 500), address text check (char_length(address) <= 500),
  bio text check (char_length(bio) <= 1000), logo_url text, profile_image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.physical_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  public_token text unique not null default encode(gen_random_bytes(24), 'hex')
    check (public_token ~ '^[A-Za-z0-9_-]{16,128}$'),
  card_label text check (char_length(card_label) <= 120), is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.saved_profiles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  saved_at timestamptz not null default now(), last_viewed_at timestamptz not null default now(),
  unique (user_id, profile_id)
);

create index physical_cards_token_idx on public.physical_cards(public_token);
create index profiles_owner_idx on public.profiles(owner_user_id);
create index saved_profiles_user_idx on public.saved_profiles(user_id);

alter table public.profiles enable row level security;
alter table public.physical_cards enable row level security;
alter table public.saved_profiles enable row level security;

-- No anonymous table SELECT policies exist. Public access is RPC-only.
create policy "owners read own profiles" on public.profiles for select to authenticated using (owner_user_id = auth.uid());
create policy "owners update own profiles" on public.profiles for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "owners read cards for own profiles" on public.physical_cards for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.owner_user_id = auth.uid()));
create policy "users read own saved profiles" on public.saved_profiles for select to authenticated using (user_id = auth.uid());
create policy "users insert own saved profiles" on public.saved_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "users update own saved profiles" on public.saved_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users delete own saved profiles" on public.saved_profiles for delete to authenticated using (user_id = auth.uid());

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();

create or replace function public.get_public_card_profile(lookup_token text)
returns table(name text, company text, title text, phone text, email text, website text, linkedin text,
  instagram text, address text, bio text, logo_url text, profile_image_url text)
language sql stable security definer set search_path = '' as $$
  select p.name,p.company,p.title,p.phone,p.email,p.website,p.linkedin,p.instagram,p.address,p.bio,p.logo_url,p.profile_image_url
  from public.physical_cards c join public.profiles p on p.id=c.profile_id
  where c.public_token=lookup_token and c.is_active=true and p.is_active=true limit 1;
$$;

-- Authenticated visitors can sync a known token without learning internal IDs.
create or replace function public.save_scanned_profile(lookup_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare matched_profile uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.id into matched_profile from public.physical_cards c join public.profiles p on p.id=c.profile_id
    where c.public_token=lookup_token and c.is_active=true and p.is_active=true limit 1;
  if matched_profile is null then return false; end if;
  insert into public.saved_profiles(user_id,profile_id) values(auth.uid(),matched_profile)
    on conflict(user_id,profile_id) do update set last_viewed_at=now();
  return true;
end; $$;

revoke all on public.profiles, public.physical_cards, public.saved_profiles from anon;
revoke all on function public.get_public_card_profile(text) from public;
revoke all on function public.save_scanned_profile(text) from public;
grant execute on function public.get_public_card_profile(text) to anon, authenticated;
grant execute on function public.save_scanned_profile(text) to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.physical_cards to authenticated;
grant select, insert, update, delete on public.saved_profiles to authenticated;

-- Admin issuance intentionally stays server-side. Use the Supabase dashboard or a future
-- Edge Function with the service-role key to create profiles/cards. Never expose it here.

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('card-assets','card-assets',true,5242880,array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;
create policy "public reads card assets" on storage.objects for select to public using (bucket_id='card-assets');
create policy "owners upload to own asset folder" on storage.objects for insert to authenticated
  with check (bucket_id='card-assets' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "owners update own asset folder" on storage.objects for update to authenticated
  using (bucket_id='card-assets' and (storage.foldername(name))[1]=auth.uid()::text)
  with check (bucket_id='card-assets' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "owners delete from own asset folder" on storage.objects for delete to authenticated
  using (bucket_id='card-assets' and (storage.foldername(name))[1]=auth.uid()::text);

-- Authenticated self-service setup for an owner's first example card.
-- Token generation and ownership assignment remain inside PostgreSQL.
create or replace function public.create_my_digital_card(
  p_name text,
  p_company text default null,
  p_title text default null,
  p_phone text default null,
  p_email text default null,
  p_website text default null,
  p_linkedin text default null,
  p_instagram text default null,
  p_address text default null,
  p_bio text default null
)
returns table(profile_id uuid, card_id uuid, public_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_profile_id uuid;
  created_card_id uuid;
  created_token text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Name is required';
  end if;

  if exists (select 1 from public.profiles where owner_user_id = auth.uid()) then
    raise exception 'An owner profile already exists';
  end if;

  insert into public.profiles (
    owner_user_id, name, company, title, phone, email, website, linkedin, instagram, address, bio
  ) values (
    auth.uid(), trim(p_name), nullif(trim(p_company), ''), nullif(trim(p_title), ''),
    nullif(trim(p_phone), ''), nullif(trim(p_email), ''), nullif(trim(p_website), ''),
    nullif(trim(p_linkedin), ''), nullif(trim(p_instagram), ''), nullif(trim(p_address), ''),
    nullif(trim(p_bio), '')
  ) returning id into created_profile_id;

  insert into public.physical_cards (profile_id, card_label)
  values (created_profile_id, 'Primary card')
  returning id, physical_cards.public_token into created_card_id, created_token;

  return query select created_profile_id, created_card_id, created_token;
end;
$$;

revoke all on function public.create_my_digital_card(text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.create_my_digital_card(text,text,text,text,text,text,text,text,text,text) to authenticated;

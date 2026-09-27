-- Unified Mucci Products operations dashboard.
-- Keeps estimates as the source of truth for requests and lightweight orders.

alter table public.print_estimates
  add column if not exists accepted_at timestamptz,
  add column if not exists production_started_at timestamptz,
  add column if not exists cancelled_at timestamptz;

alter table public.print_estimates drop constraint if exists print_estimates_status_check;
alter table public.print_estimates add constraint print_estimates_status_check
  check (status in (
    'pending', 'reviewed', 'etsy_prepared', 'awaiting_customer',
    'accepted', 'in_production', 'completed', 'declined'
  ));

create table if not exists public.admin_activity (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  subject_type text not null check (char_length(subject_type) between 1 and 80),
  subject_id text check (subject_id is null or char_length(subject_id) <= 160),
  summary text not null check (char_length(summary) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists admin_activity_created_idx on public.admin_activity (created_at desc);
create index if not exists admin_activity_subject_idx on public.admin_activity (subject_type, subject_id, created_at desc);

alter table public.admin_activity enable row level security;
revoke all on public.admin_activity from public, anon, authenticated;
grant select, insert on public.admin_activity to service_role;

create or replace function public.admin_recent_print_estimates(
  p_status text default null, p_manual_review boolean default false
)
returns setof public.print_estimates
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if p_status is not null and p_status not in (
    'pending', 'reviewed', 'etsy_prepared', 'awaiting_customer',
    'accepted', 'in_production', 'completed', 'declined'
  ) then raise exception 'Invalid estimate status'; end if;
  return query
    select e.* from public.print_estimates e
    where (p_status is null or e.status = p_status)
      and (not p_manual_review or e.requires_manual_review)
    order by e.created_at desc limit 100;
end;
$$;

revoke all on function public.admin_recent_print_estimates(text,boolean) from public, anon, authenticated;
grant execute on function public.admin_recent_print_estimates(text,boolean) to service_role;

create or replace function public.admin_set_print_estimate_status(p_estimate_id uuid, p_status text)
returns setof public.print_estimates
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_mucci_card_admin() then raise insufficient_privilege using message = 'Administrator access required'; end if;
  if p_status not in (
    'pending', 'reviewed', 'etsy_prepared', 'awaiting_customer',
    'accepted', 'in_production', 'completed', 'declined'
  ) then raise exception 'Invalid estimate status'; end if;
  return query
    update public.print_estimates e set
      status = p_status,
      reviewed_at = case when p_status = 'reviewed' then coalesce(e.reviewed_at, now()) else e.reviewed_at end,
      etsy_prepared_at = case when p_status = 'etsy_prepared' then coalesce(e.etsy_prepared_at, now()) else e.etsy_prepared_at end,
      accepted_at = case when p_status = 'accepted' then coalesce(e.accepted_at, now()) else e.accepted_at end,
      production_started_at = case when p_status = 'in_production' then coalesce(e.production_started_at, now()) else e.production_started_at end,
      completed_at = case when p_status = 'completed' then coalesce(e.completed_at, now()) else e.completed_at end,
      declined_at = case when p_status = 'declined' then coalesce(e.declined_at, now()) else e.declined_at end,
      cancelled_at = case when p_status = 'declined' then coalesce(e.cancelled_at, now()) else e.cancelled_at end
    where e.id = p_estimate_id returning e.*;
end;
$$;

revoke all on function public.admin_set_print_estimate_status(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_set_print_estimate_status(uuid,text) to service_role;

comment on table public.admin_activity is
  'Server-only Mucci Products administrator audit events. Never store credentials, access tokens, API keys, or customer file contents.';

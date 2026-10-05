-- Mucci Products order operations workflow.
-- Additive only: existing estimate status and historical rows remain unchanged.

alter table public.print_estimates
  add column if not exists internal_status text,
  add column if not exists internal_status_updated_at timestamptz,
  add column if not exists shopify_order_id text,
  add column if not exists shopify_order_number text,
  add column if not exists shopify_payment_status text,
  add column if not exists shopify_fulfillment_status text,
  add column if not exists shopify_total_amount numeric(12,2),
  add column if not exists shopify_currency_code text,
  add column if not exists shopify_reconciled_at timestamptz,
  add column if not exists shopify_reconciliation_error text;

alter table public.print_estimates
  drop constraint if exists print_estimates_internal_status_check;
alter table public.print_estimates
  add constraint print_estimates_internal_status_check
  check (
    internal_status is null or internal_status in (
      'NEW', 'REVIEWING', 'AWAITING_CUSTOMER', 'DESIGNING',
      'READY_TO_PRINT', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK',
      'READY_TO_SHIP', 'COMPLETED', 'CANCELLED'
    )
  );

alter table public.print_estimates
  drop constraint if exists print_estimates_shopify_order_id_check;
alter table public.print_estimates
  add constraint print_estimates_shopify_order_id_check
  check (shopify_order_id is null or shopify_order_id ~ '^gid://shopify/Order/[0-9]+$');

alter table public.print_estimates
  drop constraint if exists print_estimates_shopify_currency_check;
alter table public.print_estimates
  add constraint print_estimates_shopify_currency_check
  check (shopify_currency_code is null or shopify_currency_code ~ '^[A-Z]{3}$');

create index if not exists print_estimates_internal_status_idx
  on public.print_estimates (internal_status, created_at desc);
create index if not exists print_estimates_shopify_order_number_idx
  on public.print_estimates (shopify_order_number)
  where shopify_order_number is not null;
create index if not exists print_estimates_shopify_reconciled_idx
  on public.print_estimates (shopify_reconciled_at nulls first)
  where shopify_draft_order_id is not null;

create table if not exists public.admin_order_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.print_estimates(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 80),
  old_value text check (old_value is null or char_length(old_value) <= 160),
  new_value text check (new_value is null or char_length(new_value) <= 160),
  actor_email text check (actor_email is null or char_length(actor_email) <= 320),
  created_at timestamptz not null default now()
);

create index if not exists admin_order_events_project_created_idx
  on public.admin_order_events (project_id, created_at desc);

alter table public.admin_order_events enable row level security;
revoke all on public.admin_order_events from public, anon, authenticated;
grant select, insert on public.admin_order_events to service_role;

create or replace function public.admin_set_order_internal_status(
  p_project_id uuid,
  p_status text,
  p_actor_email text
)
returns setof public.print_estimates
language plpgsql volatile security definer set search_path = '' as $$
declare
  previous_status text;
begin
  if p_status not in (
    'NEW', 'REVIEWING', 'AWAITING_CUSTOMER', 'DESIGNING',
    'READY_TO_PRINT', 'PRINTING', 'POST_PROCESSING', 'QUALITY_CHECK',
    'READY_TO_SHIP', 'COMPLETED', 'CANCELLED'
  ) then
    raise exception 'Invalid internal order status';
  end if;

  select e.internal_status into previous_status
  from public.print_estimates e
  where e.id = p_project_id
  for update;

  if not found then return; end if;

  if previous_status is distinct from p_status then
    insert into public.admin_order_events (
      project_id, event_type, old_value, new_value, actor_email
    ) values (
      p_project_id, 'internal_status_changed', previous_status, p_status,
      nullif(lower(trim(p_actor_email)), '')
    );
  end if;

  return query
    update public.print_estimates e
    set internal_status = p_status,
        internal_status_updated_at = case
          when e.internal_status is distinct from p_status then now()
          else e.internal_status_updated_at
        end,
        updated_at = case
          when e.internal_status is distinct from p_status then now()
          else e.updated_at
        end
    where e.id = p_project_id
    returning e.*;
end;
$$;

revoke all on function public.admin_set_order_internal_status(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_set_order_internal_status(uuid,text,text)
  to service_role;

comment on column public.print_estimates.internal_status is
  'Mucci manufacturing workflow. Separate from estimate status and Shopify payment or fulfillment state.';
comment on column public.print_estimates.shopify_reconciled_at is
  'Timestamp of the latest server-side Shopify read used as a short-lived admin list cache.';
comment on table public.admin_order_events is
  'Server-only audit history for Mucci order workflow changes. Never store credentials, tokens, or customer file contents.';

notify pgrst, 'reload schema';

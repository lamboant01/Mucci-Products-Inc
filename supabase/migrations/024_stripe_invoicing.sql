-- Stripe test-mode invoice linkage and webhook replay protection.
-- Apply in Supabase before enabling the Stripe invoice action or webhook endpoint.

alter table public.print_estimates
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_invoice_id text,
  add column if not exists stripe_invoice_status text,
  add column if not exists stripe_hosted_invoice_url text,
  add column if not exists stripe_invoice_pdf text,
  add column if not exists stripe_invoice_created_at timestamptz,
  add column if not exists stripe_invoice_paid_at timestamptz;

alter table public.print_estimates drop constraint if exists print_estimates_stripe_customer_id_check;
alter table public.print_estimates add constraint print_estimates_stripe_customer_id_check
  check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$');
alter table public.print_estimates drop constraint if exists print_estimates_stripe_invoice_id_check;
alter table public.print_estimates add constraint print_estimates_stripe_invoice_id_check
  check (stripe_invoice_id is null or stripe_invoice_id ~ '^in_[A-Za-z0-9]+$');

create unique index if not exists print_estimates_stripe_invoice_unique
  on public.print_estimates (stripe_invoice_id) where stripe_invoice_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (char_length(event_type) between 1 and 120),
  stripe_invoice_id text not null check (stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;
grant select, insert on public.stripe_webhook_events to service_role;

create or replace function public.record_stripe_invoice_event(
  p_event_id text,
  p_event_type text,
  p_stripe_invoice_id text,
  p_invoice_status text,
  p_hosted_invoice_url text default null,
  p_invoice_pdf text default null,
  p_paid_at timestamptz default null
)
returns table(matched boolean, duplicate boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  affected integer;
begin
  if exists (select 1 from public.stripe_webhook_events where event_id = p_event_id) then
    return query select true, true;
    return;
  end if;

  update public.print_estimates
  set stripe_invoice_status = p_invoice_status,
      stripe_hosted_invoice_url = coalesce(p_hosted_invoice_url, stripe_hosted_invoice_url),
      stripe_invoice_pdf = coalesce(p_invoice_pdf, stripe_invoice_pdf),
      stripe_invoice_paid_at = coalesce(p_paid_at, stripe_invoice_paid_at),
      status = case when p_invoice_status = 'paid' and status in ('reviewed','etsy_prepared','awaiting_customer') then 'accepted' else status end,
      accepted_at = case when p_invoice_status = 'paid' then coalesce(accepted_at, p_paid_at, now()) else accepted_at end
  where stripe_invoice_id = p_stripe_invoice_id;
  get diagnostics affected = row_count;
  if affected = 0 then
    return query select false, false;
    return;
  end if;

  insert into public.stripe_webhook_events(event_id, event_type, stripe_invoice_id)
  values (p_event_id, p_event_type, p_stripe_invoice_id);
  return query select true, false;
end;
$$;

revoke all on function public.record_stripe_invoice_event(text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_stripe_invoice_event(text,text,text,text,text,text,timestamptz) to service_role;

comment on table public.stripe_webhook_events is
  'Server-only Stripe webhook replay protection. Contains provider event and invoice identifiers, never API keys or card data.';

notify pgrst, 'reload schema';

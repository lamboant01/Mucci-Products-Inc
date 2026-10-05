-- Shopify Draft Order linkage and atomic checkout idempotency.
-- Apply after the source estimator migrations through 023.

alter table public.print_estimates
  add column if not exists shopify_draft_order_id text,
  add column if not exists shopify_invoice_url text,
  add column if not exists shopify_draft_order_status text,
  add column if not exists shopify_draft_order_claim_token uuid,
  add column if not exists shopify_draft_order_claimed_at timestamptz,
  add column if not exists shopify_draft_order_created_at timestamptz,
  add column if not exists shopify_draft_order_error text;

alter table public.print_estimates
  drop constraint if exists print_estimates_shopify_draft_order_id_check;
alter table public.print_estimates
  add constraint print_estimates_shopify_draft_order_id_check
  check (
    shopify_draft_order_id is null
    or shopify_draft_order_id ~ '^gid://shopify/DraftOrder/[0-9]+$'
  );

alter table public.print_estimates
  drop constraint if exists print_estimates_shopify_invoice_url_check;
alter table public.print_estimates
  add constraint print_estimates_shopify_invoice_url_check
  check (
    shopify_invoice_url is null
    or shopify_invoice_url ~ '^https://[^[:space:]]+$'
  );

alter table public.print_estimates
  drop constraint if exists print_estimates_shopify_status_check;
alter table public.print_estimates
  add constraint print_estimates_shopify_status_check
  check (
    shopify_draft_order_status is null
    or shopify_draft_order_status in ('creating', 'created', 'failed')
  );

create unique index if not exists print_estimates_shopify_draft_order_unique
  on public.print_estimates (shopify_draft_order_id)
  where shopify_draft_order_id is not null;

create or replace function public.claim_shopify_draft_order(
  p_quote_code text,
  p_notification_token uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  estimate public.print_estimates%rowtype;
begin
  select * into estimate
  from public.print_estimates
  where quote_code = upper(trim(p_quote_code))
    and notification_token = p_notification_token
  for update;

  if not found then
    return null;
  end if;

  if estimate.shopify_draft_order_id is not null
    and estimate.shopify_invoice_url is not null then
    return jsonb_build_object(
      'outcome', 'ready',
      'draft_order_id', estimate.shopify_draft_order_id,
      'invoice_url', estimate.shopify_invoice_url
    );
  end if;

  if estimate.shopify_draft_order_status = 'creating'
    and estimate.shopify_draft_order_claimed_at > now() - interval '5 minutes' then
    return jsonb_build_object('outcome', 'in_progress');
  end if;

  if estimate.email is null or estimate.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid customer email is required for Shopify checkout';
  end if;
  if estimate.estimated_total_max is null or estimate.estimated_total_max <= 0 then
    raise exception 'The saved estimate does not contain a valid checkout price';
  end if;

  update public.print_estimates
  set shopify_draft_order_status = 'creating',
      shopify_draft_order_claim_token = p_claim_token,
      shopify_draft_order_claimed_at = now(),
      shopify_draft_order_error = null,
      updated_at = now()
  where id = estimate.id;

  return jsonb_build_object(
    'outcome', 'claimed',
    'estimate', jsonb_build_object(
      'id', estimate.id,
      'quote_code', estimate.quote_code,
      'email', estimate.email,
      'service_intent', estimate.service_intent,
      'quantity', estimate.quantity,
      'material', estimate.material,
      'desired_colours', estimate.desired_colours,
      'design_level', estimate.design_level,
      'assembly_required', estimate.assembly_required,
      'requires_manual_review', estimate.requires_manual_review,
      'application_category', estimate.application_category,
      'submitted_length', estimate.submitted_length,
      'submitted_width', estimate.submitted_width,
      'submitted_height', estimate.submitted_height,
      'dimension_unit', estimate.dimension_unit,
      'estimated_total_max', estimate.estimated_total_max,
      'file_path', estimate.file_path,
      'model_files', estimate.model_files,
      'reference_files', estimate.reference_files
    )
  );
end;
$$;

create or replace function public.complete_shopify_draft_order(
  p_quote_code text,
  p_notification_token uuid,
  p_claim_token uuid,
  p_draft_order_id text,
  p_invoice_url text
)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  saved public.print_estimates%rowtype;
begin
  if p_draft_order_id !~ '^gid://shopify/DraftOrder/[0-9]+$'
    or p_invoice_url !~ '^https://[^[:space:]]+$' then
    raise exception 'Invalid Shopify Draft Order result';
  end if;

  update public.print_estimates
  set shopify_draft_order_id = p_draft_order_id,
      shopify_invoice_url = p_invoice_url,
      shopify_draft_order_status = 'created',
      shopify_draft_order_created_at = coalesce(shopify_draft_order_created_at, now()),
      shopify_draft_order_claim_token = null,
      shopify_draft_order_claimed_at = null,
      shopify_draft_order_error = null,
      updated_at = now()
  where quote_code = upper(trim(p_quote_code))
    and notification_token = p_notification_token
    and shopify_draft_order_claim_token = p_claim_token
    and shopify_draft_order_id is null
  returning * into saved;

  if not found then
    select * into saved
    from public.print_estimates
    where quote_code = upper(trim(p_quote_code))
      and notification_token = p_notification_token
      and shopify_draft_order_id = p_draft_order_id
      and shopify_invoice_url = p_invoice_url;
  end if;
  if not found then raise exception 'Shopify Draft Order claim was lost'; end if;

  return jsonb_build_object(
    'draft_order_id', saved.shopify_draft_order_id,
    'invoice_url', saved.shopify_invoice_url
  );
end;
$$;

create or replace function public.fail_shopify_draft_order(
  p_quote_code text,
  p_notification_token uuid,
  p_claim_token uuid,
  p_error text
)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  affected integer;
begin
  update public.print_estimates
  set shopify_draft_order_status = 'failed',
      shopify_draft_order_claim_token = null,
      shopify_draft_order_claimed_at = null,
      shopify_draft_order_error = left(coalesce(p_error, 'Draft Order creation failed'), 500),
      updated_at = now()
  where quote_code = upper(trim(p_quote_code))
    and notification_token = p_notification_token
    and shopify_draft_order_claim_token = p_claim_token
    and shopify_draft_order_id is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_shopify_draft_order(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.complete_shopify_draft_order(text,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_shopify_draft_order(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_shopify_draft_order(text,uuid,uuid) to service_role;
grant execute on function public.complete_shopify_draft_order(text,uuid,uuid,text,text) to service_role;
grant execute on function public.fail_shopify_draft_order(text,uuid,uuid,text) to service_role;

comment on column public.print_estimates.shopify_draft_order_id is
  'Canonical Shopify commerce reference for estimator checkouts.';
comment on column public.print_estimates.shopify_invoice_url is
  'Stable Shopify-hosted Draft Order invoice checkout URL, never a Supabase signed URL.';

notify pgrst, 'reload schema';


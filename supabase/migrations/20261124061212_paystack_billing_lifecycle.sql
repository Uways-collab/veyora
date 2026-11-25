-- Paystack subscription lifecycle records and server-only webhook idempotency.
alter table public.subscription_plans
  add column if not exists provider_plan_code text;
create unique index if not exists subscription_plans_provider_plan_code_idx
  on public.subscription_plans(provider_plan_code)
  where provider_plan_code is not null;

alter table public.organization_subscriptions
  add column if not exists provider_plan_code text,
  add column if not exists trial_card_reference text,
  add column if not exists card_verified_at timestamptz,
  add column if not exists latest_payment_reference text;

create table if not exists public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  reference text not null unique,
  purpose text not null check (purpose in ('trial_card_verification','subscription_payment','addon_payment')),
  amount_minor_units bigint not null check (amount_minor_units > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'initializing' check (status in ('initializing','pending','succeeded','refund_pending','refunded','refund_failed','failed')),
  provider_transaction_id bigint,
  provider_refund_id bigint,
  provider_customer_code text,
  provider_subscription_code text,
  refund_expected_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_transactions_org_created_idx
  on public.billing_transactions(organization_id,created_at desc);
create index if not exists billing_transactions_status_idx
  on public.billing_transactions(status,created_at);

alter table public.billing_transactions enable row level security;
create policy "Owners and admins can view billing transactions"
  on public.billing_transactions for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = billing_transactions.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner','admin')
    )
  );
grant select on public.billing_transactions to authenticated;
revoke insert, update, delete on public.billing_transactions from anon, authenticated;
grant all on public.billing_transactions to service_role;

create table if not exists public.paystack_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now()
);
alter table public.paystack_webhook_events enable row level security;
revoke all on public.paystack_webhook_events from public, anon, authenticated;
grant all on public.paystack_webhook_events to service_role;

create or replace function public.set_billing_transaction_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;
revoke all on function public.set_billing_transaction_updated_at() from public, anon, authenticated;
drop trigger if exists billing_transactions_updated_at on public.billing_transactions;
create trigger billing_transactions_updated_at
before update on public.billing_transactions
for each row execute function public.set_billing_transaction_updated_at();

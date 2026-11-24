-- Commercial foundation: plans, industry add-ons, organisation business types,
-- subscription lifecycle, AI metering and private webhook idempotency.
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  currency text not null default 'NGN' check (currency = 'NGN'),
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  included_users integer,
  included_locations integer,
  ai_invoice_scans integer not null default 0 check (ai_invoice_scans >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans
  (code,name,billing_interval,currency,amount_minor_units,included_users,included_locations,ai_invoice_scans)
values
  ('starter_monthly','Starter','monthly','NGN',990000,2,1,10),
  ('starter_yearly','Starter','yearly','NGN',9900000,2,1,10),
  ('standard_monthly','Standard','monthly','NGN',2490000,5,3,100),
  ('standard_yearly','Standard','yearly','NGN',24900000,5,3,100),
  ('premium_monthly','Premium','monthly','NGN',4990000,15,10,500),
  ('premium_yearly','Premium','yearly','NGN',49900000,15,10,500)
on conflict (code) do update set
  name = excluded.name,
  billing_interval = excluded.billing_interval,
  currency = excluded.currency,
  amount_minor_units = excluded.amount_minor_units,
  included_users = excluded.included_users,
  included_locations = excluded.included_locations,
  ai_invoice_scans = excluded.ai_invoice_scans,
  updated_at = now();

create table if not exists public.industry_modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  monthly_amount_minor_units bigint,
  availability text not null default 'planned' check (availability in ('planned','available','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (monthly_amount_minor_units is null or monthly_amount_minor_units >= 0)
);

insert into public.industry_modules (code,name,description,availability)
values
  ('hotel_management','Hotel Management','Rooms, reservations, guest profiles and housekeeping workflows.','planned'),
  ('car_dealership','Car Dealership','Vehicle stock, sales, deposits and deal margin workflows.','planned'),
  ('real_estate','Real Estate','Properties, units, tenants, leases and rent workflows.','planned'),
  ('restaurant_management','Restaurant Management','Menus, tables, orders and kitchen workflows.','planned'),
  ('logistics','Logistics','Fleet, deliveries, routes and dispatch workflows.','planned'),
  ('manufacturing','Manufacturing','Production, raw materials and finished-goods workflows.','planned')
on conflict (code) do nothing;

create table if not exists public.organization_business_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_type text not null check (business_type in ('retail','wholesale','distribution','services','hybrid','hotel','car_dealership','real_estate','restaurant','logistics','manufacturing')),
  is_primary boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id,business_type)
);
create unique index if not exists organization_business_types_one_primary_idx
  on public.organization_business_types (organization_id) where is_primary;

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null check (status in ('trial_pending','trialing','active','past_due','cancelled','expired')),
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_customer_code text,
  provider_subscription_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at is null or trial_starts_at is null or trial_ends_at > trial_starts_at)
);

create table if not exists public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  industry_module_id uuid not null references public.industry_modules(id),
  status text not null default 'pending' check (status in ('pending','active','suspended','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,industry_module_id)
);

create table if not exists public.ai_usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  feature text not null,
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_minor_units bigint not null default 0 check (estimated_cost_minor_units >= 0),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_records_org_created_idx
  on public.ai_usage_records (organization_id,created_at desc);

alter table public.subscription_plans enable row level security;
alter table public.industry_modules enable row level security;
alter table public.organization_business_types enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_modules enable row level security;
alter table public.ai_usage_records enable row level security;

create policy "Authenticated users can view active subscription plans"
  on public.subscription_plans for select to authenticated using (is_active);
create policy "Authenticated users can view industry module catalogue"
  on public.industry_modules for select to authenticated using (availability <> 'retired');

create policy "Organisation members can view business types"
  on public.organization_business_types for select to authenticated
  using (exists (select 1 from public.organization_memberships m where m.organization_id = organization_business_types.organization_id and m.user_id = (select auth.uid())));
create policy "Owners and admins can manage business types"
  on public.organization_business_types for all to authenticated
  using (exists (select 1 from public.organization_memberships m where m.organization_id = organization_business_types.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')))
  with check (exists (select 1 from public.organization_memberships m where m.organization_id = organization_business_types.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));

create policy "Organisation members can view their subscription"
  on public.organization_subscriptions for select to authenticated
  using (exists (select 1 from public.organization_memberships m where m.organization_id = organization_subscriptions.organization_id and m.user_id = (select auth.uid())));
create policy "Organisation members can view enabled modules"
  on public.organization_modules for select to authenticated
  using (exists (select 1 from public.organization_memberships m where m.organization_id = organization_modules.organization_id and m.user_id = (select auth.uid())));
create policy "Owners and admins can view AI usage"
  on public.ai_usage_records for select to authenticated
  using (exists (select 1 from public.organization_memberships m where m.organization_id = ai_usage_records.organization_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin')));

grant select on public.subscription_plans, public.industry_modules to authenticated;
grant select on public.organization_business_types, public.organization_subscriptions, public.organization_modules, public.ai_usage_records to authenticated;
grant insert, update, delete on public.organization_business_types to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.paystack_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz not null default now()
);
revoke all on private.paystack_webhook_events from public, anon, authenticated;

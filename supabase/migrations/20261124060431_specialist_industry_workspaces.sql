-- First specialist operational workspaces for Veyora's six industry categories.
-- These are additive tables; existing core inventory, sales and finance workflows are untouched.

create table if not exists public.hotel_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  confirmation_code text not null,
  room_label text not null,
  guest_name text not null,
  guest_email text,
  guest_phone text,
  check_in date not null,
  check_out date not null,
  adults integer not null default 1 check (adults > 0),
  children integer not null default 0 check (children >= 0),
  status text not null default 'booked' check (status in ('booked','checked_in','checked_out','cancelled','no_show')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, confirmation_code),
  check (check_out > check_in)
);

create table if not exists public.dealer_vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vin text,
  stock_number text not null,
  make text not null,
  model text not null,
  model_year integer not null check (model_year between 1900 and 2200),
  mileage integer not null default 0 check (mileage >= 0),
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  asking_price numeric(14,2) not null default 0 check (asking_price >= 0),
  status text not null default 'in_stock' check (status in ('in_stock','reserved','sold','in_service')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, stock_number)
);
create unique index if not exists dealer_vehicles_org_vin_idx
  on public.dealer_vehicles(organization_id, upper(vin)) where vin is not null and length(trim(vin)) > 0;

create table if not exists public.real_estate_leases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_name text not null,
  unit_reference text not null,
  tenant_name text not null,
  tenant_email text,
  tenant_phone text,
  lease_start date not null,
  lease_end date not null,
  monthly_rent numeric(14,2) not null check (monthly_rent >= 0),
  security_deposit numeric(14,2) not null default 0 check (security_deposit >= 0),
  rent_due_day integer not null default 1 check (rent_due_day between 1 and 28),
  status text not null default 'draft' check (status in ('draft','active','ended','terminated')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lease_end >= lease_start)
);

create table if not exists public.restaurant_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_number text not null,
  order_type text not null default 'dine_in' check (order_type in ('dine_in','takeaway','delivery')),
  table_label text,
  customer_name text,
  items_summary text not null,
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  status text not null default 'new' check (status in ('new','accepted','preparing','ready','served','completed','cancelled')),
  ordered_at timestamptz not null default now(),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number)
);

create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tracking_number text not null,
  recipient_name text not null,
  recipient_phone text,
  origin text not null,
  destination text not null,
  scheduled_at timestamptz,
  status text not null default 'pending' check (status in ('pending','assigned','in_transit','delivered','failed','returned')),
  proof_of_delivery_url text,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, tracking_number),
  check (proof_of_delivery_url is null or proof_of_delivery_url ~* '^https://')
);

create table if not exists public.manufacturing_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_number text not null,
  product_name text not null,
  planned_quantity numeric(14,3) not null check (planned_quantity > 0),
  completed_quantity numeric(14,3) not null default 0 check (completed_quantity >= 0 and completed_quantity <= planned_quantity),
  planned_start date,
  due_date date,
  status text not null default 'planned' check (status in ('planned','released','in_progress','quality_check','completed','cancelled')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number),
  check (due_date is null or planned_start is null or due_date >= planned_start)
);

create index if not exists hotel_reservations_org_dates_idx on public.hotel_reservations(organization_id, check_in, check_out);
create index if not exists dealer_vehicles_org_status_idx on public.dealer_vehicles(organization_id, status);
create index if not exists real_estate_leases_org_status_idx on public.real_estate_leases(organization_id, status, lease_end);
create index if not exists restaurant_orders_org_status_idx on public.restaurant_orders(organization_id, status, ordered_at desc);
create index if not exists delivery_jobs_org_status_idx on public.delivery_jobs(organization_id, status, scheduled_at);
create index if not exists manufacturing_orders_org_status_idx on public.manufacturing_orders(organization_id, status, due_date);

do $$
declare t text;
begin
  foreach t in array array['hotel_reservations','dealer_vehicles','real_estate_leases','restaurant_orders','delivery_jobs','manufacturing_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())))', t || '_member_select', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager'',''staff'')))', t || '_member_insert', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager''))) with check (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))', t || '_manager_update', t, t, t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'')))', t || '_admin_delete', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.set_industry_record_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;
revoke all on function public.set_industry_record_updated_at() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hotel_reservations','dealer_vehicles','real_estate_leases','restaurant_orders','delivery_jobs','manufacturing_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_industry_record_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

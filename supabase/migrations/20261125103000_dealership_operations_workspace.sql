-- Dedicated dealership operations: inventory detail, prospects, test drives, deals and workshop jobs.
-- Additive only; existing vehicle and organisation records are preserved.

alter table public.dealer_vehicles
  add column if not exists condition text not null default 'used'
    check (condition in ('new','used','certified_pre_owned')),
  add column if not exists body_type text,
  add column if not exists fuel_type text,
  add column if not exists transmission text,
  add column if not exists exterior_color text,
  add column if not exists location_label text,
  add column if not exists acquisition_date date,
  add column if not exists warranty_until date;

create table if not exists public.dealer_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  source text not null default 'walk_in' check (source in ('walk_in','website','social','referral','phone','marketplace','other')),
  interest_make text,
  interest_model text,
  budget numeric(14,2) not null default 0 check (budget >= 0),
  status text not null default 'new' check (status in ('new','contacted','qualified','test_drive','negotiation','won','lost')),
  next_follow_up_at timestamptz,
  assigned_to text,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dealer_test_drives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null references public.dealer_vehicles(id) on delete restrict,
  lead_id uuid references public.dealer_leads(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 10 and 240),
  odometer_start integer check (odometer_start is null or odometer_start >= 0),
  odometer_end integer check (odometer_end is null or odometer_end >= 0),
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled','no_show')),
  staff_name text,
  licence_verified boolean not null default false,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dealer_deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null references public.dealer_vehicles(id) on delete restrict,
  lead_id uuid references public.dealer_leads(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  deal_number text not null,
  agreed_price numeric(14,2) not null check (agreed_price >= 0),
  deposit_amount numeric(14,2) not null default 0 check (deposit_amount >= 0 and deposit_amount <= agreed_price),
  trade_in_description text,
  trade_in_allowance numeric(14,2) not null default 0 check (trade_in_allowance >= 0),
  status text not null default 'draft' check (status in ('draft','reserved','awaiting_payment','ready_for_delivery','completed','cancelled')),
  expected_delivery_date date,
  sales_person text,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, deal_number)
);

create table if not exists public.dealer_service_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id uuid not null references public.dealer_vehicles(id) on delete restrict,
  customer_name text,
  job_number text not null,
  job_type text not null default 'inspection' check (job_type in ('inspection','repair','maintenance','detailing','warranty','pre_delivery')),
  description text not null,
  odometer integer not null default 0 check (odometer >= 0),
  estimated_cost numeric(14,2) not null default 0 check (estimated_cost >= 0),
  actual_cost numeric(14,2) not null default 0 check (actual_cost >= 0),
  status text not null default 'booked' check (status in ('booked','in_progress','waiting_parts','quality_check','completed','cancelled')),
  assigned_to text,
  due_at timestamptz,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, job_number)
);

create index if not exists dealer_leads_org_status_idx on public.dealer_leads(organization_id,status,created_at desc);
create index if not exists dealer_test_drives_org_schedule_idx on public.dealer_test_drives(organization_id,scheduled_at,status);
create index if not exists dealer_deals_org_status_idx on public.dealer_deals(organization_id,status,created_at desc);
create index if not exists dealer_service_jobs_org_status_idx on public.dealer_service_jobs(organization_id,status,due_at);

do $$
declare t text;
begin
  foreach t in array array['dealer_leads','dealer_test_drives','dealer_deals','dealer_service_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())))',
      t || '_member_select', t, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_staff_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager'',''staff'')))',
      t || '_staff_insert', t, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_manager_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager''))) with check (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',
      t || '_manager_update', t, t, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'')))',
      t || '_admin_delete', t, t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_industry_record_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

grant select, insert, update, delete on public.dealer_vehicles to authenticated;

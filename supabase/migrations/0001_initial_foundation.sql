-- ============================================================================
-- Veyora Business — Stage 1 Foundation Schema & Row Level Security (RLS)
-- ============================================================================
-- Target: Supabase PostgreSQL 15+
-- Purpose: Multi-tenant organisation isolation, user profiles, membership roles,
--          audit logging, and private organisation-scoped Storage policies.
-- ============================================================================

-- 1. Extensions
create extension if not exists "pgcrypto";

-- 2. Utility timestamp trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- 3. Core Identity & Organisation Tables

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  business_type text not null default 'retail' check (
    business_type in ('retail', 'wholesale', 'distribution', 'services', 'hybrid')
  ),
  base_currency text not null default 'USD' check (char_length(base_currency) = 3),
  timezone text not null default 'UTC',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trg_organisations_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

create table if not exists public.organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (
    role in ('owner', 'admin', 'manager', 'staff', 'viewer')
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (organisation_id, user_id)
);

create index if not exists idx_org_members_user_id
  on public.organisation_members (user_id, is_active);

create index if not exists idx_org_members_org_id
  on public.organisation_members (organisation_id, role);

create trigger trg_org_members_updated_at
  before update on public.organisation_members
  for each row execute function public.set_updated_at();

-- 4. Cross-Module Audit Log Table (Foundation for connected operational trace)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  module text not null check (
    module in (
      'dashboard', 'inventory', 'sales', 'customers',
      'purchases', 'suppliers', 'finance', 'reports', 'settings'
    )
  ),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_logs_org_created
  on public.audit_logs (organisation_id, created_at desc);

-- 5. Security-Definer Helpers for Non-Recursive RLS Evaluation

create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members m
    where m.organisation_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
  );
$$;

create or replace function public.has_org_role(target_org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members m
    where m.organisation_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role = any (allowed_roles)
  );
$$;

-- 6. Automatic Profile Provisioning on Auth Signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7. Automatic Owner Membership on Organisation Creation
create or replace function public.handle_new_organisation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organisation_members (organisation_id, user_id, role, is_active)
  values (new.id, new.created_by, 'owner', true);
  return new;
end;
$$;

drop trigger if exists on_organisation_created on public.organisations;
create trigger on_organisation_created
  after insert on public.organisations
  for each row execute function public.handle_new_organisation();

-- 8. Enable Row Level Security (Deny by Default)

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: Users can only view and update their own profile
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Organisations: Members can read; authenticated users can create; owners/admins can update
create policy "organisations_select_member"
  on public.organisations for select
  to authenticated
  using (public.is_org_member(id));

create policy "organisations_insert_authenticated"
  on public.organisations for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "organisations_update_admin"
  on public.organisations for update
  to authenticated
  using (public.has_org_role(id, array['owner', 'admin']))
  with check (public.has_org_role(id, array['owner', 'admin']));

-- Organisation Members: Members can read roster; owners/admins manage members
create policy "org_members_select_member"
  on public.organisation_members for select
  to authenticated
  using (public.is_org_member(organisation_id));

create policy "org_members_insert_admin"
  on public.organisation_members for insert
  to authenticated
  with check (public.has_org_role(organisation_id, array['owner', 'admin']));

create policy "org_members_update_admin"
  on public.organisation_members for update
  to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']));

create policy "org_members_delete_owner"
  on public.organisation_members for delete
  to authenticated
  using (public.has_org_role(organisation_id, array['owner']));

-- Audit Logs: Read-only for active org members; insert scoped to active org members
create policy "audit_logs_select_member"
  on public.audit_logs for select
  to authenticated
  using (public.is_org_member(organisation_id));

create policy "audit_logs_insert_member"
  on public.audit_logs for insert
  to authenticated
  with check (
    public.is_org_member(organisation_id)
    and (actor_user_id is null or actor_user_id = auth.uid())
  );

-- 9. Supabase Storage Bucket & Organisation-Scoped Isolation
-- Files stored at: organisation-files/<organisation_id>/<module>/<filename>

insert into storage.buckets (id, name, public)
values ('organisation-files', 'organisation-files', false)
on conflict (id) do nothing;

create policy "org_files_select_member"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'organisation-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org_files_insert_member"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'organisation-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org_files_delete_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'organisation-files'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin'])
  );

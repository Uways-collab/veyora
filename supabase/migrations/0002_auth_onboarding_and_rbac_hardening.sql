-- ============================================================================
-- Veyora Business — Stage 2: Auth Onboarding, Organisation Fields & RBAC Hardening
-- ============================================================================
-- Builds cleanly on 0001_initial_foundation.sql without replacing it.
-- Adds business onboarding metadata (country, business_email, business_phone),
-- explicit organisation_roles table (Owner, Admin, Manager, Staff),
-- anti-privilege-escalation RLS policies + triggers, and atomic workspace RPC.
-- ============================================================================

-- 1. Extend Organisations with Business Onboarding Fields
alter table public.organisations
  add column if not exists country text not null default 'United States',
  add column if not exists business_email text,
  add column if not exists business_phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organisations_country_len_chk'
  ) then
    alter table public.organisations
      add constraint organisations_country_len_chk
      check (char_length(trim(country)) between 2 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'organisations_business_email_chk'
  ) then
    alter table public.organisations
      add constraint organisations_business_email_chk
      check (
        business_email is null
        or trim(business_email) = ''
        or business_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
      );
  end if;
end;
$$;

-- 2. Explicit Organisation Roles Table (Owner, Admin, Manager, Staff)
create table if not exists public.organisation_roles (
  key text primary key,
  label text not null,
  description text not null,
  rank integer not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.organisation_roles (key, label, description, rank)
values
  ('owner', 'Owner', 'Full control over business settings, billing, security, and member roles.', 100),
  ('admin', 'Admin', 'Manage business configuration, operational workflows, and manager/staff access.', 80),
  ('manager', 'Manager', 'Oversee daily operations, approvals, and team workflows.', 50),
  ('staff', 'Staff', 'Standard operational access within assigned workspace modules.', 20)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      rank = excluded.rank;

alter table public.organisation_roles enable row level security;

drop policy if exists "org_roles_select_authenticated" on public.organisation_roles;
create policy "org_roles_select_authenticated"
  on public.organisation_roles for select
  to authenticated
  using (true);

-- Normalize any legacy 'viewer' role rows before binding FK to the 4 initial roles
update public.organisation_members
  set role = 'staff'
  where role = 'viewer';

alter table public.organisation_members
  drop constraint if exists organisation_members_role_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organisation_members_role_fkey'
  ) then
    alter table public.organisation_members
      add constraint organisation_members_role_fkey
      foreign key (role) references public.organisation_roles(key);
  end if;
end;
$$;

-- 3. Security-Definer Helper for Team Profile Visibility
create or replace function public.shares_org_with_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organisation_members me
    join public.organisation_members peer
      on me.organisation_id = peer.organisation_id
    where me.user_id = auth.uid()
      and peer.user_id = target_user_id
      and me.is_active = true
      and peer.is_active = true
  );
$$;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_own_or_org_peer" on public.profiles;
create policy "profiles_select_own_or_org_peer"
  on public.profiles for select
  to authenticated
  using (
    auth.uid() = id
    or public.shares_org_with_user(id)
  );

-- 4. Anti-Privilege-Escalation Triggers & Hardened RLS Policies

-- Prevent changing organisations.created_by after creation
create or replace function public.protect_organisation_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if new.created_by <> old.created_by then
    raise exception 'created_by cannot be modified';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_org_immutable on public.organisations;
create trigger trg_protect_org_immutable
  before update on public.organisations
  for each row execute function public.protect_organisation_immutable_fields();

-- Prevent removing or demoting the last active owner, and prevent non-owners from elevating roles
create or replace function public.enforce_membership_rbac()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners integer;
begin
  if tg_op = 'UPDATE' then
    -- Prevent any user from changing their own role or reactivating themselves
    if old.user_id = auth.uid() and (new.role <> old.role or new.is_active <> old.is_active) then
      raise exception 'Users cannot modify their own role or membership status';
    end if;

    -- Prevent demoting or deactivating the last active owner
    if old.role = 'owner' and old.is_active = true and (new.role <> 'owner' or new.is_active = false) then
      select count(*) into remaining_owners
      from public.organisation_members
      where organisation_id = old.organisation_id
        and role = 'owner'
        and is_active = true
        and id <> old.id;

      if remaining_owners = 0 then
        raise exception 'Organisation must retain at least one active owner';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'owner' and old.is_active = true then
      select count(*) into remaining_owners
      from public.organisation_members
      where organisation_id = old.organisation_id
        and role = 'owner'
        and is_active = true
        and id <> old.id;

      if remaining_owners = 0 then
        raise exception 'Cannot remove the last active owner from an organisation';
      end if;
    end if;

    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_membership_rbac on public.organisation_members;
create trigger trg_enforce_membership_rbac
  before update or delete on public.organisation_members
  for each row execute function public.enforce_membership_rbac();

-- Replace permissive member insert/update policies with strict privilege-bounded policies
drop policy if exists "org_members_insert_admin" on public.organisation_members;
create policy "org_members_insert_privileged"
  on public.organisation_members for insert
  to authenticated
  with check (
    user_id <> auth.uid()
    and (
      public.has_org_role(organisation_id, array['owner'])
      or (
        public.has_org_role(organisation_id, array['admin'])
        and role in ('manager', 'staff')
      )
    )
  );

drop policy if exists "org_members_update_admin" on public.organisation_members;
create policy "org_members_update_privileged"
  on public.organisation_members for update
  to authenticated
  using (
    user_id <> auth.uid()
    and (
      public.has_org_role(organisation_id, array['owner'])
      or (
        public.has_org_role(organisation_id, array['admin'])
        and role in ('manager', 'staff')
      )
    )
  )
  with check (
    user_id <> auth.uid()
    and (
      public.has_org_role(organisation_id, array['owner'])
      or (
        public.has_org_role(organisation_id, array['admin'])
        and role in ('manager', 'staff')
      )
    )
  );

-- Allow owners to delete any non-sole-owner member
drop policy if exists "org_members_delete_owner" on public.organisation_members;
create policy "org_members_delete_owner"
  on public.organisation_members for delete
  to authenticated
  using (
    public.has_org_role(organisation_id, array['owner'])
    and user_id <> auth.uid()
  );

-- 5. Atomic Business Workspace Creation RPC
-- Guarantees creator becomes 'owner' server-side in one transaction and logs audit event.
create or replace function public.create_business_workspace(
  p_name text,
  p_business_type text default 'retail',
  p_country text default 'United States',
  p_base_currency text default 'USD',
  p_timezone text default 'UTC',
  p_business_email text default null,
  p_business_phone text default null
)
returns public.organisations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clean_name text;
  v_base_slug text;
  v_slug text;
  v_org public.organisations;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required to create a business workspace';
  end if;

  v_clean_name := trim(p_name);
  if char_length(v_clean_name) < 2 or char_length(v_clean_name) > 120 then
    raise exception 'Business name must be between 2 and 120 characters';
  end if;

  v_base_slug := regexp_replace(lower(v_clean_name), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then
    v_base_slug := 'workspace';
  end if;
  v_slug := v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.organisations (
    name,
    slug,
    business_type,
    country,
    base_currency,
    timezone,
    business_email,
    business_phone,
    created_by
  )
  values (
    v_clean_name,
    v_slug,
    coalesce(nullif(trim(p_business_type), ''), 'retail'),
    coalesce(nullif(trim(p_country), ''), 'United States'),
    upper(coalesce(nullif(trim(p_base_currency), ''), 'USD')),
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    nullif(trim(coalesce(p_business_email, '')), ''),
    nullif(trim(coalesce(p_business_phone, '')), ''),
    v_user_id
  )
  returning * into v_org;

  -- Ensure owner membership exists (idempotent with handle_new_organisation trigger)
  insert into public.organisation_members (organisation_id, user_id, role, is_active)
  values (v_org.id, v_user_id, 'owner', true)
  on conflict (organisation_id, user_id) do nothing;

  insert into public.audit_logs (
    organisation_id,
    actor_user_id,
    module,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_org.id,
    v_user_id,
    'settings',
    'organisation.created',
    'organisation',
    v_org.id::text,
    jsonb_build_object(
      'business_type', v_org.business_type,
      'country', v_org.country,
      'base_currency', v_org.base_currency
    )
  );

  return v_org;
end;
$$;

grant execute on function public.create_business_workspace(
  text, text, text, text, text, text, text
) to authenticated;

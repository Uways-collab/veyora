-- ============================================================================
-- Veyora Business — Customers Archive & Restore Support
-- ============================================================================
-- Adds active/archived filtering to public.customers_v1_search without
-- breaking existing 3-argument callers, and creates public.customers_v1_restore.
--
-- IMPORTANT:
-- Before applying to your Supabase project, verify the existing definition of
-- public.customers_v1_search in SQL Editor with:
--   select pg_get_functiondef('public.customers_v1_search(uuid, text, integer)'::regprocedure);
-- so you confirm column names/types on public.customers match your live schema.
-- ============================================================================

-- 1. Replace customers_v1_search with optional p_is_active parameter (default true)
-- Drop old 3-arg overload first so PostgreSQL/PostgREST do not have ambiguous overloads.
drop function if exists public.customers_v1_search(uuid, text, integer);
drop function if exists public.customers_v1_search(uuid, text, integer, boolean);

create or replace function public.customers_v1_search(
  p_organization_id uuid,
  p_search text default null,
  p_limit integer default 100,
  p_is_active boolean default true
)
returns setof public.customers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_search text;
  v_limit integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_organization_id is null then
    raise exception 'Organization ID is required';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_user_id
      and m.is_active is not false
      and m.role in ('owner', 'admin', 'manager', 'staff')
  ) then
    raise exception 'Permission denied: active organization membership required';
  end if;

  v_search := nullif(trim(coalesce(p_search, '')), '');
  v_limit := least(100, greatest(1, coalesce(p_limit, 100)));

  return query
  select c.*
  from public.customers c
  where c.organization_id = p_organization_id
    and (p_is_active is null or c.is_active = p_is_active)
    and (
      v_search is null
      or c.name ilike '%' || v_search || '%'
      or coalesce(c.phone, '') ilike '%' || v_search || '%'
      or coalesce(c.email, '') ilike '%' || v_search || '%'
    )
  order by c.name asc, c.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.customers_v1_search(uuid, text, integer, boolean) from public;
revoke all on function public.customers_v1_search(uuid, text, integer, boolean) from anon;
grant execute on function public.customers_v1_search(uuid, text, integer, boolean) to authenticated;

-- 2. Create customers_v1_restore RPC (Owner, Admin, Manager only)
drop function if exists public.customers_v1_restore(uuid, uuid);

create or replace function public.customers_v1_restore(
  p_organization_id uuid,
  p_customer_id uuid
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_customer public.customers;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_organization_id is null then
    raise exception 'Organization ID is required';
  end if;

  if p_customer_id is null then
    raise exception 'Customer ID is required';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_user_id
      and m.is_active is not false
      and m.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Permission denied: only owners, admins, and managers can restore customers';
  end if;

  update public.customers c
  set
    is_active = true,
    updated_at = timezone('utc', pg_catalog.now())
  where c.id = p_customer_id
    and c.organization_id = p_organization_id
  returning c.* into v_customer;

  if not found then
    raise exception 'Customer not found in the active organization';
  end if;

  return v_customer;
end;
$$;

revoke all on function public.customers_v1_restore(uuid, uuid) from public;
revoke all on function public.customers_v1_restore(uuid, uuid) from anon;
grant execute on function public.customers_v1_restore(uuid, uuid) to authenticated;

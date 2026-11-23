-- Enforce workspace-creation eligibility inside the SECURITY DEFINER RPC.
-- First-time authenticated users may create their initial workspace. Existing
-- members may create additional workspaces only when they hold an Owner role.
create or replace function public.create_business_workspace(
  p_name text,
  p_business_type text,
  p_country text,
  p_base_currency text,
  p_business_email text,
  p_business_phone text,
  p_timezone text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_has_memberships boolean;
  v_is_owner boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'Business name is required' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.organization_memberships m where m.user_id = v_user_id
  ) into v_has_memberships;

  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_user_id and m.role = 'owner'
  ) into v_is_owner;

  if v_has_memberships and not v_is_owner then
    raise exception 'Only an Owner can create an additional business workspace. Managers and Staff cannot create businesses.' using errcode = '42501';
  end if;

  insert into public.organizations (
    name, business_type, country, currency, email, phone, timezone
  ) values (
    trim(p_name),
    nullif(trim(p_business_type), ''),
    coalesce(nullif(trim(p_country), ''), 'Nigeria'),
    coalesce(nullif(trim(p_base_currency), ''), 'NGN'),
    nullif(trim(p_business_email), ''),
    nullif(trim(p_business_phone), ''),
    coalesce(nullif(trim(p_timezone), ''), 'Africa/Lagos')
  )
  returning id into v_organization_id;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'owner');

  return v_organization_id;
end;
$$;

revoke all on function public.create_business_workspace(text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_business_workspace(text,text,text,text,text,text,text) to authenticated;

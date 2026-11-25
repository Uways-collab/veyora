-- New workspaces receive a zero-opening-balance Cash on Hand account for POS receipts.
create or replace function private.guard_business_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_organization_id uuid;
  target_feature text := tg_argv[0];
begin
  if (auth.jwt() ->> 'role') = 'service_role' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  -- This flag is set only inside create_business_workspace while it creates
  -- the initial zero-balance Cash on Hand account for the new organisation.
  if tg_table_name='finance_accounts'
     and tg_op='INSERT'
     and coalesce(pg_catalog.current_setting('veyora.workspace_initialization',true),'')='allowed' then
    return new;
  end if;

  if tg_op='DELETE' then target_organization_id:=old.organization_id;
  else target_organization_id:=new.organization_id;
  end if;

  if target_organization_id is null
     or not private.organization_has_access(target_organization_id,target_feature) then
    raise exception 'This organisation subscription is inactive or does not include this feature. Restore payment or upgrade the plan to continue.'
      using errcode='42501';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.guard_business_access() from public,anon,authenticated;

create or replace function public.create_business_workspace(
  p_name text,
  p_business_type text,
  p_country text,
  p_base_currency text,
  p_business_email text,
  p_business_phone text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_has_memberships boolean;
  v_is_owner boolean;
  v_business_type text := coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_business_type)),''),'retail');
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if nullif(pg_catalog.btrim(p_name),'') is null then raise exception 'Business name is required' using errcode='22023'; end if;
  if v_business_type not in (
    'retail','wholesale','distribution','services','hybrid',
    'hotel','car_dealership','real_estate','restaurant','logistics','manufacturing'
  ) then raise exception 'Choose one supported business type when creating this business.' using errcode='22023'; end if;

  select exists(select 1 from public.organization_memberships m where m.user_id=v_user_id) into v_has_memberships;
  select exists(select 1 from public.organization_memberships m where m.user_id=v_user_id and m.role='owner') into v_is_owner;
  if v_has_memberships and not v_is_owner then
    raise exception 'Only an Owner can create an additional business workspace. Managers and Staff cannot create businesses.'
      using errcode='42501';
  end if;

  insert into public.organizations(name,business_type,country,currency,email,phone,timezone)
  values(
    pg_catalog.btrim(p_name),v_business_type,
    coalesce(nullif(pg_catalog.btrim(p_country),''),'Nigeria'),
    coalesce(nullif(pg_catalog.btrim(p_base_currency),''),'NGN'),
    nullif(pg_catalog.btrim(p_business_email),''),
    nullif(pg_catalog.btrim(p_business_phone),''),
    coalesce(nullif(pg_catalog.btrim(p_timezone),''),'Africa/Lagos')
  ) returning id into v_organization_id;

  insert into public.organization_business_types(organization_id,business_type,is_primary)
  values(v_organization_id,v_business_type,true);

  insert into public.organization_memberships(organization_id,user_id,role)
  values(v_organization_id,v_user_id,'owner');

  perform pg_catalog.set_config('veyora.workspace_initialization','allowed',true);
  insert into public.finance_accounts(organization_id,account_name,account_type,currency_code,ledger_account_id,created_by)
  select v_organization_id,'Cash on Hand','cash',o.currency,l.id,v_user_id
  from public.organizations o
  join public.finance_ledger_accounts l on l.organization_id=o.id and l.account_code='1000' and l.is_active
  where o.id=v_organization_id
    and not exists(select 1 from public.finance_accounts a where a.organization_id=v_organization_id and a.account_name='Cash on Hand');

  return v_organization_id;
end;
$function$;
revoke all on function public.create_business_workspace(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_business_workspace(text,text,text,text,text,text,text) to authenticated;

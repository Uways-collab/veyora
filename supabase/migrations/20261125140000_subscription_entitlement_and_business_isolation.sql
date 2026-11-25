-- Enforce one business type per organisation and subscription/plan access at the database boundary.

alter table public.subscription_plans
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists ai_assistant_requests integer not null default 0
    check (ai_assistant_requests >= 0);

update public.subscription_plans
set features = case
  when code like 'starter_%' then jsonb_build_object(
    'dashboard',true,'inventory',true,'sales',true,'customers',true,'purchases',true,
    'suppliers',true,'expenses',true,'finance',true,'reports',true,'industry',true,
    'invoice_scanner',true,'ai_assistant',false,'advanced_reports',false,
    'multi_location',false,'advanced_analytics',false,'api_exports',false
  )
  when code like 'standard_%' then jsonb_build_object(
    'dashboard',true,'inventory',true,'sales',true,'customers',true,'purchases',true,
    'suppliers',true,'expenses',true,'finance',true,'reports',true,'industry',true,
    'invoice_scanner',true,'ai_assistant',true,'advanced_reports',true,
    'multi_location',true,'advanced_analytics',false,'api_exports',false
  )
  else jsonb_build_object(
    'dashboard',true,'inventory',true,'sales',true,'customers',true,'purchases',true,
    'suppliers',true,'expenses',true,'finance',true,'reports',true,'industry',true,
    'invoice_scanner',true,'ai_assistant',true,'advanced_reports',true,
    'multi_location',true,'advanced_analytics',true,'api_exports',true
  )
end,
ai_assistant_requests = case
  when code like 'starter_%' then 0
  when code like 'standard_%' then 100
  else 500
end,
updated_at = now();

-- Backfill exactly one primary type from the organisation's already-saved business_type.
-- Existing secondary rows are preserved but remain non-primary.
insert into public.organization_business_types (organization_id,business_type,is_primary)
select o.id,o.business_type,true
from public.organizations o
where o.business_type in (
  'retail','wholesale','distribution','services','hybrid',
  'hotel','car_dealership','real_estate','restaurant','logistics','manufacturing'
)
and not exists (
  select 1 from public.organization_business_types b
  where b.organization_id=o.id and b.is_primary
)
on conflict (organization_id,business_type) do update
set is_primary=true;

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;

create or replace function private.organization_subscription_is_active(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_subscriptions s
    where s.organization_id=p_organization_id
      and (
        (
          s.status='trialing'
          and s.card_verified_at is not null
          and s.trial_ends_at is not null
          and s.trial_ends_at > pg_catalog.now()
        )
        or (
          s.status='active'
          and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now())
        )
        or (
          s.status='cancelled'
          and s.cancel_at_period_end=true
          and s.current_period_ends_at is not null
          and s.current_period_ends_at > pg_catalog.now()
        )
      )
  );
$function$;

create or replace function private.organization_has_access(
  p_organization_id uuid,
  p_feature text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.organization_memberships m
      join public.organization_subscriptions s on s.organization_id=m.organization_id
      join public.subscription_plans p on p.id=s.plan_id
      where m.organization_id=p_organization_id
        and m.user_id=auth.uid()
        and (
          (
            s.status='trialing'
            and s.card_verified_at is not null
            and s.trial_ends_at is not null
            and s.trial_ends_at > pg_catalog.now()
          )
          or (
            s.status='active'
            and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now())
          )
          or (
            s.status='cancelled'
            and s.cancel_at_period_end=true
            and s.current_period_ends_at is not null
            and s.current_period_ends_at > pg_catalog.now()
          )
        )
        and (
          p_feature is null
          or coalesce((p.features ->> p_feature)::boolean,false)
        )
    );
$function$;

revoke all on function private.organization_subscription_is_active(uuid) from public,anon,authenticated;
revoke all on function private.organization_has_access(uuid,text) from public,anon;
grant execute on function private.organization_has_access(uuid,text) to authenticated;

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
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op='DELETE' then
    target_organization_id := old.organization_id;
  else
    target_organization_id := new.organization_id;
  end if;

  if target_organization_id is null
     or not private.organization_has_access(target_organization_id,target_feature) then
    raise exception 'This organisation subscription is inactive or does not include this feature. Restore payment or upgrade the plan to continue.'
      using errcode='42501';
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$function$;
revoke all on function private.guard_business_access() from public,anon,authenticated;

create or replace function private.enforce_membership_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  member_count integer;
  member_limit integer;
begin
  select count(*) into member_count
  from public.organization_memberships m
  where m.organization_id=new.organization_id;

  -- The first Owner is allowed to establish a new business before choosing a plan.
  if member_count=0 and new.role='owner' then
    return new;
  end if;

  if not private.organization_subscription_is_active(new.organization_id) then
    raise exception 'An active subscription is required before adding team members.'
      using errcode='42501';
  end if;

  select p.included_users into member_limit
  from public.organization_subscriptions s
  join public.subscription_plans p on p.id=s.plan_id
  where s.organization_id=new.organization_id;

  if member_limit is not null and member_count >= member_limit then
    raise exception 'This plan includes % team members. Upgrade the plan to add more.',member_limit
      using errcode='23514';
  end if;

  return new;
end;
$function$;
revoke all on function private.enforce_membership_plan_limit() from public,anon,authenticated;

drop trigger if exists a_subscription_member_limit on public.organization_memberships;
create trigger a_subscription_member_limit
before insert on public.organization_memberships
for each row execute function private.enforce_membership_plan_limit();

create or replace function private.enforce_location_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  location_count integer;
  location_limit integer;
begin
  if not private.organization_subscription_is_active(new.organization_id) then
    raise exception 'An active subscription is required before adding business locations.'
      using errcode='42501';
  end if;

  select p.included_locations into location_limit
  from public.organization_subscriptions s
  join public.subscription_plans p on p.id=s.plan_id
  where s.organization_id=new.organization_id;

  select count(*) into location_count
  from public.inventory_locations l
  where l.organization_id=new.organization_id;

  if location_limit is not null and location_count >= location_limit then
    raise exception 'This plan includes % location(s). Upgrade the plan to add more.',location_limit
      using errcode='23514';
  end if;

  return new;
end;
$function$;
revoke all on function private.enforce_location_plan_limit() from public,anon,authenticated;

drop trigger if exists a_subscription_location_limit on public.inventory_locations;
create trigger a_subscription_location_limit
before insert on public.inventory_locations
for each row execute function private.enforce_location_plan_limit();

-- All core and specialist business tables are tenant-, subscription- and plan-scoped.
do $function$
declare
  r record;
  pol record;
  table_oid oid;
  using_expr text;
  check_expr text;
begin
  for r in
    select * from (values
      ('customers','customers'),
      ('products','inventory'),('product_variants','inventory'),('product_categories','inventory'),
      ('inventory_locations','inventory'),('inventory_balances','inventory'),('stock_movements','inventory'),
      ('stock_transfers','inventory'),('stock_transfer_items','inventory'),
      ('sales','sales'),('sale_items','sales'),('sale_payments','sales'),('sales_returns','sales'),
      ('sales_return_items','sales'),('sale_refunds','sales'),('payment_methods','sales'),('sale_sequences','sales'),
      ('suppliers','purchases'),('purchases','purchases'),('purchase_items','purchases'),
      ('purchase_payments','purchases'),('purchase_receipts','purchases'),('purchase_receipt_items','purchases'),
      ('purchase_returns','purchases'),('purchase_return_items','purchases'),('purchase_audit_logs','purchases'),
      ('purchase_invoice_number_claims','purchases'),('purchase_receipt_idempotency','purchases'),('purchase_sequences','purchases'),
      ('expenses','expenses'),('expense_categories','expenses'),('expense_sequences','expenses'),('expense_audit_logs','expenses'),
      ('finance_accounts','finance'),('finance_audit_log','finance'),('finance_expense_category_mappings','finance'),
      ('finance_journal_entries','finance'),('finance_journal_lines','finance'),('finance_ledger_accounts','finance'),
      ('finance_source_events','finance'),
      ('invoice_scans','invoice_scanner'),('invoice_scan_audit_logs','invoice_scanner'),
      ('ai_usage_records','ai_assistant'),
      ('organization_audit_log','dashboard'),
      ('dealer_vehicles','industry'),('dealer_leads','industry'),('dealer_test_drives','industry'),
      ('dealer_deals','industry'),('dealer_service_jobs','industry'),
      ('restaurant_orders','industry'),('restaurant_menu_categories','industry'),
      ('restaurant_menu_items','industry'),('restaurant_tables','industry'),('restaurant_order_items','industry'),
      ('hotel_reservations','industry'),('hotel_rooms','industry'),('hotel_housekeeping_tasks','industry'),
      ('real_estate_leases','industry'),('delivery_jobs','industry'),('manufacturing_orders','industry')
    ) as x(table_name,feature_key)
  loop
    table_oid := pg_catalog.to_regclass('public.'||r.table_name);
    if table_oid is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=r.table_name and column_name='organization_id'
    ) then continue; end if;

    execute pg_catalog.format('drop trigger if exists a_subscription_feature_guard on public.%I',r.table_name);
    execute pg_catalog.format(
      'create trigger a_subscription_feature_guard before insert or update or delete on public.%I for each row execute function private.guard_business_access(%L)',
      r.table_name,r.feature_key
    );

    for pol in select * from pg_catalog.pg_policy where polrelid=table_oid loop
      using_expr := case when pol.polqual is null then null else pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) end;
      check_expr := case when pol.polwithcheck is null then null else pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid) end;

      if using_expr is not null then
        execute pg_catalog.format(
          'alter policy %I on public.%I using ((%s) and private.organization_has_access(%I.organization_id,%L))',
          pol.polname,r.table_name,using_expr,r.table_name,r.feature_key
        );
      end if;
      if check_expr is not null then
        execute pg_catalog.format(
          'alter policy %I on public.%I with check ((%s) and private.organization_has_access(%I.organization_id,%L))',
          pol.polname,r.table_name,check_expr,r.table_name,r.feature_key
        );
      end if;
    end loop;
  end loop;
end;
$function$;

-- These role helpers are used by the existing SECURITY DEFINER business RPCs.
create or replace function public.has_sales_role(p_organization_id uuid,p_allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.organization_has_access(p_organization_id,null)
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id=p_organization_id
        and om.user_id=(select auth.uid())
        and om.role=any(p_allowed_roles)
    );
$function$;

create or replace function public.has_inventory_role(p_organization_id uuid,p_allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.organization_has_access(p_organization_id,'inventory')
    and exists (
      select 1 from public.organization_memberships om
      where om.organization_id=p_organization_id
        and om.user_id=(select auth.uid())
        and om.role=any(p_allowed_roles)
    );
$function$;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.organization_has_access(p_organization_id,null);
$function$;

-- A business type is selected only when a new organisation is created.
create or replace function private.prevent_business_type_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.business_type is distinct from old.business_type then
    raise exception 'A business type cannot be changed after workspace creation. Create a separate business workspace for another business type.'
      using errcode='42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.prevent_business_type_change() from public,anon,authenticated;
drop trigger if exists a_business_type_immutable on public.organizations;
create trigger a_business_type_immutable
before update of business_type on public.organizations
for each row execute function private.prevent_business_type_change();

-- Replace workspace creation so the selected business type is atomically the single primary type.
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
  if v_user_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if nullif(pg_catalog.btrim(p_name),'') is null then
    raise exception 'Business name is required' using errcode='22023';
  end if;

  if v_business_type not in (
    'retail','wholesale','distribution','services','hybrid',
    'hotel','car_dealership','real_estate','restaurant','logistics','manufacturing'
  ) then
    raise exception 'Choose one supported business type when creating this business.' using errcode='22023';
  end if;

  select exists(select 1 from public.organization_memberships m where m.user_id=v_user_id)
    into v_has_memberships;
  select exists(select 1 from public.organization_memberships m where m.user_id=v_user_id and m.role='owner')
    into v_is_owner;

  if v_has_memberships and not v_is_owner then
    raise exception 'Only an Owner can create an additional business workspace. Managers and Staff cannot create businesses.'
      using errcode='42501';
  end if;

  insert into public.organizations(name,business_type,country,currency,email,phone,timezone)
  values(
    pg_catalog.btrim(p_name),
    v_business_type,
    coalesce(nullif(pg_catalog.btrim(p_country),''),'Nigeria'),
    coalesce(nullif(pg_catalog.btrim(p_base_currency),''),'NGN'),
    nullif(pg_catalog.btrim(p_business_email),''),
    nullif(pg_catalog.btrim(p_business_phone),''),
    coalesce(nullif(pg_catalog.btrim(p_timezone),''),'Africa/Lagos')
  )
  returning id into v_organization_id;

  insert into public.organization_business_types(organization_id,business_type,is_primary)
  values(v_organization_id,v_business_type,true);

  insert into public.organization_memberships(organization_id,user_id,role)
  values(v_organization_id,v_user_id,'owner');

  return v_organization_id;
end;
$function$;
revoke all on function public.create_business_workspace(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_business_workspace(text,text,text,text,text,text,text) to authenticated;

-- Business type rows are read-only to clients. The workspace-creation RPC owns creation.
drop policy if exists "Owners and admins can manage business types" on public.organization_business_types;
revoke insert,update,delete on public.organization_business_types from anon,authenticated;
grant select on public.organization_business_types to authenticated;

-- Prevent direct invocation of trigger-only SECURITY DEFINER helpers.
revoke all on function public.sales_v1_assert_return_header_matches_items(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finance_get_purchase_posting_state(uuid,uuid) from public,anon,authenticated;

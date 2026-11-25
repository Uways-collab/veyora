-- Recipe ingredients link restaurant menu items to the organisation's stock variants and locations.
create table if not exists public.restaurant_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  menu_item_id uuid not null,
  variant_id uuid not null,
  location_id uuid not null,
  quantity_per_serving numeric(14,4) not null check(quantity_per_serving>0),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,menu_item_id,variant_id,location_id),
  constraint restaurant_recipe_menu_tenant_fk foreign key(menu_item_id,organization_id)
    references public.restaurant_menu_items(id,organization_id) on delete cascade,
  constraint restaurant_recipe_variant_tenant_fk foreign key(organization_id,variant_id)
    references public.product_variants(organization_id,id) on delete restrict,
  constraint restaurant_recipe_location_tenant_fk foreign key(organization_id,location_id)
    references public.inventory_locations(organization_id,id) on delete restrict
);
create index if not exists restaurant_recipe_menu_idx
on public.restaurant_recipe_ingredients(organization_id,menu_item_id);
create index if not exists restaurant_recipe_variant_location_idx
on public.restaurant_recipe_ingredients(organization_id,variant_id,location_id);
alter table public.restaurant_recipe_ingredients enable row level security;
drop policy if exists restaurant_recipe_member_select on public.restaurant_recipe_ingredients;
create policy restaurant_recipe_member_select on public.restaurant_recipe_ingredients
for select to authenticated using (
  exists(select 1 from public.organization_memberships m
    join public.organization_business_types b on b.organization_id=m.organization_id
      and b.business_type='restaurant' and b.is_primary
    where m.organization_id=restaurant_recipe_ingredients.organization_id and m.user_id=(select auth.uid()))
  and private.organization_has_access(organization_id,'industry')
);
drop policy if exists restaurant_recipe_manager_insert on public.restaurant_recipe_ingredients;
create policy restaurant_recipe_manager_insert on public.restaurant_recipe_ingredients
for insert to authenticated with check (
  exists(select 1 from public.organization_memberships m
    join public.organization_business_types b on b.organization_id=m.organization_id
      and b.business_type='restaurant' and b.is_primary
    where m.organization_id=restaurant_recipe_ingredients.organization_id and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','manager'))
);
drop policy if exists restaurant_recipe_manager_update on public.restaurant_recipe_ingredients;
create policy restaurant_recipe_manager_update on public.restaurant_recipe_ingredients
for update to authenticated using (
  exists(select 1 from public.organization_memberships m
    join public.organization_business_types b on b.organization_id=m.organization_id
      and b.business_type='restaurant' and b.is_primary
    where m.organization_id=restaurant_recipe_ingredients.organization_id and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','manager'))
) with check (
  exists(select 1 from public.organization_memberships m
    join public.organization_business_types b on b.organization_id=m.organization_id
      and b.business_type='restaurant' and b.is_primary
    where m.organization_id=restaurant_recipe_ingredients.organization_id and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','manager'))
);
drop policy if exists restaurant_recipe_manager_delete on public.restaurant_recipe_ingredients;
create policy restaurant_recipe_manager_delete on public.restaurant_recipe_ingredients
for delete to authenticated using (
  exists(select 1 from public.organization_memberships m
    join public.organization_business_types b on b.organization_id=m.organization_id
      and b.business_type='restaurant' and b.is_primary
    where m.organization_id=restaurant_recipe_ingredients.organization_id and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','manager'))
);
revoke all on public.restaurant_recipe_ingredients from public,anon;
grant select,insert,update,delete on public.restaurant_recipe_ingredients to authenticated;
drop trigger if exists a_subscription_feature_guard on public.restaurant_recipe_ingredients;
create trigger a_subscription_feature_guard before insert or update or delete on public.restaurant_recipe_ingredients
for each row execute function private.guard_business_access('industry');

-- Permit staff to deduct stock only while the secure restaurant completion RPC is running.
create or replace function public.adjust_inventory_stock(
  p_organization_id uuid,p_variant_id uuid,p_location_id uuid,p_quantity_change numeric,
  p_movement_type text,p_reference text default null,p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_user_id uuid;
  v_product_type text;
  v_quantity_before numeric(14,3);
  v_quantity_after numeric(14,3);
  v_movement_id uuid;
begin
  v_user_id:=auth.uid();
  if v_user_id is null then raise exception 'Authentication required'; end if;

  if not public.has_inventory_role(p_organization_id,array['owner','admin','manager']::text[]) then
    if not (
      coalesce(pg_catalog.current_setting('veyora.restaurant_stock_deduction',true),'')='allowed'
      and private.organization_has_access(p_organization_id,'industry')
      and exists(
        select 1 from public.organization_memberships m
        join public.organization_business_types b on b.organization_id=m.organization_id
          and b.business_type='restaurant' and b.is_primary
        where m.organization_id=p_organization_id and m.user_id=v_user_id and m.role='staff'
      )
    ) then
      raise exception 'You are not authorised to adjust stock';
    end if;
  end if;

  if p_quantity_change is null or p_quantity_change=0 then raise exception 'Quantity change must not be zero'; end if;
  if p_movement_type not in ('opening_stock','stock_in','stock_out','adjustment','return') then
    raise exception 'Invalid stock movement type';
  end if;
  if p_movement_type in ('opening_stock','stock_in','return') and p_quantity_change<=0 then
    raise exception 'This movement type requires a positive quantity';
  end if;
  if p_movement_type='stock_out' and p_quantity_change>=0 then
    raise exception 'Stock out requires a negative quantity';
  end if;

  select p.product_type into v_product_type
  from public.product_variants pv
  join public.products p on p.id=pv.product_id and p.organization_id=pv.organization_id
  where pv.id=p_variant_id and pv.organization_id=p_organization_id
    and pv.is_active=true and p.is_active=true;
  if v_product_type is distinct from 'physical' then
    raise exception 'Only active physical products can have stock';
  end if;

  if not exists(select 1 from public.inventory_locations
    where id=p_location_id and organization_id=p_organization_id and is_active=true) then
    raise exception 'Active inventory location not found';
  end if;

  insert into public.inventory_balances(organization_id,variant_id,location_id,quantity)
  values(p_organization_id,p_variant_id,p_location_id,0)
  on conflict(organization_id,variant_id,location_id) do nothing;

  select quantity into v_quantity_before from public.inventory_balances
  where organization_id=p_organization_id and variant_id=p_variant_id and location_id=p_location_id
  for update;

  if p_movement_type='opening_stock' then
    if v_quantity_before<>0 or exists(select 1 from public.stock_movements
      where organization_id=p_organization_id and variant_id=p_variant_id and location_id=p_location_id) then
      raise exception 'Opening stock has already been recorded';
    end if;
  end if;

  v_quantity_after:=v_quantity_before+p_quantity_change;
  if v_quantity_after<0 then
    raise exception 'Insufficient stock. Available quantity: %',v_quantity_before;
  end if;

  update public.inventory_balances set quantity=v_quantity_after,updated_at=pg_catalog.now()
  where organization_id=p_organization_id and variant_id=p_variant_id and location_id=p_location_id;

  insert into public.stock_movements(
    organization_id,variant_id,location_id,movement_type,quantity_change,
    quantity_before,quantity_after,reference,notes,performed_by
  )
  values(
    p_organization_id,p_variant_id,p_location_id,p_movement_type,p_quantity_change,
    v_quantity_before,v_quantity_after,p_reference,p_notes,v_user_id
  ) returning id into v_movement_id;

  return v_movement_id;
end;
$function$;
grant execute on function public.adjust_inventory_stock(uuid,uuid,uuid,numeric,text,text,text) to authenticated;

-- Stock is deducted once, atomically, when a fully paid restaurant ticket is completed.
create or replace function public.restaurant_complete_order(p_organization_id uuid,p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_order public.restaurant_orders%rowtype;
  v_paid numeric;
  v_deposit_account uuid;
  v_revenue_account uuid;
  v_recipe record;
begin
  if auth.uid() is null or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Active restaurant workspace access is required.' using errcode='42501';
  end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','manager','staff') then
    raise exception 'Restaurant ticket access denied.' using errcode='42501';
  end if;
  select * into v_order from public.restaurant_orders o
  where o.id=p_order_id and o.organization_id=p_organization_id for update;
  if not found then raise exception 'Restaurant ticket not found.' using errcode='P0002'; end if;
  if v_order.status='completed' then return; end if;
  if v_order.status<>'served' then raise exception 'Only a served restaurant ticket can be completed.' using errcode='23514'; end if;

  select coalesce(sum(p.amount),0) into v_paid from public.restaurant_order_payments p
  where p.organization_id=p_organization_id and p.order_id=p_order_id;
  if v_paid<v_order.total_amount then
    raise exception 'Collect the full restaurant bill before closing this ticket. Outstanding balance: %.',greatest(v_order.total_amount-v_paid,0)
      using errcode='23514';
  end if;

  perform pg_catalog.set_config('veyora.restaurant_stock_deduction','allowed',true);
  for v_recipe in
    select ri.variant_id,ri.location_id,
      sum(oi.quantity*ri.quantity_per_serving) as quantity_to_deduct,
      mi.name as menu_item_name
    from public.restaurant_order_items oi
    join public.restaurant_recipe_ingredients ri
      on ri.organization_id=oi.organization_id and ri.menu_item_id=oi.menu_item_id
    join public.restaurant_menu_items mi
      on mi.organization_id=ri.organization_id and mi.id=ri.menu_item_id
    where oi.organization_id=p_organization_id and oi.order_id=p_order_id
    group by ri.variant_id,ri.location_id,mi.name
  loop
    perform public.adjust_inventory_stock(
      p_organization_id,v_recipe.variant_id,v_recipe.location_id,
      -v_recipe.quantity_to_deduct,'stock_out',
      'Restaurant order '||v_order.order_number,
      'Recipe consumption: '||v_recipe.menu_item_name
    );
  end loop;

  if v_order.total_amount>0 then
    select id into v_deposit_account from public.finance_ledger_accounts
    where organization_id=p_organization_id and account_code='2210' and is_active;
    select id into v_revenue_account from public.finance_ledger_accounts
    where organization_id=p_organization_id and account_code='4000' and is_active;
    if v_deposit_account is null or v_revenue_account is null then
      raise exception 'Restaurant revenue ledger accounts are not configured.' using errcode='23514';
    end if;
    perform pg_catalog.set_config('veyora.restaurant_finance_rpc','allowed',true);
    perform public.finance_post_journal(
      p_organization_id,current_date,'Restaurant sale '||v_order.order_number,
      'restaurant_sale',p_order_id,p_order_id,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('ledger_account_id',v_deposit_account,'debit',v_order.total_amount,'credit',0),
        pg_catalog.jsonb_build_object('ledger_account_id',v_revenue_account,'debit',0,'credit',v_order.total_amount)
      )
    );
  end if;

  perform pg_catalog.set_config('veyora.restaurant_completion','allowed',true);
  update public.restaurant_orders set status='completed',updated_at=pg_catalog.now()
  where id=p_order_id and organization_id=p_organization_id and status='served';
  if not found then raise exception 'Restaurant ticket completion failed.' using errcode='P0002'; end if;
end;
$function$;
revoke all on function public.restaurant_complete_order(uuid,uuid) from public,anon;
grant execute on function public.restaurant_complete_order(uuid,uuid) to authenticated;

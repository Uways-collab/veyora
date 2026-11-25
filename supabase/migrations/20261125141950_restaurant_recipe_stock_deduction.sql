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

-- Permit staff to deduct stock only when the restaurant completion RPC explicitly sets its private transaction flag.
do $function$
declare definition text; updated_definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.adjust_inventory_stock(uuid,uuid,uuid,numeric,text,text,text)'::regprocedure);
  updated_definition:=pg_catalog.replace(
    definition,
    $old$    IF NOT public.has_inventory_role(
        p_organization_id,
        ARRAY['owner', 'admin', 'manager']::TEXT[]
    ) THEN
        RAISE EXCEPTION 'You are not authorised to adjust stock';
    END IF;$old$,
    $new$    IF NOT public.has_inventory_role(
        p_organization_id,
        ARRAY['owner', 'admin', 'manager']::TEXT[]
    ) THEN
        IF NOT (
          coalesce(pg_catalog.current_setting('veyora.restaurant_stock_deduction',true),'')='allowed'
          AND private.organization_has_access(p_organization_id,'industry')
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
            JOIN public.organization_business_types b ON b.organization_id=m.organization_id
              AND b.business_type='restaurant' AND b.is_primary
            WHERE m.organization_id=p_organization_id AND m.user_id=auth.uid() AND m.role='staff'
          )
        ) THEN
          RAISE EXCEPTION 'You are not authorised to adjust stock';
        END IF;
    END IF;$new$
  );
  if updated_definition=definition then raise exception 'Could not install restaurant stock deduction role guard'; end if;
  execute updated_definition;
end;
$function$;

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

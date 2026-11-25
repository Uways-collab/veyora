-- Transaction-local workflow flags are restored immediately after their one authorised operation.
create or replace function public.restaurant_recalculate_order_totals()
returns trigger language plpgsql security definer set search_path='' as $function$
declare
  target_order uuid;
  target_org uuid;
  previous_recalc_flag text:=coalesce(pg_catalog.current_setting('veyora.restaurant_recalc',true),'');
begin
  target_order:=coalesce(new.order_id,old.order_id);
  target_org:=coalesce(new.organization_id,old.organization_id);
  if auth.uid() is null or not private.organization_has_access(target_org,'industry') then
    raise exception 'Restaurant workspace access denied' using errcode='42501';
  end if;
  perform pg_catalog.set_config('veyora.restaurant_recalc','allowed',true);
  update public.restaurant_orders o set
    total_amount=coalesce((select sum(i.line_total) from public.restaurant_order_items i where i.order_id=target_order and i.organization_id=target_org),0),
    items_summary=coalesce((select string_agg(i.quantity::text||' × '||i.item_name,', ' order by i.created_at) from public.restaurant_order_items i where i.order_id=target_order and i.organization_id=target_org),'Itemised order')
  where o.id=target_order and o.organization_id=target_org;
  perform pg_catalog.set_config('veyora.restaurant_recalc',previous_recalc_flag,true);
  return coalesce(new,old);
end;
$function$;
revoke all on function public.restaurant_recalculate_order_totals() from public,anon,authenticated;

create or replace function public.restaurant_record_payment(
  p_organization_id uuid,p_order_id uuid,p_financial_account_id uuid,
  p_amount numeric,p_reference text,p_notes text,p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path='' as $function$
declare
  v_role text;
  v_order public.restaurant_orders%rowtype;
  v_account public.finance_accounts%rowtype;
  v_deposit_account uuid;
  v_paid numeric;
  v_payment_id uuid;
  v_reference text;
  v_journal_id uuid;
  previous_finance_flag text:=coalesce(pg_catalog.current_setting('veyora.restaurant_finance_rpc',true),'');
begin
  if auth.uid() is null or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Active restaurant workspace access is required.' using errcode='42501';
  end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','manager','staff') then
    raise exception 'Restaurant payment access denied.' using errcode='42501';
  end if;
  if p_amount is null or p_amount<=0 or p_idempotency_key is null then
    raise exception 'A positive payment amount and idempotency key are required.' using errcode='22023';
  end if;
  select * into v_order from public.restaurant_orders o
  where o.id=p_order_id and o.organization_id=p_organization_id for update;
  if not found or v_order.status in ('completed','cancelled') then
    raise exception 'This restaurant ticket is unavailable for payment.' using errcode='P0002';
  end if;
  select * into v_account from public.finance_accounts a
  where a.id=p_financial_account_id and a.organization_id=p_organization_id and a.is_active for share;
  if not found then raise exception 'Choose an active cash, bank or wallet account for this business.' using errcode='22023'; end if;
  select id into v_payment_id from public.restaurant_order_payments
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_payment_id is not null then return v_payment_id; end if;
  select coalesce(sum(p.amount),0) into v_paid from public.restaurant_order_payments p
  where p.organization_id=p_organization_id and p.order_id=p_order_id;
  if p_amount > v_order.total_amount-v_paid then
    raise exception 'Payment exceeds the outstanding restaurant bill of %.',greatest(v_order.total_amount-v_paid,0)
      using errcode='23514';
  end if;
  v_reference:=coalesce(nullif(pg_catalog.btrim(p_reference),''),'RCP-'||pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,10)));
  insert into public.restaurant_order_payments(organization_id,order_id,financial_account_id,amount,reference,idempotency_key,notes,received_by)
  values(p_organization_id,p_order_id,p_financial_account_id,p_amount,v_reference,p_idempotency_key,
    nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),auth.uid())
  returning id into v_payment_id;
  insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
  values(p_organization_id,'2210','Restaurant Customer Deposits','liability','credit',true)
  on conflict (organization_id,account_code) do nothing;
  select id into v_deposit_account from public.finance_ledger_accounts
  where organization_id=p_organization_id and account_code='2210' and is_active;
  if v_deposit_account is null then raise exception 'Restaurant deposit ledger account is unavailable.'; end if;

  perform pg_catalog.set_config('veyora.restaurant_finance_rpc','allowed',true);
  v_journal_id:=public.finance_post_journal(
    p_organization_id,(select paid_at::date from public.restaurant_order_payments where id=v_payment_id),
    'Restaurant ticket payment '||v_reference,'restaurant_payment',v_payment_id,v_payment_id,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('ledger_account_id',v_account.ledger_account_id,'financial_account_id',v_account.id,'debit',p_amount,'credit',0),
      pg_catalog.jsonb_build_object('ledger_account_id',v_deposit_account,'debit',0,'credit',p_amount)
    )
  );
  perform pg_catalog.set_config('veyora.restaurant_finance_rpc',previous_finance_flag,true);
  update public.restaurant_order_payments set journal_entry_id=v_journal_id
  where id=v_payment_id and organization_id=p_organization_id;
  return v_payment_id;
end;
$function$;
revoke all on function public.restaurant_record_payment(uuid,uuid,uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.restaurant_record_payment(uuid,uuid,uuid,numeric,text,text,uuid) to authenticated;

create or replace function public.restaurant_complete_order(p_organization_id uuid,p_order_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare
  v_role text;
  v_order public.restaurant_orders%rowtype;
  v_paid numeric;
  v_deposit_account uuid;
  v_revenue_account uuid;
  v_recipe record;
  previous_stock_flag text:=coalesce(pg_catalog.current_setting('veyora.restaurant_stock_deduction',true),'');
  previous_finance_flag text:=coalesce(pg_catalog.current_setting('veyora.restaurant_finance_rpc',true),'');
  previous_completion_flag text:=coalesce(pg_catalog.current_setting('veyora.restaurant_completion',true),'');
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
    select ri.variant_id,ri.location_id,sum(oi.quantity*ri.quantity_per_serving) as quantity_to_deduct,mi.name as menu_item_name
    from public.restaurant_order_items oi
    join public.restaurant_recipe_ingredients ri on ri.organization_id=oi.organization_id and ri.menu_item_id=oi.menu_item_id
    join public.restaurant_menu_items mi on mi.organization_id=ri.organization_id and mi.id=ri.menu_item_id
    where oi.organization_id=p_organization_id and oi.order_id=p_order_id
    group by ri.variant_id,ri.location_id,mi.name
  loop
    perform public.adjust_inventory_stock(
      p_organization_id,v_recipe.variant_id,v_recipe.location_id,-v_recipe.quantity_to_deduct,
      'stock_out','Restaurant order '||v_order.order_number,'Recipe consumption: '||v_recipe.menu_item_name
    );
  end loop;
  perform pg_catalog.set_config('veyora.restaurant_stock_deduction',previous_stock_flag,true);

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
    perform pg_catalog.set_config('veyora.restaurant_finance_rpc',previous_finance_flag,true);
  end if;

  perform pg_catalog.set_config('veyora.restaurant_completion','allowed',true);
  update public.restaurant_orders set status='completed',updated_at=pg_catalog.now()
  where id=p_order_id and organization_id=p_organization_id and status='served';
  if not found then raise exception 'Restaurant ticket completion failed.' using errcode='P0002'; end if;
  perform pg_catalog.set_config('veyora.restaurant_completion',previous_completion_flag,true);
end;
$function$;
revoke all on function public.restaurant_complete_order(uuid,uuid) from public,anon;
grant execute on function public.restaurant_complete_order(uuid,uuid) to authenticated;

create or replace function public.dealer_record_payment(
  p_organization_id uuid,p_deal_id uuid,p_financial_account_id uuid,
  p_amount numeric,p_reference text,p_notes text,p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path='' as $function$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_deal public.dealer_deals%rowtype;
  v_account public.finance_accounts%rowtype;
  v_deposit_account uuid;
  v_paid numeric;
  v_payment_id uuid;
  v_reference text;
  v_journal_id uuid;
  previous_payment_flag text:=coalesce(pg_catalog.current_setting('veyora.dealer_payment_rpc',true),'');
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='car_dealership' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=v_user;
  if v_role is null or v_role not in ('owner','admin','manager') or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Only an authorised dealership manager can record payments for this business.' using errcode='42501';
  end if;
  if p_amount is null or p_amount<=0 or p_idempotency_key is null then
    raise exception 'A positive payment amount and idempotency key are required.' using errcode='22023';
  end if;
  select * into v_deal from public.dealer_deals d where d.id=p_deal_id and d.organization_id=p_organization_id for update;
  if not found or v_deal.status in ('completed','cancelled') then raise exception 'The dealership deal is unavailable for payment.' using errcode='P0002'; end if;
  select * into v_account from public.finance_accounts a
  where a.id=p_financial_account_id and a.organization_id=p_organization_id and a.is_active for share;
  if not found then raise exception 'Choose an active cash, bank or wallet account belonging to this dealership.' using errcode='22023'; end if;
  select id into v_payment_id from public.dealer_payments where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_payment_id is not null then return v_payment_id; end if;
  select coalesce(sum(dp.amount),0) into v_paid from public.dealer_payments dp
  where dp.organization_id=p_organization_id and dp.deal_id=p_deal_id;
  if p_amount>v_deal.agreed_price-v_paid then
    raise exception 'Payment exceeds the remaining deal balance of %.',greatest(v_deal.agreed_price-v_paid,0) using errcode='23514';
  end if;
  v_reference:=coalesce(nullif(pg_catalog.btrim(p_reference),''),'DPM-'||pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text,'-',''),1,10)));
  insert into public.dealer_payments(organization_id,deal_id,financial_account_id,amount,reference,idempotency_key,notes,received_by)
  values(p_organization_id,p_deal_id,p_financial_account_id,p_amount,v_reference,p_idempotency_key,nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),v_user)
  returning id into v_payment_id;
  insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
  values(p_organization_id,'2200','Vehicle Customer Deposits','liability','credit',true)
  on conflict(organization_id,account_code) do nothing;
  select id into v_deposit_account from public.finance_ledger_accounts
  where organization_id=p_organization_id and account_code='2200' and is_active;
  if v_deposit_account is null then raise exception 'Vehicle deposit ledger account is unavailable.'; end if;
  v_journal_id:=public.finance_post_journal(
    p_organization_id,coalesce((select paid_at::date from public.dealer_payments where id=v_payment_id),current_date),
    'Vehicle deal payment '||v_reference,'dealer_payment',v_payment_id,v_payment_id,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('ledger_account_id',v_account.ledger_account_id,'financial_account_id',v_account.id,'debit',p_amount,'credit',0),
      pg_catalog.jsonb_build_object('ledger_account_id',v_deposit_account,'debit',0,'credit',p_amount)
    )
  );
  update public.dealer_payments set journal_entry_id=v_journal_id where id=v_payment_id and organization_id=p_organization_id;
  perform pg_catalog.set_config('veyora.dealer_payment_rpc','allowed',true);
  update public.dealer_deals set deposit_amount=v_paid+p_amount,
    status=case when v_paid+p_amount>=agreed_price then 'ready_for_delivery' else 'awaiting_payment' end,
    updated_at=pg_catalog.now()
  where id=p_deal_id and organization_id=p_organization_id;
  perform pg_catalog.set_config('veyora.dealer_payment_rpc',previous_payment_flag,true);
  return v_payment_id;
end;
$function$;
revoke all on function public.dealer_record_payment(uuid,uuid,uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.dealer_record_payment(uuid,uuid,uuid,numeric,text,text,uuid) to authenticated;

create or replace function public.dealer_complete_delivery(
  p_organization_id uuid,p_deal_id uuid,p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path='' as $function$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_deal public.dealer_deals%rowtype;
  v_vehicle public.dealer_vehicles%rowtype;
  v_paid numeric;
  v_deposit_account uuid;
  v_revenue_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_lines jsonb;
  v_journal_id uuid;
  previous_completion_flag text:=coalesce(pg_catalog.current_setting('veyora.dealer_completion_rpc',true),'');
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='car_dealership' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=v_user;
  if v_role is null or v_role not in ('owner','admin','manager') or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Only an authorised dealership manager can complete delivery.' using errcode='42501';
  end if;
  select * into v_deal from public.dealer_deals d where d.id=p_deal_id and d.organization_id=p_organization_id for update;
  if not found then raise exception 'Deal not found.' using errcode='P0002'; end if;
  if v_deal.status='completed' then
    select id into v_journal_id from public.finance_journal_entries
    where organization_id=p_organization_id and source_type='dealer_sale' and source_id=p_deal_id;
    if v_journal_id is not null then return v_journal_id; end if;
    raise exception 'Deal is already completed.' using errcode='23514';
  end if;
  if v_deal.status<>'ready_for_delivery' then raise exception 'Collect the full agreed price before completing delivery.' using errcode='23514'; end if;
  select coalesce(sum(dp.amount),0) into v_paid from public.dealer_payments dp
  where dp.organization_id=p_organization_id and dp.deal_id=p_deal_id;
  if v_paid<v_deal.agreed_price then raise exception 'The deal still has an outstanding balance.' using errcode='23514'; end if;
  select * into v_vehicle from public.dealer_vehicles v
  where v.id=v_deal.vehicle_id and v.organization_id=p_organization_id for update;
  if not found then raise exception 'Vehicle record not found.' using errcode='P0002'; end if;
  select id into v_deposit_account from public.finance_ledger_accounts where organization_id=p_organization_id and account_code='2200' and is_active;
  select id into v_revenue_account from public.finance_ledger_accounts where organization_id=p_organization_id and account_code='4000' and is_active;
  select id into v_cogs_account from public.finance_ledger_accounts where organization_id=p_organization_id and account_code='5000' and is_active;
  select id into v_inventory_account from public.finance_ledger_accounts where organization_id=p_organization_id and account_code='1200' and is_active;
  if v_deposit_account is null or v_revenue_account is null or (v_vehicle.purchase_price>0 and (v_cogs_account is null or v_inventory_account is null)) then
    raise exception 'The required dealership and inventory ledger accounts are not configured.' using errcode='23514';
  end if;
  v_lines:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('ledger_account_id',v_deposit_account,'debit',v_deal.agreed_price,'credit',0),
    pg_catalog.jsonb_build_object('ledger_account_id',v_revenue_account,'debit',0,'credit',v_deal.agreed_price)
  );
  if v_vehicle.purchase_price>0 then
    v_lines:=v_lines||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('ledger_account_id',v_cogs_account,'debit',v_vehicle.purchase_price,'credit',0),
      pg_catalog.jsonb_build_object('ledger_account_id',v_inventory_account,'debit',0,'credit',v_vehicle.purchase_price)
    );
  end if;
  v_journal_id:=public.finance_post_journal(
    p_organization_id,current_date,'Vehicle sale '||v_deal.deal_number,
    'dealer_sale',p_deal_id,coalesce(p_idempotency_key,p_deal_id),v_lines
  );
  perform pg_catalog.set_config('veyora.dealer_completion_rpc','allowed',true);
  update public.dealer_deals set status='completed',updated_at=pg_catalog.now()
  where id=p_deal_id and organization_id=p_organization_id;
  perform pg_catalog.set_config('veyora.dealer_completion_rpc',previous_completion_flag,true);
  return v_journal_id;
end;
$function$;
revoke all on function public.dealer_complete_delivery(uuid,uuid,uuid) from public,anon;
grant execute on function public.dealer_complete_delivery(uuid,uuid,uuid) to authenticated;

-- Restore the workspace-initialisation flag before returning to the caller.
create or replace function public.create_business_workspace(
  p_name text,p_business_type text,p_country text,p_base_currency text,
  p_business_email text,p_business_phone text,p_timezone text,p_configuration jsonb
)
returns uuid language plpgsql security definer set search_path='' as $function$
declare
  v_user_id uuid:=auth.uid();
  v_organization_id uuid;
  v_has_memberships boolean;
  v_is_owner boolean;
  v_business_type text:=coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_business_type)),''),'retail');
  previous_init_flag text:=coalesce(pg_catalog.current_setting('veyora.workspace_initialization',true),'');
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if nullif(pg_catalog.btrim(p_name),'') is null then raise exception 'Business name is required' using errcode='22023'; end if;
  if v_business_type not in ('retail','wholesale','distribution','services','hybrid','hotel','car_dealership','real_estate','restaurant','logistics','manufacturing') then
    raise exception 'Choose one supported business type when creating this business.' using errcode='22023';
  end if;
  select exists(select 1 from public.organization_memberships m where m.user_id=v_user_id) into v_has_memberships;
  select exists(select 1 from public.organization_memberships m where m.user_id=v_user_id and m.role='owner') into v_is_owner;
  if v_has_memberships and not v_is_owner then
    raise exception 'Only an Owner can create an additional business workspace. Managers and Staff cannot create businesses.' using errcode='42501';
  end if;
  perform pg_catalog.set_config('veyora.workspace_initialization','allowed',true);
  insert into public.organizations(name,business_type,country,currency,email,phone,timezone)
  values(pg_catalog.btrim(p_name),v_business_type,coalesce(nullif(pg_catalog.btrim(p_country),''),'Nigeria'),
    coalesce(nullif(pg_catalog.btrim(p_base_currency),''),'NGN'),nullif(pg_catalog.btrim(p_business_email),''),
    nullif(pg_catalog.btrim(p_business_phone),''),coalesce(nullif(pg_catalog.btrim(p_timezone),''),'Africa/Lagos'))
  returning id into v_organization_id;
  insert into public.organization_business_types(organization_id,business_type,is_primary,configuration)
  values(v_organization_id,v_business_type, true,coalesce(p_configuration,'{}'::jsonb));
  insert into public.organization_memberships(organization_id,user_id,role) values(v_organization_id,v_user_id,'owner');
  insert into public.finance_accounts(organization_id,account_name,account_type,currency_code,ledger_account_id,created_by)
  select v_organization_id,'Cash on Hand','cash',o.currency,l.id,v_user_id
  from public.organizations o join public.finance_ledger_accounts l
    on l.organization_id=o.id and l.account_code='1000' and l.is_active
  where o.id=v_organization_id
    and not exists(select 1 from public.finance_accounts a where a.organization_id=v_organization_id and a.account_name='Cash on Hand');
  perform pg_catalog.set_config('veyora.workspace_initialization',previous_init_flag,true);
  return v_organization_id;
end;
$function$;
revoke all on function public.create_business_workspace(text,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_business_workspace(text,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.create_business_workspace(
  p_name text,p_business_type text,p_country text,p_base_currency text,
  p_business_email text,p_business_phone text,p_timezone text
)
returns uuid language plpgsql security definer set search_path='' as $function$
begin
  return public.create_business_workspace(p_name,p_business_type,p_country,p_base_currency,p_business_email,p_business_phone,p_timezone,'{}'::jsonb);
end;
$function$;
revoke all on function public.create_business_workspace(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_business_workspace(text,text,text,text,text,text,text) to authenticated;

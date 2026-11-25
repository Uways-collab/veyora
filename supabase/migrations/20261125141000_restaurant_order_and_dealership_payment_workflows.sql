-- Complete itemised restaurant ordering and dealership payment/delivery accounting.

-- Restaurant staff may update only kitchen status. Managers/owners can edit other order fields.
grant update on public.restaurant_orders to authenticated;
revoke update(status) on public.restaurant_orders from authenticated;
drop policy if exists restaurant_orders_staff_status_update on public.restaurant_orders;
create policy restaurant_orders_staff_status_update on public.restaurant_orders
for update to authenticated
using (exists(
  select 1 from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=restaurant_orders.organization_id
    and m.user_id=(select auth.uid()) and m.role='staff'
))
with check (exists(
  select 1 from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=restaurant_orders.organization_id
    and m.user_id=(select auth.uid()) and m.role='staff'
));

-- Menu and table configuration is manager-only; service staff can read it and create tickets.
drop policy if exists restaurant_menu_categories_member_insert on public.restaurant_menu_categories;
create policy restaurant_menu_categories_manager_insert on public.restaurant_menu_categories
for insert to authenticated with check (exists(
  select 1 from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=restaurant_menu_categories.organization_id
    and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')
));
drop policy if exists restaurant_menu_items_member_insert on public.restaurant_menu_items;
create policy restaurant_menu_items_manager_insert on public.restaurant_menu_items
for insert to authenticated with check (exists(
  select 1 from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=restaurant_menu_items.organization_id
    and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')
));
drop policy if exists restaurant_tables_member_insert on public.restaurant_tables;
create policy restaurant_tables_manager_insert on public.restaurant_tables
for insert to authenticated with check (exists(
  select 1 from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=restaurant_tables.organization_id
    and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')
));

create or replace function private.restaurant_enforce_order_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_role text;
  completion_allowed boolean := coalesce(pg_catalog.current_setting('veyora.restaurant_completion',true),'')='allowed';
  non_status_old jsonb;
  non_status_new jsonb;
begin
  select m.role into actor_role
  from public.organization_memberships m
  where m.organization_id=old.organization_id and m.user_id=auth.uid();

  if actor_role is null or not exists(
    select 1 from public.organization_business_types b
    where b.organization_id=old.organization_id and b.business_type='restaurant' and b.is_primary
  ) then
    raise exception 'Restaurant order access denied' using errcode='42501';
  end if;

  if actor_role='staff' then
    non_status_old := pg_catalog.to_jsonb(old) - 'status' - 'updated_at';
    non_status_new := pg_catalog.to_jsonb(new) - 'status' - 'updated_at';
    if non_status_old is distinct from non_status_new then
      raise exception 'Restaurant staff may update kitchen status only.' using errcode='42501';
    end if;
  elsif actor_role not in ('owner','admin','manager') then
    raise exception 'Insufficient restaurant permissions.' using errcode='42501';
  end if;

  if new.status is distinct from old.status then
    if new.status='completed' and not completion_allowed then
      raise exception 'Only the restaurant completion workflow can close a ticket.' using errcode='42501';
    end if;
    if not (
      (old.status='new' and new.status in ('accepted','cancelled'))
      or (old.status='accepted' and new.status in ('preparing','cancelled'))
      or (old.status='preparing' and new.status in ('ready','cancelled'))
      or (old.status='ready' and new.status in ('served','cancelled'))
      or (old.status='served' and new.status='completed' and completion_allowed)
    ) then
      raise exception 'Invalid restaurant ticket status transition: % to %.',old.status,new.status
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;
revoke all on function private.restaurant_enforce_order_update() from public,anon,authenticated;
drop trigger if exists restaurant_order_role_and_transition_guard on public.restaurant_orders;
create trigger restaurant_order_role_and_transition_guard
before update on public.restaurant_orders
for each row execute function private.restaurant_enforce_order_update();

create or replace function private.restaurant_order_item_open_ticket_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_order uuid;
  target_org uuid;
  current_status text;
begin
  target_order := case when tg_op='DELETE' then old.order_id else new.order_id end;
  target_org := case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  select o.status into current_status from public.restaurant_orders o
  where o.id=target_order and o.organization_id=target_org;
  if current_status is null then
    raise exception 'Restaurant ticket not found.' using errcode='P0002';
  end if;
  if current_status in ('completed','cancelled') then
    raise exception 'Items cannot be changed on a closed restaurant ticket.' using errcode='42501';
  end if;
  if not private.organization_has_access(target_org,'industry') then
    raise exception 'Restaurant workspace access denied.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function private.restaurant_order_item_open_ticket_guard() from public,anon,authenticated;
drop trigger if exists restaurant_order_item_open_ticket_guard on public.restaurant_order_items;
create trigger restaurant_order_item_open_ticket_guard
before insert or update or delete on public.restaurant_order_items
for each row execute function private.restaurant_order_item_open_ticket_guard();

create or replace function public.restaurant_create_order_with_items(
  p_organization_id uuid,
  p_order_type text,
  p_table_id uuid,
  p_covers integer,
  p_customer_name text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_order_number text;
  v_table_label text;
  v_item jsonb;
  v_menu public.restaurant_menu_items%rowtype;
  v_quantity numeric;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_organization_id is null or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Active restaurant workspace subscription required.' using errcode='42501';
  end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=auth.uid();
  if v_role is null or v_role not in ('owner','admin','manager','staff') then
    raise exception 'You do not have restaurant order access.' using errcode='42501';
  end if;
  if p_order_type not in ('dine_in','takeaway','delivery') then
    raise exception 'Choose dine-in, takeaway or delivery.' using errcode='22023';
  end if;
  if coalesce(p_covers,1)<1 then raise exception 'Guest count must be at least one.' using errcode='22023'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception 'Add between 1 and 100 menu items to the ticket.' using errcode='22023';
  end if;

  if p_order_type='dine_in' and p_table_id is not null then
    select t.table_number into v_table_label
    from public.restaurant_tables t
    where t.id=p_table_id and t.organization_id=p_organization_id
      and t.status in ('available','reserved')
    for update;
    if not found then raise exception 'That dining table is unavailable or belongs to another business.' using errcode='42501'; end if;
  elsif p_table_id is not null then
    raise exception 'Only dine-in orders can be assigned to a dining table.' using errcode='22023';
  end if;

  v_order_number := 'R-'||pg_catalog.to_char(pg_catalog.now(),'YYMMDD')||'-'||pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6));
  insert into public.restaurant_orders(
    organization_id,order_number,order_type,table_id,table_label,covers,
    customer_name,items_summary,total_amount,status,notes,created_by
  ) values (
    p_organization_id,v_order_number,p_order_type,p_table_id,v_table_label,
    coalesce(p_covers,1),nullif(pg_catalog.btrim(coalesce(p_customer_name,'')),''),
    'Itemised order',0,'new',nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),auth.uid()
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'menu_item_id','') is null then raise exception 'Every ticket line needs a menu item.' using errcode='22023'; end if;
    v_quantity := coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_quantity<=0 or v_quantity>10000 then raise exception 'Ticket item quantity must be greater than zero.' using errcode='22023'; end if;
    select * into v_menu from public.restaurant_menu_items m
    where m.id=(v_item->>'menu_item_id')::uuid
      and m.organization_id=p_organization_id and m.is_available
    for share;
    if not found then raise exception 'A selected menu item is unavailable or belongs to another business.' using errcode='42501'; end if;
    insert into public.restaurant_order_items(
      organization_id,order_id,menu_item_id,item_name,quantity,unit_price,modifiers,notes
    ) values (
      p_organization_id,v_order_id,v_menu.id,v_menu.name,v_quantity,v_menu.price,
      nullif(pg_catalog.btrim(coalesce(v_item->>'modifiers','')),''),
      nullif(pg_catalog.btrim(coalesce(v_item->>'notes','')),'')
    );
  end loop;

  return v_order_id;
end;
$function$;
revoke all on function public.restaurant_create_order_with_items(uuid,text,uuid,integer,text,text,jsonb) from public,anon;
grant execute on function public.restaurant_create_order_with_items(uuid,text,uuid,integer,text,text,jsonb) to authenticated;


-- Vehicle stock and deal creation are manager-only; staff work leads, test drives and workshop tickets.
drop policy if exists dealer_vehicles_member_insert on public.dealer_vehicles;
create policy dealer_vehicles_manager_insert on public.dealer_vehicles
for insert to authenticated with check (exists(
 select 1 from public.organization_memberships m
 join public.organization_business_types b on b.organization_id=m.organization_id
  and b.business_type='car_dealership' and b.is_primary
 where m.organization_id=dealer_vehicles.organization_id
  and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')
));
drop policy if exists dealer_deals_member_insert on public.dealer_deals;
create policy dealer_deals_manager_insert on public.dealer_deals
for insert to authenticated with check (exists(
 select 1 from public.organization_memberships m
 join public.organization_business_types b on b.organization_id=m.organization_id
  and b.business_type='car_dealership' and b.is_primary
 where m.organization_id=dealer_deals.organization_id
  and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')
));


create or replace function public.restaurant_complete_order(p_organization_id uuid,p_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_status text;
begin
  if auth.uid() is null or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Active restaurant workspace access is required.' using errcode='42501';
  end if;
  select m.role into v_role
  from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='restaurant' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=auth.uid();
  if v_role not in ('owner','admin','manager','staff') then
    raise exception 'Restaurant ticket access denied.' using errcode='42501';
  end if;
  select o.status into v_status from public.restaurant_orders o
  where o.id=p_order_id and o.organization_id=p_organization_id for update;
  if v_status='completed' then return; end if;
  if v_status<>'served' then
    raise exception 'Only a served restaurant ticket can be completed.' using errcode='23514';
  end if;
  perform pg_catalog.set_config('veyora.restaurant_completion','allowed',true);
  update public.restaurant_orders set status='completed',updated_at=pg_catalog.now()
  where id=p_order_id and organization_id=p_organization_id and status='served';
  if not found then raise exception 'Restaurant ticket completion failed.' using errcode='P0002'; end if;
end;
$function$;
revoke all on function public.restaurant_complete_order(uuid,uuid) from public,anon;
grant execute on function public.restaurant_complete_order(uuid,uuid) to authenticated;

-- Dealer receipts are immutable and every payment is posted to the organisation ledger.
-- Tenant-safe composite targets for payment/account references.
create unique index if not exists dealer_deals_id_org_uidx on public.dealer_deals(id,organization_id);
create unique index if not exists finance_accounts_id_org_uidx
on public.finance_accounts(id,organization_id);
create unique index if not exists finance_journal_entries_id_org_uidx
on public.finance_journal_entries(id,organization_id);

create table if not exists public.dealer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  financial_account_id uuid not null,
  journal_entry_id uuid,
  amount numeric(14,2) not null check(amount>0),
  reference text not null,
  idempotency_key uuid not null default gen_random_uuid(),
  paid_at timestamptz not null default now(),
  notes text,
  received_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,reference),
  unique(organization_id,idempotency_key),
  constraint dealer_payments_deal_tenant_fk foreign key(deal_id,organization_id)
    references public.dealer_deals(id,organization_id) on delete restrict,
  constraint dealer_payments_financial_account_tenant_fk foreign key(financial_account_id,organization_id)
    references public.finance_accounts(id,organization_id) on delete restrict,
  constraint dealer_payments_journal_tenant_fk foreign key(journal_entry_id,organization_id)
    references public.finance_journal_entries(id,organization_id) on delete restrict
);

create index if not exists dealer_payments_org_deal_paid_idx
on public.dealer_payments(organization_id,deal_id,paid_at desc);
alter table public.dealer_payments enable row level security;
drop policy if exists dealer_payments_manager_select on public.dealer_payments;
create policy dealer_payments_manager_select on public.dealer_payments
for select to authenticated using (
  exists(select 1 from public.organization_memberships m
    join public.organization_business_types b on b.organization_id=m.organization_id
      and b.business_type='car_dealership' and b.is_primary
    where m.organization_id=dealer_payments.organization_id and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','manager'))
  and private.organization_has_access(organization_id,'industry')
);
revoke all on public.dealer_payments from anon,authenticated;
grant select on public.dealer_payments to authenticated;
drop trigger if exists a_subscription_feature_guard on public.dealer_payments;
create trigger a_subscription_feature_guard before insert or update or delete on public.dealer_payments
for each row execute function private.guard_business_access('industry');

create or replace function private.dealer_guard_payment_derived_fields()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.deposit_amount is distinct from old.deposit_amount
     and coalesce(pg_catalog.current_setting('veyora.dealer_payment_rpc',true),'')<>'allowed' then
    raise exception 'Deal payment totals can only be changed through the verified payment workflow.' using errcode='42501';
  end if;
  if new.status='completed' and old.status is distinct from new.status
     and coalesce(pg_catalog.current_setting('veyora.dealer_completion_rpc',true),'')<>'allowed' then
    raise exception 'Deliveries must be completed through the verified delivery workflow.' using errcode='42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.dealer_guard_payment_derived_fields() from public,anon,authenticated;
drop trigger if exists dealer_deal_payment_completion_guard on public.dealer_deals;
create trigger dealer_deal_payment_completion_guard
before insert or update on public.dealer_deals
for each row execute function private.dealer_guard_payment_derived_fields();

create or replace function public.dealer_record_payment(
  p_organization_id uuid,
  p_deal_id uuid,
  p_financial_account_id uuid,
  p_amount numeric,
  p_reference text,
  p_notes text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_deal public.dealer_deals%rowtype;
  v_account public.finance_accounts%rowtype;
  v_deposit_account uuid;
  v_revenue numeric;
  v_paid numeric;
  v_payment_id uuid;
  v_reference text;
  v_journal_id uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='car_dealership' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=v_user;
  if v_role is null or v_role not in ('owner','admin','manager') or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Only an authorised dealership manager can record payments for this business.' using errcode='42501';
  end if;
  if p_amount is null or p_amount<=0 or p_idempotency_key is null then
    raise exception 'A positive payment amount and idempotency key are required.' using errcode='22023';
  end if;

  select * into v_deal from public.dealer_deals d
  where d.id=p_deal_id and d.organization_id=p_organization_id for update;
  if not found or v_deal.status in ('completed','cancelled') then
    raise exception 'The dealership deal is unavailable for payment.' using errcode='P0002';
  end if;

  select * into v_account from public.finance_accounts a
  where a.id=p_financial_account_id and a.organization_id=p_organization_id and a.is_active
  for share;
  if not found then raise exception 'Choose an active cash, bank or wallet account belonging to this dealership.' using errcode='22023'; end if;

  select id into v_payment_id from public.dealer_payments
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_payment_id is not null then return v_payment_id; end if;

  select coalesce(sum(dp.amount),0) into v_paid from public.dealer_payments dp
  where dp.organization_id=p_organization_id and dp.deal_id=p_deal_id;
  if p_amount > v_deal.agreed_price-v_paid then
    raise exception 'Payment exceeds the remaining deal balance of %.',greatest(v_deal.agreed_price-v_paid,0)
      using errcode='23514';
  end if;

  v_reference:=coalesce(nullif(pg_catalog.btrim(p_reference),''),'DPM-'||pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text,'-',''),1,10)));
  insert into public.dealer_payments(organization_id,deal_id,financial_account_id,amount,reference,idempotency_key,notes,received_by)
  values(p_organization_id,p_deal_id,p_financial_account_id,p_amount,v_reference,p_idempotency_key,
    nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),v_user)
  returning id into v_payment_id;

  insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
  values(p_organization_id,'2200','Vehicle Customer Deposits','liability','credit',true)
  on conflict (organization_id,account_code) do nothing;
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
  update public.dealer_deals
  set deposit_amount=v_paid+p_amount,
      status=case when v_paid+p_amount>=agreed_price then 'ready_for_delivery' else 'awaiting_payment' end,
      updated_at=pg_catalog.now()
  where id=p_deal_id and organization_id=p_organization_id;

  return v_payment_id;
end;
$function$;
revoke all on function public.dealer_record_payment(uuid,uuid,uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.dealer_record_payment(uuid,uuid,uuid,numeric,text,text,uuid) to authenticated;

create or replace function public.dealer_complete_delivery(p_organization_id uuid,p_deal_id uuid,p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
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
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select m.role into v_role from public.organization_memberships m
  join public.organization_business_types b on b.organization_id=m.organization_id
    and b.business_type='car_dealership' and b.is_primary
  where m.organization_id=p_organization_id and m.user_id=v_user;
  if v_role not in ('owner','admin','manager') or not private.organization_has_access(p_organization_id,'industry') then
    raise exception 'Only an authorised dealership manager can complete delivery.' using errcode='42501';
  end if;

  select * into v_deal from public.dealer_deals d
  where d.id=p_deal_id and d.organization_id=p_organization_id for update;
  if not found then raise exception 'Deal not found.' using errcode='P0002'; end if;
  if v_deal.status='completed' then
    select id into v_journal_id from public.finance_journal_entries
    where organization_id=p_organization_id and source_type='dealer_sale' and source_id=p_deal_id;
    if v_journal_id is not null then return v_journal_id; end if;
    raise exception 'Deal is already completed.' using errcode='23514';
  end if;
  if v_deal.status<>'ready_for_delivery' then
    raise exception 'Collect the full agreed price before completing delivery.' using errcode='23514';
  end if;

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
  return v_journal_id;
end;
$function$;
revoke all on function public.dealer_complete_delivery(uuid,uuid,uuid) from public,anon;
grant execute on function public.dealer_complete_delivery(uuid,uuid,uuid) to authenticated;

-- Deal deposit and completion state are controlled by the payment and delivery RPCs.
create or replace function private.dealer_guard_payment_derived_fields()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if tg_op='INSERT' then
    if new.deposit_amount<>0 or new.status<>'draft' then
      raise exception 'New dealership deals must start unpaid in Draft. Record deposits through the payment workflow.' using errcode='42501';
    end if;
    return new;
  end if;
  if new.deposit_amount is distinct from old.deposit_amount
     and coalesce(pg_catalog.current_setting('veyora.dealer_payment_rpc',true),'')<>'allowed' then
    raise exception 'Deal payment totals can only be changed through the verified payment workflow.' using errcode='42501';
  end if;
  if new.status='completed' and old.status is distinct from new.status
     and coalesce(pg_catalog.current_setting('veyora.dealer_completion_rpc',true),'')<>'allowed' then
    raise exception 'Deliveries must be completed through the verified delivery workflow.' using errcode='42501';
  end if;
  if new.status='ready_for_delivery' and old.status is distinct from new.status
     and new.deposit_amount < new.agreed_price then
    raise exception 'A deal cannot be marked ready for delivery before it is fully paid.' using errcode='23514';
  end if;
  return new;
end;
$function$;

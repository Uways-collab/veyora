-- Capitalise dealership vehicle acquisition cost into inventory and accounts payable.
create or replace function private.dealer_post_vehicle_acquisition()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_inventory_account uuid;
  v_payables_account uuid;
begin
  if new.purchase_price<=0 then return new; end if;
  if exists(select 1 from public.finance_journal_entries j
    where j.organization_id=new.organization_id
      and j.source_type='dealer_vehicle_acquisition' and j.source_id=new.id) then
    return new;
  end if;

  select id into v_inventory_account from public.finance_ledger_accounts
  where organization_id=new.organization_id and account_code='1200' and is_active;
  select id into v_payables_account from public.finance_ledger_accounts
  where organization_id=new.organization_id and account_code='2000' and is_active;
  if v_inventory_account is null or v_payables_account is null then
    raise exception 'The dealership inventory and accounts-payable ledger accounts are not configured.'
      using errcode='23514';
  end if;

  perform public.finance_post_journal(
    new.organization_id,current_date,'Vehicle stock acquisition '||new.stock_number,
    'dealer_vehicle_acquisition',new.id,new.id,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('ledger_account_id',v_inventory_account,'debit',new.purchase_price,'credit',0),
      pg_catalog.jsonb_build_object('ledger_account_id',v_payables_account,'debit',0,'credit',new.purchase_price)
    )
  );
  return new;
end;
$function$;
revoke all on function private.dealer_post_vehicle_acquisition() from public,anon,authenticated;

create or replace function private.dealer_protect_posted_vehicle_cost()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if new.purchase_price is distinct from old.purchase_price
     and exists(select 1 from public.finance_journal_entries j
       where j.organization_id=old.organization_id
         and j.source_type='dealer_vehicle_acquisition' and j.source_id=old.id) then
    raise exception 'Vehicle acquisition cost has already been posted. Use an authorised finance adjustment instead.'
      using errcode='42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.dealer_protect_posted_vehicle_cost() from public,anon,authenticated;

drop trigger if exists dealer_protect_posted_vehicle_cost on public.dealer_vehicles;
create trigger dealer_protect_posted_vehicle_cost
before update of purchase_price on public.dealer_vehicles
for each row execute function private.dealer_protect_posted_vehicle_cost();

drop trigger if exists dealer_vehicle_acquisition_journal on public.dealer_vehicles;
create trigger dealer_vehicle_acquisition_journal
after insert or update of purchase_price on public.dealer_vehicles
for each row execute function private.dealer_post_vehicle_acquisition();

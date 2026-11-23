-- Supplier prepayments and credit balances: prevent pre-receipt supplier payments
-- from creating a debit balance in Accounts Payable.
insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
select id,'1300','Supplier Advances','asset','debit',true from public.organizations
on conflict(organization_id,account_code) do nothing;

create or replace function public.finance_seed_refund_clearing_account()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
 values
  (new.id,'1090','Customer Refunds Clearing','asset','debit',true),
  (new.id,'1300','Supplier Advances','asset','debit',true),
  (new.id,'2100','Customer Credits Payable','liability','credit',true)
 on conflict(organization_id,account_code) do nothing;
 return new;
end;
$$;
revoke all on function public.finance_seed_refund_clearing_account() from public,anon,authenticated;

create index if not exists finance_source_events_purchase_id_idx
 on public.finance_source_events(organization_id,(payload->>'purchase_id'),event_type)
 where status='posted';

create or replace function public.finance_get_purchase_posting_state(p_organization_id uuid,p_purchase_id uuid)
returns table(payable_balance numeric,advance_balance numeric)
language sql stable security definer set search_path=''
as $$
 select
  coalesce(sum(case
   when se.event_type='purchase_receipt' then coalesce((se.payload->>'payable_applied')::numeric,0)
   when se.event_type='purchase_payment' then -coalesce((se.payload->>'payable_applied')::numeric,0)-coalesce((se.payload->>'credit_applied')::numeric,0)
   when se.event_type='purchase_return' then -coalesce((se.payload->>'payable_applied')::numeric,0)
   else 0 end),0) as payable_balance,
  coalesce(sum(case
   when se.event_type='purchase_payment' then coalesce((se.payload->>'supplier_advance')::numeric,0)-coalesce((se.payload->>'credit_applied')::numeric,0)
   when se.event_type='purchase_return' then coalesce((se.payload->>'supplier_credit')::numeric,0)
   when se.event_type='purchase_receipt' then -coalesce((se.payload->>'advance_applied')::numeric,0)
   else 0 end),0) as advance_balance
 from public.finance_source_events se
 where se.organization_id=p_organization_id and se.status='posted'
  and se.event_type in ('purchase_receipt','purchase_payment','purchase_return')
  and se.payload->>'purchase_id'=p_purchase_id::text
  and not exists(select 1 from public.finance_journal_entries rev
   where rev.organization_id=se.organization_id and rev.reversal_of_entry_id=se.journal_entry_id);
$$;
revoke all on function public.finance_get_purchase_posting_state(uuid,uuid) from public,anon,authenticated;

create or replace function public.finance_process_purchase_source_event(p_event_id uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare
 e public.finance_source_events%rowtype; v_purchase_id uuid; v_amount numeric(20,4); v_cost numeric(20,4);
 v_currency text; v_date date; v_purchase_number text; v_tax numeric(20,4); v_discount numeric(20,4); v_subtotal numeric(20,4);
 v_financial uuid; v_cash_ledger uuid; v_inventory uuid; v_ap uuid; v_advances uuid;
 v_payable_balance numeric(20,4); v_advance_balance numeric(20,4);
 v_advance_apply numeric(20,4); v_payable_apply numeric(20,4); v_credit_apply numeric(20,4);
 v_payment_to_ap numeric(20,4); v_supplier_advance numeric(20,4); v_supplier_credit numeric(20,4);
 v_lines jsonb:='[]'::jsonb; v_journal uuid;
begin
 select * into e from public.finance_source_events where id=p_event_id for update;
 if not found then raise exception 'Finance source event not found'; end if;
 if e.status in ('posted','reversed','skipped') then return e.status; end if;
 if auth.uid() is null or not public.is_organization_member(e.organization_id)
  or not public.has_sales_role(e.organization_id,array['owner','admin','manager','staff']::text[]) then
  raise exception 'Authenticated organisation membership is required' using errcode='42501';
 end if;
 select id into v_inventory from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='1200' and is_active;
 select id into v_ap from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='2000' and is_active;
 select id into v_advances from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='1300' and is_active;

 if e.event_type='purchase_receipt' then
  select p.id,p.currency,p.tax_amount,p.discount_amount,p.subtotal,p.purchase_number,pr.received_at
   into v_purchase_id,v_currency,v_tax,v_discount,v_subtotal,v_purchase_number,v_date
   from public.purchase_receipts pr join public.purchases p on p.organization_id=pr.organization_id and p.id=pr.purchase_id
   where pr.organization_id=e.organization_id and pr.id=e.source_id;
  if not found then raise exception 'Purchase receipt source not found'; end if;
  if upper(v_currency)<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Purchase currency mismatch'; end if;
  if coalesce(v_tax,0)<>0 then raise exception 'Purchase tax requires a configured tax treatment before receipt posting'; end if;
  select coalesce(sum(pri.accepted_quantity*pi.unit_cost),0) into v_cost
   from public.purchase_receipt_items pri join public.purchase_items pi on pi.organization_id=pri.organization_id and pi.id=pri.purchase_item_id
   join public.product_variants pv on pv.organization_id=pi.organization_id and pv.id=pi.variant_id
   join public.products prod on prod.organization_id=pv.organization_id and prod.id=pv.product_id
   where pri.organization_id=e.organization_id and pri.receipt_id=e.source_id and prod.product_type='physical';
  if v_cost<=0 then update public.finance_source_events set status='skipped',last_error='No positively valued physical inventory accepted on this receipt',updated_at=now() where id=e.id; return 'skipped'; end if;
  if coalesce(v_subtotal,0)>0 and coalesce(v_discount,0)>0 then v_cost:=v_cost-(v_cost*v_discount/v_subtotal); end if;
  if v_cost<=0 then raise exception 'Receipt net inventory cost is not positive'; end if;
  select payable_balance,advance_balance into v_payable_balance,v_advance_balance from public.finance_get_purchase_posting_state(e.organization_id,v_purchase_id);
  v_advance_apply:=least(v_cost,greatest(0,coalesce(v_advance_balance,0)));
  v_payable_apply:=v_cost-v_advance_apply;
  v_lines:=jsonb_build_array(jsonb_build_object('ledger_account_id',v_inventory,'debit',v_cost,'credit',0,'description','Accepted inventory received'));
  if v_advance_apply>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_advances,'debit',0,'credit',v_advance_apply,'description','Supplier advance applied to received inventory')); end if;
  if v_payable_apply>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_ap,'debit',0,'credit',v_payable_apply,'description','Supplier payable recognised')); end if;
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Goods received - '||v_purchase_number,v_lines);
  update public.finance_source_events set payload=payload||jsonb_build_object('purchase_id',v_purchase_id,'advance_applied',v_advance_apply,'payable_applied',v_payable_apply) where id=e.id;

 elsif e.event_type='purchase_payment' then
  select pp.purchase_id,pp.amount,pp.paid_at,p.currency,p.tax_amount,p.purchase_number
   into v_purchase_id,v_amount,v_date,v_currency,v_tax,v_purchase_number
   from public.purchase_payments pp join public.purchases p on p.organization_id=pp.organization_id and p.id=pp.purchase_id
   where pp.organization_id=e.organization_id and pp.id=e.source_id;
  if not found then raise exception 'Supplier payment source not found'; end if;
  if upper(v_currency)<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Supplier payment currency mismatch'; end if;
  if coalesce(v_tax,0)<>0 then raise exception 'Purchase tax requires a configured tax treatment before supplier payment posting'; end if;
  select pm.finance_account_id,fa.ledger_account_id into v_financial,v_cash_ledger
   from public.payment_methods pm join public.finance_accounts fa on fa.organization_id=pm.organization_id and fa.id=pm.finance_account_id
   where pm.organization_id=e.organization_id and pm.id=e.payment_method_id and pm.is_active and fa.is_active;
  if v_financial is null then update public.finance_source_events set status='pending',last_error='Map this payment method to an active financial account',updated_at=now() where id=e.id; return 'pending'; end if;
  select payable_balance,advance_balance into v_payable_balance,v_advance_balance from public.finance_get_purchase_posting_state(e.organization_id,v_purchase_id);
  v_credit_apply:=least(greatest(0,coalesce(v_advance_balance,0)),greatest(0,coalesce(v_payable_balance,0)));
  v_payment_to_ap:=least(v_amount,greatest(0,coalesce(v_payable_balance,0)-v_credit_apply));
  v_supplier_advance:=v_amount-v_payment_to_ap;
  if v_credit_apply+v_payment_to_ap>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_ap,'debit',v_credit_apply+v_payment_to_ap,'credit',0,'description','Supplier payable settled')); end if;
  if v_supplier_advance>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_advances,'debit',v_supplier_advance,'credit',0,'description','Supplier prepayment / advance')); end if;
  if v_credit_apply>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_advances,'debit',0,'credit',v_credit_apply,'description','Supplier credit applied to payable')); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_cash_ledger,'financial_account_id',v_financial,'debit',0,'credit',v_amount,'description','Supplier payment'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Supplier payment - '||v_purchase_number,v_lines);
  update public.finance_source_events set payload=payload||jsonb_build_object('purchase_id',v_purchase_id,'payable_applied',v_payment_to_ap,'credit_applied',v_credit_apply,'supplier_advance',v_supplier_advance) where id=e.id;

 elsif e.event_type='purchase_return' then
  select p.id,p.currency,p.tax_amount,p.discount_amount,p.subtotal,p.purchase_number,r.returned_at
   into v_purchase_id,v_currency,v_tax,v_discount,v_subtotal,v_purchase_number,v_date
   from public.purchase_returns r join public.purchases p on p.organization_id=r.organization_id and p.id=r.purchase_id
   where r.organization_id=e.organization_id and r.id=e.source_id and r.status='completed';
  if not found then update public.finance_source_events set status='skipped',last_error='Supplier return is not completed',updated_at=now() where id=e.id; return 'skipped'; end if;
  if upper(v_currency)<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Purchase return currency mismatch'; end if;
  if coalesce(v_tax,0)<>0 then raise exception 'Purchase tax requires a configured tax treatment before return posting'; end if;
  select coalesce(sum(ri.line_total),0) into v_cost from public.purchase_return_items ri where ri.organization_id=e.organization_id and ri.return_id=e.source_id;
  if coalesce(v_subtotal,0)>0 and coalesce(v_discount,0)>0 then v_cost:=v_cost-(v_cost*v_discount/v_subtotal); end if;
  if v_cost<=0 then raise exception 'Supplier return has no positive inventory value'; end if;
  select payable_balance,advance_balance into v_payable_balance,v_advance_balance from public.finance_get_purchase_posting_state(e.organization_id,v_purchase_id);
  v_payable_apply:=least(v_cost,greatest(0,coalesce(v_payable_balance,0)));
  v_supplier_credit:=v_cost-v_payable_apply;
  if v_payable_apply>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_ap,'debit',v_payable_apply,'credit',0,'description','Supplier credit reduces payable')); end if;
  if v_supplier_credit>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_advances,'debit',v_supplier_credit,'credit',0,'description','Supplier credit receivable')); end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_inventory,'debit',0,'credit',v_cost,'description','Inventory returned to supplier'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Purchase return - '||v_purchase_number,v_lines);
  update public.finance_source_events set payload=payload||jsonb_build_object('purchase_id',v_purchase_id,'payable_applied',v_payable_apply,'supplier_credit',v_supplier_credit) where id=e.id;
 else
  raise exception 'Unsupported supplier source event type: %',e.event_type;
 end if;
 update public.finance_source_events set status='posted',journal_entry_id=v_journal,last_error=null,processed_at=now(),updated_at=now() where id=e.id;
 return 'posted';
exception when others then
 update public.finance_source_events set status='pending',last_error=left(sqlerrm,1000),updated_at=now() where id=p_event_id;
 return 'pending';
end;
$$;
revoke all on function public.finance_process_purchase_source_event(uuid) from public,anon,authenticated;

do $$
declare d text;
begin
 d:=pg_get_functiondef('public.finance_process_source_event(uuid)'::regprocedure);
 d:=replace(d,
  'select upper(currency) into v_currency from public.organizations where id=e.organization_id;',
  'if e.event_type in (''purchase_receipt'',''purchase_payment'',''purchase_return'') then return public.finance_process_purchase_source_event(p_event_id); end if;'||chr(10)||
  ' select upper(currency) into v_currency from public.organizations where id=e.organization_id;');
 if position('finance_process_purchase_source_event' in d)=0 then raise exception 'Could not add supplier accounting delegation'; end if;
 execute d;
end $$;

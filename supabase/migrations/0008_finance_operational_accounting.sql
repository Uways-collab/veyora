-- Veyora Finance operational accounting integration.
-- Prerequisite: the Finance foundation tables and base posting RPCs are already deployed.
-- This migration intentionally does not backfill historical operational records.

create table if not exists public.finance_source_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 event_type text not null,
 source_id uuid not null,
 payment_method_id uuid,
 status text not null default 'pending' check(status in ('pending','posted','reversed','skipped')),
 journal_entry_id uuid,
 reversal_entry_id uuid,
 last_error text,
 payload jsonb not null default '{}'::jsonb,
 created_by uuid,
 created_at timestamptz not null default now(),
 processed_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint finance_source_events_source_unique unique(organization_id,event_type,source_id),
 constraint finance_source_events_payment_method_fk foreign key(organization_id,payment_method_id) references public.payment_methods(organization_id,id),
 constraint finance_source_events_journal_fk foreign key(organization_id,journal_entry_id) references public.finance_journal_entries(organization_id,id),
 constraint finance_source_events_reversal_fk foreign key(organization_id,reversal_entry_id) references public.finance_journal_entries(organization_id,id)
);
create index if not exists finance_source_events_org_status_idx on public.finance_source_events(organization_id,status,created_at desc);
create index if not exists finance_source_events_payment_method_idx on public.finance_source_events(organization_id,payment_method_id,status) where payment_method_id is not null;
alter table public.finance_source_events enable row level security;
revoke all on public.finance_source_events from anon,authenticated;
grant select on public.finance_source_events to authenticated;
drop policy if exists finance_source_events_read_managers on public.finance_source_events;
create policy finance_source_events_read_managers on public.finance_source_events for select to authenticated
 using(public.has_sales_role(organization_id,array['owner','admin','manager']::text[]));

insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
select id,'1090','Customer Refunds Clearing','asset','debit',true from public.organizations
on conflict(organization_id,account_code) do nothing;
insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
select id,'2100','Customer Credits Payable','liability','credit',true from public.organizations
on conflict(organization_id,account_code) do nothing;

create or replace function public.finance_seed_refund_clearing_account()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.finance_ledger_accounts(organization_id,account_code,account_name,account_type,normal_balance,is_system_account)
 values
  (new.id,'1090','Customer Refunds Clearing','asset','debit',true),
  (new.id,'2100','Customer Credits Payable','liability','credit',true)
 on conflict(organization_id,account_code) do nothing;
 return new;
end;
$$;
revoke all on function public.finance_seed_refund_clearing_account() from public,anon,authenticated;
drop trigger if exists trg_finance_seed_refund_clearing on public.organizations;
create trigger trg_finance_seed_refund_clearing after insert on public.organizations for each row execute function public.finance_seed_refund_clearing_account();

create or replace function public.finance_post_source_journal(
 p_organization_id uuid,p_source_type text,p_source_id uuid,p_entry_date date,p_description text,p_lines jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid(); v_currency text; v_id uuid; v_existing uuid;
 v_debits numeric(20,4); v_credits numeric(20,4); v_count integer; v_line jsonb; v_n integer:=0;
 v_ledger uuid; v_financial uuid; v_debit numeric(20,4); v_credit numeric(20,4); v_key uuid;
begin
 if v_user is null or not public.is_organization_member(p_organization_id)
  or not public.has_sales_role(p_organization_id,array['owner','admin','manager','staff']::text[]) then
  raise exception 'Authenticated organisation membership is required' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||':'||p_source_type||':'||p_source_id::text,0));
 select id into v_existing from public.finance_journal_entries where organization_id=p_organization_id and source_type=p_source_type and source_id=p_source_id;
 if v_existing is not null then return v_existing; end if;
 select upper(currency) into v_currency from public.organizations where id=p_organization_id;
 if v_currency is null then raise exception 'Organisation currency is unavailable'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Journal lines are required'; end if;
 select count(*),coalesce(sum((x->>'debit')::numeric),0),coalesce(sum((x->>'credit')::numeric),0)
 into v_count,v_debits,v_credits from jsonb_array_elements(p_lines) x;
 if v_count<2 or v_count>200 or v_debits<=0 or v_debits<>v_credits then raise exception 'Source journal is not balanced'; end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x
  left join public.finance_ledger_accounts l on l.organization_id=p_organization_id and l.id=(x->>'ledger_account_id')::uuid
  left join public.finance_accounts a on a.organization_id=p_organization_id and a.id=nullif(x->>'financial_account_id','')::uuid and a.ledger_account_id=l.id
  where l.id is null or not l.is_active or (nullif(x->>'financial_account_id','') is not null and (a.id is null or not a.is_active))) then
  raise exception 'Source journal references an inactive, missing or mismatched account';
 end if;
 v_key:=md5(p_organization_id::text||':'||p_source_type||':'||p_source_id::text)::uuid;
 insert into public.finance_journal_entries(organization_id,journal_number,entry_date,description,currency_code,status,source_type,source_id,idempotency_key,created_by)
 values(p_organization_id,'JE-'||to_char(nextval('public.finance_journal_number_seq'),'FM00000000'),coalesce(p_entry_date,current_date),
  left(btrim(p_description),1000),v_currency,'draft',p_source_type,p_source_id,v_key,v_user) returning id into v_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_n:=v_n+1; v_ledger:=(v_line->>'ledger_account_id')::uuid;
  v_financial:=nullif(v_line->>'financial_account_id','')::uuid;
  v_debit:=coalesce((v_line->>'debit')::numeric,0); v_credit:=coalesce((v_line->>'credit')::numeric,0);
  if v_debit<0 or v_credit<0 or ((v_debit>0)=(v_credit>0)) then raise exception 'Invalid source journal line'; end if;
  insert into public.finance_journal_lines(organization_id,journal_entry_id,ledger_account_id,financial_account_id,line_number,description,debit,credit)
  values(p_organization_id,v_id,v_ledger,v_financial,v_n,nullif(v_line->>'description',''),v_debit,v_credit);
 end loop;
 update public.finance_journal_entries set status='posted',posted_by=v_user,posted_at=now(),updated_at=now()
 where organization_id=p_organization_id and id=v_id;
 insert into public.finance_audit_log(organization_id,actor_id,action,entity_type,entity_id,details)
 values(p_organization_id,v_user,'posted','journal_entry',v_id,jsonb_build_object('source_type',p_source_type,'source_id',p_source_id,'debits',v_debits,'credits',v_credits));
 return v_id;
end;
$$;
revoke all on function public.finance_post_source_journal(uuid,text,uuid,date,text,jsonb) from public,anon,authenticated;

create or replace function public.finance_reverse_source_journal(p_organization_id uuid,p_entry_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_user uuid:=auth.uid(); v_entry public.finance_journal_entries%rowtype; v_reversal uuid; v_key uuid;
 v_existing uuid; v_n integer:=0; v_line record;
begin
 if v_user is null or not public.is_organization_member(p_organization_id)
  or not public.has_sales_role(p_organization_id,array['owner','admin','manager','staff']::text[]) then
  raise exception 'Authenticated organisation membership is required' using errcode='42501';
 end if;
 select * into v_entry from public.finance_journal_entries where organization_id=p_organization_id and id=p_entry_id for update;
 if not found or v_entry.status not in ('posted','reversed') then raise exception 'Only posted journal entries can be reversed'; end if;
 select id into v_existing from public.finance_journal_entries where organization_id=p_organization_id and reversal_of_entry_id=p_entry_id;
 if v_existing is not null then return v_existing; end if;
 v_key:=md5(p_organization_id::text||':source_reversal:'||p_entry_id::text)::uuid;
 select id into v_existing from public.finance_journal_entries where organization_id=p_organization_id and idempotency_key=v_key;
 if v_existing is not null then return v_existing; end if;
 insert into public.finance_journal_entries(organization_id,journal_number,entry_date,description,currency_code,status,source_type,source_id,idempotency_key,created_by)
 values(p_organization_id,'JE-'||to_char(nextval('public.finance_journal_number_seq'),'FM00000000'),current_date,
  left('Reversal of '||v_entry.journal_number||': '||coalesce(p_reason,'Source adjustment'),1000),v_entry.currency_code,'draft','reversal',p_entry_id,v_key,v_user)
 returning id into v_reversal;
 for v_line in select ledger_account_id,financial_account_id,description,debit,credit
  from public.finance_journal_lines where organization_id=p_organization_id and journal_entry_id=p_entry_id order by line_number
 loop
  v_n:=v_n+1;
  insert into public.finance_journal_lines(organization_id,journal_entry_id,ledger_account_id,financial_account_id,line_number,description,debit,credit)
  values(p_organization_id,v_reversal,v_line.ledger_account_id,v_line.financial_account_id,v_n,'Reversal: '||coalesce(v_line.description,''),v_line.credit,v_line.debit);
 end loop;
 update public.finance_journal_entries set status='posted',posted_by=v_user,posted_at=now(),updated_at=now() where organization_id=p_organization_id and id=v_reversal;
 update public.finance_journal_entries set reversal_of_entry_id=p_entry_id where organization_id=p_organization_id and id=v_reversal;
 insert into public.finance_audit_log(organization_id,actor_id,action,entity_type,entity_id,details)
 values(p_organization_id,v_user,'reversed','journal_entry',p_entry_id,jsonb_build_object('reversal_entry_id',v_reversal,'reason',p_reason));
 return v_reversal;
end;
$$;
revoke all on function public.finance_reverse_source_journal(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.finance_process_source_event(p_event_id uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare
 e public.finance_source_events%rowtype; v_currency text; v_date date; v_amount numeric(20,4); v_cost numeric(20,4);
 v_debt numeric(20,4); v_refund numeric(20,4); v_ar uuid; v_revenue uuid; v_returns uuid; v_inventory uuid;
 v_cogs uuid; v_ap uuid; v_expense uuid; v_clearing uuid; v_customer_credit uuid;
 v_cash_ledger uuid; v_financial uuid; v_method uuid; v_journal uuid; v_old_journal uuid;
 v_lines jsonb:='[]'::jsonb; v_reason text; v_sale record; v_purchase record; v_exp record;
 v_sale_status text; v_refund_source text;
begin
 select * into e from public.finance_source_events where id=p_event_id for update;
 if not found then raise exception 'Finance source event not found'; end if;
 if e.status in ('posted','reversed','skipped') and e.event_type not in ('expense_void','expense_edit') then return e.status; end if;
 if auth.uid() is null or not public.is_organization_member(e.organization_id)
  or not public.has_sales_role(e.organization_id,array['owner','admin','manager','staff']::text[]) then
  raise exception 'Authenticated organisation membership is required' using errcode='42501';
 end if;
 select upper(currency) into v_currency from public.organizations where id=e.organization_id;
 select id into v_ar from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='1100' and is_active;
 select id into v_revenue from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='4000' and is_active;
 select id into v_returns from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='4010' and is_active;
 select id into v_inventory from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='1200' and is_active;
 select id into v_cogs from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='5000' and is_active;
 select id into v_ap from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='2000' and is_active;
 select id into v_expense from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='6000' and is_active;
 select id into v_clearing from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='1090' and is_active;
 select id into v_customer_credit from public.finance_ledger_accounts where organization_id=e.organization_id and account_code='2100' and is_active;

 if e.event_type in ('sale_payment','sale_refund','purchase_payment','expense','expense_edit') then
  v_method:=e.payment_method_id;
  select pm.finance_account_id,fa.ledger_account_id into v_financial,v_cash_ledger
   from public.payment_methods pm join public.finance_accounts fa on fa.organization_id=pm.organization_id and fa.id=pm.finance_account_id
   where pm.organization_id=e.organization_id and pm.id=v_method and pm.is_active and fa.is_active;
  if v_financial is null then
   update public.finance_source_events set status='pending',last_error='Map this payment method to an active financial account',updated_at=now() where id=e.id;
   return 'pending';
  end if;
 end if;

 if e.event_type='sale_completed' then
  select * into v_sale from public.sales where organization_id=e.organization_id and id=e.source_id for update;
  if not found or v_sale.status<>'completed' then
   update public.finance_source_events set status='skipped',last_error='Sale is not completed',updated_at=now() where id=e.id; return 'skipped';
  end if;
  if v_sale.currency_code<>v_currency then raise exception 'Sale currency differs from organisation base currency'; end if;
  if coalesce(v_sale.tax_amount,0)<>0 then raise exception 'Sales tax requires a configured tax liability account'; end if;
  v_amount:=v_sale.total_amount;
  if v_amount<=0 then raise exception 'Completed sale has no positive total'; end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_ar,'debit',v_amount,'credit',0,'description','Sale receivable'),
   jsonb_build_object('ledger_account_id',v_revenue,'debit',0,'credit',v_amount,'description','Sales revenue'));
  select coalesce(sum(si.quantity*si.unit_cost_snapshot),0) into v_cost
   from public.sale_items si where si.organization_id=e.organization_id and si.sale_id=e.source_id and si.product_type_snapshot='physical';
  if v_cost>0 then v_lines:=v_lines||jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_cogs,'debit',v_cost,'credit',0,'description','Cost of goods sold'),
   jsonb_build_object('ledger_account_id',v_inventory,'debit',0,'credit',v_cost,'description','Inventory relieved')); end if;
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_sale.sold_at::date,'Sale '||v_sale.sale_number,v_lines);

 elsif e.event_type='sale_payment' then
  select sp.amount,sp.paid_at,s.currency_code,s.sale_number,s.status into v_amount,v_date,v_currency,v_reason,v_sale_status
   from public.sale_payments sp join public.sales s on s.organization_id=sp.organization_id and s.id=sp.sale_id
   where sp.organization_id=e.organization_id and sp.id=e.source_id;
  if not found then raise exception 'Sale payment source not found'; end if;
  if v_currency<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Sale payment currency mismatch'; end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_cash_ledger,'financial_account_id',v_financial,'debit',v_amount,'credit',0,'description','Customer payment'),
   jsonb_build_object('ledger_account_id',case when v_sale_status='cancelled' then v_customer_credit else v_ar end,'debit',0,'credit',v_amount,'description',case when v_sale_status='cancelled' then 'Customer credit recognised' else 'Accounts receivable reduced' end));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Payment received - '||coalesce(v_reason,'Sale'),v_lines);

 elsif e.event_type='sale_refund' then
  select sr.amount,sr.refunded_at,s.currency_code,s.sale_number,sr.refund_source into v_amount,v_date,v_currency,v_reason,v_refund_source
   from public.sale_refunds sr join public.sales s on s.organization_id=sr.organization_id and s.id=sr.sale_id
   where sr.organization_id=e.organization_id and sr.id=e.source_id;
  if not found then raise exception 'Sale refund source not found'; end if;
  if v_currency<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Refund currency mismatch'; end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',case when v_refund_source='return' then v_clearing else v_customer_credit end,'debit',v_amount,'credit',0,'description','Customer refund clearing'),
   jsonb_build_object('ledger_account_id',v_cash_ledger,'financial_account_id',v_financial,'debit',0,'credit',v_amount,'description','Cash refund paid'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Customer refund - '||coalesce(v_reason,'Sale'),v_lines);

 elsif e.event_type='sales_return' then
  select sr.total_amount,sr.debt_reduced_amount,sr.refunded_amount,sr.returned_at,s.sale_number,s.currency_code
   into v_amount,v_debt,v_refund,v_date,v_reason,v_currency
   from public.sales_returns sr join public.sales s on s.organization_id=sr.organization_id and s.id=sr.sale_id
   where sr.organization_id=e.organization_id and sr.id=e.source_id;
  if not found then raise exception 'Sales return source not found'; end if;
  if v_currency<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Sales return currency mismatch'; end if;
  if round(coalesce(v_debt,0)+coalesce(v_refund,0),4)<>round(v_amount,4) then raise exception 'Return debt reduction plus cash refund does not equal the return total'; end if;
  v_lines:=jsonb_build_array(jsonb_build_object('ledger_account_id',v_returns,'debit',v_amount,'credit',0,'description','Sales return'));
  if coalesce(v_debt,0)>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_ar,'debit',0,'credit',v_debt,'description','Customer debt reduced')); end if;
  if coalesce(v_refund,0)>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('ledger_account_id',v_clearing,'debit',0,'credit',v_refund,'description','Cash refund clearing')); end if;
  select coalesce(sum(sri.restock_quantity*si.unit_cost_snapshot),0) into v_cost
   from public.sales_return_items sri join public.sale_items si on si.organization_id=sri.organization_id and si.id=sri.sale_item_id
   where sri.organization_id=e.organization_id and sri.return_id=e.source_id and sri.product_type_snapshot='physical';
  if v_cost>0 then v_lines:=v_lines||jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_inventory,'debit',v_cost,'credit',0,'description','Returned inventory restocked'),
   jsonb_build_object('ledger_account_id',v_cogs,'debit',0,'credit',v_cost,'description','Cost of goods sold reversed')); end if;
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Sales return - '||v_reason,v_lines);

 elsif e.event_type='purchase_receipt' then
  select p.id,p.currency,p.tax_amount,p.discount_amount,p.subtotal,p.purchase_number,pr.received_at into v_purchase
   from public.purchase_receipts pr join public.purchases p on p.organization_id=pr.organization_id and p.id=pr.purchase_id
   where pr.organization_id=e.organization_id and pr.id=e.source_id;
  if not found then raise exception 'Purchase receipt source not found'; end if;
  if upper(v_purchase.currency)<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Purchase currency mismatch'; end if;
  if coalesce(v_purchase.tax_amount,0)<>0 then raise exception 'Purchase tax requires a configured tax treatment before receipt posting'; end if;
  select coalesce(sum(pri.accepted_quantity*pi.unit_cost),0) into v_cost
   from public.purchase_receipt_items pri join public.purchase_items pi on pi.organization_id=pri.organization_id and pi.id=pri.purchase_item_id
   join public.product_variants pv on pv.organization_id=pi.organization_id and pv.id=pi.variant_id
   join public.products prod on prod.organization_id=pv.organization_id and prod.id=pv.product_id
   where pri.organization_id=e.organization_id and pri.receipt_id=e.source_id and prod.product_type='physical';
  if v_cost<=0 then update public.finance_source_events set status='skipped',last_error='No positively valued physical inventory accepted on this receipt',updated_at=now() where id=e.id; return 'skipped'; end if;
  if coalesce(v_purchase.subtotal,0)>0 and coalesce(v_purchase.discount_amount,0)>0 then v_cost:=v_cost-(v_cost*v_purchase.discount_amount/v_purchase.subtotal); end if;
  if v_cost<=0 then raise exception 'Receipt net inventory cost is not positive'; end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_inventory,'debit',v_cost,'credit',0,'description','Accepted inventory received'),
   jsonb_build_object('ledger_account_id',v_ap,'debit',0,'credit',v_cost,'description','Supplier payable recognised'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_purchase.received_at::date,'Goods received - '||v_purchase.purchase_number,v_lines);

 elsif e.event_type='purchase_payment' then
  select pp.amount,pp.paid_at,p.currency,p.purchase_number into v_amount,v_date,v_currency,v_reason
   from public.purchase_payments pp join public.purchases p on p.organization_id=pp.organization_id and p.id=pp.purchase_id
   where pp.organization_id=e.organization_id and pp.id=e.source_id;
  if not found then raise exception 'Supplier payment source not found'; end if;
  if upper(v_currency)<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Supplier payment currency mismatch'; end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_ap,'debit',v_amount,'credit',0,'description','Supplier payable settled'),
   jsonb_build_object('ledger_account_id',v_cash_ledger,'financial_account_id',v_financial,'debit',0,'credit',v_amount,'description','Supplier payment'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_date,'Supplier payment - '||v_reason,v_lines);

 elsif e.event_type='purchase_return' then
  select p.currency,p.discount_amount,p.subtotal,p.purchase_number,r.returned_at,p.tax_amount into v_purchase
   from public.purchase_returns r join public.purchases p on p.organization_id=r.organization_id and p.id=r.purchase_id
   where r.organization_id=e.organization_id and r.id=e.source_id and r.status='completed';
  if not found then update public.finance_source_events set status='skipped',last_error='Supplier return is not completed',updated_at=now() where id=e.id; return 'skipped'; end if;
  if upper(v_purchase.currency)<>(select upper(currency) from public.organizations where id=e.organization_id) then raise exception 'Purchase return currency mismatch'; end if;
  if coalesce(v_purchase.tax_amount,0)<>0 then raise exception 'Purchase tax requires a configured tax treatment before return posting'; end if;
  select coalesce(sum(ri.line_total),0) into v_cost from public.purchase_return_items ri where ri.organization_id=e.organization_id and ri.return_id=e.source_id;
  if coalesce(v_purchase.subtotal,0)>0 and coalesce(v_purchase.discount_amount,0)>0 then v_cost:=v_cost-(v_cost*v_purchase.discount_amount/v_purchase.subtotal); end if;
  if v_cost<=0 then raise exception 'Supplier return has no positive inventory value'; end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_ap,'debit',v_cost,'credit',0,'description','Supplier credit recognised'),
   jsonb_build_object('ledger_account_id',v_inventory,'debit',0,'credit',v_cost,'description','Inventory returned to supplier'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_purchase.returned_at::date,'Purchase return - '||v_purchase.purchase_number,v_lines);

 elsif e.event_type in ('expense','expense_edit') then
  select * into v_exp from public.expenses where organization_id=e.organization_id and id=case when e.event_type='expense' then e.source_id else (e.payload->>'expense_id')::uuid end for update;
  if not found or v_exp.status<>'recorded' then update public.finance_source_events set status='skipped',last_error='Expense is not in recorded status',updated_at=now() where id=e.id; return 'skipped'; end if;
  if upper(v_exp.currency_code)<>v_currency then raise exception 'Expense currency differs from organisation base currency'; end if;
  if e.event_type='expense_edit' then
   select se.journal_entry_id into v_old_journal from public.finance_source_events se
    where se.organization_id=e.organization_id and se.status='posted' and se.event_type in ('expense','expense_edit')
     and se.payload->>'expense_id'=v_exp.id::text order by se.created_at desc limit 1 for update;
   if v_old_journal is not null then
    v_journal:=public.finance_reverse_source_journal(e.organization_id,v_old_journal,'Expense edited: '||coalesce(v_exp.description,''));
    update public.finance_source_events set status='reversed',reversal_entry_id=v_journal,updated_at=now() where organization_id=e.organization_id and journal_entry_id=v_old_journal;
   end if;
  end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('ledger_account_id',v_expense,'debit',v_exp.amount,'credit',0,'description',v_exp.category_name_snapshot),
   jsonb_build_object('ledger_account_id',v_cash_ledger,'financial_account_id',v_financial,'debit',0,'credit',v_exp.amount,'description','Expense paid'));
  v_journal:=public.finance_post_source_journal(e.organization_id,e.event_type,e.source_id,v_exp.expense_date,'Expense '||v_exp.expense_number||' - '||v_exp.description,v_lines);

 elsif e.event_type='expense_void' then
  select * into v_exp from public.expenses where organization_id=e.organization_id and id=e.source_id for update;
  if not found or v_exp.status<>'voided' then update public.finance_source_events set status='skipped',last_error='Expense is not voided',updated_at=now() where id=e.id; return 'skipped'; end if;
  select se.journal_entry_id into v_old_journal from public.finance_source_events se
   where se.organization_id=e.organization_id and se.status='posted' and se.event_type in ('expense','expense_edit')
    and se.payload->>'expense_id'=v_exp.id::text order by se.created_at desc limit 1 for update;
  if v_old_journal is null then update public.finance_source_events set status='reversed',last_error='No posted expense entry existed; pending expense was not posted',updated_at=now() where id=e.id; return 'reversed'; end if;
  v_journal:=public.finance_reverse_source_journal(e.organization_id,v_old_journal,'Expense voided: '||coalesce(v_exp.void_reason,''));
  update public.finance_source_events set status='reversed',reversal_entry_id=v_journal,updated_at=now() where id=e.id;
  update public.finance_source_events set status='reversed',reversal_entry_id=v_journal,updated_at=now() where journal_entry_id=v_old_journal;
  return 'reversed';
 else
  raise exception 'Unsupported Finance source event type: %',e.event_type;
 end if;
 update public.finance_source_events set status='posted',journal_entry_id=v_journal,last_error=null,processed_at=now(),updated_at=now() where id=e.id;
 return 'posted';
exception when others then
 update public.finance_source_events set status='pending',last_error=left(sqlerrm,1000),updated_at=now() where id=p_event_id;
 return 'pending';
end;
$$;
revoke all on function public.finance_process_source_event(uuid) from public,anon,authenticated;

create or replace function public.finance_capture_source_event()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_type text; v_source uuid; v_org uuid; v_method uuid; v_payload jsonb:='{}'::jsonb; v_event uuid;
begin
 v_org:=new.organization_id; v_source:=new.id;
 if tg_table_name='sales' then
  if new.status<>'completed' then return new; end if;
  v_type:='sale_completed';
 elsif tg_table_name='sale_payments' then v_type:='sale_payment'; v_method:=new.payment_method_id;
 elsif tg_table_name='sale_refunds' then
  v_type:='sale_refund'; v_method:=new.payment_method_id;
  v_payload:=jsonb_build_object('refund_source',new.refund_source,'return_id',new.return_id);
 elsif tg_table_name='sales_returns' then v_type:='sales_return';
 elsif tg_table_name='purchase_receipts' then v_type:='purchase_receipt';
 elsif tg_table_name='purchase_payments' then v_type:='purchase_payment'; v_method:=new.payment_method_id;
 elsif tg_table_name='purchase_returns' then
  if new.status<>'completed' then return new; end if;
  v_type:='purchase_return';
 elsif tg_table_name='expenses' then
  if tg_op='INSERT' then
   if new.status<>'recorded' then return new; end if;
   v_type:='expense'; v_method:=new.payment_method_id; v_payload:=jsonb_build_object('expense_id',new.id);
  elsif new.status='voided' and old.status<>'voided' then
   v_type:='expense_void'; v_payload:=jsonb_build_object('expense_id',new.id);
  elsif new.status='recorded' and old.status='recorded' and
   (to_jsonb(new)-'updated_at'-'updated_by') is distinct from (to_jsonb(old)-'updated_at'-'updated_by') then
   v_type:='expense_edit'; v_method:=new.payment_method_id;
   v_source:=md5(v_org::text||':expense_edit:'||new.id::text||':'||new.updated_at::text)::uuid;
   v_payload:=jsonb_build_object('expense_id',new.id);
  else return new;
  end if;
 else return new;
 end if;
 if v_method is not null then v_payload:=v_payload||jsonb_build_object('payment_method_id',v_method); end if;
 insert into public.finance_source_events(organization_id,event_type,source_id,payment_method_id,payload,created_by)
 values(v_org,v_type,v_source,v_method,v_payload,auth.uid()) on conflict(organization_id,event_type,source_id) do nothing returning id into v_event;
 if v_event is null then select id into v_event from public.finance_source_events where organization_id=v_org and event_type=v_type and source_id=v_source; end if;
 perform public.finance_process_source_event(v_event);
 return new;
exception when others then
 if v_org is not null and v_type is not null and v_source is not null then
  insert into public.finance_source_events(organization_id,event_type,source_id,payment_method_id,payload,created_by,status,last_error)
  values(v_org,v_type,v_source,v_method,v_payload,auth.uid(),'pending',left(sqlerrm,1000))
  on conflict(organization_id,event_type,source_id) do update set status='pending',last_error=left(sqlerrm,1000),updated_at=now()
  where public.finance_source_events.status<>'posted';
 end if;
 return new;
end;
$$;
revoke all on function public.finance_capture_source_event() from public,anon,authenticated;

create or replace function public.finance_retry_payment_method_events()
returns trigger language plpgsql security definer set search_path=''
as $$
declare r record;
begin
 if new.finance_account_id is not distinct from old.finance_account_id then return new; end if;
 if auth.uid() is null or not public.has_sales_role(new.organization_id,array['owner','admin','manager']::text[]) then
  raise exception 'Only organisation owners, admins and managers can change Finance mappings' using errcode='42501';
 end if;
 for r in select id from public.finance_source_events where organization_id=new.organization_id and payment_method_id=new.id and status='pending' order by created_at,id for update
 loop perform public.finance_process_source_event(r.id); end loop;
 return new;
end;
$$;
revoke all on function public.finance_retry_payment_method_events() from public,anon,authenticated;

create or replace function public.finance_on_sale_cancelled()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_event uuid; v_old_entry uuid; v_reversal uuid; v_credit_entry uuid; v_paid numeric(20,4); v_ar uuid; v_customer_credit uuid; v_lines jsonb;
begin
 if old.status is distinct from 'completed' or new.status is distinct from 'cancelled' then return new; end if;
 if auth.uid() is null or not public.is_organization_member(new.organization_id) or not public.has_sales_role(new.organization_id,array['owner','admin','manager']::text[]) then
  raise exception 'Only authorised organisation managers can post sale cancellations' using errcode='42501';
 end if;
 insert into public.finance_source_events(organization_id,event_type,source_id,payload,created_by)
 values(new.organization_id,'sale_cancelled',new.id,jsonb_build_object('reason',new.cancellation_reason),auth.uid())
 on conflict(organization_id,event_type,source_id) do nothing returning id into v_event;
 if v_event is null then
  select id into v_event from public.finance_source_events where organization_id=new.organization_id and event_type='sale_cancelled' and source_id=new.id for update;
  if exists(select 1 from public.finance_source_events where id=v_event and status='reversed') then return new; end if;
 end if;
 select journal_entry_id into v_old_entry from public.finance_source_events where organization_id=new.organization_id and event_type='sale_completed' and source_id=new.id and status='posted' for update;
 if v_old_entry is null then update public.finance_source_events set status='skipped',last_error='No original posted sale journal exists to reverse',updated_at=now() where id=v_event; return new; end if;
 v_reversal:=public.finance_reverse_source_journal(new.organization_id,v_old_entry,'Sale cancelled: '||coalesce(new.cancellation_reason,''));
 update public.finance_source_events set status='reversed',reversal_entry_id=v_reversal,updated_at=now() where organization_id=new.organization_id and event_type='sale_completed' and source_id=new.id;
 select coalesce(sum(sp.amount),0) into v_paid from public.sale_payments sp join public.finance_source_events se
  on se.organization_id=sp.organization_id and se.event_type='sale_payment' and se.source_id=sp.id and se.status='posted'
  where sp.organization_id=new.organization_id and sp.sale_id=new.id;
 if v_paid>0 then
  select id into v_ar from public.finance_ledger_accounts where organization_id=new.organization_id and account_code='1100' and is_active;
  select id into v_customer_credit from public.finance_ledger_accounts where organization_id=new.organization_id and account_code='2100' and is_active;
  v_lines:=jsonb_build_array(jsonb_build_object('ledger_account_id',v_ar,'debit',v_paid,'credit',0,'description','Reclassify paid cancelled sale'),
   jsonb_build_object('ledger_account_id',v_customer_credit,'debit',0,'credit',v_paid,'description','Customer credit payable'));
  v_credit_entry:=public.finance_post_source_journal(new.organization_id,'sale_cancelled_credit',new.id,current_date,'Customer credit for cancelled sale '||new.sale_number,v_lines);
 end if;
 update public.finance_source_events set status='reversed',reversal_entry_id=v_reversal,journal_entry_id=v_credit_entry,processed_at=now(),updated_at=now() where id=v_event;
 return new;
end;
$$;
revoke all on function public.finance_on_sale_cancelled() from public,anon,authenticated;

create or replace function public.finance_get_source_status(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.is_organization_member(p_organization_id) or not public.has_sales_role(p_organization_id,array['owner','admin','manager']::text[]) then
  raise exception 'Not authorised to view Finance reconciliation' using errcode='42501';
 end if;
 select jsonb_build_object(
  'posted',count(*) filter(where status='posted'),'pending',count(*) filter(where status='pending'),
  'reversed',count(*) filter(where status='reversed'),'skipped',count(*) filter(where status='skipped'),
  'events',coalesce(jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'source_id',source_id,'status',status,
   'last_error',last_error,'created_at',created_at,'journal_entry_id',journal_entry_id) order by created_at desc)
   filter(where status in ('pending','skipped')),'[]'::jsonb))
 into v_result from public.finance_source_events where organization_id=p_organization_id;
 return coalesce(v_result,jsonb_build_object('posted',0,'pending',0,'reversed',0,'skipped',0,'events','[]'::jsonb));
end;
$$;
revoke all on function public.finance_get_source_status(uuid) from public,anon;
grant execute on function public.finance_get_source_status(uuid) to authenticated;

drop trigger if exists trg_finance_sales_post on public.sales;
create constraint trigger trg_finance_sales_post after insert or update of status on public.sales deferrable initially deferred for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_sale_payments_post on public.sale_payments;
create trigger trg_finance_sale_payments_post after insert on public.sale_payments for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_sale_refunds_post on public.sale_refunds;
create trigger trg_finance_sale_refunds_post after insert on public.sale_refunds for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_sales_returns_post on public.sales_returns;
create constraint trigger trg_finance_sales_returns_post after insert or update on public.sales_returns deferrable initially deferred for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_purchase_receipts_post on public.purchase_receipts;
create constraint trigger trg_finance_purchase_receipts_post after insert on public.purchase_receipts deferrable initially deferred for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_purchase_payments_post on public.purchase_payments;
create trigger trg_finance_purchase_payments_post after insert on public.purchase_payments for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_purchase_returns_post on public.purchase_returns;
create constraint trigger trg_finance_purchase_returns_post after update of status on public.purchase_returns deferrable initially deferred for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_expenses_post on public.expenses;
create trigger trg_finance_expenses_post after insert or update on public.expenses for each row execute function public.finance_capture_source_event();
drop trigger if exists trg_finance_retry_mapped_events on public.payment_methods;
create trigger trg_finance_retry_mapped_events after update of finance_account_id on public.payment_methods for each row execute function public.finance_retry_payment_method_events();
drop trigger if exists trg_finance_sale_cancelled on public.sales;
create trigger trg_finance_sale_cancelled after update of status on public.sales for each row execute function public.finance_on_sale_cancelled();

revoke all on function public.finance_create_account(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.finance_create_account(uuid,text,text,text,text,uuid) to authenticated;
revoke all on function public.finance_update_account(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.finance_update_account(uuid,uuid,text,text,text) to authenticated;
revoke all on function public.finance_set_account_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.finance_set_account_active(uuid,uuid,boolean) to authenticated;
revoke all on function public.finance_opening_balance(uuid,uuid,numeric,date,uuid) from public,anon;
grant execute on function public.finance_opening_balance(uuid,uuid,numeric,date,uuid) to authenticated;
revoke all on function public.finance_transfer(uuid,uuid,uuid,numeric,date,text,uuid) from public,anon;
grant execute on function public.finance_transfer(uuid,uuid,uuid,numeric,date,text,uuid) to authenticated;
revoke all on function public.finance_cash_movement(uuid,uuid,uuid,numeric,text,date,text,uuid) from public,anon;
grant execute on function public.finance_cash_movement(uuid,uuid,uuid,numeric,text,date,text,uuid) to authenticated;
revoke all on function public.finance_create_ledger_account(uuid,text,text,text,text) from public,anon;
grant execute on function public.finance_create_ledger_account(uuid,text,text,text,text) to authenticated;
revoke all on function public.finance_get_balances(uuid,date,date) from public,anon;
grant execute on function public.finance_get_balances(uuid,date,date) to authenticated;
revoke all on function public.finance_map_payment_method(uuid,uuid,uuid) from public,anon;
grant execute on function public.finance_map_payment_method(uuid,uuid,uuid) to authenticated;
revoke all on function public.finance_post_journal(uuid,date,text,text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.finance_post_journal(uuid,date,text,text,uuid,uuid,jsonb) to authenticated;
revoke all on function public.finance_reverse_journal(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.finance_reverse_journal(uuid,uuid,text,uuid) to authenticated;

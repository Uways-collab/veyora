-- Fail safely instead of posting incomplete inventory valuation when cost snapshots
-- or non-inventory receipt treatments are missing.
do $$
declare d text;
begin
 d:=pg_get_functiondef('public.finance_process_source_event(uuid)'::regprocedure);
 d:=replace(d,
  'select coalesce(sum(si.quantity*si.unit_cost_snapshot),0) into v_cost',
  'if exists(select 1 from public.sale_items si where si.organization_id=e.organization_id and si.sale_id=e.source_id and si.product_type_snapshot=''physical'' and (si.unit_cost_snapshot is null or si.unit_cost_snapshot<=0)) then raise exception ''Physical sale item is missing a reliable cost snapshot''; end if;'||chr(10)||
  '  select coalesce(sum(si.quantity*si.unit_cost_snapshot),0) into v_cost');
 d:=replace(d,
  'select coalesce(sum(sri.restock_quantity*si.unit_cost_snapshot),0) into v_cost',
  'if exists(select 1 from public.sales_return_items sri join public.sale_items si on si.organization_id=sri.organization_id and si.id=sri.sale_item_id where sri.organization_id=e.organization_id and sri.return_id=e.source_id and sri.product_type_snapshot=''physical'' and sri.restock_quantity>0 and (si.unit_cost_snapshot is null or si.unit_cost_snapshot<=0)) then raise exception ''Restocked sale return item is missing its original cost snapshot''; end if;'||chr(10)||
  '  select coalesce(sum(sri.restock_quantity*si.unit_cost_snapshot),0) into v_cost');
 execute d;

 d:=pg_get_functiondef('public.finance_process_purchase_source_event(uuid)'::regprocedure);
 d:=replace(d,
  'select coalesce(sum(pri.accepted_quantity*pi.unit_cost),0) into v_cost',
  'if exists(select 1 from public.purchase_receipt_items pri join public.purchase_items pi on pi.organization_id=pri.organization_id and pi.id=pri.purchase_item_id join public.product_variants pv on pv.organization_id=pi.organization_id and pv.id=pi.variant_id join public.products prod on prod.organization_id=pv.organization_id and prod.id=pv.product_id where pri.organization_id=e.organization_id and pri.receipt_id=e.source_id and pri.accepted_quantity>0 and prod.product_type<>''physical'') then raise exception ''Non-inventory receipt lines require an expense treatment before posting''; end if;'||chr(10)||
  '  if exists(select 1 from public.purchase_receipt_items pri join public.purchase_items pi on pi.organization_id=pri.organization_id and pi.id=pri.purchase_item_id join public.product_variants pv on pv.organization_id=pi.organization_id and pv.id=pi.variant_id join public.products prod on prod.organization_id=pv.organization_id and prod.id=pv.product_id where pri.organization_id=e.organization_id and pri.receipt_id=e.source_id and pri.accepted_quantity>0 and prod.product_type=''physical'' and (pi.unit_cost is null or pi.unit_cost<=0)) then raise exception ''Received physical inventory is missing a reliable positive unit cost''; end if;'||chr(10)||
  '  select coalesce(sum(pri.accepted_quantity*pi.unit_cost),0) into v_cost');
 d:=replace(d,
  'select coalesce(sum(ri.line_total),0) into v_cost from public.purchase_return_items ri',
  'if exists(select 1 from public.purchase_return_items ri where ri.organization_id=e.organization_id and ri.return_id=e.source_id and (ri.line_total is null or ri.line_total<=0)) then raise exception ''Supplier return line is missing a reliable positive cost''; end if;'||chr(10)||
  '  select coalesce(sum(ri.line_total),0) into v_cost from public.purchase_return_items ri');
 execute d;
end $$;

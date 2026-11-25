create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;

alter function public.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) set schema private;
alter function public.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) set schema private;
alter function public.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) set schema private;

revoke all on function private.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon,authenticated;
revoke all on function private.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) from public,anon,authenticated;
revoke all on function private.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) from public,anon,authenticated;
grant execute on function private.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) to authenticated;
grant execute on function private.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) to authenticated;
grant execute on function private.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) to authenticated;

create or replace function public.invoice_scanner_create_product_variant(
  p_organization_id uuid,p_scan_id uuid,p_product_name text,p_description text,
  p_variant_name text,p_sku text,p_barcode text,p_unit_of_measure text,
  p_cost_price numeric,p_selling_price numeric,p_attributes jsonb
) returns uuid language sql security invoker set search_path = ''
as $function$
  select private.invoice_scanner_create_product_variant(
    p_organization_id,p_scan_id,p_product_name,p_description,p_variant_name,
    p_sku,p_barcode,p_unit_of_measure,p_cost_price,p_selling_price,p_attributes
  );
$function$;

create or replace function public.invoice_scanner_apply_selling_price(
  p_organization_id uuid,p_scan_id uuid,p_variant_id uuid,p_selling_price numeric,
  p_pricing_method text,p_target_percent numeric
) returns jsonb language sql security invoker set search_path = ''
as $function$
  select private.invoice_scanner_apply_selling_price(
    p_organization_id,p_scan_id,p_variant_id,p_selling_price,p_pricing_method,p_target_percent
  );
$function$;

create or replace function public.invoice_scanner_create_purchase_draft(
  p_organization_id uuid,p_scan_id uuid,p_reviewed_data jsonb,p_supplier_id uuid,
  p_items jsonb,p_discount_amount numeric,p_tax_amount numeric,
  p_supplier_invoice_number text,p_expected_delivery_date date,p_due_date date,
  p_invoice_date date,p_grand_total numeric,p_delivery_charges numeric,
  p_allow_possible_duplicate boolean,p_currency text,p_notes text
) returns uuid language sql security invoker set search_path = ''
as $function$
  select private.invoice_scanner_create_purchase_draft(
    p_organization_id,p_scan_id,p_reviewed_data,p_supplier_id,p_items,
    p_discount_amount,p_tax_amount,p_supplier_invoice_number,p_expected_delivery_date,
    p_due_date,p_invoice_date,p_grand_total,p_delivery_charges,
    p_allow_possible_duplicate,p_currency,p_notes
  );
$function$;

revoke all on function public.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon;
revoke all on function public.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) from public,anon;
revoke all on function public.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) from public,anon;
grant execute on function public.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) to authenticated;
grant execute on function public.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) to authenticated;
grant execute on function public.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) to authenticated;

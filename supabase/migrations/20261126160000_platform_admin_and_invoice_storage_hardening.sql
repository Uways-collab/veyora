-- Harden invoice document storage against subscription expiry and add a private platform-admin audit trail.
-- No existing business rows are changed.

create table if not exists public.platform_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('user_access_disabled', 'user_access_restored')),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists platform_admin_audit_logs_created_at_idx
  on public.platform_admin_audit_logs (created_at desc);
create index if not exists platform_admin_audit_logs_target_user_idx
  on public.platform_admin_audit_logs (target_user_id, created_at desc);

alter table public.platform_admin_audit_logs enable row level security;
revoke all on table public.platform_admin_audit_logs from public, anon, authenticated;
grant all on table public.platform_admin_audit_logs to service_role;

-- A private invoice bucket is not enough by itself: its object policies must also
-- enforce the same invoice-scanner subscription entitlement as invoice_scans.
drop policy if exists invoice_documents_read_managers on storage.objects;
create policy invoice_documents_read_managers
on storage.objects for select to authenticated
using (
  bucket_id = 'invoice-documents'
  and (storage.foldername(name))[2] = 'invoices'
  and public.has_inventory_role((storage.foldername(name))[1]::uuid, array['owner','admin','manager']::text[])
  and private.organization_has_access((storage.foldername(name))[1]::uuid, 'invoice_scanner')
);

drop policy if exists invoice_documents_upload_managers on storage.objects;
create policy invoice_documents_upload_managers
on storage.objects for insert to authenticated
with check (
  bucket_id = 'invoice-documents'
  and (storage.foldername(name))[2] = 'invoices'
  and public.has_inventory_role((storage.foldername(name))[1]::uuid, array['owner','admin','manager']::text[])
  and private.organization_has_access((storage.foldername(name))[1]::uuid, 'invoice_scanner')
  and (
    lower(coalesce(metadata ->> 'mimetype', '')) not like 'image/%'
    or (
      coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
      and (metadata ->> 'size')::bigint <= 102400
    )
  )
);


-- Close the direct-RPC path around the invoice-scanner feature entitlement.
-- The private SECURITY DEFINER implementations are callable only through
-- these authenticated wrappers, which verify the dedicated feature entitlement.
revoke all on function private.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon,authenticated;
revoke all on function private.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) from public,anon,authenticated;
revoke all on function private.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) from public,anon,authenticated;

create or replace function public.invoice_scanner_create_product_variant(
  p_organization_id uuid,p_scan_id uuid,p_product_name text,p_description text,
  p_variant_name text,p_sku text,p_barcode text,p_unit_of_measure text,
  p_cost_price numeric,p_selling_price numeric,p_attributes jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.organization_has_access(p_organization_id,'invoice_scanner') then
    raise exception 'Invoice scanning is not included in the active workspace subscription'
      using errcode='42501';
  end if;
  return private.invoice_scanner_create_product_variant(
    p_organization_id,p_scan_id,p_product_name,p_description,p_variant_name,
    p_sku,p_barcode,p_unit_of_measure,p_cost_price,p_selling_price,p_attributes
  );
end;
$function$;

create or replace function public.invoice_scanner_apply_selling_price(
  p_organization_id uuid,p_scan_id uuid,p_variant_id uuid,p_selling_price numeric,
  p_pricing_method text,p_target_percent numeric
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.organization_has_access(p_organization_id,'invoice_scanner') then
    raise exception 'Invoice scanning is not included in the active workspace subscription'
      using errcode='42501';
  end if;
  return private.invoice_scanner_apply_selling_price(
    p_organization_id,p_scan_id,p_variant_id,p_selling_price,p_pricing_method,p_target_percent
  );
end;
$function$;

create or replace function public.invoice_scanner_create_purchase_draft(
  p_organization_id uuid,p_scan_id uuid,p_reviewed_data jsonb,p_supplier_id uuid,
  p_items jsonb,p_discount_amount numeric,p_tax_amount numeric,
  p_supplier_invoice_number text,p_expected_delivery_date date,p_due_date date,
  p_invoice_date date,p_grand_total numeric,p_delivery_charges numeric,
  p_allow_possible_duplicate boolean,p_currency text,p_notes text
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not private.organization_has_access(p_organization_id,'invoice_scanner') then
    raise exception 'Invoice scanning is not included in the active workspace subscription'
      using errcode='42501';
  end if;
  return private.invoice_scanner_create_purchase_draft(
    p_organization_id,p_scan_id,p_reviewed_data,p_supplier_id,p_items,
    p_discount_amount,p_tax_amount,p_supplier_invoice_number,p_expected_delivery_date,
    p_due_date,p_invoice_date,p_grand_total,p_delivery_charges,
    p_allow_possible_duplicate,p_currency,p_notes
  );
end;
$function$;

revoke all on function public.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon;
revoke all on function public.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) from public,anon;
revoke all on function public.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) from public,anon;
grant execute on function public.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb) to authenticated;
grant execute on function public.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric) to authenticated;
grant execute on function public.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text) to authenticated;

-- Audit metadata is sensitive invoice data, so it follows the invoice feature gate.
drop policy if exists invoice_scan_audit_select_managers on public.invoice_scan_audit_logs;
create policy invoice_scan_audit_select_managers on public.invoice_scan_audit_logs
for select to authenticated
using (
  public.has_inventory_role(organization_id,array['owner','admin','manager']::text[])
  and private.organization_has_access(organization_id,'invoice_scanner')
);

-- Platform-admin audit and invoice document subscription-gate contract.
-- Catalog assertions only; does not mutate business records or Auth users.
do $$
declare
  v_read text;
  v_upload text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='platform_admin_audit_logs' and c.relrowsecurity
  ) then raise exception 'FAIL: platform admin audit RLS is not enabled'; end if;

  if has_table_privilege('anon','public.platform_admin_audit_logs','select')
     or has_table_privilege('authenticated','public.platform_admin_audit_logs','select')
     or has_table_privilege('authenticated','public.platform_admin_audit_logs','insert')
     or has_table_privilege('authenticated','public.platform_admin_audit_logs','update')
     or has_table_privilege('authenticated','public.platform_admin_audit_logs','delete')
     or not has_table_privilege('service_role','public.platform_admin_audit_logs','insert')
     or not has_table_privilege('service_role','public.platform_admin_audit_logs','select') then
    raise exception 'FAIL: platform-admin audit log must be service-role-only'; end if;

  select qual into v_read from pg_policies
  where schemaname='storage' and tablename='objects' and policyname='invoice_documents_read_managers';
  if v_read is null or position('organization_has_access' in v_read)=0
     or position('invoice_scanner' in v_read)=0 then
    raise exception 'FAIL: invoice document reads must enforce invoice-scanner subscription entitlement'; end if;

  select with_check into v_upload from pg_policies
  where schemaname='storage' and tablename='objects' and policyname='invoice_documents_upload_managers';
  if v_upload is null or position('organization_has_access' in v_upload)=0
     or position('invoice_scanner' in v_upload)=0
     or position('102400' in v_upload)=0 then
    raise exception 'FAIL: invoice document uploads must enforce entitlement and 100 KB image limit'; end if;


  if has_function_privilege('authenticated','private.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb)','execute')
     or has_function_privilege('authenticated','private.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric)','execute')
     or has_function_privilege('authenticated','private.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text)','execute') then
    raise exception 'FAIL: private invoice scanner implementation functions must not be directly executable by clients'; end if;

  if not has_function_privilege('authenticated','public.invoice_scanner_create_product_variant(uuid,uuid,text,text,text,text,text,text,numeric,numeric,jsonb)','execute')
     or not has_function_privilege('authenticated','public.invoice_scanner_apply_selling_price(uuid,uuid,uuid,numeric,text,numeric)','execute')
     or not has_function_privilege('authenticated','public.invoice_scanner_create_purchase_draft(uuid,uuid,jsonb,uuid,jsonb,numeric,numeric,text,date,date,date,numeric,numeric,boolean,text,text)','execute') then
    raise exception 'FAIL: authenticated invoice scanner wrappers must remain executable'; end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='invoice_scan_audit_logs'
      and policyname='invoice_scan_audit_select_managers'
      and position('organization_has_access' in qual)>0
      and position('invoice_scanner' in qual)>0
  ) then raise exception 'FAIL: invoice scan audit reads must enforce invoice-scanner entitlement'; end if;

  if position('banned_until' in pg_get_functiondef('private.organization_has_access(uuid,text)'::regprocedure)) = 0 then
    raise exception 'FAIL: suspended Auth users must be denied by the central organisation entitlement helper'; end if;

  raise notice 'PASS: platform-admin audit data is service-role-only; invoice object read/upload enforce invoice-scanner entitlement and image-size ceiling';
end $$;

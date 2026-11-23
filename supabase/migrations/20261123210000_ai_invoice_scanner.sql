-- AI supplier invoice scanning: private documents, tenant-scoped scan records,
-- duplicate invoice claims, and atomic hand-off to the existing purchase workflow.

create table if not exists public.invoice_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  file_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','ready','linked','failed','cancelled')),
  extracted_data jsonb not null default '{}'::jsonb,
  error_message text,
  purchase_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_scans_org_id_unique unique (organization_id,id),
  constraint invoice_scans_purchase_fk
    foreign key (organization_id,purchase_id)
    references public.purchases(organization_id,id)
);

create index if not exists invoice_scans_org_created_idx
  on public.invoice_scans(organization_id,created_at desc);
create index if not exists invoice_scans_org_status_idx
  on public.invoice_scans(organization_id,status);

alter table public.invoice_scans enable row level security;

drop policy if exists invoice_scans_select_managers on public.invoice_scans;
create policy invoice_scans_select_managers on public.invoice_scans
for select to authenticated
using (public.has_inventory_role(organization_id,array['owner','admin','manager']::text[]));

drop policy if exists invoice_scans_insert_managers on public.invoice_scans;
create policy invoice_scans_insert_managers on public.invoice_scans
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and public.has_inventory_role(organization_id,array['owner','admin','manager']::text[])
);

drop policy if exists invoice_scans_update_managers on public.invoice_scans;
create policy invoice_scans_update_managers on public.invoice_scans
for update to authenticated
using (public.has_inventory_role(organization_id,array['owner','admin','manager']::text[]))
with check (public.has_inventory_role(organization_id,array['owner','admin','manager']::text[]));

-- A unique claim closes concurrent duplicate-scanner requests without imposing
-- a risky unique index on historical purchase rows that have not been audited.
create table if not exists public.purchase_invoice_number_claims (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id uuid not null,
  invoice_number_key text not null,
  purchase_id uuid,
  created_at timestamptz not null default now(),
  primary key (organization_id,supplier_id,invoice_number_key),
  constraint purchase_invoice_claim_supplier_fk
    foreign key (organization_id,supplier_id)
    references public.suppliers(organization_id,id),
  constraint purchase_invoice_claim_purchase_fk
    foreign key (organization_id,purchase_id)
    references public.purchases(organization_id,id)
);

alter table public.purchase_invoice_number_claims enable row level security;
drop policy if exists purchase_invoice_claims_select_managers on public.purchase_invoice_number_claims;
create policy purchase_invoice_claims_select_managers on public.purchase_invoice_number_claims
for select to authenticated
using (public.has_inventory_role(organization_id,array['owner','admin','manager']::text[]));

alter table public.purchases
  add column if not exists invoice_document_path text,
  add column if not exists supplier_invoice_date date;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'invoice-documents',
  'invoice-documents',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists invoice_documents_read_managers on storage.objects;
create policy invoice_documents_read_managers on storage.objects
for select to authenticated
using (
  bucket_id = 'invoice-documents'
  and (storage.foldername(name))[2] = 'invoices'
  and public.has_inventory_role(((storage.foldername(name))[1])::uuid,array['owner','admin','manager']::text[])
);

drop policy if exists invoice_documents_upload_managers on storage.objects;
create policy invoice_documents_upload_managers on storage.objects
for insert to authenticated
with check (
  bucket_id = 'invoice-documents'
  and (storage.foldername(name))[2] = 'invoices'
  and public.has_inventory_role(((storage.foldername(name))[1])::uuid,array['owner','admin','manager']::text[])
);

drop policy if exists invoice_documents_delete_managers on storage.objects;
create policy invoice_documents_delete_managers on storage.objects
for delete to authenticated
using (
  bucket_id = 'invoice-documents'
  and (storage.foldername(name))[2] = 'invoices'
  and public.has_inventory_role(((storage.foldername(name))[1])::uuid,array['owner','admin','manager']::text[])
);


-- Enforce invoice-number claims for every purchase-creation path, not only the scanner.
create or replace function public.enforce_purchase_invoice_number_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_claimed_purchase_id uuid;
  v_rows integer;
begin
  if tg_op = 'UPDATE' and new.status = 'cancelled' then
    delete from public.purchase_invoice_number_claims
    where organization_id=old.organization_id
      and supplier_id=old.supplier_id
      and invoice_number_key=lower(btrim(coalesce(old.supplier_invoice_number,'')))
      and purchase_id=old.id;
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    old.supplier_id is distinct from new.supplier_id
    or old.supplier_invoice_number is distinct from new.supplier_invoice_number
  ) then
    delete from public.purchase_invoice_number_claims
    where organization_id=old.organization_id
      and supplier_id=old.supplier_id
      and invoice_number_key=lower(btrim(coalesce(old.supplier_invoice_number,'')))
      and purchase_id=old.id;
  end if;

  if new.status = 'cancelled' or nullif(btrim(new.supplier_invoice_number),'') is null then
    return new;
  end if;

  v_key := lower(btrim(new.supplier_invoice_number));
  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || ':' || new.supplier_id::text || ':' || v_key,0
  ));

  if exists (
    select 1 from public.purchases p
    where p.organization_id=new.organization_id
      and p.supplier_id=new.supplier_id
      and p.id <> new.id
      and p.status <> 'cancelled'
      and lower(btrim(coalesce(p.supplier_invoice_number,'')))=v_key
  ) then
    raise exception 'A purchase with this supplier invoice number already exists'
      using errcode = '23505';
  end if;

  insert into public.purchase_invoice_number_claims(
    organization_id,supplier_id,invoice_number_key,purchase_id
  ) values (new.organization_id,new.supplier_id,v_key,new.id)
  on conflict (organization_id,supplier_id,invoice_number_key)
  do update set purchase_id=excluded.purchase_id
  where public.purchase_invoice_number_claims.purchase_id is null
     or public.purchase_invoice_number_claims.purchase_id=excluded.purchase_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'A purchase with this supplier invoice number is already claimed'
      using errcode = '23505';
  end if;
  return new;
end;
$function$;

drop trigger if exists purchases_invoice_number_claim_guard on public.purchases;
create trigger purchases_invoice_number_claim_guard
after insert or update of supplier_id,supplier_invoice_number,status
on public.purchases
for each row execute function public.enforce_purchase_invoice_number_claim();

create or replace function public.invoice_scanner_create_product_variant(
  p_organization_id uuid,
  p_product_name text,
  p_description text,
  p_variant_name text,
  p_sku text,
  p_barcode text,
  p_unit_of_measure text,
  p_cost_price numeric,
  p_selling_price numeric,
  p_attributes jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product_id uuid;
  v_variant_id uuid;
begin
  if auth.uid() is null or not public.has_inventory_role(
    p_organization_id,array['owner','admin','manager']::text[]
  ) then
    raise exception 'You are not authorised to create products in this organisation'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_product_name),'') is null
     or nullif(btrim(p_variant_name),'') is null
     or nullif(btrim(p_unit_of_measure),'') is null
     or nullif(btrim(p_sku),'') is null
     or p_cost_price is null or p_cost_price < 0
     or p_selling_price is null or p_selling_price < 0 then
    raise exception 'Product name, variant, unit and valid prices are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':sku:' || lower(btrim(p_sku)),0));
  if nullif(btrim(p_sku),'') is not null and exists (
    select 1 from public.product_variants
    where organization_id=p_organization_id and lower(sku)=lower(btrim(p_sku))
  ) then raise exception 'That SKU already exists in this organisation'; end if;
  if nullif(btrim(p_barcode),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':barcode:' || btrim(p_barcode),0));
  end if;
  if nullif(btrim(p_barcode),'') is not null and exists (
    select 1 from public.product_variants
    where organization_id=p_organization_id and barcode=btrim(p_barcode)
  ) then raise exception 'That barcode already exists in this organisation'; end if;

  insert into public.products(organization_id,name,description,product_type,is_active)
  values(p_organization_id,btrim(p_product_name),nullif(btrim(p_description),''),'physical',true)
  returning id into v_product_id;

  insert into public.product_variants(
    organization_id,product_id,variant_name,sku,barcode,unit_of_measure,
    cost_price,selling_price,attributes,is_active
  ) values (
    p_organization_id,v_product_id,btrim(p_variant_name),
    nullif(btrim(p_sku),''),nullif(btrim(p_barcode),''),
    btrim(p_unit_of_measure),p_cost_price,p_selling_price,
    coalesce(p_attributes,'{}'::jsonb),true
  ) returning id into v_variant_id;
  return v_variant_id;
end;
$function$;

revoke all on function public.invoice_scanner_create_product_variant(uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon;
grant execute on function public.invoice_scanner_create_product_variant(uuid,text,text,text,text,text,text,numeric,numeric,jsonb) to authenticated;

create or replace function public.invoice_scanner_create_purchase_draft(
  p_organization_id uuid,
  p_scan_id uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_supplier_invoice_number text,
  p_expected_delivery_date date,
  p_due_date date,
  p_invoice_date date,
  p_currency text,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scan public.invoice_scans%rowtype;
  v_currency text;
  v_invoice_key text;
  v_purchase_id uuid;
begin
  if auth.uid() is null or not public.has_inventory_role(
    p_organization_id,array['owner','admin','manager']::text[]
  ) then
    raise exception 'You are not authorised to create purchases in this organisation'
      using errcode = '42501';
  end if;

  select * into v_scan
  from public.invoice_scans
  where id=p_scan_id and organization_id=p_organization_id
  for update;
  if not found or v_scan.status <> 'ready' or v_scan.purchase_id is not null then
    raise exception 'Invoice scan is not ready to create a purchase';
  end if;

  select upper(currency) into v_currency
  from public.organizations where id=p_organization_id;
  if v_currency is null then raise exception 'Organisation currency is not configured'; end if;
  if upper(coalesce(p_currency,'')) <> v_currency then
    raise exception 'Invoice currency differs from the organisation currency. Resolve the currency difference before creating this purchase.';
  end if;

  if nullif(btrim(p_supplier_invoice_number),'') is not null then
    v_invoice_key := lower(btrim(p_supplier_invoice_number));
    perform pg_advisory_xact_lock(hashtextextended(
      p_organization_id::text || ':' || p_supplier_id::text || ':' || v_invoice_key,0
    ));
    if exists (
      select 1 from public.purchases p
      where p.organization_id=p_organization_id
        and p.supplier_id=p_supplier_id
        and lower(btrim(coalesce(p.supplier_invoice_number,'')))=v_invoice_key
        and p.status <> 'cancelled'
    ) or exists (
      select 1 from public.purchase_invoice_number_claims c
      where c.organization_id=p_organization_id
        and c.supplier_id=p_supplier_id
        and c.invoice_number_key=v_invoice_key
    ) then
      raise exception 'A purchase with this supplier invoice number already exists. Review the possible duplicate before continuing.';
    end if;
    insert into public.purchase_invoice_number_claims(
      organization_id,supplier_id,invoice_number_key
    ) values (p_organization_id,p_supplier_id,v_invoice_key);
  end if;

  v_purchase_id := public.purchases_v1_create_draft(
    p_organization_id,
    p_supplier_id,
    p_items,
    coalesce(p_discount_amount,0),
    coalesce(p_tax_amount,0),
    p_supplier_invoice_number,
    p_expected_delivery_date,
    p_notes
  );

  update public.purchases
  set invoice_document_path=v_scan.file_path,
      supplier_invoice_date=p_invoice_date,
      due_date=coalesce(p_due_date,due_date),
      updated_at=now()
  where id=v_purchase_id and organization_id=p_organization_id;

  update public.purchase_invoice_number_claims
  set purchase_id=v_purchase_id
  where organization_id=p_organization_id
    and supplier_id=p_supplier_id
    and invoice_number_key=v_invoice_key;

  update public.invoice_scans
  set status='linked',purchase_id=v_purchase_id,updated_at=now()
  where id=p_scan_id and organization_id=p_organization_id;

  insert into public.purchase_audit_logs(
    organization_id,purchase_id,entity_type,entity_id,action,
    old_values,new_values,performed_by
  ) values (
    p_organization_id,v_purchase_id,'invoice_scan',p_scan_id,
    'invoice_attached','{}'::jsonb,
    jsonb_build_object('file_path',v_scan.file_path,'scan_id',p_scan_id),
    auth.uid()
  );
  return v_purchase_id;
end;
$function$;

revoke all on function public.invoice_scanner_create_purchase_draft(uuid,uuid,uuid,jsonb,numeric,numeric,text,date,date,date,text,text) from public,anon;
grant execute on function public.invoice_scanner_create_purchase_draft(uuid,uuid,uuid,jsonb,numeric,numeric,text,date,date,date,text,text) to authenticated;

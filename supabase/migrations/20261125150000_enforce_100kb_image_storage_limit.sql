-- Enforce the 100 KB image limit at Storage's database policy boundary.
-- PDFs keep their existing bucket limits; image uploads must carry verified Storage metadata.
alter policy invoice_documents_upload_managers
on storage.objects
with check (
  bucket_id = 'invoice-documents'
  and (storage.foldername(name))[2] = 'invoices'
  and has_inventory_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager']::text[])
  and (
    lower(coalesce(metadata->>'mimetype','')) not like 'image/%'
    or (
      coalesce(metadata->>'size','') ~ '^[0-9]+$'
      and (metadata->>'size')::bigint <= 102400
    )
  )
);

alter policy org_admin_upload_receipt_logos
on storage.objects
with check (
  bucket_id = 'organisation-files'
  and (storage.foldername(name))[2] = 'settings'
  and storage.filename(name) like 'receipt-logo-%'
  and has_sales_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::text[])
  and private.organization_has_access(((storage.foldername(name))[1])::uuid, null)
  and (
    lower(coalesce(metadata->>'mimetype','')) not like 'image/%'
    or (
      coalesce(metadata->>'size','') ~ '^[0-9]+$'
      and (metadata->>'size')::bigint <= 102400
    )
  )
);

alter policy org_expense_receipts_upload_member
on storage.objects
with check (
  bucket_id = 'organisation-files'
  and (storage.foldername(name))[2] = 'expenses'
  and is_organization_member(((storage.foldername(name))[1])::uuid)
  and (
    lower(coalesce(metadata->>'mimetype','')) not like 'image/%'
    or (
      coalesce(metadata->>'size','') ~ '^[0-9]+$'
      and (metadata->>'size')::bigint <= 102400
    )
  )
);

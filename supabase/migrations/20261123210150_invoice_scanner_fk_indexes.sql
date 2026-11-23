create index if not exists invoice_scans_org_purchase_idx
  on public.invoice_scans(organization_id,purchase_id)
  where purchase_id is not null;
create index if not exists invoice_scans_uploaded_by_idx
  on public.invoice_scans(uploaded_by);
create index if not exists invoice_scan_audit_actor_idx
  on public.invoice_scan_audit_logs(actor_id);
create index if not exists purchase_invoice_claim_purchase_idx
  on public.purchase_invoice_number_claims(organization_id,purchase_id);

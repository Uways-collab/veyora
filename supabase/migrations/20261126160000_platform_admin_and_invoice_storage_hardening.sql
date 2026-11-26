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

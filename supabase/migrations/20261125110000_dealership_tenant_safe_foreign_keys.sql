-- Enforce organisation-consistent foreign keys for dealership records.
-- A UUID from another organisation must never be attachable through a forged API request.

create unique index if not exists dealer_vehicles_org_id_id_uidx
  on public.dealer_vehicles(organization_id, id);
create unique index if not exists dealer_leads_org_id_id_uidx
  on public.dealer_leads(organization_id, id);

alter table public.dealer_test_drives
  drop constraint if exists dealer_test_drives_vehicle_id_fkey,
  drop constraint if exists dealer_test_drives_lead_id_fkey,
  add constraint dealer_test_drives_vehicle_org_fk
    foreign key (organization_id, vehicle_id)
    references public.dealer_vehicles(organization_id, id) on delete restrict,
  add constraint dealer_test_drives_lead_org_fk
    foreign key (organization_id, lead_id)
    references public.dealer_leads(organization_id, id) on delete set null (lead_id);

alter table public.dealer_deals
  drop constraint if exists dealer_deals_vehicle_id_fkey,
  drop constraint if exists dealer_deals_lead_id_fkey,
  add constraint dealer_deals_vehicle_org_fk
    foreign key (organization_id, vehicle_id)
    references public.dealer_vehicles(organization_id, id) on delete restrict,
  add constraint dealer_deals_lead_org_fk
    foreign key (organization_id, lead_id)
    references public.dealer_leads(organization_id, id) on delete set null (lead_id);

alter table public.dealer_service_jobs
  drop constraint if exists dealer_service_jobs_vehicle_id_fkey,
  add constraint dealer_service_jobs_vehicle_org_fk
    foreign key (organization_id, vehicle_id)
    references public.dealer_vehicles(organization_id, id) on delete restrict;

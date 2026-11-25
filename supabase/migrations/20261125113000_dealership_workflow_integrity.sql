-- Prevent overlapping test drives and keep vehicle stock status aligned with deal/workshop lifecycle.
create unique index if not exists dealer_deals_one_active_per_vehicle_uidx
  on public.dealer_deals(organization_id, vehicle_id)
  where status not in ('completed','cancelled');

create or replace function public.dealer_prevent_test_drive_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text || ':' || new.vehicle_id::text, 0));
  if new.status in ('scheduled','in_progress') and exists (
    select 1 from public.dealer_test_drives d
    where d.organization_id = new.organization_id and d.vehicle_id = new.vehicle_id
      and d.id is distinct from new.id and d.status in ('scheduled','in_progress')
      and tstzrange(d.scheduled_at, d.scheduled_at + make_interval(mins => d.duration_minutes), '[)')
          && tstzrange(new.scheduled_at, new.scheduled_at + make_interval(mins => new.duration_minutes), '[)')
  ) then
    raise exception 'This vehicle already has a test drive scheduled during that time.' using errcode = '23P01';
  end if;
  return new;
end $$;
drop trigger if exists dealer_test_drives_no_overlap on public.dealer_test_drives;
create trigger dealer_test_drives_no_overlap before insert or update of vehicle_id, scheduled_at, duration_minutes, status
on public.dealer_test_drives for each row execute function public.dealer_prevent_test_drive_overlap();

create or replace function public.dealer_sync_vehicle_status_from_deal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'reserved' then
    update public.dealer_vehicles set status = 'reserved'
    where id = new.vehicle_id and organization_id = new.organization_id and status = 'in_stock';
  elsif new.status = 'completed' then
    update public.dealer_vehicles set status = 'sold'
    where id = new.vehicle_id and organization_id = new.organization_id and status in ('in_stock','reserved');
  elsif tg_op = 'UPDATE' and old.status = 'reserved' and new.status <> 'reserved' then
    update public.dealer_vehicles v set status = 'in_stock'
    where v.id = new.vehicle_id and v.organization_id = new.organization_id and v.status = 'reserved'
      and not exists (select 1 from public.dealer_deals d where d.organization_id = new.organization_id
        and d.vehicle_id = new.vehicle_id and d.id <> new.id and d.status not in ('completed','cancelled'));
  end if;
  return new;
end $$;
drop trigger if exists dealer_deals_sync_vehicle_status on public.dealer_deals;
create trigger dealer_deals_sync_vehicle_status after insert or update of status on public.dealer_deals
for each row execute function public.dealer_sync_vehicle_status_from_deal();

create or replace function public.dealer_sync_vehicle_status_from_service()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('booked','in_progress','waiting_parts','quality_check') then
    update public.dealer_vehicles set status = 'in_service'
    where id = new.vehicle_id and organization_id = new.organization_id and status = 'in_stock';
  elsif new.status in ('completed','cancelled') then
    update public.dealer_vehicles v set status = 'in_stock'
    where v.id = new.vehicle_id and v.organization_id = new.organization_id and v.status = 'in_service'
      and not exists (select 1 from public.dealer_service_jobs j where j.organization_id = new.organization_id
        and j.vehicle_id = new.vehicle_id and j.id <> new.id and j.status in ('booked','in_progress','waiting_parts','quality_check'));
  end if;
  return new;
end $$;
drop trigger if exists dealer_service_jobs_sync_vehicle_status on public.dealer_service_jobs;
create trigger dealer_service_jobs_sync_vehicle_status after insert or update of status on public.dealer_service_jobs
for each row execute function public.dealer_sync_vehicle_status_from_service();

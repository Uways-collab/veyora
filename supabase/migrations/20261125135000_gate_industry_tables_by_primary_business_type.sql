-- Enforce industry entitlement at the database boundary, not only in navigation.
do $$
declare r record; t text; industry text;
begin
 for r in select * from (values
  ('hotel_reservations','hotel'),('hotel_rooms','hotel'),('hotel_housekeeping_tasks','hotel'),
  ('dealer_vehicles','car_dealership'),('dealer_leads','car_dealership'),('dealer_test_drives','car_dealership'),
  ('dealer_deals','car_dealership'),('dealer_service_jobs','car_dealership'),
  ('real_estate_leases','real_estate'),('delivery_jobs','logistics'),('manufacturing_orders','manufacturing')
 ) as x(table_name,business_type)
 loop
  t:=r.table_name; industry:=r.business_type;
  execute format('drop policy if exists %I on public.%I',t||'_member_select',t);
  execute format('drop policy if exists %I on public.%I',t||'_member_insert',t);
  execute format('drop policy if exists %I on public.%I',t||'_staff_insert',t);
  execute format('drop policy if exists %I on public.%I',t||'_manager_update',t);
  execute format('drop policy if exists %I on public.%I',t||'_admin_delete',t);
  execute format('create policy %I on public.%I for select to authenticated using (
   exists(select 1 from public.organization_memberships m join public.organization_business_types b
    on b.organization_id=m.organization_id and b.business_type=%L and b.is_primary
    where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())))',t||'_member_select',t,industry,t);
  execute format('create policy %I on public.%I for insert to authenticated with check (
   exists(select 1 from public.organization_memberships m join public.organization_business_types b
    on b.organization_id=m.organization_id and b.business_type=%L and b.is_primary
    where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())
    and m.role in (''owner'',''admin'',''manager'',''staff'')))',t||'_member_insert',t,industry,t);
  execute format('create policy %I on public.%I for update to authenticated using (
   exists(select 1 from public.organization_memberships m join public.organization_business_types b
    on b.organization_id=m.organization_id and b.business_type=%L and b.is_primary
    where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())
    and m.role in (''owner'',''admin'',''manager''))) with check (
   exists(select 1 from public.organization_memberships m join public.organization_business_types b
    on b.organization_id=m.organization_id and b.business_type=%L and b.is_primary
    where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())
    and m.role in (''owner'',''admin'',''manager'')))',t||'_manager_update',t,industry,t,industry,t);
  execute format('create policy %I on public.%I for delete to authenticated using (
   exists(select 1 from public.organization_memberships m join public.organization_business_types b
    on b.organization_id=m.organization_id and b.business_type=%L and b.is_primary
    where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())
    and m.role in (''owner'',''admin'')))',t||'_admin_delete',t,industry,t);
 end loop;
end $$;

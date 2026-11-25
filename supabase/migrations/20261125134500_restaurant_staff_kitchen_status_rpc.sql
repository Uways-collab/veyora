-- Kitchen staff may advance only the order status; other ticket fields remain manager-only.
revoke update on public.restaurant_orders from authenticated;
grant update(status) on public.restaurant_orders to authenticated;
drop policy if exists restaurant_orders_staff_status_update on public.restaurant_orders;
create policy restaurant_orders_staff_status_update on public.restaurant_orders
for update to authenticated
using (exists(
 select 1 from public.organization_memberships m
 join public.organization_business_types b on b.organization_id=m.organization_id
  and b.business_type='restaurant' and b.is_primary
 where m.organization_id=restaurant_orders.organization_id
  and m.user_id=(select auth.uid()) and m.role='staff'
))
with check (exists(
 select 1 from public.organization_memberships m
 join public.organization_business_types b on b.organization_id=m.organization_id
  and b.business_type='restaurant' and b.is_primary
 where m.organization_id=restaurant_orders.organization_id
  and m.user_id=(select auth.uid()) and m.role='staff'
));

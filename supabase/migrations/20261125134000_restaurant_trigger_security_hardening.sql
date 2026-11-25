-- Trigger-only privileged work is guarded by authenticated restaurant membership.
create or replace function public.restaurant_recalculate_order_totals()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare target_order uuid; target_org uuid;
begin
 target_order:=coalesce(new.order_id,old.order_id); target_org:=coalesce(new.organization_id,old.organization_id);
 if auth.uid() is null or not exists(select 1 from public.organization_memberships m join public.organization_business_types b
  on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary
  where m.organization_id=target_org and m.user_id=auth.uid()) then
  raise exception 'Restaurant workspace access denied' using errcode='42501';
 end if;
 update public.restaurant_orders o set
  total_amount=coalesce((select sum(i.line_total) from public.restaurant_order_items i where i.order_id=target_order and i.organization_id=target_org),0),
  items_summary=coalesce((select string_agg(i.quantity::text||' × '||i.item_name,', ' order by i.created_at) from public.restaurant_order_items i where i.order_id=target_order and i.organization_id=target_org),'Itemised order')
 where o.id=target_order and o.organization_id=target_org;
 return coalesce(new,old);
end $$;
revoke all on function public.restaurant_recalculate_order_totals() from public,anon,authenticated;

create or replace function public.restaurant_sync_table_occupancy()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organization_memberships m join public.organization_business_types b
  on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary
  where m.organization_id=new.organization_id and m.user_id=auth.uid()) then
  raise exception 'Restaurant workspace access denied' using errcode='42501';
 end if;
 if new.table_id is not null and new.order_type='dine_in' then
  update public.restaurant_tables t set status=case when new.status in ('completed','cancelled') then 'available' else 'occupied' end
  where t.id=new.table_id and t.organization_id=new.organization_id;
 end if;
 if tg_op='UPDATE' and old.table_id is not null and (old.table_id is distinct from new.table_id or new.status in ('completed','cancelled')) then
  update public.restaurant_tables t set status='available' where t.id=old.table_id and t.organization_id=old.organization_id
  and not exists(select 1 from public.restaurant_orders o where o.table_id=old.table_id and o.organization_id=old.organization_id
   and o.id<>new.id and o.order_type='dine_in' and o.status not in ('completed','cancelled'));
 end if;
 return new;
end $$;
revoke all on function public.restaurant_sync_table_occupancy() from public,anon,authenticated;

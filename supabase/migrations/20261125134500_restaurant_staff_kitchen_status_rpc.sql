-- Allow authenticated restaurant staff to advance kitchen tickets without broad UPDATE access.
create or replace function public.restaurant_update_order_status(p_order_id uuid,p_status text)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare target_org uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select o.organization_id into target_org from public.restaurant_orders o where o.id=p_order_id;
 if target_org is null then raise exception 'Restaurant order not found' using errcode='P0002'; end if;
 if not exists(select 1 from public.organization_memberships m join public.organization_business_types b
  on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary
  where m.organization_id=target_org and m.user_id=auth.uid()
   and m.role in ('owner','admin','manager','staff')) then
  raise exception 'Restaurant order access denied' using errcode='42501';
 end if;
 update public.restaurant_orders set status=p_status where id=p_order_id and organization_id=target_org;
 if not found then raise exception 'Restaurant order status was not updated' using errcode='P0002'; end if;
end $$;
revoke all on function public.restaurant_update_order_status(uuid,text) from public,anon;
grant execute on function public.restaurant_update_order_status(uuid,text) to authenticated;

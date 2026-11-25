create or replace function public.customers_v1_restore(p_organization_id uuid,p_customer_id uuid)
returns setof public.customers
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_role text;
  v_rows integer;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if not private.organization_has_access(p_organization_id,'customers') then
    raise exception 'ACTIVE_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  select om.role into v_role
  from public.organization_memberships om
  where om.organization_id=p_organization_id and om.user_id=auth.uid()
  limit 1;
  if v_role is null then raise exception 'ORGANIZATION_ACCESS_DENIED' using errcode='42501'; end if;
  if v_role not in ('owner','admin','manager') then raise exception 'INSUFFICIENT_PERMISSIONS' using errcode='42501'; end if;
  return query
  update public.customers c set is_active=true,updated_at=pg_catalog.now()
  where c.id=p_customer_id and c.organization_id=p_organization_id and c.is_active=false
  returning c.*;
  get diagnostics v_rows=row_count;
  if v_rows=0 then raise exception 'CUSTOMER_NOT_FOUND_OR_ALREADY_ACTIVE'; end if;
end;
$function$;
revoke all on function public.customers_v1_restore(uuid,uuid) from public,anon;
grant execute on function public.customers_v1_restore(uuid,uuid) to authenticated;

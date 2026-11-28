create or replace function public.delete_business_workspace(
  p_organization_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_name text;
  v_active_owner_workspaces integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select o.name
  into v_workspace_name
  from public.organizations o
  join public.organization_memberships m
    on m.organization_id = o.id
  where o.id = p_organization_id
    and o.deleted_at is null
    and m.user_id = v_user_id
    and m.role = 'owner'
    and m.is_active = true
  for update of o;

  if v_workspace_name is null then
    raise exception 'Only the active workspace owner can delete this workspace.' using errcode = '42501';
  end if;

  if coalesce(p_confirmation_name, '') <> v_workspace_name then
    raise exception 'Workspace name confirmation did not match.' using errcode = '22023';
  end if;

  select count(distinct o.id)::integer
  into v_active_owner_workspaces
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_user_id
    and m.role = 'owner'
    and m.is_active = true
    and o.deleted_at is null;

  if v_active_owner_workspaces <= 1 then
    raise exception 'You cannot delete the last active workspace. Create another workspace first so you can keep managing your account and subscription.' using errcode = '23514';
  end if;

  update public.organizations
  set deleted_at = pg_catalog.now(),
      deleted_by = v_user_id,
      updated_at = pg_catalog.now()
  where id = p_organization_id
    and deleted_at is null;

  update public.organization_memberships
  set is_active = false
  where organization_id = p_organization_id;
end;
$function$;

revoke all on function public.delete_business_workspace(uuid, text) from public, anon;
grant execute on function public.delete_business_workspace(uuid, text) to authenticated;

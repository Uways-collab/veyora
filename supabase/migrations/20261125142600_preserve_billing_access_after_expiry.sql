-- Organisation metadata remains visible to members so owners can reach Billing after expiry.
-- Business data remains protected by private.organization_has_access in each data-table policy.
create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select exists(
    select 1 from public.organization_memberships m
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
  );
$function$;
revoke all on function public.is_organization_member(uuid) from public,anon;
grant execute on function public.is_organization_member(uuid) to authenticated;

drop policy if exists "Members can view their organizations" on public.organizations;
create policy "Members can view their organizations"
on public.organizations for select to authenticated
using (public.is_organization_member(id));

drop policy if exists "Organization owners and admins can update organizations" on public.organizations;
create policy "Organization owners and admins can update organizations"
on public.organizations for update to authenticated
using (
  has_sales_role(id,array['owner','admin']::text[])
  and private.organization_has_access(id,null)
)
with check (
  has_sales_role(id,array['owner','admin']::text[])
  and private.organization_has_access(id,null)
);

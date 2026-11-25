-- Existing workspaces use their stored organisations.business_type as the single canonical workspace type.
insert into public.organization_business_types(organization_id,business_type,is_primary,configuration)
select o.id,
  case when o.business_type in ('retail','wholesale','distribution','services','hybrid','hotel','car_dealership','real_estate','restaurant','logistics','manufacturing')
    then o.business_type else 'retail' end,
  true,'{}'::jsonb
from public.organizations o
where not exists(
  select 1 from public.organization_business_types b
  where b.organization_id=o.id and b.is_primary=true
)
on conflict(organization_id,business_type)
do update set is_primary=true;

drop policy if exists organization_business_types_member_select on public.organization_business_types;
drop policy if exists organization_business_types_primary_member_select on public.organization_business_types;
create policy organization_business_types_primary_member_select
on public.organization_business_types for select to authenticated
using (
  is_primary=true
  and exists(
    select 1 from public.organization_memberships m
    where m.organization_id=organization_business_types.organization_id
      and m.user_id=(select auth.uid())
  )
);

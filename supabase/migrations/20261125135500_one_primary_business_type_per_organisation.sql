-- Every organisation has exactly one effective specialist workspace.
create unique index if not exists organization_business_types_one_primary_per_org_idx
on public.organization_business_types(organization_id)
where is_primary = true;

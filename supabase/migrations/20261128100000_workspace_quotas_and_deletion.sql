-- Account-level workspace limits and recoverable workspace deletion.
-- Starter / Standard / Premium receive 1 / 3 / 10 active workspaces.
-- This mirrors the existing tier capacity ladder without changing plan prices.

alter table public.subscription_plans
  add column if not exists included_workspaces integer not null default 1
  check (included_workspaces >= 1);

update public.subscription_plans
set included_workspaces = case
  when included_locations >= 10 then 10
  when included_locations >= 3 then 3
  else 1
end
where included_workspaces = 1;

alter table public.organizations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists organizations_active_workspace_idx
  on public.organizations(id) where deleted_at is null;

create or replace function private.enforce_account_workspace_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_active_count integer := 0;
  v_limit integer := 1;
  v_has_owner_history boolean := false;
  v_subscription_active boolean := false;
  v_subscription_status text;
begin
  -- Trusted server-side provisioning is not subject to the end-user quota trigger.
  if v_user_id is null then
    return new;
  end if;

  -- Serialize concurrent create attempts for the same account.
  perform 1 from auth.users u where u.id = v_user_id for update;

  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_user_id and m.role = 'owner'
  ) into v_has_owner_history;

  if v_has_owner_history then
    select
      p.included_workspaces,
      s.status,
      (
        (s.status = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at > pg_catalog.now())
        or (s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()))
        or (s.status = 'cancelled' and s.cancel_at_period_end and s.current_period_ends_at is not null and s.current_period_ends_at > pg_catalog.now())
      )
    into v_limit, v_subscription_status, v_subscription_active
    from public.organization_memberships owner_membership
    join public.organization_subscriptions s on s.organization_id = owner_membership.organization_id
    join public.subscription_plans p on p.id = s.plan_id
    where owner_membership.user_id = v_user_id
      and owner_membership.role = 'owner'
    order by
      case
        when s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()) then 1
        when s.status = 'cancelled' and s.cancel_at_period_end and s.current_period_ends_at > pg_catalog.now() then 2
        when s.status = 'active' then 3
        when s.status = 'cancelled' then 4
        when s.status = 'past_due' then 5
        when s.status = 'trial_pending' then 6
        when s.status = 'trialing' then 7
        when s.status = 'expired' then 8
        else 9
      end,
      coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
    limit 1;

    if v_limit is null or not coalesce(v_subscription_active, false) then
      raise exception 'An active Veyora subscription is required to create another workspace. Renew your plan to continue.'
        using errcode = '42501';
    end if;
    -- Trial access is for one primary workspace; paid tiers unlock their purchased quota.
    if v_subscription_status = 'trialing' then
      v_limit := 1;
    end if;
  end if;

  select count(distinct o.id)::integer
  into v_active_count
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_user_id
    and m.role = 'owner'
    and m.is_active = true
    and o.deleted_at is null;

  if v_active_count >= v_limit then
    raise exception 'Your current plan allows % active workspaces. Delete an existing workspace or upgrade your plan to add another.', v_limit
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_account_workspace_limit() from public, anon, authenticated;

drop trigger if exists enforce_account_workspace_limit on public.organizations;
create trigger enforce_account_workspace_limit
before insert on public.organizations
for each row execute function private.enforce_account_workspace_limit();

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

-- Keep deleted workspaces and their business records for audit/recovery, but
-- make them unavailable to normal members and all subscription-gated RLS paths.
create or replace function private.organization_has_access(
  p_organization_id uuid,
  p_feature text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and not exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.banned_until is not null
        and u.banned_until > pg_catalog.now()
    )
    and exists (
      select 1
      from public.organization_memberships target_membership
      join public.organizations target_organization
        on target_organization.id = target_membership.organization_id
      join lateral (
        select owner_membership.user_id
        from public.organization_memberships owner_membership
        where owner_membership.organization_id = target_membership.organization_id
          and owner_membership.role = 'owner'
        order by owner_membership.created_at asc
        limit 1
      ) target_owner on true
      join lateral (
        select s.status, s.trial_ends_at, s.current_period_ends_at,
               s.cancel_at_period_end, s.plan_id
        from public.organization_memberships account_business
        join public.organization_subscriptions s
          on s.organization_id = account_business.organization_id
        where account_business.user_id = target_owner.user_id
          and account_business.role = 'owner'
        order by
          case
            when s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()) then 1
            when s.status = 'cancelled' and s.cancel_at_period_end and s.current_period_ends_at > pg_catalog.now() then 2
            when s.status = 'active' then 3
            when s.status = 'cancelled' then 4
            when s.status = 'past_due' then 5
            when s.status = 'trial_pending' then 6
            when s.status = 'trialing' then 7
            when s.status = 'expired' then 8
            else 9
          end,
          coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
        limit 1
      ) account_subscription on true
      join public.subscription_plans p
        on p.id = account_subscription.plan_id
      where target_membership.organization_id = p_organization_id
        and target_membership.user_id = auth.uid()
        and target_membership.is_active = true
        and target_organization.deleted_at is null
        and (
          (account_subscription.status = 'trialing' and account_subscription.trial_ends_at is not null and account_subscription.trial_ends_at > pg_catalog.now())
          or (account_subscription.status = 'active' and (account_subscription.current_period_ends_at is null or account_subscription.current_period_ends_at > pg_catalog.now()))
          or (account_subscription.status = 'cancelled' and account_subscription.cancel_at_period_end = true and account_subscription.current_period_ends_at is not null and account_subscription.current_period_ends_at > pg_catalog.now())
        )
        and (p_feature is null or coalesce((p.features ->> p_feature)::boolean, false))
    );
$function$;

revoke all on function private.organization_has_access(uuid, text) from public, anon;
grant execute on function private.organization_has_access(uuid, text) to authenticated;


create or replace function public.get_account_workspace_usage()
returns table(active_workspaces integer, included_workspaces integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (
      select count(distinct o.id)::integer
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = auth.uid()
        and m.role = 'owner'
        and m.is_active = true
        and o.deleted_at is null
    ),
    coalesce((
      select case when s.status = 'trialing' then 1 else p.included_workspaces end
      from public.organization_memberships owner_membership
      join public.organization_subscriptions s on s.organization_id = owner_membership.organization_id
      join public.subscription_plans p on p.id = s.plan_id
      where owner_membership.user_id = auth.uid()
        and owner_membership.role = 'owner'
      order by
        case
          when s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()) then 1
          when s.status = 'cancelled' and s.cancel_at_period_end and s.current_period_ends_at > pg_catalog.now() then 2
          when s.status = 'active' then 3
          when s.status = 'cancelled' then 4
          when s.status = 'past_due' then 5
          when s.status = 'trial_pending' then 6
          when s.status = 'trialing' then 7
          when s.status = 'expired' then 8
          else 9
        end,
        coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
      limit 1
    ), 1)::integer
  where auth.uid() is not null;
$function$;

revoke all on function public.get_account_workspace_usage() from public, anon;
grant execute on function public.get_account_workspace_usage() to authenticated;

create or replace function public.is_organization_member_metadata(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and o.deleted_at is null
  );
$function$;

revoke all on function public.is_organization_member_metadata(uuid) from public, anon;
grant execute on function public.is_organization_member_metadata(uuid) to authenticated;

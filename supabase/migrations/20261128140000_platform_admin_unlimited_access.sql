-- Platform-owner subscription exemption and safe default workspace navigation.
-- The exemption is keyed to the trusted platform_admins table, never an email
-- address or user-editable metadata. Normal customer enforcement is unchanged.

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
  -- Trusted server-side provisioning and verified platform admins are exempt.
  if v_user_id is null or public.is_platform_admin() then
    return new;
  end if;

  perform 1 from auth.users u where u.id = v_user_id for update;

  select exists (
    select 1 from public.organization_memberships m
    where m.user_id = v_user_id and m.role = 'owner'
  ) into v_has_owner_history;

  if v_has_owner_history then
    select p.included_workspaces, s.status,
      (
        (s.status = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at > pg_catalog.now())
        or (s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()))
        or (s.status = 'cancelled' and s.cancel_at_period_end and s.current_period_ends_at is not null and s.current_period_ends_at > pg_catalog.now())
      )
    into v_limit, v_subscription_status, v_subscription_active
    from public.organization_memberships owner_membership
    join public.organization_subscriptions s on s.organization_id = owner_membership.organization_id
    join public.subscription_plans p on p.id = s.plan_id
    where owner_membership.user_id = v_user_id and owner_membership.role = 'owner'
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
    if v_subscription_status = 'trialing' then v_limit := 1; end if;
  end if;

  select count(distinct o.id)::integer
  into v_active_count
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = v_user_id and m.role = 'owner'
    and m.is_active = true and o.deleted_at is null;

  if v_active_count >= v_limit then
    raise exception 'Your current plan allows % active workspaces. Delete an existing workspace or upgrade your plan to add another.', v_limit
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

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
      where target_membership.organization_id = p_organization_id
        and target_membership.user_id = auth.uid()
        and target_membership.is_active = true
        and target_organization.deleted_at is null
        and (
          -- Platform owners get every plan feature without a customer subscription.
          public.is_platform_admin()
          or exists (
            select 1
            from public.organization_memberships account_business
            join public.organization_subscriptions s
              on s.organization_id = account_business.organization_id
            join public.subscription_plans p on p.id = s.plan_id
            where account_business.user_id = target_owner.user_id
              and account_business.role = 'owner'
              and (
                (s.status = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at > pg_catalog.now())
                or (s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()))
                or (s.status = 'cancelled' and s.cancel_at_period_end = true and s.current_period_ends_at is not null and s.current_period_ends_at > pg_catalog.now())
              )
              and (p_feature is null or coalesce((p.features ->> p_feature)::boolean, false))
          )
        )
    );
$function$;

-- AI calls remain usage-logged for cost visibility, but the verified platform
-- owner is not blocked by customer plan feature flags or monthly AI quotas.
create or replace function public.reserve_ai_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_feature text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan_features jsonb;
  v_limit integer;
  v_used integer;
  v_usage_id uuid;
  v_feature_key text;
  v_is_platform_admin boolean := exists (
    select 1 from public.platform_admins a
    where a.user_id = p_user_id and a.role = 'super_admin'
  );
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if p_organization_id is null or p_user_id is null or p_feature not in ('business_assistant','invoice_scan') then
    raise exception 'INVALID_AI_USAGE_RESERVATION' using errcode='22023';
  end if;
  if not exists(select 1 from public.organization_memberships m
    where m.organization_id=p_organization_id and m.user_id=p_user_id and m.is_active=true) then
    raise exception 'USER_NOT_IN_ORGANISATION' using errcode='42501';
  end if;

  if not v_is_platform_admin and not private.organization_subscription_is_active(p_organization_id) then
    raise exception 'SUBSCRIPTION_INACTIVE' using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text||':'||p_feature,0)
  );

  select p.features,
    case when p_feature='business_assistant' then p.ai_assistant_requests else p.ai_invoice_scans end
  into v_plan_features,v_limit
  from public.organization_subscriptions s
  join public.subscription_plans p on p.id=s.plan_id
  where s.organization_id=p_organization_id;

  v_feature_key:=case when p_feature='business_assistant' then 'ai_assistant' else 'invoice_scanner' end;
  if not v_is_platform_admin then
    if coalesce((v_plan_features->>v_feature_key)::boolean,false) is not true then
      raise exception 'AI_FEATURE_NOT_INCLUDED' using errcode='42501';
    end if;
    if coalesce(v_limit,0)<1 then
      raise exception 'MONTHLY_AI_LIMIT_REACHED' using errcode='23514';
    end if;
    select count(*) into v_used
    from public.ai_usage_records u
    where u.organization_id=p_organization_id
      and u.feature=p_feature
      and u.created_at>=pg_catalog.date_trunc('month',pg_catalog.now());
    if v_used>=v_limit then
      raise exception 'MONTHLY_AI_LIMIT_REACHED' using errcode='23514';
    end if;
  end if;

  insert into public.ai_usage_records(organization_id,user_id,feature,model,input_tokens,output_tokens)
  values(p_organization_id,p_user_id,p_feature,'reserved',0,0)
  returning id into v_usage_id;
  return v_usage_id;
end;
$function$;

revoke all on function private.enforce_account_workspace_limit() from public, anon, authenticated;
revoke all on function private.organization_has_access(uuid,text) from public, anon;
grant execute on function private.organization_has_access(uuid,text) to authenticated;
revoke all on function public.reserve_ai_usage(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid,uuid,text) to service_role;

-- Veyora billing is account-wide: one Owner account can operate multiple businesses
-- under one trial or paid subscription. Additional businesses do not create trials
-- or require a second subscription. All business data remains organisation-scoped.

drop trigger if exists a_start_workspace_free_trial on public.organizations;
drop function if exists private.start_workspace_free_trial();

-- Pick one authoritative subscription for an Owner account. Paid subscriptions
-- take precedence over legacy trials, so an old trial cannot unlock an account
-- after its paid subscription has expired.
create or replace function private.organization_subscription_is_active(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_memberships target_membership
    join lateral (
      select owner_membership.user_id
      from public.organization_memberships owner_membership
      where owner_membership.organization_id = target_membership.organization_id
        and owner_membership.role = 'owner'
      order by owner_membership.created_at asc
      limit 1
    ) target_owner on true
    join lateral (
      select s.status, s.trial_ends_at, s.current_period_ends_at, s.cancel_at_period_end
      from public.organization_memberships account_business
      join public.organization_subscriptions s on s.organization_id = account_business.organization_id
      where account_business.user_id = target_owner.user_id
        and account_business.role = 'owner'
      order by
        case s.status
          when 'active' then 1
          when 'cancelled' then 2
          when 'past_due' then 3
          when 'trial_pending' then 4
          when 'trialing' then 5
          when 'expired' then 6
          else 7
        end,
        coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
      limit 1
    ) account_subscription on true
    where target_membership.organization_id = p_organization_id
      and (
        (account_subscription.status = 'trialing' and account_subscription.trial_ends_at is not null and account_subscription.trial_ends_at > pg_catalog.now())
        or (account_subscription.status = 'active' and (account_subscription.current_period_ends_at is null or account_subscription.current_period_ends_at > pg_catalog.now()))
        or (account_subscription.status = 'cancelled' and account_subscription.cancel_at_period_end = true and account_subscription.current_period_ends_at is not null and account_subscription.current_period_ends_at > pg_catalog.now())
      )
  );
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
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.banned_until is not null
        and u.banned_until > pg_catalog.now()
    )
    and exists (
      select 1
      from public.organization_memberships target_membership
      join lateral (
        select owner_membership.user_id
        from public.organization_memberships owner_membership
        where owner_membership.organization_id = target_membership.organization_id
          and owner_membership.role = 'owner'
        order by owner_membership.created_at asc
        limit 1
      ) target_owner on true
      join lateral (
        select s.status, s.trial_ends_at, s.current_period_ends_at, s.cancel_at_period_end, s.plan_id
        from public.organization_memberships account_business
        join public.organization_subscriptions s on s.organization_id = account_business.organization_id
        where account_business.user_id = target_owner.user_id
          and account_business.role = 'owner'
        order by
          case s.status
            when 'active' then 1
            when 'cancelled' then 2
            when 'past_due' then 3
            when 'trial_pending' then 4
            when 'trialing' then 5
            when 'expired' then 6
            else 7
          end,
          coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
        limit 1
      ) account_subscription on true
      join public.subscription_plans p on p.id = account_subscription.plan_id
      where target_membership.organization_id = p_organization_id
        and target_membership.user_id = auth.uid()
        and (
          (account_subscription.status = 'trialing' and account_subscription.trial_ends_at is not null and account_subscription.trial_ends_at > pg_catalog.now())
          or (account_subscription.status = 'active' and (account_subscription.current_period_ends_at is null or account_subscription.current_period_ends_at > pg_catalog.now()))
          or (account_subscription.status = 'cancelled' and account_subscription.cancel_at_period_end = true and account_subscription.current_period_ends_at is not null and account_subscription.current_period_ends_at > pg_catalog.now())
        )
        and (p_feature is null or coalesce((p.features ->> p_feature)::boolean, false))
    );
$function$;

revoke all on function private.organization_subscription_is_active(uuid) from public, anon, authenticated;
revoke all on function private.organization_has_access(uuid, text) from public, anon;
grant execute on function private.organization_has_access(uuid, text) to authenticated;

-- Consolidate any legacy per-business subscriptions onto one account-level
-- entitlement, mirrored to every business owned by that same Veyora account.
with owner_businesses as (
  select m.user_id as owner_user_id, m.organization_id
  from public.organization_memberships m
  where m.role = 'owner'
),
ranked_account_subscriptions as (
  select
    ob.owner_user_id,
    s.*,
    row_number() over (
      partition by ob.owner_user_id
      order by
        case s.status
          when 'active' then 1
          when 'cancelled' then 2
          when 'past_due' then 3
          when 'trial_pending' then 4
          when 'trialing' then 5
          when 'expired' then 6
          else 7
        end,
        coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
    ) as account_rank
  from owner_businesses ob
  join public.organization_subscriptions s on s.organization_id = ob.organization_id
),
canonical_account_subscriptions as (
  select * from ranked_account_subscriptions where account_rank = 1
)
insert into public.organization_subscriptions (
  organization_id, plan_id, status, trial_starts_at, trial_ends_at,
  current_period_starts_at, current_period_ends_at, cancel_at_period_end,
  provider, provider_customer_code, provider_subscription_code, provider_plan_code,
  trial_card_reference, card_verified_at, latest_payment_reference
)
select
  ob.organization_id, canonical.plan_id, canonical.status, canonical.trial_starts_at, canonical.trial_ends_at,
  canonical.current_period_starts_at, canonical.current_period_ends_at, canonical.cancel_at_period_end,
  canonical.provider, canonical.provider_customer_code, canonical.provider_subscription_code, canonical.provider_plan_code,
  canonical.trial_card_reference, canonical.card_verified_at, canonical.latest_payment_reference
from owner_businesses ob
join canonical_account_subscriptions canonical on canonical.owner_user_id = ob.owner_user_id
on conflict (organization_id) do update set
  plan_id = excluded.plan_id,
  status = excluded.status,
  trial_starts_at = excluded.trial_starts_at,
  trial_ends_at = excluded.trial_ends_at,
  current_period_starts_at = excluded.current_period_starts_at,
  current_period_ends_at = excluded.current_period_ends_at,
  cancel_at_period_end = excluded.cancel_at_period_end,
  provider = excluded.provider,
  provider_customer_code = excluded.provider_customer_code,
  provider_subscription_code = excluded.provider_subscription_code,
  provider_plan_code = excluded.provider_plan_code,
  trial_card_reference = excluded.trial_card_reference,
  card_verified_at = excluded.card_verified_at,
  latest_payment_reference = excluded.latest_payment_reference,
  updated_at = pg_catalog.now();

-- Trial creation happens only after the Owner membership exists, allowing us to
-- detect whether this is the first business created by this Veyora account.
create or replace function public.create_business_workspace(
  p_name text,
  p_business_type text,
  p_country text,
  p_base_currency text,
  p_business_email text,
  p_business_phone text,
  p_timezone text,
  p_configuration jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_has_memberships boolean;
  v_is_owner boolean;
  v_has_account_subscription boolean;
  v_plan_id uuid;
  v_source_subscription public.organization_subscriptions%rowtype;
  v_started_at timestamptz := pg_catalog.now();
  v_business_type text := coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(p_business_type)), ''), 'retail');
  previous_init_flag text := coalesce(pg_catalog.current_setting('veyora.workspace_initialization', true), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_name), '') is null then
    raise exception 'Business name is required' using errcode = '22023';
  end if;
  if v_business_type not in ('retail','wholesale','distribution','services','hybrid','hotel','car_dealership','real_estate','restaurant','logistics','manufacturing') then
    raise exception 'Choose one supported business type when creating this business.' using errcode = '22023';
  end if;

  select exists(select 1 from public.organization_memberships m where m.user_id = v_user_id)
    into v_has_memberships;
  select exists(select 1 from public.organization_memberships m where m.user_id = v_user_id and m.role = 'owner')
    into v_is_owner;

  if v_has_memberships and not v_is_owner then
    raise exception 'Only an Owner can create an additional business workspace. Managers and Staff cannot create businesses.' using errcode = '42501';
  end if;

  -- Any historical subscription record consumes the account's one trial.
  select exists(
    select 1
    from public.organization_memberships m
    join public.organization_subscriptions s on s.organization_id = m.organization_id
    where m.user_id = v_user_id and m.role = 'owner'
  ) into v_has_account_subscription;

  perform pg_catalog.set_config('veyora.workspace_initialization', 'allowed', true);
  insert into public.organizations(name,business_type,country,currency,email,phone,timezone)
  values(
    pg_catalog.btrim(p_name),
    v_business_type,
    coalesce(nullif(pg_catalog.btrim(p_country), ''), 'Nigeria'),
    coalesce(nullif(pg_catalog.btrim(p_base_currency), ''), 'NGN'),
    nullif(pg_catalog.btrim(p_business_email), ''),
    nullif(pg_catalog.btrim(p_business_phone), ''),
    coalesce(nullif(pg_catalog.btrim(p_timezone), ''), 'Africa/Lagos')
  )
  returning id into v_organization_id;

  insert into public.organization_business_types(organization_id,business_type,is_primary,configuration)
  values(v_organization_id,v_business_type,true,coalesce(p_configuration,'{}'::jsonb));

  insert into public.organization_memberships(organization_id,user_id,role)
  values(v_organization_id,v_user_id,'owner');

  -- A first-time Veyora account receives one 7-day trial. Further businesses
  -- receive a mirrored copy of the same account subscription, not a new trial
  -- or a second payment obligation.
  if v_has_account_subscription then
    select s.* into v_source_subscription
    from public.organization_memberships m
    join public.organization_subscriptions s on s.organization_id = m.organization_id
    where m.user_id = v_user_id and m.role = 'owner'
    order by
      case s.status
        when 'active' then 1
        when 'cancelled' then 2
        when 'past_due' then 3
        when 'trial_pending' then 4
        when 'trialing' then 5
        when 'expired' then 6
        else 7
      end,
      coalesce(s.current_period_ends_at, s.trial_ends_at, s.updated_at) desc
    limit 1;

    if found then
      insert into public.organization_subscriptions(
        organization_id,plan_id,status,trial_starts_at,trial_ends_at,
        current_period_starts_at,current_period_ends_at,cancel_at_period_end,
        provider,provider_customer_code,provider_subscription_code,provider_plan_code,
        trial_card_reference,card_verified_at,latest_payment_reference
      )
      values(
        v_organization_id,v_source_subscription.plan_id,v_source_subscription.status,
        v_source_subscription.trial_starts_at,v_source_subscription.trial_ends_at,
        v_source_subscription.current_period_starts_at,v_source_subscription.current_period_ends_at,
        v_source_subscription.cancel_at_period_end,v_source_subscription.provider,
        v_source_subscription.provider_customer_code,v_source_subscription.provider_subscription_code,
        v_source_subscription.provider_plan_code,v_source_subscription.trial_card_reference,
        v_source_subscription.card_verified_at,v_source_subscription.latest_payment_reference
      );
    end if;
  else
    select p.id into v_plan_id
    from public.subscription_plans p
    where p.code = 'premium_monthly' and p.is_active = true
    limit 1;

    if v_plan_id is null then
      raise exception 'The Veyora free-trial plan is not configured.';
    end if;

    insert into public.organization_subscriptions(
      organization_id,plan_id,status,provider,trial_starts_at,trial_ends_at,card_verified_at
    )
    values(
      v_organization_id,v_plan_id,'trialing','paystack',v_started_at,v_started_at + interval '7 days',null
    );
  end if;

  insert into public.finance_accounts(organization_id,account_name,account_type,currency_code,ledger_account_id,created_by)
  select v_organization_id,'Cash on Hand','cash',o.currency,l.id,v_user_id
  from public.organizations o
  join public.finance_ledger_accounts l
    on l.organization_id = o.id and l.account_code = '1000' and l.is_active
  where o.id = v_organization_id
    and not exists(
      select 1 from public.finance_accounts a
      where a.organization_id = v_organization_id and a.account_name = 'Cash on Hand'
    );

  perform pg_catalog.set_config('veyora.workspace_initialization', previous_init_flag, true);
  return v_organization_id;
end;
$function$;

-- Keep the legacy 7-argument RPC compatible with existing clients.
create or replace function public.create_business_workspace(
  p_name text,
  p_business_type text,
  p_country text,
  p_base_currency text,
  p_business_email text,
  p_business_phone text,
  p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return public.create_business_workspace(
    p_name,p_business_type,p_country,p_base_currency,p_business_email,p_business_phone,p_timezone,'{}'::jsonb
  );
end;
$function$;

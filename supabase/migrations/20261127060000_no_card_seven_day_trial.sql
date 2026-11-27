-- Start every newly-created Veyora workspace on a seven-day free trial.
-- No payment method or card verification is required. Expiry is enforced by
-- the same database access helper used by business-table RLS and write guards.

create or replace function private.organization_subscription_is_active(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_subscriptions s
    where s.organization_id = p_organization_id
      and (
        (
          s.status = 'trialing'
          and s.trial_ends_at is not null
          and s.trial_ends_at > pg_catalog.now()
        )
        or (
          s.status = 'active'
          and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now())
        )
        or (
          s.status = 'cancelled'
          and s.cancel_at_period_end = true
          and s.current_period_ends_at is not null
          and s.current_period_ends_at > pg_catalog.now()
        )
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
      from public.organization_memberships m
      join public.organization_subscriptions s on s.organization_id = m.organization_id
      join public.subscription_plans p on p.id = s.plan_id
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and (
          (
            s.status = 'trialing'
            and s.trial_ends_at is not null
            and s.trial_ends_at > pg_catalog.now()
          )
          or (
            s.status = 'active'
            and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now())
          )
          or (
            s.status = 'cancelled'
            and s.cancel_at_period_end = true
            and s.current_period_ends_at is not null
            and s.current_period_ends_at > pg_catalog.now()
          )
        )
        and (
          p_feature is null
          or coalesce((p.features ->> p_feature)::boolean, false)
        )
    );
$function$;

revoke all on function private.organization_subscription_is_active(uuid) from public, anon, authenticated;
revoke all on function private.organization_has_access(uuid, text) from public, anon;
grant execute on function private.organization_has_access(uuid, text) to authenticated;

create or replace function private.start_workspace_free_trial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan_id uuid;
  v_started_at timestamptz := pg_catalog.now();
begin
  select p.id
    into v_plan_id
  from public.subscription_plans p
  where p.code = 'premium_monthly'
    and p.is_active = true
  limit 1;

  if v_plan_id is null then
    raise exception 'The Veyora free-trial plan is not configured.';
  end if;

  insert into public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    provider,
    trial_starts_at,
    trial_ends_at,
    card_verified_at
  )
  values (
    new.id,
    v_plan_id,
    'trialing',
    'paystack',
    v_started_at,
    v_started_at + interval '7 days',
    null
  )
  on conflict (organization_id) do nothing;

  return new;
end;
$function$;

revoke all on function private.start_workspace_free_trial() from public, anon, authenticated;

drop trigger if exists a_start_workspace_free_trial on public.organizations;
create trigger a_start_workspace_free_trial
after insert on public.organizations
for each row
execute function private.start_workspace_free_trial();

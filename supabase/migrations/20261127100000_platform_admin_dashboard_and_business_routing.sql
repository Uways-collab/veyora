-- Veyora Platform Admin: separate, tightly controlled access to platform-wide
-- operational metrics. This does not grant organisation membership or bypass RLS.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'super_admin' check (role = 'super_admin'),
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from public, anon, authenticated;

-- Grant the initial Platform Owner only when the exact account already exists.
insert into public.platform_admins(user_id, email, role)
select u.id, pg_catalog.lower(u.email), 'super_admin'
from auth.users u
where pg_catalog.lower(u.email) = 'blundigold@gmail.com'
on conflict (user_id) do update
set email = excluded.email, role = 'super_admin';

do $block$
begin
  if not exists (
    select 1 from public.platform_admins a
    join auth.users u on u.id = a.user_id
    where pg_catalog.lower(u.email) = 'blundigold@gmail.com'
      and a.role = 'super_admin'
  ) then
    raise exception 'The initial Veyora Platform Owner account blundigold@gmail.com was not found. Admin setup was not completed.';
  end if;
end;
$block$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.platform_admins a
    where a.user_id = auth.uid() and a.role = 'super_admin'
  );
$function$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.platform_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', pg_catalog.now(),
    'users_total', (select count(*) from auth.users),
    'users_last_30_days', (select count(*) from auth.users where created_at >= pg_catalog.now() - interval '30 days'),
    'users_last_7_days', (select count(*) from auth.users where created_at >= pg_catalog.now() - interval '7 days'),
    'banned_users', (select count(*) from auth.users where banned_until is not null and banned_until > pg_catalog.now()),
    'workspaces_total', (select count(*) from public.organizations),
    'owner_accounts_total', (select count(distinct user_id) from public.organization_memberships where role = 'owner'),
    'memberships_total', (select count(*) from public.organization_memberships),
    'paid_accounts', (
      select count(distinct m.user_id)
      from public.organization_memberships m
      join public.organization_subscriptions s on s.organization_id = m.organization_id
      where m.role = 'owner' and (
        (s.status = 'active' and (s.current_period_ends_at is null or s.current_period_ends_at > pg_catalog.now()))
        or (s.status = 'cancelled' and s.cancel_at_period_end = true and s.current_period_ends_at > pg_catalog.now())
      )
    ),
    'trial_accounts', (
      select count(distinct m.user_id)
      from public.organization_memberships m
      join public.organization_subscriptions s on s.organization_id = m.organization_id
      where m.role = 'owner' and s.status = 'trialing'
        and s.trial_ends_at is not null and s.trial_ends_at > pg_catalog.now()
    ),
    'successful_payments', (
      select count(*) from public.billing_transactions
      where status = 'succeeded' and purpose = 'subscription_payment'
    ),
    'failed_payments', (
      select count(*) from public.billing_transactions
      where status in ('failed','abandoned') and purpose = 'subscription_payment'
    ),
    'revenue_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency,
        'total_minor_units', total_minor_units,
        'transactions', transactions
      ) order by currency)
      from (
        select currency, sum(amount_minor_units)::bigint as total_minor_units, count(*)::bigint as transactions
        from public.billing_transactions
        where status = 'succeeded' and purpose = 'subscription_payment'
        group by currency
      ) revenue
    ), '[]'::jsonb),
    'workspaces_by_type', coalesce((
      select jsonb_agg(jsonb_build_object('business_type', business_type, 'count', total) order by total desc, business_type)
      from (
        select coalesce(nullif(business_type,''),'unspecified') as business_type, count(*)::bigint as total
        from public.organizations group by coalesce(nullif(business_type,''),'unspecified')
      ) types
    ), '[]'::jsonb),
    'recent_users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'email', email, 'created_at', created_at,
        'last_sign_in_at', last_sign_in_at,
        'banned', banned_until is not null and banned_until > pg_catalog.now()
      ) order by created_at desc)
      from (select id,email,created_at,last_sign_in_at,banned_until from auth.users order by created_at desc limit 8) recent
    ), '[]'::jsonb),
    'recent_workspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recent.id, 'name', recent.name, 'business_type', recent.business_type,
        'country', recent.country, 'created_at', recent.created_at,
        'owner_email', recent.owner_email
      ) order by recent.created_at desc)
      from (
        select o.id,o.name,o.business_type,o.country,o.created_at,u.email as owner_email
        from public.organizations o
        left join lateral (
          select m.user_id from public.organization_memberships m
          where m.organization_id = o.id and m.role = 'owner'
          order by m.created_at asc limit 1
        ) owner_row on true
        left join auth.users u on u.id = owner_row.user_id
        order by o.created_at desc limit 8
      ) recent
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.platform_admin_overview() from public, anon;
grant execute on function public.platform_admin_overview() to authenticated;

-- Existing workspace setup stores the selected primary type in both tables.
-- Reconcile the router's organizations.business_type field with that source so
-- every already-created dealership is routed to its dedicated dealership UI.
update public.organizations o
set business_type = bt.business_type, updated_at = pg_catalog.now()
from public.organization_business_types bt
where bt.organization_id = o.id
  and bt.is_primary = true
  and bt.business_type in (
    'retail','wholesale','distribution','services','hybrid','hotel',
    'car_dealership','real_estate','restaurant','logistics','manufacturing'
  )
  and o.business_type is distinct from bt.business_type;

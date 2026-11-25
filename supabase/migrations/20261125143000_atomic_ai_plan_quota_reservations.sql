-- Atomically reserve monthly AI usage so concurrent requests cannot exceed plan quotas.
create or replace function public.reserve_ai_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_feature text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_plan_features jsonb;
  v_limit integer;
  v_used integer;
  v_usage_id uuid;
  v_feature_key text;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if p_organization_id is null or p_user_id is null or p_feature not in ('business_assistant','invoice_scan') then
    raise exception 'INVALID_AI_USAGE_RESERVATION' using errcode='22023';
  end if;
  if not exists(select 1 from public.organization_memberships m
    where m.organization_id=p_organization_id and m.user_id=p_user_id) then
    raise exception 'USER_NOT_IN_ORGANISATION' using errcode='42501';
  end if;
  if not private.organization_subscription_is_active(p_organization_id) then
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

  insert into public.ai_usage_records(organization_id,user_id,feature,model,input_tokens,output_tokens)
  values(p_organization_id,p_user_id,p_feature,'reserved',0,0)
  returning id into v_usage_id;
  return v_usage_id;
end;
$function$;
revoke all on function public.reserve_ai_usage(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,uuid,text) to service_role;

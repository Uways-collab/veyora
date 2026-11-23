-- Keep reconciliation as an invoker function so the source-events table RLS policy is always applied.
create or replace function public.finance_get_source_status(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not public.is_organization_member(p_organization_id)
  or not public.has_sales_role(p_organization_id,array['owner','admin','manager']::text[]) then
  raise exception 'Not authorised to view Finance reconciliation' using errcode='42501';
 end if;
 select jsonb_build_object(
  'posted',count(*) filter(where status='posted'),
  'pending',count(*) filter(where status='pending'),
  'reversed',count(*) filter(where status='reversed'),
  'skipped',count(*) filter(where status='skipped'),
  'events',coalesce(jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'source_id',source_id,'status',status,
    'last_error',last_error,'created_at',created_at,'journal_entry_id',journal_entry_id)
    order by created_at desc) filter(where status in ('pending','skipped')), '[]'::jsonb)
 ) into v_result from public.finance_source_events where organization_id=p_organization_id;
 return coalesce(v_result,jsonb_build_object('posted',0,'pending',0,'reversed',0,'skipped',0,'events','[]'::jsonb));
end;
$$;
revoke all on function public.finance_get_source_status(uuid) from public,anon;
grant execute on function public.finance_get_source_status(uuid) to authenticated;
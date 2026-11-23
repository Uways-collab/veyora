-- Manager-only retry for pending operational postings after mappings or source data are corrected.
create or replace function public.finance_retry_pending_events(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare r record; v_status text; v_posted integer:=0; v_pending integer:=0; v_skipped integer:=0; v_reversed integer:=0;
begin
 if auth.uid() is null or not public.is_organization_member(p_organization_id)
  or not public.has_sales_role(p_organization_id,array['owner','admin','manager']::text[]) then
  raise exception 'Only organisation owners, admins and managers can retry Finance postings' using errcode='42501';
 end if;
 for r in select id from public.finance_source_events
  where organization_id=p_organization_id and status='pending'
  order by created_at,id for update
 loop
  v_status:=public.finance_process_source_event(r.id);
  if v_status='posted' then v_posted:=v_posted+1;
  elsif v_status='pending' then v_pending:=v_pending+1;
  elsif v_status='skipped' then v_skipped:=v_skipped+1;
  elsif v_status='reversed' then v_reversed:=v_reversed+1;
  end if;
 end loop;
 return jsonb_build_object('posted',v_posted,'pending',v_pending,'skipped',v_skipped,'reversed',v_reversed);
end;
$$;
revoke all on function public.finance_retry_pending_events(uuid) from public,anon;
grant execute on function public.finance_retry_pending_events(uuid) to authenticated;

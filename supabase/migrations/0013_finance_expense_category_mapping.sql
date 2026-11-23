-- Expense categories must map to an organisation-specific expense ledger account.
create table if not exists public.finance_expense_category_mappings(
 organization_id uuid not null,
 expense_category_id uuid not null,
 ledger_account_id uuid not null,
 created_by uuid,
 updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(organization_id,expense_category_id),
 foreign key(organization_id,expense_category_id) references public.expense_categories(organization_id,id),
 foreign key(organization_id,ledger_account_id) references public.finance_ledger_accounts(organization_id,id)
);
alter table public.finance_expense_category_mappings enable row level security;
revoke all on public.finance_expense_category_mappings from anon,authenticated;
grant select on public.finance_expense_category_mappings to authenticated;
drop policy if exists finance_expense_category_mappings_read_managers on public.finance_expense_category_mappings;
create policy finance_expense_category_mappings_read_managers on public.finance_expense_category_mappings
 for select to authenticated using(public.has_sales_role(organization_id,array['owner','admin','manager']::text[]));

create or replace function public.finance_map_expense_category(
 p_organization_id uuid,p_expense_category_id uuid,p_ledger_account_id uuid
) returns void language plpgsql security definer set search_path=''
as $$
declare r record;
begin
 if auth.uid() is null or not public.is_organization_member(p_organization_id)
  or not public.has_sales_role(p_organization_id,array['owner','admin','manager']::text[]) then
  raise exception 'Only organisation owners, admins and managers can map expense categories' using errcode='42501';
 end if;
 if not exists(select 1 from public.expense_categories where organization_id=p_organization_id and id=p_expense_category_id and is_active) then
  raise exception 'Active expense category not found';
 end if;
 if not exists(select 1 from public.finance_ledger_accounts where organization_id=p_organization_id and id=p_ledger_account_id and is_active and account_type='expense') then
  raise exception 'Select an active expense ledger account';
 end if;
 insert into public.finance_expense_category_mappings(organization_id,expense_category_id,ledger_account_id,created_by,updated_by)
 values(p_organization_id,p_expense_category_id,p_ledger_account_id,auth.uid(),auth.uid())
 on conflict(organization_id,expense_category_id) do update
  set ledger_account_id=excluded.ledger_account_id,updated_by=auth.uid(),updated_at=now();
 insert into public.finance_audit_log(organization_id,actor_id,action,entity_type,entity_id,details)
 values(p_organization_id,auth.uid(),'mapped','expense_category',p_expense_category_id,jsonb_build_object('ledger_account_id',p_ledger_account_id));
 for r in
  select se.id from public.finance_source_events se
  join public.expenses e on e.organization_id=se.organization_id and e.id=(se.payload->>'expense_id')::uuid
  where se.organization_id=p_organization_id and se.event_type in ('expense','expense_edit')
   and se.status='pending' and e.category_id=p_expense_category_id
  order by se.created_at,se.id for update of se
 loop
  perform public.finance_process_source_event(r.id);
 end loop;
end;
$$;
revoke all on function public.finance_map_expense_category(uuid,uuid,uuid) from public,anon;
grant execute on function public.finance_map_expense_category(uuid,uuid,uuid) to authenticated;

do $$
declare d text; old_text text; new_text text;
begin
 d:=pg_get_functiondef('public.finance_process_source_event(uuid)'::regprocedure);
 old_text:='if upper(v_exp.currency_code)<>v_currency then raise exception ''Expense currency differs from organisation base currency''; end if;'||chr(10)||
  '  if e.event_type=''expense_edit'' then';
 new_text:='if upper(v_exp.currency_code)<>v_currency then raise exception ''Expense currency differs from organisation base currency''; end if;'||chr(10)||
  '  select m.ledger_account_id into v_expense from public.finance_expense_category_mappings m join public.finance_ledger_accounts l on l.organization_id=m.organization_id and l.id=m.ledger_account_id and l.is_active and l.account_type=''expense'' where m.organization_id=e.organization_id and m.expense_category_id=v_exp.category_id;'||chr(10)||
  '  if v_expense is null then update public.finance_source_events set status=''pending'',last_error=''Map this expense category to an active expense ledger account'',updated_at=now() where id=e.id; return ''pending''; end if;'||chr(10)||
  '  if e.event_type=''expense_edit'' then';
 if position('finance_expense_category_mappings' in d)=0 then
  if position(old_text in d)=0 then raise exception 'Expense mapping insertion point not found'; end if;
  d:=replace(d,old_text,new_text);
 end if;
 execute d;
end $$;

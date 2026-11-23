-- Invitation and organisation-audit security contract.
-- Static/live catalog assertions only; no Auth users, memberships or invitations are created.
do $$
declare
  v_rpc text;
  v_accept text;
  v_bootstrap text;
  v_trigger text;
  v_policy text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='organization_invitations' and c.relrowsecurity
  ) then raise exception 'FAIL: invitation RLS is not enabled'; end if;

  if has_table_privilege('anon','public.organization_invitations','select')
     or has_table_privilege('authenticated','public.organization_invitations','select')
     or has_table_privilege('authenticated','public.organization_invitations','insert')
     or has_table_privilege('authenticated','public.organization_invitations','update')
     or has_table_privilege('authenticated','public.organization_invitations','delete') then
    raise exception 'FAIL: invitation table is directly accessible to clients'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='organization_invitations_one_pending_per_email'
  ) then raise exception 'FAIL: pending invitation uniqueness guard missing'; end if;

  if has_function_privilege('anon','public.create_organization_invitation(uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated','public.create_organization_invitation(uuid,text,text,uuid)','execute')
     or not has_function_privilege('service_role','public.create_organization_invitation(uuid,text,text,uuid)','execute') then
    raise exception 'FAIL: invitation RPC must be service-role-only'; end if;

  if to_regprocedure('public.attach_pending_organization_invitation(uuid)') is not null then
    raise exception 'FAIL: obsolete immediate-attachment helper still exists'; end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='organization_audit_log' and c.relrowsecurity
  ) then raise exception 'FAIL: organisation audit RLS is not enabled'; end if;

  if has_table_privilege('anon','public.organization_audit_log','select')
     or not has_table_privilege('authenticated','public.organization_audit_log','select')
     or has_table_privilege('authenticated','public.organization_audit_log','insert')
     or has_table_privilege('authenticated','public.organization_audit_log','update')
     or has_table_privilege('authenticated','public.organization_audit_log','delete') then
    raise exception 'FAIL: organisation audit table grants are not read-only authenticated'; end if;

  select qual into v_policy from pg_policies
  where schemaname='public' and tablename='organization_audit_log'
    and policyname='organization_audit_log_owner_admin_read';
  if v_policy is null or position('has_sales_role' in v_policy)=0
     or position('owner' in v_policy)=0 or position('admin' in v_policy)=0 then
    raise exception 'FAIL: organisation audit read policy must enforce owner/admin organisation membership'; end if;

  select pg_get_functiondef('public.create_organization_invitation(uuid,text,text,uuid)'::regprocedure)
    into v_rpc;
  if position('v_actor_role is distinct from ''owner''' in lower(v_rpc))=0
     or position('p_role not in (''manager'',''staff'')' in lower(v_rpc))=0
     or position('v_email = v_actor_email' in v_rpc)=0
     or position('email_confirmed_at' in lower(v_rpc))=0
     or position('insert into public.organization_audit_log' in lower(v_rpc))=0
     or position('finance_audit_log' in lower(v_rpc))>0
     or position(chr(92)||chr(92)||'.' in v_rpc)>0
     or position(chr(92)||'.' in v_rpc)=0 then
    raise exception 'FAIL: invitation RPC owner/role/self-invite/confirmation/audit contracts missing'; end if;

  select pg_get_functiondef('public.accept_confirmed_organization_invitations()'::regprocedure)
    into v_accept;
  if position('email_confirmed_at' in lower(v_accept))=0
     or position('status=''accepted''' in lower(v_accept))=0
     or position('invitation_accepted' in v_accept)=0
     or position('membership_provisioned' in v_accept)=0
     or position('finance_audit_log' in lower(v_accept))>0 then
    raise exception 'FAIL: acceptance trigger must require confirmed email and write separate audit events'; end if;

  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_bootstrap;
  if position('organization_invitations' in lower(v_bootstrap))>0
     or position('organization_memberships' in lower(v_bootstrap))>0 then
    raise exception 'FAIL: Auth user creation must not provision invited memberships'; end if;

  select pg_get_triggerdef(t.oid) into v_trigger
  from pg_trigger t
  where t.tgrelid='auth.users'::regclass and t.tgname='on_auth_user_email_confirmed';
  if v_trigger is null
     or position('after update of email_confirmed_at' in lower(v_trigger))=0
     or position('old.email_confirmed_at is null' in lower(v_trigger))=0
     or position('new.email_confirmed_at is not null' in lower(v_trigger))=0 then
    raise exception 'FAIL: Auth acceptance trigger must fire only on first email confirmation'; end if;

  raise notice 'PASS: invitation RPC grants, owner and role enforcement, self-invite protection, duplicate guard, organisation audit RLS/isolation, Auth confirmation lifecycle, and no finance-audit writes';
end $$;

-- Static security contract checks for migration 0014.
-- These tests do not fabricate Auth sessions or alter tenant memberships.
do $$
declare
  v record;
  v_def text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='organization_invitations' and c.relrowsecurity
  ) then raise exception 'FAIL: invitation table must have RLS enabled'; end if;

  if has_table_privilege('anon','public.organization_invitations','select')
     or has_table_privilege('authenticated','public.organization_invitations','insert')
     or has_table_privilege('authenticated','public.organization_invitations','update')
     or has_table_privilege('authenticated','public.organization_invitations','delete') then
    raise exception 'FAIL: direct invitation table access must be revoked';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='organization_invitations_one_pending_per_email'
  ) then raise exception 'FAIL: duplicate pending invitation guard is missing'; end if;

  select pg_get_functiondef('public.create_organization_invitation(uuid,text,text)'::regprocedure) into v_def;
  if position('auth.uid()' in v_def)=0
     or position('v_actor_role is distinct from ''owner''' in lower(v_def))=0
     or position('p_role not in (''manager'',''staff'')' in lower(v_def))=0
     or position('organization_memberships' in v_def)=0 then
    raise exception 'FAIL: owner, role and membership checks must remain in the server RPC';
  end if;

  select prosecdef,proconfig into v
  from pg_proc where oid='public.create_organization_invitation(uuid,text,text)'::regprocedure;
  if not v.prosecdef or not ('search_path=""' = any(v.proconfig)) then
    raise exception 'FAIL: invitation RPC must be SECURITY DEFINER with empty search_path';
  end if;

  if has_function_privilege('anon','public.create_organization_invitation(uuid,text,text)','execute')
     or not has_function_privilege('authenticated','public.create_organization_invitation(uuid,text,text)','execute') then
    raise exception 'FAIL: invitation RPC execute grants are incorrect';
  end if;

  if has_function_privilege('authenticated','public.attach_pending_organization_invitation(uuid)','execute')
     or has_function_privilege('anon','public.attach_pending_organization_invitation(uuid)','execute')
     or not has_function_privilege('service_role','public.attach_pending_organization_invitation(uuid)','execute') then
    raise exception 'FAIL: privileged attachment helper must be service-role-only';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='auth' and c.relname='users' and t.tgname='on_auth_user_created'
  ) then raise exception 'FAIL: Auth user creation trigger is missing'; end if;

  raise notice 'PASS: invitation RLS, grants, owner/role checks, deduplication and Auth trigger contracts';
end $$;

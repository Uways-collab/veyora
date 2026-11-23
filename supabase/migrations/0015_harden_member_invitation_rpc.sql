-- Harden invitation RPC: callable only with the server-side service role.
-- The Edge Function verifies the caller's Supabase Auth JWT and passes that
-- verified user id; this keeps SECURITY DEFINER out of the authenticated API surface.

drop function if exists public.create_organization_invitation(uuid,text,text);

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := p_actor_id;
  v_actor_role text;
  v_actor_email text;
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_target_user uuid;
  v_membership_id uuid;
  v_invitation_id uuid;
  v_existing_role text;
  v_inserted boolean := false;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true),''),
    (nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'role')
  ) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'Verified Auth actor is required' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'Organisation context is required' using errcode = '22023';
  end if;
  if p_role not in ('manager','staff') then
    raise exception 'Invited role must be manager or staff' using errcode = '22023';
  end if;
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' or length(v_email) > 254 then
    raise exception 'A valid email address is required' using errcode = '22023';
  end if;

  perform 1 from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  select m.role into v_actor_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id and m.user_id = v_actor
  for update;
  if v_actor_role is distinct from 'owner' then
    raise exception 'Only an organisation owner can invite or add members' using errcode = '42501';
  end if;

  select lower(u.email) into v_actor_email from auth.users u where u.id = v_actor;
  if v_email = v_actor_email then
    raise exception 'You cannot invite yourself or assign yourself a member role' using errcode = '42501';
  end if;

  select u.id into v_target_user
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at
  limit 1;

  if v_target_user is not null then
    if exists (
      select 1 from public.organization_memberships m
      where m.organization_id = p_organization_id and m.user_id = v_target_user
    ) then
      raise exception 'This user is already a member of the organisation' using errcode = '23505';
    end if;

    insert into public.organization_memberships (organization_id,user_id,role)
    values (p_organization_id,v_target_user,p_role)
    returning id into v_membership_id;

    insert into public.finance_audit_log
      (organization_id,actor_id,action,entity_type,entity_id,details)
    values
      (p_organization_id,v_actor,'member_added','organization_membership',v_membership_id,
       jsonb_build_object('email',v_email,'role',p_role,'user_id',v_target_user));

    return jsonb_build_object('status','added','membership_id',v_membership_id,'role',p_role);
  end if;

  update public.organization_invitations
  set status='revoked'
  where organization_id=p_organization_id and email=v_email and status='pending' and expires_at <= now();

  insert into public.organization_invitations (organization_id,email,role,invited_by)
  values (p_organization_id,v_email,p_role,v_actor)
  on conflict (organization_id,email) where status = 'pending' do nothing
  returning id into v_invitation_id;

  if v_invitation_id is null then
    select i.id,i.role into v_invitation_id,v_existing_role
    from public.organization_invitations i
    where i.organization_id = p_organization_id and i.email = v_email and i.status = 'pending'
    for update;
    if v_existing_role is distinct from p_role then
      raise exception 'A pending invitation already exists with a different role' using errcode = '23505';
    end if;
  else
    v_inserted := true;
    insert into public.finance_audit_log
      (organization_id,actor_id,action,entity_type,entity_id,details)
    values
      (p_organization_id,v_actor,'member_invited','organization_invitation',v_invitation_id,
       jsonb_build_object('email',v_email,'role',p_role));
  end if;

  return jsonb_build_object('status','invited','invitation_id',v_invitation_id,'role',p_role,
    'already_pending',not v_inserted);
end;
$$;

revoke all on function public.create_organization_invitation(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text,uuid) to service_role;

drop policy if exists organization_invitations_deny_client_access on public.organization_invitations;
create policy organization_invitations_deny_client_access
  on public.organization_invitations
  for all to anon, authenticated
  using (false)
  with check (false);

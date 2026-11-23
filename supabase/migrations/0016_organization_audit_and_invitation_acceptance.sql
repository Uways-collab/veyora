-- Dedicated organisation audit stream and invitation acceptance lifecycle.
-- Supabase inviteUserByEmail creates an unconfirmed Auth user. The invitation
-- is accepted only when Auth confirms the invited email (email_confirmed_at
-- transitions from NULL to a timestamp), not when auth.users is first inserted.

create table if not exists public.organization_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'invitation_created',
    'membership_provisioned',
    'invitation_accepted'
  )),
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists organization_audit_log_org_created_idx
  on public.organization_audit_log (organization_id, created_at desc);
create index if not exists organization_audit_log_entity_idx
  on public.organization_audit_log (organization_id, entity_type, entity_id);

alter table public.organization_audit_log enable row level security;
revoke all on public.organization_audit_log from public, anon, authenticated;
grant select on public.organization_audit_log to authenticated;

drop policy if exists organization_audit_log_owner_admin_read on public.organization_audit_log;
create policy organization_audit_log_owner_admin_read
  on public.organization_audit_log
  for select
  to authenticated
  using (public.has_sales_role(organization_id, array['owner','admin']::text[]));

-- The browser cannot call this RPC. The Edge Function supplies the actor ID
-- only after validating the caller's JWT with Supabase Auth.
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
  v_target_confirmed_at timestamptz;
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
  if v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$' or length(v_email) > 254 then
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

  select u.id, u.email_confirmed_at
    into v_target_user, v_target_confirmed_at
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at
  limit 1;

  -- A pre-existing, confirmed account can be provisioned immediately by the
  -- owner. An unconfirmed account must complete Auth email confirmation first.
  if v_target_user is not null and v_target_confirmed_at is not null then
    if exists (
      select 1 from public.organization_memberships m
      where m.organization_id = p_organization_id and m.user_id = v_target_user
    ) then
      raise exception 'This user is already a member of the organisation' using errcode = '23505';
    end if;

    insert into public.organization_memberships (organization_id,user_id,role)
    values (p_organization_id,v_target_user,p_role)
    returning id into v_membership_id;

    insert into public.organization_audit_log
      (organization_id,actor_id,action,entity_type,entity_id,details)
    values
      (p_organization_id,v_actor,'membership_provisioned','organization_membership',v_membership_id,
       jsonb_build_object('email',v_email,'role',p_role,'user_id',v_target_user,
         'provisioning_method','existing_confirmed_account'));

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
    insert into public.organization_audit_log
      (organization_id,actor_id,action,entity_type,entity_id,details)
    values
      (p_organization_id,v_actor,'invitation_created','organization_invitation',v_invitation_id,
       jsonb_build_object('email',v_email,'role',p_role));
  end if;

  return jsonb_build_object('status','invited','invitation_id',v_invitation_id,
    'role',p_role,'already_pending',not v_inserted,'target_user_id',v_target_user,
    'requires_email_confirmation',v_target_user is not null);
end;
$$;

revoke all on function public.create_organization_invitation(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_organization_invitation(uuid,text,text,uuid) to service_role;

-- Remove the previous helper that provisioned membership immediately after
-- Auth user creation. Membership must wait for verified email confirmation.
drop function if exists public.attach_pending_organization_invitation(uuid);

-- Preserve the existing profile bootstrap. It must not consume invitations.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.accept_confirmed_organization_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations%rowtype;
  v_membership_id uuid;
  v_inserted boolean;
begin
  if new.email is null or new.email_confirmed_at is null
     or old.email_confirmed_at is not null then
    return new;
  end if;

  for v_inv in
    select i.*
    from public.organization_invitations i
    where i.email = lower(new.email)
      and i.status = 'pending'
      and i.expires_at > now()
    order by i.created_at, i.id
    for update
  loop
    v_membership_id := null;
    insert into public.organization_memberships (organization_id,user_id,role)
    values (v_inv.organization_id,new.id,v_inv.role)
    on conflict (organization_id,user_id) do nothing
    returning id into v_membership_id;
    v_inserted := v_membership_id is not null;

    if v_membership_id is null then
      select m.id into v_membership_id
      from public.organization_memberships m
      where m.organization_id = v_inv.organization_id and m.user_id = new.id;
    end if;

    update public.organization_invitations
    set status='accepted',accepted_user_id=new.id,
        membership_id=v_membership_id,accepted_at=now()
    where id=v_inv.id and status='pending';

    if v_inserted then
      insert into public.organization_audit_log
        (organization_id,actor_id,action,entity_type,entity_id,details)
      values
        (v_inv.organization_id,new.id,'membership_provisioned',
         'organization_membership',v_membership_id,
         jsonb_build_object('email',v_inv.email,'role',v_inv.role,
           'invited_by',v_inv.invited_by,'invitation_id',v_inv.id,
           'provisioning_method','confirmed_invitation'));
    end if;

    insert into public.organization_audit_log
      (organization_id,actor_id,action,entity_type,entity_id,details)
    values
      (v_inv.organization_id,new.id,'invitation_accepted',
       'organization_invitation',v_inv.id,
       jsonb_build_object('email',v_inv.email,'role',v_inv.role,
         'membership_id',v_membership_id));
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.accept_confirmed_organization_invitations();

revoke all on function public.accept_confirmed_organization_invitations() from public,anon,authenticated;

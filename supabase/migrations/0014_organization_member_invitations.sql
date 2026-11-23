-- Owner-authorised organisation member invitation and attachment.
-- The browser never writes membership or invitation rows directly.

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  role text not null check (role in ('manager','staff')),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  accepted_user_id uuid references auth.users(id),
  membership_id uuid references public.organization_memberships(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  constraint organization_invitations_acceptance_consistency check (
    (status = 'accepted' and accepted_user_id is not null and membership_id is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_user_id is null and membership_id is null and accepted_at is null)
  )
);

create unique index if not exists organization_invitations_one_pending_per_email
  on public.organization_invitations (organization_id, email)
  where status = 'pending';
create index if not exists organization_invitations_pending_email_idx
  on public.organization_invitations (email, created_at)
  where status = 'pending';

alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_target_user uuid;
  v_membership_id uuid;
  v_invitation_id uuid;
  v_inserted boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
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

  -- Lock the tenant first so membership and invitation creation serialize per organisation.
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

  insert into public.organization_invitations (organization_id,email,role,invited_by)
  values (p_organization_id,v_email,p_role,v_actor)
  on conflict (organization_id,email) where status = 'pending' do nothing
  returning id into v_invitation_id;

  if v_invitation_id is null then
    select i.id into v_invitation_id
    from public.organization_invitations i
    where i.organization_id = p_organization_id and i.email = v_email and i.status = 'pending'
    for update;
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

revoke all on function public.create_organization_invitation(uuid,text,text) from public,anon;
grant execute on function public.create_organization_invitation(uuid,text,text) to authenticated;

-- Restricted helper used only by the server-side Edge Function for a rare
-- email-registration race between the owner RPC and Auth invitation creation.
create or replace function public.attach_pending_organization_invitation(
  p_invitation_id uuid,
  p_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations%rowtype;
  v_user_email text;
  v_membership_id uuid;
  v_inserted boolean := false;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into v_inv
  from public.organization_invitations
  where id = p_invitation_id and status = 'pending' and expires_at > now()
  for update;
  if not found then
    raise exception 'Pending invitation not found or expired' using errcode = 'P0002';
  end if;

  select lower(u.email) into v_user_email from auth.users u where u.id = p_user_id;
  if v_user_email is null or v_user_email <> v_inv.email then
    raise exception 'Auth user email does not match the invitation' using errcode = '42501';
  end if;

  insert into public.organization_memberships (organization_id,user_id,role)
  values (v_inv.organization_id,p_user_id,v_inv.role)
  on conflict (organization_id,user_id) do nothing
  returning id into v_membership_id;

  if v_membership_id is not null then
    v_inserted := true;
  else
    select m.id into v_membership_id from public.organization_memberships m
    where m.organization_id = v_inv.organization_id and m.user_id = p_user_id;
  end if;

  update public.organization_invitations
  set status='accepted',accepted_user_id=p_user_id,membership_id=v_membership_id,accepted_at=now()
  where id=v_inv.id;

  if v_inserted then
    insert into public.finance_audit_log
      (organization_id,actor_id,action,entity_type,entity_id,details)
    values
      (v_inv.organization_id,v_inv.invited_by,'member_added','organization_membership',v_membership_id,
       jsonb_build_object('email',v_inv.email,'role',v_inv.role,'user_id',p_user_id,'invitation_id',v_inv.id));
  end if;

  return v_membership_id;
end;
$$;

revoke all on function public.attach_pending_organization_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.attach_pending_organization_invitation(uuid,uuid) to service_role;

-- Existing Auth users invited by email are attached by the same trusted Auth trigger
-- that creates their profile. It consumes only a live, owner-created pending invite
-- whose email exactly matches auth.users.email; user metadata is never trusted.
create or replace function public.handle_new_user()
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
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;

  if new.email is null then
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
    set status='accepted',accepted_user_id=new.id,membership_id=v_membership_id,accepted_at=now()
    where id=v_inv.id;

    if v_inserted then
      insert into public.finance_audit_log
        (organization_id,actor_id,action,entity_type,entity_id,details)
      values
        (v_inv.organization_id,v_inv.invited_by,'member_added','organization_membership',v_membership_id,
         jsonb_build_object('email',v_inv.email,'role',v_inv.role,'user_id',new.id,'invitation_id',v_inv.id));
    end if;
  end loop;

  return new;
end;
$$;

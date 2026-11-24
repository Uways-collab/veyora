-- Persist each member's guided-tour choice and progress per organisation.
create table if not exists public.onboarding_tour_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','skipped')),
  current_step integer not null default 0 check (current_step >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists onboarding_tour_progress_user_org_idx
  on public.onboarding_tour_progress (user_id, organization_id);

alter table public.onboarding_tour_progress enable row level security;

create policy "Members can read their own onboarding tour progress"
  on public.onboarding_tour_progress for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = onboarding_tour_progress.organization_id
        and m.user_id = (select auth.uid())
    )
  );

create policy "Members can create their own onboarding tour progress"
  on public.onboarding_tour_progress for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = onboarding_tour_progress.organization_id
        and m.user_id = (select auth.uid())
    )
  );

create policy "Members can update their own onboarding tour progress"
  on public.onboarding_tour_progress for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = onboarding_tour_progress.organization_id
        and m.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = onboarding_tour_progress.organization_id
        and m.user_id = (select auth.uid())
    )
  );

grant select, insert, update on public.onboarding_tour_progress to authenticated;

-- Hotel operations expansion: rooms, room availability, and housekeeping.
-- Additive only: existing reservation rows remain valid because room_id is nullable.

create extension if not exists btree_gist;

create table if not exists public.hotel_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_number text not null,
  room_type text not null default 'Standard',
  floor text,
  nightly_rate numeric(14,2) not null default 0 check (nightly_rate >= 0),
  status text not null default 'available'
    check (status in ('available','occupied','dirty','maintenance','out_of_service')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, room_number)
);

alter table public.hotel_reservations
  add column if not exists room_id uuid references public.hotel_rooms(id) on delete set null,
  add column if not exists nightly_rate numeric(14,2) not null default 0 check (nightly_rate >= 0),
  add column if not exists booking_source text not null default 'direct'
    check (booking_source in ('direct','phone','walk_in','online_travel_agency','corporate','other')),
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','partially_paid','paid','refunded','waived'));

-- Prevent two active bookings from occupying the same room over overlapping dates.
-- Existing legacy reservations without a room_id are not affected.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hotel_reservations_room_no_overlap'
      and conrelid = 'public.hotel_reservations'::regclass
  ) then
    alter table public.hotel_reservations
      add constraint hotel_reservations_room_no_overlap
      exclude using gist (
        organization_id with =,
        room_id with =,
        daterange(check_in, check_out, '[)') with &&
      )
      where (room_id is not null and status in ('booked','checked_in'));
  end if;
end $$;

create table if not exists public.hotel_housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  room_id uuid references public.hotel_rooms(id) on delete set null,
  room_label text not null,
  task_type text not null default 'room_cleaning'
    check (task_type in ('room_cleaning','room_turnover','deep_clean','inspection','maintenance')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assigned_to text,
  due_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','in_progress','completed','inspected','cancelled')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hotel_rooms_org_status_idx
  on public.hotel_rooms(organization_id, status, room_number);
create index if not exists hotel_housekeeping_org_status_idx
  on public.hotel_housekeeping_tasks(organization_id, status, priority, due_at);

do $$
declare t text;
begin
  foreach t in array array['hotel_rooms','hotel_housekeeping_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid())))',
      t || '_member_select', t, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_staff_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager'',''staff'')))',
      t || '_staff_insert', t, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_manager_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager''))) with check (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',
      t || '_manager_update', t, t, t
    );
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.organization_memberships m where m.organization_id = %I.organization_id and m.user_id = (select auth.uid()) and m.role in (''owner'',''admin'')))',
      t || '_admin_delete', t, t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

drop trigger if exists hotel_rooms_updated_at on public.hotel_rooms;
create trigger hotel_rooms_updated_at before update on public.hotel_rooms
for each row execute function public.set_industry_record_updated_at();

drop trigger if exists hotel_housekeeping_tasks_updated_at on public.hotel_housekeeping_tasks;
create trigger hotel_housekeeping_tasks_updated_at before update on public.hotel_housekeeping_tasks
for each row execute function public.set_industry_record_updated_at();

grant select, insert, update, delete on public.hotel_reservations to authenticated;

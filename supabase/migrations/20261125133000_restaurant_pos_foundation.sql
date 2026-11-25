-- Restaurant POS foundation: tenant-safe menu, tables and itemised order lines.
create table if not exists public.restaurant_menu_categories (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, sort_order integer not null default 0, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,organization_id), unique(organization_id,name)
);
create table if not exists public.restaurant_menu_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 category_id uuid, name text not null, description text, sku text, price numeric(14,2) not null check(price>=0),
 cost_price numeric(14,2) not null default 0 check(cost_price>=0),
 prep_station text not null default 'kitchen' check(prep_station in ('kitchen','bar','dessert','other')),
 is_available boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,organization_id), unique(organization_id,sku),
 constraint restaurant_menu_items_category_tenant_fk foreign key(category_id,organization_id)
 references public.restaurant_menu_categories(id,organization_id) on delete set null (category_id)
);
create table if not exists public.restaurant_tables (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 table_number text not null, seats integer not null default 2 check(seats>0),
 status text not null default 'available' check(status in ('available','occupied','reserved','out_of_service')),
 notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,organization_id), unique(organization_id,table_number)
);
create unique index if not exists restaurant_orders_id_org_uidx on public.restaurant_orders(id,organization_id);
alter table public.restaurant_orders add column if not exists table_id uuid;
alter table public.restaurant_orders add column if not exists covers integer not null default 1 check(covers>0);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='restaurant_orders_table_tenant_fk') then
  alter table public.restaurant_orders add constraint restaurant_orders_table_tenant_fk
  foreign key(table_id,organization_id) references public.restaurant_tables(id,organization_id) on delete set null (table_id);
 end if;
end $$;
create table if not exists public.restaurant_order_items (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 order_id uuid not null, menu_item_id uuid, item_name text not null, quantity numeric(12,3) not null check(quantity>0),
 unit_price numeric(14,2) not null check(unit_price>=0),
 line_total numeric(14,2) generated always as (round(quantity*unit_price,2)) stored,
 modifiers text, notes text, created_at timestamptz not null default now(),
 constraint restaurant_order_items_order_tenant_fk foreign key(order_id,organization_id)
 references public.restaurant_orders(id,organization_id) on delete cascade,
 constraint restaurant_order_items_menu_tenant_fk foreign key(menu_item_id,organization_id)
 references public.restaurant_menu_items(id,organization_id) on delete set null (menu_item_id)
);
create index if not exists restaurant_menu_items_org_category_idx on public.restaurant_menu_items(organization_id,category_id,is_available);
create index if not exists restaurant_tables_org_status_idx on public.restaurant_tables(organization_id,status);
create index if not exists restaurant_order_items_org_order_idx on public.restaurant_order_items(organization_id,order_id);

create or replace function public.restaurant_recalculate_order_totals()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare target_order uuid; target_org uuid;
begin
 target_order:=coalesce(new.order_id,old.order_id); target_org:=coalesce(new.organization_id,old.organization_id);
 if auth.uid() is null or not exists(select 1 from public.organization_memberships m join public.organization_business_types b
  on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary
  where m.organization_id=target_org and m.user_id=auth.uid()) then
  raise exception 'Restaurant workspace access denied' using errcode='42501';
 end if;
 update public.restaurant_orders o set
  total_amount=coalesce((select sum(i.line_total) from public.restaurant_order_items i where i.order_id=target_order and i.organization_id=target_org),0),
  items_summary=coalesce((select string_agg(i.quantity::text||' × '||i.item_name,', ' order by i.created_at) from public.restaurant_order_items i where i.order_id=target_order and i.organization_id=target_org),'Itemised order')
 where o.id=target_order and o.organization_id=target_org;
 return coalesce(new,old);
end $$;
revoke all on function public.restaurant_recalculate_order_totals() from public,anon,authenticated;
drop trigger if exists restaurant_order_items_recalculate_totals on public.restaurant_order_items;
create trigger restaurant_order_items_recalculate_totals after insert or update or delete on public.restaurant_order_items
for each row execute function public.restaurant_recalculate_order_totals();

create or replace function public.restaurant_sync_table_occupancy()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organization_memberships m join public.organization_business_types b
  on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary
  where m.organization_id=new.organization_id and m.user_id=auth.uid()) then
  raise exception 'Restaurant workspace access denied' using errcode='42501';
 end if;
 if new.table_id is not null and new.order_type='dine_in' then
  update public.restaurant_tables t set status=case when new.status in ('completed','cancelled') then 'available' else 'occupied' end
  where t.id=new.table_id and t.organization_id=new.organization_id;
 end if;
 if tg_op='UPDATE' and old.table_id is not null and (old.table_id is distinct from new.table_id or new.status in ('completed','cancelled')) then
  update public.restaurant_tables t set status='available' where t.id=old.table_id and t.organization_id=old.organization_id
  and not exists(select 1 from public.restaurant_orders o where o.table_id=old.table_id and o.organization_id=old.organization_id
   and o.id<>new.id and o.order_type='dine_in' and o.status not in ('completed','cancelled'));
 end if;
 return new;
end $$;
revoke all on function public.restaurant_sync_table_occupancy() from public,anon,authenticated;
drop trigger if exists restaurant_orders_sync_table_occupancy on public.restaurant_orders;
create trigger restaurant_orders_sync_table_occupancy after insert or update of table_id,order_type,status on public.restaurant_orders
for each row execute function public.restaurant_sync_table_occupancy();

do $$ declare t text;
begin
 foreach t in array array['restaurant_menu_categories','restaurant_menu_items','restaurant_tables','restaurant_order_items'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists %I on public.%I',t||'_member_select',t);
  execute format('create policy %I on public.%I for select to authenticated using (exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type=''restaurant'' and b.is_primary where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())))',t||'_member_select',t,t);
  execute format('drop policy if exists %I on public.%I',t||'_member_insert',t);
  execute format('create policy %I on public.%I for insert to authenticated with check (exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type=''restaurant'' and b.is_primary where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'',''staff'')))',t||'_member_insert',t,t);
  execute format('drop policy if exists %I on public.%I',t||'_manager_update',t);
  execute format('create policy %I on public.%I for update to authenticated using (exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type=''restaurant'' and b.is_primary where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager''))) with check (exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type=''restaurant'' and b.is_primary where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t||'_manager_update',t,t,t);
  execute format('drop policy if exists %I on public.%I',t||'_admin_delete',t);
  execute format('create policy %I on public.%I for delete to authenticated using (exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type=''restaurant'' and b.is_primary where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'')))',t||'_admin_delete',t,t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 end loop;
end $$;
drop policy if exists restaurant_orders_member_select on public.restaurant_orders;
create policy restaurant_orders_member_select on public.restaurant_orders for select to authenticated using
(exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary where m.organization_id=restaurant_orders.organization_id and m.user_id=(select auth.uid())));
drop policy if exists restaurant_orders_member_insert on public.restaurant_orders;
create policy restaurant_orders_member_insert on public.restaurant_orders for insert to authenticated with check
(exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary where m.organization_id=restaurant_orders.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager','staff')));
drop policy if exists restaurant_orders_manager_update on public.restaurant_orders;
create policy restaurant_orders_manager_update on public.restaurant_orders for update to authenticated using
(exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary where m.organization_id=restaurant_orders.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')))
with check
(exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary where m.organization_id=restaurant_orders.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')));
drop policy if exists restaurant_orders_admin_delete on public.restaurant_orders;
create policy restaurant_orders_admin_delete on public.restaurant_orders for delete to authenticated using
(exists(select 1 from public.organization_memberships m join public.organization_business_types b on b.organization_id=m.organization_id and b.business_type='restaurant' and b.is_primary where m.organization_id=restaurant_orders.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')));

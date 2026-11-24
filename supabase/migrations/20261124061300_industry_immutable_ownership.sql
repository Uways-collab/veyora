-- Prevent reassignment of specialist records across workspaces or users.
create or replace function public.validate_industry_record_ownership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Specialist records cannot be moved between organisations' using errcode = '23514';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Specialist record creator cannot be reassigned' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_industry_record_ownership() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hotel_reservations','dealer_vehicles','real_estate_leases','restaurant_orders','delivery_jobs','manufacturing_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable_owner', t);
    execute format('create trigger %I before update of organization_id, created_by on public.%I for each row execute function public.validate_industry_record_ownership()', t || '_immutable_owner', t);
  end loop;
end $$;

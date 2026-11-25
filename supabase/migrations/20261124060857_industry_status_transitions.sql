-- Enforce valid specialist workflow state transitions at the database boundary.
create or replace function public.validate_industry_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  allowed_next text[];
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  case tg_table_name
    when 'hotel_reservations' then
      allowed_next := case old.status
        when 'booked' then array['checked_in','cancelled','no_show']
        when 'checked_in' then array['checked_out']
        else array[]::text[] end;
    when 'dealer_vehicles' then
      allowed_next := case old.status
        when 'in_stock' then array['reserved','sold','in_service']
        when 'reserved' then array['in_stock','sold']
        when 'in_service' then array['in_stock']
        else array[]::text[] end;
    when 'real_estate_leases' then
      allowed_next := case old.status
        when 'draft' then array['active','terminated']
        when 'active' then array['ended','terminated']
        else array[]::text[] end;
    when 'restaurant_orders' then
      allowed_next := case old.status
        when 'new' then array['accepted','cancelled']
        when 'accepted' then array['preparing','cancelled']
        when 'preparing' then array['ready','cancelled']
        when 'ready' then array['served','cancelled']
        when 'served' then array['completed']
        else array[]::text[] end;
    when 'delivery_jobs' then
      allowed_next := case old.status
        when 'pending' then array['assigned','failed']
        when 'assigned' then array['in_transit','failed']
        when 'in_transit' then array['delivered','failed','returned']
        when 'failed' then array['pending']
        else array[]::text[] end;
    when 'manufacturing_orders' then
      allowed_next := case old.status
        when 'planned' then array['released','cancelled']
        when 'released' then array['in_progress','cancelled']
        when 'in_progress' then array['quality_check','cancelled']
        when 'quality_check' then array['completed','in_progress']
        else array[]::text[] end;
    else
      raise exception 'Unsupported specialist workflow table: %', tg_table_name using errcode = '23514';
  end case;

  if not (new.status = any(allowed_next)) then
    raise exception 'Invalid % workflow transition: % -> %', tg_table_name, old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_industry_status_transition() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hotel_reservations','dealer_vehicles','real_estate_leases','restaurant_orders','delivery_jobs','manufacturing_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_status_transition', t);
    execute format('create trigger %I before update of status on public.%I for each row execute function public.validate_industry_status_transition()', t || '_status_transition', t);
  end loop;
end $$;

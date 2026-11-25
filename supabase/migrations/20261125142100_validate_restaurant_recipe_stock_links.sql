create or replace function private.restaurant_validate_recipe_stock_link()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if not exists(
    select 1 from public.product_variants pv
    join public.products p on p.id=pv.product_id and p.organization_id=pv.organization_id
    where pv.id=new.variant_id and pv.organization_id=new.organization_id
      and pv.is_active=true and p.is_active=true and p.product_type='physical'
  ) then
    raise exception 'Restaurant recipes must use an active physical inventory item from this business.'
      using errcode='23514';
  end if;
  if not exists(
    select 1 from public.inventory_locations l
    where l.id=new.location_id and l.organization_id=new.organization_id and l.is_active=true
  ) then
    raise exception 'Choose an active inventory location belonging to this business.'
      using errcode='23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.restaurant_validate_recipe_stock_link() from public,anon,authenticated;
drop trigger if exists restaurant_validate_recipe_stock_link on public.restaurant_recipe_ingredients;
create trigger restaurant_validate_recipe_stock_link
before insert or update on public.restaurant_recipe_ingredients
for each row execute function private.restaurant_validate_recipe_stock_link();

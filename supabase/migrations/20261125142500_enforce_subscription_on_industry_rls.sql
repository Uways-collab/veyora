-- Every specialist table policy must require an active subscription, not just a matching membership.
do $function$
declare
  p record;
  new_using text;
  new_check text;
  using_sql text;
  check_sql text;
  command_sql text;
begin
  for p in
    select c.relname as table_name,pol.polname,pol.polcmd,
      pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) as using_expression,
      pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid) as check_expression
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid=pol.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in (
        'hotel_rooms','hotel_reservations','hotel_housekeeping_tasks',
        'dealer_vehicles','dealer_leads','dealer_test_drives','dealer_deals','dealer_service_jobs','dealer_payments',
        'real_estate_leases','restaurant_orders','restaurant_menu_categories','restaurant_menu_items','restaurant_tables',
        'restaurant_order_items','restaurant_order_payments','restaurant_recipe_ingredients',
        'delivery_jobs','manufacturing_orders'
      )
  loop
    new_using:=p.using_expression;
    new_check:=p.check_expression;
    if new_using is not null and position('organization_has_access' in new_using)=0 then
      new_using:='('||new_using||') AND private.organization_has_access('||quote_ident(p.table_name)||'.organization_id,''industry'')';
    end if;
    if new_check is not null and position('organization_has_access' in new_check)=0 then
      new_check:='('||new_check||') AND private.organization_has_access('||quote_ident(p.table_name)||'.organization_id,''industry'')';
    end if;
    using_sql:=case when new_using is null then '' else ' USING ('||new_using||')' end;
    check_sql:=case when new_check is null then '' else ' WITH CHECK ('||new_check||')' end;
    if new_using is distinct from p.using_expression or new_check is distinct from p.check_expression then
      command_sql:=format('ALTER POLICY %I ON public.%I%s%s',p.polname,p.table_name,using_sql,check_sql);
      execute command_sql;
    end if;
  end loop;
end;
$function$;

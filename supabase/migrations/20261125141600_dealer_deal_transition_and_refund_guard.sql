-- Enforce dealership deal state transitions and prevent silently cancelling paid deals.
create or replace function private.dealer_guard_payment_derived_fields()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  completion_allowed boolean := coalesce(pg_catalog.current_setting('veyora.dealer_completion_rpc',true),'')='allowed';
  payment_allowed boolean := coalesce(pg_catalog.current_setting('veyora.dealer_payment_rpc',true),'')='allowed';
begin
  if tg_op='INSERT' then
    if new.deposit_amount<>0 or new.status<>'draft' then
      raise exception 'New dealership deals must start unpaid in Draft. Record deposits through the verified payment workflow.'
        using errcode='42501';
    end if;
    return new;
  end if;

  if new.deposit_amount is distinct from old.deposit_amount and not payment_allowed then
    raise exception 'Deal payment totals can only be changed through the verified payment workflow.'
      using errcode='42501';
  end if;

  if new.status is distinct from old.status then
    if new.status='completed' and not completion_allowed then
      raise exception 'Deliveries must be completed through the verified delivery workflow.'
        using errcode='42501';
    end if;
    if new.status='cancelled' and old.deposit_amount>0 then
      raise exception 'A deal with recorded payments cannot be cancelled until a verified refund workflow is available.'
        using errcode='23514';
    end if;
    if new.status='ready_for_delivery' and new.deposit_amount<new.agreed_price then
      raise exception 'A deal cannot be marked ready for delivery before it is fully paid.'
        using errcode='23514';
    end if;
    if not (
      (old.status='draft' and new.status in ('reserved','awaiting_payment','ready_for_delivery','cancelled'))
      or (old.status='reserved' and new.status in ('awaiting_payment','ready_for_delivery','cancelled'))
      or (old.status='awaiting_payment' and new.status in ('ready_for_delivery','cancelled'))
      or (old.status='ready_for_delivery' and new.status='completed' and completion_allowed)
    ) then
      raise exception 'Invalid dealership deal transition: % to %.',old.status,new.status
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$function$;
revoke all on function private.dealer_guard_payment_derived_fields() from public,anon,authenticated;
drop trigger if exists dealer_deal_payment_completion_guard on public.dealer_deals;
create trigger dealer_deal_payment_completion_guard
before insert or update on public.dealer_deals
for each row execute function private.dealer_guard_payment_derived_fields();

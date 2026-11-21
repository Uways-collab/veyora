-- ============================================================================
-- Veyora Business — Customer-Aware Sales Checkout RPC (sales_v2_checkout)
-- ============================================================================
-- Adds public.sales_v2_checkout with an explicit 9-argument signature including
-- p_customer_id uuid, while leaving public.sales_v1_checkout completely untouched.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sales_v2_checkout(
  p_organization_id uuid,
  p_location_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_idempotency_key text,
  p_customer_name text,
  p_customer_phone text,
  p_order_discount_amount numeric,
  p_customer_id uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_currency text;
  v_sale_id uuid;
  v_sale_number text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_sale_id uuid;

  v_customer_id uuid := p_customer_id;
  v_customer_name text;
  v_customer_phone text;
  v_customer record;

  v_subtotal numeric(14,2) := 0;
  v_line_discount_total numeric(14,2) := 0;
  v_order_discount numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_paid numeric(14,2) := 0;

  v_item_count integer;
  v_valid_item_count integer;
  v_payment_count integer;
  v_valid_payment_count integer;
  v_physical_count integer;
  v_stock_count integer;

  v_line record;
  v_payment record;
  v_method record;

  v_discount numeric(14,2);
  v_base numeric(14,2);
  v_allocated numeric(14,2);
  v_allocated_total numeric(14,2) := 0;
  v_remaining_discount numeric(14,2);

  v_stock_before numeric;
  v_stock_after numeric;
  v_quantity numeric;
  v_reference text;
  v_payment_status text;

  v_lines jsonb;
  v_allocated_lines jsonb := '[]'::jsonb;
  v_line_json jsonb;
  v_index integer := 0;
BEGIN
  -- Authentication and permission
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner','admin','manager','staff']::text[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission to process sales';
  END IF;

  -- Validate request
  IF p_idempotency_key IS NULL
     OR btrim(p_idempotency_key) = ''
     OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one sale item is required';
  END IF;

  IF p_payments IS NULL
     OR jsonb_typeof(p_payments) <> 'array' THEN
    RAISE EXCEPTION 'Payments must be an array';
  END IF;

  IF COALESCE(p_order_discount_amount, 0) < 0
     OR COALESCE(p_order_discount_amount, 0)
        <> round(COALESCE(p_order_discount_amount, 0), 2) THEN
    RAISE EXCEPTION 'Invalid order discount amount';
  END IF;

  v_order_discount :=
    round(COALESCE(p_order_discount_amount, 0), 2);

  -- Validate organization and currency
  SELECT o.currency
  INTO v_currency
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF v_currency IS NULL OR btrim(v_currency) = '' THEN
    RAISE EXCEPTION 'Organization currency is not configured';
  END IF;

  -- Validate active location
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations l
    WHERE l.id = p_location_id
      AND l.organization_id = p_organization_id
      AND l.is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid or inactive sales location';
  END IF;

  -- Serialize requests using the same organization and idempotency key
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_idempotency_key,
      0
    )
  );

  v_request_hash := md5(
    jsonb_build_object(
      'location_id', p_location_id,
      'items', p_items,
      'payments', p_payments,
      'customer_id', p_customer_id,
      'customer_name', p_customer_name,
      'customer_phone', p_customer_phone,
      'order_discount_amount', v_order_discount
    )::text
  );

  SELECT s.id, s.request_hash
  INTO v_existing_sale_id, v_existing_hash
  FROM public.sales s
  WHERE s.organization_id = p_organization_id
    AND s.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash <> v_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was already used with different data';
    END IF;

    RETURN v_existing_sale_id;
  END IF;

  -- Validate registered customer (if supplied) or preserve walk-in details
  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.name, c.phone, c.is_active
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.organization_id = p_organization_id
    FOR SHARE OF c;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer does not exist in this organization';
    END IF;

    IF v_customer.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Selected customer is archived and cannot be used for checkout';
    END IF;

    v_customer_id := v_customer.id;
    v_customer_name := NULLIF(btrim(v_customer.name), '');
    v_customer_phone := NULLIF(btrim(v_customer.phone), '');

    IF v_customer_name IS NULL THEN
      RAISE EXCEPTION 'Selected customer does not have a valid name';
    END IF;
  ELSE
    v_customer_id := NULL;
    v_customer_name := NULLIF(btrim(p_customer_name), '');
    v_customer_phone := NULLIF(btrim(p_customer_phone), '');
  END IF;

  -- Validate item structure and reject duplicate variants
  SELECT count(*)
  INTO v_item_count
  FROM jsonb_to_recordset(p_items)
    AS x(variant_id uuid, quantity numeric, discount_amount numeric);

  IF v_item_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Invalid sale item data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items)
      AS x(variant_id uuid, quantity numeric, discount_amount numeric)
    GROUP BY x.variant_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A product variant can only appear once per sale';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items)
      AS x(variant_id uuid, quantity numeric, discount_amount numeric)
    WHERE x.variant_id IS NULL
       OR x.quantity IS NULL
       OR x.quantity <= 0
       OR COALESCE(x.discount_amount, 0) < 0
       OR COALESCE(x.discount_amount, 0)
          <> round(COALESCE(x.discount_amount, 0), 2)
  ) THEN
    RAISE EXCEPTION 'Invalid quantity or line discount';
  END IF;

  -- Lock variants before reading their prices and active status
  PERFORM pv.id
  FROM public.product_variants pv
  JOIN jsonb_to_recordset(p_items)
    AS x(variant_id uuid, quantity numeric, discount_amount numeric)
    ON x.variant_id = pv.id
  WHERE pv.organization_id = p_organization_id
  ORDER BY pv.id
  FOR SHARE OF pv;

  -- Lock parent products too
  PERFORM p.id
  FROM public.products p
  JOIN public.product_variants pv
    ON pv.product_id = p.id
   AND pv.organization_id = p_organization_id
  JOIN jsonb_to_recordset(p_items)
    AS x(variant_id uuid, quantity numeric, discount_amount numeric)
    ON x.variant_id = pv.id
  WHERE p.organization_id = p_organization_id
  ORDER BY p.id
  FOR SHARE OF p;

  -- Build trusted sale lines from database values
  SELECT
    count(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'variant_id', pv.id,
          'product_id', p.id,
          'product_name', p.name,
          'variant_name', pv.variant_name,
          'sku', pv.sku,
          'unit_of_measure', pv.unit_of_measure,
          'product_type', p.product_type,
          'quantity', x.quantity,
          'unit_price', pv.selling_price,
          'unit_cost', pv.cost_price,
          'line_subtotal', round(x.quantity * pv.selling_price, 2),
          'discount_amount', round(COALESCE(x.discount_amount, 0), 2)
        )
        ORDER BY pv.id
      ),
      '[]'::jsonb
    )
  INTO v_valid_item_count, v_lines
  FROM jsonb_to_recordset(p_items)
    AS x(variant_id uuid, quantity numeric, discount_amount numeric)
  JOIN public.product_variants pv
    ON pv.id = x.variant_id
   AND pv.organization_id = p_organization_id
  JOIN public.products p
    ON p.id = pv.product_id
   AND p.organization_id = p_organization_id
  WHERE pv.is_active = true
    AND p.is_active = true
    AND pv.selling_price > 0
    AND p.product_type IN ('physical','service');

  IF v_valid_item_count <> v_item_count THEN
    RAISE EXCEPTION 'One or more products are unavailable or invalid';
  END IF;

  -- Validate discounts and calculate totals
  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(v_lines)
  LOOP
    v_base := (v_line.value->>'line_subtotal')::numeric;
    v_discount := (v_line.value->>'discount_amount')::numeric;

    IF v_discount > v_base THEN
      RAISE EXCEPTION 'Line discount cannot exceed its subtotal';
    END IF;

    v_subtotal := v_subtotal + v_base;
    v_line_discount_total := v_line_discount_total + v_discount;
  END LOOP;

  IF v_order_discount > (v_subtotal - v_line_discount_total) THEN
    RAISE EXCEPTION 'Order discount exceeds the remaining subtotal';
  END IF;

  IF v_order_discount > 0
     AND NOT public.has_sales_role(
       p_organization_id,
       ARRAY['owner','admin','manager']::text[]
     ) THEN
    RAISE EXCEPTION 'You do not have permission to apply discounts';
  END IF;

  v_total := round(
    v_subtotal - v_line_discount_total - v_order_discount,
    2
  );

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Sale total must be greater than zero';
  END IF;

  -- Validate payment array
  SELECT count(*)
  INTO v_payment_count
  FROM jsonb_to_recordset(p_payments)
    AS x(payment_method_id uuid, amount numeric, reference text);

  IF v_payment_count <> jsonb_array_length(p_payments) THEN
    RAISE EXCEPTION 'Invalid payment data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_payments)
      AS x(payment_method_id uuid, amount numeric, reference text)
    WHERE x.payment_method_id IS NULL
       OR x.amount IS NULL
       OR x.amount <= 0
       OR x.amount <> round(x.amount, 2)
  ) THEN
    RAISE EXCEPTION 'Payment amounts must be positive and have at most two decimal places';
  END IF;

  -- Lock payment methods so they cannot be archived during checkout
  PERFORM pm.id
  FROM public.payment_methods pm
  JOIN (
    SELECT DISTINCT x.payment_method_id
    FROM jsonb_to_recordset(p_payments)
      AS x(payment_method_id uuid, amount numeric, reference text)
  ) x ON x.payment_method_id = pm.id
  WHERE pm.organization_id = p_organization_id
    AND pm.is_active = true
  ORDER BY pm.id
  FOR SHARE OF pm;

  SELECT count(DISTINCT x.payment_method_id)
  INTO v_valid_payment_count
  FROM jsonb_to_recordset(p_payments)
    AS x(payment_method_id uuid, amount numeric, reference text)
  JOIN public.payment_methods pm
    ON pm.id = x.payment_method_id
   AND pm.organization_id = p_organization_id
   AND pm.is_active = true;

  SELECT COALESCE(sum(x.amount), 0)
  INTO v_paid
  FROM jsonb_to_recordset(p_payments)
    AS x(payment_method_id uuid, amount numeric, reference text);

  IF v_valid_payment_count <> (
    SELECT count(DISTINCT x.payment_method_id)
    FROM jsonb_to_recordset(p_payments)
      AS x(payment_method_id uuid, amount numeric, reference text)
  ) THEN
    RAISE EXCEPTION 'One or more payment methods are unavailable';
  END IF;

  FOR v_payment IN
    SELECT *
    FROM jsonb_to_recordset(p_payments)
      AS x(payment_method_id uuid, amount numeric, reference text)
  LOOP
    SELECT pm.name, pm.method_code, pm.requires_reference
    INTO v_method
    FROM public.payment_methods pm
    WHERE pm.id = v_payment.payment_method_id
      AND pm.organization_id = p_organization_id
      AND pm.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment method is unavailable';
    END IF;

    v_reference := NULLIF(btrim(v_payment.reference), '');

    IF v_method.requires_reference = true
       AND v_reference IS NULL THEN
      RAISE EXCEPTION 'A payment reference is required for %',
        v_method.name;
    END IF;
  END LOOP;

  IF v_paid > v_total THEN
    RAISE EXCEPTION 'Payments cannot exceed the sale total';
  END IF;

  -- Credit sales are restricted to owner, admin and manager
  IF v_paid < v_total THEN
    IF NOT public.has_sales_role(
      p_organization_id,
      ARRAY['owner','admin','manager']::text[]
    ) THEN
      RAISE EXCEPTION 'You do not have permission to create credit sales';
    END IF;

    IF v_customer_name IS NULL OR btrim(v_customer_name) = '' THEN
      RAISE EXCEPTION 'Customer name is required for credit sales';
    END IF;
  END IF;

  -- Lock all relevant stock balances in deterministic variant order
  PERFORM ib.id
  FROM public.inventory_balances ib
  JOIN jsonb_array_elements(v_lines) l
    ON ib.variant_id = (l->>'variant_id')::uuid
  WHERE ib.organization_id = p_organization_id
    AND ib.location_id = p_location_id
    AND l->>'product_type' = 'physical'
  ORDER BY ib.variant_id
  FOR UPDATE OF ib;

  SELECT count(*)
  INTO v_physical_count
  FROM jsonb_array_elements(v_lines) l
  WHERE l->>'product_type' = 'physical';

  SELECT count(*)
  INTO v_stock_count
  FROM public.inventory_balances ib
  JOIN jsonb_array_elements(v_lines) l
    ON ib.variant_id = (l->>'variant_id')::uuid
  WHERE ib.organization_id = p_organization_id
    AND ib.location_id = p_location_id
    AND l->>'product_type' = 'physical';

  IF v_stock_count <> v_physical_count THEN
    RAISE EXCEPTION 'Stock balance is missing for one or more products at this location';
  END IF;

  -- Check all stock before making any changes
  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(v_lines)
    WHERE value->>'product_type' = 'physical'
    ORDER BY (value->>'variant_id')::uuid
  LOOP
    SELECT ib.quantity
    INTO v_stock_before
    FROM public.inventory_balances ib
    WHERE ib.organization_id = p_organization_id
      AND ib.location_id = p_location_id
      AND ib.variant_id = (v_line.value->>'variant_id')::uuid;

    v_quantity := (v_line.value->>'quantity')::numeric;

    IF v_stock_before < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product: %',
        v_line.value->>'product_name';
    END IF;
  END LOOP;

  -- Allocate order discount proportionally.
  -- The final line absorbs any rounding remainder.
  FOR v_line IN
    SELECT value, ordinality
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    v_index := v_index + 1;

    v_base :=
      (v_line.value->>'line_subtotal')::numeric
      - (v_line.value->>'discount_amount')::numeric;

    IF v_order_discount = 0 THEN
      v_allocated := 0;
    ELSIF v_index = jsonb_array_length(v_lines) THEN
      v_allocated := v_order_discount - v_allocated_total;
    ELSE
      v_allocated := round(
        v_order_discount * v_base /
        NULLIF(v_subtotal - v_line_discount_total, 0),
        2
      );
    END IF;

    IF v_allocated < 0 OR v_allocated > v_base THEN
      RAISE EXCEPTION 'Invalid order discount allocation';
    END IF;

    v_allocated_total := v_allocated_total + v_allocated;

    v_allocated_lines := v_allocated_lines || jsonb_build_array(
      v_line.value || jsonb_build_object(
        'order_discount_allocated', v_allocated
      )
    );
  END LOOP;

  IF v_allocated_total <> v_order_discount THEN
    RAISE EXCEPTION 'Order discount allocation does not reconcile';
  END IF;

  -- Generate sale number inside the same transaction
  v_sale_number :=
    public.sales_v1_next_document_number(
      p_organization_id,
      'sale'
    );

  v_payment_status :=
    CASE
      WHEN v_paid = v_total THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END;

  INSERT INTO public.sales (
    organization_id,
    location_id,
    sale_number,
    customer_id,
    customer_name,
    customer_phone,
    cashier_id,
    status,
    payment_status,
    subtotal,
    line_discount_total,
    order_discount_total,
    tax_rate,
    tax_amount,
    total_amount,
    paid_amount,
    idempotency_key,
    request_hash,
    sold_at,
    currency_code
  )
  VALUES (
    p_organization_id,
    p_location_id,
    v_sale_number,
    v_customer_id,
    v_customer_name,
    v_customer_phone,
    v_user_id,
    'completed',
    v_payment_status,
    v_subtotal,
    v_line_discount_total,
    v_order_discount,
    0,
    0,
    v_total,
    v_paid,
    p_idempotency_key,
    v_request_hash,
    now(),
    v_currency
  )
  RETURNING id INTO v_sale_id;

  -- Insert sale item snapshots
  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(v_allocated_lines)
  LOOP
    INSERT INTO public.sale_items (
      organization_id,
      sale_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_of_measure_snapshot,
      product_type_snapshot,
      quantity,
      unit_price,
      unit_cost_snapshot,
      line_subtotal,
      discount_amount,
      order_discount_allocated,
      tax_amount,
      line_total
    )
    VALUES (
      p_organization_id,
      v_sale_id,
      (v_line.value->>'product_id')::uuid,
      (v_line.value->>'variant_id')::uuid,
      v_line.value->>'product_name',
      v_line.value->>'variant_name',
      v_line.value->>'sku',
      v_line.value->>'unit_of_measure',
      v_line.value->>'product_type',
      (v_line.value->>'quantity')::numeric,
      (v_line.value->>'unit_price')::numeric,
      (v_line.value->>'unit_cost')::numeric,
      (v_line.value->>'line_subtotal')::numeric,
      (v_line.value->>'discount_amount')::numeric,
      (v_line.value->>'order_discount_allocated')::numeric,
      0,
      (
        (v_line.value->>'line_subtotal')::numeric
        - (v_line.value->>'discount_amount')::numeric
        - (v_line.value->>'order_discount_allocated')::numeric
      )
    );
  END LOOP;

  -- Deduct stock and record stock movements
  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(v_allocated_lines)
    WHERE value->>'product_type' = 'physical'
    ORDER BY (value->>'variant_id')::uuid
  LOOP
    v_quantity := (v_line.value->>'quantity')::numeric;

    SELECT ib.quantity
    INTO v_stock_before
    FROM public.inventory_balances ib
    WHERE ib.organization_id = p_organization_id
      AND ib.location_id = p_location_id
      AND ib.variant_id = (v_line.value->>'variant_id')::uuid
    FOR UPDATE;

    v_stock_after := v_stock_before - v_quantity;

    UPDATE public.inventory_balances
    SET quantity = v_stock_after,
        updated_at = now()
    WHERE organization_id = p_organization_id
      AND location_id = p_location_id
      AND variant_id = (v_line.value->>'variant_id')::uuid;

    INSERT INTO public.stock_movements (
      organization_id,
      variant_id,
      location_id,
      movement_type,
      quantity_change,
      quantity_before,
      quantity_after,
      reference,
      notes,
      performed_by
    )
    VALUES (
      p_organization_id,
      (v_line.value->>'variant_id')::uuid,
      p_location_id,
      'stock_out',
      -v_quantity,
      v_stock_before,
      v_stock_after,
      v_sale_number,
      'Stock deducted from sales checkout',
      v_user_id
    );
  END LOOP;

  -- Record payment snapshots
  FOR v_payment IN
    SELECT *
    FROM jsonb_to_recordset(p_payments)
      AS x(payment_method_id uuid, amount numeric, reference text)
  LOOP
    SELECT pm.name, pm.method_code
    INTO v_method
    FROM public.payment_methods pm
    WHERE pm.id = v_payment.payment_method_id
      AND pm.organization_id = p_organization_id
      AND pm.is_active = true;

    INSERT INTO public.sale_payments (
      organization_id,
      sale_id,
      payment_method_id,
      amount,
      reference,
      payment_source,
      idempotency_key,
      request_hash,
      received_by,
      payment_method_name_snapshot,
      payment_method_code_snapshot
    )
    VALUES (
      p_organization_id,
      v_sale_id,
      v_payment.payment_method_id,
      v_payment.amount,
      NULLIF(btrim(v_payment.reference), ''),
      'checkout',
      NULL,
      NULL,
      v_user_id,
      v_method.name,
      v_method.method_code
    );
  END LOOP;

  RETURN v_sale_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sales_v2_checkout(
  uuid, uuid, jsonb, jsonb, text, text, text, numeric, uuid
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.sales_v2_checkout(
  uuid, uuid, jsonb, jsonb, text, text, text, numeric, uuid
) FROM anon;

GRANT EXECUTE ON FUNCTION public.sales_v2_checkout(
  uuid, uuid, jsonb, jsonb, text, text, text, numeric, uuid
) TO authenticated;

COMMIT;

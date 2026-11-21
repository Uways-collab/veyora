-- ============================================================================
-- Veyora Business — Customer Purchase History Read-Only RPC
-- ============================================================================
-- Adds public.customers_v1_get_purchase_history to return an organization-scoped
-- customer purchase summary and newest-first sales history with payments,
-- returns, and refunds.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.customers_v1_get_purchase_history(
  p_organization_id uuid,
  p_customer_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_summary jsonb;
  v_sales jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer ID is required';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Customer not found in the active organization';
  END IF;

  v_limit := LEAST(100, GREATEST(1, COALESCE(p_limit, 50)));

  -- Compute summary across ALL linked sales for this customer in the organization
  SELECT jsonb_build_object(
    'total_purchases', COALESCE(COUNT(*) FILTER (WHERE s.status = 'completed'), 0),
    'total_purchase_value', COALESCE(SUM(s.total_amount) FILTER (WHERE s.status = 'completed'), 0),
    'total_amount_paid', COALESCE(SUM(s.paid_amount) FILTER (WHERE s.status = 'completed'), 0),
    'outstanding_credit_balance', COALESCE(
      SUM(
        GREATEST(
          0,
          COALESCE(s.total_amount, 0)
          - COALESCE(s.returned_amount, 0)
          - COALESCE(s.paid_amount, 0)
        )
      ) FILTER (WHERE s.status = 'completed'),
      0
    ),
    'total_returned_value', COALESCE(SUM(s.returned_amount) FILTER (WHERE s.status = 'completed'), 0),
    'total_refunded_value', COALESCE(SUM(s.refunded_amount) FILTER (WHERE s.status = 'completed'), 0)
  )
  INTO v_summary
  FROM public.sales s
  WHERE s.organization_id = p_organization_id
    AND s.customer_id = p_customer_id;

  -- Fetch up to v_limit newest sales with independent correlated subqueries
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'sale_number', s.sale_number,
        'status', s.status,
        'payment_status', s.payment_status,
        'sold_at', s.sold_at,
        'currency_code', s.currency_code,
        'total_amount', COALESCE(s.total_amount, 0),
        'paid_amount', COALESCE(s.paid_amount, 0),
        'returned_amount', COALESCE(s.returned_amount, 0),
        'refunded_amount', COALESCE(s.refunded_amount, 0),
        'outstanding_balance', CASE
          WHEN s.status = 'completed' THEN
            GREATEST(
              0,
              COALESCE(s.total_amount, 0)
              - COALESCE(s.returned_amount, 0)
              - COALESCE(s.paid_amount, 0)
            )
          ELSE 0
        END,
        'payments', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', sp.id,
              'amount', sp.amount,
              'reference', sp.reference,
              'payment_source', sp.payment_source,
              'paid_at', sp.paid_at,
              'payment_method_name_snapshot', sp.payment_method_name_snapshot,
              'payment_method_code_snapshot', sp.payment_method_code_snapshot
            )
            ORDER BY sp.paid_at DESC, sp.id DESC
          )
          FROM public.sale_payments sp
          WHERE sp.organization_id = p_organization_id
            AND sp.sale_id = s.id
        ), '[]'::jsonb),
        'returns', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', sr.id,
              'return_number', sr.return_number,
              'reason', sr.reason,
              'subtotal', sr.subtotal,
              'return_discount_amount', sr.return_discount_amount,
              'tax_amount', sr.tax_amount,
              'total_amount', sr.total_amount,
              'debt_reduced_amount', sr.debt_reduced_amount,
              'refunded_amount', sr.refunded_amount,
              'returned_at', sr.returned_at
            )
            ORDER BY sr.returned_at DESC NULLS LAST, sr.created_at DESC, sr.id DESC
          )
          FROM public.sales_returns sr
          WHERE sr.organization_id = p_organization_id
            AND sr.sale_id = s.id
        ), '[]'::jsonb),
        'refunds', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', rf.id,
              'return_id', rf.return_id,
              'amount', rf.amount,
              'refund_source', rf.refund_source,
              'reference', rf.reference,
              'reason', rf.reason,
              'refunded_at', rf.refunded_at,
              'payment_method_name_snapshot', rf.payment_method_name_snapshot,
              'payment_method_code_snapshot', rf.payment_method_code_snapshot
            )
            ORDER BY rf.refunded_at DESC, rf.id DESC
          )
          FROM public.sale_refunds rf
          WHERE rf.organization_id = p_organization_id
            AND rf.sale_id = s.id
        ), '[]'::jsonb)
      )
      ORDER BY s.sold_at DESC, s.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_sales
  FROM (
    SELECT
      s.id,
      s.sale_number,
      s.status,
      s.payment_status,
      s.sold_at,
      s.currency_code,
      s.total_amount,
      s.paid_amount,
      s.returned_amount,
      s.refunded_amount
    FROM public.sales s
    WHERE s.organization_id = p_organization_id
      AND s.customer_id = p_customer_id
    ORDER BY s.sold_at DESC, s.id DESC
    LIMIT v_limit
  ) s;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'sales', v_sales
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customers_v1_get_purchase_history(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customers_v1_get_purchase_history(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.customers_v1_get_purchase_history(uuid, uuid, integer) TO authenticated;

COMMIT;

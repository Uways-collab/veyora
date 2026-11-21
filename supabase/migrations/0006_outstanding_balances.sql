-- ============================================================================
-- Veyora Business — Outstanding Balances Read-Only RPC & Supporting Index
-- ============================================================================
-- Adds public.sales_v1_get_outstanding_balances to return organization-scoped
-- registered customers with outstanding credit balances, currency-grouped
-- summary totals, and newest-first qualifying unpaid/partial completed sales.
-- ============================================================================

BEGIN;

-- 1. Supporting partial index for organization-scoped registered customer sales
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'sales'
      AND i.indisvalid
      AND pg_catalog.pg_get_indexdef(i.indexrelid) ILIKE '%(organization_id, customer_id, sold_at DESC)%'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%customer_id IS NOT NULL%'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%completed%'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_sales_org_customer_sold_at_completed
      ON public.sales (organization_id, customer_id, sold_at DESC)
      WHERE customer_id IS NOT NULL AND status = 'completed';
  END IF;
END
$$;

-- 2. Read-only RPC: public.sales_v1_get_outstanding_balances
CREATE OR REPLACE FUNCTION public.sales_v1_get_outstanding_balances(
  p_organization_id uuid,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_base_currency text;
  v_limit integer;
  v_offset integer;
  v_search text;
  v_search_pattern text;
  v_summary jsonb;
  v_customers jsonb;
  v_total_customers integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  SELECT UPPER(COALESCE(NULLIF(btrim(o.currency), ''), 'USD'))
  INTO v_base_currency
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  v_limit := LEAST(100, GREATEST(1, COALESCE(p_limit, 50)));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  v_search := NULLIF(btrim(COALESCE(p_search, '')), '');
  IF v_search IS NOT NULL THEN
    v_search_pattern :=
      '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  ELSE
    v_search_pattern := NULL;
  END IF;

  WITH filtered_open_sales AS (
    SELECT
      s.id,
      s.customer_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email,
      c.is_active AS customer_is_active,
      s.sale_number,
      s.status,
      s.payment_status,
      s.sold_at,
      UPPER(COALESCE(NULLIF(btrim(s.currency_code), ''), v_base_currency)) AS currency_code,
      ROUND(COALESCE(s.total_amount, 0), 2) AS total_amount,
      ROUND(COALESCE(s.paid_amount, 0), 2) AS paid_amount,
      ROUND(COALESCE(s.returned_amount, 0), 2) AS returned_amount,
      ROUND(
        GREATEST(
          0,
          COALESCE(s.total_amount, 0)
          - COALESCE(s.returned_amount, 0)
          - COALESCE(s.paid_amount, 0)
        ),
        2
      ) AS outstanding_balance
    FROM public.sales s
    INNER JOIN public.customers c
      ON c.id = s.customer_id
     AND c.organization_id = s.organization_id
    WHERE s.organization_id = p_organization_id
      AND s.customer_id IS NOT NULL
      AND s.status = 'completed'
      AND GREATEST(
        0,
        COALESCE(s.total_amount, 0)
        - COALESCE(s.returned_amount, 0)
        - COALESCE(s.paid_amount, 0)
      ) > 0
      AND (
        v_search_pattern IS NULL
        OR c.name ILIKE v_search_pattern ESCAPE '\'
        OR COALESCE(c.phone, '') ILIKE v_search_pattern ESCAPE '\'
        OR COALESCE(c.email, '') ILIKE v_search_pattern ESCAPE '\'
      )
  ),
  summary_currency_totals AS (
    SELECT
      fos.currency_code,
      ROUND(SUM(fos.outstanding_balance), 2) AS total_outstanding
    FROM filtered_open_sales fos
    GROUP BY fos.currency_code
  ),
  overall_summary AS (
    SELECT
      COUNT(DISTINCT fos.customer_id)::integer AS customers_with_balances,
      COUNT(*)::integer AS open_sales_count,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'currency_code', sct.currency_code,
              'total_outstanding', sct.total_outstanding
            )
            ORDER BY sct.currency_code ASC
          )
          FROM summary_currency_totals sct
        ),
        '[]'::jsonb
      ) AS currency_totals
    FROM filtered_open_sales fos
  ),
  customer_agg AS (
    SELECT
      fos.customer_id,
      fos.customer_name AS name,
      fos.customer_phone AS phone,
      fos.customer_email AS email,
      fos.customer_is_active AS is_active,
      COUNT(*)::integer AS open_sales_count,
      MIN(fos.sold_at) AS oldest_unpaid_at,
      MAX(fos.sold_at) AS latest_unpaid_at
    FROM filtered_open_sales fos
    GROUP BY
      fos.customer_id,
      fos.customer_name,
      fos.customer_phone,
      fos.customer_email,
      fos.customer_is_active
  ),
  paged_customers AS (
    SELECT ca.*
    FROM customer_agg ca
    ORDER BY ca.oldest_unpaid_at ASC, LOWER(ca.name) ASC, ca.name ASC, ca.customer_id ASC
    LIMIT v_limit
    OFFSET v_offset
  ),
  paged_customer_currency AS (
    SELECT
      fos.customer_id,
      fos.currency_code,
      ROUND(SUM(fos.outstanding_balance), 2) AS outstanding_balance
    FROM filtered_open_sales fos
    INNER JOIN paged_customers pc
      ON pc.customer_id = fos.customer_id
    GROUP BY fos.customer_id, fos.currency_code
  ),
  paged_customer_payload AS (
    SELECT
      pc.customer_id,
      pc.name,
      pc.phone,
      pc.email,
      pc.is_active,
      pc.open_sales_count,
      pc.oldest_unpaid_at,
      pc.latest_unpaid_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'currency_code', pcc.currency_code,
              'outstanding_balance', pcc.outstanding_balance
            )
            ORDER BY pcc.currency_code ASC
          )
          FROM paged_customer_currency pcc
          WHERE pcc.customer_id = pc.customer_id
        ),
        '[]'::jsonb
      ) AS balances_by_currency,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', fos.id,
              'sale_number', fos.sale_number,
              'status', fos.status,
              'payment_status', fos.payment_status,
              'sold_at', fos.sold_at,
              'currency_code', fos.currency_code,
              'total_amount', fos.total_amount,
              'paid_amount', fos.paid_amount,
              'returned_amount', fos.returned_amount,
              'outstanding_balance', fos.outstanding_balance
            )
            ORDER BY fos.sold_at DESC, fos.id DESC
          )
          FROM filtered_open_sales fos
          WHERE fos.customer_id = pc.customer_id
        ),
        '[]'::jsonb
      ) AS sales
    FROM paged_customers pc
  )
  SELECT
    jsonb_build_object(
      'customers_with_balances', os.customers_with_balances,
      'open_sales_count', os.open_sales_count,
      'currency_totals', os.currency_totals
    ),
    os.customers_with_balances,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'customer_id', pcp.customer_id,
            'name', pcp.name,
            'phone', pcp.phone,
            'email', pcp.email,
            'is_active', pcp.is_active,
            'open_sales_count', pcp.open_sales_count,
            'oldest_unpaid_at', pcp.oldest_unpaid_at,
            'latest_unpaid_at', pcp.latest_unpaid_at,
            'balances_by_currency', pcp.balances_by_currency,
            'sales', pcp.sales
          )
          ORDER BY pcp.oldest_unpaid_at ASC, LOWER(pcp.name) ASC, pcp.name ASC, pcp.customer_id ASC
        )
        FROM paged_customer_payload pcp
      ),
      '[]'::jsonb
    )
  INTO v_summary, v_total_customers, v_customers
  FROM overall_summary os;

  RETURN jsonb_build_object(
    'summary', COALESCE(
      v_summary,
      jsonb_build_object(
        'customers_with_balances', 0,
        'open_sales_count', 0,
        'currency_totals', '[]'::jsonb
      )
    ),
    'customers', COALESCE(v_customers, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total_customers', COALESCE(v_total_customers, 0),
      'has_more', (v_offset + jsonb_array_length(COALESCE(v_customers, '[]'::jsonb))) < COALESCE(v_total_customers, 0)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sales_v1_get_outstanding_balances(uuid, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_v1_get_outstanding_balances(uuid, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_v1_get_outstanding_balances(uuid, text, integer, integer) TO authenticated;

COMMIT;

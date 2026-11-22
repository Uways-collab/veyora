-- ============================================================================
-- Veyora Business — Expenses Module Foundation Schema, RLS & RPCs
-- ============================================================================
-- Adds organization-scoped expense categories, expenses, atomic per-org
-- expense sequences, immutable expense audit logs, strict RLS policies, and
-- SECURITY DEFINER RPC functions.
-- ============================================================================

BEGIN;

-- 1. Self-contained updated_at trigger helper for Expenses tables
CREATE OR REPLACE FUNCTION public.expenses_v1_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := timezone('utc', pg_catalog.now());
  RETURN NEW;
END;
$$;

-- 2. Tables

-- 2a. Expense Categories
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', pg_catalog.now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', pg_catalog.now()),
  CONSTRAINT expense_categories_name_len_chk
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT expense_categories_description_len_chk
    CHECK (description IS NULL OR char_length(description) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_org_name_ci
  ON public.expense_categories (organization_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_expense_categories_org_active_name
  ON public.expense_categories (organization_id, is_active, name);

DROP TRIGGER IF EXISTS trg_expense_categories_updated_at ON public.expense_categories;
CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.expenses_v1_touch_updated_at();

-- 2b. Atomic Per-Organization Expense Sequences
CREATE TABLE IF NOT EXISTS public.expense_sequences (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', pg_catalog.now())
);

-- 2c. Expenses Ledger
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expense_number text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.expense_categories(id),
  category_name_snapshot text NOT NULL,
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods(id),
  payment_method_name_snapshot text NOT NULL,
  payment_method_code_snapshot text NOT NULL,
  expense_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency_code text NOT NULL,
  description text NOT NULL,
  vendor_payee text,
  reference text,
  receipt_storage_path text,
  notes text,
  status text NOT NULL DEFAULT 'recorded',
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', pg_catalog.now()),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', pg_catalog.now()),
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  CONSTRAINT expenses_org_number_uniq
    UNIQUE (organization_id, expense_number),
  CONSTRAINT expenses_org_idempotency_uniq
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT expenses_number_len_chk
    CHECK (char_length(btrim(expense_number)) BETWEEN 1 AND 50),
  CONSTRAINT expenses_category_snapshot_len_chk
    CHECK (char_length(btrim(category_name_snapshot)) BETWEEN 1 AND 100),
  CONSTRAINT expenses_pm_name_snapshot_len_chk
    CHECK (char_length(btrim(payment_method_name_snapshot)) BETWEEN 1 AND 120),
  CONSTRAINT expenses_pm_code_snapshot_len_chk
    CHECK (char_length(btrim(payment_method_code_snapshot)) BETWEEN 1 AND 50),
  CONSTRAINT expenses_amount_positive_chk
    CHECK (amount > 0 AND amount = round(amount, 2)),
  CONSTRAINT expenses_currency_len_chk
    CHECK (char_length(btrim(currency_code)) BETWEEN 3 AND 10),
  CONSTRAINT expenses_description_len_chk
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  CONSTRAINT expenses_vendor_payee_len_chk
    CHECK (vendor_payee IS NULL OR char_length(vendor_payee) <= 200),
  CONSTRAINT expenses_reference_len_chk
    CHECK (reference IS NULL OR char_length(reference) <= 150),
  CONSTRAINT expenses_receipt_path_len_chk
    CHECK (receipt_storage_path IS NULL OR char_length(receipt_storage_path) <= 500),
  CONSTRAINT expenses_notes_len_chk
    CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT expenses_status_chk
    CHECK (status IN ('recorded', 'voided')),
  CONSTRAINT expenses_idempotency_key_len_chk
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT expenses_void_reason_len_chk
    CHECK (void_reason IS NULL OR char_length(void_reason) <= 500),
  CONSTRAINT expenses_void_consistency_chk
    CHECK (
      (status = 'recorded' AND voided_at IS NULL AND void_reason IS NULL)
      OR (
        status = 'voided'
        AND voided_at IS NOT NULL
        AND char_length(btrim(coalesce(void_reason, ''))) > 0
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_expenses_org_date_created
  ON public.expenses (organization_id, expense_date DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_org_status_date
  ON public.expenses (organization_id, status, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_org_category_date
  ON public.expenses (organization_id, category_id, expense_date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_org_payment_method_date
  ON public.expenses (organization_id, payment_method_id, expense_date DESC);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.expenses_v1_touch_updated_at();

-- 2d. Immutable Expense Audit Logs
CREATE TABLE IF NOT EXISTS public.expense_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', pg_catalog.now()),
  CONSTRAINT expense_audit_logs_action_chk
    CHECK (action IN ('created', 'updated', 'voided')),
  CONSTRAINT expense_audit_logs_reason_len_chk
    CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_expense_audit_logs_org_expense_created
  ON public.expense_audit_logs (organization_id, expense_id, created_at DESC, id DESC);

-- 3. Row Level Security & Direct Table Permissions (Deny Write by Default)

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.expense_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.expenses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.expense_sequences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.expense_audit_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.expense_categories TO authenticated;
GRANT SELECT ON public.expenses TO authenticated;
GRANT SELECT ON public.expense_sequences TO authenticated;
GRANT SELECT ON public.expense_audit_logs TO authenticated;

DROP POLICY IF EXISTS "expense_categories_select_member" ON public.expense_categories;
CREATE POLICY "expense_categories_select_member"
  ON public.expense_categories FOR SELECT
  TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "expenses_select_member" ON public.expenses;
CREATE POLICY "expenses_select_member"
  ON public.expenses FOR SELECT
  TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "expense_sequences_select_member" ON public.expense_sequences;
CREATE POLICY "expense_sequences_select_member"
  ON public.expense_sequences FOR SELECT
  TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "expense_audit_logs_select_member" ON public.expense_audit_logs;
CREATE POLICY "expense_audit_logs_select_member"
  ON public.expense_audit_logs FOR SELECT
  TO authenticated
  USING (public.is_organization_member(organization_id));

-- 4. Category RPCs

-- 4a. List Categories
CREATE OR REPLACE FUNCTION public.expenses_v1_list_categories(
  p_organization_id uuid,
  p_include_archived boolean DEFAULT false
)
RETURNS SETOF public.expense_categories
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  RETURN QUERY
  SELECT ec.*
  FROM public.expense_categories ec
  WHERE ec.organization_id = p_organization_id
    AND (COALESCE(p_include_archived, false) = true OR ec.is_active = true)
  ORDER BY ec.is_active DESC, lower(ec.name) ASC, ec.name ASC, ec.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_list_categories(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_list_categories(uuid, boolean) TO authenticated;

-- 4b. Create Category (Owner/Admin/Manager)
CREATE OR REPLACE FUNCTION public.expenses_v1_create_category(
  p_organization_id uuid,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text;
  v_description text;
  v_category public.expense_categories;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Permission denied: only owners, admins, and managers can manage expense categories';
  END IF;

  v_name := NULLIF(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Category name is required';
  END IF;

  IF char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'Category name must be 100 characters or fewer';
  END IF;

  v_description := NULLIF(btrim(coalesce(p_description, '')), '');
  IF v_description IS NOT NULL AND char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'Category description must be 500 characters or fewer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_categories ec
    WHERE ec.organization_id = p_organization_id
      AND lower(btrim(ec.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'An expense category with this name already exists in this organization';
  END IF;

  INSERT INTO public.expense_categories (
    organization_id,
    name,
    description,
    is_active,
    is_system,
    created_by
  )
  VALUES (
    p_organization_id,
    v_name,
    v_description,
    true,
    false,
    v_user_id
  )
  RETURNING * INTO v_category;

  RETURN v_category;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_create_category(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_create_category(uuid, text, text) TO authenticated;

-- 4c. Update Category (Owner/Admin/Manager)
CREATE OR REPLACE FUNCTION public.expenses_v1_update_category(
  p_organization_id uuid,
  p_category_id uuid,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text;
  v_description text;
  v_category public.expense_categories;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'Category ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Permission denied: only owners, admins, and managers can manage expense categories';
  END IF;

  v_name := NULLIF(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Category name is required';
  END IF;

  IF char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'Category name must be 100 characters or fewer';
  END IF;

  v_description := NULLIF(btrim(coalesce(p_description, '')), '');
  IF v_description IS NOT NULL AND char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'Category description must be 500 characters or fewer';
  END IF;

  SELECT ec.*
  INTO v_category
  FROM public.expense_categories ec
  WHERE ec.id = p_category_id
    AND ec.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense category not found in this organization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.expense_categories ec
    WHERE ec.organization_id = p_organization_id
      AND ec.id <> p_category_id
      AND lower(btrim(ec.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'Another expense category with this name already exists in this organization';
  END IF;

  UPDATE public.expense_categories ec
  SET
    name = v_name,
    description = v_description,
    updated_at = timezone('utc', pg_catalog.now())
  WHERE ec.id = p_category_id
    AND ec.organization_id = p_organization_id
  RETURNING * INTO v_category;

  RETURN v_category;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_update_category(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_update_category(uuid, uuid, text, text) TO authenticated;

-- 4d. Archive Category (Owner/Admin/Manager)
CREATE OR REPLACE FUNCTION public.expenses_v1_archive_category(
  p_organization_id uuid,
  p_category_id uuid
)
RETURNS public.expense_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_category public.expense_categories;
  v_remaining_active integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'Category ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Permission denied: only owners, admins, and managers can manage expense categories';
  END IF;

  -- Lock active categories in deterministic order to prevent concurrent archiving of the last active category
  PERFORM ec.id
  FROM public.expense_categories ec
  WHERE ec.organization_id = p_organization_id
    AND (ec.is_active = true OR ec.id = p_category_id)
  ORDER BY ec.id
  FOR UPDATE;

  SELECT ec.*
  INTO v_category
  FROM public.expense_categories ec
  WHERE ec.id = p_category_id
    AND ec.organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense category not found in this organization';
  END IF;

  IF v_category.is_active = false THEN
    RETURN v_category;
  END IF;

  SELECT count(*)::integer
  INTO v_remaining_active
  FROM public.expense_categories ec
  WHERE ec.organization_id = p_organization_id
    AND ec.is_active = true
    AND ec.id <> p_category_id;

  IF v_remaining_active = 0 THEN
    RAISE EXCEPTION 'Cannot archive the only active expense category in this organization';
  END IF;

  UPDATE public.expense_categories ec
  SET
    is_active = false,
    updated_at = timezone('utc', pg_catalog.now())
  WHERE ec.id = p_category_id
    AND ec.organization_id = p_organization_id
  RETURNING * INTO v_category;

  RETURN v_category;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_archive_category(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_archive_category(uuid, uuid) TO authenticated;

-- 5. Expense Transaction & Reporting RPCs

-- 5a. Record Expense (Owner/Admin/Manager/Staff)
CREATE OR REPLACE FUNCTION public.expenses_v1_create(
  p_organization_id uuid,
  p_category_id uuid,
  p_payment_method_id uuid,
  p_expense_date date,
  p_amount numeric,
  p_description text,
  p_idempotency_key text,
  p_vendor_payee text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_receipt_storage_path text DEFAULT NULL
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_currency text;
  v_amount numeric(14,2);
  v_description text;
  v_idempotency_key text;
  v_vendor_payee text;
  v_reference text;
  v_notes text;
  v_receipt_path text;
  v_request_hash text;
  v_existing public.expenses;
  v_category record;
  v_method record;
  v_method_code text;
  v_seq bigint;
  v_expense_number text;
  v_expense public.expenses;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  SELECT UPPER(COALESCE(NULLIF(btrim(o.currency), ''), 'USD'))
  INTO v_currency
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner', 'admin', 'manager', 'staff']::text[]
  ) THEN
    RAISE EXCEPTION 'Permission denied: you do not have permission to record expenses';
  END IF;

  -- Validate inputs
  v_idempotency_key := NULLIF(btrim(coalesce(p_idempotency_key, '')), '');
  IF v_idempotency_key IS NULL OR char_length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'Expense category is required';
  END IF;

  IF p_payment_method_id IS NULL THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  IF p_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero with at most two decimal places';
  END IF;
  v_amount := round(p_amount, 2);

  v_description := NULLIF(btrim(coalesce(p_description, '')), '');
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'Expense description is required';
  END IF;
  IF char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'Expense description must be 500 characters or fewer';
  END IF;

  v_vendor_payee := NULLIF(btrim(coalesce(p_vendor_payee, '')), '');
  IF v_vendor_payee IS NOT NULL AND char_length(v_vendor_payee) > 200 THEN
    RAISE EXCEPTION 'Vendor / payee must be 200 characters or fewer';
  END IF;

  v_reference := NULLIF(btrim(coalesce(p_reference, '')), '');
  IF v_reference IS NOT NULL AND char_length(v_reference) > 150 THEN
    RAISE EXCEPTION 'Reference must be 150 characters or fewer';
  END IF;

  v_notes := NULLIF(btrim(coalesce(p_notes, '')), '');
  IF v_notes IS NOT NULL AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'Notes must be 2000 characters or fewer';
  END IF;

  v_receipt_path := NULLIF(btrim(coalesce(p_receipt_storage_path, '')), '');
  IF v_receipt_path IS NOT NULL THEN
    IF char_length(v_receipt_path) > 500 THEN
      RAISE EXCEPTION 'Receipt storage path must be 500 characters or fewer';
    END IF;
    IF v_receipt_path LIKE '%..%' OR v_receipt_path NOT LIKE (p_organization_id::text || '/%') THEN
      RAISE EXCEPTION 'Invalid organization-scoped receipt storage path';
    END IF;
  END IF;

  -- Serialize concurrent retries sharing the same organization and idempotency key
  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'expenses_create:' || p_organization_id::text || ':' || v_idempotency_key,
      0
    )
  );

  v_request_hash := pg_catalog.md5(
    jsonb_build_object(
      'category_id', p_category_id,
      'payment_method_id', p_payment_method_id,
      'expense_date', p_expense_date,
      'amount', v_amount,
      'description', v_description,
      'vendor_payee', v_vendor_payee,
      'reference', v_reference,
      'notes', v_notes,
      'receipt_storage_path', v_receipt_path
    )::text
  );

  SELECT e.*
  INTO v_existing
  FROM public.expenses e
  WHERE e.organization_id = p_organization_id
    AND e.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was already used with different expense data';
    END IF;
    RETURN v_existing;
  END IF;

  -- Lock & validate active category in the same organization
  SELECT ec.id, ec.name, ec.is_active
  INTO v_category
  FROM public.expense_categories ec
  WHERE ec.id = p_category_id
    AND ec.organization_id = p_organization_id
  FOR SHARE OF ec;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected expense category does not exist in this organization';
  END IF;

  IF v_category.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Selected expense category is archived and cannot be used for new expenses';
  END IF;

  -- Lock & validate active payment method in the same organization
  SELECT pm.id, pm.name, pm.method_code, pm.requires_reference, pm.is_active
  INTO v_method
  FROM public.payment_methods pm
  WHERE pm.id = p_payment_method_id
    AND pm.organization_id = p_organization_id
  FOR SHARE OF pm;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected payment method does not exist in this organization';
  END IF;

  IF v_method.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Selected payment method is inactive and cannot be used for new expenses';
  END IF;

  v_method_code := lower(btrim(coalesce(v_method.method_code, 'other')));
  IF (v_method.requires_reference = true OR v_method_code = 'bank_transfer') AND v_reference IS NULL THEN
    RAISE EXCEPTION 'A payment reference is required for %', v_method.name;
  END IF;

  -- Atomic per-organization expense sequence increment
  INSERT INTO public.expense_sequences (organization_id, last_value, updated_at)
  VALUES (p_organization_id, 1, timezone('utc', pg_catalog.now()))
  ON CONFLICT (organization_id) DO UPDATE
    SET last_value = public.expense_sequences.last_value + 1,
        updated_at = timezone('utc', pg_catalog.now())
  RETURNING last_value INTO v_seq;

  v_expense_number := 'EXP-' || pg_catalog.lpad(v_seq::text, 6, '0');

  INSERT INTO public.expenses (
    organization_id,
    expense_number,
    category_id,
    category_name_snapshot,
    payment_method_id,
    payment_method_name_snapshot,
    payment_method_code_snapshot,
    expense_date,
    amount,
    currency_code,
    description,
    vendor_payee,
    reference,
    receipt_storage_path,
    notes,
    status,
    idempotency_key,
    request_hash,
    recorded_by,
    updated_by
  )
  VALUES (
    p_organization_id,
    v_expense_number,
    v_category.id,
    btrim(v_category.name),
    v_method.id,
    btrim(v_method.name),
    v_method_code,
    p_expense_date,
    v_amount,
    v_currency,
    v_description,
    v_vendor_payee,
    v_reference,
    v_receipt_path,
    v_notes,
    'recorded',
    v_idempotency_key,
    v_request_hash,
    v_user_id,
    v_user_id
  )
  RETURNING * INTO v_expense;

  INSERT INTO public.expense_audit_logs (
    organization_id,
    expense_id,
    action,
    actor_user_id,
    reason,
    previous_values,
    new_values
  )
  VALUES (
    p_organization_id,
    v_expense.id,
    'created',
    v_user_id,
    NULL,
    NULL,
    jsonb_build_object(
      'expense_number', v_expense.expense_number,
      'category_id', v_expense.category_id,
      'category_name_snapshot', v_expense.category_name_snapshot,
      'payment_method_id', v_expense.payment_method_id,
      'payment_method_name_snapshot', v_expense.payment_method_name_snapshot,
      'payment_method_code_snapshot', v_expense.payment_method_code_snapshot,
      'expense_date', v_expense.expense_date,
      'amount', v_expense.amount,
      'currency_code', v_expense.currency_code,
      'description', v_expense.description,
      'vendor_payee', v_expense.vendor_payee,
      'reference', v_expense.reference,
      'receipt_storage_path', v_expense.receipt_storage_path,
      'notes', v_expense.notes,
      'status', v_expense.status
    )
  );

  RETURN v_expense;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_create(uuid, uuid, uuid, date, numeric, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_create(uuid, uuid, uuid, date, numeric, text, text, text, text, text, text) TO authenticated;

-- 5b. Update Expense (Owner/Admin/Manager)
CREATE OR REPLACE FUNCTION public.expenses_v1_update(
  p_organization_id uuid,
  p_expense_id uuid,
  p_category_id uuid,
  p_payment_method_id uuid,
  p_expense_date date,
  p_amount numeric,
  p_description text,
  p_edit_reason text,
  p_vendor_payee text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_receipt_storage_path text DEFAULT NULL
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_amount numeric(14,2);
  v_description text;
  v_edit_reason text;
  v_vendor_payee text;
  v_reference text;
  v_notes text;
  v_receipt_path text;
  v_existing public.expenses;
  v_category record;
  v_method record;
  v_method_code text;
  v_updated public.expenses;
  v_previous_values jsonb;
  v_new_values jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF p_expense_id IS NULL THEN
    RAISE EXCEPTION 'Expense ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Permission denied: only owners, admins, and managers can edit expenses';
  END IF;

  v_edit_reason := NULLIF(btrim(coalesce(p_edit_reason, '')), '');
  IF v_edit_reason IS NULL THEN
    RAISE EXCEPTION 'An edit reason is required';
  END IF;
  IF char_length(v_edit_reason) > 500 THEN
    RAISE EXCEPTION 'Edit reason must be 500 characters or fewer';
  END IF;

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'Expense category is required';
  END IF;

  IF p_payment_method_id IS NULL THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;

  IF p_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero with at most two decimal places';
  END IF;
  v_amount := round(p_amount, 2);

  v_description := NULLIF(btrim(coalesce(p_description, '')), '');
  IF v_description IS NULL THEN
    RAISE EXCEPTION 'Expense description is required';
  END IF;
  IF char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'Expense description must be 500 characters or fewer';
  END IF;

  v_vendor_payee := NULLIF(btrim(coalesce(p_vendor_payee, '')), '');
  IF v_vendor_payee IS NOT NULL AND char_length(v_vendor_payee) > 200 THEN
    RAISE EXCEPTION 'Vendor / payee must be 200 characters or fewer';
  END IF;

  v_reference := NULLIF(btrim(coalesce(p_reference, '')), '');
  IF v_reference IS NOT NULL AND char_length(v_reference) > 150 THEN
    RAISE EXCEPTION 'Reference must be 150 characters or fewer';
  END IF;

  v_notes := NULLIF(btrim(coalesce(p_notes, '')), '');
  IF v_notes IS NOT NULL AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'Notes must be 2000 characters or fewer';
  END IF;

  v_receipt_path := NULLIF(btrim(coalesce(p_receipt_storage_path, '')), '');
  IF v_receipt_path IS NOT NULL THEN
    IF char_length(v_receipt_path) > 500 THEN
      RAISE EXCEPTION 'Receipt storage path must be 500 characters or fewer';
    END IF;
    IF v_receipt_path LIKE '%..%' OR v_receipt_path NOT LIKE (p_organization_id::text || '/%') THEN
      RAISE EXCEPTION 'Invalid organization-scoped receipt storage path';
    END IF;
  END IF;

  -- Lock expense row before validating linked entities
  SELECT e.*
  INTO v_existing
  FROM public.expenses e
  WHERE e.id = p_expense_id
    AND e.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found in this organization';
  END IF;

  IF v_existing.status <> 'recorded' THEN
    RAISE EXCEPTION 'Voided expenses cannot be edited';
  END IF;

  -- Lock & validate category (if changed, must be active; if unchanged, preserve ability to fix other fields while refreshing snapshot)
  SELECT ec.id, ec.name, ec.is_active
  INTO v_category
  FROM public.expense_categories ec
  WHERE ec.id = p_category_id
    AND ec.organization_id = p_organization_id
  FOR SHARE OF ec;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected expense category does not exist in this organization';
  END IF;

  IF v_category.is_active IS DISTINCT FROM true AND v_category.id <> v_existing.category_id THEN
    RAISE EXCEPTION 'Selected expense category is archived and cannot be assigned';
  END IF;

  -- Lock & validate payment method (if changed, must be active)
  SELECT pm.id, pm.name, pm.method_code, pm.requires_reference, pm.is_active
  INTO v_method
  FROM public.payment_methods pm
  WHERE pm.id = p_payment_method_id
    AND pm.organization_id = p_organization_id
  FOR SHARE OF pm;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected payment method does not exist in this organization';
  END IF;

  IF v_method.is_active IS DISTINCT FROM true AND v_method.id <> v_existing.payment_method_id THEN
    RAISE EXCEPTION 'Selected payment method is inactive and cannot be assigned';
  END IF;

  v_method_code := lower(btrim(coalesce(v_method.method_code, 'other')));
  IF (v_method.requires_reference = true OR v_method_code = 'bank_transfer') AND v_reference IS NULL THEN
    RAISE EXCEPTION 'A payment reference is required for %', v_method.name;
  END IF;

  v_previous_values := jsonb_build_object(
    'category_id', v_existing.category_id,
    'category_name_snapshot', v_existing.category_name_snapshot,
    'payment_method_id', v_existing.payment_method_id,
    'payment_method_name_snapshot', v_existing.payment_method_name_snapshot,
    'payment_method_code_snapshot', v_existing.payment_method_code_snapshot,
    'expense_date', v_existing.expense_date,
    'amount', v_existing.amount,
    'description', v_existing.description,
    'vendor_payee', v_existing.vendor_payee,
    'reference', v_existing.reference,
    'receipt_storage_path', v_existing.receipt_storage_path,
    'notes', v_existing.notes
  );

  -- Preserve original expense_number, currency_code, idempotency_key, recorded_by, created_at
  UPDATE public.expenses e
  SET
    category_id = v_category.id,
    category_name_snapshot = btrim(v_category.name),
    payment_method_id = v_method.id,
    payment_method_name_snapshot = btrim(v_method.name),
    payment_method_code_snapshot = v_method_code,
    expense_date = p_expense_date,
    amount = v_amount,
    description = v_description,
    vendor_payee = v_vendor_payee,
    reference = v_reference,
    receipt_storage_path = v_receipt_path,
    notes = v_notes,
    updated_by = v_user_id,
    updated_at = timezone('utc', pg_catalog.now())
  WHERE e.id = p_expense_id
    AND e.organization_id = p_organization_id
  RETURNING * INTO v_updated;

  v_new_values := jsonb_build_object(
    'category_id', v_updated.category_id,
    'category_name_snapshot', v_updated.category_name_snapshot,
    'payment_method_id', v_updated.payment_method_id,
    'payment_method_name_snapshot', v_updated.payment_method_name_snapshot,
    'payment_method_code_snapshot', v_updated.payment_method_code_snapshot,
    'expense_date', v_updated.expense_date,
    'amount', v_updated.amount,
    'description', v_updated.description,
    'vendor_payee', v_updated.vendor_payee,
    'reference', v_updated.reference,
    'receipt_storage_path', v_updated.receipt_storage_path,
    'notes', v_updated.notes
  );

  INSERT INTO public.expense_audit_logs (
    organization_id,
    expense_id,
    action,
    actor_user_id,
    reason,
    previous_values,
    new_values
  )
  VALUES (
    p_organization_id,
    v_updated.id,
    'updated',
    v_user_id,
    v_edit_reason,
    v_previous_values,
    v_new_values
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_update(uuid, uuid, uuid, uuid, date, numeric, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_update(uuid, uuid, uuid, uuid, date, numeric, text, text, text, text, text, text) TO authenticated;

-- 5c. Void Expense (Owner/Admin/Manager)
CREATE OR REPLACE FUNCTION public.expenses_v1_void(
  p_organization_id uuid,
  p_expense_id uuid,
  p_reason text
)
RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason text;
  v_existing public.expenses;
  v_voided public.expenses;
  v_now timestamptz := timezone('utc', pg_catalog.now());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF p_expense_id IS NULL THEN
    RAISE EXCEPTION 'Expense ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF NOT public.has_sales_role(
    p_organization_id,
    ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Permission denied: only owners, admins, and managers can void expenses';
  END IF;

  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A void reason is required';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Void reason must be 500 characters or fewer';
  END IF;

  SELECT e.*
  INTO v_existing
  FROM public.expenses e
  WHERE e.id = p_expense_id
    AND e.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found in this organization';
  END IF;

  IF v_existing.status <> 'recorded' THEN
    RAISE EXCEPTION 'Expense is already voided';
  END IF;

  UPDATE public.expenses e
  SET
    status = 'voided',
    voided_by = v_user_id,
    voided_at = v_now,
    void_reason = v_reason,
    updated_by = v_user_id,
    updated_at = v_now
  WHERE e.id = p_expense_id
    AND e.organization_id = p_organization_id
  RETURNING * INTO v_voided;

  INSERT INTO public.expense_audit_logs (
    organization_id,
    expense_id,
    action,
    actor_user_id,
    reason,
    previous_values,
    new_values
  )
  VALUES (
    p_organization_id,
    v_voided.id,
    'voided',
    v_user_id,
    v_reason,
    jsonb_build_object(
      'status', v_existing.status,
      'voided_at', v_existing.voided_at,
      'void_reason', v_existing.void_reason
    ),
    jsonb_build_object(
      'status', v_voided.status,
      'voided_by', v_voided.voided_by,
      'voided_at', v_voided.voided_at,
      'void_reason', v_voided.void_reason
    )
  );

  RETURN v_voided;
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_void(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_void(uuid, uuid, text) TO authenticated;

-- 5d. List Expenses with Search, Filters & Server-Side Pagination
CREATE OR REPLACE FUNCTION public.expenses_v1_list(
  p_organization_id uuid,
  p_search text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_limit integer DEFAULT 25,
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
  v_limit integer;
  v_offset integer;
  v_search text;
  v_search_pattern text;
  v_status text;
  v_total_count integer := 0;
  v_expenses jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Start date cannot be after end date';
  END IF;

  v_status := NULLIF(lower(btrim(coalesce(p_status, ''))), '');
  IF v_status = 'all' THEN
    v_status := NULL;
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('recorded', 'voided') THEN
    RAISE EXCEPTION 'Invalid expense status filter';
  END IF;

  v_limit := LEAST(100, GREATEST(1, COALESCE(p_limit, 25)));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));

  v_search := NULLIF(btrim(coalesce(p_search, '')), '');
  IF v_search IS NOT NULL THEN
    v_search_pattern :=
      '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  ELSE
    v_search_pattern := NULL;
  END IF;

  WITH filtered_expenses AS (
    SELECT e.*
    FROM public.expenses e
    WHERE e.organization_id = p_organization_id
      AND (p_category_id IS NULL OR e.category_id = p_category_id)
      AND (p_payment_method_id IS NULL OR e.payment_method_id = p_payment_method_id)
      AND (v_status IS NULL OR e.status = v_status)
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to IS NULL OR e.expense_date <= p_date_to)
      AND (
        v_search_pattern IS NULL
        OR e.expense_number ILIKE v_search_pattern ESCAPE '\'
        OR e.description ILIKE v_search_pattern ESCAPE '\'
        OR COALESCE(e.vendor_payee, '') ILIKE v_search_pattern ESCAPE '\'
        OR COALESCE(e.reference, '') ILIKE v_search_pattern ESCAPE '\'
      )
  ),
  paged_expenses AS (
    SELECT fe.*
    FROM filtered_expenses fe
    ORDER BY fe.expense_date DESC, fe.created_at DESC, fe.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    (SELECT count(*)::integer FROM filtered_expenses),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', pe.id,
            'organization_id', pe.organization_id,
            'expense_number', pe.expense_number,
            'category_id', pe.category_id,
            'category_name_snapshot', pe.category_name_snapshot,
            'payment_method_id', pe.payment_method_id,
            'payment_method_name_snapshot', pe.payment_method_name_snapshot,
            'payment_method_code_snapshot', pe.payment_method_code_snapshot,
            'expense_date', pe.expense_date,
            'amount', pe.amount,
            'currency_code', pe.currency_code,
            'description', pe.description,
            'vendor_payee', pe.vendor_payee,
            'reference', pe.reference,
            'receipt_storage_path', pe.receipt_storage_path,
            'notes', pe.notes,
            'status', pe.status,
            'recorded_by', pe.recorded_by,
            'recorded_by_name', NULLIF(btrim(rp.full_name), ''),
            'created_at', pe.created_at,
            'updated_by', pe.updated_by,
            'updated_by_name', NULLIF(btrim(up.full_name), ''),
            'updated_at', pe.updated_at,
            'voided_by', pe.voided_by,
            'voided_by_name', NULLIF(btrim(vp.full_name), ''),
            'voided_at', pe.voided_at,
            'void_reason', pe.void_reason
          )
          ORDER BY pe.expense_date DESC, pe.created_at DESC, pe.id DESC
        )
        FROM paged_expenses pe
        LEFT JOIN public.profiles rp ON rp.id = pe.recorded_by
        LEFT JOIN public.profiles up ON up.id = pe.updated_by
        LEFT JOIN public.profiles vp ON vp.id = pe.voided_by
      ),
      '[]'::jsonb
    )
  INTO v_total_count, v_expenses;

  RETURN jsonb_build_object(
    'expenses', COALESCE(v_expenses, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'total_count', COALESCE(v_total_count, 0),
      'has_more', (v_offset + jsonb_array_length(COALESCE(v_expenses, '[]'::jsonb))) < COALESCE(v_total_count, 0)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_list(uuid, text, uuid, uuid, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_list(uuid, text, uuid, uuid, text, date, date, integer, integer) TO authenticated;

-- 5e. Get Single Expense Detail + Audit Timeline
CREATE OR REPLACE FUNCTION public.expenses_v1_get_detail(
  p_organization_id uuid,
  p_expense_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_expense jsonb;
  v_audit_logs jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF p_expense_id IS NULL THEN
    RAISE EXCEPTION 'Expense ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  SELECT jsonb_build_object(
    'id', e.id,
    'organization_id', e.organization_id,
    'expense_number', e.expense_number,
    'category_id', e.category_id,
    'category_name_snapshot', e.category_name_snapshot,
    'payment_method_id', e.payment_method_id,
    'payment_method_name_snapshot', e.payment_method_name_snapshot,
    'payment_method_code_snapshot', e.payment_method_code_snapshot,
    'expense_date', e.expense_date,
    'amount', e.amount,
    'currency_code', e.currency_code,
    'description', e.description,
    'vendor_payee', e.vendor_payee,
    'reference', e.reference,
    'receipt_storage_path', e.receipt_storage_path,
    'notes', e.notes,
    'status', e.status,
    'recorded_by', e.recorded_by,
    'recorded_by_name', NULLIF(btrim(rp.full_name), ''),
    'created_at', e.created_at,
    'updated_by', e.updated_by,
    'updated_by_name', NULLIF(btrim(up.full_name), ''),
    'updated_at', e.updated_at,
    'voided_by', e.voided_by,
    'voided_by_name', NULLIF(btrim(vp.full_name), ''),
    'voided_at', e.voided_at,
    'void_reason', e.void_reason
  )
  INTO v_expense
  FROM public.expenses e
  LEFT JOIN public.profiles rp ON rp.id = e.recorded_by
  LEFT JOIN public.profiles up ON up.id = e.updated_by
  LEFT JOIN public.profiles vp ON vp.id = e.voided_by
  WHERE e.id = p_expense_id
    AND e.organization_id = p_organization_id;

  IF v_expense IS NULL THEN
    RAISE EXCEPTION 'Expense not found in this organization';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', al.id,
        'organization_id', al.organization_id,
        'expense_id', al.expense_id,
        'action', al.action,
        'actor_user_id', al.actor_user_id,
        'actor_name', NULLIF(btrim(ap.full_name), ''),
        'reason', al.reason,
        'previous_values', al.previous_values,
        'new_values', al.new_values,
        'created_at', al.created_at
      )
      ORDER BY al.created_at DESC, al.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_audit_logs
  FROM public.expense_audit_logs al
  LEFT JOIN public.profiles ap ON ap.id = al.actor_user_id
  WHERE al.organization_id = p_organization_id
    AND al.expense_id = p_expense_id;

  RETURN jsonb_build_object(
    'expense', v_expense,
    'audit_logs', COALESCE(v_audit_logs, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_get_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_get_detail(uuid, uuid) TO authenticated;

-- 5f. Expense Summaries & Reporting (Voided Excluded, Currency-Grouped)
CREATE OR REPLACE FUNCTION public.expenses_v1_get_summary(
  p_organization_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_recorded_count integer := 0;
  v_voided_count integer := 0;
  v_currency_totals jsonb;
  v_category_breakdown jsonb;
  v_payment_method_breakdown jsonb;
  v_monthly_trend jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  IF NOT public.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'Permission denied: organization membership required';
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Start date cannot be after end date';
  END IF;

  WITH scoped_expenses AS (
    SELECT
      e.id,
      e.category_id,
      e.category_name_snapshot,
      e.payment_method_id,
      e.payment_method_name_snapshot,
      e.payment_method_code_snapshot,
      e.expense_date,
      e.amount,
      UPPER(btrim(e.currency_code)) AS currency_code,
      e.status
    FROM public.expenses e
    WHERE e.organization_id = p_organization_id
      AND (p_date_from IS NULL OR e.expense_date >= p_date_from)
      AND (p_date_to IS NULL OR e.expense_date <= p_date_to)
  ),
  recorded_expenses AS (
    SELECT *
    FROM scoped_expenses se
    WHERE se.status = 'recorded'
  )
  SELECT
    (SELECT count(*)::integer FROM recorded_expenses),
    (SELECT count(*)::integer FROM scoped_expenses se WHERE se.status = 'voided'),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'currency_code', ct.currency_code,
            'expense_count', ct.expense_count,
            'total_amount', ct.total_amount,
            'average_amount', ct.average_amount
          )
          ORDER BY ct.currency_code ASC
        )
        FROM (
          SELECT
            re.currency_code,
            count(*)::integer AS expense_count,
            round(sum(re.amount), 2) AS total_amount,
            round(avg(re.amount), 2) AS average_amount
          FROM recorded_expenses re
          GROUP BY re.currency_code
        ) ct
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'category_id', cb.category_id,
            'category_name', cb.category_name_snapshot,
            'currency_code', cb.currency_code,
            'expense_count', cb.expense_count,
            'total_amount', cb.total_amount,
            'average_amount', cb.average_amount
          )
          ORDER BY cb.total_amount DESC, lower(cb.category_name_snapshot) ASC, cb.currency_code ASC
        )
        FROM (
          SELECT
            re.category_id,
            re.category_name_snapshot,
            re.currency_code,
            count(*)::integer AS expense_count,
            round(sum(re.amount), 2) AS total_amount,
            round(avg(re.amount), 2) AS average_amount
          FROM recorded_expenses re
          GROUP BY re.category_id, re.category_name_snapshot, re.currency_code
        ) cb
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'payment_method_id', pb.payment_method_id,
            'payment_method_name', pb.payment_method_name_snapshot,
            'payment_method_code', pb.payment_method_code_snapshot,
            'currency_code', pb.currency_code,
            'expense_count', pb.expense_count,
            'total_amount', pb.total_amount,
            'average_amount', pb.average_amount
          )
          ORDER BY pb.total_amount DESC, lower(pb.payment_method_name_snapshot) ASC, pb.currency_code ASC
        )
        FROM (
          SELECT
            re.payment_method_id,
            re.payment_method_name_snapshot,
            re.payment_method_code_snapshot,
            re.currency_code,
            count(*)::integer AS expense_count,
            round(sum(re.amount), 2) AS total_amount,
            round(avg(re.amount), 2) AS average_amount
          FROM recorded_expenses re
          GROUP BY
            re.payment_method_id,
            re.payment_method_name_snapshot,
            re.payment_method_code_snapshot,
            re.currency_code
        ) pb
      ),
      '[]'::jsonb
    ),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'month', mt.month_key,
            'currency_code', mt.currency_code,
            'expense_count', mt.expense_count,
            'total_amount', mt.total_amount,
            'average_amount', mt.average_amount
          )
          ORDER BY mt.month_key ASC, mt.currency_code ASC
        )
        FROM (
          SELECT
            to_char(date_trunc('month', re.expense_date::timestamp), 'YYYY-MM') AS month_key,
            re.currency_code,
            count(*)::integer AS expense_count,
            round(sum(re.amount), 2) AS total_amount,
            round(avg(re.amount), 2) AS average_amount
          FROM recorded_expenses re
          GROUP BY
            to_char(date_trunc('month', re.expense_date::timestamp), 'YYYY-MM'),
            re.currency_code
        ) mt
      ),
      '[]'::jsonb
    )
  INTO
    v_recorded_count,
    v_voided_count,
    v_currency_totals,
    v_category_breakdown,
    v_payment_method_breakdown,
    v_monthly_trend;

  RETURN jsonb_build_object(
    'date_range', jsonb_build_object(
      'date_from', p_date_from,
      'date_to', p_date_to
    ),
    'counts', jsonb_build_object(
      'recorded_count', COALESCE(v_recorded_count, 0),
      'voided_count', COALESCE(v_voided_count, 0)
    ),
    'totals_by_currency', COALESCE(v_currency_totals, '[]'::jsonb),
    'category_breakdown', COALESCE(v_category_breakdown, '[]'::jsonb),
    'payment_method_breakdown', COALESCE(v_payment_method_breakdown, '[]'::jsonb),
    'monthly_trend', COALESCE(v_monthly_trend, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expenses_v1_get_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expenses_v1_get_summary(uuid, date, date) TO authenticated;

COMMIT;

import { getSupabaseClient } from '../../core/supabase/client';
import { compressImageToWebp, MAX_IMAGE_UPLOAD_BYTES } from '../../core/images/compressImage';
import { verifyActiveWorkspaceContext } from '../inventory/inventoryService';
import { normalizePaymentMethodCode, roundMoney } from '../sales/salesFormatters';
import { fetchActivePaymentMethods } from '../sales/salesService';
import type { PaymentMethodRecord } from '../sales/salesTypes';
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  ExpenseAuditAction,
  ExpenseAuditLogRecord,
  ExpenseCategoryBreakdownItem,
  ExpenseCategoryRecord,
  ExpenseCurrencyTotal,
  ExpenseDetailResult,
  ExpenseListFilters,
  ExpenseListResult,
  ExpenseMonthlyTrendItem,
  ExpensePaymentMethodBreakdownItem,
  ExpenseRecord,
  ExpenseStatusValue,
  ExpenseSummaryResult,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
  VoidExpenseInput,
} from './expensesTypes';

const EXPENSE_RECEIPT_BUCKET = 'organisation-files';
const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);

function readString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const val of values) {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readNonNegativeInt(value: unknown, fallback = 0): number {
  const num = readNumber(value);
  if (num === null) return fallback;
  return Math.max(0, Math.trunc(num));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function readJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRpcObjectPayload(
  data: unknown,
  wrapperKey?: string
): Record<string, unknown> | null {
  let current = data;
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if (!trimmed) return null;
    try {
      current = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(current)) {
    current = current[0] ?? null;
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return null;
  }
  const obj = current as Record<string, unknown>;
  if (wrapperKey) {
    const nested = obj[wrapperKey];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return obj;
}

function normalizeExpenseStatus(raw: unknown): ExpenseStatusValue {
  const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return val === 'voided' ? 'voided' : 'recorded';
}

function normalizeAuditAction(raw: unknown): ExpenseAuditAction {
  const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (val === 'updated') return 'updated';
  if (val === 'voided') return 'voided';
  return 'created';
}

export function formatExpenseRpcError(
  rawMessage: string | undefined | null,
  fallback: string
): string {
  const msg = (rawMessage ?? '').trim();
  if (!msg) return fallback;
  return msg;
}

function normalizeCategoryRow(
  row: Record<string, unknown>,
  fallbackOrgId: string
): ExpenseCategoryRecord | null {
  const id = readString(row.id);
  if (!id) return null;
  const organizationId = readString(row.organization_id) ?? fallbackOrgId;
  return {
    id,
    organizationId,
    name: readString(row.name) ?? 'Category',
    description: readString(row.description),
    isActive: readBoolean(row.is_active, true),
    isSystem: readBoolean(row.is_system, false),
    createdBy: readString(row.created_by),
    createdAt: readString(row.created_at) ?? new Date().toISOString(),
    updatedAt: readString(row.updated_at) ?? readString(row.created_at) ?? new Date().toISOString(),
  };
}

function normalizeExpenseRow(
  row: Record<string, unknown>,
  fallbackOrgId: string,
  fallbackCurrency = 'USD'
): ExpenseRecord | null {
  const id = readString(row.id);
  if (!id) return null;
  const organizationId = readString(row.organization_id) ?? fallbackOrgId;
  const methodCodeRaw = readString(row.payment_method_code_snapshot);
  return {
    id,
    organizationId,
    expenseNumber: readString(row.expense_number) ?? `EXP-${id.slice(0, 6).toUpperCase()}`,
    categoryId: readString(row.category_id) ?? '',
    categoryNameSnapshot: readString(row.category_name_snapshot) ?? 'Uncategorized',
    paymentMethodId: readString(row.payment_method_id) ?? '',
    paymentMethodNameSnapshot: readString(row.payment_method_name_snapshot) ?? 'Payment Method',
    paymentMethodCodeSnapshot: normalizePaymentMethodCode(methodCodeRaw),
    expenseDate: readString(row.expense_date) ?? '',
    amount: roundMoney(Math.max(0, readNumber(row.amount) ?? 0)),
    currencyCode: (readString(row.currency_code) ?? fallbackCurrency).toUpperCase(),
    description: readString(row.description) ?? '',
    vendorPayee: readString(row.vendor_payee),
    reference: readString(row.reference),
    receiptStoragePath: readString(row.receipt_storage_path),
    notes: readString(row.notes),
    status: normalizeExpenseStatus(row.status),
    recordedBy: readString(row.recorded_by),
    recordedByName: readString(row.recorded_by_name),
    createdAt: readString(row.created_at) ?? new Date().toISOString(),
    updatedBy: readString(row.updated_by),
    updatedByName: readString(row.updated_by_name),
    updatedAt: readString(row.updated_at) ?? readString(row.created_at) ?? new Date().toISOString(),
    voidedBy: readString(row.voided_by),
    voidedByName: readString(row.voided_by_name),
    voidedAt: readString(row.voided_at),
    voidReason: readString(row.void_reason),
  };
}

function normalizeAuditLogRow(
  row: Record<string, unknown>,
  fallbackOrgId: string,
  fallbackExpenseId: string
): ExpenseAuditLogRecord | null {
  const id = readString(row.id);
  if (!id) return null;
  return {
    id,
    organizationId: readString(row.organization_id) ?? fallbackOrgId,
    expenseId: readString(row.expense_id) ?? fallbackExpenseId,
    action: normalizeAuditAction(row.action),
    actorUserId: readString(row.actor_user_id),
    actorName: readString(row.actor_name),
    reason: readString(row.reason),
    previousValues: readJsonRecord(row.previous_values),
    newValues: readJsonRecord(row.new_values),
    createdAt: readString(row.created_at) ?? new Date().toISOString(),
  };
}

export function buildEmptyExpenseListResult(
  limit = 25,
  offset = 0,
  error: string | null = null
): ExpenseListResult {
  return {
    expenses: [],
    pagination: {
      limit,
      offset,
      totalCount: 0,
      hasMore: false,
    },
    error,
  };
}

export function buildEmptyExpenseSummaryResult(
  dateFrom: string | null = null,
  dateTo: string | null = null,
  error: string | null = null
): ExpenseSummaryResult {
  return {
    dateRange: {
      dateFrom,
      dateTo,
    },
    counts: {
      recordedCount: 0,
      voidedCount: 0,
    },
    totalsByCurrency: [],
    categoryBreakdown: [],
    paymentMethodBreakdown: [],
    monthlyTrend: [],
    error,
  };
}

export async function fetchExpensePaymentMethods(
  organisationId: string
): Promise<{ paymentMethods: PaymentMethodRecord[]; error: string | null }> {
  return fetchActivePaymentMethods(organisationId);
}

export async function fetchExpenseCategories(
  organisationId: string,
  includeArchived = true
): Promise<{ categories: ExpenseCategoryRecord[]; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { categories: [], error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { categories: [], error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_list_categories', {
    p_organization_id: verified.organizationId,
    p_include_archived: includeArchived,
  });

  if (error) {
    return {
      categories: [],
      error: formatExpenseRpcError(error.message, 'Unable to load expense categories.'),
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const categories: ExpenseCategoryRecord[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const normalized = normalizeCategoryRow(
      raw as Record<string, unknown>,
      verified.organizationId
    );
    if (normalized) {
      categories.push(normalized);
    }
  }

  return { categories, error: null };
}

export async function createExpenseCategory(
  organisationId: string,
  input: CreateExpenseCategoryInput
): Promise<{ category: ExpenseCategoryRecord | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { category: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { category: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_create_category', {
    p_organization_id: verified.organizationId,
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
  });

  if (error) {
    return {
      category: null,
      error: formatExpenseRpcError(error.message, 'Unable to create expense category.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_create_category');
  return {
    category: payload ? normalizeCategoryRow(payload, verified.organizationId) : null,
    error: null,
  };
}

export async function updateExpenseCategory(
  organisationId: string,
  input: UpdateExpenseCategoryInput
): Promise<{ category: ExpenseCategoryRecord | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { category: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { category: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_update_category', {
    p_organization_id: verified.organizationId,
    p_category_id: input.categoryId,
    p_name: input.name.trim(),
    p_description: input.description?.trim() || null,
  });

  if (error) {
    return {
      category: null,
      error: formatExpenseRpcError(error.message, 'Unable to update expense category.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_update_category');
  return {
    category: payload ? normalizeCategoryRow(payload, verified.organizationId) : null,
    error: null,
  };
}

export async function archiveExpenseCategory(
  organisationId: string,
  categoryId: string
): Promise<{ category: ExpenseCategoryRecord | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { category: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { category: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_archive_category', {
    p_organization_id: verified.organizationId,
    p_category_id: categoryId,
  });

  if (error) {
    return {
      category: null,
      error: formatExpenseRpcError(error.message, 'Unable to archive expense category.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_archive_category');
  return {
    category: payload ? normalizeCategoryRow(payload, verified.organizationId) : null,
    error: null,
  };
}

export async function fetchExpensesList(
  organisationId: string,
  filters: ExpenseListFilters,
  fallbackCurrency = 'USD'
): Promise<ExpenseListResult> {
  const clampedLimit = Math.min(100, Math.max(1, Math.trunc(filters.limit || 25)));
  const safeOffset = Math.max(0, Math.trunc(filters.offset || 0));

  const supabase = getSupabaseClient();
  if (!supabase) {
    return buildEmptyExpenseListResult(clampedLimit, safeOffset, 'Supabase client is not configured.');
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return buildEmptyExpenseListResult(clampedLimit, safeOffset, verified.error);
  }

  const trimmedSearch = filters.search.trim();
  const statusParam = filters.status === 'all' ? null : filters.status;
  const dateFromParam = filters.dateFrom.trim() || null;
  const dateToParam = filters.dateTo.trim() || null;

  const { data, error } = await supabase.rpc('expenses_v1_list', {
    p_organization_id: verified.organizationId,
    p_search: trimmedSearch || null,
    p_category_id: filters.categoryId || null,
    p_payment_method_id: filters.paymentMethodId || null,
    p_status: statusParam,
    p_date_from: dateFromParam,
    p_date_to: dateToParam,
    p_limit: clampedLimit,
    p_offset: safeOffset,
  });

  if (error) {
    return buildEmptyExpenseListResult(
      clampedLimit,
      safeOffset,
      formatExpenseRpcError(error.message, 'Unable to load expense records.')
    );
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_list');
  if (!payload) {
    return buildEmptyExpenseListResult(
      clampedLimit,
      safeOffset,
      'Received an unexpected response while loading expense records.'
    );
  }

  const rawExpenses = Array.isArray(payload.expenses) ? payload.expenses : [];
  const expenses: ExpenseRecord[] = [];
  for (const raw of rawExpenses) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const normalized = normalizeExpenseRow(
      raw as Record<string, unknown>,
      verified.organizationId,
      fallbackCurrency
    );
    if (normalized) {
      expenses.push(normalized);
    }
  }

  const rawPagination = readJsonRecord(payload.pagination) ?? {};
  const resolvedLimit = readNonNegativeInt(rawPagination.limit, clampedLimit) || clampedLimit;
  const resolvedOffset = readNonNegativeInt(rawPagination.offset, safeOffset);
  const totalCount = readNonNegativeInt(rawPagination.total_count, expenses.length);
  const hasMore = readBoolean(
    rawPagination.has_more,
    resolvedOffset + expenses.length < totalCount
  );

  return {
    expenses,
    pagination: {
      limit: resolvedLimit,
      offset: resolvedOffset,
      totalCount,
      hasMore,
    },
    error: null,
  };
}

export async function fetchExpenseDetail(
  organisationId: string,
  expenseId: string,
  fallbackCurrency = 'USD'
): Promise<ExpenseDetailResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { expense: null, auditLogs: [], error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { expense: null, auditLogs: [], error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_get_detail', {
    p_organization_id: verified.organizationId,
    p_expense_id: expenseId,
  });

  if (error) {
    return {
      expense: null,
      auditLogs: [],
      error: formatExpenseRpcError(error.message, 'Unable to load expense details.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_get_detail');
  if (!payload) {
    return {
      expense: null,
      auditLogs: [],
      error: 'Received an unexpected expense detail response from the server.',
    };
  }

  const rawExpense = readJsonRecord(payload.expense);
  const expense = rawExpense
    ? normalizeExpenseRow(rawExpense, verified.organizationId, fallbackCurrency)
    : null;

  if (!expense) {
    return {
      expense: null,
      auditLogs: [],
      error: 'Expense record was not found in this organization.',
    };
  }

  const rawLogs = Array.isArray(payload.audit_logs) ? payload.audit_logs : [];
  const auditLogs: ExpenseAuditLogRecord[] = [];
  for (const raw of rawLogs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const log = normalizeAuditLogRow(
      raw as Record<string, unknown>,
      verified.organizationId,
      expense.id
    );
    if (log) {
      auditLogs.push(log);
    }
  }

  return { expense, auditLogs, error: null };
}

export async function fetchExpensesSummary(
  organisationId: string,
  dateFrom: string | null = null,
  dateTo: string | null = null,
  fallbackCurrency = 'USD'
): Promise<ExpenseSummaryResult> {
  const cleanFrom = dateFrom?.trim() || null;
  const cleanTo = dateTo?.trim() || null;

  const supabase = getSupabaseClient();
  if (!supabase) {
    return buildEmptyExpenseSummaryResult(
      cleanFrom,
      cleanTo,
      'Supabase client is not configured.'
    );
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return buildEmptyExpenseSummaryResult(cleanFrom, cleanTo, verified.error);
  }

  const { data, error } = await supabase.rpc('expenses_v1_get_summary', {
    p_organization_id: verified.organizationId,
    p_date_from: cleanFrom,
    p_date_to: cleanTo,
  });

  if (error) {
    return buildEmptyExpenseSummaryResult(
      cleanFrom,
      cleanTo,
      formatExpenseRpcError(error.message, 'Unable to load expense summary.')
    );
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_get_summary');
  if (!payload) {
    return buildEmptyExpenseSummaryResult(
      cleanFrom,
      cleanTo,
      'Received an unexpected expense summary response from the server.'
    );
  }

  const rawDateRange = readJsonRecord(payload.date_range) ?? {};
  const rawCounts = readJsonRecord(payload.counts) ?? {};
  const normFallbackCur = (fallbackCurrency || 'USD').trim().toUpperCase() || 'USD';

  const totalsByCurrency: ExpenseCurrencyTotal[] = [];
  for (const raw of Array.isArray(payload.totals_by_currency) ? payload.totals_by_currency : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    totalsByCurrency.push({
      currencyCode: (readString(obj.currency_code) ?? normFallbackCur).toUpperCase(),
      expenseCount: readNonNegativeInt(obj.expense_count, 0),
      totalAmount: roundMoney(Math.max(0, readNumber(obj.total_amount) ?? 0)),
      averageAmount: roundMoney(Math.max(0, readNumber(obj.average_amount) ?? 0)),
    });
  }

  const categoryBreakdown: ExpenseCategoryBreakdownItem[] = [];
  for (const raw of Array.isArray(payload.category_breakdown) ? payload.category_breakdown : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    categoryBreakdown.push({
      categoryId: readString(obj.category_id) ?? '',
      categoryName: readString(obj.category_name) ?? 'Uncategorized',
      currencyCode: (readString(obj.currency_code) ?? normFallbackCur).toUpperCase(),
      expenseCount: readNonNegativeInt(obj.expense_count, 0),
      totalAmount: roundMoney(Math.max(0, readNumber(obj.total_amount) ?? 0)),
      averageAmount: roundMoney(Math.max(0, readNumber(obj.average_amount) ?? 0)),
    });
  }

  const paymentMethodBreakdown: ExpensePaymentMethodBreakdownItem[] = [];
  for (const raw of Array.isArray(payload.payment_method_breakdown)
    ? payload.payment_method_breakdown
    : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    paymentMethodBreakdown.push({
      paymentMethodId: readString(obj.payment_method_id) ?? '',
      paymentMethodName: readString(obj.payment_method_name) ?? 'Payment Method',
      paymentMethodCode: normalizePaymentMethodCode(readString(obj.payment_method_code)),
      currencyCode: (readString(obj.currency_code) ?? normFallbackCur).toUpperCase(),
      expenseCount: readNonNegativeInt(obj.expense_count, 0),
      totalAmount: roundMoney(Math.max(0, readNumber(obj.total_amount) ?? 0)),
      averageAmount: roundMoney(Math.max(0, readNumber(obj.average_amount) ?? 0)),
    });
  }

  const monthlyTrend: ExpenseMonthlyTrendItem[] = [];
  for (const raw of Array.isArray(payload.monthly_trend) ? payload.monthly_trend : []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    monthlyTrend.push({
      month: readString(obj.month) ?? '',
      currencyCode: (readString(obj.currency_code) ?? normFallbackCur).toUpperCase(),
      expenseCount: readNonNegativeInt(obj.expense_count, 0),
      totalAmount: roundMoney(Math.max(0, readNumber(obj.total_amount) ?? 0)),
      averageAmount: roundMoney(Math.max(0, readNumber(obj.average_amount) ?? 0)),
    });
  }

  return {
    dateRange: {
      dateFrom: readString(rawDateRange.date_from) ?? cleanFrom,
      dateTo: readString(rawDateRange.date_to) ?? cleanTo,
    },
    counts: {
      recordedCount: readNonNegativeInt(rawCounts.recorded_count, 0),
      voidedCount: readNonNegativeInt(rawCounts.voided_count, 0),
    },
    totalsByCurrency,
    categoryBreakdown,
    paymentMethodBreakdown,
    monthlyTrend,
    error: null,
  };
}

export async function createExpense(
  organisationId: string,
  input: CreateExpenseInput,
  fallbackCurrency = 'USD'
): Promise<{ expense: ExpenseRecord | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { expense: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { expense: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_create', {
    p_organization_id: verified.organizationId,
    p_category_id: input.categoryId,
    p_payment_method_id: input.paymentMethodId,
    p_expense_date: input.expenseDate,
    p_amount: roundMoney(input.amount),
    p_description: input.description.trim(),
    p_idempotency_key: input.idempotencyKey,
    p_vendor_payee: input.vendorPayee?.trim() || null,
    p_reference: input.reference?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_receipt_storage_path: input.receiptStoragePath?.trim() || null,
  });

  if (error) {
    return {
      expense: null,
      error: formatExpenseRpcError(error.message, 'Unable to record expense.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_create');
  return {
    expense: payload
      ? normalizeExpenseRow(payload, verified.organizationId, fallbackCurrency)
      : null,
    error: null,
  };
}

export async function updateExpense(
  organisationId: string,
  input: UpdateExpenseInput,
  fallbackCurrency = 'USD'
): Promise<{ expense: ExpenseRecord | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { expense: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { expense: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_update', {
    p_organization_id: verified.organizationId,
    p_expense_id: input.expenseId,
    p_category_id: input.categoryId,
    p_payment_method_id: input.paymentMethodId,
    p_expense_date: input.expenseDate,
    p_amount: roundMoney(input.amount),
    p_description: input.description.trim(),
    p_edit_reason: input.editReason.trim(),
    p_vendor_payee: input.vendorPayee?.trim() || null,
    p_reference: input.reference?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_receipt_storage_path: input.receiptStoragePath?.trim() || null,
  });

  if (error) {
    return {
      expense: null,
      error: formatExpenseRpcError(error.message, 'Unable to update expense.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_update');
  return {
    expense: payload
      ? normalizeExpenseRow(payload, verified.organizationId, fallbackCurrency)
      : null,
    error: null,
  };
}

export async function voidExpense(
  organisationId: string,
  input: VoidExpenseInput,
  fallbackCurrency = 'USD'
): Promise<{ expense: ExpenseRecord | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { expense: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { expense: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('expenses_v1_void', {
    p_organization_id: verified.organizationId,
    p_expense_id: input.expenseId,
    p_reason: input.reason.trim(),
  });

  if (error) {
    return {
      expense: null,
      error: formatExpenseRpcError(error.message, 'Unable to void expense.'),
    };
  }

  const payload = parseRpcObjectPayload(data, 'expenses_v1_void');
  return {
    expense: payload
      ? normalizeExpenseRow(payload, verified.organizationId, fallbackCurrency)
      : null,
    error: null,
  };
}

function getReceiptExtension(file: File): string {
  switch (file.type) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}

export function validateExpenseReceiptFile(file: File): string | null {
  if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.type)) {
    return 'Please attach a PNG, JPG, WebP image or a PDF document.';
  }
  if (file.size <= 0) {
    return 'The selected receipt file is empty.';
  }
  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    return 'Receipt attachment must be 5 MB or smaller.';
  }
  return null;
}

export async function uploadExpenseReceipt(
  organisationId: string,
  file: File
): Promise<{ storagePath: string | null; error: string | null }> {
  const validationError = validateExpenseReceiptFile(file);
  if (validationError) {
    return { storagePath: null, error: validationError };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { storagePath: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { storagePath: null, error: verified.error };
  }

  const orgId = verified.organizationId;
  const isImage = file.type.startsWith('image/');
  let compressedImage: Awaited<ReturnType<typeof compressImageToWebp>> | null = null;
  try {
    if (isImage) {
      compressedImage = await compressImageToWebp(file, {
        maxBytes: MAX_IMAGE_UPLOAD_BYTES,
        maxWidth: 1600,
        maxHeight: 1600,
      });
    }
  } catch (err) {
    return {
      storagePath: null,
      error: err instanceof Error ? err.message : 'Unable to compress receipt image.',
    };
  }
  const uploadBlob: Blob = compressedImage?.blob ?? file;
  const uploadType = compressedImage?.contentType ?? file.type;
  const ext = compressedImage?.extension ?? getReceiptExtension(file);
  if (isImage && uploadBlob.size > MAX_IMAGE_UPLOAD_BYTES) {
    return { storagePath: null, error: 'Compressed receipt image exceeds the 100 KB upload limit.' };
  }
  let uniqueToken = '';
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      uniqueToken = crypto.randomUUID().slice(0, 8);
    }
  } catch {
    // Fallback below
  }
  if (!uniqueToken) {
    uniqueToken = Math.random().toString(36).slice(2, 10);
  }

  const storagePath = `${orgId}/expenses/receipt-${Date.now()}-${uniqueToken}.${ext}`;
  const { error } = await supabase.storage
    .from(EXPENSE_RECEIPT_BUCKET)
    .upload(storagePath, uploadBlob, {
      upsert: false,
      contentType: uploadType,
      cacheControl: '3600',
    });

  if (error) {
    return {
      storagePath: null,
      error: `Failed to upload receipt attachment: ${error.message}`,
    };
  }

  return { storagePath, error: null };
}

export async function createExpenseReceiptSignedUrl(
  organisationId: string,
  storagePath: string
): Promise<{ signedUrl: string | null; error: string | null }> {
  const cleanPath = (storagePath ?? '').trim();
  if (!cleanPath || cleanPath.includes('..') || !cleanPath.startsWith(`${organisationId}/`)) {
    return { signedUrl: null, error: 'Invalid organization-scoped receipt path.' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { signedUrl: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { signedUrl: null, error: verified.error };
  }

  const { data, error } = await supabase.storage
    .from(EXPENSE_RECEIPT_BUCKET)
    .createSignedUrl(cleanPath, 300);

  if (error || !data?.signedUrl) {
    return {
      signedUrl: null,
      error: error?.message || 'Unable to generate receipt preview link.',
    };
  }

  return { signedUrl: data.signedUrl, error: null };
}

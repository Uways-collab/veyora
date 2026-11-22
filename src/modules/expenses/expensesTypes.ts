import type { OrganisationRole } from '../../core/types/domain';
import type { PaymentMethodCode } from '../sales/salesTypes';

export type ExpenseStatusValue = 'recorded' | 'voided';
export type ExpenseAuditAction = 'created' | 'updated' | 'voided';

export interface ExpenseCategoryRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRecord {
  id: string;
  organizationId: string;
  expenseNumber: string;
  categoryId: string;
  categoryNameSnapshot: string;
  paymentMethodId: string;
  paymentMethodNameSnapshot: string;
  paymentMethodCodeSnapshot: PaymentMethodCode | string;
  expenseDate: string;
  amount: number;
  currencyCode: string;
  description: string;
  vendorPayee: string | null;
  reference: string | null;
  receiptStoragePath: string | null;
  notes: string | null;
  status: ExpenseStatusValue;
  recordedBy: string | null;
  recordedByName: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string;
  voidedBy: string | null;
  voidedByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface ExpenseAuditLogRecord {
  id: string;
  organizationId: string;
  expenseId: string;
  action: ExpenseAuditAction;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  previousValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
}

export interface ExpenseListFilters {
  search: string;
  categoryId: string | null;
  paymentMethodId: string | null;
  status: 'all' | ExpenseStatusValue;
  dateFrom: string;
  dateTo: string;
  limit: number;
  offset: number;
}

export interface ExpenseListPagination {
  limit: number;
  offset: number;
  totalCount: number;
  hasMore: boolean;
}

export interface ExpenseListResult {
  expenses: ExpenseRecord[];
  pagination: ExpenseListPagination;
  error: string | null;
}

export interface ExpenseDetailResult {
  expense: ExpenseRecord | null;
  auditLogs: ExpenseAuditLogRecord[];
  error: string | null;
}

export interface ExpenseCurrencyTotal {
  currencyCode: string;
  expenseCount: number;
  totalAmount: number;
  averageAmount: number;
}

export interface ExpenseCategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  currencyCode: string;
  expenseCount: number;
  totalAmount: number;
  averageAmount: number;
}

export interface ExpensePaymentMethodBreakdownItem {
  paymentMethodId: string;
  paymentMethodName: string;
  paymentMethodCode: PaymentMethodCode | string;
  currencyCode: string;
  expenseCount: number;
  totalAmount: number;
  averageAmount: number;
}

export interface ExpenseMonthlyTrendItem {
  month: string;
  currencyCode: string;
  expenseCount: number;
  totalAmount: number;
  averageAmount: number;
}

export interface ExpenseSummaryResult {
  dateRange: {
    dateFrom: string | null;
    dateTo: string | null;
  };
  counts: {
    recordedCount: number;
    voidedCount: number;
  };
  totalsByCurrency: ExpenseCurrencyTotal[];
  categoryBreakdown: ExpenseCategoryBreakdownItem[];
  paymentMethodBreakdown: ExpensePaymentMethodBreakdownItem[];
  monthlyTrend: ExpenseMonthlyTrendItem[];
  error: string | null;
}

export interface CreateExpenseInput {
  categoryId: string;
  paymentMethodId: string;
  expenseDate: string;
  amount: number;
  description: string;
  idempotencyKey: string;
  vendorPayee: string | null;
  reference: string | null;
  notes: string | null;
  receiptStoragePath: string | null;
}

export interface UpdateExpenseInput {
  expenseId: string;
  categoryId: string;
  paymentMethodId: string;
  expenseDate: string;
  amount: number;
  description: string;
  editReason: string;
  vendorPayee: string | null;
  reference: string | null;
  notes: string | null;
  receiptStoragePath: string | null;
}

export interface VoidExpenseInput {
  expenseId: string;
  reason: string;
}

export interface CreateExpenseCategoryInput {
  name: string;
  description: string | null;
}

export interface UpdateExpenseCategoryInput {
  categoryId: string;
  name: string;
  description: string | null;
}

export function canRecordExpenses(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager' || role === 'staff';
}

export function canManageExpenses(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

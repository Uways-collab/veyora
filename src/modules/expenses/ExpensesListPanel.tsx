import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  Paperclip,
  PlusCircle,
  Receipt,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { formatMoneyAmount } from '../inventory/inventoryService';
import type { PaymentMethodRecord } from '../sales/salesTypes';
import {
  formatExpenseDate,
  formatExpenseStatusLabel,
} from './expensesFormatters';
import type {
  ExpenseCategoryRecord,
  ExpenseListFilters,
  ExpenseListResult,
  ExpenseRecord,
  ExpenseStatusValue,
} from './expensesTypes';

interface ExpensesListPanelProps {
  currencyCode: string;
  canManage: boolean;
  categories: ExpenseCategoryRecord[];
  paymentMethods: PaymentMethodRecord[];
  listResult: ExpenseListResult;
  filters: ExpenseListFilters;
  loading: boolean;
  refreshing: boolean;
  onFiltersChange: (patch: Partial<ExpenseListFilters>) => void;
  onResetFilters: () => void;
  onPageChange: (nextOffset: number) => void;
  onRefresh: () => void;
  onViewDetail: (expense: ExpenseRecord) => void;
  onEditExpense: (expense: ExpenseRecord) => void;
  onRecordExpense: () => void;
}

export function ExpensesListPanel({
  currencyCode,
  canManage,
  categories,
  paymentMethods,
  listResult,
  filters,
  loading,
  refreshing,
  onFiltersChange,
  onResetFilters,
  onPageChange,
  onRefresh,
  onViewDetail,
  onEditExpense,
  onRecordExpense,
}: ExpensesListPanelProps) {
  const { expenses, pagination, error } = listResult;
  const isInitialLoading = loading && !refreshing;

  const hasActiveFilters =
    Boolean(filters.search.trim()) ||
    Boolean(filters.categoryId) ||
    Boolean(filters.paymentMethodId) ||
    filters.status !== 'all' ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  const pageSize = Math.max(1, pagination.limit || filters.limit || 25);
  const currentPage = Math.floor(pagination.offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.totalCount / pageSize));

  const handleDateFromChange = (val: string) => {
    if (val && filters.dateTo && val > filters.dateTo) {
      onFiltersChange({ dateFrom: val, dateTo: val, offset: 0 });
      return;
    }
    onFiltersChange({ dateFrom: val, offset: 0 });
  };

  const handleDateToChange = (val: string) => {
    if (val && filters.dateFrom && filters.dateFrom > val) {
      onFiltersChange({ dateFrom: val, dateTo: val, offset: 0 });
      return;
    }
    onFiltersChange({ dateTo: val, offset: 0 });
  };

  return (
    <section
      aria-labelledby="expense-records-heading"
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 id="expense-records-heading" className="text-sm font-semibold text-slate-900">
            Expense Records
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Search and filter organization expenses, inspect audit trails, or attach receipts.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <span className="text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap">
            {pagination.totalCount} {pagination.totalCount === 1 ? 'expense' : 'expenses'}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
        <div className="lg:col-span-2 relative">
          <Search
            className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value, offset: 0 })}
            placeholder="Search expense #, description, vendor, ref..."
            aria-label="Search expenses"
            className="w-full pl-8 pr-8 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onFiltersChange({ search: '', offset: 0 })}
              aria-label="Clear expense search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={filters.categoryId ?? ''}
          onChange={(e) =>
            onFiltersChange({ categoryId: e.target.value || null, offset: 0 })
          }
          aria-label="Filter by expense category"
          className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">All categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
              {cat.isActive ? '' : ' (Archived)'}
            </option>
          ))}
        </select>

        <select
          value={filters.paymentMethodId ?? ''}
          onChange={(e) =>
            onFiltersChange({ paymentMethodId: e.target.value || null, offset: 0 })
          }
          aria-label="Filter by payment method"
          className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">All payment methods</option>
          {paymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(e) =>
            onFiltersChange({
              status: e.target.value as 'all' | ExpenseStatusValue,
              offset: 0,
            })
          }
          aria-label="Filter by expense status"
          className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="all">All statuses</option>
          <option value="recorded">Recorded</option>
          <option value="voided">Voided</option>
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => handleDateFromChange(e.target.value)}
            aria-label="Filter start date"
            className="w-full min-w-0 px-2 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <span className="text-slate-400 text-xs">–</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => handleDateToChange(e.target.value)}
            aria-label="Filter end date"
            className="w-full min-w-0 px-2 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {hasActiveFilters && (
        <div className="px-5 py-2 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between text-[11px] text-slate-600">
          <span>
            Showing {expenses.length} of {pagination.totalCount} matching{' '}
            {pagination.totalCount === 1 ? 'expense' : 'expenses'}
          </span>
          <button
            type="button"
            onClick={onResetFilters}
            className="font-medium text-blue-700 hover:text-blue-800"
          >
            Reset filters
          </button>
        </div>
      )}

      {/* States & Data Grid */}
      {isInitialLoading ? (
        <div className="p-5 space-y-2.5" aria-busy="true">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50/60 text-xs text-red-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5 min-w-0">
              <div className="font-semibold">Unable to load expense records</div>
              <div className="break-words text-red-800">{error}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-md border border-red-300 bg-white text-xs font-medium text-red-800 hover:bg-red-50 whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      ) : expenses.length === 0 ? (
        <div className="p-10 text-center space-y-2">
          <Receipt className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
          <div className="text-xs font-semibold text-slate-900">No expenses found</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {hasActiveFilters
              ? 'No expenses match your current search or filter settings.'
              : 'Recorded and voided expenses for this organization will appear here.'}
          </p>
          <div className="pt-1 flex items-center justify-center gap-2">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={onResetFilters}
                className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </button>
            ) : (
              <button
                type="button"
                onClick={onRecordExpense}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
              >
                <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Record Expense</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Expense #</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Description</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Vendor / Payee</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Payment Method</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Recorded By</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {expenses.map((exp) => {
                  const cur = exp.currencyCode || currencyCode;
                  const isVoided = exp.status === 'voided';
                  return (
                    <tr
                      key={exp.id}
                      className={`hover:bg-slate-50/60 transition-colors ${
                        isVoided ? 'bg-slate-50/40 text-slate-500' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onViewDetail(exp)}
                          className="hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:underline"
                        >
                          {exp.expenseNumber}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap tabular-nums">
                        {formatExpenseDate(exp.expenseDate)}
                      </td>
                      <td className="py-3 px-4 text-slate-800 whitespace-nowrap">
                        {exp.categoryNameSnapshot}
                      </td>
                      <td className="py-3 px-4 text-slate-800 max-w-[260px]">
                        <div className="truncate font-medium text-slate-900" title={exp.description}>
                          {exp.description}
                        </div>
                        {(exp.reference || exp.receiptStoragePath) && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                            {exp.reference && (
                              <span className="font-mono truncate max-w-[160px]">
                                Ref: {exp.reference}
                              </span>
                            )}
                            {exp.receiptStoragePath && (
                              <span className="inline-flex items-center gap-0.5 text-slate-500">
                                <Paperclip className="h-3 w-3" aria-hidden="true" />
                                <span>Receipt</span>
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 max-w-[160px] truncate">
                        {exp.vendorPayee || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {exp.paymentMethodNameSnapshot}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-medium tabular-nums whitespace-nowrap ${
                          isVoided ? 'line-through text-slate-400' : 'text-slate-900'
                        }`}
                      >
                        {formatMoneyAmount(exp.amount, cur)}{' '}
                        <span className="text-[10px] font-normal text-slate-500">{cur}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            isVoided ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatExpenseStatusLabel(exp.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {exp.recordedByName || 'Workspace user'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewDetail(exp)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="h-3 w-3" aria-hidden="true" />
                            <span>Details</span>
                          </button>
                          {canManage && !isVoided && (
                            <button
                              type="button"
                              onClick={() => onEditExpense(exp)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Edit3 className="h-3 w-3" aria-hidden="true" />
                              <span>Edit</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(pagination.offset > 0 || pagination.hasMore) && (
            <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                Page <span className="font-mono font-medium">{currentPage}</span> of{' '}
                <span className="font-mono font-medium">{totalPages}</span> · Showing{' '}
                <span className="font-mono font-medium">{pagination.offset + 1}</span>–
                <span className="font-mono font-medium">
                  {pagination.offset + expenses.length}
                </span>{' '}
                of <span className="font-mono font-medium">{pagination.totalCount}</span>
              </span>
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onPageChange(Math.max(0, pagination.offset - pageSize))}
                  disabled={pagination.offset === 0 || loading}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  onClick={() => onPageChange(pagination.offset + pageSize)}
                  disabled={!pagination.hasMore || loading}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

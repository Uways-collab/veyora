import { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CreditCard,
  FolderKanban,
  PlusCircle,
  Receipt,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { formatMoneyAmount } from '../inventory/inventoryService';
import { formatPaymentMethodCodeLabel } from '../sales/salesFormatters';
import {
  formatExpenseDate,
  formatExpenseMonthLabel,
  getCurrentMonthStartDateInputValue,
  getDaysAgoDateInputValue,
  getTodayDateInputValue,
} from './expensesFormatters';
import type { ExpenseSummaryResult } from './expensesTypes';

interface ExpensesDashboardPanelProps {
  currencyCode: string;
  timeZone?: string | null;
  summary: ExpenseSummaryResult;
  loading: boolean;
  refreshing: boolean;
  dateFrom: string;
  dateTo: string;
  onDateRangeChange: (nextFrom: string, nextTo: string) => void;
  onRefresh: () => void;
  onRecordExpense: () => void;
  onViewRecords: () => void;
}

export function ExpensesDashboardPanel({
  currencyCode,
  timeZone,
  summary,
  loading,
  refreshing,
  dateFrom,
  dateTo,
  onDateRangeChange,
  onRefresh,
  onRecordExpense,
  onViewRecords,
}: ExpensesDashboardPanelProps) {
  const [rangeError, setRangeError] = useState<string | null>(null);
  const isInitialLoading = loading && !refreshing;

  const today = getTodayDateInputValue(timeZone);
  const thisMonthStart = getCurrentMonthStartDateInputValue(timeZone);
  const last30Start = getDaysAgoDateInputValue(29, timeZone);
  const thisYearStart = `${today.slice(0, 4)}-01-01`;

  const applyPreset = (nextFrom: string, nextTo: string) => {
    setRangeError(null);
    onDateRangeChange(nextFrom, nextTo);
  };

  const handleFromChange = (val: string) => {
    if (val && dateTo && val > dateTo) {
      setRangeError('Start date cannot be after end date.');
      onDateRangeChange(val, val);
      return;
    }
    setRangeError(null);
    onDateRangeChange(val, dateTo);
  };

  const handleToChange = (val: string) => {
    if (val && dateFrom && dateFrom > val) {
      setRangeError('End date cannot be before start date.');
      onDateRangeChange(val, val);
      return;
    }
    setRangeError(null);
    onDateRangeChange(dateFrom, val);
  };

  const isAllTime = !dateFrom && !dateTo;
  const isThisMonth = dateFrom === thisMonthStart && dateTo === today;
  const isLast30 = dateFrom === last30Start && dateTo === today;
  const isThisYear = dateFrom === thisYearStart && dateTo === today;

  // Per-currency denominators so percentages/bars never mix currencies
  const currencyTotalLookup = new Map<string, number>();
  for (const ct of summary.totalsByCurrency) {
    currencyTotalLookup.set(ct.currencyCode, ct.totalAmount);
  }

  const maxMonthlyByCurrency = new Map<string, number>();
  for (const item of summary.monthlyTrend) {
    const prev = maxMonthlyByCurrency.get(item.currencyCode) ?? 0;
    if (item.totalAmount > prev) {
      maxMonthlyByCurrency.set(item.currencyCode, item.totalAmount);
    }
  }

  const rangeLabel =
    dateFrom && dateTo
      ? `${formatExpenseDate(dateFrom)} – ${formatExpenseDate(dateTo)}`
      : dateFrom
        ? `From ${formatExpenseDate(dateFrom)}`
        : dateTo
          ? `Through ${formatExpenseDate(dateTo)}`
          : 'All recorded dates';

  return (
    <div className="space-y-6">
      {/* Date Range Controls */}
      <section
        aria-label="Summary date range"
        className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 mr-1">
            <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span>Period</span>
          </span>
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => applyPreset('', '')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                isAllTime ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
            <button
              type="button"
              onClick={() => applyPreset(thisMonthStart, today)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                isThisMonth
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => applyPreset(last30Start, today)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                isLast30 ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => applyPreset(thisYearStart, today)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                isThisYear
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This Year
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor="expense-summary-from" className="text-[11px] text-slate-500">
              From
            </label>
            <input
              id="expense-summary-from"
              type="date"
              value={dateFrom}
              onChange={(e) => handleFromChange(e.target.value)}
              className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="expense-summary-to" className="text-[11px] text-slate-500">
              To
            </label>
            <input
              id="expense-summary-to"
              type="date"
              value={dateTo}
              onChange={(e) => handleToChange(e.target.value)}
              className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          {!isAllTime && (
            <button
              type="button"
              onClick={() => applyPreset('', '')}
              className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </section>

      {rangeError && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs text-amber-900"
        >
          {rangeError}
        </div>
      )}

      {summary.error && (
        <section
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-red-900"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="font-semibold">Unable to load expense summary</div>
              <div className="text-red-800 mt-0.5">{summary.error}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 bg-white text-xs font-medium text-red-800 hover:bg-red-50 self-start sm:self-auto whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </section>
      )}

      {/* KPI Summary Strip */}
      <section aria-labelledby="expenses-kpi-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="expenses-kpi-heading" className="text-sm font-semibold text-slate-900">
            Expense Summary
          </h2>
          <span className="text-xs text-slate-500">
            {rangeLabel} · Voided expenses excluded from totals
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          {/* Total Expenses (Currency-Separated) */}
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Total Expenses</span>
              <Receipt className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-28 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : summary.totalsByCurrency.length === 0 ? (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(0, currencyCode)}
                </div>
                <div className="mt-1 text-xs text-slate-500">No recorded expenses in period</div>
              </div>
            ) : summary.totalsByCurrency.length === 1 ? (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(
                    summary.totalsByCurrency[0].totalAmount,
                    summary.totalsByCurrency[0].currencyCode
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Currency: {summary.totalsByCurrency[0].currencyCode}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {summary.totalsByCurrency.map((item) => (
                  <div
                    key={item.currencyCode}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-[11px] font-mono text-slate-500">
                      {item.currencyCode}
                    </span>
                    <span className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {formatMoneyAmount(item.totalAmount, item.currencyCode)}
                    </span>
                  </div>
                ))}
                <div className="text-[11px] text-slate-500 pt-0.5">
                  Totals separated by currency
                </div>
              </div>
            )}
          </div>

          {/* Expense Count */}
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Expense Count</span>
              <BarChart3 className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {summary.counts.recordedCount}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Recorded · {summary.counts.voidedCount} voided
                </div>
              </div>
            )}
          </div>

          {/* Average Expense (Currency-Separated) */}
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Average Expense</span>
              <TrendingUp className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-24 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : summary.totalsByCurrency.length === 0 ? (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(0, currencyCode)}
                </div>
                <div className="mt-1 text-xs text-slate-500">Per recorded expense</div>
              </div>
            ) : summary.totalsByCurrency.length === 1 ? (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(
                    summary.totalsByCurrency[0].averageAmount,
                    summary.totalsByCurrency[0].currencyCode
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Across {summary.totalsByCurrency[0].expenseCount}{' '}
                  {summary.totalsByCurrency[0].expenseCount === 1 ? 'expense' : 'expenses'}
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {summary.totalsByCurrency.map((item) => (
                  <div
                    key={item.currencyCode}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-[11px] font-mono text-slate-500">
                      {item.currencyCode} ({item.expenseCount})
                    </span>
                    <span className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                      {formatMoneyAmount(item.averageAmount, item.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Categories & Methods Summary */}
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Breakdown Coverage</span>
              <FolderKanban className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-20 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {new Set(summary.categoryBreakdown.map((c) => c.categoryId)).size}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    Categories ·{' '}
                    {new Set(summary.paymentMethodBreakdown.map((m) => m.paymentMethodId)).size}{' '}
                    methods
                  </span>
                  <button
                    type="button"
                    onClick={onViewRecords}
                    className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                  >
                    View ledger
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Empty State when no recorded expenses exist in range */}
      {!isInitialLoading && !summary.error && summary.counts.recordedCount === 0 ? (
        <section className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-2.5">
          <Receipt className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
          <div className="text-sm font-semibold text-slate-900">
            No recorded expenses for this period
          </div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {isAllTime
              ? 'Record your first business expense to populate totals, category breakdowns, payment method shares, and monthly trends.'
              : 'No recorded expenses match the selected date range. Adjust the period or record a new expense.'}
          </p>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onRecordExpense}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Record Expense</span>
            </button>
            {!isAllTime && (
              <button
                type="button"
                onClick={() => applyPreset('', '')}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Show All Dates
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* Category & Payment Method Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category Breakdown */}
            <section
              aria-labelledby="expense-category-breakdown-heading"
              className="bg-white border border-slate-200 rounded-lg overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <h3
                    id="expense-category-breakdown-heading"
                    className="text-sm font-semibold text-slate-900"
                  >
                    Category Breakdown
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Spend grouped by expense category and currency.
                  </p>
                </div>
                <FolderKanban className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              </div>

              {isInitialLoading ? (
                <div className="p-5 space-y-2.5" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
                  ))}
                </div>
              ) : summary.categoryBreakdown.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No category spending recorded in this period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Count</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Average</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Total</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {summary.categoryBreakdown.map((row) => {
                        const curTotal = currencyTotalLookup.get(row.currencyCode) ?? 0;
                        const sharePct =
                          curTotal > 0 ? Math.min(100, (row.totalAmount / curTotal) * 100) : 0;
                        return (
                          <tr
                            key={`${row.categoryId}-${row.currencyCode}`}
                            className="hover:bg-slate-50/60 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900">{row.categoryName}</div>
                              <div className="mt-1 h-1.5 w-28 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-600 rounded-full"
                                  style={{ width: `${Math.max(4, Math.round(sharePct))}%` }}
                                />
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {row.expenseCount}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {formatMoneyAmount(row.averageAmount, row.currencyCode)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                              {formatMoneyAmount(row.totalAmount, row.currencyCode)}{' '}
                              <span className="text-[10px] font-normal text-slate-500">
                                {row.currencyCode}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {sharePct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Payment Method Breakdown */}
            <section
              aria-labelledby="expense-payment-method-breakdown-heading"
              className="bg-white border border-slate-200 rounded-lg overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <h3
                    id="expense-payment-method-breakdown-heading"
                    className="text-sm font-semibold text-slate-900"
                  >
                    Payment Method Breakdown
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Spend grouped by payment channel and currency.
                  </p>
                </div>
                <CreditCard className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
              </div>

              {isInitialLoading ? (
                <div className="p-5 space-y-2.5" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
                  ))}
                </div>
              ) : summary.paymentMethodBreakdown.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No payment method spending recorded in this period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-4 whitespace-nowrap">Payment Method</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Count</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Average</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Total</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {summary.paymentMethodBreakdown.map((row) => {
                        const curTotal = currencyTotalLookup.get(row.currencyCode) ?? 0;
                        const sharePct =
                          curTotal > 0 ? Math.min(100, (row.totalAmount / curTotal) * 100) : 0;
                        return (
                          <tr
                            key={`${row.paymentMethodId}-${row.currencyCode}`}
                            className="hover:bg-slate-50/60 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900">
                                {row.paymentMethodName}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatPaymentMethodCodeLabel(row.paymentMethodCode)}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {row.expenseCount}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {formatMoneyAmount(row.averageAmount, row.currencyCode)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                              {formatMoneyAmount(row.totalAmount, row.currencyCode)}{' '}
                              <span className="text-[10px] font-normal text-slate-500">
                                {row.currencyCode}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {sharePct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Monthly Trend */}
          <section
            aria-labelledby="expense-monthly-trend-heading"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3
                  id="expense-monthly-trend-heading"
                  className="text-sm font-semibold text-slate-900"
                >
                  Monthly Trend
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chronological monthly totals scaled strictly per currency.
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>

            {isInitialLoading ? (
              <div className="p-5 space-y-2.5" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : summary.monthlyTrend.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No monthly expense trend data for this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4 whitespace-nowrap">Month</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Currency</th>
                      <th className="py-2.5 px-4 w-1/3 whitespace-nowrap">Relative Volume</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Count</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Average</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {summary.monthlyTrend.map((row) => {
                      const maxForCurrency = maxMonthlyByCurrency.get(row.currencyCode) ?? 0;
                      const barPct =
                        maxForCurrency > 0
                          ? Math.min(100, (row.totalAmount / maxForCurrency) * 100)
                          : 0;
                      return (
                        <tr
                          key={`${row.month}-${row.currencyCode}`}
                          className="hover:bg-slate-50/60 transition-colors"
                        >
                          <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                            {formatExpenseMonthLabel(row.month)}
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                            {row.currencyCode}
                          </td>
                          <td className="py-3 px-4">
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-slate-800 rounded-full"
                                style={{ width: `${Math.max(3, Math.round(barPct))}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {row.expenseCount}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {formatMoneyAmount(row.averageAmount, row.currencyCode)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                            {formatMoneyAmount(row.totalAmount, row.currencyCode)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

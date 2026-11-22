import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, PlusCircle, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import type { PaymentMethodRecord } from '../sales/salesTypes';
import { ExpenseCategoriesPanel } from './ExpenseCategoriesPanel';
import { ExpenseDetailModal } from './ExpenseDetailModal';
import { ExpenseFormModal } from './ExpenseFormModal';
import { ExpensesDashboardPanel } from './ExpensesDashboardPanel';
import { ExpensesListPanel } from './ExpensesListPanel';
import {
  getCurrentMonthStartDateInputValue,
  getTodayDateInputValue,
} from './expensesFormatters';
import {
  buildEmptyExpenseListResult,
  buildEmptyExpenseSummaryResult,
  fetchExpenseCategories,
  fetchExpensePaymentMethods,
  fetchExpensesList,
  fetchExpensesSummary,
} from './expensesService';
import {
  canManageExpenses,
  canRecordExpenses,
  type ExpenseCategoryRecord,
  type ExpenseListFilters,
  type ExpenseListResult,
  type ExpenseRecord,
  type ExpenseSummaryResult,
} from './expensesTypes';

type ExpensesTab = 'overview' | 'records' | 'categories';

const DEFAULT_LIST_LIMIT = 25;

function createInitialListFilters(): ExpenseListFilters {
  return {
    search: '',
    categoryId: null,
    paymentMethodId: null,
    status: 'all',
    dateFrom: '',
    dateTo: '',
    limit: DEFAULT_LIST_LIMIT,
    offset: 0,
  };
}

export function ExpensesView() {
  const { status, activeOrganisation, activeRole } = useAuth();
  const activeOrgId = activeOrganisation?.id ?? null;
  const currencyCode = activeOrganisation?.base_currency ?? 'USD';
  const timeZone = activeOrganisation?.timezone;

  const canRecord = canRecordExpenses(activeRole);
  const canManage = canManageExpenses(activeRole);

  const [activeTab, setActiveTab] = useState<ExpensesTab>('overview');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Reference metadata (categories + active payment methods)
  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaRefreshing, setMetaRefreshing] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Dashboard summary state (default: current month to today in organization timezone)
  const [summaryDateFrom, setSummaryDateFrom] = useState<string>(() =>
    getCurrentMonthStartDateInputValue(timeZone)
  );
  const [summaryDateTo, setSummaryDateTo] = useState<string>(() =>
    getTodayDateInputValue(timeZone)
  );
  const [summary, setSummary] = useState<ExpenseSummaryResult>(() =>
    buildEmptyExpenseSummaryResult()
  );
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);

  // Expense records list state
  const [listFilters, setListFilters] = useState<ExpenseListFilters>(createInitialListFilters);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [listResult, setListResult] = useState<ExpenseListResult>(() =>
    buildEmptyExpenseListResult(DEFAULT_LIST_LIMIT, 0)
  );
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);

  // Modals
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);

  // Sequence refs to ignore stale responses across rapid filter edits / workspace switches
  const metaSeqRef = useRef(0);
  const summarySeqRef = useRef(0);
  const listSeqRef = useRef(0);

  // Debounce search query changes
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(listFilters.search);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [listFilters.search]);

  // Reset workspace-scoped state cleanly when organization switches
  useEffect(() => {
    metaSeqRef.current += 1;
    summarySeqRef.current += 1;
    listSeqRef.current += 1;

    setFeedbackMessage(null);
    setFormModalOpen(false);
    setEditingExpense(null);
    setDetailExpenseId(null);
    setListFilters(createInitialListFilters());
    setDebouncedSearch('');
    setSummaryDateFrom(getCurrentMonthStartDateInputValue(timeZone));
    setSummaryDateTo(getTodayDateInputValue(timeZone));

    if (status !== 'authenticated' || !activeOrgId) {
      setCategories([]);
      setPaymentMethods([]);
      setMetaError(null);
      setMetaLoading(false);
      setSummary(buildEmptyExpenseSummaryResult());
      setSummaryLoading(false);
      setListResult(buildEmptyExpenseListResult(DEFAULT_LIST_LIMIT, 0));
      setListLoading(false);
    }
  }, [status, activeOrgId, timeZone]);

  const loadMetadata = useCallback(
    async (orgId: string, isManualRefresh = false) => {
      const seq = ++metaSeqRef.current;
      if (isManualRefresh) {
        setMetaRefreshing(true);
      } else {
        setMetaLoading(true);
      }

      const [catRes, methodRes] = await Promise.all([
        fetchExpenseCategories(orgId, true),
        fetchExpensePaymentMethods(orgId),
      ]);

      if (seq !== metaSeqRef.current) return;

      setCategories(catRes.categories);
      setPaymentMethods(methodRes.paymentMethods);
      setMetaError(catRes.error || methodRes.error || null);
      setMetaLoading(false);
      setMetaRefreshing(false);
    },
    []
  );

  const loadSummary = useCallback(
    async (orgId: string, from: string, to: string, isManualRefresh = false) => {
      const seq = ++summarySeqRef.current;
      if (isManualRefresh) {
        setSummaryRefreshing(true);
      } else {
        setSummaryLoading(true);
      }

      const res = await fetchExpensesSummary(orgId, from || null, to || null, currencyCode);
      if (seq !== summarySeqRef.current) return;

      setSummary(res);
      setSummaryLoading(false);
      setSummaryRefreshing(false);
    },
    [currencyCode]
  );

  const loadList = useCallback(
    async (orgId: string, effectiveFilters: ExpenseListFilters, isManualRefresh = false) => {
      const seq = ++listSeqRef.current;
      if (isManualRefresh) {
        setListRefreshing(true);
      } else {
        setListLoading(true);
      }

      const res = await fetchExpensesList(orgId, effectiveFilters, currencyCode);
      if (seq !== listSeqRef.current) return;

      setListResult(res);
      setListLoading(false);
      setListRefreshing(false);
    },
    [currencyCode]
  );

  // Load metadata when authenticated & organization active
  useEffect(() => {
    if (status === 'authenticated' && activeOrgId) {
      void loadMetadata(activeOrgId, false);
    }
  }, [status, activeOrgId, loadMetadata]);

  // Load dashboard summary when authenticated / range changes
  useEffect(() => {
    if (status === 'authenticated' && activeOrgId) {
      void loadSummary(activeOrgId, summaryDateFrom, summaryDateTo, false);
    }
  }, [status, activeOrgId, summaryDateFrom, summaryDateTo, loadSummary]);

  // Load list whenever effective server-side filters change
  useEffect(() => {
    if (status !== 'authenticated' || !activeOrgId) return;
    const effectiveFilters: ExpenseListFilters = {
      ...listFilters,
      search: debouncedSearch,
    };
    void loadList(activeOrgId, effectiveFilters, false);
  }, [
    status,
    activeOrgId,
    debouncedSearch,
    listFilters.categoryId,
    listFilters.paymentMethodId,
    listFilters.status,
    listFilters.dateFrom,
    listFilters.dateTo,
    listFilters.limit,
    listFilters.offset,
    loadList,
  ]);

  // Auto step-back if current page becomes empty after edits/filters while totalCount > 0
  useEffect(() => {
    if (
      !listLoading &&
      !listResult.error &&
      listResult.expenses.length === 0 &&
      listFilters.offset > 0 &&
      listResult.pagination.totalCount > 0
    ) {
      const prevOffset = Math.max(0, listFilters.offset - listFilters.limit);
      setListFilters((prev) => ({ ...prev, offset: prevOffset }));
    }
  }, [
    listLoading,
    listResult.error,
    listResult.expenses.length,
    listResult.pagination.totalCount,
    listFilters.offset,
    listFilters.limit,
  ]);

  const handleGlobalRefresh = async () => {
    if (!activeOrgId) return;
    const effectiveFilters: ExpenseListFilters = {
      ...listFilters,
      search: debouncedSearch,
    };
    await Promise.all([
      loadMetadata(activeOrgId, true),
      loadSummary(activeOrgId, summaryDateFrom, summaryDateTo, true),
      loadList(activeOrgId, effectiveFilters, true),
    ]);
  };

  const handleFiltersChange = (patch: Partial<ExpenseListFilters>) => {
    setListFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleResetFilters = () => {
    setDebouncedSearch('');
    setListFilters(createInitialListFilters());
  };

  const handleOpenCreateModal = () => {
    if (!canRecord) return;
    setEditingExpense(null);
    setFormModalOpen(true);
  };

  const handleOpenEditModal = (expense: ExpenseRecord) => {
    if (!canManage || expense.status === 'voided') return;
    setEditingExpense(expense);
    setFormModalOpen(true);
  };

  const handleFormSuccess = async (expense: ExpenseRecord, mode: 'create' | 'edit') => {
    setFormModalOpen(false);
    setEditingExpense(null);

    if (mode === 'edit' && detailExpenseId === expense.id) {
      setDetailRefreshToken((prev) => prev + 1);
    }

    setFeedbackMessage(
      mode === 'create'
        ? `Expense ${expense.expenseNumber} recorded.`
        : `Expense ${expense.expenseNumber} updated.`
    );

    if (!activeOrgId) return;
    const effectiveFilters: ExpenseListFilters = {
      ...listFilters,
      search: debouncedSearch,
    };
    await Promise.all([
      loadSummary(activeOrgId, summaryDateFrom, summaryDateTo, true),
      loadList(activeOrgId, effectiveFilters, true),
    ]);
  };

  const handleVoidSuccess = async (expense: ExpenseRecord) => {
    setFeedbackMessage(`Expense ${expense.expenseNumber} has been voided.`);
    if (!activeOrgId) return;
    const effectiveFilters: ExpenseListFilters = {
      ...listFilters,
      search: debouncedSearch,
    };
    await Promise.all([
      loadSummary(activeOrgId, summaryDateFrom, summaryDateTo, true),
      loadList(activeOrgId, effectiveFilters, true),
    ]);
  };

  const handleCategoriesChanged = async (message: string) => {
    setFeedbackMessage(message);
    if (!activeOrgId) return;
    const effectiveFilters: ExpenseListFilters = {
      ...listFilters,
      search: debouncedSearch,
    };
    await Promise.all([
      loadMetadata(activeOrgId, true),
      loadSummary(activeOrgId, summaryDateFrom, summaryDateTo, true),
      loadList(activeOrgId, effectiveFilters, true),
    ]);
  };

  const isRefreshingAny = metaRefreshing || summaryRefreshing || listRefreshing;

  const tabs: Array<{ id: ExpensesTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'records', label: 'Expense Records' },
    { id: 'categories', label: 'Categories' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <section
        aria-labelledby="expenses-heading"
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5"
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Financial</span>
            <span aria-hidden="true">·</span>
            <span>Currency: {currencyCode}</span>
          </div>
          <h1
            id="expenses-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Expenses
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Record operating expenses, attach receipts, manage categories, and review spend summaries for{' '}
            {activeOrganisation?.name ?? 'your workspace'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canRecord && (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              disabled={!activeOrgId}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Record Expense</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleGlobalRefresh()}
            disabled={!activeOrgId || isRefreshingAny}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshingAny ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isRefreshingAny ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Expenses sections"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dismissible Feedback Banner */}
      {feedbackMessage && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{feedbackMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            aria-label="Dismiss notification"
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <ExpensesDashboardPanel
          currencyCode={currencyCode}
          timeZone={timeZone}
          summary={summary}
          loading={summaryLoading}
          refreshing={summaryRefreshing}
          dateFrom={summaryDateFrom}
          dateTo={summaryDateTo}
          onDateRangeChange={(nextFrom, nextTo) => {
            setSummaryDateFrom(nextFrom);
            setSummaryDateTo(nextTo);
          }}
          onRefresh={() => {
            if (activeOrgId) {
              void loadSummary(activeOrgId, summaryDateFrom, summaryDateTo, true);
            }
          }}
          onRecordExpense={handleOpenCreateModal}
          onViewRecords={() => setActiveTab('records')}
        />
      )}

      {activeTab === 'records' && (
        <ExpensesListPanel
          currencyCode={currencyCode}
          canManage={canManage}
          categories={categories}
          paymentMethods={paymentMethods}
          listResult={listResult}
          filters={listFilters}
          loading={listLoading}
          refreshing={listRefreshing}
          onFiltersChange={handleFiltersChange}
          onResetFilters={handleResetFilters}
          onPageChange={(nextOffset) =>
            setListFilters((prev) => ({ ...prev, offset: nextOffset }))
          }
          onRefresh={() => {
            if (activeOrgId) {
              void loadList(
                activeOrgId,
                { ...listFilters, search: debouncedSearch },
                true
              );
            }
          }}
          onViewDetail={(expense) => setDetailExpenseId(expense.id)}
          onEditExpense={handleOpenEditModal}
          onRecordExpense={handleOpenCreateModal}
        />
      )}

      {activeTab === 'categories' && activeOrgId && (
        <ExpenseCategoriesPanel
          organisationId={activeOrgId}
          timeZone={timeZone}
          categories={categories}
          loading={metaLoading}
          refreshing={metaRefreshing}
          error={metaError}
          canManage={canManage}
          onRefresh={() => void loadMetadata(activeOrgId, true)}
          onCategoriesChanged={handleCategoriesChanged}
        />
      )}

      {/* Record / Edit Expense Modal */}
      {activeOrgId && (
        <ExpenseFormModal
          open={formModalOpen}
          organisationId={activeOrgId}
          currencyCode={currencyCode}
          timeZone={timeZone}
          categories={categories}
          paymentMethods={paymentMethods}
          editingExpense={editingExpense}
          canManageCategories={canManage}
          onOpenCategoriesTab={() => setActiveTab('categories')}
          onClose={() => {
            setFormModalOpen(false);
            setEditingExpense(null);
          }}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Expense Detail & Audit History Modal */}
      {activeOrgId && (
        <ExpenseDetailModal
          expenseId={detailExpenseId}
          organisationId={activeOrgId}
          currencyCode={currencyCode}
          timeZone={timeZone}
          canManage={canManage}
          refreshToken={detailRefreshToken}
          onClose={() => setDetailExpenseId(null)}
          onEdit={handleOpenEditModal}
          onVoidSuccess={handleVoidSuccess}
        />
      )}
    </div>
  );
}

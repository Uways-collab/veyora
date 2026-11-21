import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  History,
  Mail,
  Phone,
  Receipt,
  RefreshCw,
  Search,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { CustomerDetailModal } from '../customers/CustomerDetailModal';
import type { CustomerRecord } from '../customers/customersTypes';
import { formatMoneyAmount } from '../inventory/inventoryService';
import { FollowUpPaymentModal, type FollowUpPaymentSaleInfo } from './FollowUpPaymentModal';
import {
  formatPaymentStatusLabel,
  formatSalesDateTime,
  formatSalesShortDate,
} from './salesFormatters';
import {
  buildEmptyOutstandingBalancesResult,
  fetchActivePaymentMethods,
  fetchOutstandingBalances,
} from './salesService';
import type {
  OutstandingBalancesResult,
  OutstandingCustomerRecord,
  OutstandingCustomerSaleRecord,
  PaymentMethodRecord,
} from './salesTypes';

interface OutstandingBalancesPanelProps {
  organisationId: string;
  currencyCode: string;
  timeZone?: string | null;
  paymentMethods: PaymentMethodRecord[];
  onReloadSales: () => Promise<void>;
}

const PAGE_SIZE = 25;

function toCustomerRecord(
  customer: OutstandingCustomerRecord,
  organisationId: string
): CustomerRecord {
  return {
    id: customer.customerId,
    organizationId: organisationId,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: null,
    notes: null,
    isActive: customer.isActive,
    archivedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

export function OutstandingBalancesPanel({
  organisationId,
  currencyCode,
  timeZone,
  paymentMethods,
  onReloadSales,
}: OutstandingBalancesPanelProps) {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<OutstandingBalancesResult>(() =>
    buildEmptyOutstandingBalancesResult(PAGE_SIZE, 0)
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fallbackMethods, setFallbackMethods] = useState<PaymentMethodRecord[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);

  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Record<string, boolean>>({});
  const [viewingCustomer, setViewingCustomer] = useState<CustomerRecord | null>(null);
  const [payModalSale, setPayModalSale] = useState<FollowUpPaymentSaleInfo | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const isMountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const methodsRequestSeqRef = useRef(0);
  const activeOrgRef = useRef(organisationId);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const propActiveMethods = useMemo(
    () => paymentMethods.filter((m) => m.isActive),
    [paymentMethods]
  );
  const effectiveActiveMethods =
    propActiveMethods.length > 0 ? propActiveMethods : fallbackMethods;

  const loadBalances = useCallback(
    async (
      orgId: string,
      search: string,
      nextOffset: number,
      mode: 'initial' | 'refresh',
      allowStepBack = true
    ) => {
      const seq = ++requestSeqRef.current;
      if (mode === 'refresh') {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);

      const res = await fetchOutstandingBalances(
        orgId,
        search,
        PAGE_SIZE,
        nextOffset,
        currencyCode
      );

      if (!isMountedRef.current) return;
      if (activeOrgRef.current !== orgId) return;
      if (seq !== requestSeqRef.current) return;

      if (res.error) {
        setLoading(false);
        setRefreshing(false);
        setLoadError(res.error);
        return;
      }

      // If current page became empty after settling balances on a later page, step back cleanly
      if (
        allowStepBack &&
        res.customers.length === 0 &&
        nextOffset > 0 &&
        res.pagination.totalCustomers > 0
      ) {
        const lastPageOffset =
          Math.max(0, Math.ceil(res.pagination.totalCustomers / PAGE_SIZE) - 1) * PAGE_SIZE;
        if (lastPageOffset !== nextOffset) {
          setOffset(lastPageOffset);
          await loadBalances(orgId, search, lastPageOffset, mode, false);
          return;
        }
      }

      setLoading(false);
      setRefreshing(false);
      setData(res);
    },
    [currencyCode]
  );

  const ensureActivePaymentMethods = useCallback(
    async (orgId: string) => {
      if (propActiveMethods.length > 0) return;
      const seq = ++methodsRequestSeqRef.current;
      setMethodsLoading(true);
      setMethodsError(null);

      const res = await fetchActivePaymentMethods(orgId);

      if (!isMountedRef.current) return;
      if (activeOrgRef.current !== orgId) return;
      if (seq !== methodsRequestSeqRef.current) return;

      setMethodsLoading(false);
      if (res.error) {
        setMethodsError(res.error);
      } else {
        setFallbackMethods(res.paymentMethods);
      }
    },
    [propActiveMethods.length]
  );

  // Reset state cleanly when workspace changes
  useEffect(() => {
    activeOrgRef.current = organisationId;
    requestSeqRef.current += 1;
    methodsRequestSeqRef.current += 1;

    setSearchInput('');
    setAppliedSearch('');
    setOffset(0);
    setData(buildEmptyOutstandingBalancesResult(PAGE_SIZE, 0));
    setLoading(true);
    setRefreshing(false);
    setLoadError(null);
    setFallbackMethods([]);
    setMethodsLoading(false);
    setMethodsError(null);
    setExpandedCustomerIds({});
    setViewingCustomer(null);
    setPayModalSale(null);
    setFeedback(null);

    if (organisationId) {
      void loadBalances(organisationId, '', 0, 'initial');
      void ensureActivePaymentMethods(organisationId);
    } else {
      setLoading(false);
    }
  }, [organisationId, loadBalances, ensureActivePaymentMethods]);

  // Debounce search input and reset pagination to offset 0
  useEffect(() => {
    if (!organisationId) return;
    const trimmed = searchInput.trim();
    if (trimmed === appliedSearch) return;

    const timer = window.setTimeout(() => {
      setAppliedSearch(trimmed);
      setOffset(0);
      void loadBalances(organisationId, trimmed, 0, 'initial');
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput, appliedSearch, organisationId, loadBalances]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!organisationId) return;
    const trimmed = searchInput.trim();
    setAppliedSearch(trimmed);
    setOffset(0);
    void loadBalances(organisationId, trimmed, 0, 'initial');
  };

  const handleClearSearch = () => {
    setSearchInput('');
    if (!organisationId) return;
    setAppliedSearch('');
    setOffset(0);
    void loadBalances(organisationId, '', 0, 'initial');
  };

  const handlePageChange = (nextOffset: number) => {
    if (!organisationId || nextOffset === offset) return;
    setOffset(nextOffset);
    void loadBalances(organisationId, appliedSearch, nextOffset, 'initial');
  };

  const handleManualRefresh = () => {
    if (!organisationId) return;
    void loadBalances(organisationId, appliedSearch, offset, 'refresh');
  };

  const toggleCustomerExpanded = (customerId: string) => {
    setExpandedCustomerIds((prev) => ({
      ...prev,
      [customerId]: !prev[customerId],
    }));
  };

  const handleOpenCollectPayment = (
    customer: OutstandingCustomerRecord,
    sale: OutstandingCustomerSaleRecord
  ) => {
    setFeedback(null);
    if (effectiveActiveMethods.length === 0 && organisationId) {
      void ensureActivePaymentMethods(organisationId);
    }
    setPayModalSale({
      id: sale.id,
      saleNumber: sale.saleNumber,
      status: sale.status,
      outstandingAmount: sale.outstandingBalance,
      currency: sale.currencyCode || currencyCode,
      customerName: customer.name,
    });
  };

  const handlePaymentSuccess = async ({
    saleNumber,
    amount,
    currency,
  }: {
    saleId: string;
    saleNumber: string;
    amount: number;
    currency: string;
    paymentId: string | null;
  }) => {
    setPayModalSale(null);
    setFeedback({
      type: 'success',
      message: `Follow-up payment of ${formatMoneyAmount(amount, currency)} recorded for ${saleNumber}.`,
    });
    await Promise.all([
      loadBalances(organisationId, appliedSearch, offset, 'refresh'),
      onReloadSales(),
    ]);
  };

  const { summary, customers, pagination } = data;
  const currentPage = Math.floor(pagination.offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(pagination.totalCustomers / PAGE_SIZE));
  const isInitialLoading = loading && !refreshing;

  return (
    <div className="space-y-6">
      {feedback && (
        <section
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 flex items-center justify-between gap-3 text-xs ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded text-current/60 hover:text-current"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </section>
      )}

      {/* Summary KPIs */}
      <section aria-labelledby="outstanding-summary-heading" className="space-y-3">
        <h2 id="outstanding-summary-heading" className="sr-only">
          Outstanding Balances Summary
        </h2>
        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Customers with Balances
              </span>
              <Users className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {summary.customersWithBalances}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Registered customers with unpaid credit
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Open Credit Sales</span>
              <Receipt className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {summary.openSalesCount}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Completed unpaid or partial sales
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Total Outstanding</span>
              <Wallet className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="h-7 w-28 bg-slate-100 rounded animate-pulse" />
            ) : summary.currencyTotals.length === 0 ? (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(0, currencyCode)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  No open customer balances
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {summary.currencyTotals.map((ct) => (
                  <div
                    key={ct.currencyCode}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-[11px] font-mono text-slate-500">
                      {ct.currencyCode}
                    </span>
                    <span className="font-mono text-xl font-semibold text-amber-700 tabular-nums">
                      {formatMoneyAmount(ct.totalOutstanding, ct.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Customer Balances List */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Customer Outstanding Balances
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Registered customers with unpaid or partially paid sales, sorted by oldest open sale first.
            </p>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={!organisationId || loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 self-start sm:self-auto whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

        {/* Search Bar */}
        <form
          onSubmit={handleSearchSubmit}
          className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <div className="relative flex-1">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search customer by name, phone, or email..."
              aria-label="Search customers with outstanding balances"
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="text-[11px] font-mono text-slate-500 whitespace-nowrap self-end sm:self-center">
            {pagination.totalCustomers}{' '}
            {pagination.totalCustomers === 1 ? 'customer' : 'customers'}
          </div>
        </form>

        {/* States & Rows */}
        {isInitialLoading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-16 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <div className="p-6 bg-red-50/60 text-xs text-red-900 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold">Unable to load outstanding balances</div>
                <div className="break-words text-red-800">{loadError}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleManualRefresh}
              className="px-3 py-1.5 rounded-md border border-red-300 bg-white text-xs font-medium text-red-800 hover:bg-red-50 whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-10 text-center space-y-1.5">
            <Wallet className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">
              {appliedSearch
                ? 'No matching customers with outstanding balances'
                : 'No outstanding customer balances'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {appliedSearch
                ? 'Try another customer name, phone number, or email address, or clear your search.'
                : 'All registered customer credit sales are currently settled.'}
            </p>
            {appliedSearch && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-200">
              {customers.map((customer) => {
                const isExpanded = Boolean(expandedCustomerIds[customer.customerId]);
                return (
                  <div key={customer.customerId} className="bg-white">
                    <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 hover:bg-slate-50/50 transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleCustomerExpanded(customer.customerId)}
                        aria-expanded={isExpanded}
                        className="flex items-start gap-3 text-left min-w-0 flex-1"
                      >
                        <span className="mt-0.5 text-slate-400 shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          )}
                        </span>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900 break-words">
                              {customer.name}
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                                customer.isActive
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {customer.isActive ? 'Active' : 'Archived'}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              {customer.openSalesCount}{' '}
                              {customer.openSalesCount === 1 ? 'open sale' : 'open sales'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                            {customer.phone && (
                              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                                <Phone className="h-3 w-3 text-slate-400" aria-hidden="true" />
                                <span>{customer.phone}</span>
                              </span>
                            )}
                            {customer.email && (
                              <span className="inline-flex items-center gap-1 break-all">
                                <Mail className="h-3 w-3 text-slate-400" aria-hidden="true" />
                                <span>{customer.email}</span>
                              </span>
                            )}
                            <span>
                              Oldest unpaid:{' '}
                              <span className="font-mono text-slate-700">
                                {formatSalesShortDate(customer.oldestUnpaidAt, timeZone)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </button>

                      <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pl-7 lg:pl-0 shrink-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {customer.balancesByCurrency.map((bal) => (
                            <div
                              key={bal.currencyCode}
                              className="px-2.5 py-1 rounded-md bg-amber-50/70 border border-amber-200 text-right"
                            >
                              {customer.balancesByCurrency.length > 1 && (
                                <span className="text-[10px] font-mono text-amber-700 mr-1.5">
                                  {bal.currencyCode}
                                </span>
                              )}
                              <span className="font-mono text-xs font-semibold text-amber-800 tabular-nums">
                                {formatMoneyAmount(bal.outstandingBalance, bal.currencyCode)}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setViewingCustomer(toCustomerRecord(customer, organisationId))
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <History className="h-3 w-3" aria-hidden="true" />
                            <span>Purchase History</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCustomerExpanded(customer.customerId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <span>{isExpanded ? 'Hide Sales' : 'View Sales'}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Open Sales Table */}
                    {isExpanded && (
                      <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-3.5">
                        <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                                <th className="py-2 px-3 whitespace-nowrap">Sale #</th>
                                <th className="py-2 px-3 whitespace-nowrap">Sale Date</th>
                                <th className="py-2 px-3 text-right whitespace-nowrap">
                                  Original Total
                                </th>
                                <th className="py-2 px-3 text-right whitespace-nowrap">Paid</th>
                                <th className="py-2 px-3 text-right whitespace-nowrap">
                                  Returned
                                </th>
                                <th className="py-2 px-3 text-right whitespace-nowrap">
                                  Outstanding
                                </th>
                                <th className="py-2 px-3 whitespace-nowrap">Payment Status</th>
                                <th className="py-2 px-3 text-right whitespace-nowrap">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs">
                              {customer.sales.map((sale) => (
                                <tr key={sale.id} className="hover:bg-slate-50/60">
                                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                                    {sale.saleNumber}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                    {formatSalesDateTime(sale.soldAt, timeZone)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                                    {formatMoneyAmount(sale.totalAmount, sale.currencyCode)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                                    {formatMoneyAmount(sale.paidAmount, sale.currencyCode)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                    {formatMoneyAmount(sale.returnedAmount, sale.currencyCode)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-700 whitespace-nowrap">
                                    {formatMoneyAmount(sale.outstandingBalance, sale.currencyCode)}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${
                                        sale.paymentStatus === 'partial'
                                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                                          : 'bg-red-50 text-red-800 border-red-200'
                                      }`}
                                    >
                                      {formatPaymentStatusLabel(sale.paymentStatus)}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenCollectPayment(customer, sale)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-700 text-white text-[11px] font-medium hover:bg-blue-800 whitespace-nowrap"
                                    >
                                      <CreditCard className="h-3 w-3" aria-hidden="true" />
                                      <span>Collect Payment</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {(pagination.offset > 0 || pagination.hasMore) && (
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Page <span className="font-mono font-medium">{currentPage}</span> of{' '}
                  <span className="font-mono font-medium">{totalPages}</span> · Showing{' '}
                  <span className="font-mono font-medium">{pagination.offset + 1}</span>–
                  <span className="font-mono font-medium">
                    {pagination.offset + customers.length}
                  </span>{' '}
                  of <span className="font-mono font-medium">{pagination.totalCustomers}</span>
                </span>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePageChange(Math.max(0, pagination.offset - PAGE_SIZE))}
                    disabled={pagination.offset === 0 || loading}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Prev</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePageChange(pagination.offset + PAGE_SIZE)}
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

      {/* Customer Details & Purchase History Modal */}
      <CustomerDetailModal
        customer={viewingCustomer}
        organisationId={organisationId}
        currencyCode={currencyCode}
        timeZone={timeZone}
        canManage={false}
        initialTab="history"
        onClose={() => setViewingCustomer(null)}
      />

      {/* Shared Follow-Up Payment Modal */}
      <FollowUpPaymentModal
        organisationId={organisationId}
        currencyCode={currencyCode}
        sale={payModalSale}
        activeMethods={effectiveActiveMethods}
        methodsLoading={methodsLoading && effectiveActiveMethods.length === 0}
        methodsError={effectiveActiveMethods.length === 0 ? methodsError : null}
        onClose={() => setPayModalSale(null)}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}

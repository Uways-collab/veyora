import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Edit3,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Receipt,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Undo2,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { formatMoneyAmount } from '../inventory/inventoryService';
import {
  formatPaymentMethodCodeLabel,
  formatPaymentStatusLabel,
  formatSaleStatusLabel,
} from '../sales/salesFormatters';
import { fetchCustomerPurchaseHistory, formatCustomerDateTime } from './customersService';
import type {
  CustomerPurchaseHistoryResult,
  CustomerPurchaseSaleRecord,
  CustomerRecord,
} from './customersTypes';

type DetailModalTab = 'overview' | 'history';

const INITIAL_HISTORY_LIMIT = 50;
const HISTORY_LIMIT_STEP = 50;
const MAX_HISTORY_LIMIT = 100;

interface CustomerDetailModalProps {
  customer: CustomerRecord | null;
  organisationId: string | null;
  currencyCode?: string | null;
  timeZone?: string | null;
  canManage: boolean;
  initialTab?: DetailModalTab;
  onClose: () => void;
  onEdit?: (customer: CustomerRecord) => void;
  onArchive?: (customer: CustomerRecord) => void;
  onRestore?: (customer: CustomerRecord) => void;
}

function mergePurchaseSalesDeduplicated(
  existingSales: CustomerPurchaseSaleRecord[],
  incomingSales: CustomerPurchaseSaleRecord[]
): CustomerPurchaseSaleRecord[] {
  const byId = new Map<string, CustomerPurchaseSaleRecord>();
  const orderedIds: string[] = [];

  for (const sale of incomingSales) {
    if (!byId.has(sale.id)) {
      orderedIds.push(sale.id);
    }
    byId.set(sale.id, sale);
  }

  for (const sale of existingSales) {
    if (!byId.has(sale.id)) {
      orderedIds.push(sale.id);
      byId.set(sale.id, sale);
    }
  }

  return orderedIds.map((id) => byId.get(id)!);
}

function getSaleStatusBadgeClasses(status: string): string {
  if (status === 'cancelled') {
    return 'bg-slate-100 text-slate-700 border-slate-200';
  }
  return 'bg-emerald-50 text-emerald-800 border-emerald-200';
}

function getPaymentBadge(sale: CustomerPurchaseSaleRecord): {
  label: string;
  classes: string;
} {
  if (sale.status === 'cancelled') {
    return {
      label: 'Zero Credit',
      classes: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  }

  if (sale.outstandingBalance <= 0) {
    if (sale.paymentStatus === 'paid') {
      return {
        label: formatPaymentStatusLabel(sale.paymentStatus),
        classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    }
    return {
      label: 'Settled',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    };
  }

  if (sale.paymentStatus === 'partial') {
    return {
      label: formatPaymentStatusLabel(sale.paymentStatus),
      classes: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }

  return {
    label: formatPaymentStatusLabel(sale.paymentStatus),
    classes: 'bg-red-50 text-red-800 border-red-200',
  };
}

function formatSourceLabel(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function CustomerDetailModal({
  customer,
  organisationId,
  currencyCode,
  timeZone,
  canManage,
  initialTab = 'overview',
  onClose,
  onEdit,
  onArchive,
  onRestore,
}: CustomerDetailModalProps) {
  const defaultCurrency = (currencyCode ?? '').trim() || 'USD';
  const [activeTab, setActiveTab] = useState<DetailModalTab>(initialTab);
  const [historyData, setHistoryData] = useState<CustomerPurchaseHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [currentLimit, setCurrentLimit] = useState(INITIAL_HISTORY_LIMIT);
  const [expandedSaleIds, setExpandedSaleIds] = useState<Record<string, boolean>>({});

  const isMountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const activeContextKeyRef = useRef('');

  const customerId = customer?.id ?? null;
  const contextKey = customerId && organisationId ? `${organisationId}:${customerId}` : '';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeContextKeyRef.current = contextKey;
    requestSeqRef.current += 1;
    setActiveTab(initialTab);
    setHistoryData(null);
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    setHistoryError(null);
    setCurrentLimit(INITIAL_HISTORY_LIMIT);
    setExpandedSaleIds({});
  }, [contextKey, initialTab]);

  useEffect(() => {
    if (!customer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [customer, onClose]);

  const loadPurchaseHistory = useCallback(
    async (requestedLimit: number, mode: 'initial' | 'loadMore') => {
      if (!organisationId || !customerId) return;
      const expectedKey = `${organisationId}:${customerId}`;
      const seq = ++requestSeqRef.current;

      if (mode === 'loadMore') {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }
      setHistoryError(null);

      const res = await fetchCustomerPurchaseHistory(organisationId, customerId, requestedLimit);

      if (!isMountedRef.current) return;
      if (activeContextKeyRef.current !== expectedKey) return;
      if (seq !== requestSeqRef.current) return;

      setHistoryLoading(false);
      setHistoryLoadingMore(false);

      if (res.error) {
        setHistoryError(res.error);
        return;
      }

      setCurrentLimit(res.limit);
      setHistoryData((prev) => {
        if (mode === 'loadMore' && prev) {
          return {
            ...res,
            sales: mergePurchaseSalesDeduplicated(prev.sales, res.sales),
          };
        }
        return res;
      });
    },
    [customerId, organisationId]
  );

  useEffect(() => {
    if (!customer || !organisationId) return;
    if (activeTab !== 'history') return;
    if (historyData !== null || historyLoading || historyError) return;
    void loadPurchaseHistory(INITIAL_HISTORY_LIMIT, 'initial');
  }, [
    activeTab,
    customer,
    historyData,
    historyError,
    historyLoading,
    loadPurchaseHistory,
    organisationId,
  ]);

  if (!customer) return null;

  const toggleSaleExpanded = (saleId: string) => {
    setExpandedSaleIds((prev) => ({
      ...prev,
      [saleId]: !prev[saleId],
    }));
  };

  const handleLoadMore = () => {
    if (historyLoading || historyLoadingMore) return;
    const nextLimit = Math.min(MAX_HISTORY_LIMIT, currentLimit + HISTORY_LIMIT_STEP);
    void loadPurchaseHistory(nextLimit, 'loadMore');
  };

  const handleRetry = () => {
    if (historyLoading || historyLoadingMore) return;
    void loadPurchaseHistory(currentLimit, historyData ? 'loadMore' : 'initial');
  };

  const summary = historyData?.summary;
  const sales = historyData?.sales ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-detail-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl overflow-hidden shadow-xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <span>Customer Record</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  customer.isActive ? 'text-emerald-700 font-medium' : 'text-amber-800 font-medium'
                }
              >
                {customer.isActive ? 'Active' : 'Archived'}
              </span>
            </div>
            <h2
              id="customer-detail-modal-title"
              className="text-base font-semibold text-slate-900 mt-0.5 break-words"
            >
              {customer.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div
          className="px-5 border-b border-slate-200 bg-slate-50/70 flex items-center gap-1 shrink-0"
          role="tablist"
          aria-label="Customer details sections"
        >
          <button
            type="button"
            role="tab"
            id="customer-tab-overview"
            aria-selected={activeTab === 'overview'}
            aria-controls="customer-panel-overview"
            onClick={() => setActiveTab('overview')}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Overview</span>
          </button>
          <button
            type="button"
            role="tab"
            id="customer-tab-history"
            aria-selected={activeTab === 'history'}
            aria-controls="customer-panel-history"
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Purchase History</span>
            {summary && (
              <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-mono tabular-nums rounded bg-slate-100 text-slate-700 border border-slate-200">
                {summary.totalPurchases}
              </span>
            )}
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
          {activeTab === 'overview' && (
            <div
              id="customer-panel-overview"
              role="tabpanel"
              aria-labelledby="customer-tab-overview"
              className="space-y-4"
            >
              {!customer.isActive && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-600">
                  This customer is archived. Archived records are read-only until restored to Active
                  Customers.
                </div>
              )}

              <dl className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                <div className="px-4 py-3 flex items-start justify-between gap-4">
                  <dt className="text-slate-500 flex items-center gap-1.5 shrink-0">
                    <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>Phone</span>
                  </dt>
                  <dd className="text-slate-900 font-mono tabular-nums text-right break-all">
                    {customer.phone ?? '—'}
                  </dd>
                </div>

                <div className="px-4 py-3 flex items-start justify-between gap-4">
                  <dt className="text-slate-500 flex items-center gap-1.5 shrink-0">
                    <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>Email</span>
                  </dt>
                  <dd className="text-slate-900 text-right break-all">{customer.email ?? '—'}</dd>
                </div>

                <div className="px-4 py-3 space-y-1">
                  <dt className="text-slate-500 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>Address</span>
                  </dt>
                  <dd className="text-slate-900 whitespace-pre-line break-words pl-5">
                    {customer.address ?? 'No address recorded.'}
                  </dd>
                </div>

                <div className="px-4 py-3 space-y-1">
                  <dt className="text-slate-500 flex items-center gap-1.5">
                    <StickyNote className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>Notes</span>
                  </dt>
                  <dd className="text-slate-900 whitespace-pre-line break-words pl-5">
                    {customer.notes ?? 'No notes recorded.'}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Created:{' '}
                  <span className="font-mono tabular-nums text-slate-700">
                    {formatCustomerDateTime(customer.createdAt, timeZone)}
                  </span>
                </span>
                <span>
                  Updated:{' '}
                  <span className="font-mono tabular-nums text-slate-700">
                    {formatCustomerDateTime(customer.updatedAt, timeZone)}
                  </span>
                </span>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div
              id="customer-panel-history"
              role="tabpanel"
              aria-labelledby="customer-tab-history"
              className="space-y-4"
            >
              {!organisationId ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-800">
                  No active workspace is selected. Select an organization to view purchase history.
                </div>
              ) : historyLoading && !historyData ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
                  <span>Loading customer purchase history…</span>
                </div>
              ) : historyError && !historyData ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="break-words">{historyError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-300 bg-white text-xs font-medium text-red-800 hover:bg-red-100 whitespace-nowrap"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                </div>
              ) : (
                <>
                  {historyError && historyData && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="break-words">{historyError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleRetry}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-red-300 bg-white text-[11px] font-medium text-red-800 hover:bg-red-100 whitespace-nowrap"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {/* Summary Metrics */}
                  {summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <div className="text-[11px] text-slate-500">Total Purchases</div>
                        <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                          {summary.totalPurchases}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <div className="text-[11px] text-slate-500">Total Purchase Value</div>
                        <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                          {formatMoneyAmount(summary.totalPurchaseValue, defaultCurrency)}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <div className="text-[11px] text-slate-500">Total Amount Paid</div>
                        <div className="text-sm font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
                          {formatMoneyAmount(summary.totalAmountPaid, defaultCurrency)}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <div className="text-[11px] text-slate-500">Outstanding Credit</div>
                        <div
                          className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${
                            summary.outstandingCreditBalance > 0
                              ? 'text-amber-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {formatMoneyAmount(summary.outstandingCreditBalance, defaultCurrency)}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <div className="text-[11px] text-slate-500">Total Returned</div>
                        <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                          {formatMoneyAmount(summary.totalReturnedValue, defaultCurrency)}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                        <div className="text-[11px] text-slate-500">Total Refunded</div>
                        <div className="text-sm font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                          {formatMoneyAmount(summary.totalRefundedValue, defaultCurrency)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sales History List */}
                  {sales.length === 0 ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50/50 px-4 py-8 text-center text-slate-500">
                      <Receipt className="h-6 w-6 mx-auto text-slate-400 mb-2" aria-hidden="true" />
                      <div className="font-medium text-slate-700">No sales recorded yet</div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Sales linked to this customer at POS checkout will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Showing {sales.length} newest sale{sales.length === 1 ? '' : 's'}</span>
                        <button
                          type="button"
                          onClick={() => void loadPurchaseHistory(currentLimit, 'initial')}
                          disabled={historyLoading || historyLoadingMore}
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${historyLoading ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span>Refresh</span>
                        </button>
                      </div>

                      {sales.map((sale) => {
                        const isExpanded = Boolean(expandedSaleIds[sale.id]);
                        const saleCurrency = sale.currencyCode || defaultCurrency;
                        const paymentBadge = getPaymentBadge(sale);
                        const isCancelled = sale.status === 'cancelled';

                        return (
                          <div
                            key={sale.id}
                            className={`rounded-md border overflow-hidden ${
                              isCancelled
                                ? 'border-slate-200 bg-slate-50/60'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSaleExpanded(sale.id)}
                              aria-expanded={isExpanded}
                              className="w-full px-3.5 py-3 text-left hover:bg-slate-50/80 transition-colors"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                  {isExpanded ? (
                                    <ChevronDown
                                      className="h-3.5 w-3.5 text-slate-400 shrink-0"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <ChevronRight
                                      className="h-3.5 w-3.5 text-slate-400 shrink-0"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                    {sale.saleNumber}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${getSaleStatusBadgeClasses(
                                      sale.status
                                    )}`}
                                  >
                                    {formatSaleStatusLabel(sale.status)}
                                  </span>
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${paymentBadge.classes}`}
                                  >
                                    {paymentBadge.label}
                                  </span>
                                </div>
                                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                                  {formatCustomerDateTime(sale.soldAt, timeZone)}
                                </span>
                              </div>

                              <div className="mt-2.5 pl-5 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                                <div>
                                  <div className="text-slate-500">Total</div>
                                  <div className="font-mono tabular-nums font-medium text-slate-900">
                                    {formatMoneyAmount(sale.totalAmount, saleCurrency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Paid</div>
                                  <div className="font-mono tabular-nums font-medium text-emerald-700">
                                    {formatMoneyAmount(sale.paidAmount, saleCurrency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Outstanding</div>
                                  <div
                                    className={`font-mono tabular-nums font-medium ${
                                      isCancelled
                                        ? 'text-slate-500'
                                        : sale.outstandingBalance > 0
                                          ? 'text-amber-700'
                                          : 'text-slate-700'
                                    }`}
                                  >
                                    {isCancelled
                                      ? `${formatMoneyAmount(0, saleCurrency)} (Cancelled)`
                                      : formatMoneyAmount(sale.outstandingBalance, saleCurrency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Returned</div>
                                  <div className="font-mono tabular-nums text-slate-700">
                                    {formatMoneyAmount(sale.returnedAmount, saleCurrency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Refunded</div>
                                  <div className="font-mono tabular-nums text-slate-700">
                                    {formatMoneyAmount(sale.refundedAmount, saleCurrency)}
                                  </div>
                                </div>
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 space-y-3">
                                {isCancelled && (
                                  <div className="rounded border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                                    This sale was cancelled and carries zero outstanding credit balance.
                                  </div>
                                )}

                                {/* Payments */}
                                <div>
                                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 mb-1.5">
                                    <CreditCard
                                      className="h-3.5 w-3.5 text-slate-400"
                                      aria-hidden="true"
                                    />
                                    <span>Payments ({sale.payments.length})</span>
                                  </div>
                                  {sale.payments.length === 0 ? (
                                    <div className="text-[11px] text-slate-500 pl-5">
                                      No payments recorded for this sale.
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 pl-5">
                                      {sale.payments.map((payment) => {
                                        const codeLabel = formatPaymentMethodCodeLabel(
                                          payment.paymentMethodCode
                                        );
                                        const sourceLabel = formatSourceLabel(payment.paymentSource);
                                        return (
                                          <div
                                            key={payment.id}
                                            className="rounded border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                                          >
                                            <div className="space-y-0.5 min-w-0">
                                              <div className="font-medium text-slate-800 flex flex-wrap items-center gap-1.5">
                                                <span>{payment.paymentMethodName}</span>
                                                {payment.paymentMethodName.toLowerCase() !==
                                                  codeLabel.toLowerCase() && (
                                                  <span className="text-slate-400">({codeLabel})</span>
                                                )}
                                                {sourceLabel && (
                                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                                                    {sourceLabel}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="text-slate-500 flex flex-wrap items-center gap-2">
                                                <span className="font-mono tabular-nums">
                                                  {formatCustomerDateTime(payment.paidAt, timeZone)}
                                                </span>
                                                {payment.reference && (
                                                  <span className="font-mono break-all">
                                                    Ref: {payment.reference}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="font-mono tabular-nums font-semibold text-emerald-700 shrink-0">
                                              {formatMoneyAmount(payment.amount, saleCurrency)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                {/* Returns */}
                                <div>
                                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 mb-1.5">
                                    <Undo2
                                      className="h-3.5 w-3.5 text-slate-400"
                                      aria-hidden="true"
                                    />
                                    <span>Returns ({sale.returns.length})</span>
                                  </div>
                                  {sale.returns.length === 0 ? (
                                    <div className="text-[11px] text-slate-500 pl-5">
                                      No returns recorded for this sale.
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 pl-5">
                                      {sale.returns.map((ret) => (
                                        <div
                                          key={ret.id}
                                          className="rounded border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-start justify-between gap-2 text-[11px]"
                                        >
                                          <div className="space-y-0.5 min-w-0">
                                            <div className="font-mono font-medium text-slate-800">
                                              {ret.returnNumber}
                                            </div>
                                            {ret.reason && (
                                              <div className="text-slate-600 break-words">
                                                Reason: {ret.reason}
                                              </div>
                                            )}
                                            <div className="text-slate-500 flex flex-wrap items-center gap-3">
                                              <span className="font-mono tabular-nums">
                                                {formatCustomerDateTime(ret.returnedAt, timeZone)}
                                              </span>
                                              {ret.debtReducedAmount > 0 && (
                                                <span className="font-mono tabular-nums">
                                                  Credit reduced:{' '}
                                                  {formatMoneyAmount(
                                                    ret.debtReducedAmount,
                                                    saleCurrency
                                                  )}
                                                </span>
                                              )}
                                              {ret.refundedAmount > 0 && (
                                                <span className="font-mono tabular-nums">
                                                  Refunded:{' '}
                                                  {formatMoneyAmount(
                                                    ret.refundedAmount,
                                                    saleCurrency
                                                  )}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="font-mono tabular-nums font-semibold text-slate-900 shrink-0">
                                            {formatMoneyAmount(ret.totalAmount, saleCurrency)}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Refunds */}
                                <div>
                                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 mb-1.5">
                                    <Wallet
                                      className="h-3.5 w-3.5 text-slate-400"
                                      aria-hidden="true"
                                    />
                                    <span>Refunds ({sale.refunds.length})</span>
                                  </div>
                                  {sale.refunds.length === 0 ? (
                                    <div className="text-[11px] text-slate-500 pl-5">
                                      No refunds issued for this sale.
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 pl-5">
                                      {sale.refunds.map((refund) => {
                                        const codeLabel = formatPaymentMethodCodeLabel(
                                          refund.paymentMethodCode
                                        );
                                        const sourceLabel = formatSourceLabel(refund.refundSource);
                                        return (
                                          <div
                                            key={refund.id}
                                            className="rounded border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-start justify-between gap-2 text-[11px]"
                                          >
                                            <div className="space-y-0.5 min-w-0">
                                              <div className="font-medium text-slate-800 flex flex-wrap items-center gap-1.5">
                                                <span>{refund.paymentMethodName}</span>
                                                {refund.paymentMethodName.toLowerCase() !==
                                                  codeLabel.toLowerCase() && (
                                                  <span className="text-slate-400">({codeLabel})</span>
                                                )}
                                                {sourceLabel && (
                                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                                                    {sourceLabel}
                                                  </span>
                                                )}
                                              </div>
                                              {refund.reason && (
                                                <div className="text-slate-600 break-words">
                                                  Reason: {refund.reason}
                                                </div>
                                              )}
                                              <div className="text-slate-500 flex flex-wrap items-center gap-2">
                                                <span className="font-mono tabular-nums">
                                                  {formatCustomerDateTime(
                                                    refund.refundedAt,
                                                    timeZone
                                                  )}
                                                </span>
                                                {refund.reference && (
                                                  <span className="font-mono break-all">
                                                    Ref: {refund.reference}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="font-mono tabular-nums font-semibold text-slate-900 shrink-0">
                                              {formatMoneyAmount(refund.amount, saleCurrency)}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {historyData?.hasMore && (
                        <div className="pt-1 flex justify-center">
                          <button
                            type="button"
                            onClick={handleLoadMore}
                            disabled={historyLoadingMore || historyLoading}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {historyLoadingMore && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            )}
                            <span>{historyLoadingMore ? 'Loading more…' : 'Load More'}</span>
                          </button>
                        </div>
                      )}

                      {historyData?.reachedMaxLimit && (
                        <p className="text-center text-[11px] text-slate-500 pt-1">
                          Showing the latest {MAX_HISTORY_LIMIT} sales. Summary totals include all
                          linked purchases.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {canManage ? (
            customer.isActive ? (
              <div className="flex items-center gap-2">
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onEdit(customer);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                )}
                {onArchive && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onArchive(customer);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-amber-800 hover:bg-amber-50 hover:border-amber-300 whitespace-nowrap"
                  >
                    <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Archive</span>
                  </button>
                )}
              </div>
            ) : onRestore ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRestore(customer);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Restore Customer</span>
              </button>
            ) : (
              <div />
            )
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

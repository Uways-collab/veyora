import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import type { OrganisationRole } from '../../core/types/domain';
import {
  formatMoneyAmount,
  formatUnitOfMeasureLabel,
} from '../inventory/inventoryService';
import {
  formatPaymentStatusLabel,
  formatSaleStatusLabel,
  formatSalesDateTime,
  formatSalesQuantity,
  formatSalesShortDate,
  generateIdempotencyKey,
  getZonedDateKey,
  roundMoney,
} from './salesFormatters';
import { cancelSale, recordFollowUpPayment } from './salesService';
import {
  canManageReturnsAndCancellations,
  isPaymentReferenceRequired,
  type PaymentMethodRecord,
  type SalePaymentStatusValue,
  type SaleRecord,
  type SaleStatusValue,
  type SalesModuleData,
} from './salesTypes';

interface SalesHistoryPanelProps {
  organisationId: string;
  currencyCode: string;
  timeZone?: string | null;
  activeRole: OrganisationRole | null;
  data: SalesModuleData;
  loading: boolean;
  onReload: () => Promise<void>;
  onOpenReceipt: (sale: SaleRecord) => void;
}

const PAGE_SIZE = 20;

function pickDefaultPaymentMethod(methods: PaymentMethodRecord[]): PaymentMethodRecord | null {
  return methods.find((m) => m.methodCode === 'cash') ?? methods[0] ?? null;
}

export function SalesHistoryPanel({
  organisationId,
  currencyCode,
  timeZone,
  activeRole,
  data,
  loading,
  onReload,
  onOpenReceipt,
}: SalesHistoryPanelProps) {
  const canCancel = canManageReturnsAndCancellations(activeRole);
  const activeMethods = useMemo(
    () => data.paymentMethods.filter((m) => m.isActive),
    [data.paymentMethods]
  );

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SaleStatusValue>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    'all' | SalePaymentStatusValue
  >('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  // Selected Sale Details Modal
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  // Follow-Up Payment Modal
  const [payModalSaleId, setPayModalSaleId] = useState<string | null>(null);
  const [payMethodId, setPayMethodId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payConfirmStep, setPayConfirmStep] = useState(false);

  // Cancel Sale Modal
  const [cancelModalSaleId, setCancelModalSaleId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [modalError, setModalError] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const payIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const cancelIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  const filteredSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.sales.filter((sale) => {
      if (statusFilter !== 'all' && sale.status !== statusFilter) return false;
      if (paymentStatusFilter !== 'all' && sale.paymentStatus !== paymentStatusFilter) {
        return false;
      }
      if (locationFilter !== 'all' && sale.locationId !== locationFilter) return false;
      if (dateFrom || dateTo) {
        const dayKey = getZonedDateKey(sale.soldAt, timeZone);
        if (!dayKey) return false;
        if (dateFrom && dayKey < dateFrom) return false;
        if (dateTo && dayKey > dateTo) return false;
      }
      if (!q) return true;
      return (
        sale.saleNumber.toLowerCase().includes(q) ||
        (sale.customerName ?? '').toLowerCase().includes(q) ||
        (sale.customerPhone ?? '').toLowerCase().includes(q) ||
        (sale.cashierName ?? '').toLowerCase().includes(q) ||
        sale.locationName.toLowerCase().includes(q) ||
        sale.items.some(
          (i) =>
            i.productName.toLowerCase().includes(q) ||
            i.variantName.toLowerCase().includes(q) ||
            i.sku.toLowerCase().includes(q)
        )
      );
    });
  }, [
    data.sales,
    searchQuery,
    statusFilter,
    paymentStatusFilter,
    locationFilter,
    dateFrom,
    dateTo,
    timeZone,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, paymentStatusFilter, locationFilter, dateFrom, dateTo]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedSales = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSales.slice(start, start + PAGE_SIZE);
  }, [filteredSales, page]);

  const selectedSale = useMemo(
    () => (selectedSaleId ? (data.sales.find((s) => s.id === selectedSaleId) ?? null) : null),
    [data.sales, selectedSaleId]
  );
  const payModalSale = useMemo(
    () => (payModalSaleId ? (data.sales.find((s) => s.id === payModalSaleId) ?? null) : null),
    [data.sales, payModalSaleId]
  );
  const cancelModalSale = useMemo(
    () => (cancelModalSaleId ? (data.sales.find((s) => s.id === cancelModalSaleId) ?? null) : null),
    [data.sales, cancelModalSaleId]
  );

  const selectedPayMethod = useMemo(
    () => activeMethods.find((m) => m.id === payMethodId) ?? null,
    [activeMethods, payMethodId]
  );

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    statusFilter !== 'all' ||
    paymentStatusFilter !== 'all' ||
    locationFilter !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const openFollowUpModal = (sale: SaleRecord) => {
    setModalError(null);
    setFeedback(null);
    const def = pickDefaultPaymentMethod(activeMethods);
    setPayMethodId(def?.id ?? '');
    setPayAmount(sale.outstandingAmount > 0 ? String(sale.outstandingAmount) : '');
    setPayReference('');
    setPayConfirmStep(false);
    payIdempotencyRef.current = null;
    setPayModalSaleId(sale.id);
  };

  const openCancelModal = (sale: SaleRecord) => {
    if (!canCancel) return;
    setModalError(null);
    setFeedback(null);
    setCancelReason('');
    cancelIdempotencyRef.current = null;
    setCancelModalSaleId(sale.id);
  };

  const validateFollowUpPayment = (): string | null => {
    if (!payModalSale) return 'Sale record not found.';
    if (payModalSale.status !== 'completed') {
      return 'Follow-up payments can only be recorded for completed sales.';
    }
    if (payModalSale.outstandingAmount <= 0) {
      return 'This sale has no outstanding balance.';
    }
    if (!payMethodId || !selectedPayMethod) {
      return 'Select an active payment method.';
    }
    const amt = roundMoney(Number(payAmount));
    if (!Number.isFinite(amt) || amt <= 0) {
      return 'Payment amount must be greater than zero.';
    }
    if (amt > payModalSale.outstandingAmount) {
      return `Payment amount cannot exceed outstanding balance (${formatMoneyAmount(
        payModalSale.outstandingAmount,
        payModalSale.currency || currencyCode
      )}).`;
    }
    if (isPaymentReferenceRequired(selectedPayMethod) && !payReference.trim()) {
      return `A payment reference is required for "${selectedPayMethod.name}".`;
    }
    return null;
  };

  const handleReviewFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const err = validateFollowUpPayment();
    if (err) {
      setModalError(err);
      return;
    }
    setPayConfirmStep(true);
  };

  const handleConfirmFollowUp = async () => {
    if (!payModalSale || submitLockRef.current || submitting) return;
    const err = validateFollowUpPayment();
    if (err) {
      setModalError(err);
      setPayConfirmStep(false);
      return;
    }

    const amt = roundMoney(Number(payAmount));
    const ref = payReference.trim() || null;
    const signature = JSON.stringify({
      organisationId,
      saleId: payModalSale.id,
      payMethodId,
      amt,
      ref,
    });

    if (!payIdempotencyRef.current || payIdempotencyRef.current.signature !== signature) {
      payIdempotencyRef.current = {
        signature,
        key: generateIdempotencyKey(),
      };
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setModalError(null);

    try {
      const result = await recordFollowUpPayment(organisationId, {
        saleId: payModalSale.id,
        paymentMethodId: payMethodId,
        amount: amt,
        reference: ref,
        idempotencyKey: payIdempotencyRef.current.key,
      });

      if (result.error) {
        setModalError(result.error);
        setPayConfirmStep(false);
        return;
      }

      const saleNum = payModalSale.saleNumber;
      const cur = payModalSale.currency || currencyCode;
      payIdempotencyRef.current = null;
      setPayModalSaleId(null);
      setPayConfirmStep(false);
      setFeedback({
        type: 'success',
        message: `Follow-up payment of ${formatMoneyAmount(amt, cur)} recorded for ${saleNum}.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmCancelSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelModalSale || !canCancel || submitLockRef.current || submitting) return;

    const reason = cancelReason.trim();
    if (!reason) {
      setModalError('A cancellation reason is required.');
      return;
    }
    if (cancelModalSale.status !== 'completed') {
      setModalError('Only completed sales can be cancelled.');
      return;
    }
    if (cancelModalSale.returnedAmount > 0 || cancelModalSale.returns.length > 0) {
      setModalError('Sales with existing returns cannot be cancelled.');
      return;
    }

    const signature = JSON.stringify({
      organisationId,
      saleId: cancelModalSale.id,
      reason,
    });

    if (
      !cancelIdempotencyRef.current ||
      cancelIdempotencyRef.current.signature !== signature
    ) {
      cancelIdempotencyRef.current = {
        signature,
        key: generateIdempotencyKey(),
      };
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setModalError(null);

    try {
      const result = await cancelSale(organisationId, {
        saleId: cancelModalSale.id,
        reason,
        idempotencyKey: cancelIdempotencyRef.current.key,
      });

      if (result.error) {
        setModalError(result.error);
        return;
      }

      const saleNum = cancelModalSale.saleNumber;
      cancelIdempotencyRef.current = null;
      setCancelModalSaleId(null);
      setFeedback({
        type: 'success',
        message: `Sale ${saleNum} has been cancelled and stock reversed.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <section
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 flex items-start gap-2.5 text-xs ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          {feedback.type === 'error' ? (
            <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span className="font-medium">{feedback.message}</span>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Sales History</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Search receipts, inspect sale details, record follow-up credit payments, and print customer receipts.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500">
            {filteredSales.length} {filteredSales.length === 1 ? 'sale' : 'sales'}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="lg:col-span-2 relative">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sale #, customer, cashier, SKU..."
              aria-label="Search sales history"
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | SaleStatusValue)}
            aria-label="Filter by sale status"
            className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All sale statuses</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={paymentStatusFilter}
            onChange={(e) =>
              setPaymentStatusFilter(e.target.value as 'all' | SalePaymentStatusValue)
            }
            aria-label="Filter by payment status"
            className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All payment statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </select>

          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            aria-label="Filter by location"
            className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All locations</option>
            {data.locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Date from"
              className="w-full min-w-0 px-2 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <span className="text-slate-400 text-xs">–</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Date to"
              className="w-full min-w-0 px-2 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="px-5 py-2 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between text-[11px] text-slate-600">
            <span>
              Showing {filteredSales.length} of {data.sales.length} total sales
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setPaymentStatusFilter('all');
                setLocationFilter('all');
                setDateFrom('');
                setDateTo('');
              }}
              className="font-medium text-blue-700 hover:text-blue-800"
            >
              Reset filters
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : data.errors.sales ? (
          <div className="p-6 text-xs text-amber-800 bg-amber-50/60">
            Unable to load sales history: {data.errors.sales}
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="p-10 text-center space-y-1">
            <div className="text-xs font-semibold text-slate-900">No sales found</div>
            <p className="text-xs text-slate-500">
              {hasActiveFilters
                ? 'No sales match the current search or filter criteria.'
                : 'Completed and cancelled sales for this organization will appear here.'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4 whitespace-nowrap">Sale #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Customer</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Total</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Paid</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Outstanding</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Payment</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {paginatedSales.map((sale) => {
                    const cur = sale.currency || currencyCode;
                    const canCollectFollowUp =
                      sale.status === 'completed' && sale.outstandingAmount > 0;
                    return (
                      <tr key={sale.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {sale.saleNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                          {formatSalesShortDate(sale.soldAt, timeZone)}
                        </td>
                        <td className="py-3 px-4 text-slate-800">
                          <div>{sale.customerName ?? 'Walk-in'}</div>
                          {sale.customerPhone && (
                            <div className="text-[11px] text-slate-500 font-mono">
                              {sale.customerPhone}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                          {sale.locationName}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                          {formatMoneyAmount(sale.totalAmount, cur)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-700 tabular-nums whitespace-nowrap">
                          {formatMoneyAmount(sale.paidAmount, cur)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                            sale.outstandingAmount > 0
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-500'
                          }`}
                        >
                          {formatMoneyAmount(sale.outstandingAmount, cur)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${
                              sale.paymentStatus === 'paid'
                                ? 'text-emerald-700'
                                : sale.paymentStatus === 'partial'
                                  ? 'text-amber-700'
                                  : 'text-red-700'
                            }`}
                          >
                            {formatPaymentStatusLabel(sale.paymentStatus)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${
                              sale.status === 'cancelled' ? 'text-red-700' : 'text-slate-700'
                            }`}
                          >
                            {formatSaleStatusLabel(sale.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedSaleId(sale.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Eye className="h-3 w-3" aria-hidden="true" />
                              <span>Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenReceipt(sale)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Receipt className="h-3 w-3" aria-hidden="true" />
                              <span>Receipt</span>
                            </button>
                            {canCollectFollowUp && (
                              <button
                                type="button"
                                onClick={() => openFollowUpModal(sale)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-700 text-white text-[11px] font-medium hover:bg-blue-800"
                              >
                                <CreditCard className="h-3 w-3" aria-hidden="true" />
                                <span>Pay</span>
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

            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Page <span className="font-mono font-medium">{page}</span> of{' '}
                  <span className="font-mono font-medium">{totalPages}</span>
                </span>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Prev</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
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

      {/* Sale Details Modal */}
      {selectedSale && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sale-details-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="sale-details-title" className="text-sm font-semibold text-slate-900">
                  Sale Details · <span className="font-mono">{selectedSale.saleNumber}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatSalesDateTime(selectedSale.soldAt, timeZone)} · {selectedSale.locationName}
                  {selectedSale.cashierName ? ` · Cashier: ${selectedSale.cashierName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenReceipt(selectedSale)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Receipt</span>
                </button>
                {selectedSale.status === 'completed' && selectedSale.outstandingAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => openFollowUpModal(selectedSale)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                  >
                    <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Record Payment</span>
                  </button>
                )}
                {canCancel &&
                  selectedSale.status === 'completed' &&
                  selectedSale.returnedAmount === 0 &&
                  selectedSale.returns.length === 0 && (
                    <button
                      type="button"
                      onClick={() => openCancelModal(selectedSale)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 bg-red-50 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Cancel Sale</span>
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setSelectedSaleId(null)}
                  aria-label="Close sale details"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {selectedSale.status === 'cancelled' && (
                <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-red-900 space-y-1">
                  <div className="font-semibold">Sale Cancelled</div>
                  <div>
                    Cancelled {formatSalesDateTime(selectedSale.cancelledAt, timeZone)}
                    {selectedSale.cancelledByName ? ` by ${selectedSale.cancelledByName}` : ''}
                  </div>
                  {selectedSale.cancellationReason && (
                    <div>Reason: {selectedSale.cancellationReason}</div>
                  )}
                </div>
              )}

              {/* Financial & Customer Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Customer</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {selectedSale.customerName ?? 'Walk-in'}
                  </div>
                  {selectedSale.customerPhone && (
                    <div className="text-[11px] font-mono text-slate-500">
                      {selectedSale.customerPhone}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Final Total</div>
                  <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {formatMoneyAmount(
                      selectedSale.totalAmount,
                      selectedSale.currency || currencyCode
                    )}
                  </div>
                  {selectedSale.discountTotalAmount > 0 && (
                    <div className="text-[11px] text-amber-700 font-mono tabular-nums">
                      Disc: -
                      {formatMoneyAmount(
                        selectedSale.discountTotalAmount,
                        selectedSale.currency || currencyCode
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Paid / Refunded</div>
                  <div className="font-mono font-semibold text-emerald-700 mt-0.5 tabular-nums">
                    {formatMoneyAmount(
                      selectedSale.paidAmount,
                      selectedSale.currency || currencyCode
                    )}
                  </div>
                  {selectedSale.refundedAmount > 0 && (
                    <div className="text-[11px] text-slate-600 font-mono tabular-nums">
                      Refunded:{' '}
                      {formatMoneyAmount(
                        selectedSale.refundedAmount,
                        selectedSale.currency || currencyCode
                      )}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">
                    {selectedSale.status === 'cancelled'
                      ? 'Pending Refund'
                      : 'Outstanding Credit'}
                  </div>
                  <div
                    className={`font-mono font-semibold mt-0.5 tabular-nums ${
                      selectedSale.outstandingAmount > 0 || selectedSale.pendingRefundAmount > 0
                        ? 'text-amber-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatMoneyAmount(
                      selectedSale.status === 'cancelled'
                        ? selectedSale.pendingRefundAmount
                        : selectedSale.outstandingAmount,
                      selectedSale.currency || currencyCode
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatSaleStatusLabel(selectedSale.status)} ·{' '}
                    {formatPaymentStatusLabel(selectedSale.paymentStatus)}
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900">Line Items</h4>
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-500">
                        <th className="py-2 px-3 font-medium">Product / Variant</th>
                        <th className="py-2 px-3 text-right font-medium">Qty</th>
                        <th className="py-2 px-3 text-right font-medium">Unit Price</th>
                        <th className="py-2 px-3 text-right font-medium">Discounts</th>
                        <th className="py-2 px-3 text-right font-medium">Final Total</th>
                        <th className="py-2 px-3 text-right font-medium">Returned</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedSale.items.map((item) => {
                        const cur = selectedSale.currency || currencyCode;
                        const totalItemDiscount =
                          item.lineDiscountAmount + item.allocatedOrderDiscount;
                        return (
                          <tr key={item.id}>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{item.productName}</div>
                              <div className="text-[11px] text-slate-500">
                                {item.variantName} · <span className="font-mono">{item.sku}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              {formatSalesQuantity(item.quantity)}{' '}
                              <span className="font-sans text-[10px] text-slate-500">
                                {formatUnitOfMeasureLabel(item.unitOfMeasure)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              {formatMoneyAmount(item.unitPrice, cur)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-amber-700">
                              {totalItemDiscount > 0
                                ? `-${formatMoneyAmount(totalItemDiscount, cur)}`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                              {formatMoneyAmount(item.lineFinalAmount, cur)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-600">
                              {item.returnedQuantity > 0
                                ? formatSalesQuantity(item.returnedQuantity)
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payments */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900">
                  Payments ({selectedSale.payments.length})
                </h4>
                {selectedSale.payments.length === 0 ? (
                  <p className="text-slate-500">No payments recorded for this sale yet.</p>
                ) : (
                  <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                    {selectedSale.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="p-3 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-medium text-slate-900">
                            {payment.methodName}{' '}
                            <span className="text-[11px] font-normal text-slate-500">
                              ({payment.paymentSource === 'follow_up' ? 'Follow-up' : 'Checkout'})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {formatSalesDateTime(payment.paidAt, timeZone)}
                            {payment.reference ? ` · Ref: ${payment.reference}` : ''}
                            {payment.recordedByName ? ` · By: ${payment.recordedByName}` : ''}
                          </div>
                        </div>
                        <div className="font-mono font-semibold text-emerald-700 tabular-nums">
                          {formatMoneyAmount(
                            payment.amount,
                            selectedSale.currency || currencyCode
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Returns & Refunds Summary */}
              {(selectedSale.returns.length > 0 || selectedSale.refunds.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="font-semibold text-slate-900">
                      Returns ({selectedSale.returns.length})
                    </h4>
                    {selectedSale.returns.length === 0 ? (
                      <p className="text-slate-500">No returns.</p>
                    ) : (
                      <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                        {selectedSale.returns.map((ret) => (
                          <div key={ret.id} className="p-3 space-y-1">
                            <div className="flex justify-between font-medium">
                              <span className="font-mono text-slate-900">{ret.returnNumber}</span>
                              <span className="font-mono tabular-nums">
                                {formatMoneyAmount(
                                  ret.totalReturnAmount,
                                  selectedSale.currency || currencyCode
                                )}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatSalesDateTime(ret.returnedAt, timeZone)} · Debt reduced:{' '}
                              {formatMoneyAmount(
                                ret.debtReducedAmount,
                                selectedSale.currency || currencyCode
                              )}
                            </div>
                            {ret.reason && (
                              <div className="text-[11px] text-slate-600">Reason: {ret.reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-slate-900">
                      Refunds ({selectedSale.refunds.length})
                    </h4>
                    {selectedSale.refunds.length === 0 ? (
                      <p className="text-slate-500">No refunds recorded.</p>
                    ) : (
                      <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
                        {selectedSale.refunds.map((rf) => (
                          <div key={rf.id} className="p-3 space-y-1">
                            <div className="flex justify-between font-medium">
                              <span>
                                {rf.methodName} ({rf.refundSource})
                              </span>
                              <span className="font-mono tabular-nums text-slate-900">
                                {formatMoneyAmount(
                                  rf.amount,
                                  selectedSale.currency || currencyCode
                                )}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatSalesDateTime(rf.refundedAt, timeZone)}
                              {rf.reference ? ` · Ref: ${rf.reference}` : ''}
                            </div>
                            {rf.reason && (
                              <div className="text-[11px] text-slate-600">Reason: {rf.reason}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Follow-Up Payment Modal */}
      {payModalSale && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="follow-up-pay-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 id="follow-up-pay-title" className="text-sm font-semibold text-slate-900">
                  Record Follow-Up Payment
                </h3>
                <p className="text-xs font-mono text-slate-500">{payModalSale.saleNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPayModalSaleId(null);
                  setPayConfirmStep(false);
                }}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {modalError && (
              <div className="mx-5 mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-900">
                {modalError}
              </div>
            )}

            {!payConfirmStep ? (
              <form onSubmit={handleReviewFollowUp}>
                <div className="p-5 space-y-4 text-xs">
                  <div className="p-3 rounded-md bg-slate-50 border border-slate-200 flex justify-between items-center">
                    <span className="text-slate-600">Outstanding Balance</span>
                    <span className="font-mono text-sm font-semibold text-amber-700 tabular-nums">
                      {formatMoneyAmount(
                        payModalSale.outstandingAmount,
                        payModalSale.currency || currencyCode
                      )}
                    </span>
                  </div>

                  <div>
                    <label
                      htmlFor="followup-method"
                      className="block font-medium text-slate-700 mb-1"
                    >
                      Payment Method <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="followup-method"
                      value={payMethodId}
                      onChange={(e) => setPayMethodId(e.target.value)}
                      required
                      className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {activeMethods.length === 0 ? (
                        <option value="">No active payment methods</option>
                      ) : (
                        activeMethods.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="followup-amount" className="font-medium text-slate-700">
                        Amount ({payModalSale.currency || currencyCode}){' '}
                        <span className="text-red-600">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setPayAmount(String(payModalSale.outstandingAmount))}
                        className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                      >
                        Full Balance
                      </button>
                    </div>
                    <input
                      id="followup-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={payModalSale.outstandingAmount}
                      required
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border border-slate-200 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="followup-ref"
                      className="block font-medium text-slate-700 mb-1"
                    >
                      Payment Reference{' '}
                      {isPaymentReferenceRequired(selectedPayMethod) ? (
                        <span className="text-red-600">*</span>
                      ) : (
                        <span className="text-slate-400">(optional)</span>
                      )}
                    </label>
                    <input
                      id="followup-ref"
                      type="text"
                      required={isPaymentReferenceRequired(selectedPayMethod)}
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                      placeholder={
                        isPaymentReferenceRequired(selectedPayMethod)
                          ? 'Required transaction reference'
                          : 'Optional reference'
                      }
                      className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPayModalSaleId(null)}
                    className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={activeMethods.length === 0}
                    className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
                  >
                    Review Payment
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="p-5 space-y-3 text-xs">
                  <p className="text-slate-600">
                    Confirm recording this follow-up payment for{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      {payModalSale.saleNumber}
                    </span>
                    :
                  </p>
                  <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Payment Method</span>
                      <span className="font-medium text-slate-900">
                        {selectedPayMethod?.name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Amount Collected</span>
                      <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                        {formatMoneyAmount(
                          roundMoney(Number(payAmount)),
                          payModalSale.currency || currencyCode
                        )}
                      </span>
                    </div>
                    {payReference.trim() && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Reference</span>
                        <span className="font-mono text-slate-900">{payReference.trim()}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1.5 border-t border-slate-200">
                      <span className="text-slate-500">Remaining Balance After</span>
                      <span className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatMoneyAmount(
                          roundMoney(
                            Math.max(0, payModalSale.outstandingAmount - Number(payAmount))
                          ),
                          payModalSale.currency || currencyCode
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPayConfirmStep(false)}
                    disabled={submitting}
                    className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmFollowUp()}
                    disabled={submitting}
                    className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
                  >
                    {submitting ? 'Recording...' : 'Confirm Payment'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel Sale Modal (Manager / Admin / Owner only) */}
      {cancelModalSale && canCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-sale-title"
        >
          <form
            onSubmit={handleConfirmCancelSale}
            className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 id="cancel-sale-title" className="text-sm font-semibold text-slate-900">
                  Cancel Sale
                </h3>
                <p className="text-xs font-mono text-slate-500">{cancelModalSale.saleNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => setCancelModalSaleId(null)}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-900">
                  {modalError}
                </div>
              )}

              <div className="p-3.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                <div className="font-semibold">Irreversible Ledger Reversal</div>
                <p>
                  Cancelling this sale reverses deducted physical inventory at{' '}
                  <span className="font-medium">{cancelModalSale.locationName}</span> and clears any unpaid credit balance.
                </p>
                {cancelModalSale.paidAmount > 0 && (
                  <p className="font-medium">
                    {formatMoneyAmount(
                      cancelModalSale.paidAmount,
                      cancelModalSale.currency || currencyCode
                    )}{' '}
                    already collected will become eligible for a cancellation refund.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="cancel-sale-reason"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Cancellation Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="cancel-sale-reason"
                  rows={3}
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Provide the reason for cancelling this sale..."
                  className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelModalSaleId(null)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Keep Sale
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-red-700 text-white text-xs font-semibold hover:bg-red-800 disabled:opacity-50"
              >
                {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

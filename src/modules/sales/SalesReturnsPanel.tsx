import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  RotateCcw,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import type { OrganisationRole } from '../../core/types/domain';
import {
  formatMoneyAmount,
  formatUnitOfMeasureLabel,
} from '../inventory/inventoryService';
import {
  formatSalesDateTime,
  formatSalesQuantity,
  formatSalesShortDate,
  generateIdempotencyKey,
  roundMoney,
  roundQuantity,
} from './salesFormatters';
import {
  cancelSale,
  recordSaleRefund,
  recordSalesReturn,
} from './salesService';
import {
  canManageReturnsAndCancellations,
  isPaymentReferenceRequired,
  type PaymentMethodRecord,
  type RefundSourceValue,
  type SaleRecord,
  type SalesModuleData,
  type SalesReturnRecord,
} from './salesTypes';

interface SalesReturnsPanelProps {
  organisationId: string;
  currencyCode: string;
  timeZone?: string | null;
  activeRole: OrganisationRole | null;
  data: SalesModuleData;
  loading: boolean;
  onReload: () => Promise<void>;
}

type ReturnsSubTab =
  | 'initiate_return'
  | 'record_refund'
  | 'return_history'
  | 'refund_history'
  | 'cancel_sale';

interface ReturnDraftLine {
  selected: boolean;
  quantity: string;
  restockQuantity: string;
  restockLocationId: string;
  conditionNotes: string;
}

function pickDefaultPaymentMethod(methods: PaymentMethodRecord[]): PaymentMethodRecord | null {
  return methods.find((m) => m.methodCode === 'cash') ?? methods[0] ?? null;
}

export function SalesReturnsPanel({
  organisationId,
  currencyCode,
  timeZone,
  activeRole,
  data,
  loading,
  onReload,
}: SalesReturnsPanelProps) {
  const canManage = canManageReturnsAndCancellations(activeRole);
  const [subTab, setSubTab] = useState<ReturnsSubTab>('initiate_return');

  const activeLocations = useMemo(
    () => data.locations.filter((l) => l.isActive),
    [data.locations]
  );
  const activeMethods = useMemo(
    () => data.paymentMethods.filter((m) => m.isActive),
    [data.paymentMethods]
  );

  // Eligible sales for Return
  const returnEligibleSales = useMemo(
    () =>
      data.sales.filter(
        (s) =>
          s.status === 'completed' &&
          s.items.some((item) => item.remainingReturnableQuantity > 0)
      ),
    [data.sales]
  );

  // Eligible sales for Refund (either return with refundableRemainingAmount > 0 OR cancelled sale with pendingRefundAmount > 0)
  const refundEligibleSales = useMemo(
    () =>
      data.sales.filter((s) => {
        if (s.status === 'cancelled' && s.pendingRefundAmount > 0) return true;
        if (
          s.status === 'completed' &&
          s.returns.some((r) => r.refundableRemainingAmount > 0)
        ) {
          return true;
        }
        return false;
      }),
    [data.sales]
  );

  // Eligible sales for Cancellation (completed with zero returns)
  const cancelEligibleSales = useMemo(
    () =>
      data.sales.filter(
        (s) =>
          s.status === 'completed' &&
          s.returnedAmount === 0 &&
          s.returns.length === 0
      ),
    [data.sales]
  );

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  // --- Initiate Return State ---
  const [returnSaleId, setReturnSaleId] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnDrafts, setReturnDrafts] = useState<Record<string, ReturnDraftLine>>({});
  const [showReturnConfirm, setShowReturnConfirm] = useState(false);
  const returnIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  // --- Record Refund State ---
  const [refundSaleId, setRefundSaleId] = useState('');
  const [refundSource, setRefundSource] = useState<RefundSourceValue>('return');
  const [refundReturnId, setRefundReturnId] = useState('');
  const [refundMethodId, setRefundMethodId] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const refundIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  // --- Cancel Sale State ---
  const [cancelSaleTarget, setCancelSaleTarget] = useState<SaleRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const cancelIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  // --- History Search & Detail ---
  const [historySearch, setHistorySearch] = useState('');
  const [viewingReturn, setViewingReturn] = useState<SalesReturnRecord | null>(null);

  const selectedReturnSale = useMemo(
    () => returnEligibleSales.find((s) => s.id === returnSaleId) ?? null,
    [returnEligibleSales, returnSaleId]
  );

  // Initialize return drafts when returnSaleId changes
  useEffect(() => {
    if (!selectedReturnSale) {
      setReturnDrafts({});
      return;
    }
    const defaultLocId =
      activeLocations.find((l) => l.id === selectedReturnSale.locationId)?.id ??
      activeLocations[0]?.id ??
      '';
    const next: Record<string, ReturnDraftLine> = {};
    for (const item of selectedReturnSale.items) {
      if (item.remainingReturnableQuantity <= 0) continue;
      next[item.id] = {
        selected: false,
        quantity: String(item.remainingReturnableQuantity),
        restockQuantity:
          item.productType === 'service' ? '0' : String(item.remainingReturnableQuantity),
        restockLocationId: defaultLocId,
        conditionNotes: '',
      };
    }
    setReturnDrafts(next);
    returnIdempotencyRef.current = null;
  }, [selectedReturnSale, activeLocations]);

  const selectedRefundSale = useMemo(
    () => refundEligibleSales.find((s) => s.id === refundSaleId) ?? null,
    [refundEligibleSales, refundSaleId]
  );

  const refundableReturnsForSale = useMemo(() => {
    if (!selectedRefundSale) return [];
    return selectedRefundSale.returns.filter((r) => r.refundableRemainingAmount > 0);
  }, [selectedRefundSale]);

  // Sync refund source & default return/amount when refund sale changes
  useEffect(() => {
    if (!selectedRefundSale) {
      setRefundReturnId('');
      setRefundAmount('');
      return;
    }
    if (selectedRefundSale.status === 'cancelled') {
      setRefundSource('cancellation');
      setRefundReturnId('');
      setRefundAmount(String(selectedRefundSale.pendingRefundAmount));
    } else {
      setRefundSource('return');
      const firstRet = refundableReturnsForSale[0] ?? null;
      setRefundReturnId(firstRet?.id ?? '');
      setRefundAmount(firstRet ? String(firstRet.refundableRemainingAmount) : '');
    }
    const defMethod = pickDefaultPaymentMethod(activeMethods);
    setRefundMethodId((prev) =>
      prev && activeMethods.some((m) => m.id === prev) ? prev : (defMethod?.id ?? '')
    );
    refundIdempotencyRef.current = null;
  }, [selectedRefundSale, refundableReturnsForSale, activeMethods]);

  const selectedRefundReturn = useMemo(
    () => refundableReturnsForSale.find((r) => r.id === refundReturnId) ?? null,
    [refundableReturnsForSale, refundReturnId]
  );

  const selectedRefundMethod = useMemo(
    () => activeMethods.find((m) => m.id === refundMethodId) ?? null,
    [activeMethods, refundMethodId]
  );

  // Return items payload & live preview
  const returnPreview = useMemo(() => {
    if (!selectedReturnSale) {
      return {
        selectedItems: [],
        estimatedReturnValue: 0,
        estimatedDebtReduced: 0,
        estimatedRefundableExcess: 0,
      };
    }
    const selectedItems: Array<{
      item: SaleRecord['items'][number];
      qty: number;
      restockQty: number;
      restockLocationId: string | null;
      conditionNotes: string | null;
      estimatedLineAmount: number;
    }> = [];

    for (const item of selectedReturnSale.items) {
      const draft = returnDrafts[item.id];
      if (!draft?.selected) continue;
      const qty = roundQuantity(Number(draft.quantity) || 0);
      const restockQty =
        item.productType === 'service'
          ? 0
          : roundQuantity(Number(draft.restockQuantity) || 0);
      const unitNet = item.quantity > 0 ? item.lineFinalAmount / item.quantity : 0;
      const estimatedLineAmount = roundMoney(unitNet * qty);
      selectedItems.push({
        item,
        qty,
        restockQty,
        restockLocationId: restockQty > 0 ? draft.restockLocationId || null : null,
        conditionNotes: draft.conditionNotes.trim() || null,
        estimatedLineAmount,
      });
    }

    const estimatedReturnValue = roundMoney(
      selectedItems.reduce((sum, x) => sum + x.estimatedLineAmount, 0)
    );
    const estimatedDebtReduced = roundMoney(
      Math.min(selectedReturnSale.outstandingAmount, estimatedReturnValue)
    );
    const estimatedRefundableExcess = roundMoney(
      Math.max(0, estimatedReturnValue - estimatedDebtReduced)
    );

    return {
      selectedItems,
      estimatedReturnValue,
      estimatedDebtReduced,
      estimatedRefundableExcess,
    };
  }, [selectedReturnSale, returnDrafts]);

  const filteredReturns = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return data.returns;
    return data.returns.filter(
      (r) =>
        r.returnNumber.toLowerCase().includes(q) ||
        r.saleNumber.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        (r.processedByName ?? '').toLowerCase().includes(q)
    );
  }, [data.returns, historySearch]);

  const filteredRefunds = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return data.refunds;
    return data.refunds.filter(
      (rf) =>
        rf.saleNumber.toLowerCase().includes(q) ||
        (rf.returnNumber ?? '').toLowerCase().includes(q) ||
        rf.methodName.toLowerCase().includes(q) ||
        (rf.reference ?? '').toLowerCase().includes(q) ||
        rf.reason.toLowerCase().includes(q)
    );
  }, [data.refunds, historySearch]);

  if (!canManage) {
    return (
      <section
        role="alert"
        className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex items-start gap-2.5 text-xs text-amber-900"
      >
        <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          Returns, refunds, and sale cancellations are restricted to Organization Owners, Admins, and Managers.
        </div>
      </section>
    );
  }

  const validateReturnForm = (): string | null => {
    if (!selectedReturnSale) return 'Select an eligible completed sale.';
    if (returnPreview.selectedItems.length === 0) {
      return 'Select at least one item to return.';
    }
    for (const row of returnPreview.selectedItems) {
      if (row.qty <= 0 || row.qty > row.item.remainingReturnableQuantity) {
        return `Return quantity for "${row.item.productName}" must be between 0.001 and ${row.item.remainingReturnableQuantity}.`;
      }
      if (row.item.productType === 'service' && row.restockQty > 0) {
        return `Service item "${row.item.productName}" cannot be restocked.`;
      }
      if (row.restockQty < 0 || row.restockQty > row.qty) {
        return `Restock quantity for "${row.item.productName}" cannot exceed the return quantity.`;
      }
      if (row.restockQty > 0 && !row.restockLocationId) {
        return `Select a restock location for "${row.item.productName}".`;
      }
    }
    if (!returnReason.trim()) {
      return 'A return reason is required.';
    }
    return null;
  };

  const handleOpenReturnConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const err = validateReturnForm();
    if (err) {
      setFeedback({ type: 'error', message: err });
      return;
    }
    setShowReturnConfirm(true);
  };

  const handleConfirmReturn = async () => {
    if (!selectedReturnSale || submitLockRef.current || submitting) return;
    const err = validateReturnForm();
    if (err) {
      setFeedback({ type: 'error', message: err });
      setShowReturnConfirm(false);
      return;
    }

    const itemsPayload = returnPreview.selectedItems.map((row) => ({
      saleItemId: row.item.id,
      quantity: row.qty,
      restockQuantity: row.restockQty,
      restockLocationId: row.restockLocationId,
      conditionNotes: row.conditionNotes,
    }));
    const reason = returnReason.trim();
    const signature = JSON.stringify({
      organisationId,
      saleId: selectedReturnSale.id,
      reason,
      itemsPayload,
    });

    if (
      !returnIdempotencyRef.current ||
      returnIdempotencyRef.current.signature !== signature
    ) {
      returnIdempotencyRef.current = {
        signature,
        key: generateIdempotencyKey(),
      };
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const result = await recordSalesReturn(organisationId, {
        saleId: selectedReturnSale.id,
        reason,
        items: itemsPayload,
        idempotencyKey: returnIdempotencyRef.current.key,
      });

      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        setShowReturnConfirm(false);
        return;
      }

      const saleNum = selectedReturnSale.saleNumber;
      returnIdempotencyRef.current = null;
      setShowReturnConfirm(false);
      setReturnSaleId('');
      setReturnReason('');
      setReturnDrafts({});
      setFeedback({
        type: 'success',
        message: `Return recorded for ${saleNum}. Debt reduction and stock restocking have been updated.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const maxRefundCeiling =
    refundSource === 'cancellation'
      ? (selectedRefundSale?.pendingRefundAmount ?? 0)
      : (selectedRefundReturn?.refundableRemainingAmount ?? 0);

  const validateRefundForm = (): string | null => {
    if (!selectedRefundSale) return 'Select an eligible sale for refund.';
    if (refundSource === 'return' && !selectedRefundReturn) {
      return 'Select the return record being refunded.';
    }
    if (maxRefundCeiling <= 0) {
      return 'There is no remaining refundable amount for the selected record.';
    }
    if (!refundMethodId || !selectedRefundMethod) {
      return 'Select an active payment method for the refund.';
    }
    const amt = roundMoney(Number(refundAmount));
    if (!Number.isFinite(amt) || amt <= 0) {
      return 'Refund amount must be greater than zero.';
    }
    if (amt > maxRefundCeiling) {
      return `Refund amount cannot exceed ${formatMoneyAmount(
        maxRefundCeiling,
        selectedRefundSale.currency || currencyCode
      )}.`;
    }
    if (isPaymentReferenceRequired(selectedRefundMethod) && !refundReference.trim()) {
      return `Payment reference is required for "${selectedRefundMethod.name}".`;
    }
    if (!refundReason.trim()) {
      return 'A refund reason is required.';
    }
    return null;
  };

  const handleOpenRefundConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const err = validateRefundForm();
    if (err) {
      setFeedback({ type: 'error', message: err });
      return;
    }
    setShowRefundConfirm(true);
  };

  const handleConfirmRefund = async () => {
    if (!selectedRefundSale || submitLockRef.current || submitting) return;
    const err = validateRefundForm();
    if (err) {
      setFeedback({ type: 'error', message: err });
      setShowRefundConfirm(false);
      return;
    }

    const amt = roundMoney(Number(refundAmount));
    const ref = refundReference.trim() || null;
    const reason = refundReason.trim();
    const returnId = refundSource === 'return' ? refundReturnId : null;

    const signature = JSON.stringify({
      organisationId,
      saleId: selectedRefundSale.id,
      refundSource,
      returnId,
      refundMethodId,
      amt,
      ref,
      reason,
    });

    if (
      !refundIdempotencyRef.current ||
      refundIdempotencyRef.current.signature !== signature
    ) {
      refundIdempotencyRef.current = {
        signature,
        key: generateIdempotencyKey(),
      };
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const result = await recordSaleRefund(organisationId, {
        saleId: selectedRefundSale.id,
        refundSource,
        returnId,
        paymentMethodId: refundMethodId,
        amount: amt,
        reason,
        reference: ref,
        idempotencyKey: refundIdempotencyRef.current.key,
      });

      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        setShowRefundConfirm(false);
        return;
      }

      const saleNum = selectedRefundSale.saleNumber;
      const cur = selectedRefundSale.currency || currencyCode;
      refundIdempotencyRef.current = null;
      setShowRefundConfirm(false);
      setRefundSaleId('');
      setRefundReturnId('');
      setRefundAmount('');
      setRefundReference('');
      setRefundReason('');
      setFeedback({
        type: 'success',
        message: `Refund of ${formatMoneyAmount(amt, cur)} recorded for ${saleNum}.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmCancelFromTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelSaleTarget || submitLockRef.current || submitting) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setFeedback({ type: 'error', message: 'A cancellation reason is required.' });
      return;
    }

    const signature = JSON.stringify({
      organisationId,
      saleId: cancelSaleTarget.id,
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
    setFeedback(null);

    try {
      const result = await cancelSale(organisationId, {
        saleId: cancelSaleTarget.id,
        reason,
        idempotencyKey: cancelIdempotencyRef.current.key,
      });

      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      const saleNum = cancelSaleTarget.saleNumber;
      cancelIdempotencyRef.current = null;
      setCancelSaleTarget(null);
      setCancelReason('');
      setFeedback({
        type: 'success',
        message: `Sale ${saleNum} cancelled and inventory restored.`,
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

      {/* Sub-navigation */}
      <div
        role="tablist"
        aria-label="Returns, refunds, and cancellations"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        {(
          [
            { id: 'initiate_return', label: 'Initiate Return' },
            {
              id: 'record_refund',
              label: `Record Refund (${refundEligibleSales.length})`,
            },
            { id: 'return_history', label: `Return History (${data.returns.length})` },
            { id: 'refund_history', label: `Refund History (${data.refunds.length})` },
            {
              id: 'cancel_sale',
              label: `Cancel Sale (${cancelEligibleSales.length})`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            onClick={() => {
              setSubTab(tab.id);
              setFeedback(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              subTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab 1: Initiate Return */}
      {subTab === 'initiate_return' && (
        <form
          onSubmit={handleOpenReturnConfirm}
          className="bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-200"
        >
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Initiate Sales Return</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select a completed sale with returnable items. Returns reduce outstanding credit balance first before creating refundable excess.
            </p>
          </div>

          <div className="p-5 space-y-5 text-xs">
            <div>
              <label htmlFor="return-sale-select" className="block font-medium text-slate-700 mb-1">
                Select Completed Sale <span className="text-red-600">*</span>
              </label>
              <select
                id="return-sale-select"
                value={returnSaleId}
                onChange={(e) => {
                  setReturnSaleId(e.target.value);
                  setFeedback(null);
                }}
                disabled={loading}
                className="w-full max-w-xl px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="">Choose a sale with returnable items...</option>
                {returnEligibleSales.map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.saleNumber} · {sale.customerName ?? 'Walk-in'} · Total{' '}
                    {formatMoneyAmount(sale.totalAmount, sale.currency || currencyCode)}
                    {sale.outstandingAmount > 0
                      ? ` (Outstanding: ${formatMoneyAmount(
                          sale.outstandingAmount,
                          sale.currency || currencyCode
                        )})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedReturnSale && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                    <div className="text-[11px] text-slate-500">Sale Total</div>
                    <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {formatMoneyAmount(
                        selectedReturnSale.totalAmount,
                        selectedReturnSale.currency || currencyCode
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                    <div className="text-[11px] text-slate-500">Amount Paid</div>
                    <div className="font-mono font-semibold text-emerald-700 mt-0.5 tabular-nums">
                      {formatMoneyAmount(
                        selectedReturnSale.paidAmount,
                        selectedReturnSale.currency || currencyCode
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                    <div className="text-[11px] text-slate-500">Outstanding Credit</div>
                    <div className="font-mono font-semibold text-amber-700 mt-0.5 tabular-nums">
                      {formatMoneyAmount(
                        selectedReturnSale.outstandingAmount,
                        selectedReturnSale.currency || currencyCode
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                    <div className="text-[11px] text-slate-500">Location</div>
                    <div className="font-medium text-slate-900 mt-0.5">
                      {selectedReturnSale.locationName}
                    </div>
                  </div>
                </div>

                {/* Returnable items */}
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-500">
                        <th className="py-2 px-3 font-medium">Return</th>
                        <th className="py-2 px-3 font-medium">Item</th>
                        <th className="py-2 px-3 text-right font-medium">Returnable</th>
                        <th className="py-2 px-3 text-right font-medium">Return Qty</th>
                        <th className="py-2 px-3 text-right font-medium">Restock Qty</th>
                        <th className="py-2 px-3 font-medium">Restock Location</th>
                        <th className="py-2 px-3 font-medium">Condition Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedReturnSale.items
                        .filter((i) => i.remainingReturnableQuantity > 0)
                        .map((item) => {
                          const draft = returnDrafts[item.id];
                          if (!draft) return null;
                          const returnQtyNum = roundQuantity(Number(draft.quantity) || 0);
                          const restockQtyNum =
                            item.productType === 'service'
                              ? 0
                              : roundQuantity(Number(draft.restockQuantity) || 0);
                          const damagedQty = roundQuantity(
                            Math.max(0, returnQtyNum - restockQtyNum)
                          );

                          return (
                            <tr key={item.id}>
                              <td className="py-2.5 px-3 align-top">
                                <input
                                  type="checkbox"
                                  checked={draft.selected}
                                  onChange={(e) =>
                                    setReturnDrafts((prev) => ({
                                      ...prev,
                                      [item.id]: { ...draft, selected: e.target.checked },
                                    }))
                                  }
                                  aria-label={`Select ${item.productName} for return`}
                                  className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                                />
                              </td>
                              <td className="py-2.5 px-3 align-top">
                                <div className="font-medium text-slate-900">{item.productName}</div>
                                <div className="text-[11px] text-slate-500">
                                  {item.variantName} · {item.productType}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums align-top whitespace-nowrap">
                                {formatSalesQuantity(item.remainingReturnableQuantity)}{' '}
                                <span className="font-sans text-[10px] text-slate-500">
                                  {formatUnitOfMeasureLabel(item.unitOfMeasure)}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right align-top">
                                <input
                                  type="number"
                                  min="0.001"
                                  step="1"
                                  max={item.remainingReturnableQuantity}
                                  disabled={!draft.selected}
                                  value={draft.quantity}
                                  onChange={(e) => {
                                    const nextQty = e.target.value;
                                    const num = Math.min(
                                      item.remainingReturnableQuantity,
                                      Math.max(0, Number(nextQty) || 0)
                                    );
                                    setReturnDrafts((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...draft,
                                        quantity: nextQty,
                                        restockQuantity:
                                          item.productType === 'service'
                                            ? '0'
                                            : String(
                                                Math.min(
                                                  num,
                                                  Number(draft.restockQuantity) || 0
                                                )
                                              ),
                                      },
                                    }));
                                  }}
                                  className="w-20 px-2 py-1 rounded-md border border-slate-200 text-right font-mono tabular-nums disabled:bg-slate-50"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-right align-top">
                                {item.productType === 'service' ? (
                                  <span className="text-[11px] text-slate-500">
                                    0 (Service)
                                  </span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      max={returnQtyNum}
                                      disabled={!draft.selected}
                                      value={draft.restockQuantity}
                                      onChange={(e) =>
                                        setReturnDrafts((prev) => ({
                                          ...prev,
                                          [item.id]: {
                                            ...draft,
                                            restockQuantity: e.target.value,
                                          },
                                        }))
                                      }
                                      className="w-20 px-2 py-1 rounded-md border border-slate-200 text-right font-mono tabular-nums disabled:bg-slate-50"
                                    />
                                    {draft.selected && damagedQty > 0 && (
                                      <div className="text-[10px] text-amber-700 font-mono">
                                        {damagedQty} non-restock
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 align-top">
                                {item.productType === 'service' || restockQtyNum <= 0 ? (
                                  <span className="text-[11px] text-slate-400">N/A</span>
                                ) : (
                                  <select
                                    disabled={!draft.selected}
                                    value={draft.restockLocationId}
                                    onChange={(e) =>
                                      setReturnDrafts((prev) => ({
                                        ...prev,
                                        [item.id]: {
                                          ...draft,
                                          restockLocationId: e.target.value,
                                        },
                                      }))
                                    }
                                    className="px-2 py-1 rounded-md border border-slate-200 bg-white text-xs text-slate-800"
                                  >
                                    {activeLocations.map((loc) => (
                                      <option key={loc.id} value={loc.id}>
                                        {loc.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="py-2.5 px-3 align-top">
                                <input
                                  type="text"
                                  disabled={!draft.selected}
                                  value={draft.conditionNotes}
                                  onChange={(e) =>
                                    setReturnDrafts((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...draft,
                                        conditionNotes: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Optional condition notes"
                                  className="w-36 px-2 py-1 rounded-md border border-slate-200 text-xs disabled:bg-slate-50"
                                />
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Return Reason + Financial Impact Preview */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  <div className="lg:col-span-7">
                    <label
                      htmlFor="return-reason-input"
                      className="block font-medium text-slate-700 mb-1"
                    >
                      Return Reason <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      id="return-reason-input"
                      rows={3}
                      required
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      placeholder="Explain why the items are being returned..."
                      className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div className="lg:col-span-5 p-4 rounded-md border border-slate-200 bg-slate-50/70 space-y-2">
                    <div className="font-semibold text-slate-900">
                      Estimated Debt-Reduction-First Allocation
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Estimated Return Value</span>
                      <span className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatMoneyAmount(
                          returnPreview.estimatedReturnValue,
                          selectedReturnSale.currency || currencyCode
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Applied to Outstanding Debt</span>
                      <span className="font-mono text-amber-700 tabular-nums">
                        {formatMoneyAmount(
                          returnPreview.estimatedDebtReduced,
                          selectedReturnSale.currency || currencyCode
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1.5 border-t border-slate-200 font-semibold">
                      <span className="text-slate-700">Estimated Refundable Excess</span>
                      <span className="font-mono text-emerald-700 tabular-nums">
                        {formatMoneyAmount(
                          returnPreview.estimatedRefundableExcess,
                          selectedReturnSale.currency || currencyCode
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Authoritative return values and debt reductions are computed by the database ledger.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {selectedReturnSale && (
            <div className="px-5 py-3.5 bg-slate-50 flex justify-end">
              <button
                type="submit"
                disabled={returnPreview.selectedItems.length === 0 || submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Review Return</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* Sub-tab 2: Record Refund */}
      {subTab === 'record_refund' && (
        <form
          onSubmit={handleOpenRefundConfirm}
          className="bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-200"
        >
          <div className="px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Record Refund</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Issue a refund against an eligible return excess or a cancelled sale with collected payments.
            </p>
          </div>

          <div className="p-5 space-y-4 text-xs max-w-2xl">
            {refundEligibleSales.length === 0 ? (
              <div className="p-6 text-center text-slate-500 border border-dashed border-slate-200 rounded-md">
                No completed returns or cancelled sales currently have an eligible pending refund balance.
              </div>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="refund-sale-select"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Eligible Sale <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="refund-sale-select"
                    value={refundSaleId}
                    onChange={(e) => setRefundSaleId(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">Choose a sale eligible for refund...</option>
                    {refundEligibleSales.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        {sale.saleNumber} · {sale.customerName ?? 'Walk-in'} ·{' '}
                        {sale.status === 'cancelled'
                          ? `Cancelled (Pending refund: ${formatMoneyAmount(
                              sale.pendingRefundAmount,
                              sale.currency || currencyCode
                            )})`
                          : 'Has refundable return balance'}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedRefundSale && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="refund-source-select"
                          className="block font-medium text-slate-700 mb-1"
                        >
                          Refund Source
                        </label>
                        <select
                          id="refund-source-select"
                          value={refundSource}
                          onChange={(e) =>
                            setRefundSource(e.target.value as RefundSourceValue)
                          }
                          disabled={selectedRefundSale.status === 'cancelled' || refundableReturnsForSale.length > 0}
                          className="w-full px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-slate-900"
                        >
                          {selectedRefundSale.status === 'cancelled' ? (
                            <option value="cancellation">Sale Cancellation</option>
                          ) : (
                            <option value="return">Sales Return</option>
                          )}
                        </select>
                      </div>

                      {refundSource === 'return' && (
                        <div>
                          <label
                            htmlFor="refund-return-select"
                            className="block font-medium text-slate-700 mb-1"
                          >
                            Return Record <span className="text-red-600">*</span>
                          </label>
                          <select
                            id="refund-return-select"
                            value={refundReturnId}
                            onChange={(e) => {
                              setRefundReturnId(e.target.value);
                              const ret = refundableReturnsForSale.find(
                                (r) => r.id === e.target.value
                              );
                              if (ret) setRefundAmount(String(ret.refundableRemainingAmount));
                            }}
                            required
                            className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          >
                            {refundableReturnsForSale.map((ret) => (
                              <option key={ret.id} value={ret.id}>
                                {ret.returnNumber} · Refundable:{' '}
                                {formatMoneyAmount(
                                  ret.refundableRemainingAmount,
                                  selectedRefundSale.currency || currencyCode
                                )}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
                      {refundSource === 'return' && selectedRefundReturn ? (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Return Total</span>
                            <span className="font-mono tabular-nums">
                              {formatMoneyAmount(
                                selectedRefundReturn.totalReturnAmount,
                                selectedRefundSale.currency || currencyCode
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Debt Reduced</span>
                            <span className="font-mono tabular-nums text-amber-700">
                              {formatMoneyAmount(
                                selectedRefundReturn.debtReducedAmount,
                                selectedRefundSale.currency || currencyCode
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Already Refunded</span>
                            <span className="font-mono tabular-nums">
                              {formatMoneyAmount(
                                selectedRefundReturn.refundedAmount,
                                selectedRefundSale.currency || currencyCode
                              )}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Collected on Cancelled Sale</span>
                            <span className="font-mono tabular-nums">
                              {formatMoneyAmount(
                                selectedRefundSale.paidAmount,
                                selectedRefundSale.currency || currencyCode
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-600">Already Refunded</span>
                            <span className="font-mono tabular-nums">
                              {formatMoneyAmount(
                                selectedRefundSale.refundedAmount,
                                selectedRefundSale.currency || currencyCode
                              )}
                            </span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between pt-1.5 border-t border-slate-200 font-semibold">
                        <span className="text-slate-800">Maximum Refundable Amount</span>
                        <span className="font-mono text-emerald-700 tabular-nums">
                          {formatMoneyAmount(
                            maxRefundCeiling,
                            selectedRefundSale.currency || currencyCode
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="refund-method-select"
                          className="block font-medium text-slate-700 mb-1"
                        >
                          Refund Payment Method <span className="text-red-600">*</span>
                        </label>
                        <select
                          id="refund-method-select"
                          value={refundMethodId}
                          onChange={(e) => setRefundMethodId(e.target.value)}
                          required
                          className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          {activeMethods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="refund-amount-input"
                          className="block font-medium text-slate-700 mb-1"
                        >
                          Refund Amount ({selectedRefundSale.currency || currencyCode}){' '}
                          <span className="text-red-600">*</span>
                        </label>
                        <input
                          id="refund-amount-input"
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={maxRefundCeiling}
                          required
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          className="w-full px-3 py-2 rounded-md border border-slate-200 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="refund-ref-input"
                        className="block font-medium text-slate-700 mb-1"
                      >
                        Payment Reference{' '}
                        {isPaymentReferenceRequired(selectedRefundMethod) ? (
                          <span className="text-red-600">*</span>
                        ) : (
                          <span className="text-slate-400">(optional)</span>
                        )}
                      </label>
                      <input
                        id="refund-ref-input"
                        type="text"
                        required={isPaymentReferenceRequired(selectedRefundMethod)}
                        value={refundReference}
                        onChange={(e) => setRefundReference(e.target.value)}
                        placeholder={
                          isPaymentReferenceRequired(selectedRefundMethod)
                            ? 'Required refund transfer/payment reference'
                            : 'Optional reference'
                        }
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="refund-reason-input"
                        className="block font-medium text-slate-700 mb-1"
                      >
                        Refund Reason <span className="text-red-600">*</span>
                      </label>
                      <textarea
                        id="refund-reason-input"
                        rows={2}
                        required
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        placeholder="Provide the reason for issuing this refund..."
                        className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {selectedRefundSale && (
            <div className="px-5 py-3.5 bg-slate-50 flex justify-end">
              <button
                type="submit"
                disabled={submitting || activeMethods.length === 0 || maxRefundCeiling <= 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500"
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Review Refund</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* Sub-tab 3: Return History */}
      {subTab === 'return_history' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Return History</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                All posted sales returns, debt reductions, and restock destinations.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search return #, sale #, reason..."
                aria-label="Search return history"
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs"
              />
            </div>
          </div>

          {filteredReturns.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No sales returns recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4 whitespace-nowrap">Return #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Sale #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Return Total</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Debt Reduced</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Refunded</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Reason</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredReturns.map((ret) => (
                    <tr key={ret.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {ret.returnNumber}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {ret.saleNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {formatSalesShortDate(ret.returnedAt, timeZone)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                        {formatMoneyAmount(ret.totalReturnAmount, currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-amber-700 tabular-nums whitespace-nowrap">
                        {formatMoneyAmount(ret.debtReducedAmount, currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-700 tabular-nums whitespace-nowrap">
                        {formatMoneyAmount(ret.refundedAmount, currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                        {ret.reason || '—'}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setViewingReturn(ret)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          <span>{ret.items.length}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Sub-tab 4: Refund History */}
      {subTab === 'refund_history' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Refund History</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit log of all return and cancellation refunds disbursed.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search sale #, method, reference..."
                aria-label="Search refund history"
                className="w-full pl-8 pr-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs"
              />
            </div>
          </div>

          {filteredRefunds.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No refunds recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Sale #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Source</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Method</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Reference</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Reason</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredRefunds.map((rf) => (
                    <tr key={rf.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {formatSalesDateTime(rf.refundedAt, timeZone)}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {rf.saleNumber}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="capitalize text-slate-700">{rf.refundSource}</span>
                        {rf.returnNumber && (
                          <span className="ml-1 font-mono text-[11px] text-slate-500">
                            ({rf.returnNumber})
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-800 whitespace-nowrap">
                        {rf.methodName}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {rf.reference ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatMoneyAmount(rf.amount, currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                        {rf.reason || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {rf.recordedByName ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Sub-tab 5: Cancel Eligible Sales */}
      {subTab === 'cancel_sale' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Cancel Completed Sales</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Only completed sales with no recorded returns can be cancelled. Collected payments become eligible for cancellation refunds.
            </p>
          </div>

          {cancelEligibleSales.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No completed sales without returns are available to cancel.
            </div>
          ) : (
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
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {cancelEligibleSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {sale.saleNumber}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {formatSalesShortDate(sale.soldAt, timeZone)}
                      </td>
                      <td className="py-3 px-4 text-slate-800">
                        {sale.customerName ?? 'Walk-in'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {sale.locationName}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatMoneyAmount(sale.totalAmount, sale.currency || currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-700 tabular-nums whitespace-nowrap">
                        {formatMoneyAmount(sale.paidAmount, sale.currency || currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setFeedback(null);
                            setCancelReason('');
                            cancelIdempotencyRef.current = null;
                            setCancelSaleTarget(sale);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 bg-red-50 text-[11px] font-medium text-red-700 hover:bg-red-100"
                        >
                          <Ban className="h-3 w-3" aria-hidden="true" />
                          <span>Cancel Sale</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Return Confirmation Modal */}
      {showReturnConfirm && selectedReturnSale && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-return-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 id="confirm-return-title" className="text-sm font-semibold text-slate-900">
                Confirm Sales Return
              </h3>
              <p className="text-xs font-mono text-slate-500">
                {selectedReturnSale.saleNumber}
              </p>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Returned Lines</span>
                <span className="font-mono text-slate-900">
                  {returnPreview.selectedItems.length} item(s)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estimated Return Value</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(
                    returnPreview.estimatedReturnValue,
                    selectedReturnSale.currency || currencyCode
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estimated Debt Reduction</span>
                <span className="font-mono text-amber-700 tabular-nums">
                  {formatMoneyAmount(
                    returnPreview.estimatedDebtReduced,
                    selectedReturnSale.currency || currencyCode
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estimated Refundable Excess</span>
                <span className="font-mono text-emerald-700 tabular-nums">
                  {formatMoneyAmount(
                    returnPreview.estimatedRefundableExcess,
                    selectedReturnSale.currency || currencyCode
                  )}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-100">
                <div className="text-slate-500 mb-0.5">Reason</div>
                <div className="text-slate-900">{returnReason.trim()}</div>
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReturnConfirm(false)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmReturn()}
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? 'Posting Return...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Confirmation Modal */}
      {showRefundConfirm && selectedRefundSale && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-refund-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 id="confirm-refund-title" className="text-sm font-semibold text-slate-900">
                Confirm Sale Refund
              </h3>
              <p className="text-xs font-mono text-slate-500">
                {selectedRefundSale.saleNumber}
              </p>
            </div>
            <div className="p-5 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Source</span>
                <span className="capitalize font-medium text-slate-900">
                  {refundSource}
                  {refundSource === 'return' && selectedRefundReturn
                    ? ` (${selectedRefundReturn.returnNumber})`
                    : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method</span>
                <span className="font-medium text-slate-900">{selectedRefundMethod?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Refund Amount</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatMoneyAmount(
                    roundMoney(Number(refundAmount)),
                    selectedRefundSale.currency || currencyCode
                  )}
                </span>
              </div>
              {refundReference.trim() && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Reference</span>
                  <span className="font-mono text-slate-900">{refundReference.trim()}</span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-100">
                <div className="text-slate-500 mb-0.5">Reason</div>
                <div className="text-slate-900">{refundReason.trim()}</div>
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRefundConfirm(false)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRefund()}
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? 'Recording Refund...' : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Sale Modal (from Cancel Sale sub-tab) */}
      {cancelSaleTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="returns-cancel-sale-title"
        >
          <form
            onSubmit={handleConfirmCancelFromTab}
            className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3
                  id="returns-cancel-sale-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Cancel Sale
                </h3>
                <p className="text-xs font-mono text-slate-500">{cancelSaleTarget.saleNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => setCancelSaleTarget(null)}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                <div className="font-semibold">Confirm Sale Cancellation</div>
                <p>
                  Cancelling restores physical inventory to {cancelSaleTarget.locationName} and clears unpaid credit balances.
                </p>
              </div>
              <div>
                <label
                  htmlFor="returns-cancel-reason"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Cancellation Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="returns-cancel-reason"
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
                onClick={() => setCancelSaleTarget(null)}
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

      {/* Return Item Details Modal */}
      {viewingReturn && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-return-items-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 id="view-return-items-title" className="text-sm font-semibold text-slate-900">
                  Return Items · <span className="font-mono">{viewingReturn.returnNumber}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Sale {viewingReturn.saleNumber} · {formatSalesDateTime(viewingReturn.returnedAt, timeZone)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingReturn(null)}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 overflow-x-auto text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-500">
                    <th className="py-2 px-3 font-medium">Item</th>
                    <th className="py-2 px-3 text-right font-medium">Returned</th>
                    <th className="py-2 px-3 text-right font-medium">Restocked</th>
                    <th className="py-2 px-3 text-right font-medium">Non-Restock</th>
                    <th className="py-2 px-3 font-medium">Restock Location</th>
                    <th className="py-2 px-3 font-medium">Condition Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewingReturn.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{item.productName}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.variantName} · <span className="font-mono">{item.sku}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatSalesQuantity(item.quantity)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {formatSalesQuantity(item.restockQuantity)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">
                        {formatSalesQuantity(item.damagedQuantity)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {item.restockLocationName ?? '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {item.conditionNotes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

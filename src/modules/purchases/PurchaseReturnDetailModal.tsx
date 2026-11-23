import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  Lock,
  RotateCcw,
  X,
} from 'lucide-react';
import type { InventoryLocationRecord } from '../inventory/inventoryService';
import {
  cancelPurchaseReturnDraft,
  completePurchaseReturn,
  formatPurchaseReturnStatusLabel,
} from './purchaseReturnsService';
import {
  formatPurchaseDateTime,
  formatPurchaseMoney,
  formatPurchaseNumberPrecision,
} from './purchasesService';
import type {
  PurchaseCatalogVariant,
  PurchaseRecord,
  PurchaseReturnCompleteResult,
  PurchaseReturnRecord,
  PurchaseReturnStatusValue,
} from './purchasesTypes';

interface PurchaseReturnDetailModalProps {
  organisationId: string | null;
  returnRecord: PurchaseReturnRecord | null;
  purchases: PurchaseRecord[];
  locationsById: Record<string, InventoryLocationRecord>;
  catalogVariants: PurchaseCatalogVariant[];
  defaultCurrency: string;
  timeZone?: string | null;
  canManage: boolean;
  onClose: () => void;
  onCompleted: (
    result: PurchaseReturnCompleteResult,
    target: PurchaseReturnRecord
  ) => Promise<void> | void;
  onCancelled: (target: PurchaseReturnRecord) => Promise<void> | void;
}

function getReturnStatusTextClass(status: PurchaseReturnStatusValue): string {
  switch (status) {
    case 'draft':
      return 'text-slate-700';
    case 'completed':
      return 'text-emerald-700';
    case 'cancelled':
      return 'text-red-700';
  }
}

export function PurchaseReturnDetailModal({
  organisationId,
  returnRecord,
  purchases,
  locationsById,
  catalogVariants,
  defaultCurrency,
  timeZone,
  canManage,
  onClose,
  onCompleted,
  onCancelled,
}: PurchaseReturnDetailModalProps) {
  const [activeAction, setActiveAction] = useState<'none' | 'complete' | 'cancel'>('none');
  const [supplierCreditRef, setSupplierCreditRef] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const actionLockRef = useRef(false);

  useEffect(() => {
    setActiveAction('none');
    setSupplierCreditRef('');
    setCancelReason('');
    setActionError(null);
    setSubmitting(false);
    actionLockRef.current = false;
  }, [returnRecord?.id, returnRecord?.status]);

  useEffect(() => {
    if (!returnRecord) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [returnRecord, submitting, onClose]);

  if (!returnRecord) return null;

  const isDraft = returnRecord.status === 'draft';
  const currency = returnRecord.currencyCode || defaultCurrency;

  const handleConfirmComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organisationId || !canManage || !isDraft) return;
    if (actionLockRef.current || submitting) return;

    actionLockRef.current = true;
    setSubmitting(true);
    setActionError(null);

    try {
      const result = await completePurchaseReturn(
        organisationId,
        returnRecord,
        supplierCreditRef.trim() || null,
        {
          purchases,
          catalogVariants,
          locationsById,
          defaultCurrency,
        }
      );

      if (result.error) {
        setActionError(result.error);
        return;
      }

      await onCompleted(result, returnRecord);
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organisationId || !canManage || !isDraft) return;
    if (actionLockRef.current || submitting) return;

    if (!cancelReason.trim()) {
      setActionError('A cancellation reason is required.');
      return;
    }

    actionLockRef.current = true;
    setSubmitting(true);
    setActionError(null);

    try {
      const result = await cancelPurchaseReturnDraft(
        organisationId,
        returnRecord,
        cancelReason
      );
      if (result.error) {
        setActionError(result.error);
        return;
      }

      await onCancelled(returnRecord);
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-return-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2
              id="purchase-return-detail-title"
              className="text-sm font-semibold text-slate-900 font-mono truncate flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>{returnRecord.returnNumber}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className={`font-medium ${getReturnStatusTextClass(returnRecord.status)}`}>
                {formatPurchaseReturnStatusLabel(returnRecord.status)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                PO: <span className="font-mono text-slate-700">{returnRecord.purchaseNumber}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>{returnRecord.supplierName}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManage && isDraft && activeAction === 'none' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setActiveAction('cancel');
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-red-200 bg-red-50 text-xs font-medium text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Cancel Draft</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setActiveAction('complete');
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-700 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Complete Return</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close purchase return details"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {!isDraft && (
            <div className="p-3 rounded-md border border-slate-200 bg-slate-50 text-slate-700 flex items-start gap-2 leading-relaxed">
              <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                This purchase return is{' '}
                <strong className="text-slate-900">
                  {formatPurchaseReturnStatusLabel(returnRecord.status)}
                </strong>
                .{' '}
                {returnRecord.status === 'completed'
                  ? 'Inventory stock has been deducted and completed returns cannot be modified or cancelled.'
                  : 'This draft was cancelled and any reserved returnable quantities have been released.'}
              </span>
            </div>
          )}

          {/* Complete Return Confirmation Panel */}
          {canManage && isDraft && activeAction === 'complete' && (
            <form
              onSubmit={handleConfirmComplete}
              className="p-4 rounded-lg border border-blue-200 bg-blue-50/70 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-blue-950">
                    Confirm & Complete Return ({returnRecord.returnNumber})
                  </div>
                  <p className="text-blue-900 mt-0.5 leading-relaxed">
                    Completing this return deducts the returned quantities from inventory stock at
                    each selected location. This action cannot be undone.
                  </p>
                </div>
              </div>

              {actionError && (
                <div
                  role="alert"
                  className="p-3 rounded-md border border-red-200 bg-red-50 text-red-900 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-red-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="supplier-credit-ref-input"
                  className="block text-[11px] font-medium text-slate-800"
                >
                  Supplier Credit Reference{' '}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  id="supplier-credit-ref-input"
                  type="text"
                  maxLength={150}
                  value={supplierCreditRef}
                  disabled={submitting}
                  onChange={(e) => {
                    setActionError(null);
                    setSupplierCreditRef(e.target.value);
                  }}
                  placeholder="e.g., CN-2026-041 or Supplier RMA #"
                  className="w-full max-w-md px-3 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveAction('none');
                    setActionError(null);
                  }}
                  disabled={submitting}
                  className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>Completing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Confirm & Complete Return</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Cancel Return Draft Confirmation Panel */}
          {canManage && isDraft && activeAction === 'cancel' && (
            <form
              onSubmit={handleConfirmCancel}
              className="p-4 rounded-lg border border-red-200 bg-red-50/70 space-y-3"
            >
              <div>
                <div className="font-semibold text-red-950">
                  Cancel Return Draft ({returnRecord.returnNumber})
                </div>
                <p className="text-red-900 mt-0.5 leading-relaxed">
                  Cancelling this draft releases the reserved quantities back to the purchase
                  order so they can be included in future returns.
                </p>
              </div>

              {actionError && (
                <div
                  role="alert"
                  className="p-3 rounded-md border border-red-300 bg-white text-red-900 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-red-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="cancel-return-reason-input"
                  className="block text-[11px] font-medium text-red-950"
                >
                  Cancellation Reason <span className="text-red-700">*</span>
                </label>
                <textarea
                  id="cancel-return-reason-input"
                  rows={2}
                  maxLength={1000}
                  required
                  value={cancelReason}
                  disabled={submitting}
                  onChange={(e) => {
                    setActionError(null);
                    setCancelReason(e.target.value);
                  }}
                  placeholder="Provide a reason for cancelling this return draft..."
                  className="w-full px-3 py-2 rounded-md border border-red-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveAction('none');
                    setActionError(null);
                  }}
                  disabled={submitting}
                  className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Keep Draft
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-red-700 text-white text-xs font-semibold hover:bg-red-800 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>Cancelling...</span>
                    </>
                  ) : (
                    <>
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Confirm Cancellation</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Metadata Grid */}
          <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Purchase Order #</div>
                <div className="font-mono font-medium text-slate-900 mt-0.5">
                  {returnRecord.purchaseNumber}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Supplier</div>
                <div className="text-slate-900 font-medium mt-0.5">{returnRecord.supplierName}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Return Date</div>
                <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatPurchaseDateTime(returnRecord.returnDate, timeZone)}
                </div>
              </div>
            </div>

            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  Supplier Credit Reference
                </div>
                <div className="font-mono text-slate-800 mt-0.5">
                  {returnRecord.supplierCreditReference || '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Created By</div>
                <div className="text-slate-800 mt-0.5">{returnRecord.createdByName}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  {returnRecord.status === 'cancelled' ? 'Cancelled By' : 'Completed By'}
                </div>
                <div className="text-slate-800 mt-0.5">
                  {returnRecord.status === 'cancelled'
                    ? returnRecord.cancelledByName ?? '—'
                    : returnRecord.completedByName ?? '—'}
                </div>
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Return Reason</div>
              <div className="text-slate-800 whitespace-pre-wrap leading-relaxed">
                {returnRecord.reason || '—'}
              </div>
            </div>

            {returnRecord.status === 'cancelled' && returnRecord.cancellationReason && (
              <div className="p-3.5 space-y-1 bg-red-50/40">
                <div className="text-[11px] font-medium text-red-800">Cancellation Reason</div>
                <div className="text-red-950 whitespace-pre-wrap leading-relaxed">
                  {returnRecord.cancellationReason}
                </div>
              </div>
            )}
          </div>

          {/* Returned Line Items */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900">Returned Items</h3>
              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                {returnRecord.items.length}{' '}
                {returnRecord.items.length === 1 ? 'line' : 'lines'}
              </span>
            </div>

            {returnRecord.items.length === 0 ? (
              <div className="p-6 text-center text-slate-500">
                No line items recorded on this purchase return.
              </div>
            ) : (
              <>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-500">
                        <th className="py-2 px-3">Product & Variant</th>
                        <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                        <th className="py-2 px-3">Location</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Quantity</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Unit Cost</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {returnRecord.items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{item.productName}</div>
                            <div className="text-[11px] text-slate-500">
                              {item.variantName} · {item.unitOfMeasure}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {item.sku}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">{item.locationName}</td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-900 whitespace-nowrap">
                            {formatPurchaseNumberPrecision(item.quantity)}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 whitespace-nowrap">
                            {formatPurchaseMoney(item.unitCost, currency)}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-900 whitespace-nowrap">
                            {formatPurchaseMoney(item.lineTotal, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Items */}
                <div className="sm:hidden divide-y divide-slate-200">
                  {returnRecord.items.map((item) => (
                    <div key={item.id} className="p-3.5 space-y-1.5">
                      <div className="font-medium text-slate-900">{item.productName}</div>
                      <div className="text-[11px] text-slate-600">
                        {item.variantName} · <span className="font-mono">{item.sku}</span> ·{' '}
                        {item.locationName}
                      </div>
                      <div className="flex items-center justify-between pt-1 font-mono tabular-nums text-[11px]">
                        <span className="text-slate-600">
                          {formatPurchaseNumberPrecision(item.quantity)} {item.unitOfMeasure} ×{' '}
                          {formatPurchaseMoney(item.unitCost, currency)}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {formatPurchaseMoney(item.lineTotal, currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Total Return Value */}
          <div className="flex justify-end">
            <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">Total Return Value</span>
                <span className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                  {formatPurchaseMoney(returnRecord.totalAmount, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

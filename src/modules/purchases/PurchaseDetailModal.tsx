import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Lock,
  PackageCheck,
  RefreshCw,
  X,
} from 'lucide-react';
import type { InventoryLocationRecord } from '../inventory/inventoryService';
import {
  fetchPurchaseReceipts,
  formatPurchaseDate,
  formatPurchaseDateTime,
  formatPurchaseMoney,
  formatPurchaseNumberPrecision,
  formatPurchaseStatusLabel,
  roundFourDecimals,
} from './purchasesService';
import {
  isPurchaseReceivableStatus,
  type PurchaseCatalogVariant,
  type PurchaseReceiptRecord,
  type PurchaseRecord,
  type PurchaseStatusValue,
} from './purchasesTypes';
import { formatPaymentTermsLabel } from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';

interface PurchaseDetailModalProps {
  organisationId: string | null;
  purchase: PurchaseRecord | null;
  timeZone?: string | null;
  canManage: boolean;
  suppliersById: Record<string, SupplierRecord>;
  locationsById: Record<string, InventoryLocationRecord>;
  catalogVariants: PurchaseCatalogVariant[];
  receiptsRefreshSignal?: number;
  onClose: () => void;
  onEdit: (purchase: PurchaseRecord) => void;
  onConfirmOrder: (purchase: PurchaseRecord) => void;
  onReceiveGoods: (purchase: PurchaseRecord) => void;
}

function getStatusTextClass(status: PurchaseStatusValue): string {
  switch (status) {
    case 'draft':
      return 'text-slate-700';
    case 'ordered':
      return 'text-blue-700';
    case 'partially_received':
      return 'text-amber-800';
    case 'received':
      return 'text-emerald-700';
    case 'cancelled':
      return 'text-red-700';
  }
}

export function PurchaseDetailModal({
  organisationId,
  purchase,
  timeZone,
  canManage,
  suppliersById,
  locationsById,
  catalogVariants,
  receiptsRefreshSignal = 0,
  onClose,
  onEdit,
  onConfirmOrder,
  onReceiveGoods,
}: PurchaseDetailModalProps) {
  const [receipts, setReceipts] = useState<PurchaseReceiptRecord[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const receiptSeqRef = useRef(0);

  const purchaseId = purchase?.id ?? null;
  const purchaseStatus = purchase?.status ?? null;
  const purchaseUpdatedAt = purchase?.updatedAt ?? null;
  const purchaseItems = purchase?.items;

  const loadReceipts = useCallback(async () => {
    if (!organisationId || !purchaseId || purchaseStatus === 'draft') {
      setReceipts([]);
      setReceiptsError(null);
      setReceiptsLoading(false);
      return;
    }

    const seq = ++receiptSeqRef.current;
    setReceiptsLoading(true);
    setReceiptsError(null);

    try {
      const res = await fetchPurchaseReceipts(organisationId, purchaseId, {
        purchaseItems,
        catalogVariants,
        locationsById,
      });
      if (seq !== receiptSeqRef.current) return;

      if (res.error) {
        setReceiptsError(res.error);
        setReceipts([]);
      } else {
        setReceipts(res.receipts);
      }
    } finally {
      if (seq === receiptSeqRef.current) {
        setReceiptsLoading(false);
      }
    }
  }, [organisationId, purchaseId, purchaseStatus, purchaseItems, catalogVariants, locationsById]);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts, purchaseUpdatedAt, receiptsRefreshSignal]);

  useEffect(() => {
    if (!purchase) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [purchase, onClose]);

  if (!purchase) return null;

  const isDraft = purchase.status === 'draft';
  const canReceive = canManage && isPurchaseReceivableStatus(purchase.status);
  const supplier = suppliersById[purchase.supplierId];
  const showReceivingColumns =
    purchase.status === 'ordered' ||
    purchase.status === 'partially_received' ||
    purchase.status === 'received';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2
              id="purchase-detail-title"
              className="text-sm font-semibold text-slate-900 font-mono truncate"
            >
              {purchase.purchaseNumber}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className={`font-medium ${getStatusTextClass(purchase.status)}`}>
                {formatPurchaseStatusLabel(purchase.status)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{purchase.supplierName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {purchase.items.length} {purchase.items.length === 1 ? 'item' : 'items'}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManage && isDraft && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(purchase);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Edit Draft</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onConfirmOrder(purchase);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-700 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Confirm Order</span>
                </button>
              </>
            )}
            {canReceive && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReceiveGoods(purchase);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-700 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
              >
                <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Receive Goods</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close purchase details"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
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
                This record is locked from editing because its status is{' '}
                <strong className="text-slate-900">{formatPurchaseStatusLabel(purchase.status)}</strong>.
                {purchase.status === 'ordered' || purchase.status === 'partially_received'
                  ? ' Stock balances increase only for accepted units when goods are physically received.'
                  : ''}
              </span>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Supplier</div>
                <div className="text-slate-900 font-medium mt-0.5">{purchase.supplierName}</div>
                {supplier && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {formatPaymentTermsLabel(supplier.paymentTermsDays)}
                    {supplier.contactPerson ? ` · ${supplier.contactPerson}` : ''}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Order Date</div>
                <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatPurchaseDate(purchase.orderDate, timeZone)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Expected Delivery Date</div>
                <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                  {formatPurchaseDate(purchase.expectedDeliveryDate, timeZone)}
                </div>
              </div>
            </div>

            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Supplier Invoice #</div>
                <div className="font-mono text-slate-800 mt-0.5">
                  {purchase.supplierInvoiceNumber || '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Currency</div>
                <div className="font-mono text-slate-800 mt-0.5">{purchase.currencyCode}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">
                  {purchase.confirmedAt ? 'Confirmed At' : 'Last Updated'}
                </div>
                <div className="font-mono tabular-nums text-slate-800 mt-0.5">
                  {formatPurchaseDateTime(purchase.confirmedAt ?? purchase.updatedAt, timeZone)}
                </div>
              </div>
            </div>

            {purchase.notes && (
              <div className="p-3.5 space-y-1">
                <div className="text-[11px] font-medium text-slate-500">Notes</div>
                <div className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {purchase.notes}
                </div>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900">Order Line Items</h3>
              <span className="font-mono tabular-nums text-[11px] text-slate-500">
                {purchase.items.length} {purchase.items.length === 1 ? 'line' : 'lines'}
              </span>
            </div>

            {purchase.items.length === 0 ? (
              <div className="p-6 text-center text-slate-500">No line items recorded on this purchase.</div>
            ) : (
              <>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-500">
                        <th className="py-2 px-3">Product</th>
                        <th className="py-2 px-3">Variant</th>
                        <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                        <th className="py-2 px-3 whitespace-nowrap">UoM</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Ordered</th>
                        {showReceivingColumns && (
                          <>
                            <th className="py-2 px-3 text-right whitespace-nowrap">Received</th>
                            <th className="py-2 px-3 text-right whitespace-nowrap">Remaining</th>
                          </>
                        )}
                        <th className="py-2 px-3 text-right whitespace-nowrap">Unit Cost</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {purchase.items.map((item) => {
                        const remaining = Math.max(
                          0,
                          roundFourDecimals(item.orderedQuantity - item.receivedQuantity)
                        );
                        return (
                          <tr key={item.id}>
                            <td className="py-2.5 px-3 font-medium text-slate-900">
                              {item.productName}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">{item.variantName}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {item.sku}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                              {item.unitOfMeasure}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-900 whitespace-nowrap">
                              {formatPurchaseNumberPrecision(item.orderedQuantity)}
                            </td>
                            {showReceivingColumns && (
                              <>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 whitespace-nowrap">
                                  {formatPurchaseNumberPrecision(item.receivedQuantity)}
                                </td>
                                <td
                                  className={`py-2.5 px-3 font-mono tabular-nums text-right font-medium whitespace-nowrap ${
                                    remaining > 0 ? 'text-blue-700' : 'text-emerald-700'
                                  }`}
                                >
                                  {formatPurchaseNumberPrecision(remaining)}
                                </td>
                              </>
                            )}
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-800 whitespace-nowrap">
                              {formatPurchaseMoney(item.unitCost, purchase.currencyCode)}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-900 whitespace-nowrap">
                              {formatPurchaseMoney(item.lineTotal, purchase.currencyCode)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Items */}
                <div className="sm:hidden divide-y divide-slate-200">
                  {purchase.items.map((item) => {
                    const remaining = Math.max(
                      0,
                      roundFourDecimals(item.orderedQuantity - item.receivedQuantity)
                    );
                    return (
                      <div key={item.id} className="p-3.5 space-y-1.5">
                        <div className="font-medium text-slate-900">{item.productName}</div>
                        <div className="text-[11px] text-slate-600">
                          {item.variantName} · <span className="font-mono">{item.sku}</span> ·{' '}
                          {item.unitOfMeasure}
                        </div>
                        <div className="flex items-center justify-between pt-1 font-mono tabular-nums text-[11px]">
                          <span className="text-slate-600">
                            {formatPurchaseNumberPrecision(item.orderedQuantity)} ×{' '}
                            {formatPurchaseMoney(item.unitCost, purchase.currencyCode)}
                          </span>
                          <span className="font-semibold text-slate-900">
                            {formatPurchaseMoney(item.lineTotal, purchase.currencyCode)}
                          </span>
                        </div>
                        {showReceivingColumns && (
                          <div className="flex items-center justify-between pt-1 text-[11px] font-mono tabular-nums text-slate-600 border-t border-slate-100">
                            <span>
                              Received: {formatPurchaseNumberPrecision(item.receivedQuantity)}
                            </span>
                            <span className={remaining > 0 ? 'text-blue-700' : 'text-emerald-700'}>
                              Remaining: {formatPurchaseNumberPrecision(remaining)}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Financial Totals */}
          <div className="flex justify-end">
            <div className="w-full sm:w-80 bg-slate-50 border border-slate-200 rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {formatPurchaseMoney(purchase.subtotal, purchase.currencyCode)}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Discount</span>
                <span className="font-mono tabular-nums text-slate-900">
                  −{formatPurchaseMoney(purchase.discountAmount, purchase.currencyCode)}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Tax</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {formatPurchaseMoney(purchase.taxAmount, purchase.currencyCode)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-900">Grand Total</span>
                <span className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                  {formatPurchaseMoney(purchase.totalAmount, purchase.currencyCode)}
                </span>
              </div>
            </div>
          </div>

          {/* Goods Received / Delivery History */}
          {!isDraft && (
            <section className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <ClipboardCheck className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-slate-900">
                    Goods Received / Delivery History
                  </h3>
                  {!receiptsLoading && (
                    <span className="font-mono tabular-nums text-[11px] text-slate-500">
                      ({receipts.length})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void loadReceipts()}
                  disabled={receiptsLoading}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${receiptsLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh</span>
                </button>
              </div>

              {receiptsLoading ? (
                <div className="p-4 space-y-2" aria-busy="true">
                  <div className="h-10 bg-slate-100 rounded animate-pulse" />
                  <div className="h-10 bg-slate-100 rounded animate-pulse" />
                </div>
              ) : receiptsError ? (
                <div
                  role="alert"
                  className="p-4 bg-amber-50/70 text-amber-900 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-amber-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <div className="font-semibold">Unable to load delivery history</div>
                    <div className="text-amber-800 mt-0.5">{receiptsError}</div>
                  </div>
                </div>
              ) : receipts.length === 0 ? (
                <div className="p-6 text-center text-slate-500">
                  No goods receipts have been recorded for this purchase order yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {receipts.map((receipt) => (
                    <div key={receipt.id} className="p-4 space-y-3">
                      {/* Receipt Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="font-mono font-semibold text-slate-900">
                            {receipt.receiptNumber}
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                            <span className="font-mono tabular-nums">
                              {formatPurchaseDateTime(receipt.receivedAt, timeZone)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>Received by: {receipt.receivedByName}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums">
                          <span className="text-slate-700">
                            Received: <strong>{formatPurchaseNumberPrecision(receipt.totalReceived)}</strong>
                          </span>
                          <span className="text-emerald-700">
                            Accepted: <strong>{formatPurchaseNumberPrecision(receipt.totalAccepted)}</strong>
                          </span>
                          <span className="text-amber-800">
                            Damaged: <strong>{formatPurchaseNumberPrecision(receipt.totalDamaged)}</strong>
                          </span>
                        </div>
                      </div>

                      {receipt.notes && (
                        <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-700 whitespace-pre-wrap">
                          <span className="font-medium text-slate-600">Notes: </span>
                          {receipt.notes}
                        </div>
                      )}

                      {/* Receipt Lines */}
                      {receipt.items.length > 0 && (
                        <>
                          <div className="hidden sm:block overflow-x-auto border border-slate-200 rounded">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                                  <th className="py-1.5 px-3">Product & Variant</th>
                                  <th className="py-1.5 px-3">SKU</th>
                                  <th className="py-1.5 px-3">Location</th>
                                  <th className="py-1.5 px-3 text-right">Received</th>
                                  <th className="py-1.5 px-3 text-right">Accepted</th>
                                  <th className="py-1.5 px-3 text-right">Damaged</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 text-[11px]">
                                {receipt.items.map((rItem) => (
                                  <tr key={rItem.id}>
                                    <td className="py-2 px-3">
                                      <span className="font-medium text-slate-900">
                                        {rItem.productName}
                                      </span>{' '}
                                      <span className="text-slate-600">— {rItem.variantName}</span>
                                    </td>
                                    <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                                      {rItem.sku}
                                    </td>
                                    <td className="py-2 px-3 text-slate-700">
                                      {rItem.locationName}
                                    </td>
                                    <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-900">
                                      {formatPurchaseNumberPrecision(rItem.receivedQuantity)}
                                    </td>
                                    <td className="py-2 px-3 font-mono tabular-nums text-right text-emerald-700 font-medium">
                                      {formatPurchaseNumberPrecision(rItem.acceptedQuantity)}
                                    </td>
                                    <td className="py-2 px-3 font-mono tabular-nums text-right text-amber-800 font-medium">
                                      {formatPurchaseNumberPrecision(rItem.damagedQuantity)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="sm:hidden divide-y divide-slate-200 border border-slate-200 rounded">
                            {receipt.items.map((rItem) => (
                              <div key={rItem.id} className="p-2.5 space-y-1 text-[11px]">
                                <div className="font-medium text-slate-900">
                                  {rItem.productName} — {rItem.variantName}
                                </div>
                                <div className="text-slate-500">
                                  SKU: <span className="font-mono">{rItem.sku}</span> ·{' '}
                                  {rItem.locationName}
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-1 font-mono tabular-nums">
                                  <div>
                                    <span className="text-slate-500 font-sans block">Received</span>
                                    <span className="text-slate-900 font-semibold">
                                      {formatPurchaseNumberPrecision(rItem.receivedQuantity)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500 font-sans block">Accepted</span>
                                    <span className="text-emerald-700 font-semibold">
                                      {formatPurchaseNumberPrecision(rItem.acceptedQuantity)}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500 font-sans block">Damaged</span>
                                    <span className="text-amber-800 font-semibold">
                                      {formatPurchaseNumberPrecision(rItem.damagedQuantity)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}


import { useEffect } from 'react';
import { CheckCircle2, Edit3, Lock, X } from 'lucide-react';
import {
  formatPurchaseDate,
  formatPurchaseDateTime,
  formatPurchaseMoney,
  formatPurchaseNumberPrecision,
  formatPurchaseStatusLabel,
} from './purchasesService';
import type { PurchaseRecord, PurchaseStatusValue } from './purchasesTypes';
import { formatPaymentTermsLabel } from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';

interface PurchaseDetailModalProps {
  purchase: PurchaseRecord | null;
  timeZone?: string | null;
  canManage: boolean;
  suppliersById: Record<string, SupplierRecord>;
  onClose: () => void;
  onEdit: (purchase: PurchaseRecord) => void;
  onConfirmOrder: (purchase: PurchaseRecord) => void;
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
  purchase,
  timeZone,
  canManage,
  suppliersById,
  onClose,
  onEdit,
  onConfirmOrder,
}: PurchaseDetailModalProps) {
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
  const supplier = suppliersById[purchase.supplierId];
  const showReceivedColumn =
    purchase.status === 'partially_received' || purchase.status === 'received';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
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
                  ? ' Stock balances increase only when goods are physically received.'
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
                        <th className="py-2 px-3 text-right whitespace-nowrap">Ordered Qty</th>
                        {showReceivedColumn && (
                          <th className="py-2 px-3 text-right whitespace-nowrap">Received</th>
                        )}
                        <th className="py-2 px-3 text-right whitespace-nowrap">Unit Cost</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {purchase.items.map((item) => (
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
                          {showReceivedColumn && (
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-700 whitespace-nowrap">
                              {formatPurchaseNumberPrecision(item.receivedQuantity)}
                            </td>
                          )}
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right text-slate-800 whitespace-nowrap">
                            {formatPurchaseMoney(item.unitCost, purchase.currencyCode)}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-900 whitespace-nowrap">
                            {formatPurchaseMoney(item.lineTotal, purchase.currencyCode)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Items */}
                <div className="sm:hidden divide-y divide-slate-200">
                  {purchase.items.map((item) => (
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
                    </div>
                  ))}
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
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import type { Organisation } from '../../core/types/domain';
import { formatMoneyAmount, formatUnitOfMeasureLabel } from '../inventory/inventoryService';
import {
  formatPaymentStatusLabel,
  formatSaleStatusLabel,
  formatSalesDateTime,
  formatSalesQuantity,
} from './salesFormatters';
import type { SaleRecord } from './salesTypes';

interface SaleReceiptModalProps {
  sale: SaleRecord | null;
  organisation: Organisation | null;
  onClose: () => void;
}

export function SaleReceiptModal({ sale, organisation, onClose }: SaleReceiptModalProps) {
  useEffect(() => {
    if (!sale) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sale, onClose]);

  if (!sale) return null;

  const currency = sale.currency || organisation?.base_currency || 'USD';
  const timeZone = organisation?.timezone;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 print:static print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-receipt-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-xl print:max-h-none print:shadow-none print:border-0">
        {/* Modal Header (hidden in print) */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 print:hidden">
          <div>
            <h2 id="sale-receipt-title" className="text-sm font-semibold text-slate-900">
              Sale Receipt
            </h2>
            <p className="text-xs font-mono text-slate-500">{sale.saleNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Print Receipt</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close receipt"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Receipt Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-800 print:overflow-visible">
          {/* Business Header */}
          <div className="text-center border-b border-slate-200 pb-4 space-y-1">
            <div className="font-display text-base font-semibold text-slate-900">
              {organisation?.name ?? 'Veyora Business'}
            </div>
            {(organisation?.business_email || organisation?.business_phone) && (
              <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-center gap-x-2">
                {organisation.business_email && <span>{organisation.business_email}</span>}
                {organisation.business_email && organisation.business_phone && (
                  <span aria-hidden="true">·</span>
                )}
                {organisation.business_phone && <span>{organisation.business_phone}</span>}
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              Location: <span className="font-medium text-slate-700">{sale.locationName}</span>
            </div>
          </div>

          {/* Receipt Meta */}
          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 border-b border-slate-200 pb-4">
            <div className="text-slate-500">Receipt No.</div>
            <div className="text-right font-mono font-semibold text-slate-900">
              {sale.saleNumber}
            </div>

            <div className="text-slate-500">Date &amp; Time</div>
            <div className="text-right font-mono text-slate-800">
              {formatSalesDateTime(sale.soldAt, timeZone)}
            </div>

            <div className="text-slate-500">Status</div>
            <div className="text-right font-medium text-slate-900">
              {formatSaleStatusLabel(sale.status)} · {formatPaymentStatusLabel(sale.paymentStatus)}
            </div>

            {sale.cashierName && (
              <>
                <div className="text-slate-500">Cashier</div>
                <div className="text-right text-slate-800">{sale.cashierName}</div>
              </>
            )}

            {(sale.customerName || sale.customerPhone) && (
              <>
                <div className="text-slate-500">Customer</div>
                <div className="text-right text-slate-800">
                  {sale.customerName ?? 'Walk-in'}
                  {sale.customerPhone ? ` (${sale.customerPhone})` : ''}
                </div>
              </>
            )}
          </div>

          {/* Line Items */}
          <div className="space-y-2 border-b border-slate-200 pb-4">
            <div className="text-[11px] font-semibold text-slate-600">Items</div>
            {sale.items.length === 0 ? (
              <div className="text-slate-500">No line items loaded for this sale.</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-1.5 pr-2 font-medium">Item</th>
                    <th className="py-1.5 px-2 text-right font-medium">Qty</th>
                    <th className="py-1.5 px-2 text-right font-medium">Price</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sale.items.map((item) => {
                    const totalItemDiscount = item.lineDiscountAmount + item.allocatedOrderDiscount;
                    return (
                      <tr key={item.id}>
                        <td className="py-2 pr-2 align-top">
                          <div className="font-medium text-slate-900">{item.productName}</div>
                          <div className="text-[11px] text-slate-500">
                            {item.variantName} · {item.sku}
                          </div>
                          {totalItemDiscount > 0 && (
                            <div className="text-[11px] text-amber-700">
                              Discount: -{formatMoneyAmount(totalItemDiscount, currency)}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums align-top whitespace-nowrap">
                          {formatSalesQuantity(item.quantity)}{' '}
                          <span className="font-sans text-[10px] text-slate-500">
                            {formatUnitOfMeasureLabel(item.unitOfMeasure)}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums align-top whitespace-nowrap">
                          {formatMoneyAmount(item.unitPrice, currency)}
                        </td>
                        <td className="py-2 pl-2 text-right font-mono font-medium text-slate-900 tabular-nums align-top whitespace-nowrap">
                          {formatMoneyAmount(item.lineFinalAmount, currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Totals */}
          <div className="space-y-1.5 border-b border-slate-200 pb-4">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-mono tabular-nums text-slate-900">
                {formatMoneyAmount(sale.subtotalAmount, currency)}
              </span>
            </div>
            {sale.discountTotalAmount > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>Discounts</span>
                <span className="font-mono tabular-nums">
                  -{formatMoneyAmount(sale.discountTotalAmount, currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between pt-1.5 border-t border-slate-100 text-sm font-semibold text-slate-900">
              <span>Final Total</span>
              <span className="font-mono tabular-nums">
                {formatMoneyAmount(sale.totalAmount, currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Amount Paid</span>
              <span className="font-mono tabular-nums text-emerald-700 font-medium">
                {formatMoneyAmount(sale.paidAmount, currency)}
              </span>
            </div>
            {sale.returnedAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">Returned Value</span>
                <span className="font-mono tabular-nums text-slate-800">
                  {formatMoneyAmount(sale.returnedAmount, currency)}
                </span>
              </div>
            )}
            {sale.refundedAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-600">Refunded</span>
                <span className="font-mono tabular-nums text-slate-800">
                  {formatMoneyAmount(sale.refundedAmount, currency)}
                </span>
              </div>
            )}
            {sale.outstandingAmount > 0 && (
              <div className="flex justify-between font-semibold text-amber-700">
                <span>Outstanding Balance</span>
                <span className="font-mono tabular-nums">
                  {formatMoneyAmount(sale.outstandingAmount, currency)}
                </span>
              </div>
            )}
          </div>

          {/* Payments */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-600">Payments</div>
            {sale.payments.length === 0 ? (
              <div className="text-slate-500">
                {sale.totalAmount === 0
                  ? 'No payment required (100% discounted sale).'
                  : 'No payment collected at checkout (credit sale).'}
              </div>
            ) : (
              <div className="space-y-1">
                {sale.payments.map((payment) => (
                  <div key={payment.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900">{payment.methodName}</span>
                      {payment.reference && (
                        <span className="text-[11px] font-mono text-slate-500 ml-1.5">
                          Ref: {payment.reference}
                        </span>
                      )}
                    </div>
                    <span className="font-mono tabular-nums text-slate-900 shrink-0">
                      {formatMoneyAmount(payment.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {sale.status === 'cancelled' && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 space-y-0.5">
              <div className="font-semibold">This sale has been cancelled</div>
              {sale.cancellationReason && <div>Reason: {sale.cancellationReason}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import type { Organisation } from '../../core/types/domain';
import type { ReceiptSettings } from '../../core/receipts/receiptSettingsTypes';
import { getEffectiveReceiptWidthMm } from '../../core/receipts/receiptSettingsTypes';
import { formatMoneyAmount, formatUnitOfMeasureLabel } from '../../modules/inventory/inventoryService';
import {
  formatPaymentStatusLabel,
  formatSaleStatusLabel,
  formatSalesDateTime,
  formatSalesQuantity,
} from '../../modules/sales/salesFormatters';
import type { SaleRecord } from '../../modules/sales/salesTypes';

interface ReceiptDocumentProps {
  sale: SaleRecord;
  organisation: Organisation | null;
  settings: ReceiptSettings;
  mode?: 'print' | 'preview' | 'modal';
  isSamplePreview?: boolean;
}

export function ReceiptDocument({
  sale,
  organisation,
  settings,
  mode = 'modal',
  isSamplePreview = false,
}: ReceiptDocumentProps) {
  const currency = sale.currency || organisation?.base_currency || 'USD';
  const timeZone = organisation?.timezone;
  const effectiveWidthMm = getEffectiveReceiptWidthMm(settings);

  const isCompactThermal =
    settings.paperSize === '58mm' ||
    (settings.paperSize === 'custom' && effectiveWidthMm < 70);
  const isWideA4 =
    settings.paperSize === 'a4' ||
    (settings.paperSize === 'custom' && effectiveWidthMm >= 130);

  const resolvedAddress =
    settings.businessAddress.trim() || sale.locationAddress || '';
  const resolvedPhone = organisation?.business_phone?.trim() || '';
  const resolvedEmail = organisation?.business_email?.trim() || '';
  const footerText = settings.footerText.trim();

  // Compute physical paper container width while keeping screen preview comfortable
  const containerStyle: CSSProperties = (() => {
    if (settings.paperSize === 'a4') {
      return mode === 'print'
        ? { width: '100%', maxWidth: '186mm', margin: '0 auto', padding: '6mm 8mm' }
        : { width: '100%', maxWidth: '680px', margin: '0 auto', padding: '24px' };
    }
    if (settings.paperSize === '58mm') {
      return mode === 'print'
        ? { width: '54mm', maxWidth: '100%', margin: '0 auto', padding: '2mm' }
        : { width: '58mm', maxWidth: '100%', margin: '0 auto', padding: '12px' };
    }
    if (settings.paperSize === '80mm') {
      return mode === 'print'
        ? { width: '74mm', maxWidth: '100%', margin: '0 auto', padding: '3mm' }
        : { width: '80mm', maxWidth: '100%', margin: '0 auto', padding: '16px' };
    }
    // Custom width
    const printableMm = Math.max(40, effectiveWidthMm - 4);
    return mode === 'print'
      ? { width: `${printableMm}mm`, maxWidth: '100%', margin: '0 auto', padding: '2.5mm' }
      : { width: `${effectiveWidthMm}mm`, maxWidth: '100%', margin: '0 auto', padding: '14px' };
  })();

  const isThermalStyle = mode === 'print' || !isWideA4;
  const textSizeClass = isCompactThermal
    ? 'text-[10px] leading-[1.35]'
    : isWideA4
      ? 'text-xs leading-relaxed'
      : 'text-[11px] leading-[1.4]';

  const headingSizeClass = isCompactThermal
    ? 'text-xs font-bold'
    : isWideA4
      ? 'text-lg font-bold'
      : 'text-sm font-bold';

  const dividerClass = isThermalStyle
    ? 'border-b border-dashed border-black'
    : 'border-b border-slate-200';

  const subtleTextClass = mode === 'print' ? 'text-black' : 'text-slate-600';

  return (
    <article
      style={containerStyle}
      className={`bg-white text-black box-border break-words ${textSizeClass}`}
    >
      {isSamplePreview && (
        <div className="mb-2.5 py-1 px-2 border border-dashed border-amber-500 bg-amber-50 text-amber-900 text-center text-[10px] font-semibold uppercase tracking-wide">
          Sample Preview — Not a Real Transaction
        </div>
      )}

      {/* Business Header */}
      <header className={`${isWideA4 ? 'flex items-start justify-between gap-4 text-left' : 'text-center'} pb-3 ${dividerClass}`}>
        <div className={isWideA4 ? 'space-y-1 min-w-0 flex-1' : 'space-y-1'}>
          {settings.showLogo && settings.logoUrl && (
            <div className={isWideA4 ? 'mb-2' : 'flex justify-center mb-1.5'}>
              <img
                src={settings.logoUrl}
                alt={`${organisation?.name ?? 'Business'} logo`}
                className={
                  isCompactThermal
                    ? 'max-h-10 max-w-[36mm] object-contain'
                    : isWideA4
                      ? 'max-h-16 max-w-[56mm] object-contain'
                      : 'max-h-12 max-w-[46mm] object-contain'
                }
              />
            </div>
          )}

          <div className={headingSizeClass}>
            {organisation?.name ?? 'Business Workspace'}
          </div>

          {settings.showAddress && resolvedAddress && (
            <div className={`${subtleTextClass} whitespace-pre-line break-words`}>
              {resolvedAddress}
            </div>
          )}

          {(settings.showPhone && resolvedPhone) || (settings.showEmail && resolvedEmail) ? (
            <div className={`${subtleTextClass} space-y-0.5 break-all`}>
              {settings.showPhone && resolvedPhone && <div>Tel: {resolvedPhone}</div>}
              {settings.showEmail && resolvedEmail && <div>{resolvedEmail}</div>}
            </div>
          ) : null}

          {!isWideA4 && (
            <div className={subtleTextClass}>
              Location: <span className="font-semibold text-black">{sale.locationName}</span>
            </div>
          )}
        </div>

        {isWideA4 && (
          <div className="text-right shrink-0 space-y-0.5">
            <div className="text-sm font-bold uppercase tracking-wide">Sales Receipt</div>
            <div className="font-mono font-semibold">{sale.saleNumber}</div>
            <div className={subtleTextClass}>
              Location: <span className="font-semibold text-black">{sale.locationName}</span>
            </div>
          </div>
        )}
      </header>

      {/* Transaction Metadata */}
      <section className={`py-2.5 space-y-1 ${dividerClass}`}>
        <div className="flex justify-between gap-2">
          <span className={subtleTextClass}>Receipt No.</span>
          <span className="font-mono font-bold text-right break-all">{sale.saleNumber}</span>
        </div>

        <div className="flex justify-between gap-2">
          <span className={subtleTextClass}>Date &amp; Time</span>
          <span className="font-mono text-right">{formatSalesDateTime(sale.soldAt, timeZone)}</span>
        </div>

        <div className="flex justify-between gap-2">
          <span className={subtleTextClass}>Status</span>
          <span className="font-semibold text-right">
            {formatSaleStatusLabel(sale.status)} · {formatPaymentStatusLabel(sale.paymentStatus)}
          </span>
        </div>

        {settings.showCashier && sale.cashierName && (
          <div className="flex justify-between gap-2">
            <span className={subtleTextClass}>Cashier</span>
            <span className="text-right break-words">{sale.cashierName}</span>
          </div>
        )}

        {settings.showCustomer && (sale.customerName || sale.customerPhone) && (
          <div className="flex justify-between gap-2">
            <span className={subtleTextClass}>Customer</span>
            <span className="text-right break-words">
              {sale.customerName ?? 'Walk-in'}
              {sale.customerPhone ? ` (${sale.customerPhone})` : ''}
            </span>
          </div>
        )}
      </section>

      {/* Line Items */}
      <section className={`py-2.5 ${dividerClass}`}>
        {sale.items.length === 0 ? (
          <div className={subtleTextClass}>No line items recorded for this sale.</div>
        ) : isCompactThermal ? (
          /* 58mm Compact Stacked Item Layout: Zero clipping & zero horizontal overflow */
          <div className="space-y-2">
            <div className="font-bold uppercase tracking-wide border-b border-black pb-1">
              Items
            </div>
            {sale.items.map((item) => {
              const totalItemDiscount = item.lineDiscountAmount + item.allocatedOrderDiscount;
              return (
                <div key={item.id} className="space-y-0.5 pb-1.5 border-b border-dotted border-black/50 last:border-b-0 last:pb-0">
                  <div className="font-semibold break-words">{item.productName}</div>
                  <div className={`${subtleTextClass} text-[9px] break-words`}>
                    {item.variantName}
                    {item.sku ? ` · ${item.sku}` : ''}
                  </div>
                  <div className="flex justify-between items-baseline gap-2 font-mono tabular-nums">
                    <span>
                      {formatSalesQuantity(item.quantity)} {formatUnitOfMeasureLabel(item.unitOfMeasure)} ×{' '}
                      {formatMoneyAmount(item.unitPrice, currency)}
                    </span>
                    <span className="font-bold shrink-0">
                      {formatMoneyAmount(item.lineFinalAmount, currency)}
                    </span>
                  </div>
                  {settings.showDiscounts && totalItemDiscount > 0 && (
                    <div className="text-[9px] font-mono tabular-nums">
                      Discount: -{formatMoneyAmount(totalItemDiscount, currency)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 80mm & A4 Table Layout */
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="border-b border-black font-bold">
                <th className={`py-1 pr-1.5 ${isWideA4 ? 'w-[46%]' : 'w-[42%]'}`}>Item</th>
                <th className="py-1 px-1 text-right w-[16%]">Qty</th>
                <th className="py-1 px-1 text-right w-[20%]">Price</th>
                <th className="py-1 pl-1 text-right w-[22%]">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/15">
              {sale.items.map((item) => {
                const totalItemDiscount = item.lineDiscountAmount + item.allocatedOrderDiscount;
                return (
                  <tr key={item.id} className="break-inside-avoid">
                    <td className="py-1.5 pr-1.5 align-top break-words">
                      <div className="font-semibold text-black">{item.productName}</div>
                      <div className={`${subtleTextClass} ${isWideA4 ? 'text-[11px]' : 'text-[10px]'}`}>
                        {item.variantName}
                        {item.sku ? ` · ${item.sku}` : ''}
                      </div>
                      {settings.showDiscounts && totalItemDiscount > 0 && (
                        <div className={`font-mono tabular-nums ${isWideA4 ? 'text-[11px]' : 'text-[10px]'}`}>
                          Disc: -{formatMoneyAmount(totalItemDiscount, currency)}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono tabular-nums align-top">
                      <div>{formatSalesQuantity(item.quantity)}</div>
                      <div className={`font-sans ${isWideA4 ? 'text-[10px]' : 'text-[9px]'} ${subtleTextClass}`}>
                        {formatUnitOfMeasureLabel(item.unitOfMeasure)}
                      </div>
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono tabular-nums align-top whitespace-nowrap">
                      {formatMoneyAmount(item.unitPrice, currency)}
                    </td>
                    <td className="py-1.5 pl-1 text-right font-mono font-semibold tabular-nums align-top whitespace-nowrap">
                      {formatMoneyAmount(item.lineFinalAmount, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Authoritative Totals Section */}
      <section className={`py-2.5 space-y-1 ${dividerClass}`}>
        {settings.showSubtotal && (
          <div className="flex justify-between gap-2">
            <span className={subtleTextClass}>Subtotal</span>
            <span className="font-mono tabular-nums">
              {formatMoneyAmount(sale.subtotalAmount, currency)}
            </span>
          </div>
        )}

        {settings.showDiscounts && sale.lineDiscountTotalAmount > 0 && sale.orderDiscountAmount > 0 ? (
          <>
            <div className="flex justify-between gap-2">
              <span className={subtleTextClass}>Line Discounts</span>
              <span className="font-mono tabular-nums">
                -{formatMoneyAmount(sale.lineDiscountTotalAmount, currency)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className={subtleTextClass}>Order Discount</span>
              <span className="font-mono tabular-nums">
                -{formatMoneyAmount(sale.orderDiscountAmount, currency)}
              </span>
            </div>
          </>
        ) : (
          settings.showDiscounts &&
          sale.discountTotalAmount > 0 && (
            <div className="flex justify-between gap-2">
              <span className={subtleTextClass}>
                {sale.orderDiscountAmount > 0 && sale.lineDiscountTotalAmount === 0
                  ? 'Order Discount'
                  : 'Discounts'}
              </span>
              <span className="font-mono tabular-nums">
                -{formatMoneyAmount(sale.discountTotalAmount, currency)}
              </span>
            </div>
          )
        )}

        <div
          className={`flex justify-between gap-2 pt-1 ${
            isCompactThermal ? 'text-xs' : isWideA4 ? 'text-sm' : 'text-[13px]'
          } font-bold border-t border-black/30`}
        >
          <span>FINAL TOTAL</span>
          <span className="font-mono tabular-nums">
            {formatMoneyAmount(sale.totalAmount, currency)}
          </span>
        </div>

        {settings.showAmountPaid && (
          <div className="flex justify-between gap-2">
            <span className={subtleTextClass}>Amount Paid</span>
            <span className="font-mono font-semibold tabular-nums">
              {formatMoneyAmount(sale.paidAmount, currency)}
            </span>
          </div>
        )}

        {sale.returnedAmount > 0 && (
          <div className="flex justify-between gap-2">
            <span className={subtleTextClass}>Returned Value</span>
            <span className="font-mono tabular-nums">
              {formatMoneyAmount(sale.returnedAmount, currency)}
            </span>
          </div>
        )}

        {sale.refundedAmount > 0 && (
          <div className="flex justify-between gap-2">
            <span className={subtleTextClass}>Refunded</span>
            <span className="font-mono tabular-nums">
              {formatMoneyAmount(sale.refundedAmount, currency)}
            </span>
          </div>
        )}

        {settings.showOutstandingBalance && sale.outstandingAmount > 0 && (
          <div className="flex justify-between gap-2 font-bold">
            <span>Outstanding Balance</span>
            <span className="font-mono tabular-nums">
              {formatMoneyAmount(sale.outstandingAmount, currency)}
            </span>
          </div>
        )}
      </section>

      {/* Payments Breakdown */}
      {settings.showPaymentMethod && (
        <section className={`py-2.5 space-y-1 ${footerText || sale.status === 'cancelled' || sale.refunds.length > 0 ? dividerClass : ''}`}>
          <div className="font-bold uppercase tracking-wide">Payments</div>
          {sale.payments.length === 0 ? (
            <div className={subtleTextClass}>
              {sale.totalAmount === 0
                ? 'No payment required (100% discounted sale).'
                : 'No payment collected at checkout (credit sale).'}
            </div>
          ) : (
            <div className="space-y-1">
              {sale.payments.map((payment) => (
                <div key={payment.id} className="space-y-0.5">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-semibold break-words">
                      {payment.methodName}
                      {payment.paymentSource === 'follow_up' ? ' (Follow-up)' : ''}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      {formatMoneyAmount(payment.amount, currency)}
                    </span>
                  </div>
                  {settings.showPaymentReference && payment.reference && (
                    <div className={`${subtleTextClass} font-mono text-[9px] break-all`}>
                      Ref: {payment.reference}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Cancellation or Refund Notice */}
      {sale.status === 'cancelled' && (
        <section className={`py-2.5 ${footerText ? dividerClass : ''}`}>
          <div className="p-2 border border-black font-semibold space-y-0.5">
            <div>CANCELLED SALE</div>
            {sale.cancellationReason && (
              <div className="font-normal break-words">Reason: {sale.cancellationReason}</div>
            )}
            {sale.pendingRefundAmount > 0 && (
              <div className="font-normal font-mono tabular-nums">
                Pending Refund: {formatMoneyAmount(sale.pendingRefundAmount, currency)}
              </div>
            )}
          </div>
        </section>
      )}

      {sale.refunds.length > 0 && sale.status !== 'cancelled' && (
        <section className={`py-2 space-y-1 ${footerText ? dividerClass : ''}`}>
          <div className="font-bold uppercase tracking-wide">Refunds Recorded</div>
          {sale.refunds.map((rf) => (
            <div key={rf.id} className="flex justify-between gap-2">
              <span className="break-words">
                {rf.methodName} ({rf.refundSource})
              </span>
              <span className="font-mono tabular-nums shrink-0">
                {formatMoneyAmount(rf.amount, currency)}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Custom Footer */}
      {footerText && (
        <footer className="pt-3 text-center whitespace-pre-line break-words font-medium">
          {footerText}
        </footer>
      )}
    </article>
  );
}

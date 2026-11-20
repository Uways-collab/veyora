import type { Organisation } from '../types/domain';
import type { SaleRecord } from '../../modules/sales/salesTypes';

export type ReceiptPaperSize = '58mm' | '80mm' | 'a4' | 'custom';

export interface ReceiptSettings {
  paperSize: ReceiptPaperSize;
  customWidthMm: number;
  showLogo: boolean;
  logoUrl: string | null;
  logoStoragePath: string | null;
  showAddress: boolean;
  businessAddress: string;
  showPhone: boolean;
  showEmail: boolean;
  showCashier: boolean;
  showCustomer: boolean;
  showPaymentMethod: boolean;
  showPaymentReference: boolean;
  showSubtotal: boolean;
  showDiscounts: boolean;
  showAmountPaid: boolean;
  showOutstandingBalance: boolean;
  footerText: string;
  updatedAt: string | null;
}

export const MIN_CUSTOM_WIDTH_MM = 45;
export const MAX_CUSTOM_WIDTH_MM = 210;

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  paperSize: '80mm',
  customWidthMm: 72,
  showLogo: true,
  logoUrl: null,
  logoStoragePath: null,
  showAddress: true,
  businessAddress: '',
  showPhone: true,
  showEmail: true,
  showCashier: true,
  showCustomer: true,
  showPaymentMethod: true,
  showPaymentReference: true,
  showSubtotal: true,
  showDiscounts: true,
  showAmountPaid: true,
  showOutstandingBalance: true,
  footerText: 'Thank you for shopping with us!',
  updatedAt: null,
};

export const RECEIPT_PAPER_SIZE_OPTIONS: Array<{
  value: ReceiptPaperSize;
  label: string;
  description: string;
}> = [
  {
    value: '58mm',
    label: '58mm Thermal Receipt',
    description: 'Compact POS roll with narrow margins for portable/mini thermal printers.',
  },
  {
    value: '80mm',
    label: '80mm Thermal Receipt',
    description: 'Standard counter thermal roll with clear item columns and payment breakdown.',
  },
  {
    value: 'a4',
    label: 'A4 Full Page',
    description: 'Centered full-page document layout for desktop/laser printers and PDF invoices.',
  },
  {
    value: 'custom',
    label: 'Custom Width',
    description: 'Specify an exact receipt paper width between 45mm and 210mm.',
  },
];

export function clampCustomWidthMm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RECEIPT_SETTINGS.customWidthMm;
  return Math.min(MAX_CUSTOM_WIDTH_MM, Math.max(MIN_CUSTOM_WIDTH_MM, Math.round(value)));
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNullableStr(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return null;
}

function normalizePaperSize(value: unknown): ReceiptPaperSize {
  if (value === '58mm' || value === '80mm' || value === 'a4' || value === 'custom') {
    return value;
  }
  return DEFAULT_RECEIPT_SETTINGS.paperSize;
}

export function normalizeReceiptSettings(raw: unknown): ReceiptSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_RECEIPT_SETTINGS };
  }

  const obj = raw as Record<string, unknown>;
  const rawWidth =
    typeof obj.customWidthMm === 'number'
      ? obj.customWidthMm
      : typeof obj.customWidthMm === 'string'
        ? Number(obj.customWidthMm)
        : DEFAULT_RECEIPT_SETTINGS.customWidthMm;

  return {
    paperSize: normalizePaperSize(obj.paperSize),
    customWidthMm: clampCustomWidthMm(rawWidth),
    showLogo: readBool(obj.showLogo, DEFAULT_RECEIPT_SETTINGS.showLogo),
    logoUrl: readNullableStr(obj.logoUrl),
    logoStoragePath: readNullableStr(obj.logoStoragePath),
    showAddress: readBool(obj.showAddress, DEFAULT_RECEIPT_SETTINGS.showAddress),
    businessAddress: readStr(obj.businessAddress, DEFAULT_RECEIPT_SETTINGS.businessAddress),
    showPhone: readBool(obj.showPhone, DEFAULT_RECEIPT_SETTINGS.showPhone),
    showEmail: readBool(obj.showEmail, DEFAULT_RECEIPT_SETTINGS.showEmail),
    showCashier: readBool(obj.showCashier, DEFAULT_RECEIPT_SETTINGS.showCashier),
    showCustomer: readBool(obj.showCustomer, DEFAULT_RECEIPT_SETTINGS.showCustomer),
    showPaymentMethod: readBool(obj.showPaymentMethod, DEFAULT_RECEIPT_SETTINGS.showPaymentMethod),
    showPaymentReference: readBool(
      obj.showPaymentReference,
      DEFAULT_RECEIPT_SETTINGS.showPaymentReference
    ),
    showSubtotal: readBool(obj.showSubtotal, DEFAULT_RECEIPT_SETTINGS.showSubtotal),
    showDiscounts: readBool(obj.showDiscounts, DEFAULT_RECEIPT_SETTINGS.showDiscounts),
    showAmountPaid: readBool(obj.showAmountPaid, DEFAULT_RECEIPT_SETTINGS.showAmountPaid),
    showOutstandingBalance: readBool(
      obj.showOutstandingBalance,
      DEFAULT_RECEIPT_SETTINGS.showOutstandingBalance
    ),
    footerText:
      typeof obj.footerText === 'string'
        ? obj.footerText
        : DEFAULT_RECEIPT_SETTINGS.footerText,
    updatedAt: readNullableStr(obj.updatedAt),
  };
}

export function getEffectiveReceiptWidthMm(settings: ReceiptSettings): number {
  switch (settings.paperSize) {
    case '58mm':
      return 58;
    case '80mm':
      return 80;
    case 'a4':
      return 210;
    case 'custom':
      return clampCustomWidthMm(settings.customWidthMm);
  }
}

export function buildSamplePreviewSale(organisation: Organisation | null): SaleRecord {
  const orgId = organisation?.id ?? 'preview-org';
  const currency = organisation?.base_currency || 'USD';
  const nowIso = new Date().toISOString();

  return {
    id: 'preview-sale-001',
    organizationId: orgId,
    saleNumber: 'SAL-PREVIEW-0042',
    locationId: 'preview-loc-001',
    locationName: 'Main Storefront',
    locationAddress: organisation?.country
      ? `Sample Street Address, ${organisation.country}`
      : 'Sample Store Address',
    currency,
    customerName: 'Sample Customer (Preview)',
    customerPhone: '+1 555 014 8820',
    status: 'completed',
    paymentStatus: 'partial',
    isCreditSale: true,
    subtotalAmount: 245,
    lineDiscountTotalAmount: 15,
    orderDiscountAmount: 10,
    discountTotalAmount: 25,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: 220,
    paidAmount: 150,
    returnedAmount: 0,
    debtReducedAmount: 0,
    refundedAmount: 0,
    cancelledCreditAmount: 0,
    outstandingAmount: 70,
    pendingRefundAmount: 0,
    soldAt: nowIso,
    cashierUserId: 'preview-cashier',
    cashierName: 'Sample Cashier',
    cancelledAt: null,
    cancelledByUserId: null,
    cancelledByName: null,
    cancellationReason: null,
    items: [
      {
        id: 'preview-item-1',
        organizationId: orgId,
        saleId: 'preview-sale-001',
        productId: 'preview-prod-1',
        variantId: 'preview-var-1',
        productName: 'Sample Merchandise Pack (Large)',
        variantName: 'Standard Box',
        sku: 'SMP-101',
        barcode: null,
        unitOfMeasure: 'piece',
        productType: 'physical',
        unitPrice: 80,
        unitCost: 50,
        quantity: 2,
        lineSubtotal: 160,
        lineDiscountAmount: 15,
        allocatedOrderDiscount: 6.52,
        lineFinalAmount: 138.48,
        returnedQuantity: 0,
        returnedAmount: 0,
        remainingReturnableQuantity: 2,
        remainingReturnableAmount: 138.48,
      },
      {
        id: 'preview-item-2',
        organizationId: orgId,
        saleId: 'preview-sale-001',
        productId: 'preview-prod-2',
        variantId: 'preview-var-2',
        productName: 'Express Delivery & Setup Service',
        variantName: 'Standard Tier',
        sku: 'SRV-004',
        barcode: null,
        unitOfMeasure: 'piece',
        productType: 'service',
        unitPrice: 85,
        unitCost: 0,
        quantity: 1,
        lineSubtotal: 85,
        lineDiscountAmount: 0,
        allocatedOrderDiscount: 3.48,
        lineFinalAmount: 81.52,
        returnedQuantity: 0,
        returnedAmount: 0,
        remainingReturnableQuantity: 1,
        remainingReturnableAmount: 81.52,
      },
    ],
    payments: [
      {
        id: 'preview-pay-1',
        organizationId: orgId,
        saleId: 'preview-sale-001',
        paymentMethodId: 'preview-pm-1',
        methodName: 'Bank Transfer',
        methodCode: 'bank_transfer',
        amount: 100,
        reference: 'TRF-20261120-8841',
        paymentSource: 'checkout',
        paidAt: nowIso,
        recordedByUserId: 'preview-cashier',
        recordedByName: 'Sample Cashier',
      },
      {
        id: 'preview-pay-2',
        organizationId: orgId,
        saleId: 'preview-sale-001',
        paymentMethodId: 'preview-pm-2',
        methodName: 'Cash',
        methodCode: 'cash',
        amount: 50,
        reference: null,
        paymentSource: 'checkout',
        paidAt: nowIso,
        recordedByUserId: 'preview-cashier',
        recordedByName: 'Sample Cashier',
      },
    ],
    returns: [],
    refunds: [],
  };
}

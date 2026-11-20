import type { OrganisationRole } from '../../core/types/domain';
import type {
  InventoryBalanceRecord,
  InventoryCategoryRecord,
  InventoryLocationRecord,
  InventoryProductRecord,
  InventoryVariantRecord,
  ProductTypeValue,
} from '../inventory/inventoryService';

export type PaymentMethodCode =
  | 'cash'
  | 'bank_transfer'
  | 'card_pos'
  | 'mobile_money'
  | 'other';

export type SaleStatusValue = 'completed' | 'cancelled';
export type SalePaymentStatusValue = 'paid' | 'partial' | 'unpaid';
export type RefundSourceValue = 'return' | 'cancellation';

export interface PaymentMethodRecord {
  id: string;
  organizationId: string;
  name: string;
  methodCode: PaymentMethodCode;
  methodCodeLabel: string;
  requiresReference: boolean;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface SaleItemRecord {
  id: string;
  organizationId: string;
  saleId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  unitOfMeasure: string;
  productType: ProductTypeValue;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  lineSubtotal: number;
  lineDiscountAmount: number;
  allocatedOrderDiscount: number;
  lineFinalAmount: number;
  returnedQuantity: number;
  returnedAmount: number;
  remainingReturnableQuantity: number;
  remainingReturnableAmount: number;
}

export interface SalePaymentRecord {
  id: string;
  organizationId: string;
  saleId: string;
  paymentMethodId: string;
  methodName: string;
  methodCode: PaymentMethodCode;
  amount: number;
  reference: string | null;
  paymentSource: 'checkout' | 'follow_up';
  paidAt: string;
  recordedByUserId: string | null;
  recordedByName: string | null;
}

export interface SalesReturnItemRecord {
  id: string;
  organizationId: string;
  saleId: string;
  returnId: string;
  saleItemId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  productType: ProductTypeValue;
  quantity: number;
  restockQuantity: number;
  damagedQuantity: number;
  restockLocationId: string | null;
  restockLocationName: string | null;
  conditionNotes: string | null;
  returnLineAmount: number;
}

export interface SalesReturnRecord {
  id: string;
  organizationId: string;
  saleId: string;
  saleNumber: string;
  returnNumber: string;
  locationId: string | null;
  locationName: string;
  reason: string;
  totalReturnAmount: number;
  debtReducedAmount: number;
  refundedAmount: number;
  refundableRemainingAmount: number;
  returnedAt: string;
  processedByUserId: string | null;
  processedByName: string | null;
  items: SalesReturnItemRecord[];
}

export interface SaleRefundRecord {
  id: string;
  organizationId: string;
  saleId: string;
  saleNumber: string;
  returnId: string | null;
  returnNumber: string | null;
  refundSource: RefundSourceValue;
  paymentMethodId: string;
  methodName: string;
  methodCode: PaymentMethodCode;
  amount: number;
  reason: string;
  reference: string | null;
  refundedAt: string;
  recordedByUserId: string | null;
  recordedByName: string | null;
}

export interface SaleRecord {
  id: string;
  organizationId: string;
  saleNumber: string;
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  currency: string;
  customerName: string | null;
  customerPhone: string | null;
  status: SaleStatusValue;
  paymentStatus: SalePaymentStatusValue;
  isCreditSale: boolean;
  subtotalAmount: number;
  lineDiscountTotalAmount: number;
  orderDiscountAmount: number;
  discountTotalAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  returnedAmount: number;
  debtReducedAmount: number;
  refundedAmount: number;
  cancelledCreditAmount: number;
  outstandingAmount: number;
  pendingRefundAmount: number;
  soldAt: string;
  cashierUserId: string | null;
  cashierName: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  items: SaleItemRecord[];
  payments: SalePaymentRecord[];
  returns: SalesReturnRecord[];
  refunds: SaleRefundRecord[];
}

export interface PosCatalogItem {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  categoryId: string | null;
  categoryName: string;
  categoryPath: string;
  productType: ProductTypeValue;
  sku: string;
  barcode: string | null;
  unitOfMeasure: string;
  sellingPrice: number;
  costPrice: number;
  attributes: Record<string, string>;
}

export interface PosCartLine {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  productType: ProductTypeValue;
  sku: string;
  unitOfMeasure: string;
  unitPrice: number;
  quantity: number;
  lineDiscountAmount: number;
}

export interface PosPaymentDraft {
  rowKey: string;
  paymentMethodId: string;
  amount: string;
  reference: string;
}

export interface SalesModuleData {
  sales: SaleRecord[];
  returns: SalesReturnRecord[];
  refunds: SaleRefundRecord[];
  paymentMethods: PaymentMethodRecord[];
  products: InventoryProductRecord[];
  categories: InventoryCategoryRecord[];
  variants: InventoryVariantRecord[];
  locations: InventoryLocationRecord[];
  balances: InventoryBalanceRecord[];
  errors: {
    sales: string | null;
    saleItems: string | null;
    salePayments: string | null;
    returns: string | null;
    returnItems: string | null;
    refunds: string | null;
    paymentMethods: string | null;
    catalog: string | null;
  };
}

export interface SalesCheckoutInput {
  locationId: string;
  items: Array<{
    variantId: string;
    quantity: number;
    discountAmount: number;
  }>;
  payments: Array<{
    paymentMethodId: string;
    amount: number;
    reference: string | null;
  }>;
  orderDiscountAmount: number;
  customerName: string | null;
  customerPhone: string | null;
  idempotencyKey: string;
}

export interface FollowUpPaymentInput {
  saleId: string;
  paymentMethodId: string;
  amount: number;
  reference: string | null;
  idempotencyKey: string;
}

export interface RecordReturnItemInput {
  saleItemId: string;
  quantity: number;
  restockQuantity: number;
  restockLocationId: string | null;
  conditionNotes: string | null;
}

export interface RecordReturnInput {
  saleId: string;
  reason: string;
  items: RecordReturnItemInput[];
  idempotencyKey: string;
}

export interface RecordRefundInput {
  saleId: string;
  refundSource: RefundSourceValue;
  returnId: string | null;
  paymentMethodId: string;
  amount: number;
  reason: string;
  reference: string | null;
  idempotencyKey: string;
}

export interface CancelSaleInput {
  saleId: string;
  reason: string;
  idempotencyKey: string;
}

export interface CreatePaymentMethodInput {
  name: string;
  methodCode: PaymentMethodCode;
  requiresReference: boolean;
}

export interface UpdatePaymentMethodInput {
  paymentMethodId: string;
  name: string;
  requiresReference: boolean;
  isActive: boolean;
}

export const PAYMENT_METHOD_CODE_OPTIONS: {
  value: PaymentMethodCode;
  label: string;
  defaultRequiresReference: boolean;
  description: string;
}[] = [
  {
    value: 'cash',
    label: 'Cash',
    defaultRequiresReference: false,
    description: 'Physical cash payments (reference optional).',
  },
  {
    value: 'bank_transfer',
    label: 'Bank Transfer',
    defaultRequiresReference: true,
    description: 'Bank transfer or wire settlement (reference required).',
  },
  {
    value: 'card_pos',
    label: 'Card / POS Terminal',
    defaultRequiresReference: false,
    description: 'Debit/credit card terminal transactions.',
  },
  {
    value: 'mobile_money',
    label: 'Mobile Money',
    defaultRequiresReference: false,
    description: 'Mobile wallet and instant transfer channels.',
  },
  {
    value: 'other',
    label: 'Other',
    defaultRequiresReference: false,
    description: 'Custom organization payment method.',
  },
];

export function canPerformPosSale(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager' || role === 'staff';
}

export function canApplySalesDiscounts(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function canCreateCreditSales(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function canManageReturnsAndCancellations(
  role: OrganisationRole | null | undefined
): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function canConfigurePaymentMethods(
  role: OrganisationRole | null | undefined
): boolean {
  return role === 'owner' || role === 'admin';
}

export function isPaymentReferenceRequired(method: PaymentMethodRecord | null | undefined): boolean {
  if (!method) return false;
  return method.requiresReference || method.methodCode === 'bank_transfer';
}

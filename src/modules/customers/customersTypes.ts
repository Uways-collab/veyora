import type { OrganisationRole } from '../../core/types/domain';

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CustomerMutationInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface CustomerSearchResult {
  customers: CustomerRecord[];
  hitLimit: boolean;
  error: string | null;
}

export interface CustomerMutationResult {
  customer: CustomerRecord | null;
  customerId: string | null;
  error: string | null;
}

export interface CustomerPurchaseSummary {
  totalPurchases: number;
  totalPurchaseValue: number;
  totalAmountPaid: number;
  outstandingCreditBalance: number;
  totalReturnedValue: number;
  totalRefundedValue: number;
}

export interface CustomerPurchasePaymentRecord {
  id: string;
  amount: number;
  reference: string | null;
  paymentSource: string | null;
  paidAt: string | null;
  paymentMethodName: string;
  paymentMethodCode: string;
}

export interface CustomerPurchaseReturnRecord {
  id: string;
  returnNumber: string;
  reason: string | null;
  subtotal: number;
  returnDiscountAmount: number;
  taxAmount: number;
  totalAmount: number;
  debtReducedAmount: number;
  refundedAmount: number;
  returnedAt: string | null;
}

export interface CustomerPurchaseRefundRecord {
  id: string;
  returnId: string | null;
  amount: number;
  refundSource: string | null;
  reference: string | null;
  reason: string | null;
  refundedAt: string | null;
  paymentMethodName: string;
  paymentMethodCode: string;
}

export interface CustomerPurchaseSaleRecord {
  id: string;
  saleNumber: string;
  status: 'completed' | 'cancelled' | string;
  paymentStatus: 'paid' | 'partial' | 'unpaid' | string;
  soldAt: string | null;
  currencyCode: string | null;
  totalAmount: number;
  paidAmount: number;
  returnedAmount: number;
  refundedAmount: number;
  outstandingBalance: number;
  payments: CustomerPurchasePaymentRecord[];
  returns: CustomerPurchaseReturnRecord[];
  refunds: CustomerPurchaseRefundRecord[];
}

export interface CustomerPurchaseHistoryResult {
  summary: CustomerPurchaseSummary;
  sales: CustomerPurchaseSaleRecord[];
  limit: number;
  hasMore: boolean;
  reachedMaxLimit: boolean;
  error: string | null;
}

export function canManageCustomers(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

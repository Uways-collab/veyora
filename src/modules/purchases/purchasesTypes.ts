import type { OrganisationRole } from '../../core/types/domain';
import type { SupplierRecord } from './suppliersTypes';

export type PurchaseStatusValue =
  | 'draft'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type PurchaseListFilterStatus = 'all' | PurchaseStatusValue;

export interface PurchaseItemRecord {
  id: string;
  purchaseId: string;
  productId: string | null;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseRecord {
  id: string;
  organizationId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  supplierInvoiceNumber: string | null;
  notes: string | null;
  status: PurchaseStatusValue;
  currencyCode: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  confirmedAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  items: PurchaseItemRecord[];
}

export interface PurchaseCatalogVariant {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  defaultCostPrice: number;
  productTypeValue: 'physical' | 'service';
  categoryName: string;
}

export interface PurchaseDraftLineInput {
  rowKey: string;
  variantId: string;
  orderedQuantity: string;
  unitCost: string;
}

export interface PurchaseDraftFormInput {
  supplierId: string;
  expectedDeliveryDate: string;
  supplierInvoiceNumber: string;
  discountAmount: string;
  taxAmount: string;
  notes: string;
  items: PurchaseDraftLineInput[];
}

export interface PurchaseReferenceData {
  activeSuppliers: SupplierRecord[];
  allSuppliersById: Record<string, SupplierRecord>;
  catalogVariants: PurchaseCatalogVariant[];
  catalogError: string | null;
  suppliersError: string | null;
}

export interface PurchaseListResult {
  purchases: PurchaseRecord[];
  error: string | null;
}

export interface PurchaseMutationResult {
  purchase: PurchaseRecord | null;
  purchaseId: string | null;
  error: string | null;
}

export function canManagePurchases(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

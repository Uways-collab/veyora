import type { OrganisationRole } from '../../core/types/domain';
import type {
  InventoryBalanceRecord,
  InventoryLocationRecord,
} from '../inventory/inventoryService';
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

export interface PurchaseReceiveLineInput {
  rowKey: string;
  purchaseItemId: string;
  locationId: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  damagedQuantity: string;
}

export interface PurchaseReceiveFormInput {
  notes: string;
  lines: PurchaseReceiveLineInput[];
}

export interface PurchaseReceiveRpcItem {
  purchase_item_id: string;
  location_id: string;
  received_quantity: number;
  accepted_quantity: number;
  damaged_quantity: number;
}

export interface PurchaseReceiptItemRecord {
  id: string;
  organizationId: string;
  receiptId: string;
  purchaseItemId: string;
  variantId: string;
  locationId: string;
  locationName: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  receivedQuantity: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  createdAt: string | null;
}

export interface PurchaseReceiptRecord {
  id: string;
  organizationId: string;
  purchaseId: string;
  receiptNumber: string;
  receivedAt: string | null;
  receivedBy: string | null;
  receivedByName: string;
  notes: string | null;
  createdAt: string | null;
  items: PurchaseReceiptItemRecord[];
  totalReceived: number;
  totalAccepted: number;
  totalDamaged: number;
}

export interface PurchaseStockUpdateSummary {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationId: string;
  locationName: string;
  acceptedQuantity: number;
  newStockQuantity: number | null;
}

export interface PurchaseReferenceData {
  activeSuppliers: SupplierRecord[];
  allSuppliersById: Record<string, SupplierRecord>;
  catalogVariants: PurchaseCatalogVariant[];
  activeLocations: InventoryLocationRecord[];
  locationsById: Record<string, InventoryLocationRecord>;
  inventoryBalances: InventoryBalanceRecord[];
  catalogError: string | null;
  locationsError: string | null;
  suppliersError: string | null;
}

export interface PurchaseListResult {
  purchases: PurchaseRecord[];
  error: string | null;
  itemsWarning?: string | null;
}

export interface PurchaseMutationResult {
  purchase: PurchaseRecord | null;
  purchaseId: string | null;
  error: string | null;
}

export interface PurchaseReceiveResult {
  receiptId: string | null;
  receiptNumber: string | null;
  receipt: PurchaseReceiptRecord | null;
  stockUpdates: PurchaseStockUpdateSummary[];
  error: string | null;
}

export interface PurchaseReceiptsListResult {
  receipts: PurchaseReceiptRecord[];
  error: string | null;
}

export function canManagePurchases(role: OrganisationRole | string | null | undefined): boolean {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return normalized === 'owner' || normalized === 'admin' || normalized === 'manager';
}

export function isPurchaseReceivableStatus(status: PurchaseStatusValue): boolean {
  return status === 'ordered' || status === 'partially_received';
}

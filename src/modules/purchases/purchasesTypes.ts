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
  defaultSellingPrice: number;
  barcode: string | null;
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

export type PurchaseReceiveErrorKind = 'ambiguous' | 'definite';

export interface PersistedPendingReceiveSubmission {
  version: 1;
  organizationId: string;
  purchaseId: string;
  idempotencyKey: string;
  payloadSignature: string;
  rpcItems: PurchaseReceiveRpcItem[];
  notes: string | null;
  lines: PurchaseReceiveLineInput[];
  unresolved: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseReceiveResult {
  receiptId: string | null;
  receiptNumber: string | null;
  receipt: PurchaseReceiptRecord | null;
  stockUpdates: PurchaseStockUpdateSummary[];
  error: string | null;
  errorKind?: PurchaseReceiveErrorKind | null;
  preRpcFailure?: boolean;
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

export type PurchaseReturnStatusValue = 'draft' | 'completed' | 'cancelled';

export type PurchaseReturnFilterStatus = 'all' | PurchaseReturnStatusValue;

export interface PurchaseReturnItemRecord {
  id: string;
  organizationId: string;
  returnId: string;
  purchaseItemId: string;
  variantId: string;
  locationId: string;
  locationName: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  createdAt: string | null;
}

export interface PurchaseReturnRecord {
  id: string;
  organizationId: string;
  purchaseId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  currencyCode: string;
  returnNumber: string;
  status: PurchaseReturnStatusValue;
  reason: string;
  supplierCreditReference: string | null;
  cancellationReason: string | null;
  totalAmount: number;
  returnDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
  createdByName: string;
  completedBy: string | null;
  completedByName: string | null;
  cancelledBy: string | null;
  cancelledByName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  items: PurchaseReturnItemRecord[];
}

export interface PurchaseReturnDraftLineInput {
  rowKey: string;
  purchaseItemId: string;
  locationId: string;
  quantity: string;
}

export interface PurchaseReturnDraftFormInput {
  reason: string;
  lines: PurchaseReturnDraftLineInput[];
}

export interface PurchaseReturnCreateRpcItem {
  purchase_item_id: string;
  variant_id: string;
  location_id: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface PurchaseReturnLocationBalance {
  locationId: string;
  locationName: string;
  locationIsActive: boolean;
  acceptedReceivedQuantity: number;
  completedReturnedQuantity: number;
  draftReservedQuantity: number;
  remainingReturnableQuantity: number;
  currentStockQuantity: number | null;
}

export interface PurchaseReturnItemAvailability {
  purchaseItemId: string;
  variantId: string;
  acceptedReceivedQuantity: number;
  physicallyReceivedQuantity: number;
  damagedQuantity: number;
  completedReturnedQuantity: number;
  draftReservedQuantity: number;
  remainingReturnableQuantity: number;
  byLocation: PurchaseReturnLocationBalance[];
}

export interface PurchaseReturnListResult {
  returns: PurchaseReturnRecord[];
  error: string | null;
  itemsWarning?: string | null;
}

export interface PurchaseReturnMutationResult {
  returnId: string | null;
  returnRecord: PurchaseReturnRecord | null;
  error: string | null;
}

export interface PurchaseReturnCompleteStockUpdate {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationId: string;
  locationName: string;
  returnedQuantity: number;
  newStockQuantity: number | null;
}

export interface PurchaseReturnCompleteResult {
  returnId: string | null;
  returnNumber: string | null;
  returnRecord: PurchaseReturnRecord | null;
  stockUpdates: PurchaseReturnCompleteStockUpdate[];
  error: string | null;
}

export function isPurchaseReturnEligibleStatus(status: PurchaseStatusValue): boolean {
  return status === 'partially_received' || status === 'received';
}


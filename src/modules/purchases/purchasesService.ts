import { getSupabaseClient } from '../../core/supabase/client';
import { fetchOrganisationMembers } from '../../core/supabase/organisations';
import {
  fetchInventoryOverview,
  formatUnitOfMeasureLabel,
  verifyActiveWorkspaceContext,
  type InventoryLocationRecord,
} from '../inventory/inventoryService';
import { generateIdempotencyKey } from '../sales/salesFormatters';
import { searchSuppliers } from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';
import {
  isPurchaseReceivableStatus,
  type PersistedPendingReceiveSubmission,
  type PurchaseCatalogVariant,
  type PurchaseDraftFormInput,
  type PurchaseItemRecord,
  type PurchaseListResult,
  type PurchaseMutationResult,
  type PurchaseReceiptItemRecord,
  type PurchaseReceiptRecord,
  type PurchaseReceiptsListResult,
  type PurchaseReceiveErrorKind,
  type PurchaseReceiveFormInput,
  type PurchaseReceiveResult,
  type PurchaseReceiveRpcItem,
  type PurchaseRecord,
  type PurchaseReferenceData,
  type PurchaseStatusValue,
  type PurchaseStockUpdateSummary,
} from './purchasesTypes';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FOUR_DECIMAL_SCALE = 10000;

export function roundFourDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * FOUR_DECIMAL_SCALE) / FOUR_DECIMAL_SCALE;
}

export function hasMoreThanFourDecimals(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) return false;
  const decimals = trimmed.slice(dotIndex + 1);
  return decimals.length > 4;
}

export function formatPurchaseMoney(amount: number, currencyCode = 'USD'): string {
  const safeAmount = roundFourDecimals(Number.isFinite(amount) ? amount : 0);
  const code = (currencyCode || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(safeAmount);
  } catch {
    return `${code} ${safeAmount.toFixed(4)}`;
  }
}

export function formatPurchaseNumberPrecision(value: number): string {
  const safe = roundFourDecimals(Number.isFinite(value) ? value : 0);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(safe);
}

export function formatPurchaseStatusLabel(status: PurchaseStatusValue): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'ordered':
      return 'Ordered';
    case 'partially_received':
      return 'Partially Received';
    case 'received':
      return 'Received';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function formatPurchaseDate(
  value: string | null | undefined,
  timeZone?: string | null
): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';

  if (ISO_DATE_PATTERN.test(trimmed)) {
    const [yearStr, monthStr, dayStr] = trimmed.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(utcDate);
    } catch {
      return trimmed;
    }
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return trimmed;
  const tz = (timeZone ?? '').trim() || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(parsed));
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(parsed));
  }
}

export function formatPurchaseDateTime(
  value: string | null | undefined,
  timeZone?: string | null
): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (ISO_DATE_PATTERN.test(trimmed)) {
    return formatPurchaseDate(trimmed, timeZone);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return trimmed;
  const tz = (timeZone ?? '').trim() || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(parsed));
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(parsed));
  }
}

export function getTodayDateInputInTimeZone(timeZone?: string | null): string {
  const tz = (timeZone ?? '').trim() || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function readString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const val of values) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function normalizePurchaseStatus(raw: unknown): PurchaseStatusValue {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'draft') return 'draft';
  if (value === 'ordered' || value === 'confirmed') return 'ordered';
  if (value === 'partially_received' || value === 'partial_received' || value === 'partial') {
    return 'partially_received';
  }
  if (value === 'received' || value === 'completed') return 'received';
  if (value === 'cancelled' || value === 'canceled' || value === 'void') return 'cancelled';
  return 'draft';
}

function isMissingRelationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  const lower = (error.message ?? '').toLowerCase();
  return (
    lower.includes('could not find the table') ||
    (lower.includes('relation') && lower.includes('does not exist'))
  );
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const lower = (error.message ?? '').toLowerCase();
  return lower.includes('column') && lower.includes('does not exist');
}

function isPermissionDeniedError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42501') return true;
  const lower = (error.message ?? '').toLowerCase();
  return (
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('row-level security') ||
    lower.includes('policy')
  );
}

function isMissingRpcSignatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const lower = (error.message ?? '').toLowerCase();
  return (
    lower.includes('could not find the function') ||
    lower.includes('schema cache') ||
    (lower.includes('function') && lower.includes('does not exist'))
  );
}

export function formatPurchaseReadError(
  rawMessage: string | undefined | null,
  fallback: string
): string {
  const msg = (rawMessage ?? '').trim();
  if (!msg) return fallback;
  return msg;
}

export function formatPurchaseRpcError(
  rawMessage: string | undefined | null,
  fallback: string
): string {
  const msg = (rawMessage ?? '').trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();

  if (
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('row-level security') ||
    lower.includes('policy')
  ) {
    return 'Permission denied. Only Owners, Admins, and Managers can create, edit, confirm, or receive purchase orders in the active organization.';
  }

  return msg;
}

function extractPurchaseListRowsFromRpc(data: unknown): Record<string, unknown>[] {
  let parsed = data;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row)
    );
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const nested = obj.purchases ?? obj.orders ?? obj.items ?? obj.rows ?? obj.data ?? obj.results;
    if (Array.isArray(nested)) {
      return nested.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object' && !Array.isArray(row)
      );
    }
  }
  return [];
}

function normalizePurchaseItemRecord(
  rawItem: Record<string, unknown>,
  fallbackPurchaseId: string,
  index: number,
  variantLookup: Map<string, PurchaseCatalogVariant>,
  orgId: string
): PurchaseItemRecord | null {
  const itemOrg = readString(rawItem.organization_id, rawItem.organisation_id);
  if (itemOrg && itemOrg.toLowerCase() !== orgId.toLowerCase()) return null;

  const purchaseId =
    readString(rawItem.purchase_id, rawItem.purchase_order_id) ?? fallbackPurchaseId;
  const variantId = readString(rawItem.variant_id, rawItem.product_variant_id);
  if (!purchaseId || !variantId) return null;

  const id =
    readString(rawItem.id, rawItem.purchase_item_id) ?? `${purchaseId}-${index}`;
  const catalogVariant = variantLookup.get(variantId);
  const orderedQuantity = roundFourDecimals(
    readNumber(rawItem.ordered_quantity, rawItem.quantity) ?? 0
  );
  const receivedQuantity = roundFourDecimals(
    readNumber(rawItem.received_quantity, rawItem.qty_received) ?? 0
  );
  const unitCost = roundFourDecimals(
    readNumber(rawItem.unit_cost, rawItem.cost_price, catalogVariant?.defaultCostPrice) ?? 0
  );
  const lineTotal = roundFourDecimals(
    readNumber(rawItem.line_total, rawItem.subtotal) ?? orderedQuantity * unitCost
  );

  return {
    id,
    purchaseId,
    productId: readString(rawItem.product_id) ?? catalogVariant?.productId ?? null,
    variantId,
    productName:
      readString(rawItem.product_name, rawItem.product_name_snapshot) ??
      catalogVariant?.productName ??
      'Product',
    variantName:
      readString(rawItem.variant_name, rawItem.variant_name_snapshot) ??
      catalogVariant?.variantName ??
      'Variant',
    sku: readString(rawItem.sku, rawItem.sku_snapshot) ?? catalogVariant?.sku ?? '—',
    unitOfMeasure: formatUnitOfMeasureLabel(
      readString(rawItem.unit_of_measure, rawItem.unit_of_measure_snapshot) ??
        catalogVariant?.unitOfMeasure ??
        'unit'
    ),
    orderedQuantity,
    receivedQuantity,
    unitCost,
    lineTotal,
  };
}

function extractPurchaseIdentifier(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) {
    const trimmed = data.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return extractPurchaseIdentifier(parsed);
    } catch {
      return trimmed;
    }
  }
  const target = Array.isArray(data) ? data[0] : data;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const obj = target as Record<string, unknown>;
    const nested =
      (obj.purchase as Record<string, unknown> | undefined) ??
      (obj.purchase_order as Record<string, unknown> | undefined) ??
      (obj.purchases_v1_create_draft as Record<string, unknown> | undefined) ??
      (obj.purchases_v1_update_draft as Record<string, unknown> | undefined) ??
      (obj.purchases_v1_confirm_order as Record<string, unknown> | undefined) ??
      obj;
    return readString(nested.id, nested.purchase_id, nested.purchase_order_id, obj.purchase_id, obj.id);
  }
  return null;
}

export async function fetchPurchaseReferenceData(
  organisationId: string
): Promise<PurchaseReferenceData> {
  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return {
      activeSuppliers: [],
      allSuppliersById: {},
      catalogVariants: [],
      activeLocations: [],
      locationsById: {},
      inventoryBalances: [],
      catalogError: verified.error,
      locationsError: verified.error,
      suppliersError: verified.error,
    };
  }

  const orgId = verified.organizationId;

  const [activeSuppliersRes, allSuppliersRes, inventoryRes] = await Promise.all([
    searchSuppliers(orgId, { isActive: true, limit: 100 }),
    searchSuppliers(orgId, { isActive: null, limit: 100 }),
    fetchInventoryOverview(orgId),
  ]);

  const allSuppliersById: Record<string, SupplierRecord> = {};
  for (const s of allSuppliersRes.suppliers) {
    allSuppliersById[s.id] = s;
  }
  for (const s of activeSuppliersRes.suppliers) {
    allSuppliersById[s.id] = s;
  }

  const productById = new Map(inventoryRes.products.map((p) => [p.id, p]));
  const catalogVariants: PurchaseCatalogVariant[] = [];

  for (const variant of inventoryRes.variants) {
    if (!variant.isActive) continue;
    const product = productById.get(variant.productId);
    if (!product || !product.isActive) continue;

    catalogVariants.push({
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      variantName: variant.variantName,
      sku: variant.sku,
      unitOfMeasure: formatUnitOfMeasureLabel(variant.unitOfMeasure),
      defaultCostPrice: roundFourDecimals(variant.costPrice),
      productTypeValue: product.productTypeValue,
      categoryName: product.categoryName,
    });
  }

  catalogVariants.sort(
    (a, b) =>
      a.productName.localeCompare(b.productName) ||
      a.variantName.localeCompare(b.variantName)
  );

  const locationsById: Record<string, InventoryLocationRecord> = {};
  const activeLocations: InventoryLocationRecord[] = [];
  for (const loc of inventoryRes.locations) {
    locationsById[loc.id] = loc;
    if (loc.isActive) {
      activeLocations.push(loc);
    }
  }
  activeLocations.sort((a, b) => a.name.localeCompare(b.name));

  const catalogError =
    inventoryRes.errors.products ?? inventoryRes.errors.variants ?? null;

  return {
    activeSuppliers: activeSuppliersRes.suppliers,
    allSuppliersById,
    catalogVariants,
    activeLocations,
    locationsById,
    inventoryBalances: inventoryRes.balances,
    catalogError,
    locationsError: inventoryRes.errors.locations ?? null,
    suppliersError: activeSuppliersRes.error ?? allSuppliersRes.error ?? null,
  };
}

export async function fetchPurchasesList(
  organisationId: string,
  options: {
    defaultCurrency?: string;
    suppliersById?: Record<string, SupplierRecord>;
    catalogVariants?: PurchaseCatalogVariant[];
  } = {}
): Promise<PurchaseListResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { purchases: [], error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { purchases: [], error: verified.error };
  }

  const orgId = verified.organizationId;
  const fallbackCurrency = (options.defaultCurrency || 'USD').trim().toUpperCase();

  const headerTables = ['purchases', 'purchase_orders'] as const;
  let purchaseRows: Record<string, unknown>[] = [];
  let headerError: { code?: string; message?: string } | null = null;
  let loadedHeaders = false;

  for (const table of headerTables) {
    const res = await supabase
      .from(table)
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (!res.error) {
      purchaseRows = (res.data ?? []).filter((row) => {
        const rowOrg = readString(row.organization_id, row.organisation_id);
        return !rowOrg || rowOrg.toLowerCase() === orgId.toLowerCase();
      });
      headerError = null;
      loadedHeaders = true;
      break;
    }

    if (!headerError) {
      headerError = res.error;
    }

    if (!isMissingRelationError(res.error) && !isPermissionDeniedError(res.error)) {
      headerError = res.error;
      break;
    }
  }

  // Fallback to SECURITY DEFINER read RPCs only if direct RLS SELECT failed with missing table or permission denied
  if (!loadedHeaders && headerError && (isMissingRelationError(headerError) || isPermissionDeniedError(headerError))) {
    const readRpcNames = [
      'purchases_v1_list',
      'purchases_v1_list_purchases',
      'purchases_v1_list_orders',
      'purchases_v1_search',
      'purchases_v1_search_purchases',
      'purchases_v1_get_purchases',
      'purchases_v1_get_orders',
    ] as const;

    for (const rpcName of readRpcNames) {
      const rpcRes = await supabase.rpc(rpcName, { p_organization_id: orgId });
      if (!rpcRes.error) {
        purchaseRows = extractPurchaseListRowsFromRpc(rpcRes.data).filter((row) => {
          const rowOrg = readString(row.organization_id, row.organisation_id);
          return !rowOrg || rowOrg.toLowerCase() === orgId.toLowerCase();
        });
        headerError = null;
        loadedHeaders = true;
        break;
      }
      if (!isMissingRpcSignatureError(rpcRes.error) && !isPermissionDeniedError(rpcRes.error)) {
        break;
      }
    }
  }

  if (!loadedHeaders && headerError) {
    return {
      purchases: [],
      error: formatPurchaseReadError(headerError.message, 'Unable to load purchase orders.'),
    };
  }

  if (purchaseRows.length === 0) {
    return { purchases: [], error: null };
  }

  const variantLookup = new Map(
    (options.catalogVariants ?? []).map((v) => [v.variantId, v])
  );
  const supplierLookup = options.suppliersById ?? {};
  const itemsByPurchaseId = new Map<string, PurchaseItemRecord[]>();

  // Check if rows already include inline line items (e.g., from an RPC)
  let hasInlineItems = false;
  for (const row of purchaseRows) {
    const purchaseId = readString(row.id, row.purchase_id);
    if (!purchaseId) continue;
    const inlineRaw = row.items ?? row.purchase_items ?? row.lines;
    if (Array.isArray(inlineRaw)) {
      hasInlineItems = true;
      const mapped = inlineRaw
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        )
        .map((item, idx) =>
          normalizePurchaseItemRecord(item, purchaseId, idx, variantLookup, orgId)
        )
        .filter((item): item is PurchaseItemRecord => Boolean(item));
      itemsByPurchaseId.set(purchaseId, mapped);
    }
  }

  let itemsWarning: string | null = null;

  if (!hasInlineItems) {
    const purchaseIds = purchaseRows
      .map((row) => readString(row.id, row.purchase_id))
      .filter((id): id is string => Boolean(id));

    const itemTables = ['purchase_items', 'purchase_order_items', 'purchase_order_lines'] as const;
    let rawItemRows: Record<string, unknown>[] = [];
    let itemError: { code?: string; message?: string } | null = null;
    let loadedItems = false;

    for (const table of itemTables) {
      const res = await supabase
        .from(table)
        .select('*')
        .eq('organization_id', orgId);

      if (!res.error) {
        rawItemRows = (res.data ?? []) as Record<string, unknown>[];
        itemError = null;
        loadedItems = true;
        break;
      }

      if (isMissingColumnError(res.error) && purchaseIds.length > 0) {
        for (const fkCol of ['purchase_id', 'purchase_order_id'] as const) {
          const fkRes = await supabase.from(table).select('*').in(fkCol, purchaseIds);
          if (!fkRes.error) {
            rawItemRows = (fkRes.data ?? []) as Record<string, unknown>[];
            itemError = null;
            loadedItems = true;
            break;
          }
          if (!isMissingColumnError(fkRes.error)) {
            if (!itemError) itemError = fkRes.error;
            break;
          }
        }
        if (loadedItems) break;
      }

      if (!itemError) {
        itemError = res.error;
      }

      if (!isMissingRelationError(res.error) && !isPermissionDeniedError(res.error)) {
        itemError = res.error;
        break;
      }
    }

    if (!loadedItems && itemError) {
      itemsWarning = formatPurchaseReadError(
        itemError.message,
        'Purchase line items could not be loaded.'
      );
    } else {
      rawItemRows.forEach((rawItem, idx) => {
        const purchaseId = readString(rawItem.purchase_id, rawItem.purchase_order_id);
        if (!purchaseId) return;
        const normalized = normalizePurchaseItemRecord(
          rawItem,
          purchaseId,
          idx,
          variantLookup,
          orgId
        );
        if (!normalized) return;
        const existing = itemsByPurchaseId.get(purchaseId) ?? [];
        existing.push(normalized);
        itemsByPurchaseId.set(purchaseId, existing);
      });
    }
  }

  const purchases: PurchaseRecord[] = purchaseRows
    .map((row) => {
      const id = readString(row.id, row.purchase_id);
      if (!id) return null;

      const supplierId = readString(row.supplier_id) ?? '';
      const supplierRecord = supplierId ? supplierLookup[supplierId] : undefined;
      const items = itemsByPurchaseId.get(id) ?? [];

      const computedSubtotal = roundFourDecimals(
        items.reduce((sum, item) => sum + item.lineTotal, 0)
      );
      const subtotal = roundFourDecimals(
        readNumber(row.subtotal, row.subtotal_amount) ?? computedSubtotal
      );
      const discountAmount = roundFourDecimals(
        readNumber(row.discount_amount, row.discount) ?? 0
      );
      const taxAmount = roundFourDecimals(readNumber(row.tax_amount, row.tax) ?? 0);
      const totalAmount = roundFourDecimals(
        readNumber(row.total_amount, row.grand_total) ??
          Math.max(0, subtotal - discountAmount + taxAmount)
      );

      const status = normalizePurchaseStatus(row.status);
      const orderDate = readString(
        row.order_date,
        row.ordered_at,
        row.purchase_date,
        row.confirmed_at,
        row.created_at
      );

      return {
        id,
        organizationId: orgId,
        purchaseNumber:
          readString(row.purchase_number, row.po_number, row.order_number) ??
          `PO-${id.slice(0, 8).toUpperCase()}`,
        supplierId,
        supplierName:
          readString(row.supplier_name, row.supplier_name_snapshot) ??
          supplierRecord?.name ??
          'Unknown Supplier',
        orderDate,
        expectedDeliveryDate: readString(row.expected_delivery_date, row.expected_date),
        supplierInvoiceNumber: readString(row.supplier_invoice_number, row.invoice_number),
        notes: readString(row.notes),
        status,
        currencyCode: (readString(row.currency, row.currency_code) ?? fallbackCurrency).toUpperCase(),
        subtotal,
        discountAmount,
        taxAmount,
        totalAmount,
        confirmedAt: readString(row.confirmed_at, row.ordered_at),
        createdBy: readString(row.created_by),
        createdAt: readString(row.created_at),
        updatedAt: readString(row.updated_at),
        items,
      };
    })
    .filter((record): record is PurchaseRecord => Boolean(record));

  return { purchases, error: null, itemsWarning };
}

export interface ValidatedPurchaseDraftPayload {
  supplierId: string;
  expectedDeliveryDate: string | null;
  supplierInvoiceNumber: string | null;
  discountAmount: number;
  taxAmount: number;
  notes: string | null;
  items: Array<{
    variantId: string;
    orderedQuantity: number;
    unitCost: number;
    lineTotal: number;
  }>;
  subtotal: number;
  grandTotal: number;
}

export function validatePurchaseDraftInput(
  input: PurchaseDraftFormInput,
  options: {
    activeSupplierIds?: Set<string>;
    activeVariantIds?: Set<string>;
  } = {}
):
  | { ok: true; normalized: ValidatedPurchaseDraftPayload }
  | { ok: false; error: string } {
  const supplierId = input.supplierId.trim();
  if (!supplierId) {
    return { ok: false, error: 'Select an active supplier for this purchase order.' };
  }
  if (
    options.activeSupplierIds &&
    options.activeSupplierIds.size > 0 &&
    !options.activeSupplierIds.has(supplierId)
  ) {
    return {
      ok: false,
      error: 'The selected supplier is not active. Choose an active supplier or restore it first.',
    };
  }

  const expectedDeliveryDate = input.expectedDeliveryDate.trim() || null;
  if (expectedDeliveryDate && !ISO_DATE_PATTERN.test(expectedDeliveryDate)) {
    return { ok: false, error: 'Expected delivery date must be a valid YYYY-MM-DD date.' };
  }

  const supplierInvoiceNumber = input.supplierInvoiceNumber.trim() || null;
  if (supplierInvoiceNumber && supplierInvoiceNumber.length > 100) {
    return {
      ok: false,
      error: 'Supplier invoice number must be 100 characters or fewer.',
    };
  }

  const notes = input.notes.trim() || null;
  if (notes && notes.length > 1000) {
    return { ok: false, error: 'Notes must be 1,000 characters or fewer.' };
  }

  if (!input.items || input.items.length === 0) {
    return { ok: false, error: 'Add at least one purchase item before saving.' };
  }

  const seenVariantIds = new Set<string>();
  const normalizedItems: ValidatedPurchaseDraftPayload['items'] = [];

  for (let i = 0; i < input.items.length; i += 1) {
    const row = input.items[i];
    const rowLabel = `Item #${i + 1}`;
    const variantId = row.variantId.trim();
    if (!variantId) {
      return { ok: false, error: `${rowLabel}: select an active product variant.` };
    }
    if (
      options.activeVariantIds &&
      options.activeVariantIds.size > 0 &&
      !options.activeVariantIds.has(variantId)
    ) {
      return {
        ok: false,
        error: `${rowLabel}: selected product variant is inactive or unavailable.`,
      };
    }
    if (seenVariantIds.has(variantId)) {
      return {
        ok: false,
        error: `${rowLabel}: duplicate product variant selected. Adjust the quantity on the existing line instead.`,
      };
    }
    seenVariantIds.add(variantId);

    const qtyRaw = row.orderedQuantity.trim();
    if (!qtyRaw) {
      return { ok: false, error: `${rowLabel}: ordered quantity is required.` };
    }
    if (hasMoreThanFourDecimals(qtyRaw)) {
      return {
        ok: false,
        error: `${rowLabel}: ordered quantity supports up to 4 decimal places.`,
      };
    }
    const qtyNum = Number(qtyRaw);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      return {
        ok: false,
        error: `${rowLabel}: ordered quantity must be greater than 0.`,
      };
    }

    const costRaw = row.unitCost.trim();
    if (!costRaw) {
      return { ok: false, error: `${rowLabel}: unit cost is required.` };
    }
    if (hasMoreThanFourDecimals(costRaw)) {
      return {
        ok: false,
        error: `${rowLabel}: unit cost supports up to 4 decimal places.`,
      };
    }
    const costNum = Number(costRaw);
    if (!Number.isFinite(costNum) || costNum < 0) {
      return {
        ok: false,
        error: `${rowLabel}: unit cost cannot be negative.`,
      };
    }

    const orderedQuantity = roundFourDecimals(qtyNum);
    const unitCost = roundFourDecimals(costNum);
    const lineTotal = roundFourDecimals(orderedQuantity * unitCost);

    normalizedItems.push({
      variantId,
      orderedQuantity,
      unitCost,
      lineTotal,
    });
  }

  const subtotal = roundFourDecimals(
    normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0)
  );

  const discountRaw = input.discountAmount.trim();
  if (discountRaw && hasMoreThanFourDecimals(discountRaw)) {
    return { ok: false, error: 'Discount amount supports up to 4 decimal places.' };
  }
  const parsedDiscount = discountRaw === '' ? 0 : Number(discountRaw);
  if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0) {
    return { ok: false, error: 'Discount amount must be 0 or greater.' };
  }
  const discountAmount = roundFourDecimals(parsedDiscount);
  if (discountAmount > subtotal) {
    return {
      ok: false,
      error: 'Discount amount cannot exceed the items subtotal.',
    };
  }

  const taxRaw = input.taxAmount.trim();
  if (taxRaw && hasMoreThanFourDecimals(taxRaw)) {
    return { ok: false, error: 'Tax amount supports up to 4 decimal places.' };
  }
  const parsedTax = taxRaw === '' ? 0 : Number(taxRaw);
  if (!Number.isFinite(parsedTax) || parsedTax < 0) {
    return { ok: false, error: 'Tax amount must be 0 or greater.' };
  }
  const taxAmount = roundFourDecimals(parsedTax);

  const grandTotal = roundFourDecimals(subtotal - discountAmount + taxAmount);

  return {
    ok: true,
    normalized: {
      supplierId,
      expectedDeliveryDate,
      supplierInvoiceNumber,
      discountAmount,
      taxAmount,
      notes,
      items: normalizedItems,
      subtotal,
      grandTotal,
    },
  };
}

function buildRpcItemsPayload(items: ValidatedPurchaseDraftPayload['items']) {
  return items.map((item) => ({
    variant_id: item.variantId,
    quantity: item.orderedQuantity,
    ordered_quantity: item.orderedQuantity,
    unit_cost: item.unitCost,
  }));
}

export async function createPurchaseDraft(
  organisationId: string,
  input: PurchaseDraftFormInput,
  options: {
    activeSupplierIds?: Set<string>;
    activeVariantIds?: Set<string>;
    timeZone?: string | null;
    idempotencyKey?: string;
  } = {}
): Promise<PurchaseMutationResult> {
  const validation = validatePurchaseDraftInput(input, options);
  if (!validation.ok) {
    return { purchase: null, purchaseId: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { purchase: null, purchaseId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { purchase: null, purchaseId: null, error: verified.error };
  }

  const n = validation.normalized;
  const rpcItems = buildRpcItemsPayload(n.items);
  const idempotencyKey = options.idempotencyKey ?? generateIdempotencyKey();
  const todayDate = getTodayDateInputInTimeZone(options.timeZone);

  const candidates = [
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: n.supplierId,
      p_items: rpcItems,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_notes: n.notes,
      p_idempotency_key: idempotencyKey,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: n.supplierId,
      p_items: rpcItems,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: n.supplierId,
      p_order_date: todayDate,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_notes: n.notes,
      p_items: rpcItems,
      p_idempotency_key: idempotencyKey,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: n.supplierId,
      p_order_date: todayDate,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_notes: n.notes,
      p_items: rpcItems,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: n.supplierId,
      p_items: rpcItems,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_invoice_number: n.supplierInvoiceNumber,
      p_expected_date: n.expectedDeliveryDate,
      p_notes: n.notes,
    },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_create_draft', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      purchase: null,
      purchaseId: null,
      error: formatPurchaseRpcError(error.message, 'Unable to create purchase draft.'),
    };
  }

  return {
    purchase: null,
    purchaseId: extractPurchaseIdentifier(data),
    error: null,
  };
}

export async function updatePurchaseDraft(
  organisationId: string,
  purchaseId: string,
  currentStatus: PurchaseStatusValue,
  input: PurchaseDraftFormInput,
  options: {
    activeSupplierIds?: Set<string>;
    activeVariantIds?: Set<string>;
    orderDate?: string | null;
    timeZone?: string | null;
  } = {}
): Promise<PurchaseMutationResult> {
  if (!purchaseId || !purchaseId.trim()) {
    return { purchase: null, purchaseId: null, error: 'Purchase ID is required.' };
  }
  if (currentStatus !== 'draft') {
    return {
      purchase: null,
      purchaseId: null,
      error: 'Confirmed, partially received, received, or cancelled purchase orders cannot be edited.',
    };
  }

  const validation = validatePurchaseDraftInput(input, options);
  if (!validation.ok) {
    return { purchase: null, purchaseId: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { purchase: null, purchaseId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { purchase: null, purchaseId: null, error: verified.error };
  }

  const cleanId = purchaseId.trim();
  const n = validation.normalized;
  const rpcItems = buildRpcItemsPayload(n.items);
  const orderDateValue = options.orderDate?.trim() || getTodayDateInputInTimeZone(options.timeZone);

  const candidates = [
    {
      p_organization_id: verified.organizationId,
      p_purchase_id: cleanId,
      p_supplier_id: n.supplierId,
      p_items: rpcItems,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_purchase_id: cleanId,
      p_supplier_id: n.supplierId,
      p_order_date: orderDateValue,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_notes: n.notes,
      p_items: rpcItems,
    },
    {
      p_organization_id: verified.organizationId,
      p_purchase_order_id: cleanId,
      p_supplier_id: n.supplierId,
      p_items: rpcItems,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_supplier_invoice_number: n.supplierInvoiceNumber,
      p_expected_delivery_date: n.expectedDeliveryDate,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_purchase_id: cleanId,
      p_supplier_id: n.supplierId,
      p_items: rpcItems,
      p_discount_amount: n.discountAmount,
      p_tax_amount: n.taxAmount,
      p_invoice_number: n.supplierInvoiceNumber,
      p_expected_date: n.expectedDeliveryDate,
      p_notes: n.notes,
    },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_update_draft', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      purchase: null,
      purchaseId: null,
      error: formatPurchaseRpcError(error.message, 'Unable to update purchase draft.'),
    };
  }

  return {
    purchase: null,
    purchaseId: extractPurchaseIdentifier(data) ?? cleanId,
    error: null,
  };
}

export async function confirmPurchaseOrder(
  organisationId: string,
  purchaseId: string,
  currentStatus: PurchaseStatusValue,
  idempotencyKey?: string
): Promise<PurchaseMutationResult> {
  if (!purchaseId || !purchaseId.trim()) {
    return { purchase: null, purchaseId: null, error: 'Purchase ID is required.' };
  }
  if (currentStatus !== 'draft') {
    return {
      purchase: null,
      purchaseId: null,
      error: 'Only draft purchases can be confirmed into a purchase order.',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { purchase: null, purchaseId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { purchase: null, purchaseId: null, error: verified.error };
  }

  const cleanId = purchaseId.trim();
  const key = idempotencyKey ?? generateIdempotencyKey();

  const candidates = [
    {
      p_organization_id: verified.organizationId,
      p_purchase_id: cleanId,
      p_idempotency_key: key,
    },
    {
      p_organization_id: verified.organizationId,
      p_purchase_id: cleanId,
    },
    {
      p_organization_id: verified.organizationId,
      p_purchase_order_id: cleanId,
      p_idempotency_key: key,
    },
    {
      p_organization_id: verified.organizationId,
      p_purchase_order_id: cleanId,
    },
    {
      p_organization_id: verified.organizationId,
      p_id: cleanId,
    },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_confirm_order', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      purchase: null,
      purchaseId: null,
      error: formatPurchaseRpcError(error.message, 'Unable to confirm purchase order.'),
    };
  }

  return {
    purchase: null,
    purchaseId: extractPurchaseIdentifier(data) ?? cleanId,
    error: null,
  };
}

export interface ValidatedPurchaseReceivePayload {
  notes: string | null;
  rpcItems: PurchaseReceiveRpcItem[];
  totalReceived: number;
  totalAccepted: number;
  totalDamaged: number;
  distinctPurchaseItemCount: number;
  selectedLocationIds: string[];
}

export function validatePurchaseReceiveInput(
  purchaseItems: PurchaseItemRecord[],
  input: PurchaseReceiveFormInput,
  options: {
    activeLocationIds?: Set<string>;
  } = {}
):
  | { ok: true; normalized: ValidatedPurchaseReceivePayload }
  | { ok: false; error: string } {
  const notes = input.notes.trim() || null;
  if (notes && notes.length > 1000) {
    return { ok: false, error: 'Receiving notes must be 1,000 characters or fewer.' };
  }

  const itemById = new Map(purchaseItems.map((item) => [item.id, item]));
  const accumulatedByItemId = new Map<string, number>();
  const seenItemLocationPairs = new Set<string>();
  const selectedLocationIds = new Set<string>();
  const distinctPurchaseItemIds = new Set<string>();
  const rpcItems: PurchaseReceiveRpcItem[] = [];

  let totalReceived = 0;
  let totalAccepted = 0;
  let totalDamaged = 0;

  for (const line of input.lines) {
    const item = itemById.get(line.purchaseItemId);
    if (!item) {
      return { ok: false, error: 'A selected purchase item could not be found on this order.' };
    }

    const itemLabel = `${item.productName} (${item.variantName})`;
    const receivedRaw = line.receivedQuantity.trim();
    const acceptedRaw = line.acceptedQuantity.trim();
    const damagedRaw = line.damagedQuantity.trim();

    if (receivedRaw && hasMoreThanFourDecimals(receivedRaw)) {
      return {
        ok: false,
        error: `${itemLabel}: physically received quantity supports up to 4 decimal places.`,
      };
    }
    if (acceptedRaw && hasMoreThanFourDecimals(acceptedRaw)) {
      return {
        ok: false,
        error: `${itemLabel}: accepted quantity supports up to 4 decimal places.`,
      };
    }
    if (damagedRaw && hasMoreThanFourDecimals(damagedRaw)) {
      return {
        ok: false,
        error: `${itemLabel}: damaged quantity supports up to 4 decimal places.`,
      };
    }

    const parsedReceived = receivedRaw === '' ? 0 : Number(receivedRaw);
    const parsedAccepted = acceptedRaw === '' ? 0 : Number(acceptedRaw);
    const parsedDamaged = damagedRaw === '' ? 0 : Number(damagedRaw);

    if (!Number.isFinite(parsedReceived) || parsedReceived < 0) {
      return {
        ok: false,
        error: `${itemLabel}: physically received quantity must be 0 or greater.`,
      };
    }
    if (!Number.isFinite(parsedAccepted) || parsedAccepted < 0) {
      return {
        ok: false,
        error: `${itemLabel}: accepted quantity cannot be negative.`,
      };
    }
    if (!Number.isFinite(parsedDamaged) || parsedDamaged < 0) {
      return {
        ok: false,
        error: `${itemLabel}: damaged quantity cannot be negative.`,
      };
    }

    const receivedQty = roundFourDecimals(parsedReceived);
    const acceptedQty = roundFourDecimals(parsedAccepted);
    const damagedQty = roundFourDecimals(parsedDamaged);

    // Ignore untouched zero-received rows unless accepted/damaged has a positive number
    if (receivedQty === 0) {
      if (acceptedQty > 0 || damagedQty > 0) {
        return {
          ok: false,
          error: `${itemLabel}: physically received quantity must be greater than 0 when accepted or damaged units are entered.`,
        };
      }
      continue;
    }

    const locationId = line.locationId.trim();
    if (!locationId) {
      return {
        ok: false,
        error: `${itemLabel}: select an active receiving inventory location.`,
      };
    }
    if (
      options.activeLocationIds &&
      options.activeLocationIds.size > 0 &&
      !options.activeLocationIds.has(locationId)
    ) {
      return {
        ok: false,
        error: `${itemLabel}: the selected receiving location is inactive or unavailable.`,
      };
    }

    const pairKey = `${item.id}:${locationId}`;
    if (seenItemLocationPairs.has(pairKey)) {
      return {
        ok: false,
        error: `${itemLabel}: combine quantities going to the same receiving location onto a single row.`,
      };
    }
    seenItemLocationPairs.add(pairKey);

    const accountedSum = roundFourDecimals(acceptedQty + damagedQty);
    if (accountedSum !== receivedQty) {
      return {
        ok: false,
        error: `${itemLabel}: accepted (${formatPurchaseNumberPrecision(acceptedQty)}) plus damaged (${formatPurchaseNumberPrecision(damagedQty)}) must equal physically received (${formatPurchaseNumberPrecision(receivedQty)}).`,
      };
    }

    const prevAccumulated = accumulatedByItemId.get(item.id) ?? 0;
    const nextAccumulated = roundFourDecimals(prevAccumulated + receivedQty);
    accumulatedByItemId.set(item.id, nextAccumulated);

    const remainingQty = Math.max(
      0,
      roundFourDecimals(item.orderedQuantity - item.receivedQuantity)
    );
    if (nextAccumulated > remainingQty) {
      return {
        ok: false,
        error: `${itemLabel}: total receiving quantity (${formatPurchaseNumberPrecision(nextAccumulated)}) exceeds remaining quantity (${formatPurchaseNumberPrecision(remainingQty)}).`,
      };
    }

    distinctPurchaseItemIds.add(item.id);
    selectedLocationIds.add(locationId);
    totalReceived = roundFourDecimals(totalReceived + receivedQty);
    totalAccepted = roundFourDecimals(totalAccepted + acceptedQty);
    totalDamaged = roundFourDecimals(totalDamaged + damagedQty);

    rpcItems.push({
      purchase_item_id: item.id,
      location_id: locationId,
      received_quantity: receivedQty,
      accepted_quantity: acceptedQty,
      damaged_quantity: damagedQty,
    });
  }

  if (rpcItems.length === 0) {
    return {
      ok: false,
      error: 'Enter a physically received quantity greater than 0 for at least one purchase line before submitting.',
    };
  }

  return {
    ok: true,
    normalized: {
      notes,
      rpcItems,
      totalReceived,
      totalAccepted,
      totalDamaged,
      distinctPurchaseItemCount: distinctPurchaseItemIds.size,
      selectedLocationIds: Array.from(selectedLocationIds),
    },
  };
}

function buildReceiptRecords(
  rawReceipts: Array<{
    id: string;
    organization_id: string;
    purchase_id: string;
    receipt_number: string;
    received_at: string;
    received_by: string | null;
    notes: string | null;
    created_at: string;
  }>,
  rawReceiptItems: Array<{
    id: string;
    organization_id: string;
    receipt_id: string;
    purchase_item_id: string;
    variant_id: string;
    location_id: string;
    received_quantity: number;
    accepted_quantity: number;
    damaged_quantity: number;
    created_at: string;
  }>,
  options: {
    purchaseItems?: PurchaseItemRecord[];
    catalogVariants?: PurchaseCatalogVariant[];
    locationsById?: Record<string, InventoryLocationRecord>;
    memberNameByUserId?: Map<string, string>;
  }
): PurchaseReceiptRecord[] {
  const purchaseItemById = new Map((options.purchaseItems ?? []).map((item) => [item.id, item]));
  const variantById = new Map((options.catalogVariants ?? []).map((v) => [v.variantId, v]));
  const locationsById = options.locationsById ?? {};
  const memberNameByUserId = options.memberNameByUserId ?? new Map<string, string>();

  const itemsByReceiptId = new Map<string, PurchaseReceiptItemRecord[]>();

  for (const row of rawReceiptItems) {
    const purchaseItem = purchaseItemById.get(row.purchase_item_id);
    const catalogVariant = variantById.get(row.variant_id);
    const location = locationsById[row.location_id];

    const receivedQuantity = roundFourDecimals(Number(row.received_quantity) || 0);
    const acceptedQuantity = roundFourDecimals(Number(row.accepted_quantity) || 0);
    const damagedQuantity = roundFourDecimals(Number(row.damaged_quantity) || 0);

    const mappedItem: PurchaseReceiptItemRecord = {
      id: row.id,
      organizationId: row.organization_id,
      receiptId: row.receipt_id,
      purchaseItemId: row.purchase_item_id,
      variantId: row.variant_id,
      locationId: row.location_id,
      locationName: location?.name ?? 'Unknown Location',
      productName: purchaseItem?.productName ?? catalogVariant?.productName ?? 'Product',
      variantName: purchaseItem?.variantName ?? catalogVariant?.variantName ?? 'Variant',
      sku: purchaseItem?.sku ?? catalogVariant?.sku ?? '—',
      unitOfMeasure:
        purchaseItem?.unitOfMeasure ?? catalogVariant?.unitOfMeasure ?? 'Unit',
      receivedQuantity,
      acceptedQuantity,
      damagedQuantity,
      createdAt: row.created_at ?? null,
    };

    const existing = itemsByReceiptId.get(row.receipt_id) ?? [];
    existing.push(mappedItem);
    itemsByReceiptId.set(row.receipt_id, existing);
  }

  return rawReceipts.map((receipt) => {
    const items = itemsByReceiptId.get(receipt.id) ?? [];
    const totalReceived = roundFourDecimals(
      items.reduce((sum, item) => sum + item.receivedQuantity, 0)
    );
    const totalAccepted = roundFourDecimals(
      items.reduce((sum, item) => sum + item.acceptedQuantity, 0)
    );
    const totalDamaged = roundFourDecimals(
      items.reduce((sum, item) => sum + item.damagedQuantity, 0)
    );

    const receivedBy = receipt.received_by ?? null;
    const resolvedName = receivedBy
      ? memberNameByUserId.get(receivedBy) ?? `User ${receivedBy.slice(0, 8)}`
      : 'System';

    return {
      id: receipt.id,
      organizationId: receipt.organization_id,
      purchaseId: receipt.purchase_id,
      receiptNumber: receipt.receipt_number,
      receivedAt: receipt.received_at ?? receipt.created_at ?? null,
      receivedBy,
      receivedByName: resolvedName,
      notes: receipt.notes ?? null,
      createdAt: receipt.created_at ?? null,
      items,
      totalReceived,
      totalAccepted,
      totalDamaged,
    };
  });
}

export async function fetchPurchaseReceipts(
  organisationId: string,
  purchaseId: string,
  options: {
    purchaseItems?: PurchaseItemRecord[];
    catalogVariants?: PurchaseCatalogVariant[];
    locationsById?: Record<string, InventoryLocationRecord>;
  } = {}
): Promise<PurchaseReceiptsListResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { receipts: [], error: 'Supabase client is not configured.' };
  }

  const cleanPurchaseId = purchaseId.trim();
  if (!cleanPurchaseId) {
    return { receipts: [], error: 'Purchase ID is required.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { receipts: [], error: verified.error };
  }

  const orgId = verified.organizationId;

  const [receiptsRes, membersRes] = await Promise.all([
    supabase
      .from('purchase_receipts')
      .select(
        'id, organization_id, purchase_id, receipt_number, received_at, received_by, notes, created_at'
      )
      .eq('organization_id', orgId)
      .eq('purchase_id', cleanPurchaseId)
      .order('received_at', { ascending: false })
      .order('created_at', { ascending: false }),
    fetchOrganisationMembers(orgId),
  ]);

  if (receiptsRes.error) {
    return {
      receipts: [],
      error: formatPurchaseReadError(
        receiptsRes.error.message,
        'Unable to load goods received history.'
      ),
    };
  }

  const rawReceipts = (receiptsRes.data ?? []).filter(
    (row) => row.organization_id.toLowerCase() === orgId.toLowerCase()
  );

  if (rawReceipts.length === 0) {
    return { receipts: [], error: null };
  }

  const receiptIds = rawReceipts.map((r) => r.id);
  const itemsRes = await supabase
    .from('purchase_receipt_items')
    .select(
      'id, organization_id, receipt_id, purchase_item_id, variant_id, location_id, received_quantity, accepted_quantity, damaged_quantity, created_at'
    )
    .eq('organization_id', orgId)
    .in('receipt_id', receiptIds)
    .order('created_at', { ascending: true });

  if (itemsRes.error) {
    return {
      receipts: [],
      error: formatPurchaseReadError(
        itemsRes.error.message,
        'Unable to load received item lines.'
      ),
    };
  }

  const memberNameByUserId = new Map<string, string>();
  if (!membersRes.error) {
    for (const member of membersRes.members) {
      const displayName =
        member.profile?.full_name?.trim() ||
        member.profile?.email?.trim() ||
        null;
      if (displayName) {
        memberNameByUserId.set(member.user_id, displayName);
      }
    }
  }

  const rawReceiptItems = (itemsRes.data ?? []).filter(
    (row) => row.organization_id.toLowerCase() === orgId.toLowerCase()
  );

  const receipts = buildReceiptRecords(rawReceipts, rawReceiptItems, {
    purchaseItems: options.purchaseItems,
    catalogVariants: options.catalogVariants,
    locationsById: options.locationsById,
    memberNameByUserId,
  });

  return { receipts, error: null };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PENDING_RECEIVE_STORAGE_PREFIX = 'veyora:purchases:receive_pending';

export function generateReceivingIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure UUID generation (crypto.randomUUID) is unavailable in this browser.');
}

export function buildReceivePayloadSignature(
  organisationId: string,
  purchaseId: string,
  rpcItems: PurchaseReceiveRpcItem[],
  notes: string | null
): string {
  return JSON.stringify({
    organisationId: organisationId.trim().toLowerCase(),
    purchaseId: purchaseId.trim().toLowerCase(),
    notes: notes ?? null,
    items: rpcItems.map((item) => ({
      purchase_item_id: item.purchase_item_id,
      location_id: item.location_id,
      received_quantity: roundFourDecimals(item.received_quantity),
      accepted_quantity: roundFourDecimals(item.accepted_quantity),
      damaged_quantity: roundFourDecimals(item.damaged_quantity),
    })),
  });
}

export function getPendingReceiveStorageKey(organisationId: string, purchaseId: string): string {
  return `${PENDING_RECEIVE_STORAGE_PREFIX}:${organisationId.trim().toLowerCase()}:${purchaseId.trim().toLowerCase()}`;
}

export function loadPendingReceiveSubmission(
  organisationId: string,
  purchaseId: string
): PersistedPendingReceiveSubmission | null {
  if (typeof window === 'undefined' || !organisationId.trim() || !purchaseId.trim()) {
    return null;
  }
  const storageKey = getPendingReceiveStorageKey(organisationId, purchaseId);
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    const obj = parsed as Partial<PersistedPendingReceiveSubmission>;
    if (
      obj.version !== 1 ||
      typeof obj.organizationId !== 'string' ||
      typeof obj.purchaseId !== 'string' ||
      obj.organizationId.trim().toLowerCase() !== organisationId.trim().toLowerCase() ||
      obj.purchaseId.trim().toLowerCase() !== purchaseId.trim().toLowerCase() ||
      typeof obj.idempotencyKey !== 'string' ||
      !UUID_PATTERN.test(obj.idempotencyKey) ||
      typeof obj.payloadSignature !== 'string' ||
      !Array.isArray(obj.rpcItems) ||
      !Array.isArray(obj.lines) ||
      typeof obj.unresolved !== 'boolean'
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    return {
      version: 1,
      organizationId: obj.organizationId,
      purchaseId: obj.purchaseId,
      idempotencyKey: obj.idempotencyKey,
      payloadSignature: obj.payloadSignature,
      rpcItems: obj.rpcItems,
      notes: typeof obj.notes === 'string' ? obj.notes : null,
      lines: obj.lines,
      unresolved: obj.unresolved,
      lastError: typeof obj.lastError === 'string' ? obj.lastError : null,
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    };
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage cleanup error
    }
    return null;
  }
}

export function savePendingReceiveSubmission(
  submission: PersistedPendingReceiveSubmission
): void {
  if (typeof window === 'undefined') return;
  const storageKey = getPendingReceiveStorageKey(
    submission.organizationId,
    submission.purchaseId
  );
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(submission));
  } catch {
    // Ignore storage quota or restricted-context failures
  }
}

export function clearPendingReceiveSubmission(organisationId: string, purchaseId: string): void {
  if (typeof window === 'undefined' || !organisationId.trim() || !purchaseId.trim()) {
    return;
  }
  const storageKey = getPendingReceiveStorageKey(organisationId, purchaseId);
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures
  }
}

function isNetworkOrTimeoutError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('aborted') ||
    lower.includes('econnreset') ||
    lower.includes('connection') ||
    lower.includes('socket') ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('fetch')
  );
}

function classifyReceiveRpcError(error: {
  code?: string;
  message?: string;
  status?: number;
} | null): PurchaseReceiveErrorKind {
  if (!error) return 'ambiguous';

  const message = (error.message ?? '').trim();
  const code = (error.code ?? '').trim().toUpperCase();
  const status = typeof error.status === 'number' ? error.status : null;

  if (isNetworkOrTimeoutError(message)) {
    return 'ambiguous';
  }
  if (status !== null && (status === 0 || status === 408 || status >= 500)) {
    return 'ambiguous';
  }

  // Structured PostgreSQL / PostgREST client/validation/permission rejections are definite
  if (
    code === '42501' ||
    code === '42883' ||
    code.startsWith('P0') ||
    code.startsWith('22') ||
    code.startsWith('23') ||
    code.startsWith('42') ||
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    code === 'PGRST301' ||
    code === 'PGRST116'
  ) {
    return 'definite';
  }

  if (isPermissionDeniedError(error)) {
    return 'definite';
  }

  const lower = message.toLowerCase();
  if (
    lower.includes('exceeds') ||
    lower.includes('must equal') ||
    lower.includes('cannot be negative') ||
    lower.includes('must be greater than') ||
    lower.includes('only ordered and partially received') ||
    lower.includes('not found') ||
    lower.includes('invalid ')
  ) {
    return 'definite';
  }

  return 'ambiguous';
}

export async function receivePurchaseGoods(
  organisationId: string,
  purchase: PurchaseRecord,
  input: PurchaseReceiveFormInput,
  options: {
    activeLocations?: InventoryLocationRecord[];
    locationsById?: Record<string, InventoryLocationRecord>;
    catalogVariants?: PurchaseCatalogVariant[];
    idempotencyKey?: string;
    persistedRetryPayload?: {
      rpcItems: PurchaseReceiveRpcItem[];
      notes: string | null;
    };
  } = {}
): Promise<PurchaseReceiveResult> {
  if (!purchase.id) {
    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: 'Purchase ID is required.',
      errorKind: 'definite',
    };
  }

  let submittedRpcItems: PurchaseReceiveRpcItem[];
  let submittedNotes: string | null;

  if (options.persistedRetryPayload && options.persistedRetryPayload.rpcItems.length > 0) {
    submittedRpcItems = options.persistedRetryPayload.rpcItems;
    submittedNotes = options.persistedRetryPayload.notes;
  } else {
    if (!isPurchaseReceivableStatus(purchase.status)) {
      return {
        receiptId: null,
        receiptNumber: null,
        receipt: null,
        stockUpdates: [],
        error: 'Goods can only be received for Ordered or Partially Received purchase orders.',
        errorKind: 'definite',
      };
    }

    const activeLocationIds =
      options.activeLocations && options.activeLocations.length > 0
        ? new Set(options.activeLocations.map((loc) => loc.id))
        : undefined;

    const validation = validatePurchaseReceiveInput(purchase.items, input, {
      activeLocationIds,
    });
    if (!validation.ok) {
      return {
        receiptId: null,
        receiptNumber: null,
        receipt: null,
        stockUpdates: [],
        error: validation.error,
        errorKind: 'definite',
      };
    }

    submittedRpcItems = validation.normalized.rpcItems;
    submittedNotes = validation.normalized.notes;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: 'Supabase client is not configured.',
      errorKind: 'definite',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    const offlineOrNetwork =
      (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      isNetworkOrTimeoutError(verified.error);
    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: offlineOrNetwork
        ? `Connection unavailable while verifying workspace (${verified.error}). Retry the original submission or verify Receipt History before submitting a new delivery.`
        : verified.error,
      errorKind: offlineOrNetwork ? 'ambiguous' : 'definite',
    };
  }

  const providedKey = options.idempotencyKey?.trim();
  if (providedKey && !UUID_PATTERN.test(providedKey)) {
    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: 'Invalid delivery idempotency key format. Expected a valid UUID.',
      errorKind: 'definite',
    };
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = providedKey || generateReceivingIdempotencyKey();
  } catch (err) {
    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: err instanceof Error ? err.message : 'Unable to generate a delivery idempotency UUID.',
      errorKind: 'definite',
    };
  }

  const orgId = verified.organizationId;

  let data: unknown = null;
  let error: { code?: string; message?: string; status?: number } | null = null;

  try {
    const res = await supabase.rpc('purchases_v2_receive_goods', {
      p_organization_id: orgId,
      p_purchase_id: purchase.id,
      p_items: submittedRpcItems,
      p_notes: submittedNotes,
      p_idempotency_key: idempotencyKey,
    });
    data = res.data;
    error = res.error as { code?: string; message?: string; status?: number } | null;
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Network error or request timeout.';
    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: `Unable to confirm whether the goods receipt reached the server (${rawMsg}). Retry the original submission or verify Receipt History before submitting a new delivery.`,
      errorKind: 'ambiguous',
    };
  }

  if (error) {
    const errorKind = classifyReceiveRpcError(error);
    if (errorKind === 'ambiguous') {
      const rawMsg = error.message ?? 'Connection interrupted.';
      return {
        receiptId: null,
        receiptNumber: null,
        receipt: null,
        stockUpdates: [],
        error: `Connection interrupted while recording goods receipt (${rawMsg}). Retry the original submission or verify Receipt History before submitting a new delivery.`,
        errorKind: 'ambiguous',
      };
    }

    return {
      receiptId: null,
      receiptNumber: null,
      receipt: null,
      stockUpdates: [],
      error: formatPurchaseRpcError(error.message, 'Unable to record goods receipt.'),
      errorKind: 'definite',
    };
  }

  const receiptId =
    typeof data === 'string' && data.trim()
      ? data.trim()
      : extractPurchaseIdentifier(data);

  // Retrieve the newly created purchase_receipts record & refresh Inventory overview
  const [receiptRes, receiptItemsRes, inventoryRes, membersRes] = await Promise.all([
    receiptId
      ? supabase
          .from('purchase_receipts')
          .select(
            'id, organization_id, purchase_id, receipt_number, received_at, received_by, notes, created_at'
          )
          .eq('organization_id', orgId)
          .eq('id', receiptId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    receiptId
      ? supabase
          .from('purchase_receipt_items')
          .select(
            'id, organization_id, receipt_id, purchase_item_id, variant_id, location_id, received_quantity, accepted_quantity, damaged_quantity, created_at'
          )
          .eq('organization_id', orgId)
          .eq('receipt_id', receiptId)
      : Promise.resolve({ data: [], error: null }),
    fetchInventoryOverview(orgId),
    fetchOrganisationMembers(orgId),
  ]);

  const refreshedLocationsById: Record<string, InventoryLocationRecord> = {
    ...(options.locationsById ?? {}),
  };
  for (const loc of inventoryRes.locations) {
    refreshedLocationsById[loc.id] = loc;
  }

  const memberNameByUserId = new Map<string, string>();
  if (!membersRes.error) {
    for (const member of membersRes.members) {
      const displayName =
        member.profile?.full_name?.trim() ||
        member.profile?.email?.trim() ||
        null;
      if (displayName) {
        memberNameByUserId.set(member.user_id, displayName);
      }
    }
  }

  const receiptRow = receiptRes.data ?? null;
  const receiptItemsRows = Array.isArray(receiptItemsRes.data) ? receiptItemsRes.data : [];

  const receipt = receiptRow
    ? buildReceiptRecords([receiptRow], receiptItemsRows, {
        purchaseItems: purchase.items,
        catalogVariants: options.catalogVariants,
        locationsById: refreshedLocationsById,
        memberNameByUserId,
      })[0] ?? null
    : null;

  const balanceMap = new Map<string, number>();
  for (const bal of inventoryRes.balances) {
    balanceMap.set(`${bal.variantId}:${bal.locationId}`, roundFourDecimals(bal.quantity));
  }

  const purchaseItemById = new Map(purchase.items.map((item) => [item.id, item]));
  const stockUpdates: PurchaseStockUpdateSummary[] = [];

  for (const submitted of submittedRpcItems) {
    if (submitted.accepted_quantity <= 0) continue;
    const item = purchaseItemById.get(submitted.purchase_item_id);
    if (!item) continue;

    const locationName =
      refreshedLocationsById[submitted.location_id]?.name ?? 'Selected Location';
    const newQty = balanceMap.get(`${item.variantId}:${submitted.location_id}`) ?? null;

    stockUpdates.push({
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      unitOfMeasure: item.unitOfMeasure,
      locationId: submitted.location_id,
      locationName,
      acceptedQuantity: submitted.accepted_quantity,
      newStockQuantity: newQty,
    });
  }

  return {
    receiptId,
    receiptNumber: receiptRow?.receipt_number ?? receipt?.receiptNumber ?? null,
    receipt,
    stockUpdates,
    error: null,
    errorKind: null,
  };
}

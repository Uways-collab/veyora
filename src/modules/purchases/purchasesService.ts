import { getSupabaseClient } from '../../core/supabase/client';
import {
  fetchInventoryOverview,
  formatUnitOfMeasureLabel,
  verifyActiveWorkspaceContext,
} from '../inventory/inventoryService';
import { generateIdempotencyKey } from '../sales/salesFormatters';
import { searchSuppliers } from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';
import type {
  PurchaseCatalogVariant,
  PurchaseDraftFormInput,
  PurchaseItemRecord,
  PurchaseListResult,
  PurchaseMutationResult,
  PurchaseRecord,
  PurchaseReferenceData,
  PurchaseStatusValue,
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
    return 'Permission denied. Only Owners, Admins, and Managers can create, edit, or confirm purchase orders in the active organization.';
  }

  return msg;
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
      catalogError: verified.error,
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

  const catalogError =
    inventoryRes.errors.products ?? inventoryRes.errors.variants ?? null;

  return {
    activeSuppliers: activeSuppliersRes.suppliers,
    allSuppliersById,
    catalogVariants,
    catalogError,
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
      break;
    }

    headerError = res.error;
    if (!isMissingRelationError(res.error)) {
      break;
    }
  }

  if (headerError) {
    return {
      purchases: [],
      error: formatPurchaseRpcError(headerError.message, 'Unable to load purchase orders.'),
    };
  }

  if (purchaseRows.length === 0) {
    return { purchases: [], error: null };
  }

  const purchaseIds = purchaseRows
    .map((row) => readString(row.id, row.purchase_id))
    .filter((id): id is string => Boolean(id));

  const itemTables = ['purchase_items', 'purchase_order_items', 'purchase_order_lines'] as const;
  let rawItemRows: Record<string, unknown>[] = [];
  let itemError: { code?: string; message?: string } | null = null;

  for (const table of itemTables) {
    const res = await supabase
      .from(table)
      .select('*')
      .eq('organization_id', orgId);

    if (!res.error) {
      rawItemRows = (res.data ?? []) as Record<string, unknown>[];
      itemError = null;
      break;
    }

    if (isMissingColumnError(res.error) && purchaseIds.length > 0) {
      for (const fkCol of ['purchase_id', 'purchase_order_id'] as const) {
        const fkRes = await supabase.from(table).select('*').in(fkCol, purchaseIds);
        if (!fkRes.error) {
          rawItemRows = (fkRes.data ?? []) as Record<string, unknown>[];
          itemError = null;
          break;
        }
        if (!isMissingColumnError(fkRes.error)) {
          itemError = fkRes.error;
          break;
        }
      }
      if (!itemError) break;
    }

    itemError = res.error;
    if (!isMissingRelationError(res.error)) {
      break;
    }
  }

  if (itemError) {
    return {
      purchases: [],
      error: formatPurchaseRpcError(itemError.message, 'Unable to load purchase order items.'),
    };
  }

  const variantLookup = new Map(
    (options.catalogVariants ?? []).map((v) => [v.variantId, v])
  );
  const supplierLookup = options.suppliersById ?? {};

  const itemsByPurchaseId = new Map<string, PurchaseItemRecord[]>();

  for (const rawItem of rawItemRows) {
    const itemOrg = readString(rawItem.organization_id, rawItem.organisation_id);
    if (itemOrg && itemOrg.toLowerCase() !== orgId.toLowerCase()) continue;

    const purchaseId = readString(rawItem.purchase_id, rawItem.purchase_order_id);
    const id = readString(rawItem.id, rawItem.purchase_item_id) ?? `${purchaseId}-${itemsByPurchaseId.get(purchaseId ?? '')?.length ?? 0}`;
    const variantId = readString(rawItem.variant_id, rawItem.product_variant_id);
    if (!purchaseId || !variantId) continue;

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

    const itemRecord: PurchaseItemRecord = {
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

    const existing = itemsByPurchaseId.get(purchaseId) ?? [];
    existing.push(itemRecord);
    itemsByPurchaseId.set(purchaseId, existing);
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

  return { purchases, error: null };
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

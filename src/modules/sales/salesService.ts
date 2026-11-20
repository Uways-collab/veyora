import { getSupabaseClient } from '../../core/supabase/client';
import { fetchOrganisationMembers } from '../../core/supabase/organisations';
import {
  calculateStockStatus,
  formatLocationTypeLabel,
  formatProductTypeLabel,
  normalizeLocationTypeValue,
  normalizeProductTypeValue,
  verifyActiveWorkspaceContext,
  type InventoryBalanceRecord,
  type InventoryCategoryRecord,
  type InventoryLocationRecord,
  type InventoryProductRecord,
  type InventoryVariantRecord,
} from '../inventory/inventoryService';
import {
  formatPaymentMethodCodeLabel,
  normalizePaymentMethodCode,
  roundMoney,
  roundQuantity,
} from './salesFormatters';
import type {
  CancelSaleInput,
  CreatePaymentMethodInput,
  FollowUpPaymentInput,
  PaymentMethodRecord,
  PosCatalogItem,
  RecordRefundInput,
  RecordReturnInput,
  RefundSourceValue,
  SaleItemRecord,
  SalePaymentRecord,
  SalePaymentStatusValue,
  SaleRecord,
  SaleRefundRecord,
  SaleStatusValue,
  SalesCheckoutInput,
  SalesModuleData,
  SalesReturnItemRecord,
  SalesReturnRecord,
  UpdatePaymentMethodInput,
} from './salesTypes';

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
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k || value === null || value === undefined) continue;
    const v = String(value).trim();
    if (v) result[k] = v;
  }
  return result;
}

function buildCategoryPath(
  categoryId: string | null,
  categoryMap: Map<string, { name: string; parentId: string | null }>
): string {
  if (!categoryId) return 'Uncategorized';
  const visited = new Set<string>();
  const segments: string[] = [];
  let currentId: string | null = categoryId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = categoryMap.get(currentId);
    if (!node) break;
    segments.unshift(node.name);
    currentId = node.parentId;
  }
  return segments.length > 0 ? segments.join(' / ') : 'Uncategorized';
}

function normalizeSaleStatus(raw: unknown): SaleStatusValue {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s === 'cancelled' ? 'cancelled' : 'completed';
}

function normalizePaymentStatus(
  raw: unknown,
  totalAmount: number,
  paidAmount: number,
  returnedAmount: number,
  refundedAmount: number
): SalePaymentStatusValue {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'paid' || s === 'partial' || s === 'unpaid') return s;
  const effectiveDue = roundMoney(Math.max(0, totalAmount - returnedAmount));
  const netPaid = roundMoney(Math.max(0, paidAmount - refundedAmount));
  if (effectiveDue === 0 || netPaid >= effectiveDue) return 'paid';
  if (netPaid > 0) return 'partial';
  return 'unpaid';
}

function normalizeRefundSource(raw: unknown, returnId: string | null): RefundSourceValue {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'cancellation') return 'cancellation';
  if (s === 'return') return 'return';
  return returnId ? 'return' : 'cancellation';
}

function extractRpcIdentifier(data: unknown, preferredKeys: string[]): string | null {
  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }
  const target = Array.isArray(data) ? data[0] : data;
  if (target && typeof target === 'object') {
    const obj = target as Record<string, unknown>;
    for (const key of preferredKeys) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
    }
    if (typeof obj.id === 'string' && obj.id.trim()) {
      return obj.id.trim();
    }
  }
  return null;
}

export function formatSalesRpcError(rawMessage: string | undefined | null, fallback: string): string {
  const msg = (rawMessage ?? '').trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();

  if (lower.includes('permission denied') || lower.includes('not authorized') || lower.includes('role')) {
    return msg;
  }
  if (lower.includes('insufficient stock')) {
    return msg;
  }
  if (lower.includes('idempotency')) {
    return msg;
  }
  return msg;
}

export function buildPosCatalogItems(
  products: InventoryProductRecord[],
  variants: InventoryVariantRecord[]
): PosCatalogItem[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const items: PosCatalogItem[] = [];

  for (const variant of variants) {
    if (!variant.isActive) continue;
    const product = productById.get(variant.productId);
    if (!product || !product.isActive) continue;

    items.push({
      variantId: variant.id,
      productId: product.id,
      productName: product.name,
      variantName: variant.variantName,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      categoryPath: product.categoryPath,
      productType: product.productTypeValue,
      sku: variant.sku,
      barcode: variant.barcode,
      unitOfMeasure: variant.unitOfMeasure,
      sellingPrice: variant.sellingPrice,
      costPrice: variant.costPrice,
      attributes: variant.attributes,
    });
  }

  return items.sort(
    (a, b) =>
      a.productName.localeCompare(b.productName) ||
      a.variantName.localeCompare(b.variantName)
  );
}

export function buildEmptySalesModuleData(): SalesModuleData {
  return {
    sales: [],
    returns: [],
    refunds: [],
    paymentMethods: [],
    products: [],
    categories: [],
    variants: [],
    locations: [],
    balances: [],
    errors: {
      sales: null,
      saleItems: null,
      salePayments: null,
      returns: null,
      returnItems: null,
      refunds: null,
      paymentMethods: null,
      catalog: null,
    },
  };
}

export async function fetchSalesModuleData(
  organisationId: string,
  defaultCurrency = 'USD'
): Promise<SalesModuleData> {
  const empty = buildEmptySalesModuleData();
  const supabase = getSupabaseClient();
  if (!supabase) {
    empty.errors.sales = 'Supabase client is not configured.';
    return empty;
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    empty.errors.sales = verified.error;
    return empty;
  }

  const orgId = verified.organizationId;

  const [
    productsRes,
    categoriesRes,
    variantsRes,
    locationsRes,
    balancesRes,
    paymentMethodsRes,
    salesRes,
    saleItemsRes,
    salePaymentsRes,
    returnsRes,
    returnItemsRes,
    refundsRes,
    rosterRes,
  ] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, organization_id, category_id, name, description, product_type, image_url, is_active, created_at, updated_at'
      )
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    supabase
      .from('product_categories')
      .select('id, organization_id, parent_id, name, description, created_at')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    supabase
      .from('product_variants')
      .select(
        'id, organization_id, product_id, variant_name, sku, barcode, unit_of_measure, cost_price, selling_price, attributes, is_active, created_at'
      )
      .eq('organization_id', orgId)
      .order('variant_name', { ascending: true }),
    supabase
      .from('inventory_locations')
      .select('id, organization_id, name, location_type, address, is_active, created_at')
      .eq('organization_id', orgId)
      .order('name', { ascending: true }),
    supabase
      .from('inventory_balances')
      .select('id, organization_id, variant_id, location_id, quantity, reorder_level, updated_at')
      .eq('organization_id', orgId),
    supabase.from('payment_methods').select('*').eq('organization_id', orgId),
    supabase.from('sales').select('*').eq('organization_id', orgId),
    supabase.from('sale_items').select('*').eq('organization_id', orgId),
    supabase.from('sale_payments').select('*').eq('organization_id', orgId),
    supabase.from('sales_returns').select('*').eq('organization_id', orgId),
    supabase.from('sales_return_items').select('*').eq('organization_id', orgId),
    supabase.from('sale_refunds').select('*').eq('organization_id', orgId),
    fetchOrganisationMembers(orgId),
  ]);

  // Catalog & inventory normalization
  const rawCategories = (categoriesRes.data ?? []).filter((r) => r.organization_id === orgId);
  const categoryLookup = new Map(
    rawCategories.map((c) => [c.id, { name: c.name, parentId: c.parent_id ?? null }])
  );
  const categories: InventoryCategoryRecord[] = rawCategories.map((c) => ({
    id: c.id,
    organizationId: c.organization_id,
    parentId: c.parent_id ?? null,
    parentName: c.parent_id ? (categoryLookup.get(c.parent_id)?.name ?? null) : null,
    name: c.name,
    description: c.description ?? null,
    createdAt: c.created_at,
    isActive: true,
  }));

  const products: InventoryProductRecord[] = (productsRes.data ?? [])
    .filter((r) => r.organization_id === orgId)
    .map((row) => {
      const catId = row.category_id ?? null;
      const catNode = catId ? categoryLookup.get(catId) : null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        categoryId: catId,
        categoryName: catNode?.name ?? 'Uncategorized',
        categoryPath: buildCategoryPath(catId, categoryLookup),
        name: row.name,
        description: row.description ?? null,
        productTypeValue: normalizeProductTypeValue(row.product_type),
        productType: formatProductTypeLabel(row.product_type),
        imageUrl: row.image_url ?? null,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

  const variants: InventoryVariantRecord[] = (variantsRes.data ?? [])
    .filter((r) => r.organization_id === orgId)
    .map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      productId: row.product_id,
      variantName: row.variant_name,
      sku: row.sku,
      barcode: row.barcode ?? null,
      unitOfMeasure: row.unit_of_measure,
      costPrice: Number(row.cost_price ?? 0),
      sellingPrice: Number(row.selling_price ?? 0),
      attributes: normalizeAttributes(row.attributes),
      isActive: row.is_active,
      createdAt: row.created_at,
    }));

  const locations: InventoryLocationRecord[] = (locationsRes.data ?? [])
    .filter((r) => r.organization_id === orgId)
    .map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      locationTypeValue: normalizeLocationTypeValue(row.location_type),
      locationType: formatLocationTypeLabel(row.location_type),
      address: row.address ?? null,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const balances: InventoryBalanceRecord[] = (balancesRes.data ?? [])
    .filter((r) => r.organization_id === orgId)
    .map((row) => {
      const variant = variantById.get(row.variant_id);
      const product = variant ? productById.get(variant.productId) : undefined;
      const location = locationById.get(row.location_id);
      const quantity = Number(row.quantity ?? 0);
      const reorderLevel = Number(row.reorder_level ?? 0);
      const statusMeta = calculateStockStatus(quantity, reorderLevel);
      return {
        id: row.id,
        organizationId: row.organization_id,
        variantId: row.variant_id,
        locationId: row.location_id,
        productId: product?.id ?? variant?.productId ?? null,
        productName: product?.name ?? 'Unknown product',
        productTypeValue: product?.productTypeValue ?? 'physical',
        productIsActive: product?.isActive ?? true,
        variantName: variant?.variantName ?? 'Unknown variant',
        sku: variant?.sku ?? '—',
        unitOfMeasure: variant?.unitOfMeasure ?? 'piece',
        costPrice: variant?.costPrice ?? 0,
        variantIsActive: variant?.isActive ?? true,
        locationName: location?.name ?? 'Unknown location',
        locationTypeValue: location?.locationTypeValue ?? null,
        locationType: location?.locationType ?? 'Unspecified',
        locationIsActive: location?.isActive ?? true,
        quantity,
        reorderLevel,
        stockStatus: statusMeta.status,
        stockStatusLabel: statusMeta.label,
        updatedAt: row.updated_at,
      };
    });

  // Actor name resolution from organization member roster
  const actorNameMap = new Map<string, string>();
  if (!rosterRes.error) {
    for (const member of rosterRes.members) {
      const label = member.profile?.full_name?.trim() || member.profile?.email?.trim();
      if (member.user_id && label) {
        actorNameMap.set(member.user_id, label);
      }
    }
  }

  // Payment methods
  const rawMethods = ((paymentMethodsRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );
  const paymentMethods: PaymentMethodRecord[] = rawMethods
    .map((row) => {
      const code = normalizePaymentMethodCode(
        readString(row.method_code, row.method_type, row.code)
      );
      return {
        id: readString(row.id) ?? '',
        organizationId: orgId,
        name: readString(row.name, row.method_name) ?? formatPaymentMethodCodeLabel(code),
        methodCode: code,
        methodCodeLabel: formatPaymentMethodCodeLabel(code),
        requiresReference: readBoolean(
          row.requires_reference,
          code === 'bank_transfer'
        ),
        isActive: readBoolean(row.is_active, true),
        isSystem: readBoolean(row.is_system, false),
        createdAt: readString(row.created_at) ?? new Date().toISOString(),
        updatedAt: readString(row.updated_at),
      };
    })
    .filter((m) => Boolean(m.id))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const methodById = new Map(paymentMethods.map((m) => [m.id, m]));

  // Raw Sales rows
  const rawSales = ((salesRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );
  const rawSaleItems = ((saleItemsRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );
  const rawSalePayments = ((salePaymentsRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );
  const rawReturns = ((returnsRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );
  const rawReturnItems = ((returnItemsRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );
  const rawRefunds = ((refundsRes.data ?? []) as Record<string, unknown>[]).filter(
    (r) => readString(r.organization_id) === orgId
  );

  // Map Sale Items
  const saleItemById = new Map<string, SaleItemRecord>();
  const saleItemsBySaleId = new Map<string, SaleItemRecord[]>();

  for (const row of rawSaleItems) {
    const id = readString(row.id) ?? '';
    const saleId = readString(row.sale_id) ?? '';
    const variantId = readString(row.variant_id) ?? '';
    const productId = readString(row.product_id) ?? variantById.get(variantId)?.productId ?? '';
    if (!id || !saleId) continue;

    const variant = variantById.get(variantId);
    const product = productById.get(productId);

    const quantity = roundQuantity(readNumber(row.quantity) ?? 0);
    const unitPrice = roundMoney(readNumber(row.unit_price, row.selling_price_snapshot) ?? 0);
    const lineSubtotal = roundMoney(
      readNumber(row.line_subtotal, row.subtotal_amount, row.gross_amount) ??
        unitPrice * quantity
    );
    const lineDiscountAmount = roundMoney(
      readNumber(row.line_discount_amount, row.discount_amount) ?? 0
    );
    const allocatedOrderDiscount = roundMoney(
      readNumber(row.allocated_order_discount, row.order_discount_allocated) ?? 0
    );
    const lineFinalAmount = roundMoney(
      readNumber(row.line_final_amount, row.line_total_amount, row.net_amount, row.total_amount) ??
        Math.max(0, lineSubtotal - lineDiscountAmount - allocatedOrderDiscount)
    );
    const returnedQuantity = roundQuantity(readNumber(row.returned_quantity) ?? 0);
    const returnedAmount = roundMoney(readNumber(row.returned_amount) ?? 0);

    const item: SaleItemRecord = {
      id,
      organizationId: orgId,
      saleId,
      productId,
      variantId,
      productName:
        readString(row.product_name_snapshot, row.product_name) ??
        product?.name ??
        'Product',
      variantName:
        readString(row.variant_name_snapshot, row.variant_name) ??
        variant?.variantName ??
        'Variant',
      sku: readString(row.sku_snapshot, row.sku) ?? variant?.sku ?? '—',
      barcode: readString(row.barcode_snapshot, row.barcode) ?? variant?.barcode ?? null,
      unitOfMeasure:
        readString(row.unit_of_measure_snapshot, row.unit_of_measure) ??
        variant?.unitOfMeasure ??
        'piece',
      productType: normalizeProductTypeValue(
        readString(row.product_type_snapshot, row.product_type) ?? product?.productTypeValue
      ),
      unitPrice,
      unitCost: roundMoney(readNumber(row.unit_cost_snapshot, row.unit_cost, row.cost_price) ?? 0),
      quantity,
      lineSubtotal,
      lineDiscountAmount,
      allocatedOrderDiscount,
      lineFinalAmount,
      returnedQuantity,
      returnedAmount,
      remainingReturnableQuantity: roundQuantity(Math.max(0, quantity - returnedQuantity)),
      remainingReturnableAmount: roundMoney(Math.max(0, lineFinalAmount - returnedAmount)),
    };

    saleItemById.set(id, item);
    const list = saleItemsBySaleId.get(saleId);
    if (list) list.push(item);
    else saleItemsBySaleId.set(saleId, [item]);
  }

  // Map Sale Payments
  const paymentsBySaleId = new Map<string, SalePaymentRecord[]>();
  for (const row of rawSalePayments) {
    const id = readString(row.id) ?? '';
    const saleId = readString(row.sale_id) ?? '';
    if (!id || !saleId) continue;

    const methodId = readString(row.payment_method_id) ?? '';
    const method = methodById.get(methodId);
    const methodCode = normalizePaymentMethodCode(
      readString(row.method_code_snapshot, row.method_type_snapshot, row.method_code, row.method_type) ??
        method?.methodCode
    );
    const recordedByUserId = readString(
      row.recorded_by,
      row.received_by,
      row.performed_by,
      row.created_by
    );

    const payment: SalePaymentRecord = {
      id,
      organizationId: orgId,
      saleId,
      paymentMethodId: methodId,
      methodName:
        readString(row.method_name_snapshot, row.method_name) ??
        method?.name ??
        formatPaymentMethodCodeLabel(methodCode),
      methodCode,
      amount: roundMoney(readNumber(row.amount) ?? 0),
      reference: readString(row.reference, row.payment_reference),
      paymentSource:
        readString(row.payment_source) === 'follow_up' ? 'follow_up' : 'checkout',
      paidAt: readString(row.paid_at, row.created_at) ?? new Date().toISOString(),
      recordedByUserId,
      recordedByName: recordedByUserId ? (actorNameMap.get(recordedByUserId) ?? null) : null,
    };

    const list = paymentsBySaleId.get(saleId);
    if (list) list.push(payment);
    else paymentsBySaleId.set(saleId, [payment]);
  }

  // Pre-index Sale Numbers & Location lookup for returns/refunds
  const saleHeaderLookup = new Map<
    string,
    { saleNumber: string; locationId: string; locationName: string }
  >();
  for (const row of rawSales) {
    const id = readString(row.id);
    if (!id) continue;
    const locId = readString(row.location_id) ?? '';
    const saleNumber =
      readString(row.sale_number, row.receipt_number, row.reference_number) ??
      `SAL-${id.slice(0, 8).toUpperCase()}`;
    saleHeaderLookup.set(id, {
      saleNumber,
      locationId: locId,
      locationName: locationById.get(locId)?.name ?? 'Location',
    });
  }

  // Map Return Items
  const returnItemsByReturnId = new Map<string, SalesReturnItemRecord[]>();
  for (const row of rawReturnItems) {
    const id = readString(row.id) ?? '';
    const returnId = readString(row.return_id) ?? '';
    const saleId = readString(row.sale_id) ?? '';
    const saleItemId = readString(row.sale_item_id) ?? '';
    if (!id || !returnId) continue;

    const saleItem = saleItemById.get(saleItemId);
    const variantId = readString(row.variant_id) ?? saleItem?.variantId ?? '';
    const variant = variantById.get(variantId);
    const product = variant ? productById.get(variant.productId) : undefined;
    const restockLocationId = readString(row.restock_location_id, row.location_id);
    const qty = roundQuantity(readNumber(row.quantity) ?? 0);
    const restockQty = roundQuantity(readNumber(row.restock_quantity) ?? 0);

    const rItem: SalesReturnItemRecord = {
      id,
      organizationId: orgId,
      saleId: saleId || saleItem?.saleId || '',
      returnId,
      saleItemId,
      variantId,
      productName: saleItem?.productName ?? product?.name ?? 'Product',
      variantName: saleItem?.variantName ?? variant?.variantName ?? 'Variant',
      sku: saleItem?.sku ?? variant?.sku ?? '—',
      unitOfMeasure: saleItem?.unitOfMeasure ?? variant?.unitOfMeasure ?? 'piece',
      productType: saleItem?.productType ?? product?.productTypeValue ?? 'physical',
      quantity: qty,
      restockQuantity: restockQty,
      damagedQuantity: roundQuantity(Math.max(0, qty - restockQty)),
      restockLocationId,
      restockLocationName: restockLocationId
        ? (locationById.get(restockLocationId)?.name ?? 'Location')
        : null,
      conditionNotes: readString(row.condition_notes, row.notes),
      returnLineAmount: roundMoney(
        readNumber(row.return_line_amount, row.line_total_amount, row.amount) ?? 0
      ),
    };

    const list = returnItemsByReturnId.get(returnId);
    if (list) list.push(rItem);
    else returnItemsByReturnId.set(returnId, [rItem]);
  }

  // Map Returns
  const returnNumberLookup = new Map<string, string>();
  const returns: SalesReturnRecord[] = rawReturns
    .map((row) => {
      const id = readString(row.id) ?? '';
      const saleId = readString(row.sale_id) ?? '';
      const saleMeta = saleHeaderLookup.get(saleId);
      const locId = readString(row.location_id, row.restock_location_id) ?? saleMeta?.locationId ?? null;
      const returnNumber =
        readString(row.return_number, row.reference_number) ??
        `RET-${id.slice(0, 8).toUpperCase()}`;
      if (id) returnNumberLookup.set(id, returnNumber);

      const totalReturnAmount = roundMoney(
        readNumber(row.total_return_amount, row.total_amount) ?? 0
      );
      const debtReducedAmount = roundMoney(readNumber(row.debt_reduced_amount) ?? 0);
      const refundedAmount = roundMoney(readNumber(row.refunded_amount) ?? 0);
      const processedByUserId = readString(
        row.processed_by,
        row.recorded_by,
        row.performed_by,
        row.created_by
      );

      return {
        id,
        organizationId: orgId,
        saleId,
        saleNumber: saleMeta?.saleNumber ?? `SAL-${saleId.slice(0, 8).toUpperCase()}`,
        returnNumber,
        locationId: locId,
        locationName: locId ? (locationById.get(locId)?.name ?? saleMeta?.locationName ?? 'Location') : 'Location',
        reason: readString(row.reason, row.return_reason) ?? '',
        totalReturnAmount,
        debtReducedAmount,
        refundedAmount,
        refundableRemainingAmount: roundMoney(
          Math.max(0, totalReturnAmount - debtReducedAmount - refundedAmount)
        ),
        returnedAt: readString(row.returned_at, row.created_at) ?? new Date().toISOString(),
        processedByUserId,
        processedByName: processedByUserId ? (actorNameMap.get(processedByUserId) ?? null) : null,
        items: returnItemsByReturnId.get(id) ?? [],
      };
    })
    .filter((r) => Boolean(r.id))
    .sort((a, b) => Date.parse(b.returnedAt) - Date.parse(a.returnedAt));

  const returnsBySaleId = new Map<string, SalesReturnRecord[]>();
  for (const ret of returns) {
    const list = returnsBySaleId.get(ret.saleId);
    if (list) list.push(ret);
    else returnsBySaleId.set(ret.saleId, [ret]);
  }

  // Map Refunds
  const refunds: SaleRefundRecord[] = rawRefunds
    .map((row) => {
      const id = readString(row.id) ?? '';
      const saleId = readString(row.sale_id) ?? '';
      const returnId = readString(row.return_id);
      const saleMeta = saleHeaderLookup.get(saleId);
      const methodId = readString(row.payment_method_id) ?? '';
      const method = methodById.get(methodId);
      const methodCode = normalizePaymentMethodCode(
        readString(row.method_code_snapshot, row.method_type_snapshot, row.method_code, row.method_type) ??
          method?.methodCode
      );
      const recordedByUserId = readString(
        row.recorded_by,
        row.refunded_by,
        row.performed_by,
        row.created_by
      );

      return {
        id,
        organizationId: orgId,
        saleId,
        saleNumber: saleMeta?.saleNumber ?? `SAL-${saleId.slice(0, 8).toUpperCase()}`,
        returnId,
        returnNumber: returnId ? (returnNumberLookup.get(returnId) ?? null) : null,
        refundSource: normalizeRefundSource(row.refund_source, returnId),
        paymentMethodId: methodId,
        methodName:
          readString(row.method_name_snapshot, row.method_name) ??
          method?.name ??
          formatPaymentMethodCodeLabel(methodCode),
        methodCode,
        amount: roundMoney(readNumber(row.amount) ?? 0),
        reason: readString(row.reason, row.refund_reason) ?? '',
        reference: readString(row.reference),
        refundedAt: readString(row.refunded_at, row.created_at) ?? new Date().toISOString(),
        recordedByUserId,
        recordedByName: recordedByUserId ? (actorNameMap.get(recordedByUserId) ?? null) : null,
      };
    })
    .filter((rf) => Boolean(rf.id))
    .sort((a, b) => Date.parse(b.refundedAt) - Date.parse(a.refundedAt));

  const refundsBySaleId = new Map<string, SaleRefundRecord[]>();
  for (const rf of refunds) {
    const list = refundsBySaleId.get(rf.saleId);
    if (list) list.push(rf);
    else refundsBySaleId.set(rf.saleId, [rf]);
  }

  // Assemble Sales
  const sales: SaleRecord[] = rawSales
    .map((row) => {
      const id = readString(row.id) ?? '';
      const locationId = readString(row.location_id) ?? '';
      const saleStatus = normalizeSaleStatus(row.status);
      const subtotalAmount = roundMoney(readNumber(row.subtotal_amount, row.subtotal) ?? 0);
      const orderDiscountAmount = roundMoney(readNumber(row.order_discount_amount) ?? 0);
      const lineDiscountTotalAmount = roundMoney(
        readNumber(row.line_discount_total_amount, row.line_discount_amount) ??
          (saleItemsBySaleId.get(id) ?? []).reduce((sum, i) => sum + i.lineDiscountAmount, 0)
      );
      const discountTotalAmount = roundMoney(
        readNumber(row.discount_total_amount, row.total_discount_amount, row.discount_amount) ??
          lineDiscountTotalAmount + orderDiscountAmount
      );
      const taxRate = Number(readNumber(row.tax_rate) ?? 0);
      const taxAmount = roundMoney(readNumber(row.tax_amount) ?? 0);
      const totalAmount = roundMoney(readNumber(row.total_amount) ?? 0);
      const paidAmount = roundMoney(readNumber(row.paid_amount) ?? 0);
      const returnedAmount = roundMoney(readNumber(row.returned_amount) ?? 0);
      const debtReducedAmount = roundMoney(readNumber(row.debt_reduced_amount) ?? 0);
      const refundedAmount = roundMoney(readNumber(row.refunded_amount) ?? 0);
      const cancelledCreditAmount = roundMoney(readNumber(row.cancelled_credit_amount) ?? 0);

      const effectiveNetObligation = roundMoney(Math.max(0, totalAmount - returnedAmount));
      const netCollected = roundMoney(Math.max(0, paidAmount - refundedAmount));
      const outstandingAmount =
        saleStatus === 'cancelled'
          ? 0
          : roundMoney(Math.max(0, effectiveNetObligation - netCollected));

      const pendingRefundAmount =
        saleStatus === 'cancelled'
          ? roundMoney(Math.max(0, paidAmount - refundedAmount))
          : roundMoney(Math.max(0, netCollected - effectiveNetObligation));

      const paymentStatus = normalizePaymentStatus(
        row.payment_status,
        totalAmount,
        paidAmount,
        returnedAmount,
        refundedAmount
      );

      const cashierUserId = readString(
        row.sold_by,
        row.cashier_id,
        row.cashier_user_id,
        row.performed_by,
        row.created_by
      );
      const cancelledByUserId = readString(row.cancelled_by);

      const salePayments = (paymentsBySaleId.get(id) ?? [])
        .slice()
        .sort((a, b) => Date.parse(b.paidAt) - Date.parse(a.paidAt));

      return {
        id,
        organizationId: orgId,
        saleNumber:
          readString(row.sale_number, row.receipt_number, row.reference_number) ??
          `SAL-${id.slice(0, 8).toUpperCase()}`,
        locationId,
        locationName: locationById.get(locationId)?.name ?? 'Location',
        currency: (readString(row.currency) ?? defaultCurrency).toUpperCase(),
        customerName: readString(row.customer_name),
        customerPhone: readString(row.customer_phone),
        status: saleStatus,
        paymentStatus,
        isCreditSale: readBoolean(
          row.is_credit_sale,
          paymentStatus === 'partial' || paymentStatus === 'unpaid'
        ),
        subtotalAmount,
        lineDiscountTotalAmount,
        orderDiscountAmount,
        discountTotalAmount,
        taxRate,
        taxAmount,
        totalAmount,
        paidAmount,
        returnedAmount,
        debtReducedAmount,
        refundedAmount,
        cancelledCreditAmount,
        outstandingAmount,
        pendingRefundAmount,
        soldAt: readString(row.sold_at, row.created_at) ?? new Date().toISOString(),
        cashierUserId,
        cashierName: cashierUserId ? (actorNameMap.get(cashierUserId) ?? null) : null,
        cancelledAt: readString(row.cancelled_at),
        cancelledByUserId,
        cancelledByName: cancelledByUserId ? (actorNameMap.get(cancelledByUserId) ?? null) : null,
        cancellationReason: readString(row.cancellation_reason),
        items: saleItemsBySaleId.get(id) ?? [],
        payments: salePayments,
        returns: returnsBySaleId.get(id) ?? [],
        refunds: refundsBySaleId.get(id) ?? [],
      };
    })
    .filter((s) => Boolean(s.id))
    .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));

  const catalogError =
    productsRes.error?.message ??
    categoriesRes.error?.message ??
    variantsRes.error?.message ??
    locationsRes.error?.message ??
    balancesRes.error?.message ??
    null;

  return {
    sales,
    returns,
    refunds,
    paymentMethods,
    products,
    categories,
    variants,
    locations,
    balances,
    errors: {
      sales: salesRes.error?.message ?? null,
      saleItems: saleItemsRes.error?.message ?? null,
      salePayments: salePaymentsRes.error?.message ?? null,
      returns: returnsRes.error?.message ?? null,
      returnItems: returnItemsRes.error?.message ?? null,
      refunds: refundsRes.error?.message ?? null,
      paymentMethods: paymentMethodsRes.error?.message ?? null,
      catalog: catalogError,
    },
  };
}

export async function checkoutSale(
  organisationId: string,
  input: SalesCheckoutInput
): Promise<{ saleId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { saleId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { saleId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('sales_v1_checkout', {
    p_organization_id: verified.organizationId,
    p_location_id: input.locationId,
    p_items: input.items.map((item) => ({
      variant_id: item.variantId,
      quantity: roundQuantity(item.quantity),
      line_discount_amount: roundMoney(item.lineDiscountAmount),
    })),
    p_payments: input.payments.map((payment) => ({
      payment_method_id: payment.paymentMethodId,
      amount: roundMoney(payment.amount),
      reference: payment.reference?.trim() || null,
    })),
    p_idempotency_key: input.idempotencyKey,
    p_customer_name: input.customerName?.trim() || null,
    p_customer_phone: input.customerPhone?.trim() || null,
    p_order_discount_amount: roundMoney(input.orderDiscountAmount),
  });

  if (error) {
    return {
      saleId: null,
      error: formatSalesRpcError(error.message, 'Unable to complete sale checkout.'),
    };
  }

  return {
    saleId: extractRpcIdentifier(data, ['sale_id', 'id']),
    error: null,
  };
}

export async function recordFollowUpPayment(
  organisationId: string,
  input: FollowUpPaymentInput
): Promise<{ paymentId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { paymentId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { paymentId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('sales_v1_record_follow_up_payment', {
    p_organization_id: verified.organizationId,
    p_sale_id: input.saleId,
    p_payment_method_id: input.paymentMethodId,
    p_amount: roundMoney(input.amount),
    p_idempotency_key: input.idempotencyKey,
    p_reference: input.reference?.trim() || null,
  });

  if (error) {
    return {
      paymentId: null,
      error: formatSalesRpcError(error.message, 'Unable to record follow-up payment.'),
    };
  }

  return {
    paymentId: extractRpcIdentifier(data, ['payment_id', 'id']),
    error: null,
  };
}

export async function recordSalesReturn(
  organisationId: string,
  input: RecordReturnInput
): Promise<{ returnId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { returnId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { returnId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('sales_v1_record_return', {
    p_organization_id: verified.organizationId,
    p_sale_id: input.saleId,
    p_reason: input.reason.trim(),
    p_items: input.items.map((item) => ({
      sale_item_id: item.saleItemId,
      quantity: roundQuantity(item.quantity),
      restock_quantity: roundQuantity(item.restockQuantity),
      restock_location_id: item.restockQuantity > 0 ? item.restockLocationId : null,
      condition_notes: item.conditionNotes?.trim() || null,
    })),
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return {
      returnId: null,
      error: formatSalesRpcError(error.message, 'Unable to record sales return.'),
    };
  }

  return {
    returnId: extractRpcIdentifier(data, ['return_id', 'id']),
    error: null,
  };
}

export async function recordSaleRefund(
  organisationId: string,
  input: RecordRefundInput
): Promise<{ refundId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { refundId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { refundId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('sales_v1_record_refund', {
    p_organization_id: verified.organizationId,
    p_sale_id: input.saleId,
    p_refund_source: input.refundSource,
    p_return_id: input.refundSource === 'return' ? input.returnId : null,
    p_payment_method_id: input.paymentMethodId,
    p_amount: roundMoney(input.amount),
    p_reason: input.reason.trim(),
    p_idempotency_key: input.idempotencyKey,
    p_reference: input.reference?.trim() || null,
  });

  if (error) {
    return {
      refundId: null,
      error: formatSalesRpcError(error.message, 'Unable to record refund.'),
    };
  }

  return {
    refundId: extractRpcIdentifier(data, ['refund_id', 'id']),
    error: null,
  };
}

export async function cancelSale(
  organisationId: string,
  input: CancelSaleInput
): Promise<{ saleId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { saleId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { saleId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('sales_v1_cancel_sale', {
    p_organization_id: verified.organizationId,
    p_sale_id: input.saleId,
    p_reason: input.reason.trim(),
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    return {
      saleId: null,
      error: formatSalesRpcError(error.message, 'Unable to cancel sale.'),
    };
  }

  return {
    saleId: extractRpcIdentifier(data, ['sale_id', 'id']) ?? input.saleId,
    error: null,
  };
}

export async function createPaymentMethod(
  organisationId: string,
  input: CreatePaymentMethodInput
): Promise<{ paymentMethodId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { paymentMethodId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { paymentMethodId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('sales_v1_create_payment_method', {
    p_organization_id: verified.organizationId,
    p_name: input.name.trim(),
    p_method_code: input.methodCode,
    p_requires_reference: input.requiresReference,
  });

  if (error) {
    return {
      paymentMethodId: null,
      error: formatSalesRpcError(error.message, 'Unable to create payment method.'),
    };
  }

  return {
    paymentMethodId: extractRpcIdentifier(data, ['payment_method_id', 'id']),
    error: null,
  };
}

export async function updatePaymentMethod(
  organisationId: string,
  input: UpdatePaymentMethodInput
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { error: verified.error };
  }

  const { error } = await supabase.rpc('sales_v1_update_payment_method', {
    p_organization_id: verified.organizationId,
    p_payment_method_id: input.paymentMethodId,
    p_name: input.name.trim(),
    p_requires_reference: input.requiresReference,
    p_is_active: input.isActive,
  });

  if (error) {
    return {
      error: formatSalesRpcError(error.message, 'Unable to update payment method.'),
    };
  }

  return { error: null };
}

export async function archivePaymentMethod(
  organisationId: string,
  paymentMethodId: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { error: verified.error };
  }

  const { error } = await supabase.rpc('sales_v1_archive_payment_method', {
    p_organization_id: verified.organizationId,
    p_payment_method_id: paymentMethodId,
  });

  if (error) {
    return {
      error: formatSalesRpcError(error.message, 'Unable to archive payment method.'),
    };
  }

  return { error: null };
}

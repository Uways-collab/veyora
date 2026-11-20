import { getSupabaseClient } from '../../core/supabase/client';
import type { OrganisationRole } from '../../core/types/domain';

export type ProductTypeValue = 'physical' | 'service';

export const PRODUCT_TYPE_OPTIONS: { value: ProductTypeValue; label: string }[] = [
  { value: 'physical', label: 'Physical product' },
  { value: 'service', label: 'Service' },
];

export const UNIT_OF_MEASURE_OPTIONS: { value: string; label: string }[] = [
  { value: 'piece', label: 'Piece' },
  { value: 'carton', label: 'Carton' },
  { value: 'kilogram', label: 'Kilogram' },
  { value: 'gram', label: 'Gram' },
  { value: 'litre', label: 'Litre' },
  { value: 'millilitre', label: 'Millilitre' },
  { value: 'metre', label: 'Metre' },
];

export type LocationTypeValue = 'warehouse' | 'store' | 'branch';

export const LOCATION_TYPE_OPTIONS: { value: LocationTypeValue; label: string }[] = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'store', label: 'Store' },
  { value: 'branch', label: 'Branch' },
];

export interface InventoryCategoryRecord {
  id: string;
  organizationId: string;
  parentId: string | null;
  parentName: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  isActive: boolean;
}

export interface InventoryProductRecord {
  id: string;
  organizationId: string;
  categoryId: string | null;
  categoryName: string;
  categoryPath: string;
  name: string;
  description: string | null;
  productTypeValue: ProductTypeValue;
  productType: string;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryVariantRecord {
  id: string;
  organizationId: string;
  productId: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  unitOfMeasure: string;
  costPrice: number;
  sellingPrice: number;
  attributes: Record<string, string>;
  isActive: boolean;
  createdAt: string;
}

export interface InventoryLocationRecord {
  id: string;
  organizationId: string;
  name: string;
  locationTypeValue: LocationTypeValue;
  locationType: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
}

export type StockStatusValue = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface InventoryBalanceRecord {
  id: string;
  organizationId: string;
  variantId: string;
  locationId: string;
  productId: string | null;
  productName: string;
  productTypeValue: ProductTypeValue;
  productIsActive: boolean;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  costPrice: number;
  variantIsActive: boolean;
  locationName: string;
  locationTypeValue: LocationTypeValue | null;
  locationType: string;
  locationIsActive: boolean;
  quantity: number;
  reorderLevel: number;
  stockStatus: StockStatusValue;
  stockStatusLabel: string;
  updatedAt: string;
}

export type StockMovementTypeValue =
  | 'opening_stock'
  | 'stock_in'
  | 'stock_out'
  | 'adjustment'
  | 'return';

export type AdjustmentDirection = 'increase' | 'decrease';

export const STOCK_MOVEMENT_TYPE_OPTIONS: {
  value: StockMovementTypeValue;
  label: string;
  description: string;
}[] = [
  {
    value: 'opening_stock',
    label: 'Opening Stock',
    description: 'Initial stock balance recorded for a variant at a location.',
  },
  {
    value: 'stock_in',
    label: 'Stock In',
    description: 'Inbound inventory received into a location.',
  },
  {
    value: 'stock_out',
    label: 'Stock Out',
    description: 'Outbound inventory removed or issued from a location.',
  },
  {
    value: 'adjustment',
    label: 'Adjustment',
    description: 'Positive or negative manual inventory correction.',
  },
  {
    value: 'return',
    label: 'Return',
    description: 'Returned stock added back into inventory.',
  },
];

export interface InventoryMovementRecord {
  id: string;
  organizationId: string;
  variantId: string;
  locationId: string;
  productId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationName: string;
  locationType: string;
  movementTypeValue: string;
  movementTypeLabel: string;
  quantityChange: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  reference: string | null;
  notes: string | null;
  performedByUserId: string | null;
  performedByName: string | null;
  createdAt: string;
}

export type StockTransferStatusValue = 'draft' | 'completed' | 'cancelled';

export interface InventoryTransferItemRecord {
  id: string;
  organizationId: string;
  transferId: string;
  variantId: string;
  productId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  quantity: number;
}

export interface InventoryTransferRecord {
  id: string;
  referenceCode: string;
  organizationId: string;
  sourceLocationId: string;
  sourceLocationName: string;
  sourceLocationType: string;
  sourceLocationIsActive: boolean;
  destinationLocationId: string;
  destinationLocationName: string;
  destinationLocationType: string;
  destinationLocationIsActive: boolean;
  status: StockTransferStatusValue;
  statusLabel: string;
  notes: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  completedByUserId: string | null;
  completedByName: string | null;
  createdAt: string;
  completedAt: string | null;
  items: InventoryTransferItemRecord[];
  itemCount: number;
  totalQuantity: number;
}

export interface InventoryOverviewData {
  products: InventoryProductRecord[];
  categories: InventoryCategoryRecord[];
  variants: InventoryVariantRecord[];
  locations: InventoryLocationRecord[];
  balances: InventoryBalanceRecord[];
  movements: InventoryMovementRecord[];
  transfers: InventoryTransferRecord[];
  activeProductCount: number;
  activeCategoryCount: number;
  activeLocationCount: number;
  errors: {
    products: string | null;
    categories: string | null;
    variants: string | null;
    locations: string | null;
    balances: string | null;
    movements: string | null;
    transfers: string | null;
  };
}

export interface AdjustInventoryStockInput {
  variantId: string;
  locationId: string;
  movementType: StockMovementTypeValue;
  quantity: number;
  adjustmentDirection?: AdjustmentDirection;
  reference: string | null;
  notes: string | null;
}

export interface UpdateReorderLevelInput {
  variantId: string;
  locationId: string;
  reorderLevel: number;
}

export interface TransferItemLineInput {
  variantId: string;
  quantity: number;
}

export interface CreateInventoryTransferDraftInput {
  sourceLocationId: string;
  destinationLocationId: string;
  notes: string | null;
  items: TransferItemLineInput[];
}

export interface FailedTransferItemError {
  variantId: string;
  quantity: number;
  error: string;
}

export interface CreateInventoryTransferDraftResult {
  transferId: string | null;
  addedVariantIds: string[];
  failedItems: FailedTransferItemError[];
  error: string | null;
}

export interface AddInventoryTransferItemInput {
  transferId: string;
  variantId: string;
  quantity: number;
}

export interface ReplenishmentSummary {
  lowStockCount: number;
  outOfStockCount: number;
  needingReplenishmentCount: number;
}

export interface ProductMutationInput {
  name: string;
  productType: ProductTypeValue;
  categoryId: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive?: boolean;
}

export interface CategoryMutationInput {
  name: string;
  parentId: string | null;
  description: string | null;
}

export interface VariantMutationInput {
  productId: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  unitOfMeasure: string;
  costPrice: number;
  sellingPrice: number;
  attributes: Record<string, string>;
  isActive?: boolean;
}

export interface LocationMutationInput {
  name: string;
  locationType: LocationTypeValue;
  address: string | null;
}

export interface VariantProfitMetrics {
  grossProfit: number;
  marginPercent: number | null;
}

export function calculateVariantProfit(
  costPrice: number,
  sellingPrice: number
): VariantProfitMetrics {
  const safeCost = Number.isFinite(costPrice) ? costPrice : 0;
  const safeSelling = Number.isFinite(sellingPrice) ? sellingPrice : 0;
  const grossProfit = safeSelling - safeCost;
  const marginPercent =
    safeSelling > 0 ? (grossProfit / safeSelling) * 100 : null;
  return { grossProfit, marginPercent };
}

export function calculateStockStatus(
  quantity: number,
  reorderLevel: number
): { status: StockStatusValue; label: string } {
  const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
  const safeReorder = Number.isFinite(reorderLevel) ? reorderLevel : 0;

  if (safeQuantity <= 0) {
    return { status: 'out_of_stock', label: 'Out of stock' };
  }
  if (safeQuantity <= safeReorder) {
    return { status: 'low_stock', label: 'Low stock' };
  }
  return { status: 'in_stock', label: 'In stock' };
}

export function summarizeReplenishmentAlerts(
  balances: InventoryBalanceRecord[]
): ReplenishmentSummary {
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const row of balances) {
    if (!row.productIsActive) continue;
    if (row.stockStatus === 'low_stock') {
      lowStockCount += 1;
    } else if (row.stockStatus === 'out_of_stock') {
      outOfStockCount += 1;
    }
  }

  return {
    lowStockCount,
    outOfStockCount,
    needingReplenishmentCount: lowStockCount + outOfStockCount,
  };
}

export function formatMoneyAmount(
  amount: number,
  currencyCode: string
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const normalizedCurrency = (currencyCode || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeAmount);
  } catch {
    return `${normalizedCurrency} ${safeAmount.toFixed(2)}`;
  }
}

export function formatUnitOfMeasureLabel(unit: string): string {
  const normalized = (unit ?? '').trim().toLowerCase();
  const match = UNIT_OF_MEASURE_OPTIONS.find((opt) => opt.value === normalized);
  if (match) return match.label;
  if (!normalized) return 'Piece';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function canManageInventoryCatalog(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function canManageInventoryLocations(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function normalizeLocationTypeValue(rawType: string | null | undefined): LocationTypeValue {
  const normalized = (rawType ?? '').trim().toLowerCase();
  if (normalized === 'store') return 'store';
  if (normalized === 'branch') return 'branch';
  return 'warehouse';
}

export function formatLocationTypeLabel(rawType: string | null | undefined): string {
  const normalized = (rawType ?? '').trim().toLowerCase();
  if (normalized === 'warehouse') return 'Warehouse';
  if (normalized === 'store') return 'Store';
  if (normalized === 'branch') return 'Branch';
  if (!normalized) return 'Unspecified';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatStockMovementTypeLabel(rawType: string | null | undefined): string {
  const normalized = (rawType ?? '').trim().toLowerCase();
  const matched = STOCK_MOVEMENT_TYPE_OPTIONS.find((opt) => opt.value === normalized);
  if (matched) return matched.label;
  if (!normalized) return 'Unspecified';
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatTransferReference(transferId: string): string {
  const clean = (transferId ?? '').trim();
  if (!clean) return 'TRF-UNKNOWN';
  return `TRF-${clean.slice(0, 8).toUpperCase()}`;
}

export function normalizeTransferStatus(rawStatus: string | null | undefined): StockTransferStatusValue {
  const normalized = (rawStatus ?? '').trim().toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'draft';
}

export function formatTransferStatusLabel(rawStatus: string | null | undefined): string {
  const status = normalizeTransferStatus(rawStatus);
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Draft';
}

export function computeSignedQuantityChange(
  movementType: StockMovementTypeValue,
  positiveQuantity: number,
  adjustmentDirection: AdjustmentDirection = 'increase'
): number | null {
  if (!Number.isFinite(positiveQuantity) || positiveQuantity <= 0) {
    return null;
  }
  switch (movementType) {
    case 'opening_stock':
    case 'stock_in':
    case 'return':
      return positiveQuantity;
    case 'stock_out':
      return -positiveQuantity;
    case 'adjustment':
      return adjustmentDirection === 'decrease' ? -positiveQuantity : positiveQuantity;
    default:
      return null;
  }
}

export function formatProductTypeLabel(rawType: string | null | undefined): string {
  const normalized = (rawType ?? '').trim().toLowerCase();
  if (normalized === 'physical' || normalized === 'physical_product' || normalized === 'physical product') {
    return 'Physical product';
  }
  if (normalized === 'service') {
    return 'Service';
  }
  if (!normalized) {
    return 'Unspecified';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeProductTypeValue(rawType: string | null | undefined): ProductTypeValue {
  const normalized = (rawType ?? '').trim().toLowerCase();
  return normalized === 'service' ? 'service' : 'physical';
}

function normalizeAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = key.trim();
    if (!cleanKey) continue;
    if (value === null || value === undefined) continue;
    const cleanVal = String(value).trim();
    if (!cleanVal) continue;
    result[cleanKey] = cleanVal;
  }
  return result;
}

function roundCurrencyValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatInventoryErrorMessage(
  error: { code?: string; message?: string; details?: string | null },
  fallback: string,
  entityKind: 'product' | 'category' | 'variant' | 'location' = 'product'
): string {
  const code = error.code ?? '';
  const message = error.message ?? fallback;
  const details = error.details ?? '';
  const lower = `${message} ${details}`.toLowerCase();

  if (
    code === '42501' ||
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('policy')
  ) {
    if (entityKind === 'location') {
      return 'Permission denied by Row Level Security. Only Owners and Admins can create, edit, archive, or restore inventory locations.';
    }
    return 'Permission denied by Row Level Security. Only Owners, Admins, and Managers can create or edit catalog records.';
  }

  if (code === '23505' || lower.includes('duplicate key') || lower.includes('unique')) {
    if (entityKind === 'variant') {
      if (lower.includes('sku')) {
        return 'Duplicate SKU: another product variant in this organisation already uses this SKU.';
      }
      if (lower.includes('barcode')) {
        return 'Duplicate barcode: another product variant in this organisation already uses this barcode.';
      }
      return 'A variant with this SKU or barcode already exists in the active organisation.';
    }
    if (entityKind === 'location') {
      return 'An inventory location with this name already exists in the active organisation.';
    }
    return 'A record with this name already exists in the active organisation.';
  }

  if (code === '23514' || lower.includes('check constraint')) {
    if (lower.includes('cost_price') || lower.includes('selling_price')) {
      return 'Cost price and selling price cannot be negative.';
    }
    if (entityKind === 'location') {
      return 'Location type must be Warehouse, Store, or Branch.';
    }
  }

  return message || fallback;
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

function isValidOptionalUrl(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function verifyActiveWorkspaceContext(
  organisationId: string,
  requiredScope: 'none' | 'location_admin' | 'stock_operator' = 'none'
): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }
  if (!organisationId) {
    return { ok: false, error: 'An active organisation is required.' };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return {
      ok: false,
      error: 'Your authentication session could not be verified. Please sign in again.',
    };
  }

  const { data: membership, error: membershipErr } = await supabase
    .from('organization_memberships')
    .select('id, organization_id, user_id, role')
    .eq('user_id', userData.user.id)
    .eq('organization_id', organisationId)
    .maybeSingle();

  if (membershipErr) {
    return {
      ok: false,
      error: membershipErr.message || 'Unable to verify active workspace membership.',
    };
  }

  if (
    !membership ||
    membership.user_id !== userData.user.id ||
    membership.organization_id !== organisationId
  ) {
    return {
      ok: false,
      error: 'You do not have an active membership for the selected organisation.',
    };
  }

  if (requiredScope === 'location_admin' && !canManageInventoryLocations(membership.role)) {
    return {
      ok: false,
      error: 'Only Owners and Admins can create, edit, archive, or restore inventory locations.',
    };
  }

  if (requiredScope === 'stock_operator' && !canManageInventoryCatalog(membership.role)) {
    return {
      ok: false,
      error: 'Only Owners, Admins, and Managers can record stock operations.',
    };
  }

  return { ok: true, organizationId: membership.organization_id };
}

function readOptionalNumber(...values: unknown[]): number | null {
  for (const val of values) {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readOptionalString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

export function mapStockMovementRow(
  row: Record<string, unknown>,
  organisationId: string,
  productById: Map<string, InventoryProductRecord>,
  variantById: Map<string, InventoryVariantRecord>,
  locationById: Map<string, InventoryLocationRecord>,
  profileMap: Map<string, { fullName: string | null; email: string }>
): InventoryMovementRecord {
  const variantId = readOptionalString(row.variant_id) ?? '';
  const locationId = readOptionalString(row.location_id) ?? '';
  const variant = variantById.get(variantId);
  const product = variant ? productById.get(variant.productId) : undefined;
  const location = locationById.get(locationId);

  const rawMovementType = readOptionalString(row.movement_type) ?? '';
  const performedByUserId = readOptionalString(
    row.performed_by,
    row.created_by,
    row.actor_user_id,
    row.user_id
  );
  const actorProfile = performedByUserId ? profileMap.get(performedByUserId) : undefined;
  const performedByName = actorProfile
    ? actorProfile.fullName?.trim() || actorProfile.email || null
    : null;

  return {
    id: readOptionalString(row.id) ?? '',
    organizationId: readOptionalString(row.organization_id) ?? organisationId,
    variantId,
    locationId,
    productId: product?.id ?? variant?.productId ?? null,
    productName: product?.name ?? 'Unknown product',
    variantName: variant?.variantName ?? 'Unknown variant',
    sku: variant?.sku ?? '—',
    unitOfMeasure: variant?.unitOfMeasure ?? 'piece',
    locationName: location?.name ?? 'Unknown location',
    locationType: location?.locationType ?? 'Unspecified',
    movementTypeValue: rawMovementType,
    movementTypeLabel: formatStockMovementTypeLabel(rawMovementType),
    quantityChange: readOptionalNumber(row.quantity_change, row.quantity) ?? 0,
    quantityBefore: readOptionalNumber(
      row.quantity_before,
      row.before_quantity,
      row.previous_quantity
    ),
    quantityAfter: readOptionalNumber(
      row.quantity_after,
      row.after_quantity,
      row.new_quantity
    ),
    reference: readOptionalString(row.reference, row.reference_number, row.reference_code),
    notes: readOptionalString(row.notes, row.note, row.reason),
    performedByUserId,
    performedByName,
    createdAt: readOptionalString(row.created_at) ?? new Date().toISOString(),
  };
}

export async function fetchInventoryOverview(
  organisationId: string
): Promise<InventoryOverviewData> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      products: [],
      categories: [],
      variants: [],
      locations: [],
      balances: [],
      movements: [],
      transfers: [],
      activeProductCount: 0,
      activeCategoryCount: 0,
      activeLocationCount: 0,
      errors: {
        products: 'Supabase client is not configured.',
        categories: 'Supabase client is not configured.',
        variants: 'Supabase client is not configured.',
        locations: 'Supabase client is not configured.',
        balances: 'Supabase client is not configured.',
        movements: 'Supabase client is not configured.',
        transfers: 'Supabase client is not configured.',
      },
    };
  }

  if (!organisationId) {
    return {
      products: [],
      categories: [],
      variants: [],
      locations: [],
      balances: [],
      movements: [],
      transfers: [],
      activeProductCount: 0,
      activeCategoryCount: 0,
      activeLocationCount: 0,
      errors: {
        products: 'No active organisation selected.',
        categories: null,
        variants: null,
        locations: null,
        balances: null,
        movements: null,
        transfers: null,
      },
    };
  }

  const [
    productsRes,
    categoriesRes,
    variantsRes,
    locationsRes,
    balancesRes,
    movementsRes,
    transfersRes,
    transferItemsRes,
  ] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, organization_id, category_id, name, description, product_type, image_url, is_active, created_at, updated_at'
      )
      .eq('organization_id', organisationId)
      .order('name', { ascending: true }),
    supabase
      .from('product_categories')
      .select('id, organization_id, parent_id, name, description, created_at')
      .eq('organization_id', organisationId)
      .order('name', { ascending: true }),
    supabase
      .from('product_variants')
      .select(
        'id, organization_id, product_id, variant_name, sku, barcode, unit_of_measure, cost_price, selling_price, attributes, is_active, created_at'
      )
      .eq('organization_id', organisationId)
      .order('variant_name', { ascending: true }),
    supabase
      .from('inventory_locations')
      .select('id, organization_id, name, location_type, address, is_active, created_at')
      .eq('organization_id', organisationId)
      .order('name', { ascending: true }),
    supabase
      .from('inventory_balances')
      .select('id, organization_id, variant_id, location_id, quantity, reorder_level, updated_at')
      .eq('organization_id', organisationId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('stock_movements')
      .select('*')
      .eq('organization_id', organisationId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('stock_transfers')
      .select(
        'id, organization_id, source_location_id, destination_location_id, status, notes, created_by, completed_by, created_at, completed_at'
      )
      .eq('organization_id', organisationId)
      .order('created_at', { ascending: false }),
    supabase
      .from('stock_transfer_items')
      .select('id, organization_id, transfer_id, variant_id, quantity')
      .eq('organization_id', organisationId),
  ]);

  const rawCategories = (categoriesRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const categoryLookup = new Map<string, { name: string; parentId: string | null }>(
    rawCategories.map((cat) => [
      cat.id,
      { name: cat.name, parentId: cat.parent_id ?? null },
    ])
  );

  const categories: InventoryCategoryRecord[] = rawCategories
    .map((row) => {
      const parentId = row.parent_id ?? null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        parentId,
        parentName: parentId ? (categoryLookup.get(parentId)?.name ?? null) : null,
        name: row.name,
        description: row.description ?? null,
        createdAt: row.created_at,
        isActive: true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const rawProducts = (productsRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const products: InventoryProductRecord[] = rawProducts
    .map((row) => {
      const categoryId = row.category_id ?? null;
      const categoryNode = categoryId ? categoryLookup.get(categoryId) : null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        categoryId,
        categoryName: categoryNode?.name ?? 'Uncategorized',
        categoryPath: buildCategoryPath(categoryId, categoryLookup),
        name: row.name,
        description: row.description ?? null,
        productTypeValue: normalizeProductTypeValue(row.product_type),
        productType: formatProductTypeLabel(row.product_type),
        imageUrl: row.image_url ?? null,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const rawVariants = (variantsRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const variants: InventoryVariantRecord[] = rawVariants
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
    }))
    .sort((a, b) => a.variantName.localeCompare(b.variantName));

  const rawLocations = (locationsRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const locations: InventoryLocationRecord[] = rawLocations
    .map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      locationTypeValue: normalizeLocationTypeValue(row.location_type),
      locationType: formatLocationTypeLabel(row.location_type),
      address: row.address ?? null,
      isActive: row.is_active,
      createdAt: row.created_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const rawBalances = (balancesRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const balances: InventoryBalanceRecord[] = rawBalances
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
    })
    .sort((a, b) => {
      const productCmp = a.productName.localeCompare(b.productName);
      if (productCmp !== 0) return productCmp;
      const variantCmp = a.variantName.localeCompare(b.variantName);
      if (variantCmp !== 0) return variantCmp;
      return a.locationName.localeCompare(b.locationName);
    });

  const rawMovements = ((movementsRes.data ?? []) as Record<string, unknown>[]).filter(
    (row) => readOptionalString(row.organization_id) === organisationId
  );

  const rawTransfers = (transfersRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const rawTransferItems = (transferItemsRes.data ?? []).filter(
    (row) => row.organization_id === organisationId
  );

  const actorUserIds = Array.from(
    new Set(
      [
        ...rawMovements.map((row) =>
          readOptionalString(row.performed_by, row.created_by, row.actor_user_id, row.user_id)
        ),
        ...rawTransfers.flatMap((row) => [row.created_by, row.completed_by]),
      ].filter((id): id is string => Boolean(id))
    )
  );

  const profileMap = new Map<string, { fullName: string | null; email: string }>();
  if (actorUserIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', actorUserIds);

    for (const p of profileRows ?? []) {
      profileMap.set(p.id, { fullName: p.full_name, email: p.email });
    }
  }

  const movements: InventoryMovementRecord[] = rawMovements
    .map((row) =>
      mapStockMovementRow(
        row,
        organisationId,
        productById,
        variantById,
        locationById,
        profileMap
      )
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const itemsByTransferId = new Map<string, InventoryTransferItemRecord[]>();
  for (const row of rawTransferItems) {
    const variant = variantById.get(row.variant_id);
    const product = variant ? productById.get(variant.productId) : undefined;
    const itemRecord: InventoryTransferItemRecord = {
      id: row.id,
      organizationId: row.organization_id,
      transferId: row.transfer_id,
      variantId: row.variant_id,
      productId: product?.id ?? variant?.productId ?? null,
      productName: product?.name ?? 'Unknown product',
      variantName: variant?.variantName ?? 'Unknown variant',
      sku: variant?.sku ?? '—',
      unitOfMeasure: variant?.unitOfMeasure ?? 'piece',
      quantity: Number(row.quantity ?? 0),
    };
    const existing = itemsByTransferId.get(row.transfer_id);
    if (existing) {
      existing.push(itemRecord);
    } else {
      itemsByTransferId.set(row.transfer_id, [itemRecord]);
    }
  }

  const transfers: InventoryTransferRecord[] = rawTransfers
    .map((row) => {
      const sourceLoc = locationById.get(row.source_location_id);
      const destLoc = locationById.get(row.destination_location_id);
      const createdByProfile = row.created_by ? profileMap.get(row.created_by) : undefined;
      const completedByProfile = row.completed_by ? profileMap.get(row.completed_by) : undefined;
      const items = (itemsByTransferId.get(row.id) ?? []).slice().sort((a, b) => {
        const productCmp = a.productName.localeCompare(b.productName);
        if (productCmp !== 0) return productCmp;
        return a.variantName.localeCompare(b.variantName);
      });
      const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
      const status = normalizeTransferStatus(row.status);

      return {
        id: row.id,
        referenceCode: formatTransferReference(row.id),
        organizationId: row.organization_id,
        sourceLocationId: row.source_location_id,
        sourceLocationName: sourceLoc?.name ?? 'Unknown location',
        sourceLocationType: sourceLoc?.locationType ?? 'Unspecified',
        sourceLocationIsActive: sourceLoc?.isActive ?? true,
        destinationLocationId: row.destination_location_id,
        destinationLocationName: destLoc?.name ?? 'Unknown location',
        destinationLocationType: destLoc?.locationType ?? 'Unspecified',
        destinationLocationIsActive: destLoc?.isActive ?? true,
        status,
        statusLabel: formatTransferStatusLabel(row.status),
        notes: row.notes ?? null,
        createdByUserId: row.created_by ?? null,
        createdByName: createdByProfile
          ? createdByProfile.fullName?.trim() || createdByProfile.email || null
          : null,
        completedByUserId: row.completed_by ?? null,
        completedByName: completedByProfile
          ? completedByProfile.fullName?.trim() || completedByProfile.email || null
          : null,
        createdAt: row.created_at,
        completedAt: row.completed_at ?? null,
        items,
        itemCount: items.length,
        totalQuantity,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const transfersError =
    transfersRes.error?.message ?? transferItemsRes.error?.message ?? null;

  return {
    products,
    categories,
    variants,
    locations,
    balances,
    movements,
    transfers,
    activeProductCount: products.filter((p) => p.isActive).length,
    activeCategoryCount: categories.filter((c) => c.isActive).length,
    activeLocationCount: locations.filter((l) => l.isActive).length,
    errors: {
      products: productsRes.error ? productsRes.error.message : null,
      categories: categoriesRes.error ? categoriesRes.error.message : null,
      variants: variantsRes.error ? variantsRes.error.message : null,
      locations: locationsRes.error ? locationsRes.error.message : null,
      balances: balancesRes.error ? balancesRes.error.message : null,
      movements: movementsRes.error ? movementsRes.error.message : null,
      transfers: transfersError,
    },
  };
}

export async function createProduct(
  organisationId: string,
  input: ProductMutationInput
): Promise<{ productId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { productId: null, error: 'Supabase client is not configured.' };
  }
  if (!organisationId) {
    return { productId: null, error: 'An active organisation is required.' };
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 160) {
    return {
      productId: null,
      error: 'Product name must be between 2 and 160 characters.',
    };
  }

  const trimmedImageUrl = input.imageUrl?.trim() || null;
  if (!isValidOptionalUrl(trimmedImageUrl)) {
    return {
      productId: null,
      error: 'Image URL must be a valid http:// or https:// address.',
    };
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      organization_id: organisationId,
      category_id: input.categoryId || null,
      name: trimmedName,
      description: input.description?.trim() || null,
      product_type: input.productType,
      image_url: trimmedImageUrl,
      is_active: input.isActive ?? true,
    })
    .select('id')
    .single();

  if (error) {
    return {
      productId: null,
      error: formatInventoryErrorMessage(error, 'Unable to create product.', 'product'),
    };
  }

  return { productId: data?.id ?? null, error: null };
}

export async function updateProduct(
  organisationId: string,
  productId: string,
  input: ProductMutationInput
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!organisationId || !productId) {
    return { error: 'Active organisation and product ID are required.' };
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 160) {
    return { error: 'Product name must be between 2 and 160 characters.' };
  }

  const trimmedImageUrl = input.imageUrl?.trim() || null;
  if (!isValidOptionalUrl(trimmedImageUrl)) {
    return { error: 'Image URL must be a valid http:// or https:// address.' };
  }

  const { data, error } = await supabase
    .from('products')
    .update({
      category_id: input.categoryId || null,
      name: trimmedName,
      description: input.description?.trim() || null,
      product_type: input.productType,
      image_url: trimmedImageUrl,
      ...(typeof input.isActive === 'boolean' ? { is_active: input.isActive } : {}),
    })
    .eq('id', productId)
    .eq('organization_id', organisationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { error: formatInventoryErrorMessage(error, 'Unable to update product.', 'product') };
  }

  if (!data) {
    return {
      error: 'Product not updated. Verify you have permission and the product belongs to this organisation.',
    };
  }

  return { error: null };
}

export async function setProductActiveStatus(
  organisationId: string,
  productId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!organisationId || !productId) {
    return { error: 'Active organisation and product ID are required.' };
  }

  const { data, error } = await supabase
    .from('products')
    .update({ is_active: isActive })
    .eq('id', productId)
    .eq('organization_id', organisationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: formatInventoryErrorMessage(
        error,
        isActive ? 'Unable to restore product.' : 'Unable to archive product.',
        'product'
      ),
    };
  }

  if (!data) {
    return {
      error: 'Product status was not changed. Verify your workspace permissions.',
    };
  }

  return { error: null };
}

export async function createProductCategory(
  organisationId: string,
  input: CategoryMutationInput
): Promise<{ categoryId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { categoryId: null, error: 'Supabase client is not configured.' };
  }
  if (!organisationId) {
    return { categoryId: null, error: 'An active organisation is required.' };
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 120) {
    return {
      categoryId: null,
      error: 'Category name must be between 2 and 120 characters.',
    };
  }

  const { data, error } = await supabase
    .from('product_categories')
    .insert({
      organization_id: organisationId,
      parent_id: input.parentId || null,
      name: trimmedName,
      description: input.description?.trim() || null,
    })
    .select('id')
    .single();

  if (error) {
    return {
      categoryId: null,
      error: formatInventoryErrorMessage(error, 'Unable to create category.', 'category'),
    };
  }

  return { categoryId: data?.id ?? null, error: null };
}

export async function updateProductCategory(
  organisationId: string,
  categoryId: string,
  input: CategoryMutationInput
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!organisationId || !categoryId) {
    return { error: 'Active organisation and category ID are required.' };
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 120) {
    return { error: 'Category name must be between 2 and 120 characters.' };
  }

  if (input.parentId && input.parentId === categoryId) {
    return { error: 'A category cannot be its own parent.' };
  }

  const { data, error } = await supabase
    .from('product_categories')
    .update({
      parent_id: input.parentId || null,
      name: trimmedName,
      description: input.description?.trim() || null,
    })
    .eq('id', categoryId)
    .eq('organization_id', organisationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: formatInventoryErrorMessage(error, 'Unable to update category.', 'category'),
    };
  }

  if (!data) {
    return {
      error: 'Category not updated. Verify you have permission and the category belongs to this organisation.',
    };
  }

  return { error: null };
}

export async function createProductVariant(
  organisationId: string,
  input: VariantMutationInput
): Promise<{ variantId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { variantId: null, error: 'Supabase client is not configured.' };
  }
  if (!organisationId || !input.productId) {
    return {
      variantId: null,
      error: 'Active organisation and parent product are required.',
    };
  }

  const trimmedName = input.variantName.trim();
  if (trimmedName.length < 1 || trimmedName.length > 160) {
    return {
      variantId: null,
      error: 'Variant name is required (up to 160 characters).',
    };
  }

  const trimmedSku = input.sku.trim();
  if (trimmedSku.length < 1 || trimmedSku.length > 80) {
    return {
      variantId: null,
      error: 'SKU is required (up to 80 characters).',
    };
  }

  const trimmedUnit = input.unitOfMeasure.trim();
  if (!trimmedUnit) {
    return { variantId: null, error: 'Unit of measure is required.' };
  }

  if (!Number.isFinite(input.costPrice) || input.costPrice < 0) {
    return { variantId: null, error: 'Cost price cannot be negative.' };
  }
  if (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0) {
    return { variantId: null, error: 'Selling price cannot be negative.' };
  }

  const normalizedBarcode = input.barcode?.trim() || null;
  const normalizedAttributes = normalizeAttributes(input.attributes);

  const { data, error } = await supabase
    .from('product_variants')
    .insert({
      organization_id: organisationId,
      product_id: input.productId,
      variant_name: trimmedName,
      sku: trimmedSku,
      barcode: normalizedBarcode,
      unit_of_measure: trimmedUnit,
      cost_price: roundCurrencyValue(input.costPrice),
      selling_price: roundCurrencyValue(input.sellingPrice),
      attributes: normalizedAttributes,
      is_active: input.isActive ?? true,
    })
    .select('id')
    .single();

  if (error) {
    return {
      variantId: null,
      error: formatInventoryErrorMessage(
        error,
        'Unable to create product variant.',
        'variant'
      ),
    };
  }

  return { variantId: data?.id ?? null, error: null };
}

export async function updateProductVariant(
  organisationId: string,
  variantId: string,
  input: Omit<VariantMutationInput, 'productId'>
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!organisationId || !variantId) {
    return { error: 'Active organisation and variant ID are required.' };
  }

  const trimmedName = input.variantName.trim();
  if (trimmedName.length < 1 || trimmedName.length > 160) {
    return { error: 'Variant name is required (up to 160 characters).' };
  }

  const trimmedSku = input.sku.trim();
  if (trimmedSku.length < 1 || trimmedSku.length > 80) {
    return { error: 'SKU is required (up to 80 characters).' };
  }

  const trimmedUnit = input.unitOfMeasure.trim();
  if (!trimmedUnit) {
    return { error: 'Unit of measure is required.' };
  }

  if (!Number.isFinite(input.costPrice) || input.costPrice < 0) {
    return { error: 'Cost price cannot be negative.' };
  }
  if (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0) {
    return { error: 'Selling price cannot be negative.' };
  }

  const normalizedBarcode = input.barcode?.trim() || null;
  const normalizedAttributes = normalizeAttributes(input.attributes);

  const { data, error } = await supabase
    .from('product_variants')
    .update({
      variant_name: trimmedName,
      sku: trimmedSku,
      barcode: normalizedBarcode,
      unit_of_measure: trimmedUnit,
      cost_price: roundCurrencyValue(input.costPrice),
      selling_price: roundCurrencyValue(input.sellingPrice),
      attributes: normalizedAttributes,
      ...(typeof input.isActive === 'boolean' ? { is_active: input.isActive } : {}),
    })
    .eq('id', variantId)
    .eq('organization_id', organisationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: formatInventoryErrorMessage(
        error,
        'Unable to update product variant.',
        'variant'
      ),
    };
  }

  if (!data) {
    return {
      error: 'Variant not updated. Verify you have permission and the variant belongs to this organisation.',
    };
  }

  return { error: null };
}

export async function setVariantActiveStatus(
  organisationId: string,
  variantId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!organisationId || !variantId) {
    return { error: 'Active organisation and variant ID are required.' };
  }

  const { data, error } = await supabase
    .from('product_variants')
    .update({ is_active: isActive })
    .eq('id', variantId)
    .eq('organization_id', organisationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: formatInventoryErrorMessage(
        error,
        isActive ? 'Unable to restore variant.' : 'Unable to archive variant.',
        'variant'
      ),
    };
  }

  if (!data) {
    return {
      error: 'Variant status was not changed. Verify your workspace permissions.',
    };
  }

  return { error: null };
}

export async function createInventoryLocation(
  organisationId: string,
  input: LocationMutationInput
): Promise<{ locationId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { locationId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'location_admin');
  if (!verified.ok) {
    return { locationId: null, error: verified.error };
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 120) {
    return {
      locationId: null,
      error: 'Location name must be between 2 and 120 characters.',
    };
  }

  const normalizedType = normalizeLocationTypeValue(input.locationType);
  const trimmedAddress = input.address?.trim() || null;

  const { data, error } = await supabase
    .from('inventory_locations')
    .insert({
      organization_id: verified.organizationId,
      name: trimmedName,
      location_type: normalizedType,
      address: trimmedAddress,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    return {
      locationId: null,
      error: formatInventoryErrorMessage(
        error,
        'Unable to create inventory location.',
        'location'
      ),
    };
  }

  return { locationId: data?.id ?? null, error: null };
}

export async function updateInventoryLocation(
  organisationId: string,
  locationId: string,
  input: LocationMutationInput
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!locationId) {
    return { error: 'Location ID is required.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'location_admin');
  if (!verified.ok) {
    return { error: verified.error };
  }

  const trimmedName = input.name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 120) {
    return { error: 'Location name must be between 2 and 120 characters.' };
  }

  const normalizedType = normalizeLocationTypeValue(input.locationType);
  const trimmedAddress = input.address?.trim() || null;

  const { data, error } = await supabase
    .from('inventory_locations')
    .update({
      name: trimmedName,
      location_type: normalizedType,
      address: trimmedAddress,
    })
    .eq('id', locationId)
    .eq('organization_id', verified.organizationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: formatInventoryErrorMessage(
        error,
        'Unable to update inventory location.',
        'location'
      ),
    };
  }

  if (!data) {
    return {
      error:
        'Location not updated. Verify you have permission and the location belongs to this organisation.',
    };
  }

  return { error: null };
}

export async function setLocationActiveStatus(
  organisationId: string,
  locationId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }
  if (!locationId) {
    return { error: 'Location ID is required.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'location_admin');
  if (!verified.ok) {
    return { error: verified.error };
  }

  const { data, error } = await supabase
    .from('inventory_locations')
    .update({ is_active: isActive })
    .eq('id', locationId)
    .eq('organization_id', verified.organizationId)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: formatInventoryErrorMessage(
        error,
        isActive ? 'Unable to restore inventory location.' : 'Unable to archive inventory location.',
        'location'
      ),
    };
  }

  if (!data) {
    return {
      error: 'Location status was not changed. Verify your workspace permissions.',
    };
  }

  return { error: null };
}

export async function adjustInventoryStock(
  organisationId: string,
  input: AdjustInventoryStockInput
): Promise<{
  movementId: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  quantityChange: number;
  error: string | null;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      movementId: null,
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: 0,
      error: 'Supabase client is not configured.',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'stock_operator');
  if (!verified.ok) {
    return {
      movementId: null,
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: 0,
      error: verified.error,
    };
  }

  if (!input.variantId || !input.locationId) {
    return {
      movementId: null,
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: 0,
      error: 'Product variant and inventory location are required.',
    };
  }

  const signedQuantityChange = computeSignedQuantityChange(
    input.movementType,
    input.quantity,
    input.adjustmentDirection ?? 'increase'
  );

  if (signedQuantityChange === null || signedQuantityChange === 0) {
    return {
      movementId: null,
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: 0,
      error: 'Quantity must be greater than zero.',
    };
  }

  const trimmedReference = input.reference?.trim() || null;
  const trimmedNotes = input.notes?.trim() || null;

  const { data: movementId, error: rpcError } = await supabase.rpc('adjust_inventory_stock', {
    p_organization_id: verified.organizationId,
    p_variant_id: input.variantId,
    p_location_id: input.locationId,
    p_quantity_change: signedQuantityChange,
    p_movement_type: input.movementType,
    p_reference: trimmedReference,
    p_notes: trimmedNotes,
  });

  if (rpcError) {
    return {
      movementId: null,
      quantityBefore: null,
      quantityAfter: null,
      quantityChange: signedQuantityChange,
      error: rpcError.message || 'Unable to record stock operation.',
    };
  }

  const resolvedMovementId = typeof movementId === 'string' && movementId ? movementId : null;

  let quantityBefore: number | null = null;
  let quantityAfter: number | null = null;

  if (resolvedMovementId) {
    const { data: recordedRow } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('id', resolvedMovementId)
      .eq('organization_id', verified.organizationId)
      .maybeSingle();

    if (recordedRow) {
      const rowObj = recordedRow as Record<string, unknown>;
      quantityBefore = readOptionalNumber(
        rowObj.quantity_before,
        rowObj.before_quantity,
        rowObj.previous_quantity
      );
      quantityAfter = readOptionalNumber(
        rowObj.quantity_after,
        rowObj.after_quantity,
        rowObj.new_quantity
      );
    }
  }

  return {
    movementId: resolvedMovementId,
    quantityBefore,
    quantityAfter,
    quantityChange: signedQuantityChange,
    error: null,
  };
}

export async function updateInventoryReorderLevel(
  organisationId: string,
  input: UpdateReorderLevelInput
): Promise<{ balanceId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { balanceId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'stock_operator');
  if (!verified.ok) {
    return { balanceId: null, error: verified.error };
  }

  if (!input.variantId || !input.locationId) {
    return {
      balanceId: null,
      error: 'Active product variant and inventory location are required.',
    };
  }

  if (!Number.isFinite(input.reorderLevel) || input.reorderLevel < 0) {
    return {
      balanceId: null,
      error: 'Reorder level must be a non-negative number (0 or greater).',
    };
  }

  const { data: balanceId, error: rpcError } = await supabase.rpc(
    'update_inventory_reorder_level',
    {
      p_organization_id: verified.organizationId,
      p_variant_id: input.variantId,
      p_location_id: input.locationId,
      p_reorder_level: input.reorderLevel,
    }
  );

  if (rpcError) {
    return {
      balanceId: null,
      error: rpcError.message || 'Unable to update reorder level.',
    };
  }

  return {
    balanceId: typeof balanceId === 'string' && balanceId ? balanceId : null,
    error: null,
  };
}

export async function createInventoryDraftTransfer(
  organisationId: string,
  input: CreateInventoryTransferDraftInput
): Promise<CreateInventoryTransferDraftResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      transferId: null,
      addedVariantIds: [],
      failedItems: [],
      error: 'Supabase client is not configured.',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'stock_operator');
  if (!verified.ok) {
    return {
      transferId: null,
      addedVariantIds: [],
      failedItems: [],
      error: verified.error,
    };
  }

  if (!input.sourceLocationId || !input.destinationLocationId) {
    return {
      transferId: null,
      addedVariantIds: [],
      failedItems: [],
      error: 'Both source and destination inventory locations are required.',
    };
  }

  if (input.sourceLocationId === input.destinationLocationId) {
    return {
      transferId: null,
      addedVariantIds: [],
      failedItems: [],
      error: 'Source and destination locations must be different.',
    };
  }

  if (input.items.length === 0) {
    return {
      transferId: null,
      addedVariantIds: [],
      failedItems: [],
      error: 'Add at least one product variant to create a draft transfer.',
    };
  }

  const seenVariants = new Set<string>();
  for (const item of input.items) {
    if (!item.variantId) {
      return {
        transferId: null,
        addedVariantIds: [],
        failedItems: [],
        error: 'Each transfer line must select an active product variant.',
      };
    }
    if (seenVariants.has(item.variantId)) {
      return {
        transferId: null,
        addedVariantIds: [],
        failedItems: [],
        error: 'Duplicate product variants are not allowed within the same transfer.',
      };
    }
    seenVariants.add(item.variantId);
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return {
        transferId: null,
        addedVariantIds: [],
        failedItems: [],
        error: 'Transfer quantities must be greater than zero.',
      };
    }
  }

  const trimmedNotes = input.notes?.trim() ? input.notes.trim() : null;

  const { data: createdTransferId, error: createErr } = await supabase.rpc(
    'create_inventory_transfer',
    {
      p_organization_id: verified.organizationId,
      p_source_location_id: input.sourceLocationId,
      p_destination_location_id: input.destinationLocationId,
      p_notes: trimmedNotes,
    }
  );

  if (createErr || typeof createdTransferId !== 'string' || !createdTransferId) {
    return {
      transferId: null,
      addedVariantIds: [],
      failedItems: [],
      error: createErr?.message || 'Unable to create draft stock transfer.',
    };
  }

  const addedVariantIds: string[] = [];
  const failedItems: FailedTransferItemError[] = [];

  for (const item of input.items) {
    const { error: itemErr } = await supabase.rpc('add_inventory_transfer_item', {
      p_organization_id: verified.organizationId,
      p_transfer_id: createdTransferId,
      p_variant_id: item.variantId,
      p_quantity: item.quantity,
    });

    if (itemErr) {
      failedItems.push({
        variantId: item.variantId,
        quantity: item.quantity,
        error: itemErr.message || 'Unable to add transfer item.',
      });
    } else {
      addedVariantIds.push(item.variantId);
    }
  }

  if (failedItems.length > 0) {
    return {
      transferId: createdTransferId,
      addedVariantIds,
      failedItems,
      error: failedItems.map((f) => f.error).join(' | '),
    };
  }

  return {
    transferId: createdTransferId,
    addedVariantIds,
    failedItems: [],
    error: null,
  };
}

export async function addInventoryTransferItem(
  organisationId: string,
  input: AddInventoryTransferItemInput
): Promise<{ itemId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { itemId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'stock_operator');
  if (!verified.ok) {
    return { itemId: null, error: verified.error };
  }

  if (!input.transferId || !input.variantId) {
    return { itemId: null, error: 'Transfer ID and product variant are required.' };
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { itemId: null, error: 'Transfer quantity must be greater than zero.' };
  }

  const { data: itemId, error: rpcError } = await supabase.rpc(
    'add_inventory_transfer_item',
    {
      p_organization_id: verified.organizationId,
      p_transfer_id: input.transferId,
      p_variant_id: input.variantId,
      p_quantity: input.quantity,
    }
  );

  if (rpcError) {
    return {
      itemId: null,
      error: rpcError.message || 'Unable to add item to draft transfer.',
    };
  }

  return {
    itemId: typeof itemId === 'string' && itemId ? itemId : null,
    error: null,
  };
}

export async function completeInventoryTransfer(
  organisationId: string,
  transferId: string
): Promise<{ transferId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { transferId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'stock_operator');
  if (!verified.ok) {
    return { transferId: null, error: verified.error };
  }

  if (!transferId) {
    return { transferId: null, error: 'Transfer ID is required.' };
  }

  const { data: resultId, error: rpcError } = await supabase.rpc(
    'complete_inventory_transfer',
    {
      p_organization_id: verified.organizationId,
      p_transfer_id: transferId,
    }
  );

  if (rpcError) {
    return {
      transferId: null,
      error: rpcError.message || 'Unable to complete stock transfer.',
    };
  }

  return {
    transferId: typeof resultId === 'string' && resultId ? resultId : transferId,
    error: null,
  };
}

export async function cancelInventoryTransfer(
  organisationId: string,
  transferId: string
): Promise<{ transferId: string | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { transferId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'stock_operator');
  if (!verified.ok) {
    return { transferId: null, error: verified.error };
  }

  if (!transferId) {
    return { transferId: null, error: 'Transfer ID is required.' };
  }

  const { data: resultId, error: rpcError } = await supabase.rpc(
    'cancel_inventory_transfer',
    {
      p_organization_id: verified.organizationId,
      p_transfer_id: transferId,
    }
  );

  if (rpcError) {
    return {
      transferId: null,
      error: rpcError.message || 'Unable to cancel stock transfer.',
    };
  }

  return {
    transferId: typeof resultId === 'string' && resultId ? resultId : transferId,
    error: null,
  };
}

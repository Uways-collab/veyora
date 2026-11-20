import { getSupabaseClient } from '../../core/supabase/client';
import {
  calculateStockStatus,
  calculateVariantProfit,
  fetchInventoryOverview,
  formatUnitOfMeasureLabel,
  mapStockMovementRow,
  summarizeReplenishmentAlerts,
  verifyActiveWorkspaceContext,
  type InventoryBalanceRecord,
  type InventoryLocationRecord,
  type InventoryMovementRecord,
  type InventoryOverviewData,
  type InventoryProductRecord,
  type InventoryTransferRecord,
  type InventoryVariantRecord,
  type StockTransferStatusValue,
} from '../inventory/inventoryService';

export const DEFAULT_MOVEMENT_REPORT_LIMIT = 250;
export const MAX_MOVEMENT_REPORT_LIMIT = 1000;

export interface UnitQuantityBreakdown {
  unitOfMeasure: string;
  unitLabel: string;
  totalQuantity: number;
}

export interface UnitQuantitySummary {
  totalUnits: number;
  hasMixedUnits: boolean;
  distinctUnitsCount: number;
  breakdown: UnitQuantityBreakdown[];
}

export interface InventorySummaryLocationRow {
  locationId: string;
  locationName: string;
  locationType: string;
  isActive: boolean;
  balanceRowCount: number;
  unitQuantities: UnitQuantitySummary;
  estimatedCostValue: number;
  estimatedRetailValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface InventorySummaryReport {
  organisationId: string;
  generatedAt: string;
  isPointInTimeEstimate: true;
  valuationNote: string;
  catalog: {
    activeProductCount: number;
    totalProductCount: number;
    activePhysicalProductCount: number;
    activeServiceProductCount: number;
    activeVariantCount: number;
    totalVariantCount: number;
    activeCategoryCount: number;
    activeLocationCount: number;
    totalLocationCount: number;
  };
  balances: {
    activeBalanceRowCount: number;
    archivedProductBalanceCount: number;
    stockedVariantCount: number;
    unitQuantities: UnitQuantitySummary;
    estimatedCostValue: number;
    estimatedRetailValue: number;
    estimatedGrossProfit: number;
    lowStockCount: number;
    outOfStockCount: number;
    needingReplenishmentCount: number;
  };
  byLocation: InventorySummaryLocationRow[];
  activitySnapshot: {
    draftTransferCount: number;
    completedTransferCount: number;
    cancelledTransferCount: number;
    totalTransferCount: number;
    totalMovementsCount: number | null;
    recentMovementsLoadedCount: number;
    movementsCappedInOverview: boolean;
    activityNote: string;
  };
}

export interface StockValuationFilters {
  locationId?: string;
  categoryId?: string;
  includeArchived?: boolean;
  includeZeroQuantity?: boolean;
  search?: string;
}

export interface StockValuationRow {
  balanceId: string;
  organizationId: string;
  productId: string | null;
  productName: string;
  categoryId: string | null;
  categoryName: string;
  categoryPath: string;
  variantId: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  costPrice: number;
  sellingPrice: number;
  estimatedCostValue: number;
  estimatedRetailValue: number;
  estimatedMarginValue: number;
  estimatedMarginPercent: number | null;
  isActiveCatalogAndLocation: boolean;
  updatedAt: string;
}

export interface StockValuationGroupRow {
  groupId: string;
  groupName: string;
  groupMeta: string;
  balanceRowCount: number;
  unitQuantities: UnitQuantitySummary;
  estimatedCostValue: number;
  estimatedRetailValue: number;
  estimatedMarginValue: number;
}

export interface StockValuationReport {
  organisationId: string;
  isPointInTimeEstimate: true;
  valuationNote: string;
  rows: StockValuationRow[];
  byLocation: StockValuationGroupRow[];
  byCategory: StockValuationGroupRow[];
  totals: {
    rowCount: number;
    distinctVariantCount: number;
    unitQuantities: UnitQuantitySummary;
    estimatedCostValue: number;
    estimatedRetailValue: number;
    estimatedMarginValue: number;
    estimatedMarginPercent: number | null;
  };
}

export interface ReportingTimezoneInfo {
  timeZone: string;
  source: 'organisation' | 'browser';
}

export interface StockMovementReportFilters {
  fromDate?: string;
  toDate?: string;
  timeZone?: string;
  locationId?: string;
  movementType?: string;
  limit?: number;
  offset?: number;
}

export interface StockMovementTypeSummaryRow {
  movementTypeValue: string;
  movementTypeLabel: string;
  movementCount: number;
  inboundCount: number;
  outboundCount: number;
  inboundUnits: UnitQuantitySummary;
  outboundUnits: UnitQuantitySummary;
  netUnits: UnitQuantitySummary;
}

export interface StockMovementReportSummary {
  movementCount: number;
  inboundCount: number;
  outboundCount: number;
  inboundUnits: UnitQuantitySummary;
  outboundUnits: UnitQuantitySummary;
  netUnits: UnitQuantitySummary;
  byMovementType: StockMovementTypeSummaryRow[];
}

export interface StockMovementReportResult {
  organisationId: string;
  movements: InventoryMovementRecord[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  isLimited: boolean;
  appliedTimeZone: string;
  fromUtcIso: string | null;
  toUtcIso: string | null;
  summary: StockMovementReportSummary;
  error: string | null;
}

export interface StockTransferReportFilters {
  status?: 'all' | StockTransferStatusValue;
  sourceLocationId?: string;
  destinationLocationId?: string;
  fromDate?: string;
  toDate?: string;
  timeZone?: string;
  search?: string;
}

export interface StockTransferReportRow {
  transfer: InventoryTransferRecord;
  unitQuantities: UnitQuantitySummary;
  estimatedCostValue: number;
}

export interface StockTransferRouteSummaryRow {
  routeKey: string;
  sourceLocationId: string;
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  transferCount: number;
  draftCount: number;
  completedCount: number;
  cancelledCount: number;
  completedUnits: UnitQuantitySummary;
}

export interface StockTransferReport {
  organisationId: string;
  rows: StockTransferReportRow[];
  byRoute: StockTransferRouteSummaryRow[];
  totals: {
    totalTransfers: number;
    draftCount: number;
    completedCount: number;
    cancelledCount: number;
    totalLineItems: number;
    requestedUnits: UnitQuantitySummary;
    completedUnits: UnitQuantitySummary;
    estimatedCompletedCostValue: number;
  };
}

export interface LowStockReportFilters {
  severity?: 'all_alerts' | 'low_stock' | 'out_of_stock';
  locationId?: string;
  categoryId?: string;
  includeArchived?: boolean;
  search?: string;
}

export interface LowStockReportRow {
  balanceId: string;
  organizationId: string;
  productId: string | null;
  productName: string;
  categoryId: string | null;
  categoryName: string;
  categoryPath: string;
  variantId: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationId: string;
  locationName: string;
  locationType: string;
  quantity: number;
  reorderLevel: number;
  shortfallToReorder: number;
  costPrice: number;
  estimatedRestockCost: number;
  stockStatus: 'low_stock' | 'out_of_stock';
  stockStatusLabel: string;
  isActiveCatalogAndLocation: boolean;
  updatedAt: string;
}

export interface LowStockOutOfStockReport {
  organisationId: string;
  rows: LowStockReportRow[];
  totals: {
    alertCount: number;
    lowStockCount: number;
    outOfStockCount: number;
    shortfallUnits: UnitQuantitySummary;
    estimatedRestockCost: number;
  };
}

export function aggregateUnitQuantities(
  entries: Array<{ unitOfMeasure: string; quantity: number }>
): UnitQuantitySummary {
  const byUnit = new Map<string, number>();
  let totalUnits = 0;

  for (const entry of entries) {
    const qty = Number.isFinite(entry.quantity) ? entry.quantity : 0;
    const normalizedUnit = (entry.unitOfMeasure || 'piece').trim().toLowerCase() || 'piece';
    totalUnits += qty;
    byUnit.set(normalizedUnit, (byUnit.get(normalizedUnit) ?? 0) + qty);
  }

  const breakdown: UnitQuantityBreakdown[] = Array.from(byUnit.entries())
    .map(([unitOfMeasure, totalQuantity]) => ({
      unitOfMeasure,
      unitLabel: formatUnitOfMeasureLabel(unitOfMeasure),
      totalQuantity,
    }))
    .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel));

  return {
    totalUnits,
    hasMixedUnits: breakdown.length > 1,
    distinctUnitsCount: breakdown.length,
    breakdown,
  };
}

export function resolveReportingTimezone(
  organisationTimezone?: string | null
): ReportingTimezoneInfo {
  const orgCandidate = (organisationTimezone ?? '').trim();
  if (orgCandidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: orgCandidate }).format(new Date());
      return { timeZone: orgCandidate, source: 'organisation' };
    } catch {
      // Fall back to browser local timezone if organisation timezone is not a valid IANA zone
    }
  }

  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTz) {
      new Intl.DateTimeFormat('en-US', { timeZone: browserTz }).format(new Date());
      return { timeZone: browserTz, source: 'browser' };
    }
  } catch {
    // Fall back to UTC if browser Intl API is unavailable
  }

  return { timeZone: 'UTC', source: 'browser' };
}

function getTimeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const raw = parts.find((p) => p.type === type)?.value ?? '0';
    return Number.parseInt(raw, 10);
  };
  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  const hour = lookup('hour') === 24 ? 0 : lookup('hour');
  const minute = lookup('minute');
  const second = lookup('second');

  const asUtcSeconds = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const wholeSecondsUtc = Math.floor(utcMs / 1000) * 1000;
  return asUtcSeconds - wholeSecondsUtc;
}

export function zonedDateBoundaryToUtcMs(
  dateStr: string | undefined,
  boundary: 'start' | 'end',
  timeZone: string
): number | null {
  const clean = (dateStr ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const hour = boundary === 'start' ? 0 : 23;
  const minute = boundary === 'start' ? 0 : 59;
  const second = boundary === 'start' ? 0 : 59;
  const ms = boundary === 'start' ? 0 : 999;

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);

  try {
    const offset1 = getTimeZoneOffsetMs(naiveUtcMs, timeZone);
    const guess1 = naiveUtcMs - offset1;
    const offset2 = getTimeZoneOffsetMs(guess1, timeZone);
    return naiveUtcMs - offset2;
  } catch {
    return naiveUtcMs;
  }
}

export function zonedDateBoundaryToUtcIso(
  dateStr: string | undefined,
  boundary: 'start' | 'end',
  timeZone: string
): string | null {
  const ms = zonedDateBoundaryToUtcMs(dateStr, boundary, timeZone);
  return ms !== null ? new Date(ms).toISOString() : null;
}

export async function fetchInventoryReportsBaseData(
  organisationId: string
): Promise<{
  data: InventoryOverviewData | null;
  totalMovementsCount: number | null;
  error: string | null;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: null,
      totalMovementsCount: null,
      error: 'Supabase client is not configured.',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { data: null, totalMovementsCount: null, error: verified.error };
  }

  const [data, countRes] = await Promise.all([
    fetchInventoryOverview(verified.organizationId),
    supabase
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', verified.organizationId),
  ]);

  const totalMovementsCount =
    !countRes.error && typeof countRes.count === 'number' ? countRes.count : null;

  return { data, totalMovementsCount, error: null };
}

export function buildInventorySummaryReport(
  data: InventoryOverviewData,
  organisationId: string,
  totalMovementsCount: number | null = null
): InventorySummaryReport {
  const products = data.products.filter((p) => p.organizationId === organisationId);
  const categories = data.categories.filter((c) => c.organizationId === organisationId);
  const variants = data.variants.filter((v) => v.organizationId === organisationId);
  const locations = data.locations.filter((l) => l.organizationId === organisationId);
  const balances = data.balances.filter((b) => b.organizationId === organisationId);
  const movements = data.movements.filter((m) => m.organizationId === organisationId);
  const transfers = data.transfers.filter((t) => t.organizationId === organisationId);

  const variantById = new Map(variants.map((v) => [v.id, v]));
  const activeBalances = balances.filter((b) => b.productIsActive);
  const archivedProductBalanceCount = balances.length - activeBalances.length;

  let estimatedCostValue = 0;
  let estimatedRetailValue = 0;
  const stockedVariantIds = new Set<string>();
  const unitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];

  for (const row of activeBalances) {
    const variant = variantById.get(row.variantId);
    const sellingPrice = variant?.sellingPrice ?? 0;
    estimatedCostValue += row.quantity * row.costPrice;
    estimatedRetailValue += row.quantity * sellingPrice;
    unitEntries.push({ unitOfMeasure: row.unitOfMeasure, quantity: row.quantity });
    if (row.quantity > 0) {
      stockedVariantIds.add(row.variantId);
    }
  }

  const replenishment = summarizeReplenishmentAlerts(activeBalances);

  const balancesByLocation = new Map<string, InventoryBalanceRecord[]>();
  for (const row of activeBalances) {
    const list = balancesByLocation.get(row.locationId);
    if (list) list.push(row);
    else balancesByLocation.set(row.locationId, [row]);
  }

  const byLocation: InventorySummaryLocationRow[] = locations
    .map((loc) => {
      const locRows = balancesByLocation.get(loc.id) ?? [];
      let locCost = 0;
      let locRetail = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;
      const locUnits: Array<{ unitOfMeasure: string; quantity: number }> = [];

      for (const row of locRows) {
        const variant = variantById.get(row.variantId);
        locCost += row.quantity * row.costPrice;
        locRetail += row.quantity * (variant?.sellingPrice ?? 0);
        locUnits.push({ unitOfMeasure: row.unitOfMeasure, quantity: row.quantity });
        if (row.stockStatus === 'low_stock') lowStockCount += 1;
        else if (row.stockStatus === 'out_of_stock') outOfStockCount += 1;
      }

      return {
        locationId: loc.id,
        locationName: loc.name,
        locationType: loc.locationType,
        isActive: loc.isActive,
        balanceRowCount: locRows.length,
        unitQuantities: aggregateUnitQuantities(locUnits),
        estimatedCostValue: locCost,
        estimatedRetailValue: locRetail,
        lowStockCount,
        outOfStockCount,
      };
    })
    .sort((a, b) => b.estimatedCostValue - a.estimatedCostValue || a.locationName.localeCompare(b.locationName));

  let draftTransferCount = 0;
  let completedTransferCount = 0;
  let cancelledTransferCount = 0;
  for (const t of transfers) {
    if (t.status === 'draft') draftTransferCount += 1;
    else if (t.status === 'completed') completedTransferCount += 1;
    else if (t.status === 'cancelled') cancelledTransferCount += 1;
  }

  const activeProducts = products.filter((p) => p.isActive);
  const movementsCappedInOverview =
    totalMovementsCount !== null
      ? totalMovementsCount > movements.length
      : movements.length >= 200;

  const activityNote =
    totalMovementsCount !== null
      ? `Total count (${totalMovementsCount}) is queried directly from public.stock_movements without loading full history; the overview snapshot loads up to 200 recent movements (${movements.length} loaded). Use Stock Movements for date-filtered history.`
      : `Overview snapshot loads up to 200 recent stock movements (${movements.length} loaded). Use Stock Movements for full date-filtered history.`;

  return {
    organisationId,
    generatedAt: new Date().toISOString(),
    isPointInTimeEstimate: true,
    valuationNote:
      'Estimated current point-in-time inventory valuation calculated from current on-hand balances and current variant cost/selling prices. No historical snapshots exist.',
    catalog: {
      activeProductCount: activeProducts.length,
      totalProductCount: products.length,
      activePhysicalProductCount: activeProducts.filter((p) => p.productTypeValue === 'physical').length,
      activeServiceProductCount: activeProducts.filter((p) => p.productTypeValue === 'service').length,
      activeVariantCount: variants.filter((v) => v.isActive).length,
      totalVariantCount: variants.length,
      activeCategoryCount: categories.filter((c) => c.isActive).length,
      activeLocationCount: locations.filter((l) => l.isActive).length,
      totalLocationCount: locations.length,
    },
    balances: {
      activeBalanceRowCount: activeBalances.length,
      archivedProductBalanceCount,
      stockedVariantCount: stockedVariantIds.size,
      unitQuantities: aggregateUnitQuantities(unitEntries),
      estimatedCostValue,
      estimatedRetailValue,
      estimatedGrossProfit: estimatedRetailValue - estimatedCostValue,
      lowStockCount: replenishment.lowStockCount,
      outOfStockCount: replenishment.outOfStockCount,
      needingReplenishmentCount: replenishment.needingReplenishmentCount,
    },
    byLocation,
    activitySnapshot: {
      draftTransferCount,
      completedTransferCount,
      cancelledTransferCount,
      totalTransferCount: transfers.length,
      totalMovementsCount,
      recentMovementsLoadedCount: movements.length,
      movementsCappedInOverview,
      activityNote,
    },
  };
}

export function buildStockValuationReport(
  data: InventoryOverviewData,
  organisationId: string,
  filters: StockValuationFilters = {}
): StockValuationReport {
  const products = data.products.filter((p) => p.organizationId === organisationId);
  const variants = data.variants.filter((v) => v.organizationId === organisationId);
  const balances = data.balances.filter((b) => b.organizationId === organisationId);

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const includeArchived = Boolean(filters.includeArchived);
  const includeZeroQuantity = Boolean(filters.includeZeroQuantity);
  const locationFilter = filters.locationId && filters.locationId !== 'all' ? filters.locationId : null;
  const categoryFilter = filters.categoryId && filters.categoryId !== 'all' ? filters.categoryId : null;
  const q = (filters.search ?? '').trim().toLowerCase();

  const rows: StockValuationRow[] = [];

  for (const b of balances) {
    const isActiveAll = b.productIsActive && b.variantIsActive && b.locationIsActive;
    if (!includeArchived && !isActiveAll) continue;
    if (!includeZeroQuantity && b.quantity <= 0) continue;
    if (locationFilter && b.locationId !== locationFilter) continue;

    const variant = variantById.get(b.variantId);
    const product = b.productId ? productById.get(b.productId) : undefined;
    const categoryId = product?.categoryId ?? null;

    if (categoryFilter) {
      if (categoryFilter === 'uncategorized') {
        if (categoryId !== null) continue;
      } else if (categoryId !== categoryFilter) {
        continue;
      }
    }

    if (q) {
      const haystack = [
        b.productName,
        b.variantName,
        b.sku,
        b.locationName,
        product?.categoryPath ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) continue;
    }

    const costPrice = variant?.costPrice ?? b.costPrice;
    const sellingPrice = variant?.sellingPrice ?? 0;
    const estimatedCostValue = b.quantity * costPrice;
    const estimatedRetailValue = b.quantity * sellingPrice;
    const estimatedMarginValue = estimatedRetailValue - estimatedCostValue;
    const profitMetrics = calculateVariantProfit(costPrice, sellingPrice);

    rows.push({
      balanceId: b.id,
      organizationId: b.organizationId,
      productId: b.productId,
      productName: b.productName,
      categoryId,
      categoryName: product?.categoryName ?? 'Uncategorized',
      categoryPath: product?.categoryPath ?? 'Uncategorized',
      variantId: b.variantId,
      variantName: b.variantName,
      sku: b.sku,
      unitOfMeasure: b.unitOfMeasure,
      locationId: b.locationId,
      locationName: b.locationName,
      locationType: b.locationType,
      quantity: b.quantity,
      costPrice,
      sellingPrice,
      estimatedCostValue,
      estimatedRetailValue,
      estimatedMarginValue,
      estimatedMarginPercent: profitMetrics.marginPercent,
      isActiveCatalogAndLocation: isActiveAll,
      updatedAt: b.updatedAt,
    });
  }

  rows.sort((a, b) => b.estimatedCostValue - a.estimatedCostValue || a.productName.localeCompare(b.productName));

  const groupMapByLocation = new Map<
    string,
    { name: string; meta: string; rows: StockValuationRow[] }
  >();
  const groupMapByCategory = new Map<
    string,
    { name: string; meta: string; rows: StockValuationRow[] }
  >();

  let totalCost = 0;
  let totalRetail = 0;
  const distinctVariants = new Set<string>();
  const allUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];

  for (const r of rows) {
    totalCost += r.estimatedCostValue;
    totalRetail += r.estimatedRetailValue;
    distinctVariants.add(r.variantId);
    allUnitEntries.push({ unitOfMeasure: r.unitOfMeasure, quantity: r.quantity });

    const locGroup = groupMapByLocation.get(r.locationId);
    if (locGroup) locGroup.rows.push(r);
    else {
      groupMapByLocation.set(r.locationId, {
        name: r.locationName,
        meta: r.locationType,
        rows: [r],
      });
    }

    const catKey = r.categoryId ?? 'uncategorized';
    const catGroup = groupMapByCategory.get(catKey);
    if (catGroup) catGroup.rows.push(r);
    else {
      groupMapByCategory.set(catKey, {
        name: r.categoryPath,
        meta: r.categoryName,
        rows: [r],
      });
    }
  }

  const buildGroups = (
    map: Map<string, { name: string; meta: string; rows: StockValuationRow[] }>
  ): StockValuationGroupRow[] =>
    Array.from(map.entries())
      .map(([groupId, group]) => {
        let costVal = 0;
        let retailVal = 0;
        const unitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
        for (const item of group.rows) {
          costVal += item.estimatedCostValue;
          retailVal += item.estimatedRetailValue;
          unitEntries.push({ unitOfMeasure: item.unitOfMeasure, quantity: item.quantity });
        }
        return {
          groupId,
          groupName: group.name,
          groupMeta: group.meta,
          balanceRowCount: group.rows.length,
          unitQuantities: aggregateUnitQuantities(unitEntries),
          estimatedCostValue: costVal,
          estimatedRetailValue: retailVal,
          estimatedMarginValue: retailVal - costVal,
        };
      })
      .sort((a, b) => b.estimatedCostValue - a.estimatedCostValue || a.groupName.localeCompare(b.groupName));

  const totalMargin = totalRetail - totalCost;
  const estimatedMarginPercent = totalRetail > 0 ? (totalMargin / totalRetail) * 100 : null;

  return {
    organisationId,
    isPointInTimeEstimate: true,
    valuationNote:
      'Estimated current point-in-time valuation calculated from live inventory_balances × current product_variants cost and selling prices.',
    rows,
    byLocation: buildGroups(groupMapByLocation),
    byCategory: buildGroups(groupMapByCategory),
    totals: {
      rowCount: rows.length,
      distinctVariantCount: distinctVariants.size,
      unitQuantities: aggregateUnitQuantities(allUnitEntries),
      estimatedCostValue: totalCost,
      estimatedRetailValue: totalRetail,
      estimatedMarginValue: totalMargin,
      estimatedMarginPercent,
    },
  };
}

export function summarizeStockMovements(
  movements: InventoryMovementRecord[]
): StockMovementReportSummary {
  let inboundCount = 0;
  let outboundCount = 0;
  const inboundUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
  const outboundUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
  const netUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];

  const typeMap = new Map<
    string,
    {
      label: string;
      rows: InventoryMovementRecord[];
    }
  >();

  for (const m of movements) {
    netUnitEntries.push({ unitOfMeasure: m.unitOfMeasure, quantity: m.quantityChange });
    if (m.quantityChange >= 0) {
      inboundCount += 1;
      inboundUnitEntries.push({ unitOfMeasure: m.unitOfMeasure, quantity: m.quantityChange });
    } else {
      outboundCount += 1;
      outboundUnitEntries.push({
        unitOfMeasure: m.unitOfMeasure,
        quantity: Math.abs(m.quantityChange),
      });
    }

    const typeKey = m.movementTypeValue || 'unspecified';
    const existing = typeMap.get(typeKey);
    if (existing) existing.rows.push(m);
    else typeMap.set(typeKey, { label: m.movementTypeLabel, rows: [m] });
  }

  const byMovementType: StockMovementTypeSummaryRow[] = Array.from(typeMap.entries())
    .map(([movementTypeValue, entry]) => {
      let typeInboundCount = 0;
      let typeOutboundCount = 0;
      const inEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
      const outEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
      const netEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];

      for (const r of entry.rows) {
        netEntries.push({ unitOfMeasure: r.unitOfMeasure, quantity: r.quantityChange });
        if (r.quantityChange >= 0) {
          typeInboundCount += 1;
          inEntries.push({ unitOfMeasure: r.unitOfMeasure, quantity: r.quantityChange });
        } else {
          typeOutboundCount += 1;
          outEntries.push({ unitOfMeasure: r.unitOfMeasure, quantity: Math.abs(r.quantityChange) });
        }
      }

      return {
        movementTypeValue,
        movementTypeLabel: entry.label,
        movementCount: entry.rows.length,
        inboundCount: typeInboundCount,
        outboundCount: typeOutboundCount,
        inboundUnits: aggregateUnitQuantities(inEntries),
        outboundUnits: aggregateUnitQuantities(outEntries),
        netUnits: aggregateUnitQuantities(netEntries),
      };
    })
    .sort((a, b) => b.movementCount - a.movementCount || a.movementTypeLabel.localeCompare(b.movementTypeLabel));

  return {
    movementCount: movements.length,
    inboundCount,
    outboundCount,
    inboundUnits: aggregateUnitQuantities(inboundUnitEntries),
    outboundUnits: aggregateUnitQuantities(outboundUnitEntries),
    netUnits: aggregateUnitQuantities(netUnitEntries),
    byMovementType,
  };
}

export async function fetchStockMovementReport(
  organisationId: string,
  filters: StockMovementReportFilters = {},
  lookups?: {
    products: InventoryProductRecord[];
    variants: InventoryVariantRecord[];
    locations: InventoryLocationRecord[];
  }
): Promise<StockMovementReportResult> {
  const safeLimit = Math.min(
    Math.max(1, Math.floor(filters.limit ?? DEFAULT_MOVEMENT_REPORT_LIMIT)),
    MAX_MOVEMENT_REPORT_LIMIT
  );
  const safeOffset = Math.max(0, Math.floor(filters.offset ?? 0));

  const appliedTimeZone = resolveReportingTimezone(filters.timeZone).timeZone;
  const fromUtcIso = zonedDateBoundaryToUtcIso(filters.fromDate, 'start', appliedTimeZone);
  const toUtcIso = zonedDateBoundaryToUtcIso(filters.toDate, 'end', appliedTimeZone);

  const emptyResult = (error: string | null): StockMovementReportResult => ({
    organisationId,
    movements: [],
    totalCount: 0,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: false,
    isLimited: false,
    appliedTimeZone,
    fromUtcIso,
    toUtcIso,
    summary: summarizeStockMovements([]),
    error,
  });

  const supabase = getSupabaseClient();
  if (!supabase) {
    return emptyResult('Supabase client is not configured.');
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return emptyResult(verified.error);
  }

  const orgId = verified.organizationId;

  // Build product/variant/location lookup maps (reuse provided data when available)
  let productList = lookups?.products.filter((p) => p.organizationId === orgId) ?? null;
  let variantList = lookups?.variants.filter((v) => v.organizationId === orgId) ?? null;
  let locationList = lookups?.locations.filter((l) => l.organizationId === orgId) ?? null;

  if (!productList || !variantList || !locationList) {
    const overview = await fetchInventoryOverview(orgId);
    productList = overview.products.filter((p) => p.organizationId === orgId);
    variantList = overview.variants.filter((v) => v.organizationId === orgId);
    locationList = overview.locations.filter((l) => l.organizationId === orgId);
  }

  const productById = new Map(productList.map((p) => [p.id, p]));
  const variantById = new Map(variantList.map((v) => [v.id, v]));
  const locationById = new Map(locationList.map((l) => [l.id, l]));

  let query = supabase
    .from('stock_movements')
    .select('*', { count: 'exact' })
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });

  if (fromUtcIso) {
    query = query.gte('created_at', fromUtcIso);
  }

  if (toUtcIso) {
    query = query.lte('created_at', toUtcIso);
  }

  if (filters.locationId && filters.locationId !== 'all') {
    query = query.eq('location_id', filters.locationId);
  }

  if (filters.movementType && filters.movementType !== 'all') {
    query = query.eq('movement_type', filters.movementType);
  }

  const { data: rawRows, count, error: queryError } = await query.range(
    safeOffset,
    safeOffset + safeLimit - 1
  );

  if (queryError) {
    return emptyResult(queryError.message || 'Unable to load stock movement report.');
  }

  const scopedRows = ((rawRows ?? []) as Record<string, unknown>[]).filter(
    (row) => row.organization_id === orgId
  );

  const actorIds = Array.from(
    new Set(
      scopedRows
        .map((row) => {
          const candidates = [
            row.performed_by,
            row.created_by,
            row.actor_user_id,
            row.user_id,
          ];
          for (const val of candidates) {
            if (typeof val === 'string' && val.trim().length > 0) return val.trim();
          }
          return null;
        })
        .filter((id): id is string => Boolean(id))
    )
  );

  const profileMap = new Map<string, { fullName: string | null; email: string }>();
  if (actorIds.length > 0) {
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', actorIds);

    for (const p of profileRows ?? []) {
      profileMap.set(p.id, { fullName: p.full_name, email: p.email });
    }
  }

  const movements = scopedRows.map((row) =>
    mapStockMovementRow(row, orgId, productById, variantById, locationById, profileMap)
  );

  const totalCount = typeof count === 'number' ? count : movements.length;
  const hasMore = safeOffset + movements.length < totalCount;
  const isLimited = totalCount > movements.length;

  return {
    organisationId: orgId,
    movements,
    totalCount,
    limit: safeLimit,
    offset: safeOffset,
    hasMore,
    isLimited,
    appliedTimeZone,
    fromUtcIso,
    toUtcIso,
    summary: summarizeStockMovements(movements),
    error: null,
  };
}

export function buildStockTransferReport(
  data: InventoryOverviewData,
  organisationId: string,
  filters: StockTransferReportFilters = {}
): StockTransferReport {
  const transfers = data.transfers.filter((t) => t.organizationId === organisationId);
  const variants = data.variants.filter((v) => v.organizationId === organisationId);
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const statusFilter = filters.status ?? 'all';
  const sourceFilter =
    filters.sourceLocationId && filters.sourceLocationId !== 'all'
      ? filters.sourceLocationId
      : null;
  const destFilter =
    filters.destinationLocationId && filters.destinationLocationId !== 'all'
      ? filters.destinationLocationId
      : null;
  const appliedTimeZone = resolveReportingTimezone(filters.timeZone).timeZone;
  const fromMs = zonedDateBoundaryToUtcMs(filters.fromDate, 'start', appliedTimeZone);
  const toMs = zonedDateBoundaryToUtcMs(filters.toDate, 'end', appliedTimeZone);
  const q = (filters.search ?? '').trim().toLowerCase();

  const rows: StockTransferReportRow[] = [];
  const routeMap = new Map<
    string,
    {
      sourceLocationId: string;
      sourceLocationName: string;
      destinationLocationId: string;
      destinationLocationName: string;
      rows: StockTransferReportRow[];
    }
  >();

  let draftCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let totalLineItems = 0;
  let estimatedCompletedCostValue = 0;
  const requestedUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
  const completedUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];

  for (const transfer of transfers) {
    if (statusFilter !== 'all' && transfer.status !== statusFilter) continue;
    if (sourceFilter && transfer.sourceLocationId !== sourceFilter) continue;
    if (destFilter && transfer.destinationLocationId !== destFilter) continue;

    const createdMs = Date.parse(transfer.createdAt);
    if (fromMs !== null && Number.isFinite(createdMs) && createdMs < fromMs) continue;
    if (toMs !== null && Number.isFinite(createdMs) && createdMs > toMs) continue;

    if (q) {
      const haystack = [
        transfer.referenceCode,
        transfer.id,
        transfer.sourceLocationName,
        transfer.destinationLocationName,
        transfer.notes ?? '',
        transfer.createdByName ?? '',
        transfer.completedByName ?? '',
        ...transfer.items.map((i) => `${i.productName} ${i.variantName} ${i.sku}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) continue;
    }

    const lineUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];
    let transferCost = 0;

    for (const item of transfer.items) {
      const variant = variantById.get(item.variantId);
      const itemCost = (variant?.costPrice ?? 0) * item.quantity;
      transferCost += itemCost;
      lineUnitEntries.push({ unitOfMeasure: item.unitOfMeasure, quantity: item.quantity });
      requestedUnitEntries.push({ unitOfMeasure: item.unitOfMeasure, quantity: item.quantity });
      if (transfer.status === 'completed') {
        completedUnitEntries.push({ unitOfMeasure: item.unitOfMeasure, quantity: item.quantity });
      }
    }

    totalLineItems += transfer.items.length;
    if (transfer.status === 'draft') draftCount += 1;
    else if (transfer.status === 'completed') {
      completedCount += 1;
      estimatedCompletedCostValue += transferCost;
    } else if (transfer.status === 'cancelled') {
      cancelledCount += 1;
    }

    const reportRow: StockTransferReportRow = {
      transfer,
      unitQuantities: aggregateUnitQuantities(lineUnitEntries),
      estimatedCostValue: transferCost,
    };
    rows.push(reportRow);

    const routeKey = `${transfer.sourceLocationId}->${transfer.destinationLocationId}`;
    const routeEntry = routeMap.get(routeKey);
    if (routeEntry) {
      routeEntry.rows.push(reportRow);
    } else {
      routeMap.set(routeKey, {
        sourceLocationId: transfer.sourceLocationId,
        sourceLocationName: transfer.sourceLocationName,
        destinationLocationId: transfer.destinationLocationId,
        destinationLocationName: transfer.destinationLocationName,
        rows: [reportRow],
      });
    }
  }

  const byRoute: StockTransferRouteSummaryRow[] = Array.from(routeMap.entries())
    .map(([routeKey, group]) => {
      let rDraft = 0;
      let rCompleted = 0;
      let rCancelled = 0;
      const rCompletedUnits: Array<{ unitOfMeasure: string; quantity: number }> = [];

      for (const r of group.rows) {
        if (r.transfer.status === 'draft') rDraft += 1;
        else if (r.transfer.status === 'completed') {
          rCompleted += 1;
          for (const item of r.transfer.items) {
            rCompletedUnits.push({
              unitOfMeasure: item.unitOfMeasure,
              quantity: item.quantity,
            });
          }
        } else if (r.transfer.status === 'cancelled') {
          rCancelled += 1;
        }
      }

      return {
        routeKey,
        sourceLocationId: group.sourceLocationId,
        sourceLocationName: group.sourceLocationName,
        destinationLocationId: group.destinationLocationId,
        destinationLocationName: group.destinationLocationName,
        transferCount: group.rows.length,
        draftCount: rDraft,
        completedCount: rCompleted,
        cancelledCount: rCancelled,
        completedUnits: aggregateUnitQuantities(rCompletedUnits),
      };
    })
    .sort((a, b) => b.transferCount - a.transferCount || a.sourceLocationName.localeCompare(b.sourceLocationName));

  return {
    organisationId,
    rows,
    byRoute,
    totals: {
      totalTransfers: rows.length,
      draftCount,
      completedCount,
      cancelledCount,
      totalLineItems,
      requestedUnits: aggregateUnitQuantities(requestedUnitEntries),
      completedUnits: aggregateUnitQuantities(completedUnitEntries),
      estimatedCompletedCostValue,
    },
  };
}

export function buildLowStockOutOfStockReport(
  data: InventoryOverviewData,
  organisationId: string,
  filters: LowStockReportFilters = {}
): LowStockOutOfStockReport {
  const products = data.products.filter((p) => p.organizationId === organisationId);
  const balances = data.balances.filter((b) => b.organizationId === organisationId);
  const productById = new Map(products.map((p) => [p.id, p]));

  const severity = filters.severity ?? 'all_alerts';
  const includeArchived = Boolean(filters.includeArchived);
  const locationFilter = filters.locationId && filters.locationId !== 'all' ? filters.locationId : null;
  const categoryFilter = filters.categoryId && filters.categoryId !== 'all' ? filters.categoryId : null;
  const q = (filters.search ?? '').trim().toLowerCase();

  const rows: LowStockReportRow[] = [];
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let estimatedRestockCost = 0;
  const shortfallUnitEntries: Array<{ unitOfMeasure: string; quantity: number }> = [];

  for (const b of balances) {
    const isActiveAll = b.productIsActive && b.variantIsActive && b.locationIsActive;
    if (!includeArchived && !isActiveAll) continue;
    if (locationFilter && b.locationId !== locationFilter) continue;

    const statusMeta = calculateStockStatus(b.quantity, b.reorderLevel);
    if (statusMeta.status === 'in_stock') continue;
    if (severity === 'low_stock' && statusMeta.status !== 'low_stock') continue;
    if (severity === 'out_of_stock' && statusMeta.status !== 'out_of_stock') continue;

    const product = b.productId ? productById.get(b.productId) : undefined;
    const categoryId = product?.categoryId ?? null;

    if (categoryFilter) {
      if (categoryFilter === 'uncategorized') {
        if (categoryId !== null) continue;
      } else if (categoryId !== categoryFilter) {
        continue;
      }
    }

    if (q) {
      const haystack = [
        b.productName,
        b.variantName,
        b.sku,
        b.locationName,
        product?.categoryPath ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) continue;
    }

    const shortfall = Math.max(b.reorderLevel - b.quantity, 0);
    const restockCost = shortfall * b.costPrice;

    if (statusMeta.status === 'low_stock') lowStockCount += 1;
    else outOfStockCount += 1;

    estimatedRestockCost += restockCost;
    shortfallUnitEntries.push({ unitOfMeasure: b.unitOfMeasure, quantity: shortfall });

    rows.push({
      balanceId: b.id,
      organizationId: b.organizationId,
      productId: b.productId,
      productName: b.productName,
      categoryId,
      categoryName: product?.categoryName ?? 'Uncategorized',
      categoryPath: product?.categoryPath ?? 'Uncategorized',
      variantId: b.variantId,
      variantName: b.variantName,
      sku: b.sku,
      unitOfMeasure: b.unitOfMeasure,
      locationId: b.locationId,
      locationName: b.locationName,
      locationType: b.locationType,
      quantity: b.quantity,
      reorderLevel: b.reorderLevel,
      shortfallToReorder: shortfall,
      costPrice: b.costPrice,
      estimatedRestockCost: restockCost,
      stockStatus: statusMeta.status,
      stockStatusLabel: statusMeta.label,
      isActiveCatalogAndLocation: isActiveAll,
      updatedAt: b.updatedAt,
    });
  }

  rows.sort((a, b) => {
    if (a.stockStatus !== b.stockStatus) {
      return a.stockStatus === 'out_of_stock' ? -1 : 1;
    }
    return b.shortfallToReorder - a.shortfallToReorder || a.productName.localeCompare(b.productName);
  });

  return {
    organisationId,
    rows,
    totals: {
      alertCount: rows.length,
      lowStockCount,
      outOfStockCount,
      shortfallUnits: aggregateUnitQuantities(shortfallUnitEntries),
      estimatedRestockCost,
    },
  };
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  let text = String(value);
  // Neutralize spreadsheet formula triggers on non-numeric string values
  if (/^[=+\-@\t\r]/.test(text) && !/^-\d+(\.\d+)?$/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildReportCsv(
  activeOrganisationId: string,
  recordOrganisationIds: string[],
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
  metadataRows: Array<[string, string]> = []
): { csv: string | null; error: string | null } {
  if (!activeOrganisationId) {
    return { csv: null, error: 'An active organisation is required to export CSV.' };
  }

  if (recordOrganisationIds.some((orgId) => orgId !== activeOrganisationId)) {
    return {
      csv: null,
      error: 'Export blocked: one or more records do not belong to the active organisation.',
    };
  }

  const metaLines = metadataRows.map(
    ([key, value]) => `${escapeCsvCell(key)},${escapeCsvCell(value)}`
  );
  const lines = [
    ...metaLines,
    ...(metaLines.length > 0 ? [''] : []),
    headers.map((h) => escapeCsvCell(h)).join(','),
    ...rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
  ];

  return { csv: lines.join('\r\n'), error: null };
}

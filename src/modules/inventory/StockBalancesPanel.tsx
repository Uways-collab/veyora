import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BellRing,
  Boxes,
  CheckCircle2,
  Coins,
  Layers,
  Loader2,
  PackageX,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  LOCATION_TYPE_OPTIONS,
  canManageInventoryCatalog,
  formatMoneyAmount,
  formatUnitOfMeasureLabel,
  summarizeReplenishmentAlerts,
  updateInventoryReorderLevel,
  type InventoryBalanceRecord,
  type InventoryLocationRecord,
  type InventoryProductRecord,
  type InventoryVariantRecord,
  type LocationTypeValue,
  type StockStatusValue,
} from './inventoryService';

export type StockStatusFilter = 'all' | StockStatusValue;
type LocationTypeFilter = 'all' | LocationTypeValue;
type ActiveStateFilter = 'all' | 'active_only' | 'archived_only';

interface StockBalancesPanelProps {
  balances: InventoryBalanceRecord[];
  products: InventoryProductRecord[];
  variants: InventoryVariantRecord[];
  locations: InventoryLocationRecord[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  initialStatusFilter?: StockStatusFilter;
  initialFilterNonce?: number;
  onReload: () => Promise<void>;
}

interface PendingReorderConfirmation {
  productName: string;
  variantId: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationId: string;
  locationName: string;
  locationType: string;
  currentQuantity: number | null;
  currentReorderLevel: number | null;
  newReorderLevel: number;
}

function formatQuantity(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
      maximumFractionDigits: 4,
    }).format(safe);
  } catch {
    return String(safe);
  }
}

function formatUpdatedTimestamp(iso: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StockStatusIndicator({
  status,
  label,
}: {
  status: StockStatusValue;
  label: string;
}) {
  const styles =
    status === 'out_of_stock'
      ? { text: 'text-red-700', dot: 'bg-red-600' }
      : status === 'low_stock'
        ? { text: 'text-amber-700', dot: 'bg-amber-500' }
        : { text: 'text-emerald-700', dot: 'bg-emerald-600' };

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${styles.text}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      <span>{label}</span>
    </span>
  );
}

export function StockBalancesPanel({
  balances,
  products,
  variants,
  locations,
  loading,
  refreshing,
  error,
  initialStatusFilter,
  initialFilterNonce,
  onReload,
}: StockBalancesPanelProps) {
  const { status, activeOrganisation, activeMembership, activeRole } = useAuth();

  const activeOrgId =
    status === 'authenticated' &&
    activeOrganisation?.id &&
    activeMembership?.organisation_id === activeOrganisation.id
      ? activeOrganisation.id
      : null;

  const canManageReorder = Boolean(activeOrgId && canManageInventoryCatalog(activeRole));
  const currencyCode = activeOrganisation?.base_currency ?? 'USD';

  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [locationTypeFilter, setLocationTypeFilter] = useState<LocationTypeFilter>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<StockStatusFilter>(
    initialStatusFilter ?? 'all'
  );
  const [activeStateFilter, setActiveStateFilter] = useState<ActiveStateFilter>('all');

  // Reorder-level modal state (only used when canManageReorder is true)
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [formProductId, setFormProductId] = useState('');
  const [formVariantId, setFormVariantId] = useState('');
  const [formLocationId, setFormLocationId] = useState('');
  const [formReorderLevel, setFormReorderLevel] = useState('0');
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingReorderConfirmation | null>(null);

  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  useEffect(() => {
    setSearchQuery('');
    setLocationFilter('all');
    setLocationTypeFilter('all');
    setProductFilter('all');
    setStockStatusFilter(initialStatusFilter ?? 'all');
    setActiveStateFilter('all');
    setReorderModalOpen(false);
    setPendingConfirm(null);
    setFormError(null);
    setFeedback(null);
  }, [activeOrgId]);

  useEffect(() => {
    if (initialStatusFilter) {
      setStockStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter, initialFilterNonce]);

  useEffect(() => {
    if (!reorderModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setReorderModalOpen(false);
        setPendingConfirm(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [reorderModalOpen, submitting]);

  const scopedBalances = useMemo(() => {
    if (!activeOrgId) return [];
    return balances.filter((b) => b.organizationId === activeOrgId);
  }, [balances, activeOrgId]);

  const scopedProducts = useMemo(() => {
    if (!activeOrgId) return [];
    return products.filter((p) => p.organizationId === activeOrgId);
  }, [products, activeOrgId]);

  const scopedLocations = useMemo(() => {
    if (!activeOrgId) return [];
    return locations.filter((l) => l.organizationId === activeOrgId);
  }, [locations, activeOrgId]);

  const activePhysicalProducts = useMemo(() => {
    if (!activeOrgId) return [];
    return scopedProducts.filter(
      (p) => p.isActive && p.productTypeValue === 'physical'
    );
  }, [scopedProducts, activeOrgId]);

  const activeVariantsForFormProduct = useMemo(() => {
    if (!activeOrgId || !formProductId) return [];
    return variants.filter(
      (v) =>
        v.organizationId === activeOrgId &&
        v.isActive &&
        v.productId === formProductId
    );
  }, [variants, activeOrgId, formProductId]);

  const activeLocations = useMemo(
    () => scopedLocations.filter((l) => l.isActive),
    [scopedLocations]
  );

  const filteredBalances = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedBalances.filter((row) => {
      if (locationFilter !== 'all' && row.locationId !== locationFilter) {
        return false;
      }
      if (locationTypeFilter !== 'all' && row.locationTypeValue !== locationTypeFilter) {
        return false;
      }
      if (productFilter !== 'all' && row.productId !== productFilter) {
        return false;
      }
      if (stockStatusFilter !== 'all' && row.stockStatus !== stockStatusFilter) {
        return false;
      }
      if (
        activeStateFilter === 'active_only' &&
        (!row.productIsActive || !row.locationIsActive || !row.variantIsActive)
      ) {
        return false;
      }
      if (
        activeStateFilter === 'archived_only' &&
        row.productIsActive &&
        row.locationIsActive &&
        row.variantIsActive
      ) {
        return false;
      }
      if (q) {
        const haystack = [row.productName, row.variantName, row.sku]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [
    scopedBalances,
    searchQuery,
    locationFilter,
    locationTypeFilter,
    productFilter,
    stockStatusFilter,
    activeStateFilter,
  ]);

  // Summary metrics exclude archived products so archived items are never counted as active stock.
  const summaryMetrics = useMemo(() => {
    const activeProductRows = filteredBalances.filter((row) => row.productIsActive);
    const archivedExcludedCount = filteredBalances.length - activeProductRows.length;

    let totalUnits = 0;
    let estimatedValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    const stockedVariantIds = new Set<string>();

    for (const row of activeProductRows) {
      totalUnits += row.quantity;
      estimatedValuation += row.quantity * row.costPrice;
      if (row.quantity > 0) {
        stockedVariantIds.add(row.variantId);
      }
      if (row.stockStatus === 'low_stock') {
        lowStockCount += 1;
      } else if (row.stockStatus === 'out_of_stock') {
        outOfStockCount += 1;
      }
    }

    return {
      totalUnits,
      stockedVariantsCount: stockedVariantIds.size,
      lowStockCount,
      outOfStockCount,
      needingReplenishmentCount: lowStockCount + outOfStockCount,
      estimatedValuation,
      activeRowCount: activeProductRows.length,
      archivedExcludedCount,
    };
  }, [filteredBalances]);

  // Organisation-wide active-product alert lists (separated into Low-Stock vs Out-of-Stock)
  const orgAlertSummary = useMemo(
    () => summarizeReplenishmentAlerts(scopedBalances),
    [scopedBalances]
  );

  const lowStockAlertRows = useMemo(
    () =>
      scopedBalances.filter(
        (row) => row.productIsActive && row.stockStatus === 'low_stock'
      ),
    [scopedBalances]
  );

  const outOfStockAlertRows = useMemo(
    () =>
      scopedBalances.filter(
        (row) => row.productIsActive && row.stockStatus === 'out_of_stock'
      ),
    [scopedBalances]
  );

  const existingFormBalance = useMemo(() => {
    if (!formVariantId || !formLocationId) return null;
    return (
      scopedBalances.find(
        (b) => b.variantId === formVariantId && b.locationId === formLocationId
      ) ?? null
    );
  }, [scopedBalances, formVariantId, formLocationId]);

  const isRowEligibleForReorderEdit = (row: InventoryBalanceRecord): boolean =>
    Boolean(
      canManageReorder &&
        row.productId &&
        row.productIsActive &&
        row.productTypeValue === 'physical' &&
        row.variantIsActive &&
        row.locationIsActive
    );

  const openSetReorderModal = () => {
    if (!canManageReorder) return;
    setFormProductId('');
    setFormVariantId('');
    setFormLocationId('');
    setFormReorderLevel('0');
    setFormError(null);
    setPendingConfirm(null);
    setReorderModalOpen(true);
  };

  const openEditReorderModal = (row: InventoryBalanceRecord) => {
    if (!isRowEligibleForReorderEdit(row) || !row.productId) return;
    setFormProductId(row.productId);
    setFormVariantId(row.variantId);
    setFormLocationId(row.locationId);
    setFormReorderLevel(String(row.reorderLevel));
    setFormError(null);
    setPendingConfirm(null);
    setReorderModalOpen(true);
  };

  const handleReviewReorderLevel = (e: FormEvent) => {
    e.preventDefault();
    if (!canManageReorder || submitting) return;

    setFormError(null);

    const product = activePhysicalProducts.find((p) => p.id === formProductId);
    if (!product) {
      setFormError('Select an active physical product.');
      return;
    }

    const variant = activeVariantsForFormProduct.find((v) => v.id === formVariantId);
    if (!variant) {
      setFormError('Select an active product variant.');
      return;
    }

    const location = activeLocations.find((l) => l.id === formLocationId);
    if (!location) {
      setFormError('Select an active inventory location.');
      return;
    }

    const numericReorder = Number(formReorderLevel);
    if (
      formReorderLevel.trim() === '' ||
      !Number.isFinite(numericReorder) ||
      numericReorder < 0
    ) {
      setFormError('Reorder level must be a non-negative number (0 or greater).');
      return;
    }

    setPendingConfirm({
      productName: product.name,
      variantId: variant.id,
      variantName: variant.variantName,
      sku: variant.sku,
      unitOfMeasure: variant.unitOfMeasure,
      locationId: location.id,
      locationName: location.name,
      locationType: location.locationType,
      currentQuantity: existingFormBalance ? existingFormBalance.quantity : null,
      currentReorderLevel: existingFormBalance ? existingFormBalance.reorderLevel : null,
      newReorderLevel: numericReorder,
    });
  };

  const handleConfirmSaveReorderLevel = async () => {
    if (!pendingConfirm || !canManageReorder || !activeOrgId || submitLockRef.current || submitting) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await updateInventoryReorderLevel(activeOrgId, {
        variantId: pendingConfirm.variantId,
        locationId: pendingConfirm.locationId,
        reorderLevel: pendingConfirm.newReorderLevel,
      });

      if (result.error) {
        setFormError(result.error);
        return;
      }

      const saved = pendingConfirm;
      setReorderModalOpen(false);
      setPendingConfirm(null);
      setFeedback({
        kind: 'success',
        text: `Reorder level updated to ${formatQuantity(saved.newReorderLevel)} ${formatUnitOfMeasureLabel(saved.unitOfMeasure)} for ${saved.productName} — ${saved.variantName} (${saved.sku}) at ${saved.locationName}.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  if (!activeOrgId) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-600">
        Select an active authenticated business workspace to view stock balances.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-slate-100/80 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span>
          Stock quantities are read-only from <span className="font-mono">public.inventory_balances</span>.{' '}
          {canManageReorder
            ? 'Authorized managers can configure reorder thresholds via the secure reorder-level workflow.'
            : 'Stock quantities and reorder thresholds are read-only for your role.'}
        </span>
        {summaryMetrics.archivedExcludedCount > 0 && (
          <span className="text-[11px] text-slate-500 whitespace-nowrap">
            Summary metrics exclude {summaryMetrics.archivedExcludedCount} archived-product{' '}
            {summaryMetrics.archivedExcludedCount === 1 ? 'record' : 'records'}.
          </span>
        )}
      </div>

      {feedback && (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-xs flex items-center justify-between gap-3 ${
            feedback.kind === 'success'
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
              : 'bg-red-50/80 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.kind === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss message"
            className="p-0.5 rounded text-slate-500 hover:text-slate-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Summary Metrics */}
      <section aria-labelledby="stock-summary-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="stock-summary-heading" className="text-sm font-semibold text-slate-900">
            Stock Balance Summary
          </h2>
          <span className="text-[11px] text-slate-500">
            Active products in {activeOrganisation?.name ?? 'workspace'} · Currency: {currencyCode}
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          {/* Total Stock Units */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Total Stock Units
              </span>
              <Boxes className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {loading ? (
              <div className="h-7 w-20 bg-slate-100 rounded animate-pulse" aria-busy="true" />
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {formatQuantity(summaryMetrics.totalUnits)}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Sum across all units of measure
                </p>
              </div>
            )}
          </div>

          {/* Stocked Variants */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Stocked Variants
              </span>
              <Layers className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {loading ? (
              <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" aria-busy="true" />
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {summaryMetrics.stockedVariantsCount}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Distinct variants with quantity &gt; 0
                </p>
              </div>
            )}
          </div>

          {/* Low Stock Records */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Low Stock Records
              </span>
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
            </div>
            {loading ? (
              <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" aria-busy="true" />
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-amber-700 tabular-nums">
                  {summaryMetrics.lowStockCount}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  0 &lt; quantity &le; reorder level
                </p>
              </div>
            )}
          </div>

          {/* Out of Stock Records */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Out of Stock Records
              </span>
              <PackageX className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
            </div>
            {loading ? (
              <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" aria-busy="true" />
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-red-700 tabular-nums">
                  {summaryMetrics.outOfStockCount}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Records with quantity = 0
                </p>
              </div>
            )}
          </div>

          {/* Estimated Stock Valuation */}
          <div className="p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                Estimated Stock Value
              </span>
              <Coins className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {loading ? (
              <div className="h-7 w-24 bg-slate-100 rounded animate-pulse" aria-busy="true" />
            ) : (
              <div>
                <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums truncate">
                  {formatMoneyAmount(summaryMetrics.estimatedValuation, currencyCode)}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Estimate: quantity × cost price ({currencyCode})
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Low-Stock & Out-of-Stock Alerts Section */}
      <section aria-labelledby="stock-alerts-heading" className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
            <h2 id="stock-alerts-heading" className="text-sm font-semibold text-slate-900">
              Low-Stock &amp; Replenishment Alerts
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <span>
              Low-stock:{' '}
              <strong className="font-mono text-amber-700">
                {orgAlertSummary.lowStockCount}
              </strong>
            </span>
            <span>
              Out-of-stock:{' '}
              <strong className="font-mono text-red-700">
                {orgAlertSummary.outOfStockCount}
              </strong>
            </span>
            <span>
              Total needing replenishment:{' '}
              <strong className="font-mono text-slate-900">
                {orgAlertSummary.needingReplenishmentCount}
              </strong>
            </span>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2.5" aria-busy="true">
            <div className="h-8 bg-slate-100 rounded animate-pulse" />
            <div className="h-8 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : orgAlertSummary.needingReplenishmentCount === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg px-5 py-6 text-center space-y-1">
            <div className="text-xs font-semibold text-slate-900">
              No low-stock or out-of-stock alerts
            </div>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              All active-product inventory balances are currently above their configured reorder levels.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {/* Low-Stock Alerts Table */}
            <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-200 bg-amber-50/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-amber-950">
                    Low-Stock Items ({lowStockAlertRows.length})
                  </h3>
                </div>
                <span className="text-[11px] text-amber-800">
                  0 &lt; qty &le; reorder level
                </span>
              </div>

              {lowStockAlertRows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No low-stock alerts right now.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2 px-3 whitespace-nowrap">Product / Variant</th>
                        <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                        <th className="py-2 px-3 whitespace-nowrap">Location</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Available</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Reorder</th>
                        <th className="py-2 px-3 whitespace-nowrap">Unit</th>
                        <th className="py-2 px-3 whitespace-nowrap">Alert</th>
                        {canManageReorder && (
                          <th className="py-2 px-3 text-right whitespace-nowrap">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {lowStockAlertRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{row.productName}</div>
                            <div className="text-[11px] text-slate-500">{row.variantName}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                            {row.sku}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                            {row.locationName}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-700 whitespace-nowrap">
                            {formatQuantity(row.quantity)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                            {formatQuantity(row.reorderLevel)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                            {formatUnitOfMeasureLabel(row.unitOfMeasure)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <StockStatusIndicator
                              status={row.stockStatus}
                              label={row.stockStatusLabel}
                            />
                          </td>
                          {canManageReorder && (
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {isRowEligibleForReorderEdit(row) ? (
                                <button
                                  type="button"
                                  onClick={() => openEditReorderModal(row)}
                                  className="text-xs font-medium text-blue-700 hover:text-blue-800"
                                >
                                  Edit
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Out-of-Stock Items Table (Displayed Separately) */}
            <div className="bg-white border border-red-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-red-200 bg-red-50/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <PackageX className="h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-red-950">
                    Out-of-Stock Items ({outOfStockAlertRows.length})
                  </h3>
                </div>
                <span className="text-[11px] text-red-800">qty = 0</span>
              </div>

              {outOfStockAlertRows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No out-of-stock items right now.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2 px-3 whitespace-nowrap">Product / Variant</th>
                        <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                        <th className="py-2 px-3 whitespace-nowrap">Location</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Available</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Reorder</th>
                        <th className="py-2 px-3 whitespace-nowrap">Unit</th>
                        <th className="py-2 px-3 whitespace-nowrap">Alert</th>
                        {canManageReorder && (
                          <th className="py-2 px-3 text-right whitespace-nowrap">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {outOfStockAlertRows.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{row.productName}</div>
                            <div className="text-[11px] text-slate-500">{row.variantName}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                            {row.sku}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                            {row.locationName}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-red-700 whitespace-nowrap">
                            {formatQuantity(row.quantity)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                            {formatQuantity(row.reorderLevel)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                            {formatUnitOfMeasureLabel(row.unitOfMeasure)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <StockStatusIndicator
                              status={row.stockStatus}
                              label={row.stockStatusLabel}
                            />
                          </td>
                          {canManageReorder && (
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {isRowEligibleForReorderEdit(row) ? (
                                <button
                                  type="button"
                                  onClick={() => openEditReorderModal(row)}
                                  className="text-xs font-medium text-blue-700 hover:text-blue-800"
                                >
                                  Edit
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Stock Balances Table Section */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Stock Balances by Location
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Current on-hand quantities and reorder thresholds across warehouses, stores, and branches.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-start sm:self-auto">
              {canManageReorder && (
                <button
                  type="button"
                  onClick={openSetReorderModal}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Set Reorder Level</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => void onReload()}
                disabled={loading || refreshing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{refreshing ? 'Refreshing...' : 'Refresh Balances'}</span>
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="relative xl:col-span-2">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="balances-search" className="sr-only">
                Search by product name, variant name, or SKU
              </label>
              <input
                id="balances-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search product, variant, or SKU..."
                className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="balances-location-filter" className="sr-only">
                Filter by location
              </label>
              <select
                id="balances-location-filter"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All locations ({scopedLocations.length})</option>
                {scopedLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.locationType})
                    {!loc.isActive ? ' [Archived]' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="balances-location-type-filter" className="sr-only">
                Filter by location type
              </label>
              <select
                id="balances-location-type-filter"
                value={locationTypeFilter}
                onChange={(e) => setLocationTypeFilter(e.target.value as LocationTypeFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All location types</option>
                {LOCATION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="balances-product-filter" className="sr-only">
                Filter by product
              </label>
              <select
                id="balances-product-filter"
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All products ({scopedProducts.length})</option>
                {scopedProducts.map((prod) => (
                  <option key={prod.id} value={prod.id}>
                    {prod.name}
                    {!prod.isActive ? ' [Archived]' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="balances-status-filter" className="sr-only">
                Filter by stock status
              </label>
              <select
                id="balances-status-filter"
                value={stockStatusFilter}
                onChange={(e) => setStockStatusFilter(e.target.value as StockStatusFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All stock statuses</option>
                <option value="in_stock">In stock</option>
                <option value="low_stock">Low stock</option>
                <option value="out_of_stock">Out of stock</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <label htmlFor="balances-active-scope-filter" className="text-slate-500">
                Catalog &amp; location status:
              </label>
              <select
                id="balances-active-scope-filter"
                value={activeStateFilter}
                onChange={(e) => setActiveStateFilter(e.target.value as ActiveStateFilter)}
                className="h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All records ({scopedBalances.length})</option>
                <option value="active_only">Active products &amp; locations only</option>
                <option value="archived_only">Includes archived product, variant, or location</option>
              </select>
            </div>

            <span className="font-mono text-[11px] text-slate-500">
              Showing {filteredBalances.length} of {scopedBalances.length}{' '}
              {scopedBalances.length === 1 ? 'record' : 'records'}
            </span>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-red-700 bg-red-50/50">
            Error loading stock balances: {error}
          </div>
        ) : filteredBalances.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-xs font-semibold text-slate-900">
              {scopedBalances.length === 0
                ? 'No stock balance records yet'
                : 'No matching stock balance records'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {scopedBalances.length === 0
                ? 'Stock balances will appear here once opening stock, stock movements, or reorder thresholds are configured.'
                : 'Adjust your search term, location, product, stock status, or active-status filter to view matching balances.'}
            </p>
            {scopedBalances.length === 0 && canManageReorder && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openSetReorderModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Set Reorder Level</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Product</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Variant</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">SKU</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Qty Available</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Unit</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Reorder Level</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Stock Status</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Last Updated</th>
                  {canManageReorder && (
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Reorder Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredBalances.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-900 min-w-[160px]">
                      <div className="flex items-center gap-2">
                        <span>{row.productName}</span>
                        {!row.productIsActive && (
                          <span className="text-[10px] font-medium text-slate-500 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
                            Archived
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <span>{row.variantName}</span>
                        {!row.variantIsActive && (
                          <span className="text-[10px] font-medium text-slate-500 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
                            Archived
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                      {row.sku}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{row.locationName}</span>
                        <span className="text-[11px] text-slate-400">({row.locationType})</span>
                        {!row.locationIsActive && (
                          <span className="text-[10px] font-medium text-slate-500 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
                            Archived
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatQuantity(row.quantity)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {formatUnitOfMeasureLabel(row.unitOfMeasure)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatQuantity(row.reorderLevel)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <StockStatusIndicator
                        status={row.stockStatus}
                        label={row.stockStatusLabel}
                      />
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                      {formatUpdatedTimestamp(row.updatedAt)}
                    </td>
                    {canManageReorder && (
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {isRowEligibleForReorderEdit(row) ? (
                          <button
                            type="button"
                            onClick={() => openEditReorderModal(row)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            <span>Edit Reorder</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">Inactive item</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reorder Level Modal (Owner, Admin, Manager only) */}
      {canManageReorder && reorderModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reorder-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) {
                setReorderModalOpen(false);
                setPendingConfirm(null);
              }
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 id="reorder-modal-title" className="text-sm font-semibold text-slate-900">
                  {pendingConfirm ? 'Confirm Reorder Level' : 'Manage Reorder Level'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Executed securely via <span className="font-mono">public.update_inventory_reorder_level</span>. Existing stock quantity is preserved.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setReorderModalOpen(false);
                  setPendingConfirm(null);
                }}
                aria-label="Close reorder level dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {pendingConfirm ? (
              <div className="p-6 space-y-4 text-xs">
                <p className="text-slate-600">
                  Confirm updating the reorder threshold below. If no balance record exists yet for this variant and location, a zero-quantity balance will be initialized with this reorder level.
                </p>

                <dl className="divide-y divide-slate-200 border border-slate-200 rounded-md bg-slate-50/50">
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Product</dt>
                    <dd className="font-medium text-slate-900 text-right">
                      {pendingConfirm.productName}
                    </dd>
                  </div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Variant / SKU</dt>
                    <dd className="font-medium text-slate-900 text-right">
                      {pendingConfirm.variantName}{' '}
                      <span className="font-mono text-slate-500">({pendingConfirm.sku})</span>
                    </dd>
                  </div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Location</dt>
                    <dd className="font-medium text-slate-900 text-right">
                      {pendingConfirm.locationName} ({pendingConfirm.locationType})
                    </dd>
                  </div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Current Stock (Preserved)</dt>
                    <dd className="font-mono text-slate-800 text-right">
                      {pendingConfirm.currentQuantity !== null
                        ? `${formatQuantity(pendingConfirm.currentQuantity)} ${formatUnitOfMeasureLabel(pendingConfirm.unitOfMeasure)}`
                        : `0 ${formatUnitOfMeasureLabel(pendingConfirm.unitOfMeasure)} (new balance row)`}
                    </dd>
                  </div>
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Reorder Level</dt>
                    <dd className="font-mono font-semibold text-blue-700 text-right">
                      {pendingConfirm.currentReorderLevel !== null
                        ? `${formatQuantity(pendingConfirm.currentReorderLevel)} → `
                        : ''}
                      {formatQuantity(pendingConfirm.newReorderLevel)}{' '}
                      {formatUnitOfMeasureLabel(pendingConfirm.unitOfMeasure)}
                    </dd>
                  </div>
                </dl>

                {formError && (
                  <div
                    role="alert"
                    className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700"
                  >
                    {formError}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setPendingConfirm(null);
                      setFormError(null);
                    }}
                    className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    aria-busy={submitting}
                    onClick={() => void handleConfirmSaveReorderLevel()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                    )}
                    <span>{submitting ? 'Saving...' : 'Confirm & Save Reorder Level'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleReviewReorderLevel} className="p-6 space-y-4">
                {activePhysicalProducts.length === 0 || activeLocations.length === 0 ? (
                  <div className="p-4 rounded-md border border-amber-200 bg-amber-50/70 text-xs text-amber-900">
                    {activePhysicalProducts.length === 0
                      ? 'Create an active physical product and variant before configuring reorder levels.'
                      : 'Create an active inventory location before configuring reorder levels.'}
                  </div>
                ) : (
                  <fieldset disabled={submitting} className="space-y-4">
                    <div className="space-y-1">
                      <label htmlFor="reorder-product" className="block text-xs font-medium text-slate-700">
                        Product <span className="text-red-600">*</span>
                      </label>
                      <select
                        id="reorder-product"
                        required
                        value={formProductId}
                        onChange={(e) => {
                          setFormProductId(e.target.value);
                          setFormVariantId('');
                          setFormError(null);
                        }}
                        className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      >
                        <option value="">Select active physical product...</option>
                        {activePhysicalProducts.map((prod) => (
                          <option key={prod.id} value={prod.id}>
                            {prod.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reorder-variant" className="block text-xs font-medium text-slate-700">
                        Product Variant <span className="text-red-600">*</span>
                      </label>
                      <select
                        id="reorder-variant"
                        required
                        disabled={!formProductId}
                        value={formVariantId}
                        onChange={(e) => {
                          setFormVariantId(e.target.value);
                          setFormError(null);
                        }}
                        className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        <option value="">
                          {!formProductId
                            ? 'Select a product first...'
                            : activeVariantsForFormProduct.length === 0
                              ? 'No active variants for this product'
                              : 'Select active variant...'}
                        </option>
                        {activeVariantsForFormProduct.map((variant) => (
                          <option key={variant.id} value={variant.id}>
                            {variant.variantName} ({variant.sku}) ·{' '}
                            {formatUnitOfMeasureLabel(variant.unitOfMeasure)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reorder-location" className="block text-xs font-medium text-slate-700">
                        Inventory Location <span className="text-red-600">*</span>
                      </label>
                      <select
                        id="reorder-location"
                        required
                        value={formLocationId}
                        onChange={(e) => {
                          setFormLocationId(e.target.value);
                          setFormError(null);
                        }}
                        className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      >
                        <option value="">Select active location...</option>
                        {activeLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.locationType})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="reorder-level-input" className="block text-xs font-medium text-slate-700">
                        Reorder Level (0 or greater) <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="reorder-level-input"
                        type="number"
                        required
                        min="0"
                        step="any"
                        value={formReorderLevel}
                        onChange={(e) => {
                          setFormReorderLevel(e.target.value);
                          setFormError(null);
                        }}
                        className="w-full h-9 px-3 rounded-md border border-slate-300 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                      <p className="text-[11px] text-slate-500">
                        Items with quantity &gt; 0 and at or below this threshold appear as Low stock.
                      </p>
                    </div>

                    {formVariantId && formLocationId && (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Current quantity:{' '}
                          <strong className="font-mono text-slate-900">
                            {existingFormBalance
                              ? formatQuantity(existingFormBalance.quantity)
                              : '0 (new balance row)'}
                          </strong>
                        </span>
                        <span>
                          Current reorder level:{' '}
                          <strong className="font-mono text-slate-900">
                            {existingFormBalance
                              ? formatQuantity(existingFormBalance.reorderLevel)
                              : 'Not set'}
                          </strong>
                        </span>
                      </div>
                    )}
                  </fieldset>
                )}

                {formError && (
                  <div
                    role="alert"
                    className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700"
                  >
                    {formError}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setReorderModalOpen(false)}
                    className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  {activePhysicalProducts.length > 0 && activeLocations.length > 0 && (
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50"
                    >
                      <span>Review &amp; Save</span>
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

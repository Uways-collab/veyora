import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  STOCK_MOVEMENT_TYPE_OPTIONS,
  adjustInventoryStock,
  canManageInventoryCatalog,
  computeSignedQuantityChange,
  formatStockMovementTypeLabel,
  formatUnitOfMeasureLabel,
  type AdjustmentDirection,
  type InventoryBalanceRecord,
  type InventoryLocationRecord,
  type InventoryMovementRecord,
  type InventoryProductRecord,
  type InventoryVariantRecord,
  type StockMovementTypeValue,
} from './inventoryService';

interface StockAdjustmentsPanelProps {
  products: InventoryProductRecord[];
  variants: InventoryVariantRecord[];
  locations: InventoryLocationRecord[];
  balances: InventoryBalanceRecord[];
  movements: InventoryMovementRecord[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}

interface PendingOperationSummary {
  productName: string;
  variantId: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationId: string;
  locationName: string;
  locationType: string;
  movementType: StockMovementTypeValue;
  movementTypeLabel: string;
  positiveQuantity: number;
  adjustmentDirection: AdjustmentDirection;
  signedQuantityChange: number;
  reference: string | null;
  notes: string | null;
}

interface RecordedOperationBanner {
  movementId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  locationName: string;
  movementTypeLabel: string;
  quantityChange: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
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

function formatSignedQuantity(value: number): string {
  const formatted = formatQuantity(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function StockAdjustmentsPanel({
  products,
  variants,
  locations,
  balances,
  movements,
  loading,
  refreshing,
  error,
  onReload,
}: StockAdjustmentsPanelProps) {
  const { status, activeOrganisation, activeMembership, activeRole } = useAuth();

  const activeOrgId =
    status === 'authenticated' &&
    activeOrganisation?.id &&
    activeMembership?.organisation_id === activeOrganisation.id
      ? activeOrganisation.id
      : null;

  const canOperate = Boolean(activeOrgId && canManageInventoryCatalog(activeRole));

  // Form state (rendered only for owner, admin, manager)
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [movementType, setMovementType] = useState<StockMovementTypeValue>('opening_stock');
  const [adjustmentDirection, setAdjustmentDirection] =
    useState<AdjustmentDirection>('increase');
  const [quantityInput, setQuantityInput] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [notesInput, setNotesInput] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingOperationSummary | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [recordedBanner, setRecordedBanner] = useState<RecordedOperationBanner | null>(null);

  // History filter state (read-only for all roles)
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all');
  const [historyLocationFilter, setHistoryLocationFilter] = useState('all');

  useEffect(() => {
    setSelectedProductId('');
    setSelectedVariantId('');
    setSelectedLocationId('');
    setMovementType('opening_stock');
    setAdjustmentDirection('increase');
    setQuantityInput('');
    setReferenceInput('');
    setNotesInput('');
    setFormError(null);
    setPendingConfirmation(null);
    setConfirmationError(null);
    setRecordedBanner(null);
    setHistorySearch('');
    setHistoryTypeFilter('all');
    setHistoryLocationFilter('all');
  }, [activeOrgId]);

  useEffect(() => {
    if (!pendingConfirmation) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setPendingConfirmation(null);
        setConfirmationError(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pendingConfirmation, submitting]);

  const activePhysicalProducts = useMemo(() => {
    if (!activeOrgId) return [];
    return products.filter(
      (p) =>
        p.organizationId === activeOrgId &&
        p.isActive &&
        p.productTypeValue === 'physical'
    );
  }, [products, activeOrgId]);

  const activeVariantsForSelectedProduct = useMemo(() => {
    if (!activeOrgId || !selectedProductId) return [];
    return variants.filter(
      (v) =>
        v.organizationId === activeOrgId &&
        v.isActive &&
        v.productId === selectedProductId
    );
  }, [variants, activeOrgId, selectedProductId]);

  const activeLocations = useMemo(() => {
    if (!activeOrgId) return [];
    return locations.filter((l) => l.organizationId === activeOrgId && l.isActive);
  }, [locations, activeOrgId]);

  const selectedProduct = useMemo(
    () => activePhysicalProducts.find((p) => p.id === selectedProductId) ?? null,
    [activePhysicalProducts, selectedProductId]
  );

  const selectedVariant = useMemo(
    () => activeVariantsForSelectedProduct.find((v) => v.id === selectedVariantId) ?? null,
    [activeVariantsForSelectedProduct, selectedVariantId]
  );

  const selectedLocation = useMemo(
    () => activeLocations.find((l) => l.id === selectedLocationId) ?? null,
    [activeLocations, selectedLocationId]
  );

  const currentBalance = useMemo(() => {
    if (!activeOrgId || !selectedVariantId || !selectedLocationId) return null;
    return (
      balances.find(
        (b) =>
          b.organizationId === activeOrgId &&
          b.variantId === selectedVariantId &&
          b.locationId === selectedLocationId
      ) ?? null
    );
  }, [balances, activeOrgId, selectedVariantId, selectedLocationId]);

  const parsedPositiveQuantity = Number(quantityInput);
  const previewSignedChange = useMemo(() => {
    if (quantityInput.trim() === '') return null;
    return computeSignedQuantityChange(
      movementType,
      parsedPositiveQuantity,
      adjustmentDirection
    );
  }, [quantityInput, movementType, parsedPositiveQuantity, adjustmentDirection]);

  const scopedMovements = useMemo(() => {
    if (!activeOrgId) return [];
    return movements.filter((m) => m.organizationId === activeOrgId);
  }, [movements, activeOrgId]);

  const scopedAllLocations = useMemo(() => {
    if (!activeOrgId) return [];
    return locations.filter((l) => l.organizationId === activeOrgId);
  }, [locations, activeOrgId]);

  const filteredMovements = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return scopedMovements.filter((row) => {
      if (
        historyTypeFilter !== 'all' &&
        row.movementTypeValue.toLowerCase() !== historyTypeFilter
      ) {
        return false;
      }
      if (historyLocationFilter !== 'all' && row.locationId !== historyLocationFilter) {
        return false;
      }
      if (q) {
        const haystack = [
          row.productName,
          row.variantName,
          row.sku,
          row.locationName,
          row.reference ?? '',
          row.notes ?? '',
          row.performedByName ?? '',
          row.movementTypeLabel,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [scopedMovements, historySearch, historyTypeFilter, historyLocationFilter]);

  const handleProductChange = (nextProductId: string) => {
    setSelectedProductId(nextProductId);
    setSelectedVariantId('');
    setFormError(null);
  };

  const handleReviewOperation = (e: FormEvent) => {
    e.preventDefault();
    if (!canOperate || !activeOrgId || submitting) return;

    setFormError(null);
    setConfirmationError(null);

    if (!selectedProduct) {
      setFormError('Select an active physical product.');
      return;
    }
    if (!selectedVariant) {
      setFormError('Select an active product variant.');
      return;
    }
    if (!selectedLocation) {
      setFormError('Select an active inventory location.');
      return;
    }

    const numericQty = Number(quantityInput);
    if (quantityInput.trim() === '' || !Number.isFinite(numericQty) || numericQty <= 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }

    const signedChange = computeSignedQuantityChange(
      movementType,
      numericQty,
      adjustmentDirection
    );
    if (signedChange === null || signedChange === 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }

    const trimmedReference = referenceInput.trim();
    if (trimmedReference.length > 120) {
      setFormError('Reference cannot exceed 120 characters.');
      return;
    }

    const trimmedNotes = notesInput.trim();
    if (trimmedNotes.length > 500) {
      setFormError('Notes cannot exceed 500 characters.');
      return;
    }

    setPendingConfirmation({
      productName: selectedProduct.name,
      variantId: selectedVariant.id,
      variantName: selectedVariant.variantName,
      sku: selectedVariant.sku,
      unitOfMeasure: selectedVariant.unitOfMeasure,
      locationId: selectedLocation.id,
      locationName: selectedLocation.name,
      locationType: selectedLocation.locationType,
      movementType,
      movementTypeLabel: formatStockMovementTypeLabel(movementType),
      positiveQuantity: numericQty,
      adjustmentDirection,
      signedQuantityChange: signedChange,
      reference: trimmedReference || null,
      notes: trimmedNotes || null,
    });
  };

  const handleConfirmOperation = async () => {
    const pending = pendingConfirmation;
    if (!pending || !canOperate || !activeOrgId || submitLockRef.current || submitting) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setConfirmationError(null);
    setFormError(null);

    try {
      const result = await adjustInventoryStock(activeOrgId, {
        variantId: pending.variantId,
        locationId: pending.locationId,
        movementType: pending.movementType,
        quantity: pending.positiveQuantity,
        adjustmentDirection: pending.adjustmentDirection,
        reference: pending.reference,
        notes: pending.notes,
      });

      if (result.error) {
        setConfirmationError(result.error);
        return;
      }

      setPendingConfirmation(null);
      setQuantityInput('');
      setReferenceInput('');
      setNotesInput('');

      setRecordedBanner({
        movementId: result.movementId,
        productName: pending.productName,
        variantName: pending.variantName,
        sku: pending.sku,
        unitOfMeasure: pending.unitOfMeasure,
        locationName: pending.locationName,
        movementTypeLabel: pending.movementTypeLabel,
        quantityChange: result.quantityChange,
        quantityBefore: result.quantityBefore,
        quantityAfter: result.quantityAfter,
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
        Select an active authenticated business workspace to view stock operations.
      </div>
    );
  }

  const selectedOperationMeta = STOCK_MOVEMENT_TYPE_OPTIONS.find(
    (opt) => opt.value === movementType
  );

  return (
    <div className="space-y-6">
      {!canOperate && (
        <div className="bg-slate-100/80 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700">
          Read-only access: your current workspace role (<span className="capitalize">{activeRole ?? 'staff'}</span>) can review stock movement history below, while only Owners, Admins, and Managers can submit opening stock or stock adjustments.
        </div>
      )}

      {recordedBanner && (
        <section
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-5 py-4 text-xs text-emerald-950 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <div className="font-semibold">
                {recordedBanner.movementTypeLabel} recorded for {recordedBanner.productName} —{' '}
                {recordedBanner.variantName} ({recordedBanner.sku})
              </div>
              <div className="text-emerald-900 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  Location: <strong>{recordedBanner.locationName}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Quantity change:{' '}
                  <strong className="font-mono">
                    {formatSignedQuantity(recordedBanner.quantityChange)}{' '}
                    {formatUnitOfMeasureLabel(recordedBanner.unitOfMeasure)}
                  </strong>
                </span>
                {recordedBanner.quantityAfter !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      Resulting balance:{' '}
                      <strong className="font-mono">
                        {recordedBanner.quantityBefore !== null
                          ? `${formatQuantity(recordedBanner.quantityBefore)} → `
                          : ''}
                        {formatQuantity(recordedBanner.quantityAfter)}{' '}
                        {formatUnitOfMeasureLabel(recordedBanner.unitOfMeasure)}
                      </strong>
                    </span>
                  </>
                )}
                {recordedBanner.movementId && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] text-emerald-800">
                      Movement ID: {recordedBanner.movementId}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setRecordedBanner(null)}
            aria-label="Dismiss recorded movement notice"
            className="p-0.5 rounded text-emerald-700 hover:text-emerald-950"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </section>
      )}

      {/* Stock Operation Form — rendered ONLY for Owner, Admin, and Manager */}
      {canOperate && (
        <section
          aria-labelledby="stock-operation-heading"
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 id="stock-operation-heading" className="text-sm font-semibold text-slate-900">
                Record Opening Stock or Stock Adjustment
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Executed atomically via <span className="font-mono">public.adjust_inventory_stock</span>. Only active physical products, active variants, and active locations are eligible.
              </p>
            </div>
            <ClipboardList className="h-4 w-4 text-slate-400 shrink-0 hidden sm:block" aria-hidden="true" />
          </div>

          {loading ? (
            <div className="p-5 space-y-3" aria-busy="true">
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : activePhysicalProducts.length === 0 || activeLocations.length === 0 ? (
            <div className="p-8 text-center space-y-1.5 text-xs">
              <div className="font-semibold text-slate-900">
                {activePhysicalProducts.length === 0
                  ? 'No active physical products available'
                  : 'No active inventory locations available'}
              </div>
              <p className="text-slate-500 max-w-lg mx-auto">
                {activePhysicalProducts.length === 0
                  ? 'Create an active physical product and at least one active variant in the Products tab before recording stock operations.'
                  : 'Create an active warehouse, store, or branch in the Locations tab before recording stock operations.'}
              </p>
            </div>
          ) : (
            <form onSubmit={handleReviewOperation} className="p-5 space-y-5">
              <fieldset disabled={submitting} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Product */}
                  <div className="space-y-1">
                    <label htmlFor="stock-op-product" className="block text-xs font-medium text-slate-700">
                      Product <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="stock-op-product"
                      required
                      value={selectedProductId}
                      onChange={(e) => handleProductChange(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    >
                      <option value="">Select physical product...</option>
                      {activePhysicalProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Variant */}
                  <div className="space-y-1">
                    <label htmlFor="stock-op-variant" className="block text-xs font-medium text-slate-700">
                      Product Variant <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="stock-op-variant"
                      required
                      disabled={!selectedProductId}
                      value={selectedVariantId}
                      onChange={(e) => {
                        setSelectedVariantId(e.target.value);
                        setFormError(null);
                      }}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">
                        {!selectedProductId
                          ? 'Select a product first...'
                          : activeVariantsForSelectedProduct.length === 0
                            ? 'No active variants for this product'
                            : 'Select product variant...'}
                      </option>
                      {activeVariantsForSelectedProduct.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.variantName} ({variant.sku}) ·{' '}
                          {formatUnitOfMeasureLabel(variant.unitOfMeasure)}
                        </option>
                      ))}
                    </select>
                    {selectedProductId && activeVariantsForSelectedProduct.length === 0 && (
                      <p className="text-[11px] text-amber-700">
                        This product has no active variants. Add or restore a variant in the Products tab.
                      </p>
                    )}
                  </div>

                  {/* Location */}
                  <div className="space-y-1">
                    <label htmlFor="stock-op-location" className="block text-xs font-medium text-slate-700">
                      Inventory Location <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="stock-op-location"
                      required
                      value={selectedLocationId}
                      onChange={(e) => {
                        setSelectedLocationId(e.target.value);
                        setFormError(null);
                      }}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    >
                      <option value="">Select location...</option>
                      {activeLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name} ({location.locationType})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Operation Type, Direction (if Adjustment), and Positive Quantity */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="stock-op-type" className="block text-xs font-medium text-slate-700">
                      Operation Type <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="stock-op-type"
                      required
                      value={movementType}
                      onChange={(e) => {
                        setMovementType(e.target.value as StockMovementTypeValue);
                        setFormError(null);
                      }}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    >
                      {STOCK_MOVEMENT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {selectedOperationMeta && (
                      <p className="text-[11px] text-slate-500">
                        {selectedOperationMeta.description}
                      </p>
                    )}
                  </div>

                  {movementType === 'adjustment' && (
                    <div className="space-y-1">
                      <span className="block text-xs font-medium text-slate-700">
                        Adjustment Direction <span className="text-red-600">*</span>
                      </span>
                      <div className="grid grid-cols-2 gap-2 h-9">
                        <button
                          type="button"
                          onClick={() => setAdjustmentDirection('increase')}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
                            adjustmentDirection === 'increase'
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Increase (+)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdjustmentDirection('decrease')}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors ${
                            adjustmentDirection === 'decrease'
                              ? 'border-red-600 bg-red-50 text-red-800'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Decrease (-)</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label htmlFor="stock-op-quantity" className="block text-xs font-medium text-slate-700">
                      Quantity{' '}
                      {selectedVariant
                        ? `(${formatUnitOfMeasureLabel(selectedVariant.unitOfMeasure)})`
                        : ''}{' '}
                      <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="stock-op-quantity"
                      type="number"
                      required
                      min="0.0001"
                      step="any"
                      value={quantityInput}
                      onChange={(e) => {
                        setQuantityInput(e.target.value);
                        setFormError(null);
                      }}
                      placeholder="Enter positive quantity (e.g. 25)"
                      className="w-full h-9 px-3 rounded-md border border-slate-300 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                    <p className="text-[11px] text-slate-500">
                      Enter a positive quantity; sign is applied automatically for the selected operation.
                    </p>
                  </div>

                  {movementType !== 'adjustment' && (
                    <div className="space-y-1">
                      <label htmlFor="stock-op-reference" className="block text-xs font-medium text-slate-700">
                        Reference (Optional)
                      </label>
                      <input
                        id="stock-op-reference"
                        type="text"
                        maxLength={120}
                        value={referenceInput}
                        onChange={(e) => setReferenceInput(e.target.value)}
                        placeholder="e.g. PO-1042, COUNT-NOV"
                        className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                    </div>
                  )}
                </div>

                {movementType === 'adjustment' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="stock-op-reference-adj" className="block text-xs font-medium text-slate-700">
                        Reference (Optional)
                      </label>
                      <input
                        id="stock-op-reference-adj"
                        type="text"
                        maxLength={120}
                        value={referenceInput}
                        onChange={(e) => setReferenceInput(e.target.value)}
                        placeholder="e.g. COUNT-NOV, DMG-04"
                        className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="stock-op-notes-adj" className="block text-xs font-medium text-slate-700">
                        Notes (Optional)
                      </label>
                      <input
                        id="stock-op-notes-adj"
                        type="text"
                        maxLength={500}
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        placeholder="Reason for adjustment or cycle-count observation"
                        className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                    </div>
                  </div>
                )}

                {movementType !== 'adjustment' && (
                  <div className="space-y-1">
                    <label htmlFor="stock-op-notes" className="block text-xs font-medium text-slate-700">
                      Notes (Optional)
                    </label>
                    <textarea
                      id="stock-op-notes"
                      rows={2}
                      maxLength={500}
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      placeholder="Optional context, delivery note, or return details"
                      className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>
                )}

                {/* Read-only Current Balance Context Bar */}
                {selectedVariant && selectedLocation && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="text-slate-600">
                      Current balance at <strong className="text-slate-900">{selectedLocation.name}</strong>:{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {currentBalance ? formatQuantity(currentBalance.quantity) : '0'}{' '}
                        {formatUnitOfMeasureLabel(selectedVariant.unitOfMeasure)}
                      </span>
                      {!currentBalance && (
                        <span className="text-slate-500 ml-1">(no balance row recorded yet)</span>
                      )}
                    </div>

                    {previewSignedChange !== null && (
                      <div className="font-mono flex items-center gap-2">
                        <span className="text-slate-500">Operation change:</span>
                        <span
                          className={`font-semibold ${
                            previewSignedChange < 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatSignedQuantity(previewSignedChange)}{' '}
                          {formatUnitOfMeasureLabel(selectedVariant.unitOfMeasure)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </fieldset>

              {formError && (
                <div
                  role="alert"
                  className="text-xs px-3.5 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700 flex items-center gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Review &amp; Submit Stock Operation</span>
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Read-only Stock Movement History (public.stock_movements) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Stock Operation History
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Immutable audit trail from <span className="font-mono">public.stock_movements</span> for {activeOrganisation?.name ?? 'this organisation'}.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void onReload()}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshing ? 'Refreshing...' : 'Refresh History'}</span>
            </button>
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="movements-search" className="sr-only">
                Search stock movements
              </label>
              <input
                id="movements-search"
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search product, SKU, reference, notes, actor..."
                className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="movements-type-filter" className="sr-only">
                Filter by movement type
              </label>
              <select
                id="movements-type-filter"
                value={historyTypeFilter}
                onChange={(e) => setHistoryTypeFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All movement types</option>
                {STOCK_MOVEMENT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="movements-location-filter" className="sr-only">
                Filter by location
              </label>
              <select
                id="movements-location-filter"
                value={historyLocationFilter}
                onChange={(e) => setHistoryLocationFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All locations ({scopedAllLocations.length})</option>
                {scopedAllLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.locationType})
                  </option>
                ))}
              </select>
            </div>
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
            Error loading stock movement history: {error}
          </div>
        ) : filteredMovements.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
              <History className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-xs font-semibold text-slate-900">
              {scopedMovements.length === 0
                ? 'No stock movements recorded yet'
                : 'No matching stock movements'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {scopedMovements.length === 0
                ? 'Every opening stock entry, stock receipt, issue, adjustment, and return will appear here as an immutable audit record.'
                : 'Adjust your search term, movement type, or location filter to view matching movements.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Date &amp; Time</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Product &amp; Variant</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">SKU</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Movement Type</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Qty Change</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Qty Before</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Qty After</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Reference</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Notes</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredMovements.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="py-3 px-4 min-w-[180px]">
                      <div className="font-medium text-slate-900">{row.productName}</div>
                      <div className="text-[11px] text-slate-500">{row.variantName}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                      {row.sku}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      <span>{row.locationName}</span>
                      <span className="text-[11px] text-slate-400 ml-1">({row.locationType})</span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      {row.movementTypeLabel}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        row.quantityChange < 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatSignedQuantity(row.quantityChange)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {row.quantityBefore !== null ? formatQuantity(row.quantityBefore) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                      {row.quantityAfter !== null ? formatQuantity(row.quantityAfter) : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {row.reference ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs">
                      {row.notes ? (
                        <span className="line-clamp-2">{row.notes}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      {row.performedByName ?? <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirmation Modal (Owner / Admin / Manager only) */}
      {canOperate && pendingConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stock-op-confirm-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) {
                setPendingConfirmation(null);
                setConfirmationError(null);
              }
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 id="stock-op-confirm-title" className="text-sm font-semibold text-slate-900">
                  Confirm Stock Operation
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verify the details below before recording this stock movement.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setPendingConfirmation(null);
                  setConfirmationError(null);
                }}
                aria-label="Close confirmation dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <dl className="divide-y divide-slate-200 border border-slate-200 rounded-md bg-slate-50/50">
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Product</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {pendingConfirmation.productName}
                  </dd>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Variant / SKU</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {pendingConfirmation.variantName}{' '}
                    <span className="font-mono text-slate-500">({pendingConfirmation.sku})</span>
                  </dd>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Location</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {pendingConfirmation.locationName} ({pendingConfirmation.locationType})
                  </dd>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Operation</dt>
                  <dd className="font-medium text-slate-900 text-right">
                    {pendingConfirmation.movementTypeLabel}
                  </dd>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-slate-500">Quantity Change</dt>
                  <dd
                    className={`font-mono font-semibold text-right ${
                      pendingConfirmation.signedQuantityChange < 0
                        ? 'text-red-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatSignedQuantity(pendingConfirmation.signedQuantityChange)}{' '}
                    {formatUnitOfMeasureLabel(pendingConfirmation.unitOfMeasure)}
                  </dd>
                </div>
                {pendingConfirmation.reference && (
                  <div className="px-3.5 py-2.5 flex items-center justify-between gap-4">
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="font-mono text-slate-800 text-right">
                      {pendingConfirmation.reference}
                    </dd>
                  </div>
                )}
                {pendingConfirmation.notes && (
                  <div className="px-3.5 py-2.5 flex items-start justify-between gap-4">
                    <dt className="text-slate-500 shrink-0">Notes</dt>
                    <dd className="text-slate-700 text-right break-words">
                      {pendingConfirmation.notes}
                    </dd>
                  </div>
                )}
              </dl>

              {confirmationError && (
                <div
                  role="alert"
                  className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{confirmationError}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setPendingConfirmation(null);
                  setConfirmationError(null);
                }}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                aria-busy={submitting}
                onClick={() => void handleConfirmOperation()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                )}
                <span>{submitting ? 'Recording...' : 'Confirm & Record'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

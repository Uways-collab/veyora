import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  InventoryBalanceRecord,
  InventoryLocationRecord,
} from '../inventory/inventoryService';
import {
  computePurchaseReturnAvailability,
  createPurchaseReturnDraft,
  fetchAcceptedReceiptRows,
  validatePurchaseReturnDraftInput,
  type PurchaseAcceptedReceiptRow,
} from './purchaseReturnsService';
import {
  formatPurchaseDate,
  formatPurchaseMoney,
  formatPurchaseNumberPrecision,
  formatPurchaseStatusLabel,
  roundFourDecimals,
} from './purchasesService';
import {
  isPurchaseReturnEligibleStatus,
  type PurchaseCatalogVariant,
  type PurchaseRecord,
  type PurchaseReturnDraftFormInput,
  type PurchaseReturnDraftLineInput,
  type PurchaseReturnItemAvailability,
  type PurchaseReturnMutationResult,
  type PurchaseReturnRecord,
} from './purchasesTypes';

interface PurchaseReturnFormModalProps {
  open: boolean;
  organisationId: string;
  purchases: PurchaseRecord[];
  allReturns: PurchaseReturnRecord[];
  locationsById: Record<string, InventoryLocationRecord>;
  inventoryBalances: InventoryBalanceRecord[];
  catalogVariants: PurchaseCatalogVariant[];
  defaultCurrency: string;
  timeZone?: string | null;
  initialPurchaseId?: string | null;
  onClose: () => void;
  onSuccess: (
    result: PurchaseReturnMutationResult,
    purchase: PurchaseRecord
  ) => Promise<void> | void;
}

function createReturnLine(
  purchaseItemId: string,
  defaultLocationId: string,
  index: number
): PurchaseReturnDraftLineInput {
  return {
    rowKey: `ret-${purchaseItemId}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    purchaseItemId,
    locationId: defaultLocationId,
    quantity: '',
  };
}

function buildInitialLines(
  purchase: PurchaseRecord,
  availabilityByItemId: Map<string, PurchaseReturnItemAvailability>
): PurchaseReturnDraftLineInput[] {
  const rows: PurchaseReturnDraftLineInput[] = [];
  purchase.items.forEach((item, idx) => {
    const avail = availabilityByItemId.get(item.id);
    if (!avail || avail.remainingReturnableQuantity <= 0) return;
    const returnableLocations = avail.byLocation.filter(
      (loc) => loc.remainingReturnableQuantity > 0
    );
    const defaultLocId = returnableLocations.length === 1 ? returnableLocations[0].locationId : '';
    rows.push(createReturnLine(item.id, defaultLocId, idx));
  });
  return rows;
}

export function PurchaseReturnFormModal({
  open,
  organisationId,
  purchases,
  allReturns,
  locationsById,
  inventoryBalances,
  catalogVariants,
  defaultCurrency,
  timeZone,
  initialPurchaseId = null,
  onClose,
  onSuccess,
}: PurchaseReturnFormModalProps) {
  const eligiblePurchases = useMemo(
    () =>
      purchases.filter(
        (p) => isPurchaseReturnEligibleStatus(p.status) && p.items.length > 0
      ),
    [purchases]
  );

  const [selectedPurchaseId, setSelectedPurchaseId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<PurchaseReturnDraftLineInput[]>([]);
  const [acceptedRows, setAcceptedRows] = useState<PurchaseAcceptedReceiptRow[]>([]);
  const [loadingAllocations, setLoadingAllocations] = useState(false);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitLockRef = useRef(false);
  const allocationSeqRef = useRef(0);

  const selectedPurchase = useMemo(
    () => eligiblePurchases.find((p) => p.id === selectedPurchaseId) ?? null,
    [eligiblePurchases, selectedPurchaseId]
  );

  // Reset modal state on open
  useEffect(() => {
    if (!open) return;
    const initialId =
      initialPurchaseId && eligiblePurchases.some((p) => p.id === initialPurchaseId)
        ? initialPurchaseId
        : '';
    setSelectedPurchaseId(initialId);
    setReason('');
    setLines([]);
    setAcceptedRows([]);
    setAllocationsError(null);
    setFormError(null);
    setSubmitting(false);
    submitLockRef.current = false;
  }, [open, initialPurchaseId, eligiblePurchases]);

  // Escape closes when not submitting
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  // Load accepted receipt allocations whenever selectedPurchase changes
  useEffect(() => {
    if (!open || !selectedPurchase) {
      setAcceptedRows([]);
      setAllocationsError(null);
      setLoadingAllocations(false);
      setLines([]);
      return;
    }

    const seq = ++allocationSeqRef.current;
    const itemIds = selectedPurchase.items.map((item) => item.id);
    setLoadingAllocations(true);
    setAllocationsError(null);
    setFormError(null);

    void fetchAcceptedReceiptRows(organisationId, itemIds).then((res) => {
      if (seq !== allocationSeqRef.current) return;
      setLoadingAllocations(false);
      if (res.error) {
        setAllocationsError(res.error);
        setAcceptedRows([]);
        setLines([]);
        return;
      }
      setAcceptedRows(res.rows);
      const nextAvailability = computePurchaseReturnAvailability(
        selectedPurchase,
        res.rows,
        allReturns,
        locationsById,
        inventoryBalances
      );
      setLines(buildInitialLines(selectedPurchase, nextAvailability));
    });
  }, [open, organisationId, selectedPurchase, allReturns, locationsById, inventoryBalances]);

  const availabilityByItemId = useMemo(() => {
    if (!selectedPurchase) {
      return new Map<string, PurchaseReturnItemAvailability>();
    }
    return computePurchaseReturnAvailability(
      selectedPurchase,
      acceptedRows,
      allReturns,
      locationsById,
      inventoryBalances
    );
  }, [selectedPurchase, acceptedRows, allReturns, locationsById, inventoryBalances]);

  const linesByItemId = useMemo(() => {
    const map = new Map<string, PurchaseReturnDraftLineInput[]>();
    for (const line of lines) {
      const existing = map.get(line.purchaseItemId) ?? [];
      existing.push(line);
      map.set(line.purchaseItemId, existing);
    }
    return map;
  }, [lines]);

  const hasAnyReturnableBalance = useMemo(() => {
    for (const avail of availabilityByItemId.values()) {
      if (avail.remainingReturnableQuantity > 0) return true;
    }
    return false;
  }, [availabilityByItemId]);

  const liveSummary = useMemo(() => {
    if (!selectedPurchase) {
      return {
        selectedLineCount: 0,
        totalQuantity: 0,
        totalValue: 0,
      };
    }
    const itemById = new Map(selectedPurchase.items.map((item) => [item.id, item]));
    let selectedLineCount = 0;
    let totalQuantity = 0;
    let totalValue = 0;

    for (const line of lines) {
      const item = itemById.get(line.purchaseItemId);
      if (!item) continue;
      const qtyNum = Number(line.quantity || '0');
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) continue;
      const safeQty = roundFourDecimals(qtyNum);
      const lineTotal = roundFourDecimals(safeQty * item.unitCost);
      selectedLineCount += 1;
      totalQuantity = roundFourDecimals(totalQuantity + safeQty);
      totalValue = roundFourDecimals(totalValue + lineTotal);
    }

    return {
      selectedLineCount,
      totalQuantity,
      totalValue,
    };
  }, [selectedPurchase, lines]);

  if (!open) return null;

  const updateLine = (
    rowKey: string,
    updater: (prev: PurchaseReturnDraftLineInput) => PurchaseReturnDraftLineInput
  ) => {
    setFormError(null);
    setLines((prev) => prev.map((row) => (row.rowKey === rowKey ? updater(row) : row)));
  };

  const handleAddLocationSplit = (purchaseItemId: string) => {
    setFormError(null);
    const avail = availabilityByItemId.get(purchaseItemId);
    const existingForItem = lines.filter((l) => l.purchaseItemId === purchaseItemId);
    const usedLocIds = new Set(existingForItem.map((l) => l.locationId).filter(Boolean));
    const suggestedLoc =
      avail?.byLocation.find(
        (b) => b.remainingReturnableQuantity > 0 && !usedLocIds.has(b.locationId)
      )?.locationId ?? '';

    const newRow = createReturnLine(purchaseItemId, suggestedLoc, existingForItem.length);
    setLines((prev) => {
      const lastIdx = prev.reduce(
        (acc, row, idx) => (row.purchaseItemId === purchaseItemId ? idx : acc),
        -1
      );
      if (lastIdx === -1) return [...prev, newRow];
      return [...prev.slice(0, lastIdx + 1), newRow, ...prev.slice(lastIdx + 1)];
    });
  };

  const handleRemoveLocationSplit = (rowKey: string, purchaseItemId: string) => {
    setFormError(null);
    setLines((prev) => {
      const forItem = prev.filter((l) => l.purchaseItemId === purchaseItemId);
      if (forItem.length <= 1) return prev;
      return prev.filter((l) => l.rowKey !== rowKey);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;

    if (!selectedPurchase) {
      setFormError('Select an eligible purchase order to create a return draft.');
      return;
    }

    const input: PurchaseReturnDraftFormInput = { reason, lines };
    const validation = validatePurchaseReturnDraftInput(
      selectedPurchase,
      input,
      availabilityByItemId
    );
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await createPurchaseReturnDraft(
        organisationId,
        selectedPurchase,
        input,
        availabilityByItemId,
        {
          purchases,
          catalogVariants,
          locationsById,
          defaultCurrency,
        }
      );

      if (result.error) {
        setFormError(result.error);
        return;
      }

      await onSuccess(result, selectedPurchase);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const activeCurrency = selectedPurchase?.currencyCode || defaultCurrency;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-return-form-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2
              id="purchase-return-form-title"
              className="text-sm font-semibold text-slate-900 flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>Create Purchase Return Draft</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select accepted items from a received or partially received purchase order. Inventory
              stock is only deducted when the return is completed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close create purchase return modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-5 overflow-y-auto space-y-5 text-xs flex-1">
            {formError && (
              <div
                role="alert"
                className="p-3.5 rounded-md border border-red-200 bg-red-50 text-red-900 flex items-start gap-2"
              >
                <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {/* Eligible Purchase Selector */}
            <div className="space-y-1.5">
              <label
                htmlFor="return-purchase-select"
                className="block font-medium text-slate-700"
              >
                Eligible Purchase Order <span className="text-red-600">*</span>
              </label>
              <select
                id="return-purchase-select"
                value={selectedPurchaseId}
                disabled={submitting || eligiblePurchases.length === 0}
                onChange={(e) => {
                  setSelectedPurchaseId(e.target.value);
                  setFormError(null);
                }}
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              >
                <option value="">
                  {eligiblePurchases.length === 0
                    ? 'No received or partially received purchases available'
                    : 'Select a partially received or received purchase order...'}
                </option>
                {eligiblePurchases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.purchaseNumber} · {p.supplierName} ·{' '}
                    {formatPurchaseStatusLabel(p.status)} ·{' '}
                    {formatPurchaseDate(p.orderDate, timeZone)}
                  </option>
                ))}
              </select>
              {eligiblePurchases.length === 0 && (
                <p className="text-[11px] text-amber-800">
                  Receive accepted goods on a confirmed purchase order before creating a purchase
                  return.
                </p>
              )}
            </div>

            {selectedPurchase && (
              <>
                {/* Selected Purchase Context */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5">
                  <div>
                    <div className="text-[11px] text-slate-500">Purchase #</div>
                    <div className="font-mono font-semibold text-slate-900 mt-0.5">
                      {selectedPurchase.purchaseNumber}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Supplier</div>
                    <div className="font-medium text-slate-900 mt-0.5 truncate">
                      {selectedPurchase.supplierName}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Order Status</div>
                    <div className="font-medium text-slate-800 mt-0.5">
                      {formatPurchaseStatusLabel(selectedPurchase.status)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Currency</div>
                    <div className="font-mono text-slate-800 mt-0.5">{activeCurrency}</div>
                  </div>
                </div>

                {loadingAllocations ? (
                  <div className="space-y-2.5" aria-busy="true">
                    <div className="h-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-16 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : allocationsError ? (
                  <div
                    role="alert"
                    className="p-3.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900 flex items-start gap-2"
                  >
                    <AlertTriangle
                      className="h-4 w-4 text-amber-700 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div>
                      <div className="font-semibold">Unable to load accepted receipt stock</div>
                      <div className="mt-0.5">{allocationsError}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {!hasAnyReturnableBalance && (
                      <div
                        role="status"
                        className="p-3.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900 flex items-start gap-2"
                      >
                        <AlertTriangle
                          className="h-4 w-4 text-amber-700 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <span>
                          No returnable accepted stock remains on this purchase order. Any accepted
                          quantities have already been returned or reserved in existing draft
                          returns, or only damaged units were recorded.
                        </span>
                      </div>
                    )}

                    {/* Purchase Items */}
                    <div className="space-y-3">
                      {selectedPurchase.items.map((item) => {
                        const avail = availabilityByItemId.get(item.id);
                        const acceptedQty = avail?.acceptedReceivedQuantity ?? 0;
                        const damagedQty = avail?.damagedQuantity ?? 0;
                        const completedQty = avail?.completedReturnedQuantity ?? 0;
                        const draftReservedQty = avail?.draftReservedQuantity ?? 0;
                        const remainingQty = avail?.remainingReturnableQuantity ?? 0;
                        const returnableLocations = (avail?.byLocation ?? []).filter(
                          (b) => b.remainingReturnableQuantity > 0
                        );
                        const itemLines = linesByItemId.get(item.id) ?? [];

                        return (
                          <section
                            key={item.id}
                            className={`border rounded-lg overflow-hidden ${
                              remainingQty <= 0
                                ? 'border-slate-200 bg-slate-50/70'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            {/* Item Summary Header */}
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900">
                                  {item.productName}{' '}
                                  <span className="font-normal text-slate-600">
                                    — {item.variantName}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                                  <span className="font-mono">SKU: {item.sku}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>UoM: {item.unitOfMeasure}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    Unit Cost:{' '}
                                    <span className="font-mono tabular-nums text-slate-700">
                                      {formatPurchaseMoney(item.unitCost, activeCurrency)}
                                    </span>
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                                <div>
                                  <span className="text-slate-500">Accepted: </span>
                                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                                    {formatPurchaseNumberPrecision(acceptedQty)}
                                  </span>
                                  {damagedQty > 0 && (
                                    <span className="text-amber-800 ml-1">
                                      ({formatPurchaseNumberPrecision(damagedQty)} damaged)
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <span className="text-slate-500">Returned: </span>
                                  <span className="font-mono tabular-nums font-semibold text-slate-700">
                                    {formatPurchaseNumberPrecision(completedQty)}
                                  </span>
                                </div>
                                {draftReservedQty > 0 && (
                                  <div>
                                    <span className="text-slate-500">In Drafts: </span>
                                    <span className="font-mono tabular-nums font-semibold text-amber-800">
                                      {formatPurchaseNumberPrecision(draftReservedQty)}
                                    </span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-slate-500">Returnable: </span>
                                  <span
                                    className={`font-mono tabular-nums font-semibold ${
                                      remainingQty > 0 ? 'text-blue-700' : 'text-slate-500'
                                    }`}
                                  >
                                    {formatPurchaseNumberPrecision(remainingQty)}
                                  </span>
                                </div>
                                {remainingQty > 0 && returnableLocations.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleAddLocationSplit(item.id)}
                                    disabled={
                                      submitting || itemLines.length >= returnableLocations.length
                                    }
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    <Plus className="h-3 w-3" aria-hidden="true" />
                                    <span>Split Location</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Body Rows */}
                            {remainingQty <= 0 ? (
                              <div className="px-4 py-3 text-[11px] text-slate-600 flex items-center gap-1.5">
                                <CheckCircle2
                                  className="h-3.5 w-3.5 text-slate-400 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>
                                  {acceptedQty <= 0
                                    ? 'No accepted units entered inventory for this item (damaged goods cannot be returned).'
                                    : draftReservedQty > 0
                                      ? 'All remaining accepted units are currently reserved by existing draft returns or completed returns.'
                                      : 'All accepted units for this item have already been returned.'}
                                </span>
                              </div>
                            ) : (
                              <div className="divide-y divide-slate-200">
                                {itemLines.map((row, rowIdx) => {
                                  const selectedLoc = returnableLocations.find(
                                    (b) => b.locationId === row.locationId
                                  );
                                  const qtyNum = Number(row.quantity || '0');
                                  const safeQty =
                                    Number.isFinite(qtyNum) && qtyNum > 0
                                      ? roundFourDecimals(qtyNum)
                                      : 0;
                                  const lineTotal = roundFourDecimals(safeQty * item.unitCost);
                                  const maxAtLoc = selectedLoc
                                    ? selectedLoc.currentStockQuantity !== null
                                      ? Math.min(
                                          selectedLoc.remainingReturnableQuantity,
                                          Math.max(0, selectedLoc.currentStockQuantity)
                                        )
                                      : selectedLoc.remainingReturnableQuantity
                                    : 0;

                                  return (
                                    <div key={row.rowKey} className="p-3.5 space-y-2">
                                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                        {/* Location Selector */}
                                        <div className="sm:col-span-6 space-y-1">
                                          <label
                                            htmlFor={`ret-loc-${row.rowKey}`}
                                            className="block text-[11px] font-medium text-slate-700"
                                          >
                                            Return From Location
                                            {itemLines.length > 1 ? ` #${rowIdx + 1}` : ''}
                                          </label>
                                          <select
                                            id={`ret-loc-${row.rowKey}`}
                                            value={row.locationId}
                                            disabled={submitting}
                                            onChange={(e) =>
                                              updateLine(row.rowKey, (prev) => ({
                                                ...prev,
                                                locationId: e.target.value,
                                              }))
                                            }
                                            className="w-full px-2.5 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                                          >
                                            <option value="">
                                              Select location holding accepted stock...
                                            </option>
                                            {returnableLocations.map((locBal) => (
                                              <option
                                                key={locBal.locationId}
                                                value={locBal.locationId}
                                              >
                                                {locBal.locationName} — Returnable:{' '}
                                                {formatPurchaseNumberPrecision(
                                                  locBal.remainingReturnableQuantity
                                                )}
                                                {locBal.currentStockQuantity !== null
                                                  ? ` (On Hand: ${formatPurchaseNumberPrecision(
                                                      locBal.currentStockQuantity
                                                    )})`
                                                  : ''}
                                              </option>
                                            ))}
                                          </select>
                                        </div>

                                        {/* Return Quantity */}
                                        <div className="sm:col-span-3 space-y-1">
                                          <div className="flex items-center justify-between gap-2">
                                            <label
                                              htmlFor={`ret-qty-${row.rowKey}`}
                                              className="block text-[11px] font-medium text-slate-700"
                                            >
                                              Qty to Return
                                            </label>
                                            {selectedLoc && maxAtLoc > 0 && (
                                              <button
                                                type="button"
                                                disabled={submitting}
                                                onClick={() =>
                                                  updateLine(row.rowKey, (prev) => ({
                                                    ...prev,
                                                    quantity: String(maxAtLoc),
                                                  }))
                                                }
                                                className="text-[11px] font-medium text-blue-700 hover:underline"
                                              >
                                                Max ({formatPurchaseNumberPrecision(maxAtLoc)})
                                              </button>
                                            )}
                                          </div>
                                          <input
                                            id={`ret-qty-${row.rowKey}`}
                                            type="number"
                                            min="0"
                                            step="any"
                                            placeholder="0"
                                            value={row.quantity}
                                            disabled={submitting}
                                            onChange={(e) =>
                                              updateLine(row.rowKey, (prev) => ({
                                                ...prev,
                                                quantity: e.target.value,
                                              }))
                                            }
                                            className="w-full px-2.5 py-2 rounded-md border border-slate-200 bg-white font-mono tabular-nums text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                          />
                                        </div>

                                        {/* Line Total */}
                                        <div className="sm:col-span-2 space-y-1 text-right">
                                          <div className="text-[11px] font-medium text-slate-500">
                                            Line Total
                                          </div>
                                          <div className="py-2 font-mono tabular-nums font-semibold text-slate-900">
                                            {formatPurchaseMoney(lineTotal, activeCurrency)}
                                          </div>
                                        </div>

                                        {/* Remove Split */}
                                        <div className="sm:col-span-1 flex justify-end">
                                          {itemLines.length > 1 && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleRemoveLocationSplit(row.rowKey, item.id)
                                              }
                                              disabled={submitting}
                                              aria-label={`Remove location split #${rowIdx + 1}`}
                                              className="p-2 rounded-md border border-slate-200 text-slate-500 hover:text-red-700 hover:border-red-200 hover:bg-red-50"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {selectedLoc && (
                                        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                                          <span>
                                            Accepted at location:{' '}
                                            <span className="font-mono text-slate-700">
                                              {formatPurchaseNumberPrecision(
                                                selectedLoc.acceptedReceivedQuantity
                                              )}
                                            </span>
                                          </span>
                                          {selectedLoc.draftReservedQuantity > 0 && (
                                            <span className="text-amber-800">
                                              Reserved in drafts:{' '}
                                              <span className="font-mono">
                                                {formatPurchaseNumberPrecision(
                                                  selectedLoc.draftReservedQuantity
                                                )}
                                              </span>
                                            </span>
                                          )}
                                          {selectedLoc.currentStockQuantity !== null && (
                                            <span>
                                              Current stock on hand:{' '}
                                              <span className="font-mono text-slate-700">
                                                {formatPurchaseNumberPrecision(
                                                  selectedLoc.currentStockQuantity
                                                )}
                                              </span>
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Return Reason */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="purchase-return-reason"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Return Reason <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="purchase-return-reason"
                    rows={3}
                    maxLength={1000}
                    required
                    value={reason}
                    disabled={submitting}
                    onChange={(e) => {
                      setFormError(null);
                      setReason(e.target.value);
                    }}
                    placeholder="Explain why these accepted items are being returned to the supplier (e.g., wrong batch, defective after inspection, over-supplied)..."
                    className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                {/* Live Return Summary */}
                <section className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500">Return Lines Selected</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {liveSummary.selectedLineCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Total Return Quantity</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatPurchaseNumberPrecision(liveSummary.totalQuantity)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Total Return Value</div>
                    <div className="font-mono text-sm font-semibold text-blue-700 tabular-nums mt-0.5">
                      {formatPurchaseMoney(liveSummary.totalValue, activeCurrency)}
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                loadingAllocations ||
                !selectedPurchase ||
                !hasAnyReturnableBalance ||
                Boolean(allocationsError)
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Saving Draft...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Save Return Draft</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

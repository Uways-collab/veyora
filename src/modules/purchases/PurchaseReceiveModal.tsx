import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  PackageCheck,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { InventoryLocationRecord } from '../inventory/inventoryService';
import {
  formatPurchaseNumberPrecision,
  formatPurchaseStatusLabel,
  receivePurchaseGoods,
  roundFourDecimals,
  validatePurchaseReceiveInput,
} from './purchasesService';
import {
  isPurchaseReceivableStatus,
  type PurchaseCatalogVariant,
  type PurchaseItemRecord,
  type PurchaseReceiveFormInput,
  type PurchaseReceiveLineInput,
  type PurchaseReceiveResult,
  type PurchaseRecord,
} from './purchasesTypes';

interface PurchaseReceiveModalProps {
  open: boolean;
  organisationId: string;
  purchase: PurchaseRecord | null;
  activeLocations: InventoryLocationRecord[];
  locationsById: Record<string, InventoryLocationRecord>;
  catalogVariants: PurchaseCatalogVariant[];
  onClose: () => void;
  onSuccess: (result: PurchaseReceiveResult, purchase: PurchaseRecord) => Promise<void> | void;
}

function createReceiveLine(
  purchaseItemId: string,
  defaultLocationId: string,
  index: number
): PurchaseReceiveLineInput {
  return {
    rowKey: `rcv-${purchaseItemId}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    purchaseItemId,
    locationId: defaultLocationId,
    receivedQuantity: '',
    acceptedQuantity: '0',
    damagedQuantity: '0',
  };
}

function buildInitialLines(
  items: PurchaseItemRecord[],
  defaultLocationId: string
): PurchaseReceiveLineInput[] {
  const rows: PurchaseReceiveLineInput[] = [];
  items.forEach((item, idx) => {
    const remaining = Math.max(0, roundFourDecimals(item.orderedQuantity - item.receivedQuantity));
    if (remaining > 0) {
      rows.push(createReceiveLine(item.id, defaultLocationId, idx));
    }
  });
  return rows;
}

export function PurchaseReceiveModal({
  open,
  organisationId,
  purchase,
  activeLocations,
  locationsById,
  catalogVariants,
  onClose,
  onSuccess,
}: PurchaseReceiveModalProps) {
  const defaultLocationId = activeLocations.length === 1 ? activeLocations[0].id : '';

  const [lines, setLines] = useState<PurchaseReceiveLineInput[]>([]);
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'entry' | 'confirm'>('entry');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitLockRef = useRef(false);

  const activeLocationIds = useMemo(
    () => new Set(activeLocations.map((loc) => loc.id)),
    [activeLocations]
  );

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of activeLocations) {
      map.set(loc.id, loc.name);
    }
    return map;
  }, [activeLocations]);

  const itemById = useMemo(
    () => new Map((purchase?.items ?? []).map((item) => [item.id, item])),
    [purchase]
  );

  useEffect(() => {
    if (!open || !purchase) return;
    setLines(buildInitialLines(purchase.items, defaultLocationId));
    setNotes('');
    setStep('entry');
    setFormError(null);
    setSubmitting(false);
    submitLockRef.current = false;
  }, [open, purchase, defaultLocationId]);

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

  const linesByItemId = useMemo(() => {
    const map = new Map<string, PurchaseReceiveLineInput[]>();
    for (const line of lines) {
      const existing = map.get(line.purchaseItemId) ?? [];
      existing.push(line);
      map.set(line.purchaseItemId, existing);
    }
    return map;
  }, [lines]);

  const liveSummary = useMemo(() => {
    let totalReceived = 0;
    let totalAccepted = 0;
    let totalDamaged = 0;
    const activePurchaseItemIds = new Set<string>();
    const selectedLocationIds = new Set<string>();

    for (const line of lines) {
      const rec = Number(line.receivedQuantity || '0');
      const acc = Number(line.acceptedQuantity || '0');
      const dmg = Number(line.damagedQuantity || '0');
      const safeRec = Number.isFinite(rec) && rec > 0 ? roundFourDecimals(rec) : 0;
      const safeAcc = Number.isFinite(acc) && acc >= 0 ? roundFourDecimals(acc) : 0;
      const safeDmg = Number.isFinite(dmg) && dmg >= 0 ? roundFourDecimals(dmg) : 0;

      if (safeRec > 0) {
        activePurchaseItemIds.add(line.purchaseItemId);
        totalReceived = roundFourDecimals(totalReceived + safeRec);
        totalAccepted = roundFourDecimals(totalAccepted + safeAcc);
        totalDamaged = roundFourDecimals(totalDamaged + safeDmg);
        if (line.locationId) {
          selectedLocationIds.add(line.locationId);
        }
      }
    }

    const locationNames = Array.from(selectedLocationIds)
      .map((id) => locationNameById.get(id) ?? 'Unknown Location')
      .sort((a, b) => a.localeCompare(b));

    return {
      totalReceived,
      totalAccepted,
      totalDamaged,
      distinctItemCount: activePurchaseItemIds.size,
      locationNames,
    };
  }, [lines, locationNameById]);

  if (!open || !purchase) return null;

  const isReceivable = isPurchaseReceivableStatus(purchase.status);
  const hasActiveLocations = activeLocations.length > 0;

  const updateLine = (
    rowKey: string,
    updater: (prev: PurchaseReceiveLineInput) => PurchaseReceiveLineInput
  ) => {
    setFormError(null);
    setLines((prev) => prev.map((row) => (row.rowKey === rowKey ? updater(row) : row)));
  };

  const handleReceivedChange = (rowKey: string, nextValue: string) => {
    updateLine(rowKey, (prev) => {
      const prevRecTrimmed = prev.receivedQuantity.trim();
      const prevAccTrimmed = prev.acceptedQuantity.trim();
      const prevDmgTrimmed = prev.damagedQuantity.trim();
      const prevDmgNum = prevDmgTrimmed === '' ? 0 : Number(prevDmgTrimmed);
      const prevRecNum = prevRecTrimmed === '' ? 0 : Number(prevRecTrimmed);
      const prevAccNum = prevAccTrimmed === '' ? 0 : Number(prevAccTrimmed);

      // Keep accepted synced automatically when no damage was entered and accepted wasn't diverged
      const shouldSyncAccepted =
        Number.isFinite(prevDmgNum) &&
        prevDmgNum === 0 &&
        (prevAccTrimmed === '' ||
          prevAccTrimmed === '0' ||
          (Number.isFinite(prevRecNum) &&
            Number.isFinite(prevAccNum) &&
            roundFourDecimals(prevRecNum) === roundFourDecimals(prevAccNum)));

      return {
        ...prev,
        receivedQuantity: nextValue,
        acceptedQuantity: shouldSyncAccepted
          ? nextValue.trim() === ''
            ? '0'
            : nextValue
          : prev.acceptedQuantity,
      };
    });
  };

  const handleAddLocationSplit = (purchaseItemId: string) => {
    setFormError(null);
    const existingForItem = lines.filter((l) => l.purchaseItemId === purchaseItemId);
    const usedLocationIds = new Set(existingForItem.map((l) => l.locationId).filter(Boolean));
    const suggestedLocation =
      activeLocations.find((loc) => !usedLocationIds.has(loc.id))?.id ?? '';

    const newRow = createReceiveLine(purchaseItemId, suggestedLocation, existingForItem.length);
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

  const handleFillItemRemaining = (item: PurchaseItemRecord) => {
    setFormError(null);
    const remaining = Math.max(0, roundFourDecimals(item.orderedQuantity - item.receivedQuantity));
    if (remaining <= 0) return;

    setLines((prev) => {
      let seenFirst = false;
      return prev
        .filter((row) => {
          if (row.purchaseItemId !== item.id) return true;
          if (!seenFirst) {
            seenFirst = true;
            return true;
          }
          return false;
        })
        .map((row) => {
          if (row.purchaseItemId !== item.id) return row;
          return {
            ...row,
            locationId: row.locationId || defaultLocationId,
            receivedQuantity: String(remaining),
            acceptedQuantity: String(remaining),
            damagedQuantity: '0',
          };
        });
    });
  };

  const handleFillAllRemaining = () => {
    setFormError(null);
    const nextRows: PurchaseReceiveLineInput[] = [];
    purchase.items.forEach((item, idx) => {
      const remaining = Math.max(
        0,
        roundFourDecimals(item.orderedQuantity - item.receivedQuantity)
      );
      if (remaining <= 0) return;
      const existingFirst = lines.find((l) => l.purchaseItemId === item.id);
      nextRows.push({
        rowKey: existingFirst?.rowKey ?? createReceiveLine(item.id, defaultLocationId, idx).rowKey,
        purchaseItemId: item.id,
        locationId: existingFirst?.locationId || defaultLocationId,
        receivedQuantity: String(remaining),
        acceptedQuantity: String(remaining),
        damagedQuantity: '0',
      });
    });
    setLines(nextRows);
  };

  const handleClearAllQuantities = () => {
    setFormError(null);
    setLines(buildInitialLines(purchase.items, defaultLocationId));
  };

  const formInput: PurchaseReceiveFormInput = { notes, lines };

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || submitLockRef.current) return;
    if (!isReceivable) {
      setFormError('Goods can only be received for Ordered or Partially Received orders.');
      return;
    }
    if (!hasActiveLocations) {
      setFormError(
        'No active inventory locations exist. Create or activate an inventory location before receiving goods.'
      );
      return;
    }

    const validation = validatePurchaseReceiveInput(purchase.items, formInput, {
      activeLocationIds,
    });
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    setFormError(null);
    setStep('confirm');
  };

  const handleConfirmSubmit = async () => {
    if (submitLockRef.current || submitting) return;
    if (!isReceivable) {
      setFormError('Goods can only be received for Ordered or Partially Received orders.');
      return;
    }

    const validation = validatePurchaseReceiveInput(purchase.items, formInput, {
      activeLocationIds,
    });
    if (!validation.ok) {
      setFormError(validation.error);
      setStep('entry');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await receivePurchaseGoods(organisationId, purchase, formInput, {
        activeLocations,
        locationsById,
        catalogVariants,
      });

      if (result.error) {
        setFormError(result.error);
        return;
      }

      await onSuccess(result, purchase);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const confirmationValidation =
    step === 'confirm'
      ? validatePurchaseReceiveInput(purchase.items, formInput, { activeLocationIds })
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receive-goods-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden shadow-xl">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2
              id="receive-goods-title"
              className="text-sm font-semibold text-slate-900 flex items-center gap-2"
            >
              <PackageCheck className="h-4 w-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>
                {step === 'confirm' ? 'Confirm Goods Receipt' : 'Receive Goods'} ·{' '}
                <span className="font-mono">{purchase.purchaseNumber}</span>
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {purchase.supplierName} · Status: {formatPurchaseStatusLabel(purchase.status)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close goods receiving modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        {step === 'entry' ? (
          <form onSubmit={handleProceedToConfirm} className="flex flex-col flex-1 min-h-0">
            <div className="p-5 overflow-y-auto space-y-5 text-xs flex-1">
              {formError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-md border border-red-200 bg-red-50 text-red-900 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-red-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              {!hasActiveLocations && (
                <div
                  role="alert"
                  className="p-3.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-amber-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    No active inventory locations were found. Create or activate an inventory
                    location in Inventory before recording a delivery.
                  </span>
                </div>
              )}

              {/* Quick Toolbar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
                <div className="text-slate-600">
                  Enter physically delivered, accepted, and damaged quantities per receiving
                  location. Accepted units enter inventory stock; damaged units are logged without
                  adding stock.
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleFillAllRemaining}
                    disabled={!hasActiveLocations || submitting}
                    className="px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
                  >
                    Fill All Remaining
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAllQuantities}
                    disabled={submitting}
                    className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Purchase Items */}
              <div className="space-y-3">
                {purchase.items.map((item) => {
                  const remaining = Math.max(
                    0,
                    roundFourDecimals(item.orderedQuantity - item.receivedQuantity)
                  );
                  const itemLines = linesByItemId.get(item.id) ?? [];
                  const allocatedTotal = roundFourDecimals(
                    itemLines.reduce((sum, l) => {
                      const val = Number(l.receivedQuantity || '0');
                      return Number.isFinite(val) && val > 0 ? sum + val : sum;
                    }, 0)
                  );
                  const overAllocated = allocatedTotal > remaining;

                  return (
                    <section
                      key={item.id}
                      className={`border rounded-lg overflow-hidden ${
                        remaining <= 0
                          ? 'border-slate-200 bg-slate-50/70'
                          : overAllocated
                            ? 'border-red-300 bg-white'
                            : 'border-slate-200 bg-white'
                      }`}
                    >
                      {/* Purchase Item Header */}
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">
                            {item.productName}{' '}
                            <span className="font-normal text-slate-600">— {item.variantName}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                            <span className="font-mono">SKU: {item.sku}</span>
                            <span aria-hidden="true">·</span>
                            <span>UoM: {item.unitOfMeasure}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                          <div>
                            <span className="text-slate-500">Ordered: </span>
                            <span className="font-mono tabular-nums font-semibold text-slate-900">
                              {formatPurchaseNumberPrecision(item.orderedQuantity)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Prev. Received: </span>
                            <span className="font-mono tabular-nums font-semibold text-slate-800">
                              {formatPurchaseNumberPrecision(item.receivedQuantity)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500">Remaining: </span>
                            <span
                              className={`font-mono tabular-nums font-semibold ${
                                remaining > 0 ? 'text-blue-700' : 'text-emerald-700'
                              }`}
                            >
                              {formatPurchaseNumberPrecision(remaining)}
                            </span>
                          </div>
                          {remaining > 0 && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleFillItemRemaining(item)}
                                disabled={!hasActiveLocations || submitting}
                                className="px-2 py-1 rounded border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              >
                                Fill
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAddLocationSplit(item.id)}
                                disabled={!hasActiveLocations || submitting}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              >
                                <Plus className="h-3 w-3" aria-hidden="true" />
                                <span>Split Location</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Delivery Rows */}
                      {remaining <= 0 ? (
                        <div className="px-4 py-3 text-[11px] text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>All ordered quantities for this line have been received.</span>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200">
                          {itemLines.map((row, rowIdx) => {
                            const recNum = roundFourDecimals(
                              Number(row.receivedQuantity || '0') || 0
                            );
                            const accNum = roundFourDecimals(
                              Number(row.acceptedQuantity || '0') || 0
                            );
                            const dmgNum = roundFourDecimals(
                              Number(row.damagedQuantity || '0') || 0
                            );
                            const sumAccounted = roundFourDecimals(accNum + dmgNum);
                            const rowMismatch = recNum > 0 && sumAccounted !== recNum;

                            return (
                              <div key={row.rowKey} className="p-3.5 space-y-2.5">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                  {/* Receiving Location */}
                                  <div className="sm:col-span-5 space-y-1">
                                    <label
                                      htmlFor={`loc-${row.rowKey}`}
                                      className="block text-[11px] font-medium text-slate-700"
                                    >
                                      Receiving Location
                                      {itemLines.length > 1 ? ` #${rowIdx + 1}` : ''}
                                    </label>
                                    <select
                                      id={`loc-${row.rowKey}`}
                                      value={row.locationId}
                                      disabled={!hasActiveLocations || submitting}
                                      onChange={(e) =>
                                        updateLine(row.rowKey, (prev) => ({
                                          ...prev,
                                          locationId: e.target.value,
                                        }))
                                      }
                                      className="w-full px-2.5 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                                    >
                                      <option value="">Select receiving location...</option>
                                      {activeLocations.map((loc) => (
                                        <option key={loc.id} value={loc.id}>
                                          {loc.name} ({loc.locationType})
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Physically Delivered */}
                                  <div className="sm:col-span-2 space-y-1">
                                    <label
                                      htmlFor={`rec-${row.rowKey}`}
                                      className="block text-[11px] font-medium text-slate-700"
                                    >
                                      Delivered Qty
                                    </label>
                                    <input
                                      id={`rec-${row.rowKey}`}
                                      type="number"
                                      min="0"
                                      step="any"
                                      placeholder="0"
                                      value={row.receivedQuantity}
                                      disabled={!hasActiveLocations || submitting}
                                      onChange={(e) =>
                                        handleReceivedChange(row.rowKey, e.target.value)
                                      }
                                      className="w-full px-2.5 py-2 rounded-md border border-slate-200 bg-white font-mono tabular-nums text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                    />
                                  </div>

                                  {/* Accepted */}
                                  <div className="sm:col-span-2 space-y-1">
                                    <label
                                      htmlFor={`acc-${row.rowKey}`}
                                      className="block text-[11px] font-medium text-emerald-800"
                                    >
                                      Accepted Qty
                                    </label>
                                    <input
                                      id={`acc-${row.rowKey}`}
                                      type="number"
                                      min="0"
                                      step="any"
                                      placeholder="0"
                                      value={row.acceptedQuantity}
                                      disabled={!hasActiveLocations || submitting}
                                      onChange={(e) =>
                                        updateLine(row.rowKey, (prev) => ({
                                          ...prev,
                                          acceptedQuantity: e.target.value,
                                        }))
                                      }
                                      className="w-full px-2.5 py-2 rounded-md border border-slate-200 bg-white font-mono tabular-nums text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                    />
                                  </div>

                                  {/* Damaged */}
                                  <div className="sm:col-span-2 space-y-1">
                                    <label
                                      htmlFor={`dmg-${row.rowKey}`}
                                      className="block text-[11px] font-medium text-amber-800"
                                    >
                                      Damaged Qty
                                    </label>
                                    <input
                                      id={`dmg-${row.rowKey}`}
                                      type="number"
                                      min="0"
                                      step="any"
                                      placeholder="0"
                                      value={row.damagedQuantity}
                                      disabled={!hasActiveLocations || submitting}
                                      onChange={(e) =>
                                        updateLine(row.rowKey, (prev) => ({
                                          ...prev,
                                          damagedQuantity: e.target.value,
                                        }))
                                      }
                                      className="w-full px-2.5 py-2 rounded-md border border-slate-200 bg-white font-mono tabular-nums text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                    />
                                  </div>

                                  {/* Remove split */}
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

                                {rowMismatch && (
                                  <div className="text-[11px] text-amber-800">
                                    Accepted ({formatPurchaseNumberPrecision(accNum)}) + Damaged (
                                    {formatPurchaseNumberPrecision(dmgNum)}) ={' '}
                                    {formatPurchaseNumberPrecision(sumAccounted)}, must equal
                                    Delivered ({formatPurchaseNumberPrecision(recNum)}).
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {itemLines.length > 1 && (
                            <div
                              className={`px-4 py-2 text-[11px] flex items-center justify-between ${
                                overAllocated
                                  ? 'bg-red-50 text-red-800 font-medium'
                                  : 'bg-slate-50/70 text-slate-600'
                              }`}
                            >
                              <span>Combined quantity across {itemLines.length} locations</span>
                              <span className="font-mono tabular-nums">
                                {formatPurchaseNumberPrecision(allocatedTotal)} /{' '}
                                {formatPurchaseNumberPrecision(remaining)} remaining
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>

              {/* Receiving Notes */}
              <div className="space-y-1.5">
                <label
                  htmlFor="receive-goods-notes"
                  className="block text-xs font-medium text-slate-700"
                >
                  Receiving Notes <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="receive-goods-notes"
                  rows={2}
                  maxLength={1000}
                  value={notes}
                  disabled={submitting}
                  onChange={(e) => {
                    setFormError(null);
                    setNotes(e.target.value);
                  }}
                  placeholder="Delivery docket reference, carrier details, or condition notes..."
                  className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {/* Live Receiving Summary */}
              <section className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-900">Receiving Summary</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500">Physically Received</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatPurchaseNumberPrecision(liveSummary.totalReceived)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Accepted (Stock In)</div>
                    <div className="font-mono text-sm font-semibold text-emerald-700 tabular-nums mt-0.5">
                      {formatPurchaseNumberPrecision(liveSummary.totalAccepted)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Damaged (No Stock)</div>
                    <div className="font-mono text-sm font-semibold text-amber-800 tabular-nums mt-0.5">
                      {formatPurchaseNumberPrecision(liveSummary.totalDamaged)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Purchase Lines Received</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {liveSummary.distinctItemCount}
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="font-medium text-slate-700">Selected Receiving Locations:</span>
                  <span>
                    {liveSummary.locationNames.length > 0
                      ? liveSummary.locationNames.join(', ')
                      : 'None selected yet'}
                  </span>
                </div>
              </section>
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
                disabled={!hasActiveLocations || submitting || !isReceivable}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Review & Confirm Delivery</span>
              </button>
            </div>
          </form>
        ) : (
          /* Step 2: Final Confirmation */
          <div className="flex flex-col flex-1 min-h-0">
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {formError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-md border border-red-200 bg-red-50 text-red-900 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-red-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              <div className="p-3.5 rounded-md border border-blue-200 bg-blue-50/70 text-blue-950 leading-relaxed">
                Confirm this delivery for{' '}
                <span className="font-mono font-semibold">{purchase.purchaseNumber}</span>.
                Accepted quantities will be added to inventory stock at the selected locations via{' '}
                <span className="font-mono">stock_in</span> movements. Damaged units will be
                recorded on the receipt without increasing available stock.
              </div>

              {confirmationValidation?.ok && (
                <>
                  {/* Totals Confirmation Grid */}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-[11px] text-slate-500">Total Delivered</div>
                      <div className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                        {formatPurchaseNumberPrecision(
                          confirmationValidation.normalized.totalReceived
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Total Accepted</div>
                      <div className="font-mono text-base font-semibold text-emerald-700 tabular-nums mt-0.5">
                        {formatPurchaseNumberPrecision(
                          confirmationValidation.normalized.totalAccepted
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Total Damaged</div>
                      <div className="font-mono text-base font-semibold text-amber-800 tabular-nums mt-0.5">
                        {formatPurchaseNumberPrecision(
                          confirmationValidation.normalized.totalDamaged
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Purchase Lines</div>
                      <div className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                        {confirmationValidation.normalized.distinctPurchaseItemCount}
                      </div>
                    </div>
                  </div>

                  {/* Breakdown Table */}
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 font-semibold text-slate-900">
                      Delivery Allocations ({confirmationValidation.normalized.rpcItems.length})
                    </div>
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-500">
                            <th className="py-2 px-3">Product & Variant</th>
                            <th className="py-2 px-3">SKU</th>
                            <th className="py-2 px-3">Location</th>
                            <th className="py-2 px-3 text-right">Received</th>
                            <th className="py-2 px-3 text-right">Accepted</th>
                            <th className="py-2 px-3 text-right">Damaged</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {confirmationValidation.normalized.rpcItems.map((rpcItem) => {
                            const item = itemById.get(rpcItem.purchase_item_id);
                            const locName =
                              locationNameById.get(rpcItem.location_id) ?? 'Unknown Location';
                            return (
                              <tr key={`${rpcItem.purchase_item_id}:${rpcItem.location_id}`}>
                                <td className="py-2.5 px-3">
                                  <div className="font-medium text-slate-900">
                                    {item?.productName ?? 'Product'}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {item?.variantName ?? 'Variant'} · {item?.unitOfMeasure ?? 'Unit'}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                                  {item?.sku ?? '—'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-800">{locName}</td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-900">
                                  {formatPurchaseNumberPrecision(rpcItem.received_quantity)}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-emerald-700">
                                  {formatPurchaseNumberPrecision(rpcItem.accepted_quantity)}
                                </td>
                                <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-amber-800">
                                  {formatPurchaseNumberPrecision(rpcItem.damaged_quantity)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Confirmation Cards */}
                    <div className="sm:hidden divide-y divide-slate-200">
                      {confirmationValidation.normalized.rpcItems.map((rpcItem) => {
                        const item = itemById.get(rpcItem.purchase_item_id);
                        const locName =
                          locationNameById.get(rpcItem.location_id) ?? 'Unknown Location';
                        return (
                          <div
                            key={`${rpcItem.purchase_item_id}:${rpcItem.location_id}`}
                            className="p-3.5 space-y-1.5"
                          >
                            <div className="font-medium text-slate-900">
                              {item?.productName ?? 'Product'} — {item?.variantName ?? 'Variant'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              SKU: <span className="font-mono">{item?.sku ?? '—'}</span> · Location:{' '}
                              <span className="text-slate-800 font-medium">{locName}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 pt-1 font-mono tabular-nums text-[11px]">
                              <div>
                                <span className="text-slate-500 block font-sans">Received</span>
                                <span className="font-semibold text-slate-900">
                                  {formatPurchaseNumberPrecision(rpcItem.received_quantity)}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block font-sans">Accepted</span>
                                <span className="font-semibold text-emerald-700">
                                  {formatPurchaseNumberPrecision(rpcItem.accepted_quantity)}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block font-sans">Damaged</span>
                                <span className="font-semibold text-amber-800">
                                  {formatPurchaseNumberPrecision(rpcItem.damaged_quantity)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {confirmationValidation.normalized.notes && (
                    <div className="border border-slate-200 rounded-md p-3.5 space-y-1">
                      <div className="text-[11px] font-medium text-slate-500">Receiving Notes</div>
                      <div className="text-slate-800 whitespace-pre-wrap">
                        {confirmationValidation.normalized.notes}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setStep('entry');
                }}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Edit</span>
              </button>

              <button
                type="button"
                onClick={() => void handleConfirmSubmit()}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{submitting ? 'Recording Receipt...' : 'Confirm & Record Delivery'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

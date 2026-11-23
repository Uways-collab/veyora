import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { generateIdempotencyKey } from '../sales/salesFormatters';
import {
  createPurchaseDraft,
  formatPurchaseMoney,
  roundFourDecimals,
  updatePurchaseDraft,
  validatePurchaseDraftInput,
} from './purchasesService';
import type {
  PurchaseCatalogVariant,
  PurchaseDraftFormInput,
  PurchaseDraftLineInput,
  PurchaseRecord,
} from './purchasesTypes';
import { formatPaymentTermsLabel } from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';

interface PurchaseFormModalProps {
  open: boolean;
  organisationId: string;
  currencyCode: string;
  timeZone?: string | null;
  purchase: PurchaseRecord | null;
  activeSuppliers: SupplierRecord[];
  catalogVariants: PurchaseCatalogVariant[];
  onClose: () => void;
  onSuccess: (message: string, savedPurchaseId: string | null) => Promise<void> | void;
  onNavigateSuppliers?: () => void;
}

function createEmptyLine(index: number): PurchaseDraftLineInput {
  return {
    rowKey: `line-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    variantId: '',
    orderedQuantity: '1',
    unitCost: '0',
  };
}

function createEmptyForm(): PurchaseDraftFormInput {
  return {
    supplierId: '',
    expectedDeliveryDate: '',
    supplierInvoiceNumber: '',
    discountAmount: '0',
    taxAmount: '0',
    notes: '',
    items: [createEmptyLine(0)],
  };
}

export function PurchaseFormModal({
  open,
  organisationId,
  currencyCode,
  timeZone,
  purchase,
  activeSuppliers,
  catalogVariants,
  onClose,
  onSuccess,
  onNavigateSuppliers,
}: PurchaseFormModalProps) {
  const isEditing = Boolean(purchase);
  const [form, setForm] = useState<PurchaseDraftFormInput>(createEmptyForm);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitLockRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  const variantById = useMemo(
    () => new Map(catalogVariants.map((v) => [v.variantId, v])),
    [catalogVariants]
  );

  const activeSupplierIds = useMemo(
    () => new Set(activeSuppliers.map((s) => s.id)),
    [activeSuppliers]
  );

  const activeVariantIds = useMemo(
    () => new Set(catalogVariants.map((v) => v.variantId)),
    [catalogVariants]
  );

  const selectedSupplier = useMemo(
    () => activeSuppliers.find((s) => s.id === form.supplierId) ?? null,
    [activeSuppliers, form.supplierId]
  );

  const filteredCatalogVariants = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalogVariants;
    return catalogVariants.filter(
      (v) =>
        v.productName.toLowerCase().includes(q) ||
        v.variantName.toLowerCase().includes(q) ||
        v.sku.toLowerCase().includes(q)
    );
  }, [catalogVariants, catalogSearch]);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSubmitting(false);
    setCatalogSearch('');
    submitLockRef.current = false;
    idempotencyKeyRef.current = generateIdempotencyKey();

    if (purchase) {
      setForm({
        supplierId: purchase.supplierId,
        expectedDeliveryDate: purchase.expectedDeliveryDate
          ? purchase.expectedDeliveryDate.slice(0, 10)
          : '',
        supplierInvoiceNumber: purchase.supplierInvoiceNumber ?? '',
        discountAmount: String(roundFourDecimals(purchase.discountAmount)),
        taxAmount: String(roundFourDecimals(purchase.taxAmount)),
        notes: purchase.notes ?? '',
        items:
          purchase.items.length > 0
            ? purchase.items.map((item, idx) => ({
                rowKey: item.id || `edit-${idx}`,
                variantId: item.variantId,
                orderedQuantity: String(roundFourDecimals(item.orderedQuantity)),
                unitCost: String(roundFourDecimals(item.unitCost)),
              }))
            : [createEmptyLine(0)],
      });
    } else {
      setForm(createEmptyForm());
    }
  }, [open, purchase]);

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

  const totals = useMemo(() => {
    let subtotal = 0;
    const lineTotals = form.items.map((item) => {
      const qty = Number(item.orderedQuantity);
      const cost = Number(item.unitCost);
      const validQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
      const validCost = Number.isFinite(cost) && cost >= 0 ? cost : 0;
      const lineTotal = roundFourDecimals(validQty * validCost);
      subtotal = roundFourDecimals(subtotal + lineTotal);
      return lineTotal;
    });

    const parsedDiscount = Number(form.discountAmount || '0');
    const parsedTax = Number(form.taxAmount || '0');
    const safeDiscount =
      Number.isFinite(parsedDiscount) && parsedDiscount >= 0
        ? roundFourDecimals(parsedDiscount)
        : 0;
    const safeTax =
      Number.isFinite(parsedTax) && parsedTax >= 0 ? roundFourDecimals(parsedTax) : 0;
    const grandTotal = roundFourDecimals(subtotal - safeDiscount + safeTax);

    return { lineTotals, subtotal, safeDiscount, safeTax, grandTotal };
  }, [form.items, form.discountAmount, form.taxAmount]);

  if (!open) return null;

  const isLockedNonDraft = Boolean(purchase && purchase.status !== 'draft');
  const selectedVariantIdsInForm = new Set(
    form.items.map((row) => row.variantId).filter(Boolean)
  );

  const handleVariantChange = (rowIndex: number, nextVariantId: string) => {
    setFormError(null);
    const catalogItem = variantById.get(nextVariantId);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((row, idx) => {
        if (idx !== rowIndex) return row;
        const shouldAutofillCost =
          Boolean(catalogItem) &&
          (row.variantId !== nextVariantId || row.unitCost.trim() === '' || row.unitCost === '0');
        return {
          ...row,
          variantId: nextVariantId,
          unitCost:
            shouldAutofillCost && catalogItem
              ? String(roundFourDecimals(catalogItem.defaultCostPrice))
              : row.unitCost,
        };
      }),
    }));
  };

  const handleAddLine = () => {
    setFormError(null);
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyLine(prev.items.length)],
    }));
  };

  const handleRemoveLine = (rowIndex: number) => {
    setFormError(null);
    setForm((prev) => {
      if (prev.items.length <= 1) {
        return { ...prev, items: [createEmptyLine(0)] };
      }
      return {
        ...prev,
        items: prev.items.filter((_, idx) => idx !== rowIndex),
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;

    if (isLockedNonDraft) {
      setFormError('Only draft purchase orders can be edited.');
      return;
    }

    const validation = validatePurchaseDraftInput(form, {
      activeSupplierIds,
      activeVariantIds,
    });
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      if (purchase) {
        const res = await updatePurchaseDraft(organisationId, purchase.id, purchase.status, form, {
          activeSupplierIds,
          activeVariantIds,
          orderDate: purchase.orderDate,
          timeZone,
        });
        if (res.error) {
          setFormError(res.error);
          return;
        }
        await onSuccess(`Purchase draft ${purchase.purchaseNumber} updated.`, res.purchaseId);
      } else {
        const res = await createPurchaseDraft(organisationId, form, {
          activeSupplierIds,
          activeVariantIds,
          timeZone,
          idempotencyKey: idempotencyKeyRef.current,
        });
        if (res.error) {
          setFormError(res.error);
          return;
        }
        await onSuccess('Purchase draft saved.', res.purchaseId);
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const missingPrerequisites = activeSuppliers.length === 0 || catalogVariants.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-form-modal-title"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl overflow-hidden shadow-xl flex flex-col max-h-[94vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 id="purchase-form-modal-title" className="text-sm font-semibold text-slate-900">
              {isEditing
                ? `Edit Purchase Draft${purchase?.purchaseNumber ? ` · ${purchase.purchaseNumber}` : ''}`
                : 'New Purchase Draft'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Prepare supplier items and order costs. Inventory stock will not change until goods are physically received.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close purchase draft form"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 space-y-5 text-xs overflow-y-auto">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2 text-red-900"
            >
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="font-medium leading-relaxed">{formError}</span>
            </div>
          )}

          {isLockedNonDraft && (
            <div
              role="alert"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900"
            >
              This purchase order has already been confirmed or closed and can no longer be edited.
            </div>
          )}

          {missingPrerequisites && (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3.5 space-y-2 text-amber-900">
              <div className="font-semibold">Setup required before saving a draft</div>
              {activeSuppliers.length === 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>No active suppliers found in this organization.</span>
                  {onNavigateSuppliers && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigateSuppliers();
                      }}
                      className="px-2.5 py-1 rounded border border-amber-300 bg-white text-[11px] font-medium text-amber-900 hover:bg-amber-50 whitespace-nowrap"
                    >
                      Go to Suppliers
                    </button>
                  )}
                </div>
              )}
              {catalogVariants.length === 0 && (
                <div>No active product variants found in Inventory. Add an active product variant first.</div>
              )}
            </div>
          )}

          {/* Header Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="po-form-supplier" className="block font-medium text-slate-700 mb-1">
                Active Supplier <span className="text-red-600">*</span>
              </label>
              <select
                id="po-form-supplier"
                value={form.supplierId}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, supplierId: e.target.value }));
                }}
                disabled={submitting || isLockedNonDraft || activeSuppliers.length === 0}
                className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              >
                <option value="">Select active supplier...</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {selectedSupplier && (
                <p className="text-[11px] text-slate-500 mt-1">
                  Terms: {formatPaymentTermsLabel(selectedSupplier.paymentTermsDays)}
                  {selectedSupplier.contactPerson ? ` · ${selectedSupplier.contactPerson}` : ''}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="po-form-expected-delivery"
                className="block font-medium text-slate-700 mb-1"
              >
                Expected Delivery Date <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="po-form-expected-delivery"
                type="date"
                value={form.expectedDeliveryDate}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, expectedDeliveryDate: e.target.value }));
                }}
                disabled={submitting || isLockedNonDraft}
                className="w-full px-3 py-2 rounded-md border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="po-form-invoice" className="block font-medium text-slate-700 mb-1">
                Supplier Invoice # <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="po-form-invoice"
                type="text"
                maxLength={100}
                value={form.supplierInvoiceNumber}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, supplierInvoiceNumber: e.target.value }));
                }}
                disabled={submitting || isLockedNonDraft}
                placeholder="e.g. INV-2026-0412"
                className="w-full px-3 py-2 rounded-md border border-slate-300 font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* Line Items Builder */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">Purchase Items</h3>
                <p className="text-[11px] text-slate-500">
                  Select active products/variants from Inventory with ordered quantity and unit cost (up to 4 decimals).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-52">
                  <Search
                    className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Filter catalog SKUs..."
                    aria-label="Filter active product variants"
                    className="w-full pl-8 pr-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddLine}
                  disabled={submitting || isLockedNonDraft || catalogVariants.length === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Item</span>
                </button>
              </div>
            </div>

            {/* Desktop Items Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-500">
                    <th className="py-2 px-3 min-w-[240px]">Product / Variant</th>
                    <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                    <th className="py-2 px-3 whitespace-nowrap">UoM</th>
                    <th className="py-2 px-3 w-28 text-right whitespace-nowrap">Ordered Qty</th>
                    <th className="py-2 px-3 w-32 text-right whitespace-nowrap">Unit Cost</th>
                    <th className="py-2 px-3 w-32 text-right whitespace-nowrap">Line Total</th>
                    <th className="py-2 px-3 w-12 text-right whitespace-nowrap">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {form.items.map((row, idx) => {
                    const selectedVariant = row.variantId ? variantById.get(row.variantId) : undefined;
                    const availableOptions = filteredCatalogVariants.filter(
                      (v) => v.variantId === row.variantId || !selectedVariantIdsInForm.has(v.variantId)
                    );
                    if (
                      selectedVariant &&
                      !availableOptions.some((v) => v.variantId === selectedVariant.variantId)
                    ) {
                      availableOptions.unshift(selectedVariant);
                    }

                    return (
                      <tr key={row.rowKey} className="align-top">
                        <td className="py-2.5 px-3">
                          <select
                            aria-label={`Select product variant for item ${idx + 1}`}
                            value={row.variantId}
                            onChange={(e) => handleVariantChange(idx, e.target.value)}
                            disabled={submitting || isLockedNonDraft}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                          >
                            <option value="">Select active product / variant...</option>
                            {availableOptions.map((v) => (
                              <option key={v.variantId} value={v.variantId}>
                                {v.productName} — {v.variantName} ({v.sku})
                              </option>
                            ))}
                          </select>
                          {selectedVariant && (
                            <div className="text-[11px] text-slate-500 mt-1">
                              {selectedVariant.productName} · {selectedVariant.variantName}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                          {selectedVariant?.sku || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-600 whitespace-nowrap">
                          {selectedVariant?.unitOfMeasure || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.0001"
                            min="0.0001"
                            aria-label={`Ordered quantity for item ${idx + 1}`}
                            value={row.orderedQuantity}
                            onChange={(e) => {
                              setFormError(null);
                              const val = e.target.value;
                              setForm((prev) => ({
                                ...prev,
                                items: prev.items.map((r, rIdx) =>
                                  rIdx === idx ? { ...r, orderedQuantity: val } : r
                                ),
                              }));
                            }}
                            disabled={submitting || isLockedNonDraft}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 font-mono tabular-nums text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.0001"
                            min="0"
                            aria-label={`Unit cost for item ${idx + 1}`}
                            value={row.unitCost}
                            onChange={(e) => {
                              setFormError(null);
                              const val = e.target.value;
                              setForm((prev) => ({
                                ...prev,
                                items: prev.items.map((r, rIdx) =>
                                  rIdx === idx ? { ...r, unitCost: val } : r
                                ),
                              }));
                            }}
                            disabled={submitting || isLockedNonDraft}
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 font-mono tabular-nums text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-right font-medium text-slate-900 whitespace-nowrap">
                          {formatPurchaseMoney(totals.lineTotals[idx] ?? 0, currencyCode)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(idx)}
                            disabled={submitting || isLockedNonDraft || form.items.length <= 1}
                            aria-label={`Remove item ${idx + 1}`}
                            className="p-1.5 rounded text-slate-400 hover:text-red-700 hover:bg-red-50 disabled:opacity-35"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Item Cards */}
            <div className="md:hidden divide-y divide-slate-200">
              {form.items.map((row, idx) => {
                const selectedVariant = row.variantId ? variantById.get(row.variantId) : undefined;
                const availableOptions = filteredCatalogVariants.filter(
                  (v) => v.variantId === row.variantId || !selectedVariantIdsInForm.has(v.variantId)
                );
                if (
                  selectedVariant &&
                  !availableOptions.some((v) => v.variantId === selectedVariant.variantId)
                ) {
                  availableOptions.unshift(selectedVariant);
                }

                return (
                  <div key={row.rowKey} className="p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-700">Item #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        disabled={submitting || isLockedNonDraft || form.items.length <= 1}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-700 disabled:opacity-35"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Product / Variant
                      </label>
                      <select
                        value={row.variantId}
                        onChange={(e) => handleVariantChange(idx, e.target.value)}
                        disabled={submitting || isLockedNonDraft}
                        className="w-full px-2.5 py-2 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="">Select active product / variant...</option>
                        {availableOptions.map((v) => (
                          <option key={v.variantId} value={v.variantId}>
                            {v.productName} — {v.variantName} ({v.sku})
                          </option>
                        ))}
                      </select>
                      {selectedVariant && (
                        <div className="mt-1 text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                          <span className="font-mono">SKU: {selectedVariant.sku}</span>
                          <span>·</span>
                          <span>UoM: {selectedVariant.unitOfMeasure}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Ordered Qty
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.0001"
                          min="0.0001"
                          value={row.orderedQuantity}
                          onChange={(e) => {
                            setFormError(null);
                            const val = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((r, rIdx) =>
                                rIdx === idx ? { ...r, orderedQuantity: val } : r
                              ),
                            }));
                          }}
                          disabled={submitting || isLockedNonDraft}
                          className="w-full px-2.5 py-2 rounded-md border border-slate-300 font-mono tabular-nums text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Unit Cost
                        </label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.0001"
                          min="0"
                          value={row.unitCost}
                          onChange={(e) => {
                            setFormError(null);
                            const val = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              items: prev.items.map((r, rIdx) =>
                                rIdx === idx ? { ...r, unitCost: val } : r
                              ),
                            }));
                          }}
                          disabled={submitting || isLockedNonDraft}
                          className="w-full px-2.5 py-2 rounded-md border border-slate-300 font-mono tabular-nums text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px] border-t border-slate-100">
                      <span className="text-slate-500">Line Total</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {formatPurchaseMoney(totals.lineTotals[idx] ?? 0, currencyCode)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Notes + Financial Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-7">
              <label htmlFor="po-form-notes" className="block font-medium text-slate-700 mb-1">
                Order Notes <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="po-form-notes"
                rows={4}
                maxLength={1000}
                value={form.notes}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, notes: e.target.value }));
                }}
                disabled={submitting || isLockedNonDraft}
                placeholder="Delivery instructions, batch requirements, payment agreement notes..."
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {formatPurchaseMoney(totals.subtotal, currencyCode)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="po-form-discount" className="text-slate-600 whitespace-nowrap">
                  Discount Amount
                </label>
                <input
                  id="po-form-discount"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  value={form.discountAmount}
                  onChange={(e) => {
                    setFormError(null);
                    setForm((prev) => ({ ...prev, discountAmount: e.target.value }));
                  }}
                  disabled={submitting || isLockedNonDraft}
                  className="w-36 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white font-mono tabular-nums text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="po-form-tax" className="text-slate-600 whitespace-nowrap">
                  Tax Amount
                </label>
                <input
                  id="po-form-tax"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min="0"
                  value={form.taxAmount}
                  onChange={(e) => {
                    setFormError(null);
                    setForm((prev) => ({ ...prev, taxAmount: e.target.value }));
                  }}
                  disabled={submitting || isLockedNonDraft}
                  className="w-36 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white font-mono tabular-nums text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
                />
              </div>

              <div className="pt-2.5 border-t border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-900">Grand Total</span>
                <span className="font-mono tabular-nums text-base font-semibold text-slate-900">
                  {formatPurchaseMoney(totals.grandTotal, currencyCode)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-slate-500">
            Four-decimal precision · Currency: {currencyCode}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            {!isLockedNonDraft && (
              <button
                type="submit"
                disabled={submitting || missingPrerequisites}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                <span>
                  {submitting
                    ? isEditing
                      ? 'Saving Draft...'
                      : 'Creating Draft...'
                    : isEditing
                      ? 'Update Draft'
                      : 'Save Draft'}
                </span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

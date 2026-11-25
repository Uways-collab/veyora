import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  UNIT_OF_MEASURE_OPTIONS,
  calculateVariantProfit,
  createProductVariant,
  formatMoneyAmount,
  formatUnitOfMeasureLabel,
  setVariantActiveStatus,
  updateProductVariant,
  type InventoryProductRecord,
  type InventoryVariantRecord,
} from './inventoryService';

interface ProductVariantsPanelProps {
  organisationId: string;
  product: InventoryProductRecord;
  allProducts: InventoryProductRecord[];
  variants: InventoryVariantRecord[];
  currencyCode: string;
  canManage: boolean;
  loading: boolean;
  error: string | null;
  onSelectProduct: (productId: string) => void;
  onBackToProducts: () => void;
  onReload: () => Promise<void>;
}

type StatusFilter = 'all' | 'active' | 'archived';

interface AttributeDraftRow {
  id: string;
  key: string;
  value: string;
}

const PRESET_ATTRIBUTE_KEYS = ['size', 'colour', 'packaging'] as const;

function createAttributeDrafts(attributes: Record<string, string>): AttributeDraftRow[] {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return [];
  return entries.map(([key, value], index) => ({
    id: `attr-${index}-${key}`,
    key,
    value,
  }));
}

export function ProductVariantsPanel({
  organisationId,
  product,
  allProducts,
  variants,
  currencyCode,
  canManage,
  loading,
  error,
  onSelectProduct,
  onBackToProducts,
  onReload,
}: ProductVariantsPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<InventoryVariantRecord | null>(null);
  const [formVariantName, setFormVariantName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formUnit, setFormUnit] = useState('piece');
  const [formCostPrice, setFormCostPrice] = useState('0.00');
  const [formSellingPrice, setFormSellingPrice] = useState('0.00');
  const [formAttributes, setFormAttributes] = useState<AttributeDraftRow[]>([]);
  const [formIsActive, setFormIsActive] = useState(true);

  const submitLockRef = useRef(false);
  const attrCounterRef = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  const productVariants = useMemo(
    () => variants.filter((variant) => variant.productId === product.id),
    [variants, product.id]
  );

  const filteredVariants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return productVariants.filter((variant) => {
      if (statusFilter === 'active' && !variant.isActive) return false;
      if (statusFilter === 'archived' && variant.isActive) return false;

      if (q) {
        const attrText = Object.entries(variant.attributes)
          .map(([k, v]) => `${k} ${v}`)
          .join(' ');
        const haystack = [
          variant.variantName,
          variant.sku,
          variant.barcode ?? '',
          variant.unitOfMeasure,
          attrText,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [productVariants, searchQuery, statusFilter]);

  useEffect(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setFeedback(null);
    setModalOpen(false);
  }, [product.id]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setModalOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, submitting]);

  const nextAttrRowId = () => {
    attrCounterRef.current += 1;
    return `attr-draft-${attrCounterRef.current}`;
  };

  const openCreateModal = () => {
    if (!canManage) return;
    setEditingVariant(null);
    setFormVariantName('');
    setFormSku('');
    setFormBarcode('');
    setFormUnit('piece');
    setFormCostPrice('0.00');
    setFormSellingPrice('0.00');
    setFormAttributes([]);
    setFormIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (variant: InventoryVariantRecord) => {
    if (!canManage) return;
    setEditingVariant(variant);
    setFormVariantName(variant.variantName);
    setFormSku(variant.sku);
    setFormBarcode(variant.barcode ?? '');
    setFormUnit(variant.unitOfMeasure || 'piece');
    setFormCostPrice(variant.costPrice.toFixed(2));
    setFormSellingPrice(variant.sellingPrice.toFixed(2));
    setFormAttributes(createAttributeDrafts(variant.attributes));
    setFormIsActive(variant.isActive);
    setFormError(null);
    setModalOpen(true);
  };

  const addAttributeRow = (presetKey = '') => {
    const normalizedPreset = presetKey.trim().toLowerCase();
    if (
      normalizedPreset &&
      formAttributes.some((row) => row.key.trim().toLowerCase() === normalizedPreset)
    ) {
      return;
    }
    setFormAttributes((prev) => [
      ...prev,
      { id: nextAttrRowId(), key: presetKey, value: '' },
    ]);
  };

  const updateAttributeRow = (id: string, field: 'key' | 'value', nextValue: string) => {
    setFormAttributes((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: nextValue } : row))
    );
  };

  const removeAttributeRow = (id: string) => {
    setFormAttributes((prev) => prev.filter((row) => row.id !== id));
  };

  const parsedCostPrice = Number(formCostPrice);
  const parsedSellingPrice = Number(formSellingPrice);
  const liveProfit = calculateVariantProfit(
    Number.isFinite(parsedCostPrice) && parsedCostPrice >= 0 ? parsedCostPrice : 0,
    Number.isFinite(parsedSellingPrice) && parsedSellingPrice >= 0 ? parsedSellingPrice : 0
  );

  const unitOptions = useMemo(() => {
    const exists = UNIT_OF_MEASURE_OPTIONS.some(
      (opt) => opt.value === formUnit.trim().toLowerCase()
    );
    if (exists || !formUnit.trim()) {
      return UNIT_OF_MEASURE_OPTIONS;
    }
    return [
      ...UNIT_OF_MEASURE_OPTIONS,
      { value: formUnit.trim(), label: formatUnitOfMeasureLabel(formUnit) },
    ];
  }, [formUnit]);

  const handleSaveVariant = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || submitLockRef.current || submitting) return;

    setFormError(null);
    const trimmedName = formVariantName.trim();
    const trimmedSku = formSku.trim();
    const trimmedBarcode = formBarcode.trim();
    const trimmedUnit = formUnit.trim();

    if (!trimmedName) {
      setFormError('Variant name is required.');
      return;
    }
    if (!trimmedSku) {
      setFormError('SKU is required.');
      return;
    }
    if (!trimmedUnit) {
      setFormError('Unit of measure is required.');
      return;
    }

    const costValue = Number(formCostPrice);
    const sellingValue = Number(formSellingPrice);

    if (formCostPrice.trim() === '' || !Number.isFinite(costValue) || costValue < 0) {
      setFormError('Cost price must be 0 or greater.');
      return;
    }
    if (formSellingPrice.trim() === '' || !Number.isFinite(sellingValue) || sellingValue < 0) {
      setFormError('Selling price must be 0 or greater.');
      return;
    }

    const attributesMap: Record<string, string> = {};
    const seenKeys = new Set<string>();
    for (const row of formAttributes) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (!k && !v) continue;
      if (!k) {
        setFormError('Every attribute value must have an attribute key.');
        return;
      }
      if (!v) {
        setFormError(`Attribute "${k}" requires a value (or remove the row).`);
        return;
      }
      const lowerKey = k.toLowerCase();
      if (seenKeys.has(lowerKey)) {
        setFormError(`Duplicate attribute key "${k}". Each attribute key must be unique.`);
        return;
      }
      seenKeys.add(lowerKey);
      attributesMap[k] = v;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      if (editingVariant) {
        const { error: updateErr } = await updateProductVariant(
          organisationId,
          editingVariant.id,
          {
            variantName: trimmedName,
            sku: trimmedSku,
            barcode: trimmedBarcode || null,
            unitOfMeasure: trimmedUnit,
            costPrice: costValue,
            sellingPrice: sellingValue,
            attributes: attributesMap,
            isActive: formIsActive,
          }
        );
        if (updateErr) {
          setFormError(updateErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Variant "${trimmedName}" (${trimmedSku}) updated.`,
        });
      } else {
        const { error: createErr } = await createProductVariant(organisationId, {
          productId: product.id,
          variantName: trimmedName,
          sku: trimmedSku,
          barcode: trimmedBarcode || null,
          unitOfMeasure: trimmedUnit,
          costPrice: costValue,
          sellingPrice: sellingValue,
          attributes: attributesMap,
          isActive: true,
        });
        if (createErr) {
          setFormError(createErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Variant "${trimmedName}" (${trimmedSku}) created.`,
        });
      }

      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleToggleArchive = async (variant: InventoryVariantRecord) => {
    if (!canManage || archivingId) return;
    setFeedback(null);
    setArchivingId(variant.id);

    const nextActive = !variant.isActive;
    try {
      const { error: toggleErr } = await setVariantActiveStatus(
        organisationId,
        variant.id,
        nextActive
      );
      if (toggleErr) {
        setFeedback({ kind: 'error', text: toggleErr });
        return;
      }

      setFeedback({
        kind: 'success',
        text: nextActive
          ? `Variant "${variant.variantName}" restored.`
          : `Variant "${variant.variantName}" archived.`,
      });
      await onReload();
    } finally {
      setArchivingId(null);
    }
  };

  const activeVariantCount = productVariants.filter((v) => v.isActive).length;
  const isPhysicalProduct = product.productTypeValue === 'physical';

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="bg-slate-100/80 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700">
          Read-only access: your current workspace role can view product variants, while only Owners, Admins, and Managers can create, edit, archive, or restore variants.
        </div>
      )}

      {/* Selected Product Context Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={onBackToProducts}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 self-start"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Products</span>
          </button>

          <div className="flex items-center gap-2">
            <label htmlFor="variant-product-switcher" className="text-xs text-slate-500 whitespace-nowrap">
              Switch product:
            </label>
            <select
              id="variant-product-switcher"
              value={product.id}
              onChange={(e) => onSelectProduct(e.target.value)}
              className="h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 max-w-xs"
            >
              {allProducts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.productType})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-3 border-t border-slate-200">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-base font-semibold text-slate-900 truncate">
                {product.name}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  product.isActive ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    product.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                  }`}
                />
                <span>{product.isActive ? 'Active Product' : 'Archived Product'}</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>
                Type:{' '}
                <strong className="font-medium text-slate-800">
                  {product.productType}
                </strong>{' '}
                ({isPhysicalProduct ? 'stock-tracked variants' : 'no stock balance tracking'})
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                Category: <strong className="font-medium text-slate-800">{product.categoryPath}</strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>
                Variants:{' '}
                <span className="font-mono text-slate-800">
                  {activeVariantCount} active / {productVariants.length} total
                </span>
              </span>
            </div>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 self-start lg:self-auto"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Variant</span>
            </button>
          )}
        </div>
      </section>

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
            {feedback.kind === 'success' && (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
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

      {/* Variants Table Card */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Product Variants
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pricing, SKUs, units, and attributes in <span className="font-mono">public.product_variants</span>. Gross profit and margin are calculated in real time.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="variants-search" className="sr-only">
                Search variants
              </label>
              <input
                id="variants-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, SKU, barcode, attributes..."
                className="w-full sm:w-64 h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
            <BarcodeCameraScanner onDetected={(value) => setSearchQuery(value)} />

            <div>
              <label htmlFor="variants-status-filter" className="sr-only">
                Filter variants by status
              </label>
              <select
                id="variants-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full sm:w-auto h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All statuses ({productVariants.length})</option>
                <option value="active">Active only ({activeVariantCount})</option>
                <option value="archived">
                  Archived ({productVariants.length - activeVariantCount})
                </option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-red-700 bg-red-50/50">
            Error loading product variants: {error}
          </div>
        ) : filteredVariants.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
              <Layers className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-xs font-semibold text-slate-900">
              {productVariants.length === 0
                ? 'No variants created for this product yet'
                : 'No matching variants'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {productVariants.length === 0
                ? isPhysicalProduct
                  ? 'Add sellable SKUs, packaging sizes, or unit configurations for this physical product.'
                  : 'Add service tiers, packages, or billing units for this service item.'
                : 'Adjust your search query or status filter to see matching variants.'}
            </p>
            {productVariants.length === 0 && canManage && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Variant</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Variant Name</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">SKU</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Barcode</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Unit</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Attributes</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Cost Price</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Selling Price</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Gross Profit / Margin</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  {canManage && (
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredVariants.map((variant) => {
                  const isBusy = archivingId === variant.id;
                  const profit = calculateVariantProfit(variant.costPrice, variant.sellingPrice);
                  const attributeEntries = Object.entries(variant.attributes);

                  return (
                    <tr key={variant.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900 min-w-[160px]">
                        {variant.variantName}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                        {variant.sku}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {variant.barcode ?? '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {formatUnitOfMeasureLabel(variant.unitOfMeasure)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 min-w-[140px]">
                        {attributeEntries.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {attributeEntries.map(([key, val]) => (
                              <span
                                key={key}
                                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700"
                              >
                                <span className="text-slate-500">{key}:</span>
                                <span className="font-medium">{val}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatMoneyAmount(variant.costPrice, currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                        {formatMoneyAmount(variant.sellingPrice, currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={
                            profit.grossProfit < 0
                              ? 'text-red-700 font-medium'
                              : 'text-emerald-700 font-medium'
                          }
                        >
                          {formatMoneyAmount(profit.grossProfit, currencyCode)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {profit.marginPercent === null
                            ? '—'
                            : `${profit.marginPercent.toFixed(1)}% margin`}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 font-medium ${
                            variant.isActive ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${
                              variant.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                            }`}
                          />
                          <span>{variant.isActive ? 'Active' : 'Archived'}</span>
                        </span>
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEditModal(variant)}
                              disabled={isBusy}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleArchive(variant)}
                              disabled={isBusy}
                              className={`inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50 ${
                                variant.isActive
                                  ? 'text-slate-600 hover:text-slate-900'
                                  : 'text-emerald-700 hover:text-emerald-800'
                              }`}
                            >
                              {isBusy ? (
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : variant.isActive ? (
                                <Archive className="h-3 w-3" aria-hidden="true" />
                              ) : (
                                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              )}
                              <span>{variant.isActive ? 'Archive' : 'Restore'}</span>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / Edit Variant Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="variant-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) setModalOpen(false);
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-xl max-h-[90vh] flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h3 id="variant-modal-title" className="text-sm font-semibold text-slate-900">
                  {editingVariant ? 'Edit Variant' : 'Add Product Variant'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Product: <span className="font-medium text-slate-700">{product.name}</span> · Saved to{' '}
                  <span className="font-mono">public.product_variants</span>
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                aria-label="Close variant dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveVariant(e)}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <fieldset disabled={submitting} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="variant-name" className="block text-xs font-medium text-slate-700">
                    Variant Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="variant-name"
                    type="text"
                    required
                    maxLength={160}
                    value={formVariantName}
                    onChange={(e) => setFormVariantName(e.target.value)}
                    placeholder="e.g. Standard 500ml Bottle or 12-Pack Carton"
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="variant-sku" className="block text-xs font-medium text-slate-700">
                      SKU <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="variant-sku"
                      type="text"
                      required
                      maxLength={80}
                      value={formSku}
                      onChange={(e) => setFormSku(e.target.value)}
                      placeholder="e.g. WBS-BLK-001"
                      className="w-full h-9 px-3 rounded-md border border-slate-300 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                    <p className="text-[11px] text-slate-500">
                      Must be unique within your organisation.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="variant-barcode" className="block text-xs font-medium text-slate-700">
                      Barcode (Optional)
                    </label>
                    <input
                      id="variant-barcode"
                      type="text"
                      maxLength={80}
                      value={formBarcode}
                      onChange={(e) => setFormBarcode(e.target.value)}
                      placeholder="Leave blank if none"
                      className="w-full h-9 px-3 rounded-md border border-slate-300 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                    <p className="text-[11px] text-slate-500">
                      Unique per organisation when provided.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="variant-unit" className="block text-xs font-medium text-slate-700">
                      Unit of Measure <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="variant-unit"
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    >
                      {unitOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="variant-cost" className="block text-xs font-medium text-slate-700">
                      Cost Price ({currencyCode}) <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="variant-cost"
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={formCostPrice}
                      onChange={(e) => setFormCostPrice(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-slate-300 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="variant-selling" className="block text-xs font-medium text-slate-700">
                      Selling Price ({currencyCode}) <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="variant-selling"
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={formSellingPrice}
                      onChange={(e) => setFormSellingPrice(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-slate-300 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>
                </div>

                {/* Live non-persisted margin preview */}
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">
                    Calculated Gross Profit (display only)
                  </span>
                  <div className="font-mono tabular-nums flex items-center gap-3">
                    <span
                      className={
                        liveProfit.grossProfit < 0
                          ? 'font-semibold text-red-700'
                          : 'font-semibold text-emerald-700'
                      }
                    >
                      {formatMoneyAmount(liveProfit.grossProfit, currencyCode)}
                    </span>
                    <span className="text-slate-500">
                      {liveProfit.marginPercent === null
                        ? 'Margin: —'
                        : `Margin: ${liveProfit.marginPercent.toFixed(1)}%`}
                    </span>
                  </div>
                </div>

                {/* Flexible JSONB Attributes Editor */}
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">
                      Variant Attributes (Optional JSONB)
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {PRESET_ATTRIBUTE_KEYS.map((preset) => {
                        const alreadyAdded = formAttributes.some(
                          (row) => row.key.trim().toLowerCase() === preset
                        );
                        return (
                          <button
                            key={preset}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => addAttributeRow(preset)}
                            className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            + {preset}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => addAttributeRow('')}
                        className="px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                      >
                        + Custom
                      </button>
                    </div>
                  </div>

                  {formAttributes.length === 0 ? (
                    <p className="text-[11px] text-slate-500 rounded-md border border-dashed border-slate-200 px-3 py-2">
                      No attributes added. Use presets above (size, colour, packaging) or add custom key-value attributes.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {formAttributes.map((row) => (
                        <div key={row.id} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-5">
                            <input
                              type="text"
                              value={row.key}
                              onChange={(e) => updateAttributeRow(row.id, 'key', e.target.value)}
                              placeholder="Key (e.g. size)"
                              aria-label="Attribute key"
                              className="w-full h-8 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                            />
                          </div>
                          <div className="col-span-6">
                            <input
                              type="text"
                              value={row.value}
                              onChange={(e) => updateAttributeRow(row.id, 'value', e.target.value)}
                              placeholder="Value (e.g. Large)"
                              aria-label="Attribute value"
                              className="w-full h-8 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                            />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeAttributeRow(row.id)}
                              aria-label="Remove attribute"
                              className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {editingVariant && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 pt-1">
                    <input
                      type="checkbox"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span>Variant is active</span>
                  </label>
                )}
              </fieldset>

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
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  aria-busy={submitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {submitting
                      ? editingVariant
                        ? 'Saving...'
                        : 'Creating...'
                      : editingVariant
                        ? 'Save Changes'
                        : 'Create Variant'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

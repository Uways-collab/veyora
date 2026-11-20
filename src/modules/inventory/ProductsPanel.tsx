import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  CheckCircle2,
  Layers,
  Loader2,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { ProductVariantsPanel } from './ProductVariantsPanel';
import {
  PRODUCT_TYPE_OPTIONS,
  createProduct,
  setProductActiveStatus,
  updateProduct,
  type InventoryCategoryRecord,
  type InventoryProductRecord,
  type InventoryVariantRecord,
  type ProductTypeValue,
} from './inventoryService';

interface ProductsPanelProps {
  organisationId: string;
  products: InventoryProductRecord[];
  categories: InventoryCategoryRecord[];
  variants: InventoryVariantRecord[];
  variantsError: string | null;
  currencyCode: string;
  canManage: boolean;
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}

type StatusFilter = 'all' | 'active' | 'archived';
type TypeFilter = 'all' | ProductTypeValue;

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function buildCategorySelectOptions(
  categories: InventoryCategoryRecord[]
): { id: string; label: string }[] {
  const byParent = new Map<string | null, InventoryCategoryRecord[]>();
  const idSet = new Set(categories.map((c) => c.id));

  for (const cat of categories) {
    const parentKey = cat.parentId && idSet.has(cat.parentId) ? cat.parentId : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(cat);
    byParent.set(parentKey, list);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const result: { id: string; label: string }[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, prefix: string) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const label = prefix ? `${prefix} / ${child.name}` : child.name;
      result.push({ id: child.id, label });
      walk(child.id, label);
    }
  };

  walk(null, '');
  return result;
}

export function ProductsPanel({
  organisationId,
  products,
  categories,
  variants,
  variantsError,
  currencyCode,
  canManage,
  loading,
  error,
  onReload,
}: ProductsPanelProps) {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<InventoryProductRecord | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<ProductTypeValue>('physical');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  const categoryOptions = useMemo(
    () => buildCategorySelectOptions(categories),
    [categories]
  );

  const variantCountByProduct = useMemo(() => {
    const map = new Map<string, { total: number; active: number }>();
    for (const variant of variants) {
      const current = map.get(variant.productId) ?? { total: 0, active: 0 };
      current.total += 1;
      if (variant.isActive) current.active += 1;
      map.set(variant.productId, current);
    }
    return map;
  }, [variants]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  useEffect(() => {
    setSelectedProductId(null);
  }, [organisationId]);

  useEffect(() => {
    if (selectedProductId && !loading && !products.some((p) => p.id === selectedProductId)) {
      setSelectedProductId(null);
    }
  }, [selectedProductId, loading, products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((product) => {
      if (typeFilter !== 'all' && product.productTypeValue !== typeFilter) {
        return false;
      }
      if (categoryFilter === 'uncategorized' && product.categoryId !== null) {
        return false;
      }
      if (
        categoryFilter !== 'all' &&
        categoryFilter !== 'uncategorized' &&
        product.categoryId !== categoryFilter
      ) {
        return false;
      }
      if (statusFilter === 'active' && !product.isActive) {
        return false;
      }
      if (statusFilter === 'archived' && product.isActive) {
        return false;
      }
      if (q) {
        const haystack = [
          product.name,
          product.description ?? '',
          product.categoryPath,
          product.productType,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [products, searchQuery, typeFilter, categoryFilter, statusFilter]);

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

  const openCreateModal = () => {
    if (!canManage) return;
    setEditingProduct(null);
    setFormName('');
    setFormType('physical');
    setFormCategoryId('');
    setFormDescription('');
    setFormImageUrl('');
    setFormIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (product: InventoryProductRecord) => {
    if (!canManage) return;
    setEditingProduct(product);
    setFormName(product.name);
    setFormType(product.productTypeValue);
    setFormCategoryId(product.categoryId ?? '');
    setFormDescription(product.description ?? '');
    setFormImageUrl(product.imageUrl ?? '');
    setFormIsActive(product.isActive);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || submitLockRef.current || submitting) return;

    setFormError(null);
    const trimmedName = formName.trim();
    if (trimmedName.length < 2) {
      setFormError('Product name must be at least 2 characters.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const payload = {
        name: trimmedName,
        productType: formType,
        categoryId: formCategoryId || null,
        description: formDescription.trim() || null,
        imageUrl: formImageUrl.trim() || null,
        isActive: formIsActive,
      };

      if (editingProduct) {
        const { error: updateErr } = await updateProduct(
          organisationId,
          editingProduct.id,
          payload
        );
        if (updateErr) {
          setFormError(updateErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Product "${trimmedName}" updated.`,
        });
      } else {
        const { error: createErr } = await createProduct(organisationId, {
          ...payload,
          isActive: true,
        });
        if (createErr) {
          setFormError(createErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Product "${trimmedName}" created.`,
        });
      }

      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleToggleArchive = async (product: InventoryProductRecord) => {
    if (!canManage || archivingId) return;
    setFeedback(null);
    setArchivingId(product.id);

    const nextActive = !product.isActive;
    try {
      const { error: toggleErr } = await setProductActiveStatus(
        organisationId,
        product.id,
        nextActive
      );
      if (toggleErr) {
        setFeedback({ kind: 'error', text: toggleErr });
        return;
      }

      setFeedback({
        kind: 'success',
        text: nextActive
          ? `Product "${product.name}" restored to active catalog.`
          : `Product "${product.name}" archived.`,
      });
      await onReload();
    } finally {
      setArchivingId(null);
    }
  };

  if (selectedProduct) {
    return (
      <ProductVariantsPanel
        organisationId={organisationId}
        product={selectedProduct}
        allProducts={products}
        variants={variants}
        currencyCode={currencyCode}
        canManage={canManage}
        loading={loading}
        error={variantsError}
        onSelectProduct={(nextId) => setSelectedProductId(nextId)}
        onBackToProducts={() => setSelectedProductId(null)}
        onReload={onReload}
      />
    );
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="bg-slate-100/80 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700">
          Read-only access: your current workspace role can view products, while only Owners, Admins, and Managers can create, edit, or archive products.
        </div>
      )}

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

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Product Catalog
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Physical products and services in <span className="font-mono">public.products</span>. Archived records are retained with <span className="font-mono">is_active = false</span>.
              </p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Product</span>
              </button>
            )}
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="products-search" className="sr-only">
                Search products
              </label>
              <input
                id="products-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products or categories..."
                className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="products-type-filter" className="sr-only">
                Filter by product type
              </label>
              <select
                id="products-type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All product types</option>
                {PRODUCT_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="products-category-filter" className="sr-only">
                Filter by category
              </label>
              <select
                id="products-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {categoryOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="products-status-filter" className="sr-only">
                Filter by active status
              </label>
              <select
                id="products-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All statuses ({products.length})</option>
                <option value="active">
                  Active only ({products.filter((p) => p.isActive).length})
                </option>
                <option value="archived">
                  Archived ({products.filter((p) => !p.isActive).length})
                </option>
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
            Error loading products: {error}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="text-xs font-semibold text-slate-900">
              {products.length === 0 ? 'No products created yet' : 'No matching products'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {products.length === 0
                ? 'Create your first physical product or service to populate the organisation catalog.'
                : 'Adjust your search term or active filters to view matching products.'}
            </p>
            {products.length === 0 && canManage && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Product</span>
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
                  <th className="py-2.5 px-4 whitespace-nowrap">Type</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Variants</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Updated</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredProducts.map((product) => {
                  const isBusy = archivingId === product.id;
                  const counts = variantCountByProduct.get(product.id) ?? { total: 0, active: 0 };
                  return (
                    <tr key={product.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 min-w-[220px]">
                        <div className="flex items-center gap-3">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              className="h-8 w-8 rounded border border-slate-200 object-cover shrink-0 bg-slate-50"
                            />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400 shrink-0">
                              <Package className="h-4 w-4" aria-hidden="true" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setSelectedProductId(product.id)}
                              className="font-medium text-slate-900 hover:text-blue-700 truncate max-w-xs text-left block"
                            >
                              {product.name}
                            </button>
                            {product.description && (
                              <div className="text-[11px] text-slate-500 truncate max-w-xs">
                                {product.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {product.productType}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {product.categoryPath}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {counts.total === 0 ? (
                          <span className="text-slate-400">0</span>
                        ) : (
                          <span>
                            {counts.active} active / {counts.total}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 font-medium ${
                            product.isActive ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${
                              product.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                            }`}
                          />
                          <span>{product.isActive ? 'Active' : 'Archived'}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                        {formatShortDate(product.updatedAt)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedProductId(product.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-blue-700"
                          >
                            <Layers className="h-3 w-3" aria-hidden="true" />
                            <span>Variants</span>
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(product)}
                                disabled={isBusy}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
                              >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleToggleArchive(product)}
                                disabled={isBusy}
                                className={`inline-flex items-center gap-1 text-xs font-medium disabled:opacity-50 ${
                                  product.isActive
                                    ? 'text-slate-600 hover:text-slate-900'
                                    : 'text-emerald-700 hover:text-emerald-800'
                                }`}
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                ) : product.isActive ? (
                                  <Archive className="h-3 w-3" aria-hidden="true" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                )}
                                <span>{product.isActive ? 'Archive' : 'Restore'}</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / Edit Product Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) setModalOpen(false);
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 id="product-modal-title" className="text-sm font-semibold text-slate-900">
                  {editingProduct ? 'Edit Product' : 'Create Product'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Saved directly to <span className="font-mono">public.products</span> for this organisation.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                aria-label="Close product dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveProduct(e)} className="p-6 space-y-4">
              <fieldset disabled={submitting} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="product-name" className="block text-xs font-medium text-slate-700">
                    Product Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="product-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={160}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Wireless Barcode Scanner"
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="product-type" className="block text-xs font-medium text-slate-700">
                      Product Type <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="product-type"
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as ProductTypeValue)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    >
                      {PRODUCT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="product-category" className="block text-xs font-medium text-slate-700">
                      Category
                    </label>
                    <select
                      id="product-category"
                      value={formCategoryId}
                      onChange={(e) => setFormCategoryId(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    >
                      <option value="">Uncategorized</option>
                      {categoryOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="product-description" className="block text-xs font-medium text-slate-700">
                    Description
                  </label>
                  <textarea
                    id="product-description"
                    rows={3}
                    maxLength={1000}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Optional product specification or service scope"
                    className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="product-image-url" className="block text-xs font-medium text-slate-700">
                    Image URL (Optional)
                  </label>
                  <input
                    id="product-image-url"
                    type="url"
                    value={formImageUrl}
                    onChange={(e) => setFormImageUrl(e.target.value)}
                    placeholder="https://example.com/product-image.png"
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                {editingProduct && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 pt-1">
                    <input
                      type="checkbox"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span>Product is active in catalog</span>
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
                      ? editingProduct
                        ? 'Saving...'
                        : 'Creating...'
                      : editingProduct
                        ? 'Save Changes'
                        : 'Create Product'}
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

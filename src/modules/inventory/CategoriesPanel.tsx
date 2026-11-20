import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CornerDownRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  createProductCategory,
  updateProductCategory,
  type InventoryCategoryRecord,
  type InventoryProductRecord,
} from './inventoryService';

interface CategoriesPanelProps {
  organisationId: string;
  categories: InventoryCategoryRecord[];
  products: InventoryProductRecord[];
  canManage: boolean;
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}

interface OrderedCategoryRow {
  category: InventoryCategoryRecord;
  depth: number;
}

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

function buildHierarchyOrder(categories: InventoryCategoryRecord[]): OrderedCategoryRow[] {
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

  const ordered: OrderedCategoryRow[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      ordered.push({ category: child, depth });
      walk(child.id, depth + 1);
    }
  };

  walk(null, 0);
  return ordered;
}

function collectDescendantIds(
  rootId: string,
  categories: InventoryCategoryRecord[]
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const cat of categories) {
    if (!cat.parentId) continue;
    const list = childrenByParent.get(cat.parentId) ?? [];
    list.push(cat.id);
    childrenByParent.set(cat.parentId, list);
  }

  const blocked = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (!blocked.has(childId)) {
        blocked.add(childId);
        queue.push(childId);
      }
    }
  }
  return blocked;
}

export function CategoriesPanel({
  organisationId,
  categories,
  products,
  canManage,
  loading,
  error,
  onReload,
}: CategoriesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InventoryCategoryRecord | null>(null);
  const [formName, setFormName] = useState('');
  const [formParentId, setFormParentId] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  const productCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      if (!product.categoryId) continue;
      counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [products]);

  const orderedCategories = useMemo(
    () => buildHierarchyOrder(categories),
    [categories]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orderedCategories;
    return orderedCategories.filter(({ category }) => {
      const haystack = [
        category.name,
        category.parentName ?? '',
        category.description ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [orderedCategories, searchQuery]);

  const eligibleParents = useMemo(() => {
    if (!editingCategory) return orderedCategories;
    const blocked = collectDescendantIds(editingCategory.id, categories);
    return orderedCategories.filter(({ category }) => !blocked.has(category.id));
  }, [editingCategory, orderedCategories, categories]);

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
    setEditingCategory(null);
    setFormName('');
    setFormParentId('');
    setFormDescription('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (category: InventoryCategoryRecord) => {
    if (!canManage) return;
    setEditingCategory(category);
    setFormName(category.name);
    setFormParentId(category.parentId ?? '');
    setFormDescription(category.description ?? '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || submitLockRef.current || submitting) return;

    setFormError(null);
    const trimmedName = formName.trim();
    if (trimmedName.length < 2) {
      setFormError('Category name must be at least 2 characters.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const payload = {
        name: trimmedName,
        parentId: formParentId || null,
        description: formDescription.trim() || null,
      };

      if (editingCategory) {
        const { error: updateErr } = await updateProductCategory(
          organisationId,
          editingCategory.id,
          payload
        );
        if (updateErr) {
          setFormError(updateErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Category "${trimmedName}" updated.`,
        });
      } else {
        const { error: createErr } = await createProductCategory(organisationId, payload);
        if (createErr) {
          setFormError(createErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Category "${trimmedName}" created.`,
        });
      }

      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="bg-slate-100/80 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700">
          Read-only access: your current workspace role can view product categories, while only Owners, Admins, and Managers can create or edit categories.
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
                Product Categories &amp; Subcategories
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Organize products into parent categories and nested subcategories in <span className="font-mono">public.product_categories</span>.
              </p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Category</span>
              </button>
            )}
          </div>

          <div className="max-w-sm relative">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="categories-search" className="sr-only">
              Search categories
            </label>
            <input
              id="categories-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search categories or parent names..."
              className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
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
            Error loading categories: {error}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="text-xs font-semibold text-slate-900">
              {categories.length === 0 ? 'No categories created yet' : 'No matching categories'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {categories.length === 0
                ? 'Create parent categories and subcategories to group your physical products and services.'
                : 'Adjust your search term to find matching categories.'}
            </p>
            {categories.length === 0 && canManage && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Category</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Hierarchy</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Description</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Products</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Created</th>
                  {canManage && (
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredRows.map(({ category, depth }) => {
                  const linkedCount = productCountByCategory.get(category.id) ?? 0;
                  return (
                    <tr key={category.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        <div
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${Math.min(depth, 4) * 16}px` }}
                        >
                          {depth > 0 ? (
                            <CornerDownRight
                              className="h-3.5 w-3.5 text-slate-400 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <FolderTree
                              className="h-3.5 w-3.5 text-slate-400 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span>{category.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {category.parentName
                          ? `Subcategory of ${category.parentName}`
                          : 'Parent category'}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                        {category.description || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                        {linkedCount}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                        {formatShortDate(category.createdAt)}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEditModal(category)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
                          >
                            <Pencil className="h-3 w-3" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
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

      {/* Create / Edit Category Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) setModalOpen(false);
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 id="category-modal-title" className="text-sm font-semibold text-slate-900">
                  {editingCategory ? 'Edit Category' : 'Create Category'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Saved to <span className="font-mono">public.product_categories</span>.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                aria-label="Close category dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveCategory(e)} className="p-6 space-y-4">
              <fieldset disabled={submitting} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="category-name" className="block text-xs font-medium text-slate-700">
                    Category Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="category-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Beverages"
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="category-parent" className="block text-xs font-medium text-slate-700">
                    Parent Category
                  </label>
                  <select
                    id="category-parent"
                    value={formParentId}
                    onChange={(e) => setFormParentId(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  >
                    <option value="">None (Top-level parent category)</option>
                    {eligibleParents.map(({ category, depth }) => (
                      <option key={category.id} value={category.id}>
                        {`${'— '.repeat(depth)}${category.name}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="category-description"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Description
                  </label>
                  <textarea
                    id="category-description"
                    rows={3}
                    maxLength={600}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Optional category notes"
                    className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>
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
                      ? editingCategory
                        ? 'Saving...'
                        : 'Creating...'
                      : editingCategory
                        ? 'Save Changes'
                        : 'Create Category'}
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

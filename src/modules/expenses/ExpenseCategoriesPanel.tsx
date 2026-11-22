import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Edit3,
  FolderKanban,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatExpenseDateTime } from './expensesFormatters';
import {
  archiveExpenseCategory,
  createExpenseCategory,
  updateExpenseCategory,
} from './expensesService';
import type { ExpenseCategoryRecord } from './expensesTypes';

type CategoryStatusFilter = 'active' | 'archived' | 'all';

interface ExpenseCategoriesPanelProps {
  organisationId: string;
  timeZone?: string | null;
  categories: ExpenseCategoryRecord[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  canManage: boolean;
  onRefresh: () => void;
  onCategoriesChanged: (message: string) => Promise<void> | void;
}

export function ExpenseCategoriesPanel({
  organisationId,
  timeZone,
  categories,
  loading,
  refreshing,
  error,
  canManage,
  onRefresh,
  onCategoriesChanged,
}: ExpenseCategoriesPanelProps) {
  const [statusFilter, setStatusFilter] = useState<CategoryStatusFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');

  // Create / Edit modal state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategoryRecord | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Archive confirmation modal state
  const [archivingCategory, setArchivingCategory] = useState<ExpenseCategoryRecord | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const isInitialLoading = loading && !refreshing;

  const activeCategoriesCount = useMemo(
    () => categories.filter((c) => c.isActive).length,
    [categories]
  );
  const archivedCategoriesCount = categories.length - activeCategoriesCount;

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return categories.filter((cat) => {
      if (statusFilter === 'active' && !cat.isActive) return false;
      if (statusFilter === 'archived' && cat.isActive) return false;
      if (!q) return true;
      return (
        cat.name.toLowerCase().includes(q) ||
        (cat.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [categories, statusFilter, searchQuery]);

  // Close dialogs cleanly on Escape when not submitting
  useEffect(() => {
    if (!formModalOpen && !archivingCategory) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formModalOpen && !formSubmitting) {
        setFormModalOpen(false);
      } else if (archivingCategory && !archiveSubmitting) {
        setArchivingCategory(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [formModalOpen, formSubmitting, archivingCategory, archiveSubmitting]);

  const openCreateModal = () => {
    if (!canManage) return;
    setEditingCategory(null);
    setNameInput('');
    setDescriptionInput('');
    setFormError(null);
    setFormSubmitting(false);
    submitLockRef.current = false;
    setFormModalOpen(true);
  };

  const openEditModal = (cat: ExpenseCategoryRecord) => {
    if (!canManage) return;
    setEditingCategory(cat);
    setNameInput(cat.name);
    setDescriptionInput(cat.description ?? '');
    setFormError(null);
    setFormSubmitting(false);
    submitLockRef.current = false;
    setFormModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || submitLockRef.current || formSubmitting) return;

    const cleanName = nameInput.trim();
    if (!cleanName) {
      setFormError('Category name is required.');
      return;
    }
    if (cleanName.length > 100) {
      setFormError('Category name must be 100 characters or fewer.');
      return;
    }

    const cleanDescription = descriptionInput.trim() || null;
    if (cleanDescription && cleanDescription.length > 500) {
      setFormError('Description must be 500 characters or fewer.');
      return;
    }

    submitLockRef.current = true;
    setFormSubmitting(true);
    setFormError(null);

    try {
      if (editingCategory) {
        const res = await updateExpenseCategory(organisationId, {
          categoryId: editingCategory.id,
          name: cleanName,
          description: cleanDescription,
        });
        if (res.error || !res.category) {
          setFormError(res.error ?? 'Unable to update expense category.');
          return;
        }
        setFormModalOpen(false);
        await onCategoriesChanged(`Category "${res.category.name}" updated.`);
      } else {
        const res = await createExpenseCategory(organisationId, {
          name: cleanName,
          description: cleanDescription,
        });
        if (res.error || !res.category) {
          setFormError(res.error ?? 'Unable to create expense category.');
          return;
        }
        setFormModalOpen(false);
        await onCategoriesChanged(`Category "${res.category.name}" created.`);
      }
    } finally {
      submitLockRef.current = false;
      setFormSubmitting(false);
    }
  };

  const openArchiveDialog = (cat: ExpenseCategoryRecord) => {
    if (!canManage || !cat.isActive || activeCategoriesCount <= 1) return;
    setArchiveError(null);
    setArchiveSubmitting(false);
    submitLockRef.current = false;
    setArchivingCategory(cat);
  };

  const handleConfirmArchive = async () => {
    if (!canManage || !archivingCategory || submitLockRef.current || archiveSubmitting) return;

    submitLockRef.current = true;
    setArchiveSubmitting(true);
    setArchiveError(null);

    try {
      const targetName = archivingCategory.name;
      const res = await archiveExpenseCategory(organisationId, archivingCategory.id);
      if (res.error || !res.category) {
        setArchiveError(res.error ?? 'Unable to archive expense category.');
        return;
      }
      setArchivingCategory(null);
      await onCategoriesChanged(`Category "${targetName}" archived.`);
    } finally {
      submitLockRef.current = false;
      setArchiveSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {!canManage && (
        <div
          role="note"
          className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-2.5 text-xs text-slate-700"
        >
          <ShieldAlert className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Viewing categories in read-only mode. Only Owners, Admins, and Managers can create, edit, or archive expense categories.
          </span>
        </div>
      )}

      <section
        aria-labelledby="expense-categories-heading"
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 id="expense-categories-heading" className="text-sm font-semibold text-slate-900">
              Expense Categories
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Organize business spend cleanly. Categories are archived rather than deleted to preserve historical reports.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
              >
                <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Category</span>
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div
            role="group"
            aria-label="Category status filter"
            className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-md w-fit"
          >
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'active'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active ({activeCategoriesCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('archived')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'archived'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Archived ({archivedCategoriesCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({categories.length})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search category name or description..."
              aria-label="Search expense categories"
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear category search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* States & Table */}
        {isInitialLoading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 bg-red-50/60 text-xs text-red-900 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold">Unable to load expense categories</div>
                <div className="break-words text-red-800">{error}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="px-3 py-1.5 rounded-md border border-red-300 bg-white text-xs font-medium text-red-800 hover:bg-red-50 whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <FolderKanban className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">
              {searchQuery.trim()
                ? 'No categories match your search'
                : statusFilter === 'archived'
                  ? 'No archived expense categories'
                  : 'No active expense categories'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {searchQuery.trim()
                ? 'Try a different keyword or switch the status filter.'
                : statusFilter === 'archived'
                  ? 'Archived categories will appear here while remaining attached to historical expense records.'
                  : canManage
                    ? 'Create an expense category so team members can classify new expenses.'
                    : 'Ask an Owner, Admin, or Manager to configure expense categories.'}
            </p>
            {canManage && statusFilter !== 'archived' && !searchQuery.trim() && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
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
                  <th className="py-2.5 px-4 whitespace-nowrap">Category Name</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Description</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Last Updated</th>
                  {canManage && (
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredCategories.map((cat) => {
                  const archiveBlockedByLastActive = cat.isActive && activeCategoriesCount <= 1;
                  return (
                    <tr
                      key={cat.id}
                      className={`hover:bg-slate-50/60 transition-colors ${
                        cat.isActive ? '' : 'bg-slate-50/40 text-slate-500'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{cat.name}</div>
                        {cat.isSystem && (
                          <div className="text-[11px] text-slate-500">System default</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-md">
                        {cat.description || '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            cat.isActive ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {cat.isActive ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {formatExpenseDateTime(cat.updatedAt, timeZone)}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(cat)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Edit3 className="h-3 w-3" aria-hidden="true" />
                              <span>Edit</span>
                            </button>
                            {cat.isActive && (
                              <button
                                type="button"
                                onClick={() => openArchiveDialog(cat)}
                                disabled={archiveBlockedByLastActive}
                                title={
                                  archiveBlockedByLastActive
                                    ? 'Cannot archive the only active expense category in this organization.'
                                    : `Archive ${cat.name}`
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                <Archive className="h-3 w-3" aria-hidden="true" />
                                <span>Archive</span>
                              </button>
                            )}
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

      {/* Create / Edit Category Modal */}
      {formModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-category-modal-title"
        >
          <form
            onSubmit={handleSaveCategory}
            className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3
                  id="expense-category-modal-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  {editingCategory ? 'Edit Expense Category' : 'Add Expense Category'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingCategory
                    ? 'Update category name or description. Existing expense snapshots stay intact.'
                    : 'Create a new category for classifying organization expenses.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                disabled={formSubmitting}
                aria-label="Close category form"
                className="p-1.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-md bg-red-50 border border-red-200 text-red-900 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="expense-category-name-input"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Category Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="expense-category-name-input"
                  type="text"
                  required
                  maxLength={100}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={formSubmitting}
                  placeholder="e.g., Utilities, Fuel & Transport, Packaging"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="expense-category-description-input"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Description <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="expense-category-description-input"
                  rows={3}
                  maxLength={500}
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  disabled={formSubmitting}
                  placeholder="Clarify what types of business expenses belong in this category..."
                  className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                disabled={formSubmitting}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={formSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                {formSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>
                  {formSubmitting
                    ? 'Saving...'
                    : editingCategory
                      ? 'Save Changes'
                      : 'Create Category'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Archive Category Confirmation Modal */}
      {archivingCategory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-category-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3
                id="archive-category-modal-title"
                className="text-sm font-semibold text-slate-900"
              >
                Archive Category
              </h3>
              <button
                type="button"
                onClick={() => setArchivingCategory(null)}
                disabled={archiveSubmitting}
                aria-label="Close archive confirmation"
                className="p-1.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-700">
              {archiveError && (
                <div
                  role="alert"
                  className="p-3 rounded-md bg-red-50 border border-red-200 text-red-900 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{archiveError}</span>
                </div>
              )}

              <p className="leading-relaxed">
                Archive <span className="font-semibold text-slate-900">{archivingCategory.name}</span>?
              </p>
              <p className="text-slate-500 leading-relaxed">
                Archived categories cannot be selected for new expenses, but existing expenses and financial breakdowns will continue to display them accurately.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchivingCategory(null)}
                disabled={archiveSubmitting}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={archiveSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {archiveSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>{archiveSubmitting ? 'Archiving...' : 'Archive Category'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  Loader2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { SupplierDetailModal } from './SupplierDetailModal';
import { SupplierFormModal } from './SupplierFormModal';
import {
  archiveSupplier,
  formatPaymentTermsLabel,
  restoreSupplier,
  searchSuppliers,
} from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';

export type SupplierDirectoryFilter = 'active' | 'archived' | 'all';

interface SuppliersPanelProps {
  organisationId: string | null;
  organisationName?: string | null;
  timeZone?: string | null;
  canManage: boolean;
  isAuthenticated: boolean;
  externalCreateSignal?: number;
  externalRefreshSignal?: number;
  onRefreshingChange?: (refreshing: boolean) => void;
}

export function SuppliersPanel({
  organisationId,
  organisationName,
  timeZone,
  canManage,
  isAuthenticated,
  externalCreateSignal = 0,
  externalRefreshSignal = 0,
  onRefreshingChange,
}: SuppliersPanelProps) {
  const [directoryTab, setDirectoryTab] = useState<SupplierDirectoryFilter>('active');
  const [loadedTab, setLoadedTab] = useState<SupplierDirectoryFilter>('active');
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  const [activeTotalCount, setActiveTotalCount] = useState(0);
  const [activeHitLimit, setActiveHitLimit] = useState(false);
  const [archivedTotalCount, setArchivedTotalCount] = useState(0);
  const [archivedHitLimit, setArchivedHitLimit] = useState(false);
  const [searchHitLimit, setSearchHitLimit] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Modals
  const [viewingSupplier, setViewingSupplier] = useState<SupplierRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [archivingSupplier, setArchivingSupplier] = useState<SupplierRecord | null>(null);
  const [archivingSubmitting, setArchivingSubmitting] = useState(false);
  const [restoringSupplier, setRestoringSupplier] = useState<SupplierRecord | null>(null);
  const [restoringSubmitting, setRestoringSubmitting] = useState(false);

  const requestSeqRef = useRef(0);
  const archiveLockRef = useRef(false);
  const restoreLockRef = useRef(false);
  const lastCreateSignalRef = useRef(externalCreateSignal);
  const lastRefreshSignalRef = useRef(externalRefreshSignal);

  useEffect(() => {
    onRefreshingChange?.(loading || refreshing);
  }, [loading, refreshing, onRefreshingChange]);

  const loadDirectory = useCallback(
    async (
      orgId: string,
      tab: SupplierDirectoryFilter,
      query: string,
      options?: { isManualRefresh?: boolean; refreshBothCounts?: boolean }
    ) => {
      const seq = ++requestSeqRef.current;
      if (options?.isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);

      try {
        const trimmed = query.trim();
        const isActiveParam = tab === 'all' ? null : tab === 'active';

        const primaryPromise = searchSuppliers(orgId, {
          search: trimmed,
          isActive: isActiveParam,
          limit: 100,
        });

        const shouldRefreshActiveTotal =
          Boolean(options?.refreshBothCounts) && (tab !== 'active' || trimmed.length > 0);
        const shouldRefreshArchivedTotal =
          Boolean(options?.refreshBothCounts) && (tab !== 'archived' || trimmed.length > 0);

        const [primaryRes, activeTotalRes, archivedTotalRes] = await Promise.all([
          primaryPromise,
          shouldRefreshActiveTotal
            ? searchSuppliers(orgId, { search: '', isActive: true, limit: 100 })
            : Promise.resolve(null),
          shouldRefreshArchivedTotal
            ? searchSuppliers(orgId, { search: '', isActive: false, limit: 100 })
            : Promise.resolve(null),
        ]);

        if (seq !== requestSeqRef.current) return;

        setLoadedTab(tab);
        setAppliedSearch(trimmed);

        if (primaryRes.error) {
          setLoadError(primaryRes.error);
          setSuppliers([]);
          setSearchHitLimit(false);
        } else {
          setSuppliers(primaryRes.suppliers);
          setSearchHitLimit(primaryRes.hitLimit);

          if (!trimmed) {
            if (tab === 'active') {
              setActiveTotalCount(primaryRes.suppliers.length);
              setActiveHitLimit(primaryRes.hitLimit);
            } else if (tab === 'archived') {
              setArchivedTotalCount(primaryRes.suppliers.length);
              setArchivedHitLimit(primaryRes.hitLimit);
            } else {
              const activeInAll = primaryRes.suppliers.filter((s) => s.isActive).length;
              const archivedInAll = primaryRes.suppliers.length - activeInAll;
              setActiveTotalCount(activeInAll);
              setArchivedTotalCount(archivedInAll);
            }
          }
        }

        if (activeTotalRes && !activeTotalRes.error) {
          setActiveTotalCount(activeTotalRes.suppliers.length);
          setActiveHitLimit(activeTotalRes.hitLimit);
        }

        if (archivedTotalRes && !archivedTotalRes.error) {
          setArchivedTotalCount(archivedTotalRes.suppliers.length);
          setArchivedHitLimit(archivedTotalRes.hitLimit);
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    []
  );

  // Reset state cleanly on workspace change and load active org suppliers
  useEffect(() => {
    requestSeqRef.current += 1;
    setDirectoryTab('active');
    setLoadedTab('active');
    setSuppliers([]);
    setActiveTotalCount(0);
    setActiveHitLimit(false);
    setArchivedTotalCount(0);
    setArchivedHitLimit(false);
    setSearchHitLimit(false);
    setSearchInput('');
    setAppliedSearch('');
    setLoadError(null);
    setFeedback(null);
    setViewingSupplier(null);
    setFormOpen(false);
    setEditingSupplier(null);
    setArchivingSupplier(null);
    setRestoringSupplier(null);

    if (isAuthenticated && organisationId) {
      void loadDirectory(organisationId, 'active', '', {
        isManualRefresh: false,
        refreshBothCounts: true,
      });
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, organisationId, loadDirectory]);

  // Debounced search or tab switch via purchases_v1_search_suppliers
  useEffect(() => {
    if (!isAuthenticated || !organisationId) return;
    const trimmed = searchInput.trim();
    if (trimmed === appliedSearch && directoryTab === loadedTab) return;

    if (directoryTab !== loadedTab) {
      void loadDirectory(organisationId, directoryTab, trimmed, { isManualRefresh: false });
      return;
    }

    const timer = window.setTimeout(() => {
      void loadDirectory(organisationId, directoryTab, trimmed, { isManualRefresh: false });
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    searchInput,
    appliedSearch,
    directoryTab,
    loadedTab,
    isAuthenticated,
    organisationId,
    loadDirectory,
  ]);

  // Respond to parent header "+ Add Supplier" & "Refresh" triggers
  useEffect(() => {
    if (externalCreateSignal !== lastCreateSignalRef.current) {
      lastCreateSignalRef.current = externalCreateSignal;
      if (canManage && organisationId) {
        setFeedback(null);
        setEditingSupplier(null);
        setFormOpen(true);
      }
    }
  }, [externalCreateSignal, canManage, organisationId]);

  useEffect(() => {
    if (externalRefreshSignal !== lastRefreshSignalRef.current) {
      lastRefreshSignalRef.current = externalRefreshSignal;
      if (organisationId) {
        setFeedback(null);
        void loadDirectory(organisationId, directoryTab, searchInput, {
          isManualRefresh: true,
          refreshBothCounts: true,
        });
      }
    }
  }, [externalRefreshSignal, organisationId, directoryTab, searchInput, loadDirectory]);

  // Escape closes archive / restore confirmation modals
  useEffect(() => {
    if (!archivingSupplier && !restoringSupplier) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (archivingSupplier && !archivingSubmitting) {
          setArchivingSupplier(null);
        }
        if (restoringSupplier && !restoringSubmitting) {
          setRestoringSupplier(null);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [archivingSupplier, archivingSubmitting, restoringSupplier, restoringSubmitting]);

  const handleManualRefresh = () => {
    if (!organisationId) return;
    setFeedback(null);
    void loadDirectory(organisationId, directoryTab, searchInput, {
      isManualRefresh: true,
      refreshBothCounts: true,
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!organisationId) return;
    void loadDirectory(organisationId, directoryTab, searchInput, { isManualRefresh: false });
  };

  const handleClearSearch = () => {
    setSearchInput('');
    if (organisationId) {
      void loadDirectory(organisationId, directoryTab, '', { isManualRefresh: false });
    }
  };

  const handleSwitchTab = (nextTab: SupplierDirectoryFilter) => {
    if (nextTab === directoryTab) return;
    setFeedback(null);
    setLoadError(null);
    setSuppliers([]);
    setSearchHitLimit(false);
    if (isAuthenticated && organisationId) {
      setLoading(true);
    }
    setDirectoryTab(nextTab);
  };

  const openCreateModal = () => {
    if (!canManage) return;
    setFeedback(null);
    setEditingSupplier(null);
    setFormOpen(true);
  };

  const openEditModal = (supplier: SupplierRecord) => {
    if (!canManage || !supplier.isActive) return;
    setFeedback(null);
    setEditingSupplier(supplier);
    setFormOpen(true);
  };

  const openArchiveModal = (supplier: SupplierRecord) => {
    if (!canManage || !supplier.isActive) return;
    setFeedback(null);
    setArchivingSupplier(supplier);
  };

  const openRestoreModal = (supplier: SupplierRecord) => {
    if (!canManage || supplier.isActive) return;
    setFeedback(null);
    setRestoringSupplier(supplier);
  };

  const handleFormSuccess = async (message: string) => {
    setFormOpen(false);
    setEditingSupplier(null);
    setFeedback({ type: 'success', message });
    if (organisationId) {
      await loadDirectory(organisationId, directoryTab, searchInput, {
        isManualRefresh: true,
        refreshBothCounts: true,
      });
    }
  };

  const handleConfirmArchive = async () => {
    if (!organisationId || !archivingSupplier || !canManage) return;
    if (archiveLockRef.current || archivingSubmitting) return;

    archiveLockRef.current = true;
    setArchivingSubmitting(true);
    setFeedback(null);

    const target = archivingSupplier;
    try {
      const result = await archiveSupplier(organisationId, target.id);
      if (result.error) {
        setArchivingSupplier(null);
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      setArchivingSupplier(null);
      if (viewingSupplier?.id === target.id) {
        setViewingSupplier(null);
      }
      setFeedback({
        type: 'success',
        message: `Supplier "${target.name}" archived.`,
      });
      await loadDirectory(organisationId, directoryTab, searchInput, {
        isManualRefresh: true,
        refreshBothCounts: true,
      });
    } finally {
      archiveLockRef.current = false;
      setArchivingSubmitting(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!organisationId || !restoringSupplier || !canManage) return;
    if (restoreLockRef.current || restoringSubmitting) return;

    restoreLockRef.current = true;
    setRestoringSubmitting(true);
    setFeedback(null);

    const target = restoringSupplier;
    try {
      const result = await restoreSupplier(organisationId, target.id);
      if (result.error) {
        setRestoringSupplier(null);
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      setRestoringSupplier(null);
      if (viewingSupplier?.id === target.id) {
        setViewingSupplier(null);
      }
      setFeedback({
        type: 'success',
        message: `Supplier "${target.name}" restored to Active Suppliers.`,
      });
      await loadDirectory(organisationId, directoryTab, searchInput, {
        isManualRefresh: true,
        refreshBothCounts: true,
      });
    } finally {
      restoreLockRef.current = false;
      setRestoringSubmitting(false);
    }
  };

  const directoryMetrics = useMemo(() => {
    let withEmailOrPhone = 0;
    let termsSum = 0;
    for (const s of suppliers) {
      if (s.email || s.phone) withEmailOrPhone += 1;
      termsSum += s.paymentTermsDays;
    }
    const avgTerms = suppliers.length > 0 ? Math.round(termsSum / suppliers.length) : 0;
    return { withEmailOrPhone, avgTerms };
  }, [suppliers]);

  const isInitialLoading = loading && !refreshing;
  const hasSearchFilter = appliedSearch.length > 0;
  const isArchivedTab = directoryTab === 'archived';
  const isAllTab = directoryTab === 'all';

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
      {feedback && (
        <section
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 flex items-start justify-between gap-3 text-xs ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span className="font-medium leading-relaxed">{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
            className="p-0.5 rounded text-slate-400 hover:text-slate-700 shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </section>
      )}

      {/* Load Error Banner */}
      {loadError && (
        <section
          role="alert"
          className="bg-amber-50/80 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="font-semibold">Unable to load suppliers</div>
              <div className="text-amber-800">{loadError}</div>
            </div>
          </div>
          {organisationId && (
            <button
              type="button"
              onClick={handleManualRefresh}
              className="px-3 py-1.5 rounded-md border border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-50 whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              Retry
            </button>
          )}
        </section>
      )}

      {/* Summary KPI Strip */}
      <section aria-labelledby="suppliers-summary-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="suppliers-summary-heading" className="text-sm font-semibold text-slate-900">
            Suppliers Summary
          </h2>
          {organisationName && (
            <span className="text-xs text-slate-500">
              Directory scoped to {organisationName}
            </span>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Active Suppliers</span>
              <Building2 className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading && !hasSearchFilter && directoryTab === 'active' ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {activeTotalCount}
                  {activeHitLimit ? '+' : ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {activeHitLimit
                    ? 'Showing up to 100 active records'
                    : 'Available for purchasing'}
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Archived Suppliers</span>
              <Archive className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading && !hasSearchFilter && directoryTab === 'archived' ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {archivedTotalCount}
                  {archivedHitLimit ? '+' : ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {canManage ? 'Restorable to active status' : 'Read-only archived vendors'}
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Avg. Payment Terms</span>
              <Clock className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-20 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {suppliers.length > 0 ? `${directoryMetrics.avgTerms}d` : '—'}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {directoryMetrics.withEmailOrPhone} with email or phone in view
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Access Permissions</span>
              <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {canManage ? 'View & Manage' : 'View & Search Only'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {canManage
                  ? 'Create, edit, archive, and restore enabled'
                  : 'Owners, Admins, and Managers can modify suppliers'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Filter Tabs */}
      <div
        role="tablist"
        aria-label="Supplier status tabs"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        <button
          type="button"
          role="tab"
          aria-selected={directoryTab === 'active'}
          onClick={() => handleSwitchTab('active')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            directoryTab === 'active'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Active Suppliers ({activeTotalCount}
          {activeHitLimit ? '+' : ''})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={directoryTab === 'archived'}
          onClick={() => handleSwitchTab('archived')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            directoryTab === 'archived'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Archived Suppliers ({archivedTotalCount}
          {archivedHitLimit ? '+' : ''})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={directoryTab === 'all'}
          onClick={() => handleSwitchTab('all')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            directoryTab === 'all'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All
        </button>
      </div>

      {/* Suppliers Directory Table / Responsive List */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {isAllTab
                ? 'All Suppliers'
                : isArchivedTab
                  ? 'Archived Suppliers'
                  : 'Active Suppliers'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isArchivedTab
                ? 'Archived suppliers are preserved for audit history and cannot be edited until restored.'
                : 'Search suppliers by name, contact person, email, or phone number.'}
            </p>
          </div>

          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-wrap items-center gap-2 w-full lg:w-auto"
          >
            <div className="relative flex-1 sm:w-72 lg:w-80 min-w-[200px]">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search supplier, contact, email, phone..."
                aria-label="Search suppliers"
                className="w-full pl-8 pr-8 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="Clear supplier search"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!organisationId || loading}
              className="px-3.5 py-2 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Search
            </button>
          </form>
        </div>

        {/* Result Status Bar */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">
            {loading
              ? 'Loading suppliers...'
              : hasSearchFilter
                ? `${suppliers.length}${searchHitLimit ? '+' : ''} matching "${appliedSearch}"`
                : `${suppliers.length}${searchHitLimit ? '+' : ''} ${
                    isAllTab ? 'total' : isArchivedTab ? 'archived' : 'active'
                  } ${suppliers.length === 1 ? 'supplier' : 'suppliers'}`}
          </span>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={!organisationId || loading || refreshing}
            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3 w-3 ${loading || refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh list'}</span>
          </button>
        </div>

        {/* States */}
        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : loadError && suppliers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">Could not load suppliers</div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</p>
          </div>
        ) : suppliers.length === 0 ? (
          hasSearchFilter ? (
            <div className="p-10 text-center space-y-3">
              <Search className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">
                  No suppliers match &ldquo;{appliedSearch}&rdquo;
                </div>
                <p className="text-xs text-slate-500">
                  Try another supplier name, contact person, email, or phone number, or clear the search filter.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearSearch}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Clear Search
              </button>
            </div>
          ) : isArchivedTab ? (
            <div className="p-10 text-center space-y-2">
              <Archive className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="text-xs font-semibold text-slate-900">No archived suppliers</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Archived vendors will appear here when an Owner, Admin, or Manager archives an active supplier.
              </p>
            </div>
          ) : (
            <div className="p-10 text-center space-y-3">
              <Building2 className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">No suppliers yet</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {canManage
                    ? 'Add your first supplier to store vendor contacts, email, phone, and payment terms for purchasing.'
                    : 'No suppliers have been added to this organization yet. Ask an Owner, Admin, or Manager to add suppliers.'}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add First Supplier</span>
                </button>
              )}
            </div>
          )
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4 whitespace-nowrap">Supplier Name</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Contact Person</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Email</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Phone</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Payment Terms</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {suppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className={`hover:bg-slate-50/60 transition-colors ${
                        supplier.isActive ? '' : 'bg-slate-50/40'
                      }`}
                    >
                      <td className="py-3 px-4 max-w-[240px]">
                        <button
                          type="button"
                          onClick={() => setViewingSupplier(supplier)}
                          className="font-medium text-slate-900 hover:text-blue-700 hover:underline text-left truncate block max-w-full"
                        >
                          {supplier.name}
                        </button>
                        {supplier.address && (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {supplier.address}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {supplier.contactPerson || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-700 break-all max-w-[200px]">
                        {supplier.email || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {supplier.phone || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {formatPaymentTermsLabel(supplier.paymentTermsDays)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            supplier.isActive ? 'text-emerald-700' : 'text-amber-800'
                          }`}
                        >
                          {supplier.isActive ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingSupplier(supplier)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            <Eye className="h-3 w-3" aria-hidden="true" />
                            <span>View</span>
                          </button>
                          {canManage && supplier.isActive && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(supplier)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                <Edit3 className="h-3 w-3" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openArchiveModal(supplier)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-600 hover:text-amber-800 hover:border-amber-300 whitespace-nowrap shrink-0"
                              >
                                <Archive className="h-3 w-3" aria-hidden="true" />
                                <span>Archive</span>
                              </button>
                            </>
                          )}
                          {canManage && !supplier.isActive && (
                            <button
                              type="button"
                              onClick={() => openRestoreModal(supplier)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-[11px] font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                            >
                              <RotateCcw className="h-3 w-3" aria-hidden="true" />
                              <span>Restore</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive List */}
            <div className="md:hidden divide-y divide-slate-200">
              {suppliers.map((supplier) => (
                <article key={supplier.id} className="p-4 space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setViewingSupplier(supplier)}
                        className="font-semibold text-sm text-slate-900 hover:text-blue-700 text-left break-words"
                      >
                        {supplier.name}
                      </button>
                      <div className="mt-0.5 text-slate-600">
                        Contact: {supplier.contactPerson || '—'}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium shrink-0 whitespace-nowrap ${
                        supplier.isActive ? 'text-emerald-700' : 'text-amber-800'
                      }`}
                    >
                      {supplier.isActive ? 'Active' : 'Archived'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-slate-700">
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span className="break-all">{supplier.email || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span className="font-mono tabular-nums">{supplier.phone || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span className="font-mono tabular-nums">
                        {formatPaymentTermsLabel(supplier.paymentTermsDays)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setViewingSupplier(supplier)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>View</span>
                    </button>
                    {canManage && supplier.isActive && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditModal(supplier)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openArchiveModal(supplier)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:text-amber-800 hover:border-amber-300 whitespace-nowrap shrink-0"
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Archive</span>
                        </button>
                      </>
                    )}
                    {canManage && !supplier.isActive && (
                      <button
                        type="button"
                        onClick={() => openRestoreModal(supplier)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Restore</span>
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {/* View Supplier Modal */}
      <SupplierDetailModal
        supplier={viewingSupplier}
        timeZone={timeZone}
        canManage={canManage}
        onClose={() => setViewingSupplier(null)}
        onEdit={openEditModal}
        onArchive={openArchiveModal}
        onRestore={openRestoreModal}
      />

      {/* Create / Edit Supplier Modal */}
      {organisationId && canManage && (
        <SupplierFormModal
          open={formOpen}
          organisationId={organisationId}
          supplier={editingSupplier}
          onClose={() => {
            setFormOpen(false);
            setEditingSupplier(null);
          }}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Archive Confirmation Modal */}
      {archivingSupplier && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-supplier-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 id="archive-supplier-title" className="text-sm font-semibold text-slate-900">
                Archive Supplier
              </h2>
              <button
                type="button"
                onClick={() => setArchivingSupplier(null)}
                disabled={archivingSubmitting}
                aria-label="Close archive confirmation"
                className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-2.5 leading-relaxed">
              <p>
                Archive{' '}
                <span className="font-semibold text-slate-900">{archivingSupplier.name}</span>?
              </p>
              <p>
                Archived suppliers are moved to Archived Suppliers without deleting historical records, and cannot be edited until restored.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchivingSupplier(null)}
                disabled={archivingSubmitting}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={archivingSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap"
              >
                {archivingSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>{archivingSubmitting ? 'Archiving...' : 'Archive Supplier'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {restoringSupplier && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-supplier-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 id="restore-supplier-title" className="text-sm font-semibold text-slate-900">
                Restore Supplier
              </h2>
              <button
                type="button"
                onClick={() => setRestoringSupplier(null)}
                disabled={restoringSubmitting}
                aria-label="Close restore confirmation"
                className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-2.5 leading-relaxed">
              <p>
                Restore{' '}
                <span className="font-semibold text-slate-900">{restoringSupplier.name}</span> to
                Active Suppliers?
              </p>
              <p>
                Once restored, this supplier will return to the active supplier directory and can be edited again.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoringSupplier(null)}
                disabled={restoringSubmitting}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRestore()}
                disabled={restoringSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                {restoringSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>{restoringSubmitting ? 'Restoring...' : 'Restore Supplier'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

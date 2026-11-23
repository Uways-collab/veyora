import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileEdit,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  InventoryBalanceRecord,
  InventoryLocationRecord,
} from '../inventory/inventoryService';
import { PurchaseReturnDetailModal } from './PurchaseReturnDetailModal';
import { PurchaseReturnFormModal } from './PurchaseReturnFormModal';
import {
  fetchPurchaseReturns,
  formatPurchaseReturnStatusLabel,
} from './purchaseReturnsService';
import {
  fetchPurchaseReferenceData,
  fetchPurchasesList,
  formatPurchaseDate,
  formatPurchaseMoney,
  formatPurchaseNumberPrecision,
} from './purchasesService';
import type {
  PurchaseCatalogVariant,
  PurchaseRecord,
  PurchaseReturnCompleteResult,
  PurchaseReturnCompleteStockUpdate,
  PurchaseReturnFilterStatus,
  PurchaseReturnMutationResult,
  PurchaseReturnRecord,
  PurchaseReturnStatusValue,
} from './purchasesTypes';

interface PurchaseReturnsPanelProps {
  organisationId: string | null;
  organisationName?: string | null;
  currencyCode: string;
  timeZone?: string | null;
  canManage: boolean;
  isAuthenticated: boolean;
  externalCreateSignal?: number;
  externalRefreshSignal?: number;
  onRefreshingChange?: (refreshing: boolean) => void;
  onReturnMutated?: () => void;
}

const FILTER_TABS: Array<{ id: PurchaseReturnFilterStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

function getReturnStatusTextClass(status: PurchaseReturnStatusValue): string {
  switch (status) {
    case 'draft':
      return 'text-slate-700';
    case 'completed':
      return 'text-emerald-700';
    case 'cancelled':
      return 'text-red-700';
  }
}

export function PurchaseReturnsPanel({
  organisationId,
  organisationName,
  currencyCode,
  timeZone,
  canManage,
  isAuthenticated,
  externalCreateSignal = 0,
  externalRefreshSignal = 0,
  onRefreshingChange,
  onReturnMutated,
}: PurchaseReturnsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<PurchaseReturnFilterStatus>('all');
  const [searchInput, setSearchInput] = useState('');

  const [returns, setReturns] = useState<PurchaseReturnRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [catalogVariants, setCatalogVariants] = useState<PurchaseCatalogVariant[]>([]);
  const [locationsById, setLocationsById] = useState<Record<string, InventoryLocationRecord>>({});
  const [inventoryBalances, setInventoryBalances] = useState<InventoryBalanceRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [referenceWarning, setReferenceWarning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [stockDeductionNotice, setStockDeductionNotice] = useState<{
    returnId: string;
    returnNumber: string | null;
    purchaseNumber: string;
    updates: PurchaseReturnCompleteStockUpdate[];
  } | null>(null);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [viewingReturn, setViewingReturn] = useState<PurchaseReturnRecord | null>(null);

  const requestSeqRef = useRef(0);
  const lastCreateSignalRef = useRef(externalCreateSignal);
  const lastRefreshSignalRef = useRef(externalRefreshSignal);

  useEffect(() => {
    onRefreshingChange?.(loading || refreshing);
  }, [loading, refreshing, onRefreshingChange]);

  const loadWorkspaceReturns = useCallback(
    async (orgId: string, options?: { isManualRefresh?: boolean }) => {
      const seq = ++requestSeqRef.current;
      if (options?.isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);
      setReferenceWarning(null);

      try {
        const refData = await fetchPurchaseReferenceData(orgId);
        if (seq !== requestSeqRef.current) return;

        setCatalogVariants(refData.catalogVariants);
        setLocationsById(refData.locationsById);
        setInventoryBalances(refData.inventoryBalances);

        const warnings = [
          refData.suppliersError,
          refData.catalogError,
          refData.locationsError,
        ].filter(Boolean);

        const purchasesRes = await fetchPurchasesList(orgId, {
          defaultCurrency: currencyCode,
          suppliersById: refData.allSuppliersById,
          catalogVariants: refData.catalogVariants,
        });
        if (seq !== requestSeqRef.current) return;

        if (purchasesRes.error) {
          warnings.push(purchasesRes.error);
          setPurchases([]);
        } else {
          setPurchases(purchasesRes.purchases);
          if (purchasesRes.itemsWarning) {
            warnings.push(purchasesRes.itemsWarning);
          }
        }

        const returnsRes = await fetchPurchaseReturns(orgId, {
          defaultCurrency: currencyCode,
          purchases: purchasesRes.purchases,
          catalogVariants: refData.catalogVariants,
          locationsById: refData.locationsById,
        });
        if (seq !== requestSeqRef.current) return;

        if (returnsRes.itemsWarning) {
          warnings.push(returnsRes.itemsWarning);
        }
        if (warnings.length > 0) {
          setReferenceWarning(warnings.join(' · '));
        }

        if (returnsRes.error) {
          setLoadError(returnsRes.error);
          setReturns([]);
        } else {
          setReturns(returnsRes.returns);
          setViewingReturn((prev) =>
            prev ? (returnsRes.returns.find((r) => r.id === prev.id) ?? null) : null
          );
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [currencyCode]
  );

  useEffect(() => {
    requestSeqRef.current += 1;
    setStatusFilter('all');
    setSearchInput('');
    setReturns([]);
    setPurchases([]);
    setCatalogVariants([]);
    setLocationsById({});
    setInventoryBalances([]);
    setLoadError(null);
    setReferenceWarning(null);
    setFeedback(null);
    setStockDeductionNotice(null);
    setFormOpen(false);
    setViewingReturn(null);

    if (isAuthenticated && organisationId) {
      void loadWorkspaceReturns(organisationId, { isManualRefresh: false });
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, organisationId, loadWorkspaceReturns]);

  useEffect(() => {
    if (externalCreateSignal !== lastCreateSignalRef.current) {
      lastCreateSignalRef.current = externalCreateSignal;
      if (canManage && organisationId) {
        setFeedback(null);
        setFormOpen(true);
      }
    }
  }, [externalCreateSignal, canManage, organisationId]);

  useEffect(() => {
    if (externalRefreshSignal !== lastRefreshSignalRef.current) {
      lastRefreshSignalRef.current = externalRefreshSignal;
      if (organisationId) {
        setFeedback(null);
        void loadWorkspaceReturns(organisationId, { isManualRefresh: true });
      }
    }
  }, [externalRefreshSignal, organisationId, loadWorkspaceReturns]);

  const statusCounts = useMemo(() => {
    const counts: Record<PurchaseReturnFilterStatus, number> = {
      all: returns.length,
      draft: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const r of returns) {
      counts[r.status] += 1;
    }
    return counts;
  }, [returns]);

  const filteredReturns = useMemo(() => {
    const query = searchInput.trim().toLowerCase();
    return returns.filter((ret) => {
      if (statusFilter !== 'all' && ret.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      const matchesHeader =
        ret.returnNumber.toLowerCase().includes(query) ||
        ret.purchaseNumber.toLowerCase().includes(query) ||
        ret.supplierName.toLowerCase().includes(query) ||
        ret.reason.toLowerCase().includes(query) ||
        (ret.supplierCreditReference ?? '').toLowerCase().includes(query);
      if (matchesHeader) return true;
      return ret.items.some(
        (item) =>
          item.productName.toLowerCase().includes(query) ||
          item.variantName.toLowerCase().includes(query) ||
          item.sku.toLowerCase().includes(query)
      );
    });
  }, [returns, statusFilter, searchInput]);

  const handleManualRefresh = () => {
    if (!organisationId) return;
    setFeedback(null);
    void loadWorkspaceReturns(organisationId, { isManualRefresh: true });
  };

  const handleCreateDraftSuccess = async (
    result: PurchaseReturnMutationResult,
    purchase: PurchaseRecord
  ) => {
    setFormOpen(false);
    setStockDeductionNotice(null);
    const label = result.returnRecord?.returnNumber
      ? `Return draft ${result.returnRecord.returnNumber}`
      : 'Purchase return draft';
    setFeedback({
      type: 'success',
      message: `${label} created for ${purchase.purchaseNumber}. Review and complete the return when goods are shipped back to deduct inventory stock.`,
    });
    if (organisationId) {
      await loadWorkspaceReturns(organisationId, { isManualRefresh: true });
    }
    onReturnMutated?.();
  };

  const handleCompleteSuccess = async (
    result: PurchaseReturnCompleteResult,
    target: PurchaseReturnRecord
  ) => {
    setViewingReturn(null);
    const label = result.returnNumber ?? target.returnNumber;
    setFeedback({
      type: 'success',
      message: `Purchase return ${label} completed for ${target.purchaseNumber}. Inventory balances have been updated.`,
    });
    setStockDeductionNotice({
      returnId: result.returnId ?? target.id,
      returnNumber: label,
      purchaseNumber: target.purchaseNumber,
      updates: result.stockUpdates,
    });
    if (organisationId) {
      await loadWorkspaceReturns(organisationId, { isManualRefresh: true });
    }
    onReturnMutated?.();
  };

  const handleCancelDraftSuccess = async (target: PurchaseReturnRecord) => {
    setViewingReturn(null);
    setStockDeductionNotice(null);
    setFeedback({
      type: 'success',
      message: `Purchase return draft ${target.returnNumber} cancelled. Reserved quantities are now available again on ${target.purchaseNumber}.`,
    });
    if (organisationId) {
      await loadWorkspaceReturns(organisationId, { isManualRefresh: true });
    }
    onReturnMutated?.();
  };

  const isInitialLoading = loading && !refreshing;
  const hasActiveFilters = statusFilter !== 'all' || searchInput.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
      {feedback && (
        <section
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 space-y-2.5 text-xs ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
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
              onClick={() => {
                setFeedback(null);
                setStockDeductionNotice(null);
              }}
              aria-label="Dismiss notification"
              className="p-0.5 rounded text-slate-400 hover:text-slate-700 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {feedback.type === 'success' && stockDeductionNotice && (
            <div className="pl-6 space-y-2 text-[11px] text-emerald-950">
              {stockDeductionNotice.updates.length > 0 && (
                <div className="bg-white/80 border border-emerald-200 rounded-md p-3 space-y-1.5">
                  <div className="font-semibold text-emerald-900">
                    Updated Stock Balances (
                    {stockDeductionNotice.returnNumber ?? stockDeductionNotice.purchaseNumber})
                  </div>
                  <div className="divide-y divide-emerald-100">
                    {stockDeductionNotice.updates.map((upd) => (
                      <div
                        key={`${upd.variantId}:${upd.locationId}`}
                        className="py-1 flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          <span className="font-medium">{upd.productName}</span> — {upd.variantName}{' '}
                          (<span className="font-mono">{upd.sku}</span>) @{' '}
                          <span className="font-medium">{upd.locationName}</span>
                        </span>
                        <span className="font-mono tabular-nums">
                          −{formatPurchaseNumberPrecision(upd.returnedQuantity)} returned
                          {upd.newStockQuantity !== null
                            ? ` · New stock: ${formatPurchaseNumberPrecision(upd.newStockQuantity)} ${upd.unitOfMeasure}`
                            : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => {
                    const matched = returns.find((r) => r.id === stockDeductionNotice.returnId);
                    if (matched) setViewingReturn(matched);
                  }}
                  className="font-medium text-emerald-800 hover:underline"
                >
                  View Completed Return Details →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Error / Warning Banners */}
      {loadError && (
        <section
          role="alert"
          className="bg-amber-50/80 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="font-semibold">Unable to load purchase returns</div>
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

      {!loadError && referenceWarning && (
        <section
          role="status"
          className="bg-amber-50/60 border border-amber-200 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <span className="font-semibold">Reference data warning:</span> {referenceWarning}
          </div>
        </section>
      )}

      {/* Summary KPI Strip */}
      <section aria-labelledby="purchase-returns-summary-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="purchase-returns-summary-heading" className="text-sm font-semibold text-slate-900">
            Purchase Returns Summary
          </h2>
          {organisationName && (
            <span className="text-xs text-slate-500">
              Returns scoped to {organisationName}
            </span>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Total Returns</span>
              <ClipboardList className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {statusCounts.all}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {statusCounts.completed} completed · {statusCounts.cancelled} cancelled
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Draft Returns</span>
              <FileEdit className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {statusCounts.draft}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Reserving quantities until completed or cancelled
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Completed Returns</span>
              <RotateCcw className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {statusCounts.completed}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Stock deducted from selected inventory locations
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
                {canManage ? 'Create, Complete & Cancel Drafts' : 'View & Search Only'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {canManage
                  ? 'Draft creation, completion, and cancellation enabled'
                  : 'Owners, Admins, and Managers can manage purchase returns'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Status Filter Tabs */}
      <div
        role="tablist"
        aria-label="Purchase return status filters"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit max-w-full overflow-x-auto"
      >
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              statusFilter === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label} ({statusCounts[tab.id]})
          </button>
        ))}
      </div>

      {/* Returns List */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {statusFilter === 'all'
                ? 'All Purchase Returns'
                : `${formatPurchaseReturnStatusLabel(statusFilter)} Purchase Returns`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Search by return number, purchase order number, supplier, credit reference, or SKU.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 sm:w-72 lg:w-80 min-w-[200px]">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search return #, PO #, supplier, SKU..."
                aria-label="Search purchase returns"
                className="w-full pl-8 pr-8 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear purchase return search"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Result Status Bar */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">
            {loading
              ? 'Loading purchase returns...'
              : `${filteredReturns.length} of ${returns.length} ${
                  returns.length === 1 ? 'record' : 'records'
                }`}
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

        {/* Body States */}
        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : loadError && returns.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">
              Could not load purchase returns
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</p>
          </div>
        ) : filteredReturns.length === 0 ? (
          hasActiveFilters ? (
            <div className="p-10 text-center space-y-3">
              <Search className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">
                  No purchase returns match your filter
                </div>
                <p className="text-xs text-slate-500">
                  Adjust the status filter or clear your search term to view other returns.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setSearchInput('');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="p-10 text-center space-y-3">
              <RotateCcw className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">No purchase returns yet</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {canManage
                    ? 'Create a purchase return draft for accepted items from received or partially received purchase orders.'
                    : 'No purchase returns have been recorded in this organization yet.'}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null);
                    setFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>New Return Draft</span>
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
                    <th className="py-2.5 px-4 whitespace-nowrap">Return #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Purchase #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Supplier</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Return Date</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Return Value</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredReturns.map((ret) => (
                    <tr key={ret.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setViewingReturn(ret)}
                          className="font-mono font-medium text-slate-900 hover:text-blue-700 hover:underline"
                        >
                          {ret.returnNumber}
                        </button>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                          {ret.items.length} {ret.items.length === 1 ? 'line' : 'lines'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-800 whitespace-nowrap">
                        {ret.purchaseNumber}
                      </td>
                      <td className="py-3 px-4 max-w-[220px]">
                        <div className="font-medium text-slate-900 truncate">
                          {ret.supplierName}
                        </div>
                        {ret.supplierCreditReference && (
                          <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                            Credit Ref: {ret.supplierCreditReference}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatPurchaseDate(ret.returnDate, timeZone)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${getReturnStatusTextClass(ret.status)}`}
                        >
                          {formatPurchaseReturnStatusLabel(ret.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right font-semibold text-slate-900 whitespace-nowrap">
                        {formatPurchaseMoney(ret.totalAmount, ret.currencyCode)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewingReturn(ret)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            <Eye className="h-3 w-3" aria-hidden="true" />
                            <span>{canManage && ret.status === 'draft' ? 'Review' : 'View'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-200">
              {filteredReturns.map((ret) => (
                <article key={ret.id} className="p-4 space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setViewingReturn(ret)}
                        className="font-mono font-semibold text-sm text-slate-900 hover:text-blue-700 text-left"
                      >
                        {ret.returnNumber}
                      </button>
                      <div className="mt-0.5 text-slate-600 truncate">
                        PO: <span className="font-mono text-slate-800">{ret.purchaseNumber}</span> ·{' '}
                        {ret.supplierName}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium shrink-0 whitespace-nowrap ${getReturnStatusTextClass(
                        ret.status
                      )}`}
                    >
                      {formatPurchaseReturnStatusLabel(ret.status)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <span className="text-slate-500 font-mono tabular-nums">
                      {formatPurchaseDate(ret.returnDate, timeZone)} · {ret.items.length}{' '}
                      {ret.items.length === 1 ? 'line' : 'lines'}
                    </span>
                    <span className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                      {formatPurchaseMoney(ret.totalAmount, ret.currencyCode)}
                    </span>
                  </div>

                  {ret.supplierCreditReference && (
                    <div className="text-[11px] text-slate-500 font-mono">
                      Credit Ref: {ret.supplierCreditReference}
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setViewingReturn(ret)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {canManage && ret.status === 'draft' ? 'Review & Complete' : 'View Details'}
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Create Purchase Return Draft Modal */}
      {organisationId && canManage && (
        <PurchaseReturnFormModal
          open={formOpen}
          organisationId={organisationId}
          purchases={purchases}
          allReturns={returns}
          locationsById={locationsById}
          inventoryBalances={inventoryBalances}
          catalogVariants={catalogVariants}
          defaultCurrency={currencyCode}
          timeZone={timeZone}
          onClose={() => setFormOpen(false)}
          onSuccess={handleCreateDraftSuccess}
        />
      )}

      {/* View / Complete / Cancel Purchase Return Detail Modal */}
      <PurchaseReturnDetailModal
        organisationId={organisationId}
        returnRecord={viewingReturn}
        purchases={purchases}
        locationsById={locationsById}
        catalogVariants={catalogVariants}
        defaultCurrency={currencyCode}
        timeZone={timeZone}
        canManage={canManage}
        onClose={() => setViewingReturn(null)}
        onCompleted={handleCompleteSuccess}
        onCancelled={handleCancelDraftSuccess}
      />
    </div>
  );
}

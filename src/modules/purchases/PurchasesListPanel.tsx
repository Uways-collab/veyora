import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Eye,
  FileEdit,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { InventoryLocationRecord } from '../inventory/inventoryService';
import { generateIdempotencyKey } from '../sales/salesFormatters';
import { PurchaseDetailModal } from './PurchaseDetailModal';
import { PurchaseFormModal } from './PurchaseFormModal';
import { PurchaseReceiveModal } from './PurchaseReceiveModal';
import {
  confirmPurchaseOrder,
  fetchPurchaseReferenceData,
  fetchPurchasesList,
  formatPurchaseDate,
  formatPurchaseMoney,
  formatPurchaseNumberPrecision,
  formatPurchaseStatusLabel,
} from './purchasesService';
import {
  isPurchaseReceivableStatus,
  type PurchaseCatalogVariant,
  type PurchaseListFilterStatus,
  type PurchaseReceiveResult,
  type PurchaseRecord,
  type PurchaseStatusValue,
  type PurchaseStockUpdateSummary,
} from './purchasesTypes';
import type { SupplierRecord } from './suppliersTypes';

interface PurchasesListPanelProps {
  organisationId: string | null;
  organisationName?: string | null;
  currencyCode: string;
  timeZone?: string | null;
  canManage: boolean;
  isAuthenticated: boolean;
  externalCreateSignal?: number;
  externalRefreshSignal?: number;
  onRefreshingChange?: (refreshing: boolean) => void;
  onSwitchToSuppliers?: () => void;
}

const FILTER_TABS: Array<{ id: PurchaseListFilterStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'ordered', label: 'Ordered' },
  { id: 'partially_received', label: 'Partially Received' },
  { id: 'received', label: 'Received' },
  { id: 'cancelled', label: 'Cancelled' },
];

function getStatusTextClass(status: PurchaseStatusValue): string {
  switch (status) {
    case 'draft':
      return 'text-slate-700';
    case 'ordered':
      return 'text-blue-700';
    case 'partially_received':
      return 'text-amber-800';
    case 'received':
      return 'text-emerald-700';
    case 'cancelled':
      return 'text-red-700';
  }
}

export function PurchasesListPanel({
  organisationId,
  organisationName,
  currencyCode,
  timeZone,
  canManage,
  isAuthenticated,
  externalCreateSignal = 0,
  externalRefreshSignal = 0,
  onRefreshingChange,
  onSwitchToSuppliers,
}: PurchasesListPanelProps) {
  const [statusFilter, setStatusFilter] = useState<PurchaseListFilterStatus>('all');
  const [searchInput, setSearchInput] = useState('');

  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [activeSuppliers, setActiveSuppliers] = useState<SupplierRecord[]>([]);
  const [suppliersById, setSuppliersById] = useState<Record<string, SupplierRecord>>({});
  const [catalogVariants, setCatalogVariants] = useState<PurchaseCatalogVariant[]>([]);
  const [activeLocations, setActiveLocations] = useState<InventoryLocationRecord[]>([]);
  const [locationsById, setLocationsById] = useState<Record<string, InventoryLocationRecord>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [referenceWarning, setReferenceWarning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [stockUpdateNotice, setStockUpdateNotice] = useState<{
    purchaseId: string;
    purchaseNumber: string;
    receiptNumber: string | null;
    updates: PurchaseStockUpdateSummary[];
  } | null>(null);

  // Modals
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRecord | null>(null);
  const [confirmingPurchase, setConfirmingPurchase] = useState<PurchaseRecord | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [receivingPurchase, setReceivingPurchase] = useState<PurchaseRecord | null>(null);
  const [receiptsRefreshSignal, setReceiptsRefreshSignal] = useState(0);

  const requestSeqRef = useRef(0);
  const confirmLockRef = useRef(false);
  const confirmIdempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const lastCreateSignalRef = useRef(externalCreateSignal);
  const lastRefreshSignalRef = useRef(externalRefreshSignal);

  useEffect(() => {
    onRefreshingChange?.(loading || refreshing);
  }, [loading, refreshing, onRefreshingChange]);

  const loadWorkspacePurchases = useCallback(
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

        setActiveSuppliers(refData.activeSuppliers);
        setSuppliersById(refData.allSuppliersById);
        setCatalogVariants(refData.catalogVariants);
        setActiveLocations(refData.activeLocations);
        setLocationsById(refData.locationsById);

        const warnings = [
          refData.suppliersError,
          refData.catalogError,
          refData.locationsError,
        ].filter(Boolean);
        if (warnings.length > 0) {
          setReferenceWarning(warnings.join(' · '));
        }

        const listRes = await fetchPurchasesList(orgId, {
          defaultCurrency: currencyCode,
          suppliersById: refData.allSuppliersById,
          catalogVariants: refData.catalogVariants,
        });
        if (seq !== requestSeqRef.current) return;

        if (listRes.error) {
          setLoadError(listRes.error);
          setPurchases([]);
        } else {
          setPurchases(listRes.purchases);
          if (listRes.itemsWarning) {
            setReferenceWarning((prev) =>
              prev ? `${prev} · ${listRes.itemsWarning}` : (listRes.itemsWarning ?? null)
            );
          }
          setViewingPurchase((prev) =>
            prev ? (listRes.purchases.find((p) => p.id === prev.id) ?? null) : null
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

  // Reset cleanly on workspace change
  useEffect(() => {
    requestSeqRef.current += 1;
    setStatusFilter('all');
    setSearchInput('');
    setPurchases([]);
    setActiveSuppliers([]);
    setSuppliersById({});
    setCatalogVariants([]);
    setActiveLocations([]);
    setLocationsById({});
    setLoadError(null);
    setReferenceWarning(null);
    setFeedback(null);
    setStockUpdateNotice(null);
    setViewingPurchase(null);
    setFormOpen(false);
    setEditingPurchase(null);
    setConfirmingPurchase(null);
    setConfirmSubmitting(false);
    setReceivingPurchase(null);
    confirmLockRef.current = false;

    if (isAuthenticated && organisationId) {
      void loadWorkspacePurchases(organisationId, { isManualRefresh: false });
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, organisationId, loadWorkspacePurchases]);

  // Respond to parent "+ New Purchase Draft" and "Refresh" triggers
  useEffect(() => {
    if (externalCreateSignal !== lastCreateSignalRef.current) {
      lastCreateSignalRef.current = externalCreateSignal;
      if (canManage && organisationId) {
        setFeedback(null);
        setEditingPurchase(null);
        setFormOpen(true);
      }
    }
  }, [externalCreateSignal, canManage, organisationId]);

  useEffect(() => {
    if (externalRefreshSignal !== lastRefreshSignalRef.current) {
      lastRefreshSignalRef.current = externalRefreshSignal;
      if (organisationId) {
        setFeedback(null);
        void loadWorkspacePurchases(organisationId, { isManualRefresh: true });
      }
    }
  }, [externalRefreshSignal, organisationId, loadWorkspacePurchases]);

  // Escape closes Confirm Order modal
  useEffect(() => {
    if (!confirmingPurchase) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmSubmitting) {
        setConfirmingPurchase(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmingPurchase, confirmSubmitting]);

  const statusCounts = useMemo(() => {
    const counts: Record<PurchaseListFilterStatus, number> = {
      all: purchases.length,
      draft: 0,
      ordered: 0,
      partially_received: 0,
      received: 0,
      cancelled: 0,
    };
    for (const p of purchases) {
      counts[p.status] += 1;
    }
    return counts;
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    const query = searchInput.trim().toLowerCase();
    return purchases.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) {
        return false;
      }
      if (!query) return true;
      const matchesHeader =
        p.purchaseNumber.toLowerCase().includes(query) ||
        p.supplierName.toLowerCase().includes(query) ||
        (p.supplierInvoiceNumber ?? '').toLowerCase().includes(query) ||
        (p.notes ?? '').toLowerCase().includes(query);
      if (matchesHeader) return true;
      return p.items.some(
        (item) =>
          item.productName.toLowerCase().includes(query) ||
          item.variantName.toLowerCase().includes(query) ||
          item.sku.toLowerCase().includes(query)
      );
    });
  }, [purchases, statusFilter, searchInput]);

  const handleManualRefresh = () => {
    if (!organisationId) return;
    setFeedback(null);
    void loadWorkspacePurchases(organisationId, { isManualRefresh: true });
  };

  const openCreateModal = () => {
    if (!canManage) return;
    setFeedback(null);
    setEditingPurchase(null);
    setFormOpen(true);
  };

  const openEditModal = (purchase: PurchaseRecord) => {
    if (!canManage || purchase.status !== 'draft') return;
    setFeedback(null);
    setEditingPurchase(purchase);
    setFormOpen(true);
  };

  const openConfirmModal = (purchase: PurchaseRecord) => {
    if (!canManage || purchase.status !== 'draft') return;
    setFeedback(null);
    confirmIdempotencyKeyRef.current = generateIdempotencyKey();
    setConfirmingPurchase(purchase);
  };

  const openReceiveModal = (purchase: PurchaseRecord) => {
    if (!canManage || !isPurchaseReceivableStatus(purchase.status)) return;
    setFeedback(null);
    setReceivingPurchase(purchase);
  };

  const handleFormSuccess = async (message: string) => {
    setFormOpen(false);
    setEditingPurchase(null);
    setStockUpdateNotice(null);
    setFeedback({ type: 'success', message });
    if (organisationId) {
      await loadWorkspacePurchases(organisationId, { isManualRefresh: true });
    }
  };

  const handleReceiveSuccess = async (
    result: PurchaseReceiveResult,
    targetPurchase: PurchaseRecord
  ) => {
    setReceivingPurchase(null);
    setReceiptsRefreshSignal((prev) => prev + 1);

    const receiptLabel = result.receiptNumber ? `Receipt ${result.receiptNumber}` : 'Goods receipt';
    setFeedback({
      type: 'success',
      message: `${receiptLabel} recorded for ${targetPurchase.purchaseNumber}. Inventory balances and purchase status have been updated.`,
    });

    setStockUpdateNotice({
      purchaseId: targetPurchase.id,
      purchaseNumber: targetPurchase.purchaseNumber,
      receiptNumber: result.receiptNumber,
      updates: result.stockUpdates,
    });

    if (organisationId) {
      await loadWorkspacePurchases(organisationId, { isManualRefresh: true });
    }
  };

  const handleConfirmOrder = async () => {
    if (!organisationId || !confirmingPurchase || !canManage) return;
    if (confirmLockRef.current || confirmSubmitting) return;

    confirmLockRef.current = true;
    setConfirmSubmitting(true);
    setFeedback(null);
    setStockUpdateNotice(null);

    const target = confirmingPurchase;
    try {
      const result = await confirmPurchaseOrder(
        organisationId,
        target.id,
        target.status,
        confirmIdempotencyKeyRef.current
      );
      if (result.error) {
        setConfirmingPurchase(null);
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      setConfirmingPurchase(null);
      setFeedback({
        type: 'success',
        message: `Purchase order ${target.purchaseNumber} confirmed. Inventory stock remains unchanged until goods are physically received.`,
      });
      await loadWorkspacePurchases(organisationId, { isManualRefresh: true });
    } finally {
      confirmLockRef.current = false;
      setConfirmSubmitting(false);
    }
  };

  const isInitialLoading = loading && !refreshing;
  const trimmedSearch = searchInput.trim();
  const hasActiveFilters = statusFilter !== 'all' || trimmedSearch.length > 0;
  const openOrdersCount = statusCounts.ordered + statusCounts.partially_received;

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
                setStockUpdateNotice(null);
              }}
              aria-label="Dismiss notification"
              className="p-0.5 rounded text-slate-400 hover:text-slate-700 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {feedback.type === 'success' && stockUpdateNotice && (
            <div className="pl-6 space-y-2 text-[11px] text-emerald-950">
              {stockUpdateNotice.updates.length > 0 && (
                <div className="bg-white/80 border border-emerald-200 rounded-md p-3 space-y-1.5">
                  <div className="font-semibold text-emerald-900">
                    Updated Stock Balances ({stockUpdateNotice.receiptNumber ?? stockUpdateNotice.purchaseNumber})
                  </div>
                  <div className="divide-y divide-emerald-100">
                    {stockUpdateNotice.updates.map((upd) => (
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
                          +{formatPurchaseNumberPrecision(upd.acceptedQuantity)} accepted
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
                    const matched = purchases.find((p) => p.id === stockUpdateNotice.purchaseId);
                    if (matched) setViewingPurchase(matched);
                  }}
                  className="font-medium text-emerald-800 hover:underline"
                >
                  View Purchase Order & Receipt Details →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Load Error / Warning Banners */}
      {loadError && (
        <section
          role="alert"
          className="bg-amber-50/80 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="font-semibold">Unable to load purchase orders</div>
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
      <section aria-labelledby="purchases-summary-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="purchases-summary-heading" className="text-sm font-semibold text-slate-900">
            Purchase Orders Summary
          </h2>
          {organisationName && (
            <span className="text-xs text-slate-500">
              Procurement scoped to {organisationName}
            </span>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Total Purchases</span>
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
                  {statusCounts.received} received · {statusCounts.cancelled} cancelled
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Purchase Drafts</span>
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
                  {canManage ? 'Editable until confirmed' : 'Pending manager confirmation'}
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Open Orders</span>
              <PackageCheck className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {openOrdersCount}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {statusCounts.ordered} ordered · {statusCounts.partially_received} partial
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
                {canManage ? 'Create, Edit, Confirm & Receive' : 'View & Search Only'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {canManage
                  ? 'Drafts, confirmations, and goods receiving enabled'
                  : 'Owners, Admins, and Managers can manage orders & receive goods'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Status Filter Tabs */}
      <div
        role="tablist"
        aria-label="Purchase order status filters"
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

      {/* Purchase Orders List */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {statusFilter === 'all'
                ? 'All Purchase Orders & Drafts'
                : `${formatPurchaseStatusLabel(statusFilter)} Purchases`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Search by purchase number, supplier name, supplier invoice #, or product SKU.
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
                placeholder="Search PO #, supplier, invoice #, SKU..."
                aria-label="Search purchase orders"
                className="w-full pl-8 pr-8 py-2 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear purchase search"
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
              ? 'Loading purchase orders...'
              : `${filteredPurchases.length} of ${purchases.length} ${
                  purchases.length === 1 ? 'record' : 'records'
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
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : loadError && purchases.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">
              Could not load purchase orders
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</p>
          </div>
        ) : filteredPurchases.length === 0 ? (
          hasActiveFilters ? (
            <div className="p-10 text-center space-y-3">
              <Search className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">
                  No purchase records match your filter
                </div>
                <p className="text-xs text-slate-500">
                  Adjust the status filter or clear your search term to view other purchase orders.
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
              <ClipboardList className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">
                  No purchase orders yet
                </div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {canManage
                    ? 'Create a purchase draft to select an active supplier, add Inventory product variants, and prepare an order.'
                    : 'No purchase drafts or orders have been created in this organization yet.'}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>New Purchase Draft</span>
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
                    <th className="py-2.5 px-4 whitespace-nowrap">Purchase #</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Supplier</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Order Date</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Expected Delivery</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Total</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredPurchases.map((purchase) => {
                    const isDraft = purchase.status === 'draft';
                    return (
                      <tr key={purchase.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setViewingPurchase(purchase)}
                            className="font-mono font-medium text-slate-900 hover:text-blue-700 hover:underline"
                          >
                            {purchase.purchaseNumber}
                          </button>
                          <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                            {purchase.items.length} {purchase.items.length === 1 ? 'item' : 'items'}
                          </div>
                        </td>
                        <td className="py-3 px-4 max-w-[240px]">
                          <div className="font-medium text-slate-900 truncate">
                            {purchase.supplierName}
                          </div>
                          {purchase.supplierInvoiceNumber && (
                            <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                              Inv: {purchase.supplierInvoiceNumber}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatPurchaseDate(purchase.orderDate, timeZone)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatPurchaseDate(purchase.expectedDeliveryDate, timeZone)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-medium ${getStatusTextClass(purchase.status)}`}
                          >
                            {formatPurchaseStatusLabel(purchase.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="font-mono tabular-nums font-semibold text-slate-900">
                            {formatPurchaseMoney(purchase.totalAmount, purchase.currencyCode)}
                          </div>
                          {(purchase.discountAmount > 0 || purchase.taxAmount > 0) && (
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                              Sub: {formatPurchaseMoney(purchase.subtotal, purchase.currencyCode)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingPurchase(purchase)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                            >
                              <Eye className="h-3 w-3" aria-hidden="true" />
                              <span>View</span>
                            </button>
                            {canManage && isDraft && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(purchase)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                                >
                                  <Edit3 className="h-3 w-3" aria-hidden="true" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openConfirmModal(purchase)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-[11px] font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                                >
                                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                  <span>Confirm</span>
                                </button>
                              </>
                            )}
                            {canManage && isPurchaseReceivableStatus(purchase.status) && (
                              <button
                                type="button"
                                onClick={() => openReceiveModal(purchase)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-[11px] font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                              >
                                <PackageCheck className="h-3 w-3" aria-hidden="true" />
                                <span>Receive Goods</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive List */}
            <div className="md:hidden divide-y divide-slate-200">
              {filteredPurchases.map((purchase) => {
                const isDraft = purchase.status === 'draft';
                return (
                  <article key={purchase.id} className="p-4 space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setViewingPurchase(purchase)}
                          className="font-mono font-semibold text-sm text-slate-900 hover:text-blue-700 text-left"
                        >
                          {purchase.purchaseNumber}
                        </button>
                        <div className="mt-0.5 font-medium text-slate-800 truncate">
                          {purchase.supplierName}
                        </div>
                      </div>
                      <span
                        className={`text-xs font-medium shrink-0 whitespace-nowrap ${getStatusTextClass(
                          purchase.status
                        )}`}
                      >
                        {formatPurchaseStatusLabel(purchase.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-slate-700">
                      <div>
                        <span className="text-[11px] text-slate-500 block">Order Date</span>
                        <span className="font-mono tabular-nums">
                          {formatPurchaseDate(purchase.orderDate, timeZone)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Expected Delivery</span>
                        <span className="font-mono tabular-nums">
                          {formatPurchaseDate(purchase.expectedDeliveryDate, timeZone)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                      <span className="text-slate-500 font-mono tabular-nums">
                        {purchase.items.length} {purchase.items.length === 1 ? 'item' : 'items'}
                        {purchase.supplierInvoiceNumber
                          ? ` · Inv ${purchase.supplierInvoiceNumber}`
                          : ''}
                      </span>
                      <span className="font-mono tabular-nums text-sm font-semibold text-slate-900">
                        {formatPurchaseMoney(purchase.totalAmount, purchase.currencyCode)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setViewingPurchase(purchase)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>View</span>
                      </button>
                      {canManage && isDraft && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(purchase)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openConfirmModal(purchase)}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Confirm Order</span>
                          </button>
                        </>
                      )}
                      {canManage && isPurchaseReceivableStatus(purchase.status) && (
                        <button
                          type="button"
                          onClick={() => openReceiveModal(purchase)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
                        >
                          <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Receive Goods</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* View Purchase Detail Modal */}
      <PurchaseDetailModal
        organisationId={organisationId}
        purchase={viewingPurchase}
        timeZone={timeZone}
        canManage={canManage}
        suppliersById={suppliersById}
        locationsById={locationsById}
        catalogVariants={catalogVariants}
        receiptsRefreshSignal={receiptsRefreshSignal}
        onClose={() => setViewingPurchase(null)}
        onEdit={openEditModal}
        onConfirmOrder={openConfirmModal}
        onReceiveGoods={openReceiveModal}
      />

      {/* Create / Edit Purchase Draft Modal */}
      {organisationId && canManage && (
        <PurchaseFormModal
          open={formOpen}
          organisationId={organisationId}
          currencyCode={currencyCode}
          timeZone={timeZone}
          purchase={editingPurchase}
          activeSuppliers={activeSuppliers}
          catalogVariants={catalogVariants}
          onClose={() => {
            setFormOpen(false);
            setEditingPurchase(null);
          }}
          onSuccess={handleFormSuccess}
          onNavigateSuppliers={onSwitchToSuppliers}
        />
      )}

      {/* Receive Goods Modal */}
      {organisationId && canManage && (
        <PurchaseReceiveModal
          open={Boolean(receivingPurchase)}
          organisationId={organisationId}
          purchase={receivingPurchase}
          activeLocations={activeLocations}
          locationsById={locationsById}
          catalogVariants={catalogVariants}
          onClose={() => setReceivingPurchase(null)}
          onSuccess={handleReceiveSuccess}
        />
      )}

      {/* Confirm Order Dialog */}
      {confirmingPurchase && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-purchase-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 id="confirm-purchase-title" className="text-sm font-semibold text-slate-900">
                Confirm Purchase Order
              </h2>
              <button
                type="button"
                onClick={() => setConfirmingPurchase(null)}
                disabled={confirmSubmitting}
                aria-label="Close order confirmation"
                className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-3 leading-relaxed">
              <p>
                Confirm draft{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {confirmingPurchase.purchaseNumber}
                </span>{' '}
                for{' '}
                <span className="font-semibold text-slate-900">
                  {confirmingPurchase.supplierName}
                </span>{' '}
                totaling{' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {formatPurchaseMoney(
                    confirmingPurchase.totalAmount,
                    confirmingPurchase.currencyCode
                  )}
                </span>
                ?
              </p>
              <p>
                Confirming converts this draft into an active <strong>Ordered</strong> purchase
                order and locks it from further editing. Inventory stock balances will{' '}
                <strong>not</strong> increase until goods are physically received.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingPurchase(null)}
                disabled={confirmSubmitting}
                className="px-4 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmOrder()}
                disabled={confirmSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {confirmSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>{confirmSubmitting ? 'Confirming...' : 'Confirm Order'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

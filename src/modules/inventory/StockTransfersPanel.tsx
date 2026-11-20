import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  addInventoryTransferItem,
  cancelInventoryTransfer,
  canManageInventoryCatalog,
  completeInventoryTransfer,
  createInventoryDraftTransfer,
  formatTransferReference,
  formatUnitOfMeasureLabel,
  type InventoryBalanceRecord,
  type InventoryLocationRecord,
  type InventoryProductRecord,
  type InventoryTransferRecord,
  type InventoryVariantRecord,
  type StockTransferStatusValue,
} from './inventoryService';

interface StockTransfersPanelProps {
  transfers: InventoryTransferRecord[];
  products: InventoryProductRecord[];
  variants: InventoryVariantRecord[];
  locations: InventoryLocationRecord[];
  balances: InventoryBalanceRecord[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}

type StatusFilter = 'all' | StockTransferStatusValue;

interface DraftLineRow {
  rowKey: string;
  variantId: string;
  quantity: string;
}

interface EligibleVariantOption {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  label: string;
}

function formatQuantity(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
      maximumFractionDigits: 4,
    }).format(safe);
  } catch {
    return String(safe);
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function TransferStatusIndicator({
  status,
  label,
}: {
  status: StockTransferStatusValue;
  label: string;
}) {
  const styles =
    status === 'completed'
      ? { text: 'text-emerald-700', dot: 'bg-emerald-600' }
      : status === 'cancelled'
        ? { text: 'text-slate-500', dot: 'bg-slate-400' }
        : { text: 'text-amber-700', dot: 'bg-amber-500' };

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${styles.text}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      <span>{label}</span>
    </span>
  );
}

export function StockTransfersPanel({
  transfers,
  products,
  variants,
  locations,
  balances,
  loading,
  refreshing,
  error,
  onReload,
}: StockTransfersPanelProps) {
  const { status, activeOrganisation, activeMembership, activeRole } = useAuth();

  const activeOrgId =
    status === 'authenticated' &&
    activeOrganisation?.id &&
    activeMembership?.organisation_id === activeOrganisation.id
      ? activeOrganisation.id
      : null;

  const canOperate = Boolean(activeOrgId && canManageInventoryCatalog(activeRole));

  // Filter state (available to all roles)
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [locationFilter, setLocationFilter] = useState('all');

  // Feedback banner
  const [banner, setBanner] = useState<{
    kind: 'success' | 'error';
    text: string;
    transferId?: string;
  } | null>(null);

  // Create Draft modal state (owner/admin/manager only)
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLineRow[]>([
    { rowKey: 'line-1', variantId: '', quantity: '' },
  ]);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const lineKeySeqRef = useRef(2);

  // Detail & Add-Item modal state
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [detailAddVariantId, setDetailAddVariantId] = useState('');
  const [detailAddQty, setDetailAddQty] = useState('');
  const [detailAddError, setDetailAddError] = useState<string | null>(null);
  const [detailAddSuccess, setDetailAddSuccess] = useState<string | null>(null);

  // Complete / Cancel confirmation modal state
  const [confirmCompleteId, setConfirmCompleteId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Duplicate submission lock
  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setLocationFilter('all');
    setBanner(null);
    setCreateOpen(false);
    setSelectedTransferId(null);
    setConfirmCompleteId(null);
    setConfirmCancelId(null);
    setActionError(null);
    setCreateFormError(null);
    setDetailAddError(null);
    setDetailAddSuccess(null);
  }, [activeOrgId]);

  useEffect(() => {
    const hasOpenModal =
      createOpen ||
      Boolean(selectedTransferId) ||
      Boolean(confirmCompleteId) ||
      Boolean(confirmCancelId);
    if (!hasOpenModal) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting) return;
      if (confirmCompleteId) {
        setConfirmCompleteId(null);
        setActionError(null);
      } else if (confirmCancelId) {
        setConfirmCancelId(null);
        setActionError(null);
      } else if (selectedTransferId) {
        setSelectedTransferId(null);
        setDetailAddError(null);
        setDetailAddSuccess(null);
      } else if (createOpen) {
        setCreateOpen(false);
        setCreateFormError(null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [createOpen, selectedTransferId, confirmCompleteId, confirmCancelId, submitting]);

  const scopedTransfers = useMemo(() => {
    if (!activeOrgId) return [];
    return transfers.filter((t) => t.organizationId === activeOrgId);
  }, [transfers, activeOrgId]);

  const scopedLocations = useMemo(() => {
    if (!activeOrgId) return [];
    return locations.filter((l) => l.organizationId === activeOrgId);
  }, [locations, activeOrgId]);

  const activeLocations = useMemo(
    () => scopedLocations.filter((l) => l.isActive),
    [scopedLocations]
  );

  const eligiblePhysicalVariants = useMemo<EligibleVariantOption[]>(() => {
    if (!activeOrgId) return [];
    const activePhysicalProductMap = new Map<string, InventoryProductRecord>();
    for (const p of products) {
      if (p.organizationId === activeOrgId && p.isActive && p.productTypeValue === 'physical') {
        activePhysicalProductMap.set(p.id, p);
      }
    }

    const options: EligibleVariantOption[] = [];
    for (const v of variants) {
      if (v.organizationId !== activeOrgId || !v.isActive) continue;
      const product = activePhysicalProductMap.get(v.productId);
      if (!product) continue;
      options.push({
        variantId: v.id,
        productId: product.id,
        productName: product.name,
        variantName: v.variantName,
        sku: v.sku,
        unitOfMeasure: v.unitOfMeasure,
        label: `${product.name} — ${v.variantName} (${v.sku})`,
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [activeOrgId, products, variants]);

  const variantOptionById = useMemo(
    () => new Map(eligiblePhysicalVariants.map((opt) => [opt.variantId, opt])),
    [eligiblePhysicalVariants]
  );

  // Fast lookup: `${variantId}:${locationId}` -> available quantity
  const balanceQuantityMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!activeOrgId) return map;
    for (const b of balances) {
      if (b.organizationId === activeOrgId) {
        map.set(`${b.variantId}:${b.locationId}`, b.quantity);
      }
    }
    return map;
  }, [balances, activeOrgId]);

  const getAvailableStock = (variantId: string, locId: string): number => {
    if (!variantId || !locId) return 0;
    return balanceQuantityMap.get(`${variantId}:${locId}`) ?? 0;
  };

  const summaryCounts = useMemo(() => {
    let draft = 0;
    let completed = 0;
    let cancelled = 0;
    for (const t of scopedTransfers) {
      if (t.status === 'draft') draft += 1;
      else if (t.status === 'completed') completed += 1;
      else if (t.status === 'cancelled') cancelled += 1;
    }
    return {
      total: scopedTransfers.length,
      draft,
      completed,
      cancelled,
    };
  }, [scopedTransfers]);

  const filteredTransfers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedTransfers.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }
      if (
        locationFilter !== 'all' &&
        row.sourceLocationId !== locationFilter &&
        row.destinationLocationId !== locationFilter
      ) {
        return false;
      }
      if (q) {
        const haystack = [
          row.referenceCode,
          row.id,
          row.sourceLocationName,
          row.destinationLocationName,
          row.notes ?? '',
          row.createdByName ?? '',
          ...row.items.map((item) => `${item.productName} ${item.variantName} ${item.sku}`),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [scopedTransfers, searchQuery, statusFilter, locationFilter]);

  const selectedTransfer = useMemo(
    () =>
      selectedTransferId
        ? scopedTransfers.find((t) => t.id === selectedTransferId) ?? null
        : null,
    [scopedTransfers, selectedTransferId]
  );

  const confirmCompleteTransfer = useMemo(
    () =>
      confirmCompleteId
        ? scopedTransfers.find((t) => t.id === confirmCompleteId) ?? null
        : null,
    [scopedTransfers, confirmCompleteId]
  );

  const confirmCancelTransfer = useMemo(
    () =>
      confirmCancelId
        ? scopedTransfers.find((t) => t.id === confirmCancelId) ?? null
        : null,
    [scopedTransfers, confirmCancelId]
  );

  const availableVariantsForDetailAdd = useMemo(() => {
    if (!selectedTransfer) return [];
    const existingVariantIds = new Set(selectedTransfer.items.map((i) => i.variantId));
    return eligiblePhysicalVariants.filter((opt) => !existingVariantIds.has(opt.variantId));
  }, [selectedTransfer, eligiblePhysicalVariants]);

  const openCreateModal = () => {
    if (!canOperate) return;
    setSourceLocationId('');
    setDestinationLocationId('');
    setNotesInput('');
    setDraftLines([{ rowKey: `line-${lineKeySeqRef.current++}`, variantId: '', quantity: '' }]);
    setCreateFormError(null);
    setCreateOpen(true);
  };

  const openDetailModal = (transferId: string) => {
    setSelectedTransferId(transferId);
    setDetailAddVariantId('');
    setDetailAddQty('');
    setDetailAddError(null);
    setDetailAddSuccess(null);
  };

  const openCompleteModal = (transfer: InventoryTransferRecord) => {
    if (!canOperate || transfer.status !== 'draft' || transfer.itemCount === 0) return;
    setActionError(null);
    setConfirmCompleteId(transfer.id);
  };

  const openCancelModal = (transfer: InventoryTransferRecord) => {
    if (!canOperate || transfer.status !== 'draft') return;
    setActionError(null);
    setConfirmCancelId(transfer.id);
  };

  const addDraftLine = () => {
    setDraftLines((prev) => [
      ...prev,
      { rowKey: `line-${lineKeySeqRef.current++}`, variantId: '', quantity: '' },
    ]);
    setCreateFormError(null);
  };

  const removeDraftLine = (rowKey: string) => {
    setDraftLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.rowKey !== rowKey)));
    setCreateFormError(null);
  };

  const updateDraftLine = (rowKey: string, patch: Partial<DraftLineRow>) => {
    setDraftLines((prev) =>
      prev.map((l) => (l.rowKey === rowKey ? { ...l, ...patch } : l))
    );
    setCreateFormError(null);
  };

  const handleCreateDraftSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !canOperate) return;
    if (submitLockRef.current) return;

    setCreateFormError(null);

    if (!sourceLocationId) {
      setCreateFormError('Select a source location.');
      return;
    }
    if (!destinationLocationId) {
      setCreateFormError('Select a destination location.');
      return;
    }
    if (sourceLocationId === destinationLocationId) {
      setCreateFormError('Source and destination locations must be different.');
      return;
    }

    if (draftLines.length === 0) {
      setCreateFormError('Add at least one product variant to the draft transfer.');
      return;
    }

    const parsedItems: { variantId: string; quantity: number }[] = [];
    const seenVariants = new Set<string>();

    for (let idx = 0; idx < draftLines.length; idx += 1) {
      const line = draftLines[idx];
      const lineLabel = `Item #${idx + 1}`;
      const option = variantOptionById.get(line.variantId);
      if (!option) {
        setCreateFormError(`${lineLabel}: Select an active physical product variant.`);
        return;
      }
      if (seenVariants.has(option.variantId)) {
        setCreateFormError(
          `${lineLabel}: Duplicate variant (${option.variantName}). Each variant can appear only once per transfer.`
        );
        return;
      }
      seenVariants.add(option.variantId);

      const qty = Number(line.quantity);
      if (line.quantity.trim() === '' || !Number.isFinite(qty) || qty <= 0) {
        setCreateFormError(`${lineLabel}: Enter a quantity greater than zero.`);
        return;
      }

      const available = getAvailableStock(option.variantId, sourceLocationId);
      if (qty > available) {
        setCreateFormError(
          `${lineLabel} (${option.variantName}): Requested quantity (${formatQuantity(qty)}) exceeds available source stock (${formatQuantity(available)} ${formatUnitOfMeasureLabel(option.unitOfMeasure)}).`
        );
        return;
      }

      parsedItems.push({ variantId: option.variantId, quantity: qty });
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const result = await createInventoryDraftTransfer(activeOrgId, {
        sourceLocationId,
        destinationLocationId,
        notes: notesInput.trim() || null,
        items: parsedItems,
      });

      if (!result.transferId) {
        setCreateFormError(result.error ?? 'Unable to create draft transfer.');
        return;
      }

      await onReload();
      setCreateOpen(false);

      if (result.error) {
        // Partial failure: draft was created, preserve it and open its detail view
        // without ever creating a duplicate draft on retry.
        const firstFailed = result.failedItems[0] ?? null;
        setSelectedTransferId(result.transferId);
        setDetailAddVariantId(firstFailed ? firstFailed.variantId : '');
        setDetailAddQty(firstFailed ? String(firstFailed.quantity) : '');
        setDetailAddError(
          `Draft ${formatTransferReference(result.transferId)} was saved (${result.addedVariantIds.length} item${result.addedVariantIds.length === 1 ? '' : 's'} added), but adding an item failed: ${result.error}`
        );
        setDetailAddSuccess(null);
        return;
      }

      setBanner({
        kind: 'success',
        text: `Draft transfer ${formatTransferReference(result.transferId)} created with ${parsedItems.length} item${parsedItems.length === 1 ? '' : 's'}.`,
        transferId: result.transferId,
      });
    } catch (err: unknown) {
      setCreateFormError(
        err instanceof Error ? err.message : 'Unexpected error creating draft transfer.'
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleAddItemToDraft = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !canOperate || !selectedTransfer) return;
    if (selectedTransfer.status !== 'draft') return;
    if (submitLockRef.current) return;

    setDetailAddError(null);
    setDetailAddSuccess(null);

    const option = variantOptionById.get(detailAddVariantId);
    if (!option) {
      setDetailAddError('Select an active physical product variant.');
      return;
    }

    if (selectedTransfer.items.some((item) => item.variantId === option.variantId)) {
      setDetailAddError('This variant is already included in the draft transfer.');
      return;
    }

    const qty = Number(detailAddQty);
    if (detailAddQty.trim() === '' || !Number.isFinite(qty) || qty <= 0) {
      setDetailAddError('Enter a transfer quantity greater than zero.');
      return;
    }

    const available = getAvailableStock(option.variantId, selectedTransfer.sourceLocationId);
    if (qty > available) {
      setDetailAddError(
        `Requested quantity (${formatQuantity(qty)}) exceeds available source stock (${formatQuantity(available)} ${formatUnitOfMeasureLabel(option.unitOfMeasure)}).`
      );
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const result = await addInventoryTransferItem(activeOrgId, {
        transferId: selectedTransfer.id,
        variantId: option.variantId,
        quantity: qty,
      });

      if (result.error) {
        setDetailAddError(result.error);
        return;
      }

      await onReload();
      setDetailAddVariantId('');
      setDetailAddQty('');
      setDetailAddSuccess(
        `Added ${formatQuantity(qty)} ${formatUnitOfMeasureLabel(option.unitOfMeasure)} of ${option.productName} (${option.variantName}) to ${selectedTransfer.referenceCode}.`
      );
    } catch (err: unknown) {
      setDetailAddError(
        err instanceof Error ? err.message : 'Unexpected error adding transfer item.'
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmComplete = async () => {
    if (!activeOrgId || !canOperate || !confirmCompleteTransfer) return;
    if (confirmCompleteTransfer.status !== 'draft') return;
    if (confirmCompleteTransfer.itemCount === 0) {
      setActionError('Cannot complete an empty transfer. Add at least one item first.');
      return;
    }
    if (submitLockRef.current) return;

    setActionError(null);
    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const result = await completeInventoryTransfer(activeOrgId, confirmCompleteTransfer.id);
      if (result.error) {
        setActionError(result.error);
        return;
      }

      const completedRef = confirmCompleteTransfer.referenceCode;
      await onReload();
      setConfirmCompleteId(null);
      if (selectedTransferId === confirmCompleteTransfer.id) {
        setSelectedTransferId(null);
      }
      setBanner({
        kind: 'success',
        text: `Transfer ${completedRef} completed. Stock balances and movements have been updated atomically.`,
      });
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Unexpected error completing transfer.'
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!activeOrgId || !canOperate || !confirmCancelTransfer) return;
    if (confirmCancelTransfer.status !== 'draft') {
      setActionError('Only draft transfers can be cancelled.');
      return;
    }
    if (submitLockRef.current) return;

    setActionError(null);
    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const result = await cancelInventoryTransfer(activeOrgId, confirmCancelTransfer.id);
      if (result.error) {
        setActionError(result.error);
        return;
      }

      const cancelledRef = confirmCancelTransfer.referenceCode;
      await onReload();
      setConfirmCancelId(null);
      if (selectedTransferId === confirmCancelTransfer.id) {
        setSelectedTransferId(null);
      }
      setBanner({
        kind: 'success',
        text: `Draft transfer ${cancelledRef} was cancelled.`,
      });
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Unexpected error cancelling transfer.'
      );
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Stock Transfers</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Move physical stock between active inventory locations via{' '}
            <span className="font-mono">public.stock_transfers</span> and atomic Supabase RPCs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canOperate && (
            <button
              type="button"
              onClick={openCreateModal}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Draft Transfer</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void onReload()}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Role / Security Notice */}
      {!canOperate && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 flex items-center gap-2.5">
          <ArrowLeftRight className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          <span>
            Viewing transfer history in read-only mode. Only Owners, Admins, and Managers can create, complete, or cancel stock transfers.
          </span>
        </div>
      )}

      {/* Operation Banner */}
      {banner && (
        <div
          role={banner.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
            banner.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {banner.kind === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span>{banner.text}</span>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
            {banner.transferId && (
              <button
                type="button"
                onClick={() => {
                  const id = banner.transferId;
                  setBanner(null);
                  if (id) openDetailModal(id);
                }}
                className="font-medium text-emerald-900 underline hover:text-emerald-700"
              >
                Open Draft
              </button>
            )}
            <button
              type="button"
              onClick={() => setBanner(null)}
              aria-label="Dismiss message"
              className="p-0.5 rounded hover:bg-black/5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Summary Strip */}
      <section aria-label="Stock transfer summary" className="bg-white border border-slate-200 rounded-lg grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-600">Total Transfers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {loading ? '—' : summaryCounts.total}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-600">Draft Transfers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {loading ? '—' : summaryCounts.draft}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-600">Completed Transfers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {loading ? '—' : summaryCounts.completed}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-slate-600">Cancelled Transfers</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-500 tabular-nums">
            {loading ? '—' : summaryCounts.cancelled}
          </div>
        </div>
      </section>

      {/* Transfers Table & Filters */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative lg:col-span-2">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="transfers-search" className="sr-only">
                Search transfers by reference, location, creator, or product
              </label>
              <input
                id="transfers-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search reference (TRF-...), location, creator, or SKU..."
                className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="transfers-status-filter" className="sr-only">
                Filter by transfer status
              </label>
              <select
                id="transfers-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All statuses ({scopedTransfers.length})</option>
                <option value="draft">Draft ({summaryCounts.draft})</option>
                <option value="completed">Completed ({summaryCounts.completed})</option>
                <option value="cancelled">Cancelled ({summaryCounts.cancelled})</option>
              </select>
            </div>

            <div>
              <label htmlFor="transfers-location-filter" className="sr-only">
                Filter by source or destination location
              </label>
              <select
                id="transfers-location-filter"
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All locations ({scopedLocations.length})</option>
                {scopedLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.locationType})
                    {!loc.isActive ? ' [Archived]' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>
              Filter by status or any source/destination location.
            </span>
            <span className="font-mono">
              Showing {filteredTransfers.length} of {scopedTransfers.length}{' '}
              {scopedTransfers.length === 1 ? 'transfer' : 'transfers'}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-red-700 bg-red-50/50">
            Error loading stock transfers: {error}
          </div>
        ) : filteredTransfers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-xs font-semibold text-slate-900">
              {scopedTransfers.length === 0
                ? 'No stock transfers yet'
                : 'No matching stock transfers'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {scopedTransfers.length === 0
                ? 'Create a draft stock transfer to move inventory between active locations.'
                : 'Adjust your search term, status filter, or location filter.'}
            </p>
            {scopedTransfers.length === 0 && canOperate && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>New Draft Transfer</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Reference</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Source Location</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Destination Location</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Items</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Created</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Creator</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredTransfers.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 min-w-[140px]">
                      <div className="font-mono font-semibold text-slate-900">
                        {row.referenceCode}
                      </div>
                      {row.notes && (
                        <div className="text-[11px] text-slate-500 truncate max-w-[200px]" title={row.notes}>
                          {row.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      <span>{row.sourceLocationName}</span>
                      <span className="text-[11px] text-slate-400 ml-1">
                        ({row.sourceLocationType})
                      </span>
                      {!row.sourceLocationIsActive && (
                        <span className="ml-1.5 text-[10px] font-medium text-slate-500 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                      <span>{row.destinationLocationName}</span>
                      <span className="text-[11px] text-slate-400 ml-1">
                        ({row.destinationLocationType})
                      </span>
                      {!row.destinationLocationIsActive && (
                        <span className="ml-1.5 text-[10px] font-medium text-slate-500 border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <span className="font-mono font-semibold text-slate-900">
                        {row.itemCount}
                      </span>{' '}
                      <span className="text-slate-500">
                        {row.itemCount === 1 ? 'item' : 'items'}
                      </span>
                      {row.itemCount > 0 && (
                        <div className="text-[11px] font-mono text-slate-400">
                          {formatQuantity(row.totalQuantity)} units
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <TransferStatusIndicator status={row.status} label={row.statusLabel} />
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {row.createdByName ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => openDetailModal(row.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{canOperate && row.status === 'draft' ? 'Manage' : 'View'}</span>
                        </button>

                        {canOperate && row.status === 'draft' && (
                          <>
                            <button
                              type="button"
                              disabled={row.itemCount === 0}
                              title={
                                row.itemCount === 0
                                  ? 'Add at least one item before completing this transfer'
                                  : `Complete ${row.referenceCode}`
                              }
                              onClick={() => openCompleteModal(row)}
                              className="text-xs font-medium text-blue-700 hover:text-blue-800 disabled:text-slate-300 disabled:cursor-not-allowed"
                            >
                              Complete
                            </button>
                            <button
                              type="button"
                              onClick={() => openCancelModal(row)}
                              className="text-xs font-medium text-red-700 hover:text-red-800"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create Draft Transfer Modal (Owner, Admin, Manager only) */}
      {canOperate && createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-transfer-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) {
                setCreateOpen(false);
                setCreateFormError(null);
              }
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h3 id="create-transfer-modal-title" className="text-sm font-semibold text-slate-900">
                  Create Draft Stock Transfer
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Creates a draft via <span className="font-mono">public.create_inventory_transfer</span> and attaches items via <span className="font-mono">public.add_inventory_transfer_item</span>. Stock balances remain unchanged until completed.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setCreateOpen(false);
                  setCreateFormError(null);
                }}
                aria-label="Close create transfer dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateDraftSubmit(e)} className="flex flex-col min-h-0 flex-1">
              <div className="p-6 space-y-5 overflow-y-auto">
                {activeLocations.length < 2 || eligiblePhysicalVariants.length === 0 ? (
                  <div className="p-4 rounded-md border border-amber-200 bg-amber-50/70 text-xs text-amber-900">
                    {activeLocations.length < 2
                      ? 'At least two active inventory locations are required to create a stock transfer.'
                      : 'Create at least one active physical product with an active variant before creating a stock transfer.'}
                  </div>
                ) : (
                  <fieldset disabled={submitting} className="space-y-5">
                    {/* Source & Destination */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label htmlFor="transfer-source-loc" className="block text-xs font-medium text-slate-700">
                          Source Location <span className="text-red-600">*</span>
                        </label>
                        <select
                          id="transfer-source-loc"
                          required
                          value={sourceLocationId}
                          onChange={(e) => {
                            setSourceLocationId(e.target.value);
                            setCreateFormError(null);
                          }}
                          className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        >
                          <option value="">Select source location...</option>
                          {activeLocations.map((loc) => (
                            <option
                              key={loc.id}
                              value={loc.id}
                              disabled={loc.id === destinationLocationId}
                            >
                              {loc.name} ({loc.locationType})
                              {loc.id === destinationLocationId ? ' — Selected as destination' : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="transfer-dest-loc" className="block text-xs font-medium text-slate-700">
                          Destination Location <span className="text-red-600">*</span>
                        </label>
                        <select
                          id="transfer-dest-loc"
                          required
                          value={destinationLocationId}
                          onChange={(e) => {
                            setDestinationLocationId(e.target.value);
                            setCreateFormError(null);
                          }}
                          className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        >
                          <option value="">Select destination location...</option>
                          {activeLocations.map((loc) => (
                            <option
                              key={loc.id}
                              value={loc.id}
                              disabled={loc.id === sourceLocationId}
                            >
                              {loc.name} ({loc.locationType})
                              {loc.id === sourceLocationId ? ' — Selected as source' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-1">
                      <label htmlFor="transfer-notes" className="block text-xs font-medium text-slate-700">
                        Notes (optional)
                      </label>
                      <textarea
                        id="transfer-notes"
                        rows={2}
                        maxLength={500}
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        placeholder="Optional dispatch reason, driver instructions, or packing notes..."
                        className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                    </div>

                    {/* Variant Line Items */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-900">
                            Transfer Items <span className="text-red-600">*</span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Select active physical product variants and quantities greater than zero. Duplicate variants are blocked.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={addDraftLine}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Add Line</span>
                        </button>
                      </div>

                      <div className="space-y-2.5">
                        {draftLines.map((line, index) => {
                          const selectedOption = variantOptionById.get(line.variantId) ?? null;
                          const available =
                            selectedOption && sourceLocationId
                              ? getAvailableStock(selectedOption.variantId, sourceLocationId)
                              : null;
                          const numericQty = Number(line.quantity);
                          const exceedsAvailable =
                            available !== null &&
                            line.quantity.trim() !== '' &&
                            Number.isFinite(numericQty) &&
                            numericQty > available;

                          const usedByOtherLines = new Set(
                            draftLines
                              .filter((other) => other.rowKey !== line.rowKey && other.variantId)
                              .map((other) => other.variantId)
                          );

                          return (
                            <div
                              key={line.rowKey}
                              className="rounded-md border border-slate-200 bg-slate-50/50 p-3 space-y-2"
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                                <div className="sm:col-span-7 space-y-1">
                                  <label
                                    htmlFor={`draft-line-variant-${line.rowKey}`}
                                    className="block text-[11px] font-medium text-slate-600"
                                  >
                                    Item #{index + 1} · Product &amp; Variant
                                  </label>
                                  <select
                                    id={`draft-line-variant-${line.rowKey}`}
                                    required
                                    value={line.variantId}
                                    onChange={(e) =>
                                      updateDraftLine(line.rowKey, { variantId: e.target.value })
                                    }
                                    className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                                  >
                                    <option value="">Select active physical variant...</option>
                                    {eligiblePhysicalVariants.map((opt) => {
                                      const taken = usedByOtherLines.has(opt.variantId);
                                      return (
                                        <option
                                          key={opt.variantId}
                                          value={opt.variantId}
                                          disabled={taken}
                                        >
                                          {opt.label}
                                          {taken ? ' (Already selected)' : ''}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>

                                <div className="sm:col-span-4 space-y-1">
                                  <label
                                    htmlFor={`draft-line-qty-${line.rowKey}`}
                                    className="block text-[11px] font-medium text-slate-600"
                                  >
                                    Quantity{selectedOption ? ` (${formatUnitOfMeasureLabel(selectedOption.unitOfMeasure)})` : ''}
                                  </label>
                                  <input
                                    id={`draft-line-qty-${line.rowKey}`}
                                    type="number"
                                    required
                                    min="0.0001"
                                    step="any"
                                    value={line.quantity}
                                    onChange={(e) =>
                                      updateDraftLine(line.rowKey, { quantity: e.target.value })
                                    }
                                    placeholder="0"
                                    className={`w-full h-9 px-3 rounded-md border font-mono text-xs text-slate-900 bg-white focus:outline-none focus:ring-2 ${
                                      exceedsAvailable
                                        ? 'border-red-400 focus:border-red-600 focus:ring-red-600/20'
                                        : 'border-slate-300 focus:border-blue-600 focus:ring-blue-600/20'
                                    }`}
                                  />
                                </div>

                                <div className="sm:col-span-1 flex justify-end">
                                  <button
                                    type="button"
                                    disabled={draftLines.length <= 1}
                                    onClick={() => removeDraftLine(line.rowKey)}
                                    aria-label={`Remove item #${index + 1}`}
                                    className="h-9 px-2 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>

                              {selectedOption && (
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                                  <span>
                                    SKU: <span className="font-mono text-slate-800">{selectedOption.sku}</span>
                                    {' · '}
                                    Unit: {formatUnitOfMeasureLabel(selectedOption.unitOfMeasure)}
                                  </span>
                                  <span>
                                    Available at source:{' '}
                                    {sourceLocationId ? (
                                      <strong
                                        className={`font-mono ${
                                          exceedsAvailable || (available ?? 0) <= 0
                                            ? 'text-red-700'
                                            : 'text-slate-900'
                                        }`}
                                      >
                                        {formatQuantity(available ?? 0)}{' '}
                                        {formatUnitOfMeasureLabel(selectedOption.unitOfMeasure)}
                                      </strong>
                                    ) : (
                                      <span className="text-slate-400">Select source location</span>
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </fieldset>
                )}

                {createFormError && (
                  <div
                    role="alert"
                    className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700"
                  >
                    {createFormError}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateFormError(null);
                  }}
                  className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                {activeLocations.length >= 2 && eligiblePhysicalVariants.length > 0 && (
                  <button
                    type="submit"
                    disabled={submitting}
                    aria-busy={submitting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                    )}
                    <span>{submitting ? 'Saving Draft...' : 'Save Draft Transfer'}</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Detail & Add-Item Modal */}
      {selectedTransfer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-detail-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!submitting) {
                setSelectedTransferId(null);
                setDetailAddError(null);
                setDetailAddSuccess(null);
              }
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3
                  id="transfer-detail-modal-title"
                  className="text-sm font-semibold text-slate-900 font-mono"
                >
                  {selectedTransfer.referenceCode}
                </h3>
                <TransferStatusIndicator
                  status={selectedTransfer.status}
                  label={selectedTransfer.statusLabel}
                />
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setSelectedTransferId(null);
                  setDetailAddError(null);
                  setDetailAddSuccess(null);
                }}
                aria-label="Close transfer details"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1 text-xs">
              {/* Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border border-slate-200 bg-slate-50/50 p-4">
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Route</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                    <span>{selectedTransfer.sourceLocationName}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <span>{selectedTransfer.destinationLocationName}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Transfer ID</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-600 break-all">
                    {selectedTransfer.id}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Created</div>
                  <div className="mt-1 text-slate-800">
                    {formatDateTime(selectedTransfer.createdAt)}
                    {selectedTransfer.createdByName ? ` · ${selectedTransfer.createdByName}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500">
                    {selectedTransfer.status === 'completed' ? 'Completed' : 'Notes'}
                  </div>
                  <div className="mt-1 text-slate-800">
                    {selectedTransfer.status === 'completed'
                      ? `${formatDateTime(selectedTransfer.completedAt)}${
                          selectedTransfer.completedByName
                            ? ` · ${selectedTransfer.completedByName}`
                            : ''
                        }`
                      : selectedTransfer.notes || '—'}
                  </div>
                </div>
                {selectedTransfer.status === 'completed' && selectedTransfer.notes && (
                  <div className="sm:col-span-2">
                    <div className="text-[11px] font-medium text-slate-500">Notes</div>
                    <div className="mt-1 text-slate-800">{selectedTransfer.notes}</div>
                  </div>
                )}
              </div>

              {/* Saved Items Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-slate-900">
                    Transfer Items ({selectedTransfer.itemCount})
                  </h4>
                  {selectedTransfer.status === 'draft' && (
                    <span className="text-[11px] text-slate-500">
                      Saved items are immutable. Add new variants below or cancel this draft.
                    </span>
                  )}
                </div>

                {selectedTransfer.items.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50/70 px-4 py-4 text-xs text-amber-900">
                    This draft transfer has zero saved items. Add at least one item before completing it.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-md overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                          <th className="py-2 px-3 whitespace-nowrap">Product</th>
                          <th className="py-2 px-3 whitespace-nowrap">Variant</th>
                          <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                          {selectedTransfer.status === 'draft' && (
                            <th className="py-2 px-3 text-right whitespace-nowrap">
                              Source Available
                            </th>
                          )}
                          <th className="py-2 px-3 text-right whitespace-nowrap">Quantity</th>
                          <th className="py-2 px-3 whitespace-nowrap">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {selectedTransfer.items.map((item) => {
                          const available = getAvailableStock(
                            item.variantId,
                            selectedTransfer.sourceLocationId
                          );
                          const insufficient =
                            selectedTransfer.status === 'draft' && item.quantity > available;

                          return (
                            <tr key={item.id}>
                              <td className="py-2.5 px-3 font-medium text-slate-900">
                                {item.productName}
                              </td>
                              <td className="py-2.5 px-3 text-slate-700">{item.variantName}</td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                                {item.sku}
                              </td>
                              {selectedTransfer.status === 'draft' && (
                                <td
                                  className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                                    insufficient ? 'text-red-700 font-semibold' : 'text-slate-600'
                                  }`}
                                >
                                  {formatQuantity(available)}
                                </td>
                              )}
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                                {formatQuantity(item.quantity)}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {formatUnitOfMeasureLabel(item.unitOfMeasure)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Add New Variant to Draft Form (Owner/Admin/Manager + Draft only) */}
              {canOperate && selectedTransfer.status === 'draft' && (
                <form
                  onSubmit={(e) => void handleAddItemToDraft(e)}
                  className="rounded-md border border-slate-200 bg-slate-50/70 p-4 space-y-3"
                >
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900">
                      Add New Variant to Draft
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Calls <span className="font-mono">public.add_inventory_transfer_item</span>. Variants already in this transfer cannot be added again.
                    </p>
                  </div>

                  {detailAddError && (
                    <div
                      role="alert"
                      className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700"
                    >
                      {detailAddError}
                    </div>
                  )}

                  {detailAddSuccess && (
                    <div
                      role="status"
                      className="text-xs px-3 py-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800"
                    >
                      {detailAddSuccess}
                    </div>
                  )}

                  {availableVariantsForDetailAdd.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      All active physical product variants are already included in this draft transfer.
                    </p>
                  ) : (
                    <fieldset disabled={submitting} className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-7 space-y-1">
                          <label
                            htmlFor="detail-add-variant"
                            className="block text-[11px] font-medium text-slate-600"
                          >
                            Product &amp; Variant
                          </label>
                          <select
                            id="detail-add-variant"
                            required
                            value={detailAddVariantId}
                            onChange={(e) => {
                              setDetailAddVariantId(e.target.value);
                              setDetailAddError(null);
                              setDetailAddSuccess(null);
                            }}
                            className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                          >
                            <option value="">Select active physical variant...</option>
                            {availableVariantsForDetailAdd.map((opt) => (
                              <option key={opt.variantId} value={opt.variantId}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3 space-y-1">
                          <label
                            htmlFor="detail-add-qty"
                            className="block text-[11px] font-medium text-slate-600"
                          >
                            Quantity
                          </label>
                          <input
                            id="detail-add-qty"
                            type="number"
                            required
                            min="0.0001"
                            step="any"
                            value={detailAddQty}
                            onChange={(e) => {
                              setDetailAddQty(e.target.value);
                              setDetailAddError(null);
                              setDetailAddSuccess(null);
                            }}
                            placeholder="0"
                            className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <button
                            type="submit"
                            disabled={submitting}
                            aria-busy={submitting}
                            className="w-full h-9 inline-flex items-center justify-center gap-1.5 px-3 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50"
                          >
                            {submitting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>Add</span>
                          </button>
                        </div>
                      </div>

                      {detailAddVariantId && variantOptionById.get(detailAddVariantId) && (
                        <div className="text-[11px] text-slate-600">
                          Available at {selectedTransfer.sourceLocationName}:{' '}
                          <strong className="font-mono text-slate-900">
                            {formatQuantity(
                              getAvailableStock(
                                detailAddVariantId,
                                selectedTransfer.sourceLocationId
                              )
                            )}{' '}
                            {formatUnitOfMeasureLabel(
                              variantOptionById.get(detailAddVariantId)!.unitOfMeasure
                            )}
                          </strong>
                        </div>
                      )}
                    </fieldset>
                  )}
                </form>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="text-[11px] text-slate-500">
                {canOperate &&
                  selectedTransfer.status === 'draft' &&
                  selectedTransfer.itemCount === 0 &&
                  'Add at least one item to enable transfer completion.'}
              </div>
              <div className="flex flex-wrap items-center gap-2.5 ml-auto">
                {canOperate && selectedTransfer.status === 'draft' && (
                  <>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => openCancelModal(selectedTransfer)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Cancel Transfer</span>
                    </button>
                    <button
                      type="button"
                      disabled={submitting || selectedTransfer.itemCount === 0}
                      onClick={() => openCompleteModal(selectedTransfer)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Complete Transfer</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setSelectedTransferId(null);
                    setDetailAddError(null);
                    setDetailAddSuccess(null);
                  }}
                  className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Complete Transfer Confirmation Modal */}
      {canOperate && confirmCompleteTransfer && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-transfer-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => {
              if (!submitting) {
                setConfirmCompleteId(null);
                setActionError(null);
              }
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h3 id="complete-transfer-modal-title" className="text-sm font-semibold text-slate-900">
                  Confirm Complete Transfer · {confirmCompleteTransfer.referenceCode}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Atomically deducts source stock and adds destination stock via{' '}
                  <span className="font-mono">public.complete_inventory_transfer</span>.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setConfirmCompleteId(null);
                  setActionError(null);
                }}
                aria-label="Close complete transfer dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Source Location</div>
                  <div className="mt-0.5 font-semibold text-slate-900">
                    {confirmCompleteTransfer.sourceLocationName} ({confirmCompleteTransfer.sourceLocationType})
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-slate-500">Destination Location</div>
                  <div className="mt-0.5 font-semibold text-slate-900">
                    {confirmCompleteTransfer.destinationLocationName} ({confirmCompleteTransfer.destinationLocationType})
                  </div>
                </div>
                {confirmCompleteTransfer.notes && (
                  <div className="sm:col-span-2">
                    <div className="text-[11px] font-medium text-slate-500">Notes</div>
                    <div className="mt-0.5 text-slate-700">{confirmCompleteTransfer.notes}</div>
                  </div>
                )}
              </div>

              {confirmCompleteTransfer.items.length === 0 ? (
                <div className="p-4 rounded-md border border-red-200 bg-red-50 text-red-700">
                  This transfer has zero items and cannot be completed.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2 px-3 whitespace-nowrap">Product</th>
                        <th className="py-2 px-3 whitespace-nowrap">Variant</th>
                        <th className="py-2 px-3 whitespace-nowrap">SKU</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Source Available</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Transfer Qty</th>
                        <th className="py-2 px-3 whitespace-nowrap">Unit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {confirmCompleteTransfer.items.map((item) => {
                        const available = getAvailableStock(
                          item.variantId,
                          confirmCompleteTransfer.sourceLocationId
                        );
                        const insufficient = item.quantity > available;

                        return (
                          <tr key={item.id}>
                            <td className="py-2.5 px-3 font-medium text-slate-900">
                              {item.productName}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">{item.variantName}</td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                              {item.sku}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                                insufficient ? 'text-red-700 font-semibold' : 'text-slate-600'
                              }`}
                            >
                              {formatQuantity(available)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-blue-700">
                              {formatQuantity(item.quantity)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {formatUnitOfMeasureLabel(item.unitOfMeasure)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {actionError && (
                <div
                  role="alert"
                  className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700"
                >
                  {actionError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setConfirmCompleteId(null);
                  setActionError(null);
                }}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={submitting || confirmCompleteTransfer.items.length === 0}
                aria-busy={submitting}
                onClick={() => void handleConfirmComplete()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                )}
                <span>{submitting ? 'Completing...' : 'Confirm & Complete Transfer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Transfer Confirmation Modal */}
      {canOperate && confirmCancelTransfer && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-transfer-modal-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => {
              if (!submitting) {
                setConfirmCancelId(null);
                setActionError(null);
              }
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 id="cancel-transfer-modal-title" className="text-sm font-semibold text-slate-900">
                  Cancel Draft Transfer · {confirmCancelTransfer.referenceCode}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cancels via <span className="font-mono">public.cancel_inventory_transfer</span>.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setConfirmCancelId(null);
                  setActionError(null);
                }}
                aria-label="Close cancel transfer dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-600">
                Are you sure you want to cancel draft transfer{' '}
                <strong className="font-mono text-slate-900">
                  {confirmCancelTransfer.referenceCode}
                </strong>{' '}
                ({confirmCancelTransfer.sourceLocationName} →{' '}
                {confirmCancelTransfer.destinationLocationName}, {confirmCancelTransfer.itemCount}{' '}
                {confirmCancelTransfer.itemCount === 1 ? 'item' : 'items'})? Cancelled transfers cannot be completed later.
              </p>

              {actionError && (
                <div
                  role="alert"
                  className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700"
                >
                  {actionError}
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setConfirmCancelId(null);
                    setActionError(null);
                  }}
                  className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Keep Draft
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  aria-busy={submitting}
                  onClick={() => void handleConfirmCancel()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-red-700 text-white text-xs font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                  )}
                  <span>{submitting ? 'Cancelling...' : 'Confirm Cancel Transfer'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

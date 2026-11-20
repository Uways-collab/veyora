import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Store,
  Warehouse,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  LOCATION_TYPE_OPTIONS,
  canManageInventoryLocations,
  createInventoryLocation,
  setLocationActiveStatus,
  updateInventoryLocation,
  type InventoryLocationRecord,
  type LocationTypeValue,
} from './inventoryService';

interface LocationsPanelProps {
  locations: InventoryLocationRecord[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}

type StatusFilter = 'all' | 'active' | 'archived';
type TypeFilter = 'all' | LocationTypeValue;

function formatShortDate(iso: string): string {
  if (!iso) return '—';
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

function LocationTypeIcon({ type }: { type: LocationTypeValue }) {
  if (type === 'store') {
    return <Store className="h-4 w-4" aria-hidden="true" />;
  }
  if (type === 'branch') {
    return <Building2 className="h-4 w-4" aria-hidden="true" />;
  }
  return <Warehouse className="h-4 w-4" aria-hidden="true" />;
}

export function LocationsPanel({
  locations,
  loading,
  error,
  onReload,
}: LocationsPanelProps) {
  const { status, activeOrganisation, activeMembership, activeRole } = useAuth();

  const activeOrgId =
    status === 'authenticated' &&
    activeOrganisation?.id &&
    activeMembership?.organisation_id === activeOrganisation.id
      ? activeOrganisation.id
      : null;

  const canManage = Boolean(activeOrgId && canManageInventoryLocations(activeRole));

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<InventoryLocationRecord | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<LocationTypeValue>('warehouse');
  const [formAddress, setFormAddress] = useState('');

  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archiveConfirmTarget, setArchiveConfirmTarget] =
    useState<InventoryLocationRecord | null>(null);
  const statusLockRef = useRef(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  const scopedLocations = useMemo(() => {
    if (!activeOrgId) return [];
    return locations.filter((loc) => loc.organizationId === activeOrgId);
  }, [locations, activeOrgId]);

  const filteredLocations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedLocations.filter((location) => {
      if (typeFilter !== 'all' && location.locationTypeValue !== typeFilter) {
        return false;
      }
      if (statusFilter === 'active' && !location.isActive) {
        return false;
      }
      if (statusFilter === 'archived' && location.isActive) {
        return false;
      }
      if (q && !location.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [scopedLocations, searchQuery, typeFilter, statusFilter]);

  useEffect(() => {
    setModalOpen(false);
    setArchiveConfirmTarget(null);
    setFeedback(null);
    setSearchQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
  }, [activeOrgId]);

  useEffect(() => {
    if (!modalOpen && !archiveConfirmTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalOpen && !submitting) {
        setModalOpen(false);
      }
      if (archiveConfirmTarget && !statusBusyId) {
        setArchiveConfirmTarget(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, submitting, archiveConfirmTarget, statusBusyId]);

  const openCreateModal = () => {
    if (!canManage || !activeOrgId) return;
    setEditingLocation(null);
    setFormName('');
    setFormType('warehouse');
    setFormAddress('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (location: InventoryLocationRecord) => {
    if (!canManage || !activeOrgId) return;
    setEditingLocation(location);
    setFormName(location.name);
    setFormType(location.locationTypeValue);
    setFormAddress(location.address ?? '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveLocation = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || !activeOrgId || submitLockRef.current || submitting) return;

    setFormError(null);
    const trimmedName = formName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      setFormError('Location name must be between 2 and 120 characters.');
      return;
    }

    const trimmedAddress = formAddress.trim();
    if (trimmedAddress.length > 500) {
      setFormError('Address cannot exceed 500 characters.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const payload = {
        name: trimmedName,
        locationType: formType,
        address: trimmedAddress || null,
      };

      if (editingLocation) {
        const { error: updateErr } = await updateInventoryLocation(
          activeOrgId,
          editingLocation.id,
          payload
        );
        if (updateErr) {
          setFormError(updateErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Location "${trimmedName}" updated.`,
        });
      } else {
        const { error: createErr } = await createInventoryLocation(activeOrgId, payload);
        if (createErr) {
          setFormError(createErr);
          return;
        }
        setModalOpen(false);
        setFeedback({
          kind: 'success',
          text: `Location "${trimmedName}" created.`,
        });
      }

      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmArchive = async () => {
    const target = archiveConfirmTarget;
    if (!target || !canManage || !activeOrgId || statusLockRef.current || statusBusyId) {
      return;
    }

    statusLockRef.current = true;
    setStatusBusyId(target.id);
    setFeedback(null);

    try {
      const { error: archiveErr } = await setLocationActiveStatus(
        activeOrgId,
        target.id,
        false
      );
      if (archiveErr) {
        setArchiveConfirmTarget(null);
        setFeedback({ kind: 'error', text: archiveErr });
        return;
      }

      setArchiveConfirmTarget(null);
      setFeedback({
        kind: 'success',
        text: `Location "${target.name}" archived.`,
      });
      await onReload();
    } finally {
      statusLockRef.current = false;
      setStatusBusyId(null);
    }
  };

  const handleRestoreLocation = async (location: InventoryLocationRecord) => {
    if (!canManage || !activeOrgId || statusLockRef.current || statusBusyId) return;

    statusLockRef.current = true;
    setStatusBusyId(location.id);
    setFeedback(null);

    try {
      const { error: restoreErr } = await setLocationActiveStatus(
        activeOrgId,
        location.id,
        true
      );
      if (restoreErr) {
        setFeedback({ kind: 'error', text: restoreErr });
        return;
      }

      setFeedback({
        kind: 'success',
        text: `Location "${location.name}" restored to active locations.`,
      });
      await onReload();
    } finally {
      statusLockRef.current = false;
      setStatusBusyId(null);
    }
  };

  if (!activeOrgId) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-600">
        Select an active authenticated business workspace to view inventory locations.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="bg-slate-100/80 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700">
          Read-only access: all workspace roles can view inventory locations, while only Owners and Admins can create, edit, archive, or restore locations.
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
            {feedback.kind === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
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
                Inventory Locations
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Warehouses, stores, and branches in <span className="font-mono">public.inventory_locations</span> for {activeOrganisation?.name ?? 'this organisation'}.
              </p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Location</span>
              </button>
            )}
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="locations-search" className="sr-only">
                Search by location name
              </label>
              <input
                id="locations-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by location name..."
                className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label htmlFor="locations-type-filter" className="sr-only">
                Filter by location type
              </label>
              <select
                id="locations-type-filter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All location types</option>
                {LOCATION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="locations-status-filter" className="sr-only">
                Filter by status
              </label>
              <select
                id="locations-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              >
                <option value="all">All statuses ({scopedLocations.length})</option>
                <option value="active">
                  Active only ({scopedLocations.filter((l) => l.isActive).length})
                </option>
                <option value="archived">
                  Archived ({scopedLocations.filter((l) => !l.isActive).length})
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
            Error loading inventory locations: {error}
          </div>
        ) : filteredLocations.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
              <MapPin className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="text-xs font-semibold text-slate-900">
              {scopedLocations.length === 0
                ? 'No inventory locations created yet'
                : 'No matching locations'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {scopedLocations.length === 0
                ? 'Add warehouses, stores, or branches where your organisation holds or distributes inventory.'
                : 'Adjust your search term, location type, or status filter to view matching locations.'}
            </p>
            {scopedLocations.length === 0 && canManage && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Location</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Location Name</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Type</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Address</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Created</th>
                  {canManage && (
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredLocations.map((location) => {
                  const isBusy = statusBusyId === location.id;
                  return (
                    <tr key={location.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 min-w-[200px]">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-500 shrink-0">
                            <LocationTypeIcon type={location.locationTypeValue} />
                          </span>
                          <span className="font-medium text-slate-900">{location.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {location.locationType}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-sm">
                        {location.address ? (
                          <span className="line-clamp-2">{location.address}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 font-medium ${
                            location.isActive ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${
                              location.isActive ? 'bg-emerald-600' : 'bg-slate-400'
                            }`}
                          />
                          <span>{location.isActive ? 'Active' : 'Archived'}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                        {formatShortDate(location.createdAt)}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => openEditModal(location)}
                              disabled={Boolean(statusBusyId)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:opacity-50"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                              <span>Edit</span>
                            </button>
                            {location.isActive ? (
                              <button
                                type="button"
                                onClick={() => setArchiveConfirmTarget(location)}
                                disabled={Boolean(statusBusyId)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                              >
                                <Archive className="h-3 w-3" aria-hidden="true" />
                                <span>Archive</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleRestoreLocation(location)}
                                disabled={Boolean(statusBusyId)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 disabled:opacity-50"
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                )}
                                <span>{isBusy ? 'Restoring...' : 'Restore'}</span>
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

      {/* Create / Edit Location Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="location-modal-title"
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
                <h3 id="location-modal-title" className="text-sm font-semibold text-slate-900">
                  {editingLocation ? 'Edit Location' : 'Add Inventory Location'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Saved to <span className="font-mono">public.inventory_locations</span> for{' '}
                  {activeOrganisation?.name ?? 'this organisation'}.
                </p>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                aria-label="Close location dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveLocation(e)} className="p-6 space-y-4">
              <fieldset disabled={submitting} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="location-name" className="block text-xs font-medium text-slate-700">
                    Location Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="location-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Lagos Main Warehouse"
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="location-type" className="block text-xs font-medium text-slate-700">
                    Location Type <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="location-type"
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as LocationTypeValue)}
                    className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  >
                    {LOCATION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="location-address"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Address (Optional)
                  </label>
                  <textarea
                    id="location-address"
                    rows={3}
                    maxLength={500}
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="Street address, city, or site notes"
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
                      ? editingLocation
                        ? 'Saving...'
                        : 'Creating...'
                      : editingLocation
                        ? 'Save Changes'
                        : 'Create Location'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Confirmation Modal */}
      {archiveConfirmTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-location-title"
        >
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => {
              if (!statusBusyId) setArchiveConfirmTarget(null);
            }}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 id="archive-location-title" className="text-sm font-semibold text-slate-900">
                  Archive Inventory Location
                </h3>
              </div>
              <button
                type="button"
                disabled={Boolean(statusBusyId)}
                onClick={() => setArchiveConfirmTarget(null)}
                aria-label="Close confirmation dialog"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-3 text-xs text-slate-600">
              <p>
                Are you sure you want to archive{' '}
                <strong className="font-semibold text-slate-900">
                  {archiveConfirmTarget.name}
                </strong>{' '}
                ({archiveConfirmTarget.locationType})?
              </p>
              <p>
                This sets <span className="font-mono text-slate-800">is_active = false</span> while preserving existing historical records. You can restore the location later if needed.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={Boolean(statusBusyId)}
                onClick={() => setArchiveConfirmTarget(null)}
                className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(statusBusyId)}
                aria-busy={Boolean(statusBusyId)}
                onClick={() => void handleConfirmArchive()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {statusBusyId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                ) : (
                  <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{statusBusyId ? 'Archiving...' : 'Archive Location'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

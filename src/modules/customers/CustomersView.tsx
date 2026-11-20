import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Edit3,
  Eye,
  Loader2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { CustomerDetailModal } from './CustomerDetailModal';
import { CustomerFormModal } from './CustomerFormModal';
import { archiveCustomer, searchCustomers } from './customersService';
import { canManageCustomers, type CustomerRecord } from './customersTypes';

export function CustomersView() {
  const { status, activeOrganisation, activeRole } = useAuth();
  const activeOrgId = activeOrganisation?.id ?? null;
  const timeZone = activeOrganisation?.timezone;
  const canManage = canManageCustomers(activeRole);

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [totalActiveCount, setTotalActiveCount] = useState<number>(0);
  const [totalHitLimit, setTotalHitLimit] = useState<boolean>(false);
  const [searchHitLimit, setSearchHitLimit] = useState<boolean>(false);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Modal state
  const [viewingCustomer, setViewingCustomer] = useState<CustomerRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [archivingCustomer, setArchivingCustomer] = useState<CustomerRecord | null>(null);
  const [archivingSubmitting, setArchivingSubmitting] = useState(false);

  const requestSeqRef = useRef(0);
  const archiveLockRef = useRef(false);

  const loadCustomers = useCallback(
    async (
      orgId: string,
      query: string,
      options?: { isManualRefresh?: boolean; refreshTotalIfFiltered?: boolean }
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
        const searchPromise = searchCustomers(orgId, trimmed, 100);
        const totalPromise =
          trimmed && options?.refreshTotalIfFiltered
            ? searchCustomers(orgId, '', 100)
            : null;

        const [result, totalResult] = await Promise.all([
          searchPromise,
          totalPromise ?? Promise.resolve(null),
        ]);

        if (seq !== requestSeqRef.current) return;

        if (result.error) {
          setLoadError(result.error);
          setCustomers([]);
          setSearchHitLimit(false);
          return;
        }

        setCustomers(result.customers);
        setSearchHitLimit(result.hitLimit);
        setAppliedSearch(trimmed);

        if (!trimmed) {
          setTotalActiveCount(result.customers.length);
          setTotalHitLimit(result.hitLimit);
        } else if (totalResult && !totalResult.error) {
          setTotalActiveCount(totalResult.customers.length);
          setTotalHitLimit(totalResult.hitLimit);
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

  // Reset state immediately when workspace changes and load active org's customers
  useEffect(() => {
    requestSeqRef.current += 1;
    setCustomers([]);
    setTotalActiveCount(0);
    setTotalHitLimit(false);
    setSearchHitLimit(false);
    setSearchInput('');
    setAppliedSearch('');
    setLoadError(null);
    setFeedback(null);
    setViewingCustomer(null);
    setFormOpen(false);
    setEditingCustomer(null);
    setArchivingCustomer(null);

    if (status === 'authenticated' && activeOrgId) {
      void loadCustomers(activeOrgId, '', { isManualRefresh: false });
    } else {
      setLoading(false);
    }
  }, [status, activeOrgId, loadCustomers]);

  // Debounced search via customers_v1_search
  useEffect(() => {
    if (status !== 'authenticated' || !activeOrgId) return;
    const trimmed = searchInput.trim();
    if (trimmed === appliedSearch) return;

    const timer = window.setTimeout(() => {
      void loadCustomers(activeOrgId, trimmed, { isManualRefresh: false });
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput, appliedSearch, status, activeOrgId, loadCustomers]);

  // Escape closes archive confirmation modal
  useEffect(() => {
    if (!archivingCustomer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !archivingSubmitting) {
        setArchivingCustomer(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [archivingCustomer, archivingSubmitting]);

  const handleManualRefresh = () => {
    if (!activeOrgId) return;
    setFeedback(null);
    void loadCustomers(activeOrgId, searchInput, {
      isManualRefresh: true,
      refreshTotalIfFiltered: true,
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId) return;
    void loadCustomers(activeOrgId, searchInput, { isManualRefresh: false });
  };

  const handleClearSearch = () => {
    setSearchInput('');
    if (activeOrgId) {
      void loadCustomers(activeOrgId, '', { isManualRefresh: false });
    }
  };

  const openCreateModal = () => {
    if (!canManage) return;
    setFeedback(null);
    setEditingCustomer(null);
    setFormOpen(true);
  };

  const openEditModal = (customer: CustomerRecord) => {
    if (!canManage) return;
    setFeedback(null);
    setEditingCustomer(customer);
    setFormOpen(true);
  };

  const openArchiveModal = (customer: CustomerRecord) => {
    if (!canManage) return;
    setFeedback(null);
    setArchivingCustomer(customer);
  };

  const handleFormSuccess = async (message: string) => {
    setFormOpen(false);
    setEditingCustomer(null);
    setFeedback({ type: 'success', message });
    if (activeOrgId) {
      await loadCustomers(activeOrgId, searchInput, {
        isManualRefresh: true,
        refreshTotalIfFiltered: true,
      });
    }
  };

  const handleConfirmArchive = async () => {
    if (!activeOrgId || !archivingCustomer || !canManage) return;
    if (archiveLockRef.current || archivingSubmitting) return;

    archiveLockRef.current = true;
    setArchivingSubmitting(true);
    setFeedback(null);

    const target = archivingCustomer;
    try {
      const result = await archiveCustomer(activeOrgId, target.id);
      if (result.error) {
        setArchivingCustomer(null);
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      setArchivingCustomer(null);
      if (viewingCustomer?.id === target.id) {
        setViewingCustomer(null);
      }
      setFeedback({
        type: 'success',
        message: `Customer "${target.name}" archived and removed from the active list.`,
      });
      await loadCustomers(activeOrgId, searchInput, {
        isManualRefresh: true,
        refreshTotalIfFiltered: true,
      });
    } finally {
      archiveLockRef.current = false;
      setArchivingSubmitting(false);
    }
  };

  const contactMetrics = useMemo(() => {
    let withPhone = 0;
    let withEmail = 0;
    for (const c of customers) {
      if (c.phone) withPhone += 1;
      if (c.email) withEmail += 1;
    }
    return { withPhone, withEmail };
  }, [customers]);

  const isInitialLoading = loading && !refreshing;
  const hasSearchFilter = appliedSearch.length > 0;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <section
        aria-labelledby="customers-heading"
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 pb-6"
      >
        <div className="space-y-1.5 min-w-0">
          <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{activeOrganisation?.name ?? 'Business Workspace'}</span>
            <span aria-hidden="true">·</span>
            <span>
              Role: <span className="capitalize text-slate-700">{activeRole ?? 'staff'}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {totalActiveCount}
              {totalHitLimit ? '+' : ''} active {totalActiveCount === 1 ? 'customer' : 'customers'}
            </span>
          </div>
          <h1
            id="customers-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Customers
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Manage active customer records, contact information, and directory notes for{' '}
            {activeOrganisation?.name ?? 'your workspace'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              disabled={!activeOrgId}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Customer</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={!activeOrgId || loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      {/* Mutation Feedback Banner */}
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
              <div className="font-semibold">Unable to load customer records</div>
              <div className="text-amber-800">{loadError}</div>
            </div>
          </div>
          {activeOrgId && (
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

      {/* Summary Strip */}
      <section aria-labelledby="customers-summary-heading" className="space-y-3">
        <h2 id="customers-summary-heading" className="text-sm font-semibold text-slate-900">
          Directory Summary
        </h2>
        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Total Active Customers</span>
              <Users className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading && !hasSearchFilter ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {totalActiveCount}
                  {totalHitLimit ? '+' : ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {totalHitLimit
                    ? 'Showing up to 100 active records'
                    : 'Active in current organization'}
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">With Phone Number</span>
              <Phone className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {contactMetrics.withPhone}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {hasSearchFilter ? 'In current search results' : 'Reachable by phone'}
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">With Email Address</span>
              <Mail className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            {isInitialLoading ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div>
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  {contactMetrics.withEmail}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {hasSearchFilter ? 'In current search results' : 'Reachable by email'}
                </div>
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Role Permissions</span>
              <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {canManage ? 'View & Manage' : 'View & Search Only'}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {canManage
                  ? 'Create, edit, and archive enabled'
                  : 'Contact an Owner, Admin, or Manager to modify records'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Customer Directory Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Active Customers</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Search active customers by full name, phone number, or email address. Archived customers are excluded from this list.
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
                placeholder="Search name, phone, or email..."
                aria-label="Search customers by name, phone, or email"
                className="w-full pl-8 pr-8 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!activeOrgId || loading}
              className="px-3 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Search
            </button>
          </form>
        </div>

        {/* Result Status Bar */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">
            {loading
              ? 'Loading customers...'
              : hasSearchFilter
                ? `${customers.length}${searchHitLimit ? '+' : ''} matching "${appliedSearch}"`
                : `${customers.length}${searchHitLimit ? '+' : ''} active ${customers.length === 1 ? 'customer' : 'customers'}`}
          </span>
          <span>Maximum 100 results per query</span>
        </div>

        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
            <div className="h-11 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : loadError && customers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-amber-600 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">Could not load customers</div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</p>
          </div>
        ) : customers.length === 0 ? (
          hasSearchFilter ? (
            <div className="p-10 text-center space-y-3">
              <Search className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">
                  No customers match &ldquo;{appliedSearch}&rdquo;
                </div>
                <p className="text-xs text-slate-500">
                  Try another name, phone number, or email address, or clear the search filter.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearSearch}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div className="p-10 text-center space-y-3">
              <Users className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-900">No customers yet</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {canManage
                    ? 'Add your first customer to keep contact details, addresses, and account notes organized for your business.'
                    : 'No active customer records exist in this workspace yet. An Organization Owner, Admin, or Manager can add customers.'}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add First Customer</span>
                </button>
              )}
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Name</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Phone</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Email</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{customer.name}</div>
                      {customer.address && (
                        <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">
                          {customer.address}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {customer.phone ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-700 break-all">
                      {customer.email ?? '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="text-xs font-medium text-emerald-700">Active</span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setViewingCustomer(customer)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          <span>View</span>
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(customer)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Edit3 className="h-3 w-3" aria-hidden="true" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openArchiveModal(customer)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-600 hover:text-amber-800 hover:border-amber-300 whitespace-nowrap"
                            >
                              <Archive className="h-3 w-3" aria-hidden="true" />
                              <span>Archive</span>
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

      {/* View Customer Modal */}
      <CustomerDetailModal
        customer={viewingCustomer}
        timeZone={timeZone}
        canManage={canManage}
        onClose={() => setViewingCustomer(null)}
        onEdit={openEditModal}
        onArchive={openArchiveModal}
      />

      {/* Create / Edit Customer Modal */}
      {activeOrgId && canManage && (
        <CustomerFormModal
          open={formOpen}
          organisationId={activeOrgId}
          customer={editingCustomer}
          onClose={() => {
            setFormOpen(false);
            setEditingCustomer(null);
          }}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Archive Confirmation Modal */}
      {archivingCustomer && canManage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-customer-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 id="archive-customer-title" className="text-sm font-semibold text-slate-900">
                Archive Customer
              </h2>
              <button
                type="button"
                onClick={() => setArchivingCustomer(null)}
                disabled={archivingSubmitting}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-2.5 leading-relaxed">
              <p>
                Archive{' '}
                <span className="font-semibold text-slate-900">{archivingCustomer.name}</span>?
              </p>
              <p>
                Archived customers are removed from the active customer directory without deleting historical business records.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchivingCustomer(null)}
                disabled={archivingSubmitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={archivingSubmitting}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50"
              >
                {archivingSubmitting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                <span>{archivingSubmitting ? 'Archiving...' : 'Archive Customer'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

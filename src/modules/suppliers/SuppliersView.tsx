import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { SuppliersPanel } from '../purchases/SuppliersPanel';
import { canManageSuppliers } from '../purchases/suppliersTypes';

export function SuppliersView() {
  const { status, activeMembership, activeOrganisation, activeRole } = useAuth();
  const activeOrgId = activeMembership?.organisation_id ?? activeOrganisation?.id ?? null;
  const effectiveRole = activeMembership?.role ?? activeRole;
  const timeZone = activeOrganisation?.timezone;
  const canManage = canManageSuppliers(effectiveRole);
  const isAuthenticated = status === 'authenticated';

  const [createSignal, setCreateSignal] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section
        aria-labelledby="suppliers-heading"
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5"
      >
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>Operations</span>
            <span aria-hidden="true">·</span>
            <span>Suppliers Directory</span>
            <span aria-hidden="true">·</span>
            <span>
              Role: <span className="capitalize text-slate-700">{effectiveRole ?? 'staff'}</span>
            </span>
          </div>
          <h1
            id="suppliers-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Suppliers
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Manage active and archived supplier accounts, contact details, and payment terms for{' '}
            {activeOrganisation?.name ?? 'your workspace'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canManage && (
            <button
              type="button"
              onClick={() => setCreateSignal((prev) => prev + 1)}
              disabled={!activeOrgId || !isAuthenticated}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Supplier</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setRefreshSignal((prev) => prev + 1)}
            disabled={!activeOrgId || !isAuthenticated || isRefreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      {/* Reused Suppliers Directory Implementation */}
      <SuppliersPanel
        organisationId={activeOrgId}
        organisationName={activeOrganisation?.name}
        timeZone={timeZone}
        canManage={canManage}
        isAuthenticated={isAuthenticated}
        externalCreateSignal={createSignal}
        externalRefreshSignal={refreshSignal}
        onRefreshingChange={setIsRefreshing}
      />
    </div>
  );
}

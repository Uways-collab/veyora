import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { PurchasesListPanel } from './PurchasesListPanel';
import { canManagePurchases } from './purchasesTypes';
import { SuppliersPanel } from './SuppliersPanel';
import { canManageSuppliers } from './suppliersTypes';

type PurchasesTab = 'orders' | 'suppliers';

export function PurchasesView() {
  const { status, activeOrganisation, activeRole } = useAuth();
  const activeOrgId = activeOrganisation?.id ?? null;
  const currencyCode = activeOrganisation?.base_currency ?? 'USD';
  const timeZone = activeOrganisation?.timezone;
  const canManageOrders = canManagePurchases(activeRole);
  const canManageVendorDirectory = canManageSuppliers(activeRole);
  const isAuthenticated = status === 'authenticated';

  const [activeTab, setActiveTab] = useState<PurchasesTab>('orders');

  const [createOrderSignal, setCreateOrderSignal] = useState(0);
  const [refreshOrdersSignal, setRefreshOrdersSignal] = useState(0);
  const [isOrdersRefreshing, setIsOrdersRefreshing] = useState(false);

  const [createSupplierSignal, setCreateSupplierSignal] = useState(0);
  const [refreshSuppliersSignal, setRefreshSuppliersSignal] = useState(0);
  const [isSuppliersRefreshing, setIsSuppliersRefreshing] = useState(false);

  const isOrdersTab = activeTab === 'orders';
  const isRefreshing = isOrdersTab ? isOrdersRefreshing : isSuppliersRefreshing;
  const canCreateInActiveTab = isOrdersTab ? canManageOrders : canManageVendorDirectory;

  const handlePrimaryCreate = () => {
    if (isOrdersTab) {
      setCreateOrderSignal((prev) => prev + 1);
    } else {
      setCreateSupplierSignal((prev) => prev + 1);
    }
  };

  const handleHeaderRefresh = () => {
    if (isOrdersTab) {
      setRefreshOrdersSignal((prev) => prev + 1);
    } else {
      setRefreshSuppliersSignal((prev) => prev + 1);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section
        aria-labelledby="purchases-heading"
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5"
      >
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>Operations</span>
            <span aria-hidden="true">·</span>
            <span>{isOrdersTab ? 'Purchase Orders' : 'Suppliers'}</span>
            <span aria-hidden="true">·</span>
            <span>Currency: {currencyCode}</span>
          </div>
          <h1
            id="purchases-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Purchases
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Prepare purchase drafts, confirm supplier purchase orders, and manage vendor contacts for{' '}
            {activeOrganisation?.name ?? 'your workspace'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {canCreateInActiveTab && (
            <button
              type="button"
              onClick={handlePrimaryCreate}
              disabled={!activeOrgId || !isAuthenticated}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isOrdersTab ? 'New Purchase Draft' : 'Add Supplier'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleHeaderRefresh}
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

      {/* Module Section Tabs */}
      <div
        role="tablist"
        aria-label="Purchases sections"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        <button
          type="button"
          role="tab"
          aria-selected={isOrdersTab}
          onClick={() => setActiveTab('orders')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            isOrdersTab
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Purchase Orders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isOrdersTab}
          onClick={() => setActiveTab('suppliers')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            !isOrdersTab
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Suppliers
        </button>
      </div>

      {/* Active Section */}
      {isOrdersTab ? (
        <PurchasesListPanel
          organisationId={activeOrgId}
          organisationName={activeOrganisation?.name}
          currencyCode={currencyCode}
          timeZone={timeZone}
          canManage={canManageOrders}
          isAuthenticated={isAuthenticated}
          externalCreateSignal={createOrderSignal}
          externalRefreshSignal={refreshOrdersSignal}
          onRefreshingChange={setIsOrdersRefreshing}
          onSwitchToSuppliers={() => setActiveTab('suppliers')}
        />
      ) : (
        <SuppliersPanel
          organisationId={activeOrgId}
          organisationName={activeOrganisation?.name}
          timeZone={timeZone}
          canManage={canManageVendorDirectory}
          isAuthenticated={isAuthenticated}
          externalCreateSignal={createSupplierSignal}
          externalRefreshSignal={refreshSuppliersSignal}
          onRefreshingChange={setIsSuppliersRefreshing}
        />
      )}
    </div>
  );
}

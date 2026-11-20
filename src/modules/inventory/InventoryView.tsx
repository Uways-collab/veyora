import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Boxes,
  FolderTree,
  MapPin,
  PackageX,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import type { ModuleId } from '../../core/types/domain';
import { CategoriesPanel } from './CategoriesPanel';
import { LocationsPanel } from './LocationsPanel';
import { ProductsPanel } from './ProductsPanel';
import { StockAdjustmentsPanel } from './StockAdjustmentsPanel';
import { StockBalancesPanel, type StockStatusFilter } from './StockBalancesPanel';
import { StockTransfersPanel } from './StockTransfersPanel';
import {
  canManageInventoryCatalog,
  fetchInventoryOverview,
  summarizeReplenishmentAlerts,
  type InventoryOverviewData,
} from './inventoryService';

type InventoryTab =
  | 'overview'
  | 'products'
  | 'categories'
  | 'locations'
  | 'balances'
  | 'adjustments'
  | 'transfers';

const EMPTY_OVERVIEW: InventoryOverviewData = {
  products: [],
  categories: [],
  variants: [],
  locations: [],
  balances: [],
  movements: [],
  transfers: [],
  activeProductCount: 0,
  activeCategoryCount: 0,
  activeLocationCount: 0,
  errors: {
    products: null,
    categories: null,
    variants: null,
    locations: null,
    balances: null,
    movements: null,
    transfers: null,
  },
};

function StatusIndicator({ active, archivedLabel = 'Inactive' }: { active: boolean; archivedLabel?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        active ? 'text-emerald-700' : 'text-slate-500'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          active ? 'bg-emerald-600' : 'bg-slate-400'
        }`}
      />
      <span>{active ? 'Active' : archivedLabel}</span>
    </span>
  );
}

interface InventoryViewProps {
  onSelectModule?: (moduleId: ModuleId) => void;
}

export function InventoryView({ onSelectModule }: InventoryViewProps) {
  const { status, activeOrganisation, activeRole } = useAuth();
  const activeOrgId = activeOrganisation?.id ?? null;
  const canManage = canManageInventoryCatalog(activeRole);

  const [activeTab, setActiveTab] = useState<InventoryTab>('overview');
  const [balancesInitialFilter, setBalancesInitialFilter] =
    useState<StockStatusFilter>('all');
  const [balancesFilterNonce, setBalancesFilterNonce] = useState(0);
  const [data, setData] = useState<InventoryOverviewData>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadInventory = useCallback(
    async (orgId: string, isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await fetchInventoryOverview(orgId);
        setData(result);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (status === 'authenticated' && activeOrgId) {
      void loadInventory(activeOrgId, false);
    } else {
      setData(EMPTY_OVERVIEW);
      setLoading(false);
    }
  }, [status, activeOrgId, loadInventory]);

  const handleReload = useCallback(async () => {
    if (activeOrgId) {
      await loadInventory(activeOrgId, true);
    }
  }, [activeOrgId, loadInventory]);

  const errorMessages = [
    data.errors.products ? `Products: ${data.errors.products}` : null,
    data.errors.categories ? `Categories: ${data.errors.categories}` : null,
    data.errors.variants ? `Product variants: ${data.errors.variants}` : null,
    data.errors.locations ? `Locations: ${data.errors.locations}` : null,
    data.errors.balances ? `Stock balances: ${data.errors.balances}` : null,
    data.errors.movements ? `Stock movements: ${data.errors.movements}` : null,
    data.errors.transfers ? `Stock transfers: ${data.errors.transfers}` : null,
  ].filter((msg): msg is string => Boolean(msg));

  const isInitialLoading = loading && !refreshing;
  const replenishmentSummary = summarizeReplenishmentAlerts(data.balances);

  const openFilteredBalances = (filter: StockStatusFilter) => {
    setBalancesInitialFilter(filter);
    setBalancesFilterNonce((n) => n + 1);
    setActiveTab('balances');
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <section
        aria-labelledby="inventory-heading"
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
            <span>{canManage ? 'Catalog Management' : 'Read-Only Access'}</span>
          </div>
          <h1
            id="inventory-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Inventory
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Manage products, variants, hierarchical categories, and inventory locations for {activeOrganisation?.name ?? 'your workspace'}, scoped to your active organisation via Supabase Row Level Security.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (onSelectModule) {
                onSelectModule('reports');
              } else {
                try {
                  window.location.hash = '#/reports';
                } catch {
                  // ignore hash write errors
                }
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <BarChart3 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>Reports</span>
          </button>
          <button
            type="button"
            onClick={() => void handleReload()}
            disabled={!activeOrgId || loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </section>

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Inventory sections"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'products', label: `Products (${data.products.length})` },
            { id: 'categories', label: `Categories (${data.categories.length})` },
            { id: 'locations', label: `Locations (${data.locations.length})` },
            { id: 'balances', label: `Stock Balances (${data.balances.length})` },
            { id: 'adjustments', label: `Stock Adjustments (${data.movements.length})` },
            { id: 'transfers', label: `Stock Transfers (${data.transfers.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error State Banner */}
      {errorMessages.length > 0 && (
        <section
          role="alert"
          className="bg-amber-50/80 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <div className="font-semibold">
                Unable to load all inventory records
              </div>
              <ul className="space-y-0.5 text-amber-800">
                {errorMessages.map((msg) => (
                  <li key={msg} className="font-mono text-[11px] break-words">
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {activeOrgId && (
            <button
              type="button"
              onClick={() => void handleReload()}
              className="px-3 py-1.5 rounded-md border border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-50 whitespace-nowrap shrink-0 self-start"
            >
              Retry
            </button>
          )}
        </section>
      )}

      {/* Tab 1: Preserved Inventory Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <section aria-labelledby="inventory-summary-heading" className="space-y-3">
            <h2 id="inventory-summary-heading" className="text-sm font-semibold text-slate-900">
              Inventory Summary
            </h2>

            <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              {/* Total Active Products */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Total Active Products
                  </span>
                  <Boxes className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                      {data.activeProductCount}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {data.products.length} total catalog{' '}
                        {data.products.length === 1 ? 'product' : 'products'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('products')}
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Total Active Categories */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Total Active Categories
                  </span>
                  <FolderTree className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                      {data.activeCategoryCount}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {data.categories.length} total{' '}
                        {data.categories.length === 1 ? 'category' : 'categories'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('categories')}
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Total Active Inventory Locations */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Total Active Locations
                  </span>
                  <MapPin className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                      {data.activeLocationCount}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {data.locations.length} total inventory{' '}
                        {data.locations.length === 1 ? 'location' : 'locations'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('locations')}
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Stock & Replenishment Alerts Summary */}
          <section aria-labelledby="inventory-replenishment-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="inventory-replenishment-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Stock &amp; Replenishment Alerts
              </h2>
              <button
                type="button"
                onClick={() => openFilteredBalances('all')}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
              >
                View all stock balances
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              {/* Low-stock count */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Low-Stock Items
                  </span>
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-amber-700 tabular-nums">
                      {replenishmentSummary.lowStockCount}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>0 &lt; qty &le; reorder level</span>
                      <button
                        type="button"
                        onClick={() => openFilteredBalances('low_stock')}
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        View low stock
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Out-of-stock count */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Out-of-Stock Items
                  </span>
                  <PackageX className="h-4 w-4 text-red-600 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-red-700 tabular-nums">
                      {replenishmentSummary.outOfStockCount}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>Zero quantity available</span>
                      <button
                        type="button"
                        onClick={() => openFilteredBalances('out_of_stock')}
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        View out of stock
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Items needing replenishment */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Items Needing Replenishment
                  </span>
                  <BellRing className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-24 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                      {replenishmentSummary.needingReplenishmentCount}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>Low-stock + out-of-stock</span>
                      <button
                        type="button"
                        onClick={() =>
                          openFilteredBalances(
                            replenishmentSummary.lowStockCount > 0
                              ? 'low_stock'
                              : replenishmentSummary.outOfStockCount > 0
                                ? 'out_of_stock'
                                : 'all'
                          )
                        }
                        className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        Review alerts
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Products List (7 columns) */}
            <section
              aria-labelledby="inventory-products-heading"
              className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <h2 id="inventory-products-heading" className="text-sm font-semibold text-slate-900">
                    Products
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Registered catalog items from <span className="font-mono">public.products</span>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('products')}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                >
                  Open catalog
                </button>
              </div>

              {isInitialLoading ? (
                <div className="p-5 space-y-2.5" aria-busy="true">
                  <div className="h-9 bg-slate-100 rounded animate-pulse" />
                  <div className="h-9 bg-slate-100 rounded animate-pulse" />
                  <div className="h-9 bg-slate-100 rounded animate-pulse" />
                </div>
              ) : data.errors.products ? (
                <div className="p-6 text-xs text-slate-600 text-center">
                  Unable to display products because the <span className="font-mono">public.products</span> query returned an error above.
                </div>
              ) : data.products.length === 0 ? (
                <div className="p-8 text-center space-y-1">
                  <div className="text-xs font-semibold text-slate-900">
                    No products found
                  </div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    There are no products recorded for {activeOrganisation?.name ?? 'this organisation'} yet.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-4 whitespace-nowrap">Product Name</th>
                        <th className="py-2.5 px-4 whitespace-nowrap">Product Type</th>
                        <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {data.products.map((product) => (
                        <tr key={product.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900">
                            {product.name}
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {product.productType}
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {product.categoryPath}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <StatusIndicator active={product.isActive} archivedLabel="Archived" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Inventory Locations List (5 columns) */}
            <section
              aria-labelledby="inventory-locations-heading"
              className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <h2 id="inventory-locations-heading" className="text-sm font-semibold text-slate-900">
                    Inventory Locations
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Storage sites from <span className="font-mono">public.inventory_locations</span>.
                  </p>
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <span className="text-xs font-mono text-slate-500">
                    {data.locations.length} {data.locations.length === 1 ? 'location' : 'locations'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('locations')}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800"
                  >
                    Manage
                  </button>
                </div>
              </div>

              {isInitialLoading ? (
                <div className="p-5 space-y-2.5" aria-busy="true">
                  <div className="h-9 bg-slate-100 rounded animate-pulse" />
                  <div className="h-9 bg-slate-100 rounded animate-pulse" />
                  <div className="h-9 bg-slate-100 rounded animate-pulse" />
                </div>
              ) : data.errors.locations ? (
                <div className="p-6 text-xs text-slate-600 text-center">
                  Unable to display locations because the <span className="font-mono">public.inventory_locations</span> query returned an error above.
                </div>
              ) : data.locations.length === 0 ? (
                <div className="p-8 text-center space-y-1">
                  <div className="text-xs font-semibold text-slate-900">
                    No inventory locations found
                  </div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    There are no inventory locations configured for {activeOrganisation?.name ?? 'this organisation'} yet.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                        <th className="py-2.5 px-4 whitespace-nowrap">Location Name</th>
                        <th className="py-2.5 px-4 whitespace-nowrap">Location Type</th>
                        <th className="py-2.5 px-4 text-right whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {data.locations.map((location) => (
                        <tr key={location.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4 font-medium text-slate-900">
                            {location.name}
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {location.locationType}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <StatusIndicator active={location.isActive} archivedLabel="Archived" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Tab 2: Products Management */}
      {activeTab === 'products' && activeOrgId && (
        <ProductsPanel
          organisationId={activeOrgId}
          products={data.products}
          categories={data.categories}
          variants={data.variants}
          variantsError={data.errors.variants}
          currencyCode={activeOrganisation?.base_currency ?? 'USD'}
          canManage={canManage}
          loading={isInitialLoading}
          error={data.errors.products}
          onReload={handleReload}
        />
      )}

      {/* Tab 3: Categories & Subcategories Management */}
      {activeTab === 'categories' && activeOrgId && (
        <CategoriesPanel
          organisationId={activeOrgId}
          categories={data.categories}
          products={data.products}
          canManage={canManage}
          loading={isInitialLoading}
          error={data.errors.categories}
          onReload={handleReload}
        />
      )}

      {/* Tab 4: Locations Management */}
      {activeTab === 'locations' && activeOrgId && (
        <LocationsPanel
          locations={data.locations}
          loading={isInitialLoading}
          error={data.errors.locations}
          onReload={handleReload}
        />
      )}

      {/* Tab 5: Stock Balances, Alerts & Reorder Levels */}
      {activeTab === 'balances' && activeOrgId && (
        <StockBalancesPanel
          balances={data.balances}
          products={data.products}
          variants={data.variants}
          locations={data.locations}
          loading={isInitialLoading}
          refreshing={refreshing}
          error={data.errors.balances}
          initialStatusFilter={balancesInitialFilter}
          initialFilterNonce={balancesFilterNonce}
          onReload={handleReload}
        />
      )}

      {/* Tab 6: Opening Stock & Stock Adjustments */}
      {activeTab === 'adjustments' && activeOrgId && (
        <StockAdjustmentsPanel
          products={data.products}
          variants={data.variants}
          locations={data.locations}
          balances={data.balances}
          movements={data.movements}
          loading={isInitialLoading}
          refreshing={refreshing}
          error={data.errors.movements}
          onReload={handleReload}
        />
      )}

      {/* Tab 7: Stock Transfers */}
      {activeTab === 'transfers' && activeOrgId && (
        <StockTransfersPanel
          transfers={data.transfers}
          products={data.products}
          variants={data.variants}
          locations={data.locations}
          balances={data.balances}
          loading={isInitialLoading}
          refreshing={refreshing}
          error={data.errors.transfers}
          onReload={handleReload}
        />
      )}
    </div>
  );
}

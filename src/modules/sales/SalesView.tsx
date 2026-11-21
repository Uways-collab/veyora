import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  History,
  PlusCircle,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  getDefaultReceiptSettings,
  getOrganizationReceiptSettings,
  subscribeReceiptSettingsUpdates,
} from '../../core/receipts/receiptSettingsService';
import type { ReceiptSettings } from '../../core/receipts/receiptSettingsTypes';
import type { ModuleId } from '../../core/types/domain';
import { formatMoneyAmount } from '../inventory/inventoryService';
import { OutstandingBalancesPanel } from './OutstandingBalancesPanel';
import { PaymentMethodsPanel } from './PaymentMethodsPanel';
import { PosCheckoutPanel } from './PosCheckoutPanel';
import { SaleReceiptModal } from './SaleReceiptModal';
import { SalesHistoryPanel } from './SalesHistoryPanel';
import { SalesReturnsPanel } from './SalesReturnsPanel';
import {
  formatPaymentStatusLabel,
  formatSaleStatusLabel,
  formatSalesShortDate,
  roundMoney,
} from './salesFormatters';
import { buildEmptySalesModuleData, fetchSalesModuleData } from './salesService';
import {
  canConfigurePaymentMethods,
  canManageReturnsAndCancellations,
  type SaleRecord,
  type SalesModuleData,
} from './salesTypes';

type SalesTab =
  | 'overview'
  | 'pos'
  | 'history'
  | 'outstanding'
  | 'returns'
  | 'payment_methods';

interface SalesViewProps {
  onSelectModule?: (moduleId: ModuleId) => void;
}

export function SalesView({ onSelectModule }: SalesViewProps) {
  const { status, activeOrganisation, activeRole } = useAuth();
  const activeOrgId = activeOrganisation?.id ?? null;
  const currencyCode = activeOrganisation?.base_currency ?? 'USD';
  const timeZone = activeOrganisation?.timezone;

  const canManageReturns = canManageReturnsAndCancellations(activeRole);
  const canConfigureMethods = canConfigurePaymentMethods(activeRole);

  const [activeTab, setActiveTab] = useState<SalesTab>('overview');
  const [data, setData] = useState<SalesModuleData>(() => buildEmptySalesModuleData());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(() =>
    getDefaultReceiptSettings()
  );

  useEffect(() => {
    if (activeTab === 'returns' && !canManageReturns) {
      setActiveTab('overview');
    } else if (activeTab === 'payment_methods' && !canConfigureMethods) {
      setActiveTab('overview');
    }
  }, [activeTab, canManageReturns, canConfigureMethods]);

  const loadSales = useCallback(
    async (orgId: string, isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await fetchSalesModuleData(orgId, currencyCode);
        setData(result);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [currencyCode]
  );

  useEffect(() => {
    if (status === 'authenticated' && activeOrgId) {
      void loadSales(activeOrgId, false);
    } else {
      setData(buildEmptySalesModuleData());
      setLoading(false);
    }
  }, [status, activeOrgId, loadSales]);

  useEffect(() => {
    if (status !== 'authenticated' || !activeOrganisation) {
      setReceiptSettings(getDefaultReceiptSettings());
      return;
    }

    setReceiptSettings(getOrganizationReceiptSettings(activeOrganisation));

    const unsubscribe = subscribeReceiptSettingsUpdates(activeOrganisation.id, (next) => {
      setReceiptSettings(next);
    });

    return () => {
      unsubscribe();
    };
  }, [status, activeOrganisation]);

  const handleReload = useCallback(async () => {
    if (activeOrgId) {
      await loadSales(activeOrgId, true);
    }
  }, [activeOrgId, loadSales]);

  const errorMessages = [
    data.errors.sales ? `Sales: ${data.errors.sales}` : null,
    data.errors.saleItems ? `Sale items: ${data.errors.saleItems}` : null,
    data.errors.salePayments ? `Sale payments: ${data.errors.salePayments}` : null,
    data.errors.returns ? `Returns: ${data.errors.returns}` : null,
    data.errors.returnItems ? `Return items: ${data.errors.returnItems}` : null,
    data.errors.refunds ? `Refunds: ${data.errors.refunds}` : null,
    data.errors.paymentMethods ? `Payment methods: ${data.errors.paymentMethods}` : null,
    data.errors.catalog ? `Catalog / Inventory: ${data.errors.catalog}` : null,
  ].filter((msg): msg is string => Boolean(msg));

  const isInitialLoading = loading && !refreshing;

  const kpiSummary = useMemo(() => {
    const completedSales = data.sales.filter((s) => s.status === 'completed');
    const cancelledSales = data.sales.filter((s) => s.status === 'cancelled');

    const totalSalesAmount = roundMoney(
      completedSales.reduce((sum, s) => sum + s.totalAmount, 0)
    );
    const totalCollected = roundMoney(
      completedSales.reduce((sum, s) => sum + s.paidAmount, 0)
    );
    const outstandingCredit = roundMoney(
      completedSales.reduce((sum, s) => sum + s.outstandingAmount, 0)
    );
    const openCreditCount = completedSales.filter((s) => s.outstandingAmount > 0).length;

    return {
      totalSalesAmount,
      totalCollected,
      outstandingCredit,
      openCreditCount,
      completedCount: completedSales.length,
      cancelledCount: cancelledSales.length,
    };
  }, [data.sales]);

  const recentSales = useMemo(() => data.sales.slice(0, 10), [data.sales]);
  const receiptSale = useMemo(
    () => (receiptSaleId ? (data.sales.find((s) => s.id === receiptSaleId) ?? null) : null),
    [data.sales, receiptSaleId]
  );

  const visibleTabs = useMemo(() => {
    const tabs: Array<{ id: SalesTab; label: string }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'pos', label: 'POS Checkout' },
      { id: 'history', label: `Sales History (${data.sales.length})` },
      { id: 'outstanding', label: 'Outstanding Balances' },
    ];
    if (canManageReturns) {
      tabs.push({ id: 'returns', label: `Returns & Refunds (${data.returns.length})` });
    }
    if (canConfigureMethods) {
      tabs.push({
        id: 'payment_methods',
        label: `Payment Methods (${data.paymentMethods.length})`,
      });
    }
    return tabs;
  }, [
    data.sales.length,
    data.returns.length,
    data.paymentMethods.length,
    canManageReturns,
    canConfigureMethods,
  ]);

  const handleOpenReceipt = useCallback((sale: SaleRecord) => {
    setReceiptSaleId(sale.id);
  }, []);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <section
        aria-labelledby="sales-heading"
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
            <span>Currency: {currencyCode}</span>
          </div>
          <h1
            id="sales-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Sales &amp; POS
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Process point-of-sale checkouts, collect split or follow-up credit payments, issue receipts, and manage returns for {activeOrganisation?.name ?? 'your workspace'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
          >
            <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Sale</span>
          </button>
          {onSelectModule && (
            <button
              type="button"
              onClick={() => onSelectModule('inventory')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Inventory</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleReload()}
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

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Sales sections"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        {visibleTabs.map((tab) => (
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
              <div className="font-semibold">Unable to load all sales records</div>
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

      {/* Tab 1: Sales Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <section aria-labelledby="sales-summary-heading" className="space-y-3">
            <h2 id="sales-summary-heading" className="text-sm font-semibold text-slate-900">
              Sales Summary
            </h2>

            <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              {/* Total Sales */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Total Sales</span>
                  <TrendingUp className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-24 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                      {formatMoneyAmount(kpiSummary.totalSalesAmount, currencyCode)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Across {kpiSummary.completedCount} completed{' '}
                      {kpiSummary.completedCount === 1 ? 'sale' : 'sales'}
                    </div>
                  </div>
                )}
              </div>

              {/* Amount Collected */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Amount Collected</span>
                  <Banknote className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-24 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
                      {formatMoneyAmount(kpiSummary.totalCollected, currencyCode)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Checkout &amp; follow-up payments
                    </div>
                  </div>
                )}
              </div>

              {/* Outstanding Credit */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Outstanding Credit</span>
                  <CreditCard className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-24 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-amber-700 tabular-nums">
                      {formatMoneyAmount(kpiSummary.outstandingCredit, currencyCode)}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {kpiSummary.openCreditCount} open credit{' '}
                        {kpiSummary.openCreditCount === 1 ? 'sale' : 'sales'}
                      </span>
                      {kpiSummary.openCreditCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('outstanding')}
                          className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                        >
                          Collect
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Transactions */}
              <div className="p-5 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">Transactions</span>
                  <ShoppingBag className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                </div>
                {isInitialLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    <div className="h-7 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3.5 w-28 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div>
                    <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                      {kpiSummary.completedCount}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {kpiSummary.cancelledCount} cancelled{' '}
                      {kpiSummary.cancelledCount === 1 ? 'sale' : 'sales'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Quick Actions */}
          <section aria-labelledby="sales-actions-heading" className="space-y-3">
            <h2 id="sales-actions-heading" className="text-sm font-semibold text-slate-900">
              Quick Actions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="p-4 bg-white border border-slate-200 rounded-lg text-left hover:border-blue-300 transition-colors flex items-start gap-3"
              >
                <PlusCircle className="h-4 w-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Open POS Checkout</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Create a new retail or service sale
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="p-4 bg-white border border-slate-200 rounded-lg text-left hover:border-blue-300 transition-colors flex items-start gap-3"
              >
                <History className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">Sales History</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Receipts and follow-up payments
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('outstanding')}
                className="p-4 bg-white border border-slate-200 rounded-lg text-left hover:border-blue-300 transition-colors flex items-start gap-3"
              >
                <Wallet className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Outstanding Balances
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Customer credit balances and collections
                  </div>
                </div>
              </button>

              {canManageReturns && (
                <button
                  type="button"
                  onClick={() => setActiveTab('returns')}
                  className="p-4 bg-white border border-slate-200 rounded-lg text-left hover:border-blue-300 transition-colors flex items-start gap-3"
                >
                  <RotateCcw className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      Returns &amp; Refunds
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Process returns, restocks, and refunds
                    </div>
                  </div>
                </button>
              )}

              {canConfigureMethods && (
                <button
                  type="button"
                  onClick={() => setActiveTab('payment_methods')}
                  className="p-4 bg-white border border-slate-200 rounded-lg text-left hover:border-blue-300 transition-colors flex items-start gap-3"
                >
                  <CreditCard className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">Payment Methods</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Configure checkout tender options
                    </div>
                  </div>
                </button>
              )}
            </div>
          </section>

          {/* Recent Sales */}
          <section
            aria-labelledby="recent-sales-heading"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 id="recent-sales-heading" className="text-sm font-semibold text-slate-900">
                  Recent Sales
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Latest recorded transactions for {activeOrganisation?.name ?? 'this workspace'}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
              >
                View all sales
              </button>
            </div>

            {isInitialLoading ? (
              <div className="p-5 space-y-2.5" aria-busy="true">
                <div className="h-9 bg-slate-100 rounded animate-pulse" />
                <div className="h-9 bg-slate-100 rounded animate-pulse" />
                <div className="h-9 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : recentSales.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <div className="text-xs font-semibold text-slate-900">No sales recorded yet</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Start by opening POS Checkout to create the first sale for {activeOrganisation?.name ?? 'this organisation'}.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('pos')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800"
                  >
                    <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Open POS Checkout</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4 whitespace-nowrap">Sale #</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Customer</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Total</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Outstanding</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Payment</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {recentSales.map((sale) => {
                      const cur = sale.currency || currencyCode;
                      return (
                        <tr key={sale.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {sale.saleNumber}
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {formatSalesShortDate(sale.soldAt, timeZone)}
                          </td>
                          <td className="py-3 px-4 text-slate-800">
                            {sale.customerName ?? 'Walk-in'}
                          </td>
                          <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                            {sale.locationName}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-medium text-slate-900 tabular-nums whitespace-nowrap">
                            {formatMoneyAmount(sale.totalAmount, cur)}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                              sale.outstandingAmount > 0
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-500'
                            }`}
                          >
                            {formatMoneyAmount(sale.outstandingAmount, cur)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`text-xs font-medium ${
                                sale.paymentStatus === 'paid'
                                  ? 'text-emerald-700'
                                  : sale.paymentStatus === 'partial'
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                              }`}
                            >
                              {formatPaymentStatusLabel(sale.paymentStatus)}
                            </span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`text-xs font-medium ${
                                sale.status === 'cancelled' ? 'text-red-700' : 'text-slate-700'
                              }`}
                            >
                              {formatSaleStatusLabel(sale.status)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleOpenReceipt(sale)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Receipt className="h-3 w-3" aria-hidden="true" />
                              <span>Receipt</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab 2: POS Checkout */}
      {activeTab === 'pos' && activeOrgId && (
        <PosCheckoutPanel
          organisationId={activeOrgId}
          currencyCode={currencyCode}
          activeRole={activeRole}
          data={data}
          loading={isInitialLoading}
          onReload={handleReload}
          onOpenReceipt={handleOpenReceipt}
        />
      )}

      {/* Tab 3: Sales History */}
      {activeTab === 'history' && activeOrgId && (
        <SalesHistoryPanel
          organisationId={activeOrgId}
          currencyCode={currencyCode}
          timeZone={timeZone}
          activeRole={activeRole}
          data={data}
          loading={isInitialLoading}
          onReload={handleReload}
          onOpenReceipt={handleOpenReceipt}
        />
      )}

      {/* Tab 4: Outstanding Balances */}
      {activeTab === 'outstanding' && activeOrgId && (
        <OutstandingBalancesPanel
          organisationId={activeOrgId}
          currencyCode={currencyCode}
          timeZone={timeZone}
          paymentMethods={data.paymentMethods}
          onReloadSales={handleReload}
        />
      )}

      {/* Tab 4: Returns, Refunds & Cancellations (Owner/Admin/Manager only) */}
      {activeTab === 'returns' && activeOrgId && canManageReturns && (
        <SalesReturnsPanel
          organisationId={activeOrgId}
          currencyCode={currencyCode}
          timeZone={timeZone}
          activeRole={activeRole}
          data={data}
          loading={isInitialLoading}
          onReload={handleReload}
        />
      )}

      {/* Tab 5: Payment Methods Configuration (Owner/Admin only) */}
      {activeTab === 'payment_methods' && activeOrgId && canConfigureMethods && (
        <PaymentMethodsPanel
          organisationId={activeOrgId}
          activeRole={activeRole}
          paymentMethods={data.paymentMethods}
          loading={isInitialLoading}
          error={data.errors.paymentMethods}
          onReload={handleReload}
        />
      )}

      {/* Printable Receipt Modal */}
      <SaleReceiptModal
        sale={receiptSale}
        organisation={activeOrganisation}
        receiptSettings={receiptSettings}
        onClose={() => setReceiptSaleId(null)}
      />
    </div>
  );
}

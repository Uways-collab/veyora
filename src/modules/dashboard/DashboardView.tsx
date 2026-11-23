import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  RefreshCw,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { formatCurrencyDisplay } from '../../core/constants/businessOptions';
import {
  fetchOrganisationAuditLogs,
  type AuditFetchErrorKind,
} from '../../core/supabase/audit';
import type { AuditLogEntry, ModuleId } from '../../core/types/domain';
import type { SettingsTab } from '../settings/SettingsView';
import { ModuleIcon } from '../../components/shared/ModuleIcon';

interface DashboardViewProps {
  onSelectModule: (moduleId: ModuleId, settingsTab?: SettingsTab) => void;
}

type ChartWindow = '7D' | '30D' | '90D' | '12M';

interface OverviewCardSpec {
  id: string;
  label: string;
  targetModule: ModuleId;
  emptyHeadline: string;
  moduleContext: string;
}

const OVERVIEW_CARDS: OverviewCardSpec[] = [
  {
    id: 'total_sales',
    label: 'Total Sales',
    targetModule: 'sales',
    emptyHeadline: 'No sales recorded yet',
    moduleContext: 'Sales module not yet configured',
  },
  {
    id: 'orders',
    label: 'Orders',
    targetModule: 'sales',
    emptyHeadline: 'No orders placed yet',
    moduleContext: 'Orders module not yet configured',
  },
  {
    id: 'inventory_items',
    label: 'Inventory Items',
    targetModule: 'inventory',
    emptyHeadline: 'Your inventory will appear here',
    moduleContext: 'View active products & locations',
  },
  {
    id: 'customers',
    label: 'Customers',
    targetModule: 'customers',
    emptyHeadline: 'No customers added yet',
    moduleContext: 'Customers module not yet configured',
  },
];

const CHART_WINDOW_LABELS: Record<ChartWindow, string> = {
  '7D': 'Last 7 days',
  '30D': 'Last 30 days',
  '90D': 'Last 90 days',
  '12M': 'Last 12 months',
};

function formatTimestamp(iso: string): string {
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

export function DashboardView({ onSelectModule }: DashboardViewProps) {
  const {
    status,
    activeOrganisation,
    activeRole,
    user,
    profile,
    recentlyCreatedOrgName,
    clearRecentlyCreatedNotice,
  } = useAuth();

  const [chartWindow, setChartWindow] = useState<ChartWindow>('30D');
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditErrorKind, setAuditErrorKind] = useState<AuditFetchErrorKind | null>(null);

  const loadLogs = async (orgId: string) => {
    setAuditLoading(true);
    setAuditError(null);
    setAuditErrorKind(null);
    try {
      const result = await fetchOrganisationAuditLogs(orgId, 8);
      setAuditLogs(result.logs);
      setAuditError(result.error);
      setAuditErrorKind(result.errorKind);
    } catch (error) {
      setAuditLogs([]);
      setAuditError(error instanceof Error ? error.message : 'Unable to load workspace activity.');
      setAuditErrorKind('other');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated' && activeOrganisation) {
      void loadLogs(activeOrganisation.id);
    } else {
      setAuditLogs([]);
      setAuditError(null);
    }
  }, [status, activeOrganisation]);

  const welcomeName = profile?.full_name?.trim() || user?.email || 'there';

  return (
    <div className="space-y-8">
      {/* Onboarding Completion Banner */}
      {recentlyCreatedOrgName && (
        <div
          role="status"
          className="bg-white border border-emerald-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-2.5 text-xs text-slate-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>
              Business workspace <span className="font-semibold text-slate-900">{recentlyCreatedOrgName}</span> has been created and set as your active workspace.
            </span>
          </div>
          <button
            type="button"
            onClick={clearRecentlyCreatedNotice}
            aria-label="Dismiss confirmation"
            className="p-1 rounded text-slate-400 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Section 1: Welcome & Active Business Workspace Summary */}
      <section
        aria-labelledby="dashboard-heading"
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 pb-6"
      >
        <div className="space-y-1.5 min-w-0">
          <div className="text-xs font-medium text-slate-500">
            Welcome back, {welcomeName}
          </div>
          <h1
            id="dashboard-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 truncate"
          >
            {activeOrganisation ? activeOrganisation.name : 'Business Dashboard'}
          </h1>
          {activeOrganisation && (
            <p className="text-sm text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="capitalize">{activeOrganisation.business_type}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span>Country: {activeOrganisation.country}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span>Currency: {formatCurrencyDisplay(activeOrganisation.base_currency)}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span>
                Role: <span className="capitalize font-medium text-slate-800">{activeRole ?? 'staff'}</span>
              </span>
              {activeOrganisation.business_email && (
                <>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span>{activeOrganisation.business_email}</span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onSelectModule('settings', 'auth_orgs')}
            className="px-4 py-2 rounded-md text-xs font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Business Settings
          </button>
        </div>
      </section>

      {/* Section 2: Overview Cards (Total Sales, Orders, Inventory Items, Customers) */}
      <section aria-labelledby="overview-cards-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="overview-cards-heading" className="text-sm font-semibold text-slate-900">
            Workspace Overview
          </h2>
          {activeOrganisation && (
            <span className="text-xs text-slate-500">
              Reporting currency:{' '}
              <span className="font-mono text-slate-700">
                {formatCurrencyDisplay(activeOrganisation.base_currency)}
              </span>
            </span>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          {OVERVIEW_CARDS.map((card) => (
            <div key={card.id} className="p-5 flex flex-col justify-between gap-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">{card.label}</span>
                <ModuleIcon moduleId={card.targetModule} className="h-4 w-4 text-slate-400 shrink-0" />
              </div>

              <div className="space-y-1">
                <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                  —
                </div>
                <div className="text-xs font-medium text-slate-700">
                  {card.emptyHeadline}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-500 truncate">{card.moduleContext}</span>
                <button
                  type="button"
                  onClick={() => onSelectModule(card.targetModule)}
                  className="font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:underline"
                >
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Sales Performance Chart Area + Quick Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Sales Performance Chart Area (8 columns) */}
        <section
          aria-labelledby="sales-chart-heading"
          className="xl:col-span-8 bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 id="sales-chart-heading" className="text-sm font-semibold text-slate-900">
                Sales Performance
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {CHART_WINDOW_LABELS[chartWindow]} ·{' '}
                {activeOrganisation
                  ? formatCurrencyDisplay(activeOrganisation.base_currency)
                  : 'Base'}{' '}
                revenue trend
              </p>
            </div>

            <div
              role="tablist"
              aria-label="Sales chart timeframe"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start sm:self-auto"
            >
              {(['7D', '30D', '90D', '12M'] as const).map((win) => (
                <button
                  key={win}
                  type="button"
                  role="tab"
                  aria-selected={chartWindow === win}
                  onClick={() => setChartWindow(win)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap ${
                    chartWindow === win
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {win}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex-1 min-h-[240px] p-5 flex flex-col justify-center items-center">
            {/* Subtle structural grid lines (no fabricated chart curves) */}
            <div
              aria-hidden="true"
              className="absolute inset-x-5 inset-y-6 flex flex-col justify-between pointer-events-none"
            >
              <div className="border-b border-dashed border-slate-200/80" />
              <div className="border-b border-dashed border-slate-200/80" />
              <div className="border-b border-dashed border-slate-200/80" />
              <div className="border-b border-slate-200" />
            </div>

            <div className="relative z-10 bg-white/95 px-5 py-4 rounded-md border border-slate-200 text-center max-w-md space-y-1.5">
              <div className="flex justify-center text-slate-400">
                <BarChart3 className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-xs font-semibold text-slate-900">
                No sales recorded yet
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Sales performance charts for {CHART_WINDOW_LABELS[chartWindow].toLowerCase()} will populate automatically once the Sales module and invoice tables are implemented.
              </p>
            </div>
          </div>
        </section>

        {/* Quick Actions Section (4 columns) */}
        <section
          aria-labelledby="quick-actions-heading"
          className="xl:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col"
        >
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 id="quick-actions-heading" className="text-sm font-semibold text-slate-900">
              Quick Actions
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage your active workspace and inspect module readiness.
            </p>
          </div>

          <div className="divide-y divide-slate-200 flex-1">
            <button
              type="button"
              onClick={() => onSelectModule('settings', 'auth_orgs')}
              className="w-full px-5 py-3.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:bg-slate-50"
            >
              <span className="flex items-center gap-3 min-w-0">
                <Building2 className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-900">
                    Update Business Profile
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    Edit name, currency, country, or contact info
                  </span>
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onSelectModule('settings', 'members_roles')}
              className="w-full px-5 py-3.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:bg-slate-50"
            >
              <span className="flex items-center gap-3 min-w-0">
                <Users className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-900">
                    Team Members &amp; Roles
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    Review Owner, Admin, Manager &amp; Staff permissions
                  </span>
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onSelectModule('settings', 'auth_orgs')}
              className="w-full px-5 py-3.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:bg-slate-50"
            >
              <span className="flex items-center gap-3 min-w-0">
                <Settings className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-900">
                    Create Another Business Workspace
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    Add a separate store, branch, or wholesale entity
                  </span>
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => onSelectModule('inventory')}
              className="w-full px-5 py-3.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:bg-slate-50"
            >
              <span className="flex items-center gap-3 min-w-0">
                <ModuleIcon moduleId="inventory" className="h-4 w-4 text-slate-500 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-900">
                    Preview Planned Modules
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    Inventory, Sales, Customers, Purchases &amp; Finance
                  </span>
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>

      {/* Section 4: Recent Transactions & Organisation Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Recent Transactions Section (7 columns) */}
        <section
          aria-labelledby="recent-transactions-heading"
          className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 id="recent-transactions-heading" className="text-sm font-semibold text-slate-900">
                Recent Transactions
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Sales invoices, purchase bills, and customer payments for {activeOrganisation?.name}.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
              0 records
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Reference</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Type</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Counterparty</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Date</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center space-y-1.5">
                    <div className="text-xs font-semibold text-slate-900">
                      No transactions recorded yet
                    </div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                      Recent sales, purchases, and payment entries will appear here once those business modules and database tables are implemented.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Organisation Audit Trail (5 columns) */}
        <section
          aria-labelledby="audit-section-heading"
          className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 id="audit-section-heading" className="text-sm font-semibold text-slate-900">
                Workspace Activity
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Verified organisation events from <span className="font-mono">public.organization_audit_log</span>.
              </p>
            </div>
            {activeOrganisation && (
              <button
                type="button"
                onClick={() => void loadLogs(activeOrganisation.id)}
                disabled={auditLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${auditLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>
            )}
          </div>

          {auditLoading ? (
            <div className="p-5 space-y-2.5" aria-busy="true">
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : auditError ? (
            auditErrorKind === 'missing_table' ? (
              <div className="p-6 text-xs text-slate-500 text-center space-y-1">
                <div className="font-medium text-slate-700">
                  Activity log not yet configured
                </div>
                <p>
                  <span className="font-mono">public.organization_audit_log</span> is not present in this Supabase project yet.
                </p>
              </div>
            ) : (
              <div className="p-5 text-xs text-amber-800 bg-amber-50/70 border-t border-amber-100 leading-relaxed">
                <span className="font-semibold block mb-1">
                  {auditErrorKind === 'permission_denied'
                    ? 'Workspace activity denied by Row Level Security'
                    : 'Workspace activity unavailable'}
                </span>
                <span>{auditError}</span>
              </div>
            )
          ) : auditLogs.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 text-center">
              No workspace activity logged for <span className="font-medium text-slate-700">{activeOrganisation?.name}</span> yet.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 text-xs">
              {auditLogs.map((entry) => (
                <li key={entry.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-slate-900 truncate">{entry.action}</div>
                    <div className="text-slate-500 capitalize">
                      {entry.module}
                      <span aria-hidden="true"> · </span>
                      <span>{entry.entity_type}</span>
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                    {formatTimestamp(entry.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

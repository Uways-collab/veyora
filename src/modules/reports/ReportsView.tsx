import { useState } from 'react';
import {
  BarChart3,
  Boxes,
  Clock,
  Landmark,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { InventoryReportsPanel } from './InventoryReportsPanel';

type ReportDomainId = 'inventory' | 'sales' | 'purchases' | 'finance';

interface ReportDomainDefinition {
  id: ReportDomainId;
  label: string;
  status: 'active' | 'upcoming';
  description: string;
  targetPhase?: string;
}

const REPORT_DOMAINS: ReportDomainDefinition[] = [
  {
    id: 'inventory',
    label: 'Inventory Reports',
    status: 'active',
    description:
      'Live read-only inventory summary, point-in-time valuation, stock movements, transfers, and replenishment alerts.',
  },
  {
    id: 'sales',
    label: 'Sales Reports',
    status: 'upcoming',
    description:
      'Order volume, invoiced revenue, customer fulfilment, and gross margin reporting will activate with the Sales module.',
    targetPhase: 'Phase 4',
  },
  {
    id: 'purchases',
    label: 'Purchases Reports',
    status: 'upcoming',
    description:
      'Supplier spend, purchase order receipts, and landed cost reporting will activate with the Purchases module.',
    targetPhase: 'Phase 3',
  },
  {
    id: 'finance',
    label: 'Finance Reports',
    status: 'upcoming',
    description:
      'Trial balance, aged receivables/payables, and tax summary reporting will activate with the Finance module.',
    targetPhase: 'Phase 5',
  },
];

function getDomainIcon(id: ReportDomainId) {
  switch (id) {
    case 'inventory':
      return Boxes;
    case 'sales':
      return ShoppingBag;
    case 'purchases':
      return ShoppingCart;
    case 'finance':
      return Landmark;
  }
}

export function ReportsView() {
  const { activeOrganisation, activeRole } = useAuth();
  const [selectedDomain, setSelectedDomain] = useState<ReportDomainId>('inventory');

  const activeDomainDef =
    REPORT_DOMAINS.find((domain) => domain.id === selectedDomain) ?? REPORT_DOMAINS[0];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <section
        aria-labelledby="reports-heading"
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
            <span>Read-Only Reporting</span>
          </div>
          <h1
            id="reports-heading"
            className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900"
          >
            Reports
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Central operational and financial reporting for{' '}
            {activeOrganisation?.name ?? 'your workspace'}, scoped strictly to your active
            organisation via Supabase Row Level Security.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-md px-3 py-1.5 shrink-0 self-start sm:self-auto">
          <BarChart3 className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          <span>Inventory Reports Active · Sales, Purchases &amp; Finance Upcoming</span>
        </div>
      </section>

      {/* Report Domain Selector */}
      <section aria-label="Report domains" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {REPORT_DOMAINS.map((domain) => {
          const Icon = getDomainIcon(domain.id);
          const isSelected = selectedDomain === domain.id;
          const isActive = domain.status === 'active';

          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => setSelectedDomain(domain.id)}
              aria-pressed={isSelected}
              className={`text-left p-4 rounded-lg border transition-colors ${
                isSelected
                  ? 'bg-white border-blue-600 ring-1 ring-blue-600'
                  : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-blue-700' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{domain.label}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {isActive ? 'Active' : 'Upcoming'}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                {domain.description}
              </p>
            </button>
          );
        })}
      </section>

      {/* Selected Domain Workspace */}
      {selectedDomain === 'inventory' ? (
        <InventoryReportsPanel />
      ) : (
        <section
          aria-labelledby="upcoming-report-domain-heading"
          className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8"
        >
          <div className="max-w-xl space-y-4">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 text-slate-700 text-xs font-medium">
              <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>
                Upcoming Report Domain
                {activeDomainDef.targetPhase ? ` · ${activeDomainDef.targetPhase}` : ''}
              </span>
            </div>

            <div className="space-y-1.5">
              <h2
                id="upcoming-report-domain-heading"
                className="font-display text-lg font-semibold text-slate-900"
              >
                {activeDomainDef.label}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                {activeDomainDef.description}
              </p>
            </div>

            <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600">
              To avoid displaying estimated or unverified figures, no metrics are shown until
              the underlying Supabase tables and transactions for this module are live.
            </div>

            <div>
              <button
                type="button"
                onClick={() => setSelectedDomain('inventory')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors"
              >
                <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Open Active Inventory Reports</span>
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

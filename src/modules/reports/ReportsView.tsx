import { useState } from 'react';
import {
  BarChart3,
  Boxes,
  Landmark,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { InventoryReportsPanel } from './InventoryReportsPanel';
import { BusinessReportsPanel } from './BusinessReportsPanel';

type ReportDomainId = 'inventory' | 'sales' | 'purchases' | 'finance';

interface ReportDomainDefinition {
  id: ReportDomainId;
  label: string;
  status: 'active' | 'upcoming';
  description: string;
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
    status: 'active',
    description:
      'Live sales totals, returns, collections, customer balances, product performance and transaction detail.',
  },
  {
    id: 'purchases',
    label: 'Purchases Reports',
    status: 'active',
    description:
      'Purchase commitments, goods received, supplier spend, order status and purchase-order detail.',
  },
  {
    id: 'finance',
    label: 'Finance Reports',
    status: 'upcoming',
    description:
      'Posted-ledger profit and loss, balance sheet, trial balance and general-ledger activity.',
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

export function ReportsView({ canExport = false }: { canExport?: boolean }) {
  const { activeOrganisation, activeRole } = useAuth();
  const [selectedDomain, setSelectedDomain] = useState<ReportDomainId>('inventory');

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
          <span>Inventory, Sales, Purchases &amp; Finance reports active</span>
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
                  {isActive ? 'Active' : 'Planned'}
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
        <InventoryReportsPanel canExport={canExport} />
      ) : (
        <BusinessReportsPanel domain={selectedDomain} canExport={canExport} />
      )}
    </div>
  );
}

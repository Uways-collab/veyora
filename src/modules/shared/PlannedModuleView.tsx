import { ArrowLeft, ArrowRight, Database, Layers, ShieldCheck } from 'lucide-react';
import { getModuleById, MODULE_REGISTRY } from '../../core/modules/registry';
import type { ModuleId } from '../../core/types/domain';
import { ModuleIcon } from '../../components/shared/ModuleIcon';

interface PlannedModuleViewProps {
  moduleId: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
}

const PLANNED_TABLE_COLUMNS: Record<string, string[]> = {
  inventory: ['SKU', 'Product Name', 'Warehouse', 'On Hand', 'Reorder Point', 'Unit Cost'],
  sales: ['Order #', 'Customer', 'Channel', 'Order Date', 'Total', 'Fulfilment'],
  customers: ['Customer Code', 'Business / Name', 'Price Tier', 'Credit Limit', 'Balance'],
  purchases: ['PO Number', 'Supplier', 'Warehouse', 'Expected Date', 'Total Cost', 'Receipt State'],
  suppliers: ['Vendor Code', 'Supplier Name', 'Lead Time', 'Payment Terms', 'Primary Contact'],
  finance: ['Account Code', 'Account Name', 'Category', 'Debit', 'Credit', 'Net Balance'],
  reports: ['Report Name', 'Domain Scope', 'Period', 'Format', 'Last Generated'],
};

export function PlannedModuleView({ moduleId, onSelectModule }: PlannedModuleViewProps) {
  const mod = getModuleById(moduleId);
  const previewColumns = PLANNED_TABLE_COLUMNS[moduleId] ?? ['Record ID', 'Name', 'Updated At'];

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-slate-200 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Module Not Yet Configured</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{mod.targetPhase}</span>
            <span aria-hidden="true">·</span>
            <span>Coming Soon</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-800">
              <ModuleIcon moduleId={mod.id} className="h-5 w-5" />
            </span>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
              {mod.label}
            </h1>
          </div>
          <p className="text-sm text-slate-600 max-w-2xl">
            {mod.summary} Backend tables and transactional workflows for {mod.label} have not been implemented yet.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onSelectModule('dashboard')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Dashboard</span>
        </button>
      </section>

      {/* Architectural Specification Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Core Entities */}
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Layers className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span>Core Functional Entities</span>
          </div>
          <ul className="divide-y divide-slate-100 text-xs text-slate-700">
            {mod.primaryEntities.map((entity) => (
              <li key={entity} className="py-2 first:pt-0 last:pb-0">
                {entity}
              </li>
            ))}
          </ul>
        </section>

        {/* PostgreSQL Tables & RLS */}
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Database className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span>Planned Supabase Tables</span>
          </div>
          <ul className="divide-y divide-slate-100 text-xs font-mono text-slate-700">
            {mod.plannedTables.map((table) => (
              <li key={table} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                <span>public.{table}</span>
                <span className="text-[11px] font-sans text-slate-400">organisation_id</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Security & Cross-Module Links */}
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span>Multi-Tenant Isolation</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              All records in this module will enforce <span className="font-mono">public.is_org_member(organisation_id)</span> via PostgreSQL Row Level Security.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-2">
            <div className="text-xs font-medium text-slate-700">Connected Modules</div>
            <div className="flex flex-wrap gap-2">
              {mod.connectedModules.map((targetId) => {
                const target = MODULE_REGISTRY.find((m) => m.id === targetId);
                if (!target) return null;
                return (
                  <button
                    key={targetId}
                    type="button"
                    onClick={() => onSelectModule(targetId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors whitespace-nowrap"
                  >
                    <span>{target.label}</span>
                    <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Empty Schema Preview Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {mod.label} Ledger Structure Preview
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              This module is reserved for {mod.targetPhase}. No mock records or fabricated transactions are rendered.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            0 records · Schema reserved
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                {previewColumns.map((col) => (
                  <th key={col} className="py-2.5 px-4 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={previewColumns.length} className="px-4 py-10 text-center text-xs text-slate-500">
                  The <span className="font-medium text-slate-700">{mod.label}</span> workspace will activate in{' '}
                  <span className="font-mono text-slate-700">{mod.targetPhase}</span> once its Supabase tables and service layer are added under{' '}
                  <span className="font-mono text-slate-700">src/modules/{mod.id}/</span>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

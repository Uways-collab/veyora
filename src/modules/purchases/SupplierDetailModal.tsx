import { useEffect } from 'react';
import { Archive, Edit3, RotateCcw, X } from 'lucide-react';
import { formatPaymentTermsLabel, formatSupplierDateTime } from './suppliersService';
import type { SupplierRecord } from './suppliersTypes';

interface SupplierDetailModalProps {
  supplier: SupplierRecord | null;
  timeZone?: string | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (supplier: SupplierRecord) => void;
  onArchive: (supplier: SupplierRecord) => void;
  onRestore: (supplier: SupplierRecord) => void;
}

export function SupplierDetailModal({
  supplier,
  timeZone,
  canManage,
  onClose,
  onEdit,
  onArchive,
  onRestore,
}: SupplierDetailModalProps) {
  useEffect(() => {
    if (!supplier) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [supplier, onClose]);

  if (!supplier) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="supplier-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="supplier-detail-title" className="text-sm font-semibold text-slate-900 truncate">
              {supplier.name}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className={supplier.isActive ? 'text-emerald-700 font-medium' : 'text-amber-800 font-medium'}>
                {supplier.isActive ? 'Active' : 'Archived'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {formatPaymentTermsLabel(supplier.paymentTermsDays)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManage && supplier.isActive && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(supplier);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onArchive(supplier);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:text-amber-800 hover:border-amber-300 whitespace-nowrap shrink-0"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Archive</span>
                </button>
              </>
            )}
            {canManage && !supplier.isActive && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRestore(supplier);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Restore</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close supplier details"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {!supplier.isActive && (
            <div className="p-3 rounded-md border border-amber-200 bg-amber-50/70 text-amber-900 leading-relaxed">
              This supplier is currently archived
              {supplier.archivedAt ? ` (${formatSupplierDateTime(supplier.archivedAt, timeZone)})` : ''}. Restore it to active status before editing or selecting it for new procurement workflows.
            </div>
          )}

          <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Contact Person</div>
                <div className="text-slate-900 font-medium mt-0.5">
                  {supplier.contactPerson || '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Payment Terms</div>
                <div className="font-mono tabular-nums text-slate-900 font-medium mt-0.5">
                  {formatPaymentTermsLabel(supplier.paymentTermsDays)}
                </div>
              </div>
            </div>

            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Email</div>
                <div className="text-slate-800 mt-0.5 break-all">{supplier.email || '—'}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Phone</div>
                <div className="font-mono tabular-nums text-slate-800 mt-0.5">
                  {supplier.phone || '—'}
                </div>
              </div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Address</div>
              <div className="text-slate-700 whitespace-pre-wrap">{supplier.address || '—'}</div>
            </div>

            <div className="p-3.5 space-y-1">
              <div className="text-[11px] font-medium text-slate-500">Notes</div>
              <div className="text-slate-700 whitespace-pre-wrap">{supplier.notes || '—'}</div>
            </div>

            <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-[11px] text-slate-500">
              <div>
                <span>Created: </span>
                <span className="font-mono text-slate-700">
                  {formatSupplierDateTime(supplier.createdAt, timeZone)}
                </span>
              </div>
              <div>
                <span>Updated: </span>
                <span className="font-mono text-slate-700">
                  {formatSupplierDateTime(supplier.updatedAt, timeZone)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import {
  Archive,
  Edit3,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  StickyNote,
  X,
} from 'lucide-react';
import { formatCustomerDateTime } from './customersService';
import type { CustomerRecord } from './customersTypes';

interface CustomerDetailModalProps {
  customer: CustomerRecord | null;
  timeZone?: string | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (customer: CustomerRecord) => void;
  onArchive: (customer: CustomerRecord) => void;
  onRestore: (customer: CustomerRecord) => void;
}

export function CustomerDetailModal({
  customer,
  timeZone,
  canManage,
  onClose,
  onEdit,
  onArchive,
  onRestore,
}: CustomerDetailModalProps) {
  useEffect(() => {
    if (!customer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [customer, onClose]);

  if (!customer) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-detail-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <span>Customer Record</span>
              <span aria-hidden="true">·</span>
              <span className={customer.isActive ? 'text-emerald-700 font-medium' : 'text-amber-800 font-medium'}>
                {customer.isActive ? 'Active' : 'Archived'}
              </span>
            </div>
            <h2
              id="customer-detail-modal-title"
              className="text-base font-semibold text-slate-900 mt-0.5 break-words"
            >
              {customer.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
          {!customer.isActive && (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-slate-600">
              This customer is archived. Archived records are read-only until restored to Active Customers.
            </div>
          )}

          <dl className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <dt className="text-slate-500 flex items-center gap-1.5 shrink-0">
                <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Phone</span>
              </dt>
              <dd className="text-slate-900 font-mono tabular-nums text-right break-all">
                {customer.phone ?? '—'}
              </dd>
            </div>

            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <dt className="text-slate-500 flex items-center gap-1.5 shrink-0">
                <Mail className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Email</span>
              </dt>
              <dd className="text-slate-900 text-right break-all">
                {customer.email ?? '—'}
              </dd>
            </div>

            <div className="px-4 py-3 space-y-1">
              <dt className="text-slate-500 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Address</span>
              </dt>
              <dd className="text-slate-900 whitespace-pre-line break-words pl-5">
                {customer.address ?? 'No address recorded.'}
              </dd>
            </div>

            <div className="px-4 py-3 space-y-1">
              <dt className="text-slate-500 flex items-center gap-1.5">
                <StickyNote className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>Notes</span>
              </dt>
              <dd className="text-slate-900 whitespace-pre-line break-words pl-5">
                {customer.notes ?? 'No notes recorded.'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              Created:{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {formatCustomerDateTime(customer.createdAt, timeZone)}
              </span>
            </span>
            <span>
              Updated:{' '}
              <span className="font-mono tabular-nums text-slate-700">
                {formatCustomerDateTime(customer.updatedAt, timeZone)}
              </span>
            </span>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          {canManage ? (
            customer.isActive ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(customer);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onArchive(customer);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-amber-800 hover:bg-amber-50 hover:border-amber-300 whitespace-nowrap"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Archive</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRestore(customer);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-xs font-medium text-blue-800 hover:bg-blue-100 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Restore Customer</span>
              </button>
            )
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

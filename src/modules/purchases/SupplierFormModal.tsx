import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  createSupplier,
  updateSupplier,
  validateSupplierInput,
} from './suppliersService';
import type { SupplierMutationInput, SupplierRecord } from './suppliersTypes';

interface SupplierFormModalProps {
  open: boolean;
  organisationId: string;
  supplier: SupplierRecord | null;
  onClose: () => void;
  onSuccess: (message: string, savedSupplier: SupplierRecord | null) => Promise<void> | void;
}

const EMPTY_FORM: SupplierMutationInput = {
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  paymentTerms: '0',
  address: '',
  notes: '',
};

export function SupplierFormModal({
  open,
  organisationId,
  supplier,
  onClose,
  onSuccess,
}: SupplierFormModalProps) {
  const isEditing = Boolean(supplier);
  const [form, setForm] = useState<SupplierMutationInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSubmitting(false);
    submitLockRef.current = false;

    if (supplier) {
      setForm({
        name: supplier.name,
        contactPerson: supplier.contactPerson ?? '',
        email: supplier.email ?? '',
        phone: supplier.phone ?? '',
        paymentTerms: String(Math.max(0, supplier.paymentTermsDays)),
        address: supplier.address ?? '',
        notes: supplier.notes ?? '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, supplier]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;

    const validation = validateSupplierInput(form);
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      if (supplier) {
        if (!supplier.isActive) {
          setFormError('Archived suppliers cannot be edited until restored.');
          return;
        }
        const result = await updateSupplier(organisationId, supplier.id, form);
        if (result.error) {
          setFormError(result.error);
          return;
        }
        await onSuccess(
          `Supplier "${validation.normalized.name}" updated.`,
          result.supplier
        );
      } else {
        const result = await createSupplier(organisationId, form);
        if (result.error) {
          setFormError(result.error);
          return;
        }
        await onSuccess(
          `Supplier "${validation.normalized.name}" created.`,
          result.supplier
        );
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="supplier-form-modal-title"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="bg-white border border-slate-200 rounded-lg w-full max-w-lg overflow-hidden shadow-xl flex flex-col max-h-[92vh]"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 id="supplier-form-modal-title" className="text-sm font-semibold text-slate-900">
              {isEditing ? 'Edit Supplier' : 'Add Supplier'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditing
                ? 'Update vendor contact details, payment terms, or supplier notes.'
                : 'Add a new supplier to your active organization directory.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close supplier form"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs overflow-y-auto">
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2 text-red-900"
            >
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="font-medium leading-relaxed">{formError}</span>
            </div>
          )}

          <div>
            <label htmlFor="supplier-form-name" className="block font-medium text-slate-700 mb-1">
              Supplier Name <span className="text-red-600">*</span>
            </label>
            <input
              id="supplier-form-name"
              type="text"
              required
              aria-required="true"
              maxLength={200}
              value={form.name}
              onChange={(e) => {
                setFormError(null);
                setForm((prev) => ({ ...prev, name: e.target.value }));
              }}
              disabled={submitting}
              placeholder="e.g. Zenith Wholesale Distribution Ltd."
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="supplier-form-contact-person"
                className="block font-medium text-slate-700 mb-1"
              >
                Contact Person <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="supplier-form-contact-person"
                type="text"
                maxLength={200}
                value={form.contactPerson}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, contactPerson: e.target.value }));
                }}
                disabled={submitting}
                placeholder="e.g. Chinedu Okafor"
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label
                htmlFor="supplier-form-payment-terms"
                className="block font-medium text-slate-700 mb-1"
              >
                Payment Terms (Days) <span className="text-red-600">*</span>
              </label>
              <input
                id="supplier-form-payment-terms"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                required
                aria-required="true"
                value={form.paymentTerms}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, paymentTerms: e.target.value }));
                }}
                disabled={submitting}
                placeholder="0"
                className="w-full px-3 py-2 rounded-md border border-slate-300 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Enter 0 for due on receipt, or number of days (e.g. 15, 30, 60).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="supplier-form-email" className="block font-medium text-slate-700 mb-1">
                Email <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="supplier-form-email"
                type="email"
                maxLength={200}
                value={form.email}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, email: e.target.value }));
                }}
                disabled={submitting}
                placeholder="orders@supplier.com"
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="supplier-form-phone" className="block font-medium text-slate-700 mb-1">
                Phone <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="supplier-form-phone"
                type="tel"
                maxLength={60}
                value={form.phone}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, phone: e.target.value }));
                }}
                disabled={submitting}
                placeholder="+234 800 000 0000"
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="supplier-form-address" className="block font-medium text-slate-700 mb-1">
              Address <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="supplier-form-address"
              rows={2}
              maxLength={500}
              value={form.address}
              onChange={(e) => {
                setFormError(null);
                setForm((prev) => ({ ...prev, address: e.target.value }));
              }}
              disabled={submitting}
              placeholder="Warehouse, street address, city, or dispatch depot..."
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label htmlFor="supplier-form-notes" className="block font-medium text-slate-700 mb-1">
              Notes <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="supplier-form-notes"
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => {
                setFormError(null);
                setForm((prev) => ({ ...prev, notes: e.target.value }));
              }}
              disabled={submitting}
              placeholder="Lead times, delivery schedule, bank account notes, or procurement terms..."
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            <span>
              {submitting
                ? isEditing
                  ? 'Saving...'
                  : 'Creating...'
                : isEditing
                  ? 'Save Changes'
                  : 'Create Supplier'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

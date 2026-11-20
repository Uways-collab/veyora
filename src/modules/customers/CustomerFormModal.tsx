import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  createCustomer,
  updateCustomer,
  validateCustomerInput,
} from './customersService';
import type { CustomerMutationInput, CustomerRecord } from './customersTypes';

interface CustomerFormModalProps {
  open: boolean;
  organisationId: string;
  customer: CustomerRecord | null;
  onClose: () => void;
  onSuccess: (message: string, savedCustomer: CustomerRecord | null) => Promise<void> | void;
}

const EMPTY_FORM: CustomerMutationInput = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

export function CustomerFormModal({
  open,
  organisationId,
  customer,
  onClose,
  onSuccess,
}: CustomerFormModalProps) {
  const isEditing = Boolean(customer);
  const [form, setForm] = useState<CustomerMutationInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (customer) {
      setForm({
        name: customer.name,
        phone: customer.phone ?? '',
        email: customer.email ?? '',
        address: customer.address ?? '',
        notes: customer.notes ?? '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, customer]);

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

    const validation = validateCustomerInput(form);
    if (!validation.ok) {
      setFormError(validation.error);
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      if (customer) {
        const result = await updateCustomer(organisationId, customer.id, form);
        if (result.error) {
          setFormError(result.error);
          return;
        }
        await onSuccess(
          `Customer "${validation.normalized.name}" updated.`,
          result.customer
        );
      } else {
        const result = await createCustomer(organisationId, form);
        if (result.error) {
          setFormError(result.error);
          return;
        }
        await onSuccess(
          `Customer "${validation.normalized.name}" created.`,
          result.customer
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
      aria-labelledby="customer-form-modal-title"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="bg-white border border-slate-200 rounded-lg w-full max-w-lg overflow-hidden shadow-xl"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 id="customer-form-modal-title" className="text-sm font-semibold text-slate-900">
              {isEditing ? 'Edit Customer' : 'Add Customer'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditing
                ? 'Update customer contact details, address, or account notes.'
                : 'Add a new customer record to your active organization directory.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs max-h-[75vh] overflow-y-auto">
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
            <label htmlFor="customer-form-name" className="block font-medium text-slate-700 mb-1">
              Full Name <span className="text-red-600">*</span>
            </label>
            <input
              id="customer-form-name"
              type="text"
              required
              aria-required="true"
              maxLength={200}
              value={form.name}
              onChange={(e) => {
                setFormError(null);
                setForm((prev) => ({ ...prev, name: e.target.value }));
              }}
              placeholder="e.g. Amina Bello"
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="customer-form-phone" className="block font-medium text-slate-700 mb-1">
                Phone <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="customer-form-phone"
                type="tel"
                maxLength={60}
                value={form.phone}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, phone: e.target.value }));
                }}
                placeholder="e.g. +234 800 000 0000"
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="customer-form-email" className="block font-medium text-slate-700 mb-1">
                Email <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="customer-form-email"
                type="email"
                maxLength={200}
                value={form.email}
                onChange={(e) => {
                  setFormError(null);
                  setForm((prev) => ({ ...prev, email: e.target.value }));
                }}
                placeholder="e.g. amina@example.com"
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label htmlFor="customer-form-address" className="block font-medium text-slate-700 mb-1">
              Address <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="customer-form-address"
              rows={2}
              maxLength={500}
              value={form.address}
              onChange={(e) => {
                setFormError(null);
                setForm((prev) => ({ ...prev, address: e.target.value }));
              }}
              placeholder="Street address, city, or delivery instructions..."
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label htmlFor="customer-form-notes" className="block font-medium text-slate-700 mb-1">
              Notes <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="customer-form-notes"
              rows={3}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => {
                setFormError(null);
                setForm((prev) => ({ ...prev, notes: e.target.value }));
              }}
              placeholder="Account preferences, billing contacts, or internal notes..."
              className="w-full px-3 py-2 rounded-md border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            <span>
              {submitting
                ? isEditing
                  ? 'Saving...'
                  : 'Creating...'
                : isEditing
                  ? 'Save Changes'
                  : 'Create Customer'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

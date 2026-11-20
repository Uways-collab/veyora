import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CreditCard,
  Edit3,
  Plus,
  X,
} from 'lucide-react';
import type { OrganisationRole } from '../../core/types/domain';
import {
  archivePaymentMethod,
  createPaymentMethod,
  updatePaymentMethod,
} from './salesService';
import {
  canConfigurePaymentMethods,
  PAYMENT_METHOD_CODE_OPTIONS,
  type PaymentMethodCode,
  type PaymentMethodRecord,
} from './salesTypes';

interface PaymentMethodsPanelProps {
  organisationId: string;
  activeRole: OrganisationRole | null;
  paymentMethods: PaymentMethodRecord[];
  loading: boolean;
  error: string | null;
  onReload: () => Promise<void>;
}

export function PaymentMethodsPanel({
  organisationId,
  activeRole,
  paymentMethods,
  loading,
  error,
  onReload,
}: PaymentMethodsPanelProps) {
  const canConfigure = canConfigurePaymentMethods(activeRole);

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Create Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCode, setCreateCode] = useState<PaymentMethodCode>('cash');
  const [createRequiresRef, setCreateRequiresRef] = useState(false);

  // Edit Modal state
  const [editingMethod, setEditingMethod] = useState<PaymentMethodRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editRequiresRef, setEditRequiresRef] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);

  // Archive Modal state
  const [archivingMethod, setArchivingMethod] = useState<PaymentMethodRecord | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const filteredMethods = useMemo(() => {
    return paymentMethods.filter((method) => {
      if (statusFilter === 'active') return method.isActive;
      if (statusFilter === 'archived') return !method.isActive;
      return true;
    });
  }, [paymentMethods, statusFilter]);

  if (!canConfigure) {
    return (
      <section
        role="alert"
        className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex items-start gap-2.5 text-xs text-amber-900"
      >
        <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          Payment method configuration is restricted to Organization Owners and Admins.
        </div>
      </section>
    );
  }

  const openCreate = () => {
    setFeedback(null);
    setCreateName('');
    setCreateCode('cash');
    setCreateRequiresRef(false);
    setShowCreateModal(true);
  };

  const openEdit = (method: PaymentMethodRecord) => {
    setFeedback(null);
    setEditingMethod(method);
    setEditName(method.name);
    setEditRequiresRef(
      method.methodCode === 'bank_transfer' ? true : method.requiresReference
    );
    setEditIsActive(method.isActive);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setFeedback({ type: 'error', message: 'Payment method name is required.' });
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const requiresReference =
        createCode === 'bank_transfer' ? true : createRequiresRef;
      const result = await createPaymentMethod(organisationId, {
        name: trimmedName,
        methodCode: createCode,
        requiresReference,
      });

      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      setShowCreateModal(false);
      setFeedback({
        type: 'success',
        message: `Payment method "${trimmedName}" created.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMethod || submitLockRef.current || submitting) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setFeedback({ type: 'error', message: 'Payment method name is required.' });
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const requiresReference =
        editingMethod.methodCode === 'bank_transfer' ? true : editRequiresRef;
      const result = await updatePaymentMethod(organisationId, {
        paymentMethodId: editingMethod.id,
        name: trimmedName,
        requiresReference,
        isActive: editIsActive,
      });

      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        return;
      }

      setEditingMethod(null);
      setFeedback({
        type: 'success',
        message: `Payment method "${trimmedName}" updated.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archivingMethod || submitLockRef.current || submitting) return;

    submitLockRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const result = await archivePaymentMethod(organisationId, archivingMethod.id);
      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        setArchivingMethod(null);
        return;
      }

      const archivedName = archivingMethod.name;
      setArchivingMethod(null);
      setFeedback({
        type: 'success',
        message: `Payment method "${archivedName}" archived.`,
      });
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <section
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 flex items-start gap-2.5 text-xs ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          {feedback.type === 'error' ? (
            <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span className="font-medium">{feedback.message}</span>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Payment Methods</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure checkout and refund tender methods for your organization. Methods are archived rather than deleted to preserve audit history.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | 'active' | 'archived')
              }
              aria-label="Filter payment methods by status"
              className="px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All ({paymentMethods.length})</option>
              <option value="active">
                Active ({paymentMethods.filter((m) => m.isActive).length})
              </option>
              <option value="archived">
                Archived ({paymentMethods.filter((m) => !m.isActive).length})
              </option>
            </select>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Method</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-2.5" aria-busy="true">
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 rounded animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-6 text-xs text-amber-800 bg-amber-50/60">
            Unable to load payment methods: {error}
          </div>
        ) : filteredMethods.length === 0 ? (
          <div className="p-10 text-center space-y-1.5">
            <CreditCard className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
            <div className="text-xs font-semibold text-slate-900">
              No payment methods found
            </div>
            <p className="text-xs text-slate-500">
              Add a payment method such as Cash, Bank Transfer, or Card / POS to start taking payments.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 whitespace-nowrap">Method Name</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Type Code</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Reference Rule</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredMethods.map((method) => {
                  const refForced = method.methodCode === 'bank_transfer';
                  return (
                    <tr key={method.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {method.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {method.methodCodeLabel}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {method.requiresReference || refForced ? (
                          <span className="text-amber-800 font-medium">
                            Reference compulsory{refForced ? ' (Bank transfer policy)' : ''}
                          </span>
                        ) : (
                          <span className="text-slate-500">Reference optional</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            method.isActive ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {method.isActive ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(method)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 className="h-3 w-3" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          {method.isActive && (
                            <button
                              type="button"
                              onClick={() => {
                                setFeedback(null);
                                setArchivingMethod(method);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-600 hover:text-amber-800 hover:border-amber-300"
                            >
                              <Archive className="h-3 w-3" aria-hidden="true" />
                              <span>Archive</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-pm-title"
        >
          <form
            onSubmit={handleCreateSubmit}
            className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 id="create-pm-title" className="text-sm font-semibold text-slate-900">
                Add Payment Method
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label htmlFor="pm-create-name" className="block font-medium text-slate-700 mb-1">
                  Display Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="pm-create-name"
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. GTBank Transfer, Main Cash Drawer, OPay POS"
                  className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label htmlFor="pm-create-code" className="block font-medium text-slate-700 mb-1">
                  Method Type <span className="text-red-600">*</span>
                </label>
                <select
                  id="pm-create-code"
                  value={createCode}
                  onChange={(e) => {
                    const nextCode = e.target.value as PaymentMethodCode;
                    setCreateCode(nextCode);
                    const opt = PAYMENT_METHOD_CODE_OPTIONS.find((o) => o.value === nextCode);
                    setCreateRequiresRef(opt?.defaultRequiresReference ?? false);
                  }}
                  className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {PAYMENT_METHOD_CODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {PAYMENT_METHOD_CODE_OPTIONS.find((o) => o.value === createCode)?.description}
                </p>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-md border border-slate-200 bg-slate-50/70">
                <input
                  type="checkbox"
                  checked={createCode === 'bank_transfer' ? true : createRequiresRef}
                  disabled={createCode === 'bank_transfer'}
                  onChange={(e) => setCreateRequiresRef(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>
                  <span className="font-medium text-slate-900 block">
                    Require payment reference
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {createCode === 'bank_transfer'
                      ? 'Bank transfer transactions always require a reference.'
                      : 'When enabled, cashiers must enter a reference number for this method.'}
                  </span>
                </span>
              </label>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Method'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Modal */}
      {editingMethod && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-pm-title"
        >
          <form
            onSubmit={handleEditSubmit}
            className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 id="edit-pm-title" className="text-sm font-semibold text-slate-900">
                Edit Payment Method
              </h3>
              <button
                type="button"
                onClick={() => setEditingMethod(null)}
                aria-label="Close modal"
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label htmlFor="pm-edit-name" className="block font-medium text-slate-700 mb-1">
                  Display Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="pm-edit-name"
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="text-[11px] text-slate-500">
                Type Code: <span className="font-medium text-slate-700">{editingMethod.methodCodeLabel}</span>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-md border border-slate-200 bg-slate-50/70">
                <input
                  type="checkbox"
                  checked={editingMethod.methodCode === 'bank_transfer' ? true : editRequiresRef}
                  disabled={editingMethod.methodCode === 'bank_transfer'}
                  onChange={(e) => setEditRequiresRef(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>
                  <span className="font-medium text-slate-900 block">
                    Require payment reference
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {editingMethod.methodCode === 'bank_transfer'
                      ? 'Bank transfer methods always require a payment reference.'
                      : 'Require a transaction reference when selecting this tender.'}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-md border border-slate-200 bg-slate-50/70">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span>
                  <span className="font-medium text-slate-900 block">Active for checkout</span>
                  <span className="text-[11px] text-slate-500">
                    Inactive methods remain visible in historical reports and receipts.
                  </span>
                </span>
              </label>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMethod(null)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Archive Confirmation Modal */}
      {archivingMethod && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-pm-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 id="archive-pm-title" className="text-sm font-semibold text-slate-900">
                Archive Payment Method
              </h3>
            </div>
            <div className="p-5 text-xs text-slate-600 space-y-2">
              <p>
                Archive <span className="font-semibold text-slate-900">{archivingMethod.name}</span>?
              </p>
              <p>
                Archived methods are hidden from new POS checkouts and refunds, while all historical sales and payment records remain intact.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchivingMethod(null)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmArchive()}
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-amber-700 text-white text-xs font-semibold hover:bg-amber-800 disabled:opacity-50"
              >
                {submitting ? 'Archiving...' : 'Archive Method'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

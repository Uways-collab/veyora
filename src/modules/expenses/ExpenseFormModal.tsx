import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { generateIdempotencyKey, roundMoney } from '../sales/salesFormatters';
import { isPaymentReferenceRequired, type PaymentMethodRecord } from '../sales/salesTypes';
import {
  extractReceiptFileName,
  getTodayDateInputValue,
} from './expensesFormatters';
import {
  createExpense,
  createExpenseReceiptSignedUrl,
  updateExpense,
  uploadExpenseReceipt,
  validateExpenseReceiptFile,
} from './expensesService';
import type { ExpenseCategoryRecord, ExpenseRecord } from './expensesTypes';

interface ExpenseFormModalProps {
  open: boolean;
  organisationId: string;
  currencyCode: string;
  timeZone?: string | null;
  categories: ExpenseCategoryRecord[];
  paymentMethods: PaymentMethodRecord[];
  editingExpense: ExpenseRecord | null;
  canManageCategories: boolean;
  onOpenCategoriesTab?: () => void;
  onClose: () => void;
  onSuccess: (expense: ExpenseRecord, mode: 'create' | 'edit') => Promise<void> | void;
}

export function ExpenseFormModal({
  open,
  organisationId,
  currencyCode,
  timeZone,
  categories,
  paymentMethods,
  editingExpense,
  canManageCategories,
  onOpenCategoriesTab,
  onClose,
  onSuccess,
}: ExpenseFormModalProps) {
  const isEditMode = Boolean(editingExpense);
  const effectiveCurrency = (editingExpense?.currencyCode || currencyCode || 'USD').toUpperCase();

  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [vendorPayee, setVendorPayee] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [editReason, setEditReason] = useState('');

  // Receipt attachment state
  const [existingReceiptPath, setExistingReceiptPath] = useState<string | null>(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFileMeta, setUploadedFileMeta] = useState<{
    signature: string;
    storagePath: string;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectableCategories = useMemo(() => {
    const active = categories.filter((c) => c.isActive);
    if (
      editingExpense &&
      editingExpense.categoryId &&
      !active.some((c) => c.id === editingExpense.categoryId)
    ) {
      const archivedMatch = categories.find((c) => c.id === editingExpense.categoryId);
      if (archivedMatch) {
        return [archivedMatch, ...active];
      }
      return [
        {
          id: editingExpense.categoryId,
          organizationId: organisationId,
          name: editingExpense.categoryNameSnapshot,
          description: null,
          isActive: false,
          isSystem: false,
          createdBy: null,
          createdAt: editingExpense.createdAt,
          updatedAt: editingExpense.updatedAt,
        } satisfies ExpenseCategoryRecord,
        ...active,
      ];
    }
    return active;
  }, [categories, editingExpense, organisationId]);

  const selectableMethods = useMemo(() => {
    const active = paymentMethods.filter((m) => m.isActive);
    if (
      editingExpense &&
      editingExpense.paymentMethodId &&
      !active.some((m) => m.id === editingExpense.paymentMethodId)
    ) {
      return [
        {
          id: editingExpense.paymentMethodId,
          organizationId: organisationId,
          name: editingExpense.paymentMethodNameSnapshot,
          methodCode:
            (editingExpense.paymentMethodCodeSnapshot as PaymentMethodRecord['methodCode']) ||
            'other',
          methodCodeLabel: editingExpense.paymentMethodNameSnapshot,
          requiresReference: editingExpense.paymentMethodCodeSnapshot === 'bank_transfer',
          isActive: false,
          isSystem: false,
          createdAt: editingExpense.createdAt,
          updatedAt: editingExpense.updatedAt,
        } satisfies PaymentMethodRecord,
        ...active,
      ];
    }
    return active;
  }, [paymentMethods, editingExpense, organisationId]);

  const selectedMethod = useMemo(
    () => selectableMethods.find((m) => m.id === paymentMethodId) ?? null,
    [selectableMethods, paymentMethodId]
  );
  const referenceRequired = isPaymentReferenceRequired(selectedMethod);

  // Initialize form cleanly whenever opened or mode changes
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSubmitting(false);
    submitLockRef.current = false;
    idempotencyRef.current = null;
    setSelectedFile(null);
    setUploadedFileMeta(null);
    setExistingReceiptUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (editingExpense) {
      setCategoryId(editingExpense.categoryId);
      setPaymentMethodId(editingExpense.paymentMethodId);
      setExpenseDate(editingExpense.expenseDate || getTodayDateInputValue(timeZone));
      setAmount(editingExpense.amount.toFixed(2));
      setDescription(editingExpense.description);
      setVendorPayee(editingExpense.vendorPayee ?? '');
      setReference(editingExpense.reference ?? '');
      setNotes(editingExpense.notes ?? '');
      setEditReason('');
      setExistingReceiptPath(editingExpense.receiptStoragePath);
    } else {
      setCategoryId(selectableCategories[0]?.id ?? '');
      setPaymentMethodId(selectableMethods[0]?.id ?? '');
      setExpenseDate(getTodayDateInputValue(timeZone));
      setAmount('');
      setDescription('');
      setVendorPayee('');
      setReference('');
      setNotes('');
      setEditReason('');
      setExistingReceiptPath(null);
    }
  }, [
    open,
    editingExpense,
    timeZone,
    // Deliberately keep category/method defaults aligned on open
    selectableCategories.length,
    selectableMethods.length,
  ]);

  // Load signed URL if editing expense has an existing receipt attachment
  useEffect(() => {
    let active = true;
    if (!open || !existingReceiptPath || !organisationId) {
      setExistingReceiptUrl(null);
      return;
    }
    void createExpenseReceiptSignedUrl(organisationId, existingReceiptPath).then((res) => {
      if (active && res.signedUrl) {
        setExistingReceiptUrl(res.signedUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [open, existingReceiptPath, organisationId]);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      setUploadedFileMeta(null);
      return;
    }
    const validationError = validateExpenseReceiptFile(file);
    if (validationError) {
      setFormError(validationError);
      setSelectedFile(null);
      setUploadedFileMeta(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    setFormError(null);
    setSelectedFile(file);
    setUploadedFileMeta(null);
  };

  const handleClearReceipt = () => {
    setSelectedFile(null);
    setUploadedFileMeta(null);
    setExistingReceiptPath(null);
    setExistingReceiptUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;

    if (!categoryId) {
      setFormError('Please select an expense category.');
      return;
    }
    if (!paymentMethodId) {
      setFormError('Please select a payment method.');
      return;
    }
    if (!expenseDate) {
      setFormError('Please select an expense date.');
      return;
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Expense amount must be greater than zero.');
      return;
    }
    const rounded = roundMoney(parsedAmount);
    if (Math.abs(parsedAmount - rounded) > 0.0001) {
      setFormError('Expense amount can have at most two decimal places.');
      return;
    }

    const cleanDescription = description.trim();
    if (!cleanDescription) {
      setFormError('Please provide an expense description.');
      return;
    }
    if (cleanDescription.length > 500) {
      setFormError('Description must be 500 characters or fewer.');
      return;
    }

    const cleanVendor = vendorPayee.trim() || null;
    if (cleanVendor && cleanVendor.length > 200) {
      setFormError('Vendor / payee must be 200 characters or fewer.');
      return;
    }

    const cleanReference = reference.trim() || null;
    if (referenceRequired && !cleanReference) {
      setFormError(`A payment reference is required for ${selectedMethod?.name ?? 'this payment method'}.`);
      return;
    }
    if (cleanReference && cleanReference.length > 150) {
      setFormError('Payment reference must be 150 characters or fewer.');
      return;
    }

    const cleanNotes = notes.trim() || null;
    if (cleanNotes && cleanNotes.length > 2000) {
      setFormError('Notes must be 2000 characters or fewer.');
      return;
    }

    const cleanEditReason = editReason.trim();
    if (isEditMode && !cleanEditReason) {
      setFormError('Please provide an edit reason for the audit log.');
      return;
    }
    if (isEditMode && cleanEditReason.length > 500) {
      setFormError('Edit reason must be 500 characters or fewer.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      let receiptStoragePath = existingReceiptPath;

      if (selectedFile) {
        const fileSignature = `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`;
        if (uploadedFileMeta && uploadedFileMeta.signature === fileSignature) {
          receiptStoragePath = uploadedFileMeta.storagePath;
        } else {
          const uploadRes = await uploadExpenseReceipt(organisationId, selectedFile);
          if (uploadRes.error || !uploadRes.storagePath) {
            setFormError(uploadRes.error ?? 'Unable to upload receipt attachment.');
            return;
          }
          receiptStoragePath = uploadRes.storagePath;
          setUploadedFileMeta({
            signature: fileSignature,
            storagePath: uploadRes.storagePath,
          });
        }
      }

      if (isEditMode && editingExpense) {
        const res = await updateExpense(
          organisationId,
          {
            expenseId: editingExpense.id,
            categoryId,
            paymentMethodId,
            expenseDate,
            amount: rounded,
            description: cleanDescription,
            editReason: cleanEditReason,
            vendorPayee: cleanVendor,
            reference: cleanReference,
            notes: cleanNotes,
            receiptStoragePath,
          },
          effectiveCurrency
        );

        if (res.error || !res.expense) {
          setFormError(res.error ?? 'Unable to update expense.');
          return;
        }

        await onSuccess(res.expense, 'edit');
        return;
      }

      // Create mode: deterministic per-payload idempotency key (reused on retry of same payload, never reused after success)
      const payloadSignature = JSON.stringify({
        organisationId,
        categoryId,
        paymentMethodId,
        expenseDate,
        amount: rounded,
        description: cleanDescription,
        vendorPayee: cleanVendor,
        reference: cleanReference,
        notes: cleanNotes,
        receiptStoragePath,
      });

      if (!idempotencyRef.current || idempotencyRef.current.signature !== payloadSignature) {
        idempotencyRef.current = {
          signature: payloadSignature,
          key: generateIdempotencyKey(),
        };
      }

      const res = await createExpense(
        organisationId,
        {
          categoryId,
          paymentMethodId,
          expenseDate,
          amount: rounded,
          description: cleanDescription,
          idempotencyKey: idempotencyRef.current.key,
          vendorPayee: cleanVendor,
          reference: cleanReference,
          notes: cleanNotes,
          receiptStoragePath,
        },
        effectiveCurrency
      );

      if (res.error || !res.expense) {
        setFormError(res.error ?? 'Unable to record expense.');
        return;
      }

      idempotencyRef.current = null;
      await onSuccess(res.expense, 'create');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const noCategoriesAvailable = selectableCategories.length === 0;
  const noPaymentMethodsAvailable = selectableMethods.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-form-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 id="expense-form-modal-title" className="text-sm font-semibold text-slate-900">
              {isEditMode
                ? `Edit Expense · ${editingExpense?.expenseNumber ?? ''}`
                : 'Record Business Expense'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditMode
                ? `Update recorded expense details (${effectiveCurrency}). All edits are logged with a reason.`
                : `Currency: ${effectiveCurrency}. Expense numbers are assigned automatically on save.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close expense form"
            className="p-1.5 rounded text-slate-400 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {formError && (
            <div
              role="alert"
              className="p-3 rounded-md bg-red-50 border border-red-200 text-red-900 flex items-start gap-2"
            >
              <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {noCategoriesAvailable && (
            <div className="p-3.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 flex flex-wrap items-center justify-between gap-2">
              <span>
                {canManageCategories
                  ? 'No active expense categories exist yet. Create an expense category first.'
                  : 'No active expense categories exist yet. Ask an Owner, Admin, or Manager to create one.'}
              </span>
              {canManageCategories && onOpenCategoriesTab && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenCategoriesTab();
                  }}
                  className="px-2.5 py-1 rounded-md border border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-50 whitespace-nowrap"
                >
                  Manage Categories
                </button>
              )}
            </div>
          )}

          {noPaymentMethodsAvailable && (
            <div className="p-3.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900">
              No active payment methods are configured for this organization.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Category */}
            <div>
              <label
                htmlFor="expense-category-select"
                className="block font-medium text-slate-700 mb-1"
              >
                Category <span className="text-red-600">*</span>
              </label>
              <select
                id="expense-category-select"
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={submitting || noCategoriesAvailable}
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              >
                <option value="">Select category...</option>
                {selectableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                    {cat.isActive ? '' : ' (Archived)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment Method */}
            <div>
              <label
                htmlFor="expense-payment-method-select"
                className="block font-medium text-slate-700 mb-1"
              >
                Payment Method <span className="text-red-600">*</span>
              </label>
              <select
                id="expense-payment-method-select"
                required
                value={paymentMethodId}
                onChange={(e) => setPaymentMethodId(e.target.value)}
                disabled={submitting || noPaymentMethodsAvailable}
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              >
                <option value="">Select payment method...</option>
                {selectableMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                    {method.isActive ? '' : ' (Inactive)'}
                  </option>
                ))}
              </select>
            </div>

            {/* Expense Date */}
            <div>
              <label
                htmlFor="expense-date-input"
                className="block font-medium text-slate-700 mb-1"
              >
                Expense Date <span className="text-red-600">*</span>
              </label>
              <input
                id="expense-date-input"
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                disabled={submitting}
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Amount (No Tax Fields) */}
            <div>
              <label
                htmlFor="expense-amount-input"
                className="block font-medium text-slate-700 mb-1"
              >
                Amount ({effectiveCurrency}) <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-medium text-slate-500">
                  {effectiveCurrency}
                </span>
                <input
                  id="expense-amount-input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitting}
                  placeholder="0.00"
                  className="w-full pl-12 pr-3 py-2 rounded-md border border-slate-200 bg-white font-mono text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="expense-description-input"
              className="block font-medium text-slate-700 mb-1"
            >
              Description <span className="text-red-600">*</span>
            </label>
            <input
              id="expense-description-input"
              type="text"
              required
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              placeholder="e.g., Monthly warehouse electricity bill or office stationery restock"
              className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Vendor / Payee */}
            <div>
              <label
                htmlFor="expense-vendor-input"
                className="block font-medium text-slate-700 mb-1"
              >
                Vendor / Payee <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="expense-vendor-input"
                type="text"
                maxLength={200}
                value={vendorPayee}
                onChange={(e) => setVendorPayee(e.target.value)}
                disabled={submitting}
                placeholder="Supplier, utility provider, or payee name"
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Payment Reference */}
            <div>
              <label
                htmlFor="expense-reference-input"
                className="block font-medium text-slate-700 mb-1"
              >
                Payment Reference{' '}
                {referenceRequired ? (
                  <span className="text-red-600">*</span>
                ) : (
                  <span className="text-slate-400 font-normal">(optional)</span>
                )}
              </label>
              <input
                id="expense-reference-input"
                type="text"
                required={referenceRequired}
                maxLength={150}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                disabled={submitting}
                placeholder={
                  referenceRequired
                    ? `Required transfer / transaction reference for ${selectedMethod?.name ?? 'method'}`
                    : 'Transaction or invoice reference'
                }
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="expense-notes-input" className="block font-medium text-slate-700 mb-1">
              Notes <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="expense-notes-input"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              placeholder="Internal context, approval notes, or split allocation details..."
              className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Receipt Attachment (Organization-Scoped Private Storage) */}
          <div className="space-y-2">
            <label
              htmlFor="expense-receipt-input"
              className="block font-medium text-slate-700"
            >
              Receipt Attachment <span className="text-slate-400 font-normal">(optional, PNG/JPG/WebP/PDF max 5 MB)</span>
            </label>

            <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-md border border-slate-200 bg-slate-50/70">
              <label
                htmlFor="expense-receipt-input"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{selectedFile || existingReceiptPath ? 'Replace File' : 'Attach Receipt'}</span>
              </label>
              <input
                ref={fileInputRef}
                id="expense-receipt-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={handleFileChange}
                disabled={submitting}
                className="sr-only"
              />

              {selectedFile ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Paperclip className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span className="font-mono text-[11px] text-slate-800 truncate">
                    {selectedFile.name} ({Math.max(1, Math.round(selectedFile.size / 1024))} KB)
                  </span>
                  <button
                    type="button"
                    onClick={handleClearReceipt}
                    disabled={submitting}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              ) : existingReceiptPath ? (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Paperclip className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                  <span className="font-mono text-[11px] text-slate-800 truncate">
                    {extractReceiptFileName(existingReceiptPath)}
                  </span>
                  {existingReceiptUrl && (
                    <a
                      href={existingReceiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                    >
                      <span>View</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleClearReceipt}
                    disabled={submitting}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-red-700 hover:text-red-800 whitespace-nowrap"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    <span>Remove</span>
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-slate-500">
                  Stored privately in organization-scoped storage.
                </span>
              )}
            </div>
          </div>

          {/* Mandatory Edit Reason (Edit Mode Only) */}
          {isEditMode && (
            <div>
              <label
                htmlFor="expense-edit-reason-input"
                className="block font-medium text-slate-700 mb-1"
              >
                Edit Reason <span className="text-red-600">*</span>
              </label>
              <textarea
                id="expense-edit-reason-input"
                rows={2}
                required
                maxLength={500}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                disabled={submitting}
                placeholder="Explain why this recorded expense is being updated..."
                className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
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
            disabled={submitting || noCategoriesAvailable || noPaymentMethodsAvailable}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            <span>
              {submitting
                ? isEditMode
                  ? 'Saving Changes...'
                  : 'Recording Expense...'
                : isEditMode
                  ? 'Save Changes'
                  : 'Record Expense'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

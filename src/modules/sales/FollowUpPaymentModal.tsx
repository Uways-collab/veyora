import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatMoneyAmount } from '../inventory/inventoryService';
import { generateIdempotencyKey, roundMoney } from './salesFormatters';
import { recordFollowUpPayment } from './salesService';
import {
  isPaymentReferenceRequired,
  type PaymentMethodRecord,
} from './salesTypes';

export interface FollowUpPaymentSaleInfo {
  id: string;
  saleNumber: string;
  status: string;
  outstandingAmount: number;
  currency: string;
  customerName?: string | null;
}

interface FollowUpPaymentModalProps {
  organisationId: string;
  currencyCode: string;
  sale: FollowUpPaymentSaleInfo | null;
  activeMethods: PaymentMethodRecord[];
  methodsLoading?: boolean;
  methodsError?: string | null;
  onClose: () => void;
  onSuccess: (details: {
    saleId: string;
    saleNumber: string;
    amount: number;
    currency: string;
    paymentId: string | null;
  }) => void | Promise<void>;
}

function pickDefaultPaymentMethod(methods: PaymentMethodRecord[]): PaymentMethodRecord | null {
  return methods.find((m) => m.methodCode === 'cash') ?? methods[0] ?? null;
}

export function FollowUpPaymentModal({
  organisationId,
  currencyCode,
  sale,
  activeMethods,
  methodsLoading = false,
  methodsError = null,
  onClose,
  onSuccess,
}: FollowUpPaymentModalProps) {
  const [payMethodId, setPayMethodId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payConfirmStep, setPayConfirmStep] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitLockRef = useRef(false);
  const payIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const saleId = sale?.id ?? null;
  const saleOutstanding = sale?.outstandingAmount ?? 0;

  // Reset form state whenever target sale or organization changes
  useEffect(() => {
    if (!saleId) {
      setPayMethodId('');
      setPayAmount('');
      setPayReference('');
      setPayConfirmStep(false);
      setModalError(null);
      setSubmitting(false);
      submitLockRef.current = false;
      payIdempotencyRef.current = null;
      return;
    }

    const def = pickDefaultPaymentMethod(activeMethods);
    setPayMethodId(def?.id ?? '');
    setPayAmount(saleOutstanding > 0 ? String(saleOutstanding) : '');
    setPayReference('');
    setPayConfirmStep(false);
    setModalError(null);
    setSubmitting(false);
    submitLockRef.current = false;
    payIdempotencyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organisationId, saleId]);

  // Ensure a valid default method is selected if activeMethods loads asynchronously
  useEffect(() => {
    if (!saleId) return;
    setPayMethodId((prev) => {
      if (prev && activeMethods.some((m) => m.id === prev)) return prev;
      return pickDefaultPaymentMethod(activeMethods)?.id ?? '';
    });
  }, [saleId, activeMethods]);

  useEffect(() => {
    if (!sale) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sale, submitting, onClose]);

  const selectedPayMethod = useMemo(
    () => activeMethods.find((m) => m.id === payMethodId) ?? null,
    [activeMethods, payMethodId]
  );

  if (!sale) return null;

  const saleCurrency = sale.currency || currencyCode;

  const validateFollowUpPayment = (): string | null => {
    if (sale.status !== 'completed') {
      return 'Follow-up payments can only be recorded for completed sales.';
    }
    if (sale.outstandingAmount <= 0) {
      return 'This sale has no outstanding balance.';
    }
    if (!payMethodId || !selectedPayMethod) {
      return 'Select an active payment method.';
    }
    const amt = roundMoney(Number(payAmount));
    if (!Number.isFinite(amt) || amt <= 0) {
      return 'Payment amount must be greater than zero.';
    }
    if (amt > sale.outstandingAmount) {
      return `Payment amount cannot exceed outstanding balance (${formatMoneyAmount(
        sale.outstandingAmount,
        saleCurrency
      )}).`;
    }
    if (isPaymentReferenceRequired(selectedPayMethod) && !payReference.trim()) {
      return `A payment reference is required for "${selectedPayMethod.name}".`;
    }
    return null;
  };

  const handleReviewFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const err = validateFollowUpPayment();
    if (err) {
      setModalError(err);
      return;
    }
    setPayConfirmStep(true);
  };

  const handleConfirmFollowUp = async () => {
    if (submitLockRef.current || submitting) return;
    const err = validateFollowUpPayment();
    if (err) {
      setModalError(err);
      setPayConfirmStep(false);
      return;
    }

    const amt = roundMoney(Number(payAmount));
    const ref = payReference.trim() || null;
    const signature = JSON.stringify({
      organisationId,
      saleId: sale.id,
      payMethodId,
      amt,
      ref,
    });

    if (!payIdempotencyRef.current || payIdempotencyRef.current.signature !== signature) {
      payIdempotencyRef.current = {
        signature,
        key: generateIdempotencyKey(),
      };
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setModalError(null);

    try {
      const result = await recordFollowUpPayment(organisationId, {
        saleId: sale.id,
        paymentMethodId: payMethodId,
        amount: amt,
        reference: ref,
        idempotencyKey: payIdempotencyRef.current.key,
      });

      if (!isMountedRef.current) return;

      if (result.error) {
        setModalError(result.error);
        setPayConfirmStep(false);
        return;
      }

      payIdempotencyRef.current = null;
      await onSuccess({
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        amount: amt,
        currency: saleCurrency,
        paymentId: result.paymentId,
      });
    } finally {
      submitLockRef.current = false;
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="follow-up-pay-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="follow-up-pay-title" className="text-sm font-semibold text-slate-900">
              Record Follow-Up Payment
            </h3>
            <p className="text-xs font-mono text-slate-500 truncate">
              {sale.saleNumber}
              {sale.customerName ? ` · ${sale.customerName}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!submitting) onClose();
            }}
            disabled={submitting}
            aria-label="Close modal"
            className="p-1 rounded text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {(modalError || methodsError) && (
          <div className="mx-5 mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-900">
            {modalError ?? methodsError}
          </div>
        )}

        {!payConfirmStep ? (
          <form onSubmit={handleReviewFollowUp}>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-md bg-slate-50 border border-slate-200 flex justify-between items-center">
                <span className="text-slate-600">Outstanding Balance</span>
                <span className="font-mono text-sm font-semibold text-amber-700 tabular-nums">
                  {formatMoneyAmount(sale.outstandingAmount, saleCurrency)}
                </span>
              </div>

              <div>
                <label
                  htmlFor="followup-method"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Payment Method <span className="text-red-600">*</span>
                </label>
                <select
                  id="followup-method"
                  value={payMethodId}
                  onChange={(e) => setPayMethodId(e.target.value)}
                  required
                  disabled={methodsLoading}
                  className="w-full px-3 py-2 rounded-md border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
                >
                  {methodsLoading ? (
                    <option value="">Loading payment methods...</option>
                  ) : activeMethods.length === 0 ? (
                    <option value="">No active payment methods</option>
                  ) : (
                    activeMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="followup-amount" className="font-medium text-slate-700">
                    Amount ({saleCurrency}) <span className="text-red-600">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPayAmount(String(sale.outstandingAmount))}
                    className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                  >
                    Full Balance
                  </button>
                </div>
                <input
                  id="followup-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={sale.outstandingAmount}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-slate-200 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="followup-ref"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Payment Reference{' '}
                  {isPaymentReferenceRequired(selectedPayMethod) ? (
                    <span className="text-red-600">*</span>
                  ) : (
                    <span className="text-slate-400">(optional)</span>
                  )}
                </label>
                <input
                  id="followup-ref"
                  type="text"
                  required={isPaymentReferenceRequired(selectedPayMethod)}
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder={
                    isPaymentReferenceRequired(selectedPayMethod)
                      ? 'Required transaction reference'
                      : 'Optional reference'
                  }
                  className="w-full px-3 py-2 rounded-md border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={methodsLoading || activeMethods.length === 0}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                Review Payment
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-600">
                Confirm recording this follow-up payment for{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {sale.saleNumber}
                </span>
                :
              </p>
              <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment Method</span>
                  <span className="font-medium text-slate-900">
                    {selectedPayMethod?.name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount Collected</span>
                  <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                    {formatMoneyAmount(roundMoney(Number(payAmount)), saleCurrency)}
                  </span>
                </div>
                {payReference.trim() && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reference</span>
                    <span className="font-mono text-slate-900 break-all">
                      {payReference.trim()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-slate-200">
                  <span className="text-slate-500">Remaining Balance After</span>
                  <span className="font-mono font-medium text-slate-900 tabular-nums">
                    {formatMoneyAmount(
                      roundMoney(Math.max(0, sale.outstandingAmount - Number(payAmount))),
                      saleCurrency
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayConfirmStep(false)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmFollowUp()}
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? 'Recording...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

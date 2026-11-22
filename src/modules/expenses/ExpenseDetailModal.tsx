import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Edit3,
  ExternalLink,
  History,
  Loader2,
  Paperclip,
  RefreshCw,
  X,
} from 'lucide-react';
import { formatMoneyAmount } from '../inventory/inventoryService';
import { formatPaymentMethodCodeLabel } from '../sales/salesFormatters';
import {
  extractReceiptFileName,
  formatAuditActionLabel,
  formatAuditFieldLabel,
  formatExpenseDate,
  formatExpenseDateTime,
  formatExpenseStatusLabel,
  isImageReceiptPath,
} from './expensesFormatters';
import {
  createExpenseReceiptSignedUrl,
  fetchExpenseDetail,
  voidExpense,
} from './expensesService';
import type { ExpenseAuditLogRecord, ExpenseRecord } from './expensesTypes';

interface ExpenseDetailModalProps {
  expenseId: string | null;
  organisationId: string;
  currencyCode: string;
  timeZone?: string | null;
  canManage: boolean;
  refreshToken?: number;
  onClose: () => void;
  onEdit: (expense: ExpenseRecord) => void;
  onVoidSuccess: (expense: ExpenseRecord) => Promise<void> | void;
}

function formatAuditValue(key: string, val: unknown, currencyCode: string): string {
  if (val === null || val === undefined || val === '') return '—';
  if (key === 'amount' && (typeof val === 'number' || typeof val === 'string')) {
    const num = Number(val);
    if (Number.isFinite(num)) {
      return formatMoneyAmount(num, currencyCode);
    }
  }
  if (key === 'expense_date' && typeof val === 'string') {
    return formatExpenseDate(val);
  }
  if (key === 'receipt_storage_path' && typeof val === 'string') {
    return extractReceiptFileName(val);
  }
  return String(val);
}

function getAuditChanges(
  log: ExpenseAuditLogRecord,
  currencyCode: string
): Array<{ field: string; from: string; to: string }> {
  if (log.action !== 'updated' || !log.previousValues || !log.newValues) return [];
  const changes: Array<{ field: string; from: string; to: string }> = [];
  const skipKeys = new Set([
    'category_id',
    'payment_method_id',
    'payment_method_code_snapshot',
  ]);

  const keys = new Set([
    ...Object.keys(log.previousValues),
    ...Object.keys(log.newValues),
  ]);

  for (const key of keys) {
    if (skipKeys.has(key)) continue;
    const prevRaw = log.previousValues[key];
    const nextRaw = log.newValues[key];
    if (JSON.stringify(prevRaw ?? null) !== JSON.stringify(nextRaw ?? null)) {
      changes.push({
        field: formatAuditFieldLabel(key),
        from: formatAuditValue(key, prevRaw, currencyCode),
        to: formatAuditValue(key, nextRaw, currencyCode),
      });
    }
  }
  return changes;
}

export function ExpenseDetailModal({
  expenseId,
  organisationId,
  currencyCode,
  timeZone,
  canManage,
  refreshToken = 0,
  onClose,
  onEdit,
  onVoidSuccess,
}: ExpenseDetailModalProps) {
  const [expense, setExpense] = useState<ExpenseRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<ExpenseAuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const [voidPanelOpen, setVoidPanelOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);
  const voidLockRef = useRef(false);

  const loadDetail = useCallback(async () => {
    if (!expenseId || !organisationId) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setLoadError(null);

    const res = await fetchExpenseDetail(organisationId, expenseId, currencyCode);
    if (seq !== requestSeqRef.current) return;

    setLoading(false);
    if (res.error || !res.expense) {
      setLoadError(res.error ?? 'Unable to load expense details.');
      setExpense(null);
      setAuditLogs([]);
      return;
    }

    setExpense(res.expense);
    setAuditLogs(res.auditLogs);
  }, [expenseId, organisationId, currencyCode]);

  useEffect(() => {
    if (!expenseId) {
      setExpense(null);
      setAuditLogs([]);
      setLoadError(null);
      setReceiptUrl(null);
      setReceiptError(null);
      setVoidPanelOpen(false);
      setVoidReason('');
      setVoidError(null);
      return;
    }
    setVoidPanelOpen(false);
    setVoidReason('');
    setVoidError(null);
    void loadDetail();
  }, [expenseId, refreshToken, loadDetail]);

  useEffect(() => {
    let active = true;
    const path = expense?.receiptStoragePath;
    if (!path || !organisationId) {
      setReceiptUrl(null);
      setReceiptError(null);
      setReceiptLoading(false);
      return;
    }

    setReceiptLoading(true);
    setReceiptError(null);
    void createExpenseReceiptSignedUrl(organisationId, path).then((res) => {
      if (!active) return;
      setReceiptLoading(false);
      if (res.error || !res.signedUrl) {
        setReceiptUrl(null);
        setReceiptError(res.error ?? 'Unable to load receipt preview.');
      } else {
        setReceiptUrl(res.signedUrl);
      }
    });

    return () => {
      active = false;
    };
  }, [expense?.receiptStoragePath, organisationId]);

  useEffect(() => {
    if (!expenseId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !voidSubmitting) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expenseId, voidSubmitting, onClose]);

  if (!expenseId) return null;

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expense || !canManage || voidLockRef.current || voidSubmitting) return;

    const cleanReason = voidReason.trim();
    if (!cleanReason) {
      setVoidError('A reason is required to void this expense.');
      return;
    }
    if (cleanReason.length > 500) {
      setVoidError('Void reason must be 500 characters or fewer.');
      return;
    }

    voidLockRef.current = true;
    setVoidSubmitting(true);
    setVoidError(null);

    try {
      const res = await voidExpense(
        organisationId,
        {
          expenseId: expense.id,
          reason: cleanReason,
        },
        expense.currencyCode || currencyCode
      );

      if (res.error || !res.expense) {
        setVoidError(res.error ?? 'Unable to void expense.');
        return;
      }

      setVoidPanelOpen(false);
      setVoidReason('');
      await loadDetail();
      await onVoidSuccess(res.expense);
    } finally {
      voidLockRef.current = false;
      setVoidSubmitting(false);
    }
  };

  const cur = expense?.currencyCode || currencyCode;
  const isRecorded = expense?.status === 'recorded';

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="expense-detail-title" className="text-sm font-semibold text-slate-900">
              Expense Details{' '}
              {expense && (
                <>
                  · <span className="font-mono">{expense.expenseNumber}</span>
                </>
              )}
            </h3>
            {expense && (
              <p className="text-xs text-slate-500 mt-0.5">
                {formatExpenseDate(expense.expenseDate)} · {expense.categoryNameSnapshot} ·{' '}
                <span
                  className={`font-medium ${
                    expense.status === 'voided' ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {formatExpenseStatusLabel(expense.status)}
                </span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {expense && canManage && isRecorded && (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(expense)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Edit Expense</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVoidError(null);
                    setVoidPanelOpen((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 bg-red-50 text-xs font-medium text-red-700 hover:bg-red-100 whitespace-nowrap"
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Void Expense</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={voidSubmitting}
              aria-label="Close expense details"
              className="p-1.5 rounded text-slate-400 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
              <span>Loading expense record and audit history...</span>
            </div>
          ) : loadError || !expense ? (
            <div className="p-4 rounded-md bg-red-50 border border-red-200 text-red-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{loadError ?? 'Expense record could not be loaded.'}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadDetail()}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-red-300 bg-white text-xs font-medium text-red-800 hover:bg-red-50"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <>
              {/* Voided Banner */}
              {expense.status === 'voided' && (
                <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-red-900 space-y-1">
                  <div className="font-semibold">This expense has been voided</div>
                  <div>
                    Voided {formatExpenseDateTime(expense.voidedAt, timeZone)}
                    {expense.voidedByName ? ` by ${expense.voidedByName}` : ''}
                  </div>
                  {expense.voidReason && <div>Reason: {expense.voidReason}</div>}
                  <div className="text-[11px] text-red-800 pt-0.5">
                    Voided expenses remain in the ledger for audit traceability and are excluded from expense totals.
                  </div>
                </div>
              )}

              {/* Void Expense Confirmation Panel (Authorized Users Only) */}
              {voidPanelOpen && canManage && isRecorded && (
                <form
                  onSubmit={handleConfirmVoid}
                  className="p-4 rounded-md border border-red-200 bg-red-50/70 space-y-3"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-red-900">
                      Confirm Void Expense ({expense.expenseNumber})
                    </div>
                    <p className="text-red-800 leading-relaxed">
                      Voiding permanently excludes this{' '}
                      <span className="font-mono font-medium">
                        {formatMoneyAmount(expense.amount, cur)}
                      </span>{' '}
                      expense from financial summaries while preserving the record and audit trail.
                    </p>
                  </div>

                  {voidError && (
                    <div className="p-2.5 rounded border border-red-300 bg-white text-red-900">
                      {voidError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="void-expense-reason"
                      className="block font-medium text-red-900 mb-1"
                    >
                      Void Reason <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      id="void-expense-reason"
                      rows={2}
                      required
                      maxLength={500}
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      disabled={voidSubmitting}
                      placeholder="e.g., Duplicate entry or cancelled supplier invoice..."
                      className="w-full px-3 py-2 rounded-md border border-red-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setVoidPanelOpen(false)}
                      disabled={voidSubmitting}
                      className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Keep Expense
                    </button>
                    <button
                      type="submit"
                      disabled={voidSubmitting}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-red-700 text-white text-xs font-medium hover:bg-red-800 disabled:opacity-50"
                    >
                      {voidSubmitting && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      )}
                      <span>{voidSubmitting ? 'Voiding...' : 'Confirm Void'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Primary Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Amount</div>
                  <div
                    className={`font-mono text-base font-semibold mt-0.5 tabular-nums ${
                      expense.status === 'voided'
                        ? 'line-through text-slate-400'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatMoneyAmount(expense.amount, cur)}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">{cur}</div>
                </div>

                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Category</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {expense.categoryNameSnapshot}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Date: {formatExpenseDate(expense.expenseDate)}
                  </div>
                </div>

                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Payment Method</div>
                  <div className="font-medium text-slate-900 mt-0.5">
                    {expense.paymentMethodNameSnapshot}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatPaymentMethodCodeLabel(expense.paymentMethodCodeSnapshot)}
                  </div>
                </div>

                <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
                  <div className="text-[11px] text-slate-500">Recorded By</div>
                  <div className="font-medium text-slate-900 mt-0.5 truncate">
                    {expense.recordedByName || 'Workspace user'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatExpenseDateTime(expense.createdAt, timeZone)}
                  </div>
                </div>
              </div>

              {/* Metadata & Description */}
              <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
                <div className="p-3.5 space-y-1">
                  <div className="text-[11px] font-medium text-slate-500">Description</div>
                  <div className="text-slate-900 font-medium">{expense.description}</div>
                </div>

                <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">Vendor / Payee</div>
                    <div className="text-slate-800 mt-0.5">{expense.vendorPayee || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">Payment Reference</div>
                    <div className="font-mono text-slate-800 mt-0.5">
                      {expense.reference || '—'}
                    </div>
                  </div>
                </div>

                {expense.notes && (
                  <div className="p-3.5 space-y-1">
                    <div className="text-[11px] font-medium text-slate-500">Notes</div>
                    <div className="text-slate-700 whitespace-pre-wrap">{expense.notes}</div>
                  </div>
                )}

                {expense.updatedAt && expense.updatedAt !== expense.createdAt && (
                  <div className="p-3.5 text-[11px] text-slate-500">
                    Last updated {formatExpenseDateTime(expense.updatedAt, timeZone)}
                    {expense.updatedByName ? ` by ${expense.updatedByName}` : ''}
                  </div>
                )}
              </div>

              {/* Receipt Attachment */}
              {expense.receiptStoragePath && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>Receipt Attachment</span>
                  </h4>
                  <div className="border border-slate-200 rounded-md p-3.5 bg-slate-50/60 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-700 break-all">
                        {extractReceiptFileName(expense.receiptStoragePath)}
                      </span>
                      {receiptLoading ? (
                        <span className="text-[11px] text-slate-500">Generating secure link...</span>
                      ) : receiptUrl ? (
                        <a
                          href={receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-blue-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <span>Open Receipt</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>

                    {receiptError && (
                      <div className="text-[11px] text-amber-800">{receiptError}</div>
                    )}

                    {receiptUrl && isImageReceiptPath(expense.receiptStoragePath) && (
                      <div className="border border-slate-200 rounded bg-white p-2 max-h-64 overflow-hidden flex items-center justify-center">
                        <img
                          src={receiptUrl}
                          alt={`Receipt for ${expense.expenseNumber}`}
                          referrerPolicy="no-referrer"
                          className="max-h-60 w-auto object-contain rounded"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Immutable Audit History */}
              <div className="space-y-2.5">
                <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Audit History ({auditLogs.length})</span>
                </h4>
                {auditLogs.length === 0 ? (
                  <p className="text-slate-500">No audit history entries recorded.</p>
                ) : (
                  <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
                    {auditLogs.map((log) => {
                      const changes = getAuditChanges(log, cur);
                      return (
                        <div key={log.id} className="p-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-semibold ${
                                  log.action === 'voided'
                                    ? 'text-red-700'
                                    : log.action === 'updated'
                                      ? 'text-amber-700'
                                      : 'text-emerald-700'
                                }`}
                              >
                                {formatAuditActionLabel(log.action)}
                              </span>
                              <span className="text-slate-400" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-slate-700">
                                {log.actorName || 'Workspace user'}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">
                              {formatExpenseDateTime(log.createdAt, timeZone)}
                            </span>
                          </div>

                          {log.reason && (
                            <div className="text-slate-700 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                              <span className="font-medium text-slate-600">Reason:</span>{' '}
                              {log.reason}
                            </div>
                          )}

                          {changes.length > 0 && (
                            <div className="space-y-1 pt-0.5">
                              {changes.map((chg) => (
                                <div
                                  key={chg.field}
                                  className="text-[11px] text-slate-600 flex flex-wrap items-baseline gap-1.5"
                                >
                                  <span className="font-medium text-slate-700">{chg.field}:</span>
                                  <span className="line-through text-slate-400">{chg.from}</span>
                                  <span aria-hidden="true">→</span>
                                  <span className="text-slate-900 font-medium">{chg.to}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

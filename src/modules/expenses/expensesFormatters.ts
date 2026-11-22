import { resolveSalesTimezone } from '../sales/salesFormatters';
import type { ExpenseAuditAction, ExpenseStatusValue } from './expensesTypes';

export function formatExpenseDate(dateValue: string | null | undefined): string {
  if (!dateValue) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(utcDate.getTime())) {
      try {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: 'UTC',
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        }).format(utcDate);
      } catch {
        return dateValue;
      }
    }
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(parsed);
  } catch {
    return dateValue;
  }
}

export function formatExpenseDateTime(
  iso: string | null | undefined,
  timeZone?: string | null
): string {
  if (!iso) return '—';
  const tz = resolveSalesTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatExpenseMonthLabel(monthKey: string | null | undefined): string {
  if (!monthKey) return '—';
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const utcDate = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(utcDate.getTime())) return monthKey;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
    }).format(utcDate);
  } catch {
    return monthKey;
  }
}

export function getTodayDateInputValue(timeZone?: string | null): string {
  const tz = resolveSalesTimezone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback below
  }
  return new Date().toISOString().slice(0, 10);
}

export function getCurrentMonthStartDateInputValue(timeZone?: string | null): string {
  const today = getTodayDateInputValue(timeZone);
  return `${today.slice(0, 7)}-01`;
}

export function getDaysAgoDateInputValue(daysAgo: number, timeZone?: string | null): string {
  const todayStr = getTodayDateInputValue(timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayStr);
  if (!match) return todayStr;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() - Math.max(0, Math.trunc(daysAgo)));
  return utc.toISOString().slice(0, 10);
}

export function formatExpenseStatusLabel(status: ExpenseStatusValue | string): string {
  return status === 'voided' ? 'Voided' : 'Recorded';
}

export function formatAuditActionLabel(action: ExpenseAuditAction | string): string {
  switch (action) {
    case 'created':
      return 'Recorded';
    case 'updated':
      return 'Edited';
    case 'voided':
      return 'Voided';
    default:
      return String(action);
  }
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  category_name_snapshot: 'Category',
  payment_method_name_snapshot: 'Payment Method',
  expense_date: 'Expense Date',
  amount: 'Amount',
  currency_code: 'Currency',
  description: 'Description',
  vendor_payee: 'Vendor / Payee',
  reference: 'Reference',
  receipt_storage_path: 'Receipt Attachment',
  notes: 'Notes',
  status: 'Status',
  void_reason: 'Void Reason',
};

export function formatAuditFieldLabel(fieldKey: string): string {
  return (
    AUDIT_FIELD_LABELS[fieldKey] ??
    fieldKey.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
}

export function extractReceiptFileName(storagePath: string | null | undefined): string {
  if (!storagePath) return '';
  const segments = storagePath.split('/');
  return segments[segments.length - 1] || storagePath;
}

export function isImageReceiptPath(storagePath: string | null | undefined): boolean {
  if (!storagePath) return false;
  const clean = storagePath.trim().toLowerCase();
  return (
    clean.endsWith('.png') ||
    clean.endsWith('.jpg') ||
    clean.endsWith('.jpeg') ||
    clean.endsWith('.webp')
  );
}

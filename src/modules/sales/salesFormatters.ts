import type {
  PaymentMethodCode,
  SalePaymentStatusValue,
  SaleStatusValue,
} from './salesTypes';

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function generateIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below if crypto.randomUUID is unavailable
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `veyora-${time}-${rand}`;
}

export function resolveSalesTimezone(organisationTimezone?: string | null): string {
  const candidate = (organisationTimezone ?? '').trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      // Fall back to Africa/Lagos when stored timezone is invalid
    }
  }
  return 'Africa/Lagos';
}

export function formatSalesDateTime(iso: string | null | undefined, timeZone?: string | null): string {
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

export function formatSalesShortDate(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '—';
  const tz = resolveSalesTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function getZonedDateKey(iso: string | null | undefined, timeZone?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const tz = resolveSalesTimezone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback below
  }
  return date.toISOString().slice(0, 10);
}

export function formatSalesQuantity(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
      maximumFractionDigits: 3,
    }).format(safe);
  } catch {
    return String(safe);
  }
}

export function normalizePaymentMethodCode(raw: unknown): PaymentMethodCode {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  switch (normalized) {
    case 'cash':
      return 'cash';
    case 'bank_transfer':
    case 'bank transfer':
    case 'transfer':
      return 'bank_transfer';
    case 'card_pos':
    case 'card':
    case 'pos':
      return 'card_pos';
    case 'mobile_money':
    case 'mobile money':
      return 'mobile_money';
    default:
      return 'other';
  }
}

export function formatPaymentMethodCodeLabel(code: PaymentMethodCode | string): string {
  switch (code) {
    case 'cash':
      return 'Cash';
    case 'bank_transfer':
      return 'Bank Transfer';
    case 'card_pos':
      return 'Card / POS';
    case 'mobile_money':
      return 'Mobile Money';
    case 'other':
      return 'Other';
    default:
      return String(code)
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatSaleStatusLabel(status: SaleStatusValue | string): string {
  return status === 'cancelled' ? 'Cancelled' : 'Completed';
}

export function formatPaymentStatusLabel(status: SalePaymentStatusValue | string): string {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'partial':
      return 'Partial';
    case 'unpaid':
      return 'Unpaid';
    default:
      return String(status);
  }
}

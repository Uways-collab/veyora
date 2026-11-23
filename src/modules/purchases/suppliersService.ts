import { getSupabaseClient } from '../../core/supabase/client';
import { verifyActiveWorkspaceContext } from '../inventory/inventoryService';
import type {
  SupplierMutationInput,
  SupplierMutationResult,
  SupplierRecord,
  SupplierSearchResult,
} from './suppliersTypes';

const MAX_SUPPLIER_SEARCH_LIMIT = 100;
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function readNonNegativeInteger(fallback: number, ...values: unknown[]): number {
  for (const val of values) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return Math.max(0, Math.trunc(val));
    }
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val.trim());
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.trunc(parsed));
      }
    }
  }
  return fallback;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'true' ||
      normalized === 't' ||
      normalized === '1' ||
      normalized === 'active'
    ) {
      return true;
    }
    if (
      normalized === 'false' ||
      normalized === 'f' ||
      normalized === '0' ||
      normalized === 'archived' ||
      normalized === 'inactive'
    ) {
      return false;
    }
  }
  return null;
}

function isMissingRpcSignatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const lower = (error.message ?? '').toLowerCase();
  return (
    lower.includes('could not find the function') ||
    lower.includes('schema cache') ||
    (lower.includes('function') && lower.includes('does not exist'))
  );
}

export function formatSupplierRpcError(
  rawMessage: string | undefined | null,
  fallback: string
): string {
  const msg = (rawMessage ?? '').trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();

  if (
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('row-level security') ||
    lower.includes('policy')
  ) {
    return 'Permission denied. You do not have permission to perform this supplier action in the active organization.';
  }

  return msg;
}

export function formatPaymentTermsLabel(days: number): string {
  const safeDays = Math.max(0, Math.trunc(Number.isFinite(days) ? days : 0));
  if (safeDays === 0) return 'Due on receipt (0 days)';
  return `Net ${safeDays} ${safeDays === 1 ? 'day' : 'days'}`;
}

export function formatSupplierDateTime(
  iso: string | null | undefined,
  timeZone?: string | null
): string {
  if (!iso) return '—';
  const tz = (timeZone ?? '').trim() || 'UTC';
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
    try {
      return new Intl.DateTimeFormat('en-GB', {
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
}

function normalizeSupplierRow(
  raw: Record<string, unknown>,
  fallbackOrgId: string,
  defaultIsActive = true
): SupplierRecord | null {
  const id = readString(raw.id, raw.supplier_id);
  if (!id) return null;

  const rowOrgId = readString(raw.organization_id, raw.organisation_id) ?? fallbackOrgId;
  if (rowOrgId.toLowerCase() !== fallbackOrgId.toLowerCase()) {
    return null;
  }

  const archivedAt = readString(raw.archived_at);
  const statusText = (readString(raw.status) ?? '').toLowerCase();
  const explicitIsActive = parseOptionalBoolean(raw.is_active ?? raw.isActive);
  const isActive =
    explicitIsActive !== null
      ? explicitIsActive
      : statusText === 'archived' || statusText === 'inactive' || Boolean(archivedAt)
        ? false
        : statusText === 'active'
          ? true
          : defaultIsActive;

  return {
    id,
    organizationId: rowOrgId,
    name: readString(raw.name, raw.supplier_name) ?? 'Unnamed Supplier',
    contactPerson: readString(raw.contact_person, raw.contact_name, raw.primary_contact),
    email: readString(raw.email),
    phone: readString(raw.phone),
    address: readString(raw.address),
    paymentTermsDays: readNonNegativeInteger(
      0,
      raw.payment_terms_days,
      raw.payment_terms,
      raw.paymentTermsDays
    ),
    notes: readString(raw.notes),
    isActive,
    archivedAt,
    createdAt: readString(raw.created_at),
    updatedAt: readString(raw.updated_at),
  };
}

function unwrapSupplierCandidate(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const nested = record.supplier ?? record.purchases_v1_search_suppliers;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

function extractSupplierRows(data: unknown): Record<string, unknown>[] {
  let parsedData = data;
  if (typeof parsedData === 'string') {
    const trimmed = parsedData.trim();
    if (!trimmed) return [];
    try {
      parsedData = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsedData)) {
    return parsedData
      .map(unwrapSupplierCandidate)
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
    const obj = parsedData as Record<string, unknown>;
    const candidate =
      obj.suppliers ?? obj.items ?? obj.rows ?? obj.data ?? obj.records ?? obj.results;
    if (Array.isArray(candidate)) {
      return candidate
        .map(unwrapSupplierCandidate)
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
  }

  return [];
}

function extractSingleSupplierRecord(
  data: unknown,
  orgId: string,
  defaultIsActive = true
): { supplier: SupplierRecord | null; supplierId: string | null } {
  let parsed = data;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return { supplier: null, supplierId: null };
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        return { supplier: null, supplierId: trimmed };
      }
    } else {
      return { supplier: null, supplierId: trimmed };
    }
  }

  const target = Array.isArray(parsed) ? parsed[0] : parsed;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const obj = target as Record<string, unknown>;
    const nestedRaw =
      obj.supplier ??
      obj.purchases_v1_create_supplier ??
      obj.purchases_v1_update_supplier ??
      obj.purchases_v1_archive_supplier ??
      obj.purchases_v1_restore_supplier;
    const nested =
      nestedRaw && typeof nestedRaw === 'object' && !Array.isArray(nestedRaw)
        ? (nestedRaw as Record<string, unknown>)
        : obj;
    const supplier = normalizeSupplierRow(nested, orgId, defaultIsActive);
    const supplierId =
      supplier?.id ?? readString(nested.id, nested.supplier_id, obj.supplier_id, obj.id);
    return { supplier, supplierId };
  }

  return { supplier: null, supplierId: null };
}

export function validateSupplierInput(input: SupplierMutationInput):
  | {
      ok: true;
      normalized: {
        name: string;
        contactPerson: string | null;
        email: string | null;
        phone: string | null;
        paymentTermsDays: number;
        address: string | null;
        notes: string | null;
      };
    }
  | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: 'Supplier name is required.' };
  }
  if (name.length > 200) {
    return { ok: false, error: 'Supplier name must be 200 characters or fewer.' };
  }

  const termsRaw = input.paymentTerms.trim();
  if (!termsRaw) {
    return {
      ok: false,
      error: 'Payment terms are required (enter 0 or a positive number of days).',
    };
  }
  const parsedTerms = Number(termsRaw);
  if (!Number.isFinite(parsedTerms) || parsedTerms < 0 || !Number.isInteger(parsedTerms)) {
    return {
      ok: false,
      error: 'Payment terms must be a non-negative whole number of days (0 or greater).',
    };
  }
  if (parsedTerms > 3650) {
    return { ok: false, error: 'Payment terms cannot exceed 3,650 days.' };
  }

  const contactPerson = input.contactPerson.trim() || null;
  if (contactPerson && contactPerson.length > 200) {
    return { ok: false, error: 'Contact person must be 200 characters or fewer.' };
  }

  const email = input.email.trim() || null;
  if (email && !BASIC_EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Enter a valid email address or leave email blank.' };
  }
  if (email && email.length > 200) {
    return { ok: false, error: 'Email address must be 200 characters or fewer.' };
  }

  const phone = input.phone.trim() || null;
  if (phone && phone.length > 60) {
    return { ok: false, error: 'Phone number must be 60 characters or fewer.' };
  }

  const address = input.address.trim() || null;
  if (address && address.length > 500) {
    return { ok: false, error: 'Address must be 500 characters or fewer.' };
  }

  const notes = input.notes.trim() || null;
  if (notes && notes.length > 1000) {
    return { ok: false, error: 'Notes must be 1,000 characters or fewer.' };
  }

  return {
    ok: true,
    normalized: {
      name,
      contactPerson,
      email,
      phone,
      paymentTermsDays: parsedTerms,
      address,
      notes,
    },
  };
}

export async function searchSuppliers(
  organisationId: string,
  options: {
    search?: string;
    isActive?: boolean | null;
    limit?: number;
  } = {}
): Promise<SupplierSearchResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { suppliers: [], hitLimit: false, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { suppliers: [], hitLimit: false, error: verified.error };
  }

  const clampedLimit = Math.min(
    MAX_SUPPLIER_SEARCH_LIMIT,
    Math.max(
      1,
      Math.trunc(Number.isFinite(options.limit) ? (options.limit as number) : MAX_SUPPLIER_SEARCH_LIMIT)
    )
  );
  const trimmedSearch = (options.search ?? '').trim();
  const targetIsActive = options.isActive === undefined ? true : options.isActive;

  const searchCandidates = [
    {
      p_organization_id: verified.organizationId,
      p_search: trimmedSearch ? trimmedSearch : null,
      p_is_active: targetIsActive,
      p_limit: clampedLimit,
    },
    {
      p_organization_id: verified.organizationId,
      p_search: trimmedSearch ? trimmedSearch : null,
      p_include_archived: targetIsActive === null ? true : !targetIsActive,
      p_limit: clampedLimit,
    },
    {
      p_organization_id: verified.organizationId,
      p_search: trimmedSearch ? trimmedSearch : null,
      p_limit: clampedLimit,
    },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of searchCandidates) {
    const res = await supabase.rpc('purchases_v1_search_suppliers', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      suppliers: [],
      hitLimit: false,
      error: formatSupplierRpcError(error.message, 'Unable to load suppliers.'),
    };
  }

  const rawRows = extractSupplierRows(data);
  const defaultActive = targetIsActive === false ? false : true;
  const normalized = rawRows
    .map((row) => normalizeSupplierRow(row, verified.organizationId, defaultActive))
    .filter((row): row is SupplierRecord => Boolean(row));

  const suppliers =
    targetIsActive === null
      ? normalized
      : normalized.filter((row) => row.isActive === targetIsActive);

  return {
    suppliers,
    hitLimit: rawRows.length >= clampedLimit,
    error: null,
  };
}

export async function createSupplier(
  organisationId: string,
  input: SupplierMutationInput
): Promise<SupplierMutationResult> {
  const validation = validateSupplierInput(input);
  if (!validation.ok) {
    return { supplier: null, supplierId: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { supplier: null, supplierId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { supplier: null, supplierId: null, error: verified.error };
  }

  const n = validation.normalized;
  const candidates = [
    {
      p_organization_id: verified.organizationId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms_days: n.paymentTermsDays,
      p_address: n.address,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms: n.paymentTermsDays,
      p_address: n.address,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms_days: n.paymentTermsDays,
    },
    {
      p_organization_id: verified.organizationId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms: n.paymentTermsDays,
    },
    {
      p_organization_id: verified.organizationId,
      p_name: n.name,
      p_contact_name: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms_days: n.paymentTermsDays,
      p_address: n.address,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_name: n.name,
      p_contact_name: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms: n.paymentTermsDays,
    },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_create_supplier', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      supplier: null,
      supplierId: null,
      error: formatSupplierRpcError(error.message, 'Unable to create supplier.'),
    };
  }

  const parsed = extractSingleSupplierRecord(data, verified.organizationId, true);
  return {
    supplier: parsed.supplier,
    supplierId: parsed.supplierId,
    error: null,
  };
}

export async function updateSupplier(
  organisationId: string,
  supplierId: string,
  input: SupplierMutationInput
): Promise<SupplierMutationResult> {
  if (!supplierId || !supplierId.trim()) {
    return { supplier: null, supplierId: null, error: 'Supplier ID is required.' };
  }

  const validation = validateSupplierInput(input);
  if (!validation.ok) {
    return { supplier: null, supplierId: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { supplier: null, supplierId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { supplier: null, supplierId: null, error: verified.error };
  }

  const cleanSupplierId = supplierId.trim();
  const n = validation.normalized;
  const candidates = [
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: cleanSupplierId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms_days: n.paymentTermsDays,
      p_address: n.address,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: cleanSupplierId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms: n.paymentTermsDays,
      p_address: n.address,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: cleanSupplierId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms_days: n.paymentTermsDays,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: cleanSupplierId,
      p_name: n.name,
      p_contact_person: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms: n.paymentTermsDays,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: cleanSupplierId,
      p_name: n.name,
      p_contact_name: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms_days: n.paymentTermsDays,
      p_address: n.address,
      p_notes: n.notes,
    },
    {
      p_organization_id: verified.organizationId,
      p_supplier_id: cleanSupplierId,
      p_name: n.name,
      p_contact_name: n.contactPerson,
      p_email: n.email,
      p_phone: n.phone,
      p_payment_terms: n.paymentTermsDays,
    },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_update_supplier', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      supplier: null,
      supplierId: null,
      error: formatSupplierRpcError(error.message, 'Unable to update supplier.'),
    };
  }

  const parsed = extractSingleSupplierRecord(data, verified.organizationId, true);
  return {
    supplier: parsed.supplier,
    supplierId: parsed.supplierId ?? cleanSupplierId,
    error: null,
  };
}

export async function archiveSupplier(
  organisationId: string,
  supplierId: string
): Promise<SupplierMutationResult> {
  if (!supplierId || !supplierId.trim()) {
    return { supplier: null, supplierId: null, error: 'Supplier ID is required.' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { supplier: null, supplierId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { supplier: null, supplierId: null, error: verified.error };
  }

  const cleanSupplierId = supplierId.trim();
  const candidates = [
    { p_organization_id: verified.organizationId, p_supplier_id: cleanSupplierId },
    { p_organization_id: verified.organizationId, p_id: cleanSupplierId },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_archive_supplier', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      supplier: null,
      supplierId: null,
      error: formatSupplierRpcError(error.message, 'Unable to archive supplier.'),
    };
  }

  const parsed = extractSingleSupplierRecord(data, verified.organizationId, false);
  return {
    supplier: parsed.supplier,
    supplierId: parsed.supplierId ?? cleanSupplierId,
    error: null,
  };
}

export async function restoreSupplier(
  organisationId: string,
  supplierId: string
): Promise<SupplierMutationResult> {
  if (!supplierId || !supplierId.trim()) {
    return { supplier: null, supplierId: null, error: 'Supplier ID is required.' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { supplier: null, supplierId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { supplier: null, supplierId: null, error: verified.error };
  }

  const cleanSupplierId = supplierId.trim();
  const candidates = [
    { p_organization_id: verified.organizationId, p_supplier_id: cleanSupplierId },
    { p_organization_id: verified.organizationId, p_id: cleanSupplierId },
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const candidate of candidates) {
    const res = await supabase.rpc('purchases_v1_restore_supplier', candidate);
    data = res.data;
    error = res.error;
    if (!error || !isMissingRpcSignatureError(error)) {
      break;
    }
  }

  if (error) {
    return {
      supplier: null,
      supplierId: null,
      error: formatSupplierRpcError(error.message, 'Unable to restore supplier.'),
    };
  }

  const parsed = extractSingleSupplierRecord(data, verified.organizationId, true);
  return {
    supplier: parsed.supplier,
    supplierId: parsed.supplierId ?? cleanSupplierId,
    error: null,
  };
}

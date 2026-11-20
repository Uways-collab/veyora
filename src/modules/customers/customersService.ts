import { getSupabaseClient } from '../../core/supabase/client';
import { verifyActiveWorkspaceContext } from '../inventory/inventoryService';
import {
  canManageCustomers,
  type CustomerMutationInput,
  type CustomerMutationResult,
  type CustomerRecord,
  type CustomerSearchResult,
} from './customersTypes';

const MAX_CUSTOMER_SEARCH_LIMIT = 100;
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
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
    if (normalized === 'true' || normalized === 't' || normalized === '1' || normalized === 'active') {
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

function normalizeCustomerRow(
  raw: Record<string, unknown>,
  fallbackOrgId: string,
  defaultIsActive = true
): CustomerRecord | null {
  const id = readString(raw.id, raw.customer_id);
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
    name: readString(raw.name, raw.full_name) ?? 'Unnamed Customer',
    phone: readString(raw.phone),
    email: readString(raw.email),
    address: readString(raw.address),
    notes: readString(raw.notes),
    isActive,
    archivedAt,
    createdAt: readString(raw.created_at),
    updatedAt: readString(raw.updated_at),
  };
}

function unwrapCustomerCandidate(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const nested = record.customer ?? record.customers_v1_search;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

function extractCustomerRows(data: unknown): Record<string, unknown>[] {
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
      .map(unwrapCustomerCandidate)
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
  if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
    const obj = parsedData as Record<string, unknown>;
    const candidate =
      obj.customers ?? obj.items ?? obj.rows ?? obj.data ?? obj.records ?? obj.results;
    if (Array.isArray(candidate)) {
      return candidate
        .map(unwrapCustomerCandidate)
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
  }
  return [];
}

function extractSingleCustomerRecord(
  data: unknown,
  orgId: string
): { customer: CustomerRecord | null; customerId: string | null } {
  if (typeof data === 'string' && data.trim()) {
    return { customer: null, customerId: data.trim() };
  }

  const target = Array.isArray(data) ? data[0] : data;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const obj = target as Record<string, unknown>;
    const nested =
      obj.customer && typeof obj.customer === 'object' && !Array.isArray(obj.customer)
        ? (obj.customer as Record<string, unknown>)
        : obj;
    const customer = normalizeCustomerRow(nested, orgId, true);
    const customerId =
      customer?.id ?? readString(nested.id, nested.customer_id, obj.customer_id, obj.id);
    return { customer, customerId };
  }

  return { customer: null, customerId: null };
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

export function formatCustomerRpcError(
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
    return 'Permission denied. Only Organization Owners, Admins, and Managers can create, edit, archive, or restore customers.';
  }

  if (lower.includes('duplicate') || lower.includes('unique')) {
    return msg;
  }

  return msg;
}

export function validateCustomerInput(input: CustomerMutationInput):
  | {
      ok: true;
      normalized: {
        name: string;
        phone: string | null;
        email: string | null;
        address: string | null;
        notes: string | null;
      };
    }
  | { ok: false; error: string } {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: 'Customer full name is required.' };
  }
  if (name.length > 200) {
    return { ok: false, error: 'Customer full name must be 200 characters or fewer.' };
  }

  const phone = input.phone.trim() || null;
  if (phone && phone.length > 60) {
    return { ok: false, error: 'Phone number must be 60 characters or fewer.' };
  }

  const email = input.email.trim() || null;
  if (email && !BASIC_EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Enter a valid email address or leave email blank.' };
  }

  const address = input.address.trim() || null;
  const notes = input.notes.trim() || null;

  return {
    ok: true,
    normalized: { name, phone, email, address, notes },
  };
}

export function formatCustomerDateTime(
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

export async function searchCustomers(
  organisationId: string,
  searchQuery = '',
  limit = MAX_CUSTOMER_SEARCH_LIMIT
): Promise<CustomerSearchResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { customers: [], hitLimit: false, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { customers: [], hitLimit: false, error: verified.error };
  }

  const clampedLimit = Math.min(
    MAX_CUSTOMER_SEARCH_LIMIT,
    Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : MAX_CUSTOMER_SEARCH_LIMIT))
  );
  const trimmedSearch = searchQuery.trim();

  let { data, error } = await supabase.rpc('customers_v1_search', {
    p_organization_id: verified.organizationId,
    p_search: trimmedSearch ? trimmedSearch : null,
    p_limit: clampedLimit,
    p_is_active: true,
  });

  if (error && isMissingRpcSignatureError(error)) {
    const legacyRes = await supabase.rpc('customers_v1_search', {
      p_organization_id: verified.organizationId,
      p_search: trimmedSearch ? trimmedSearch : null,
      p_limit: clampedLimit,
    });
    data = legacyRes.data;
    error = legacyRes.error;
  }

  if (error) {
    return {
      customers: [],
      hitLimit: false,
      error: formatCustomerRpcError(error.message, 'Unable to load customers.'),
    };
  }

  const rawRows = extractCustomerRows(data);
  const customers = rawRows
    .map((row) => normalizeCustomerRow(row, verified.organizationId, true))
    .filter((row): row is CustomerRecord => Boolean(row))
    .filter((row) => row.isActive);

  return {
    customers,
    hitLimit: rawRows.length >= clampedLimit,
    error: null,
  };
}

export async function searchArchivedCustomers(
  organisationId: string,
  searchQuery = '',
  limit = MAX_CUSTOMER_SEARCH_LIMIT
): Promise<CustomerSearchResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { customers: [], hitLimit: false, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { customers: [], hitLimit: false, error: verified.error };
  }

  const clampedLimit = Math.min(
    MAX_CUSTOMER_SEARCH_LIMIT,
    Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : MAX_CUSTOMER_SEARCH_LIMIT))
  );
  const trimmedSearch = searchQuery.trim();

  const { data, error } = await supabase.rpc('customers_v1_search', {
    p_organization_id: verified.organizationId,
    p_search: trimmedSearch ? trimmedSearch : null,
    p_limit: clampedLimit,
    p_is_active: false,
  });

  if (!error) {
    const rawRows = extractCustomerRows(data);
    const customers = rawRows
      .map((row) => normalizeCustomerRow(row, verified.organizationId, false))
      .filter((row): row is CustomerRecord => Boolean(row))
      .filter((row) => !row.isActive);

    return {
      customers,
      hitLimit: rawRows.length >= clampedLimit,
      error: null,
    };
  }

  // Fallback read-only query if live DB has not yet applied the 4-arg customers_v1_search migration
  if (isMissingRpcSignatureError(error)) {
    let query = supabase
      .from('customers')
      .select('*')
      .eq('organization_id', verified.organizationId)
      .eq('is_active', false)
      .order('name', { ascending: true })
      .limit(clampedLimit);

    if (trimmedSearch) {
      const safePattern = trimmedSearch.replace(/[,()]/g, ' ').trim();
      if (safePattern) {
        query = query.or(
          `name.ilike.%${safePattern}%,phone.ilike.%${safePattern}%,email.ilike.%${safePattern}%`
        );
      }
    }

    const fallbackRes = await query;
    if (fallbackRes.error) {
      return {
        customers: [],
        hitLimit: false,
        error: formatCustomerRpcError(
          fallbackRes.error.message,
          'Unable to load archived customers.'
        ),
      };
    }

    const rawRows = extractCustomerRows(fallbackRes.data);
    const customers = rawRows
      .map((row) => normalizeCustomerRow(row, verified.organizationId, false))
      .filter((row): row is CustomerRecord => Boolean(row))
      .filter((row) => !row.isActive);

    return {
      customers,
      hitLimit: rawRows.length >= clampedLimit,
      error: null,
    };
  }

  return {
    customers: [],
    hitLimit: false,
    error: formatCustomerRpcError(error.message, 'Unable to load archived customers.'),
  };
}

async function verifyCustomerWriteMembership(
  organisationId: string
): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return verified;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: 'Supabase client is not configured.' };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return {
      ok: false,
      error: 'Your authentication session could not be verified. Please sign in again.',
    };
  }

  const { data: membership, error } = await supabase
    .from('organization_memberships')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('organization_id', verified.organizationId)
    .maybeSingle();

  if (error || !membership) {
    return {
      ok: false,
      error: error?.message || 'Unable to verify your workspace role.',
    };
  }

  if (!canManageCustomers(membership.role)) {
    return {
      ok: false,
      error:
        'Only Organization Owners, Admins, and Managers can create, edit, archive, or restore customers.',
    };
  }

  return { ok: true, organizationId: verified.organizationId };
}

export async function createCustomer(
  organisationId: string,
  input: CustomerMutationInput
): Promise<CustomerMutationResult> {
  const validation = validateCustomerInput(input);
  if (!validation.ok) {
    return { customer: null, customerId: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { customer: null, customerId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyCustomerWriteMembership(organisationId);
  if (!verified.ok) {
    return { customer: null, customerId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('customers_v1_create', {
    p_organization_id: verified.organizationId,
    p_name: validation.normalized.name,
    p_phone: validation.normalized.phone,
    p_email: validation.normalized.email,
    p_address: validation.normalized.address,
    p_notes: validation.normalized.notes,
  });

  if (error) {
    return {
      customer: null,
      customerId: null,
      error: formatCustomerRpcError(error.message, 'Unable to create customer.'),
    };
  }

  const parsed = extractSingleCustomerRecord(data, verified.organizationId);
  return {
    customer: parsed.customer,
    customerId: parsed.customerId,
    error: null,
  };
}

export async function updateCustomer(
  organisationId: string,
  customerId: string,
  input: CustomerMutationInput
): Promise<CustomerMutationResult> {
  if (!customerId || !customerId.trim()) {
    return { customer: null, customerId: null, error: 'Customer ID is required.' };
  }

  const validation = validateCustomerInput(input);
  if (!validation.ok) {
    return { customer: null, customerId: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { customer: null, customerId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyCustomerWriteMembership(organisationId);
  if (!verified.ok) {
    return { customer: null, customerId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('customers_v1_update', {
    p_organization_id: verified.organizationId,
    p_customer_id: customerId.trim(),
    p_name: validation.normalized.name,
    p_phone: validation.normalized.phone,
    p_email: validation.normalized.email,
    p_address: validation.normalized.address,
    p_notes: validation.normalized.notes,
  });

  if (error) {
    return {
      customer: null,
      customerId: null,
      error: formatCustomerRpcError(error.message, 'Unable to update customer.'),
    };
  }

  const parsed = extractSingleCustomerRecord(data, verified.organizationId);
  return {
    customer: parsed.customer,
    customerId: parsed.customerId ?? customerId.trim(),
    error: null,
  };
}

export async function archiveCustomer(
  organisationId: string,
  customerId: string
): Promise<{ error: string | null }> {
  if (!customerId || !customerId.trim()) {
    return { error: 'Customer ID is required.' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }

  const verified = await verifyCustomerWriteMembership(organisationId);
  if (!verified.ok) {
    return { error: verified.error };
  }

  const { error } = await supabase.rpc('customers_v1_archive', {
    p_organization_id: verified.organizationId,
    p_customer_id: customerId.trim(),
  });

  if (error) {
    return {
      error: formatCustomerRpcError(error.message, 'Unable to archive customer.'),
    };
  }

  return { error: null };
}

export async function restoreCustomer(
  organisationId: string,
  customerId: string
): Promise<CustomerMutationResult> {
  if (!customerId || !customerId.trim()) {
    return { customer: null, customerId: null, error: 'Customer ID is required.' };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { customer: null, customerId: null, error: 'Supabase client is not configured.' };
  }

  const verified = await verifyCustomerWriteMembership(organisationId);
  if (!verified.ok) {
    return { customer: null, customerId: null, error: verified.error };
  }

  const { data, error } = await supabase.rpc('customers_v1_restore', {
    p_organization_id: verified.organizationId,
    p_customer_id: customerId.trim(),
  });

  if (error) {
    if (isMissingRpcSignatureError(error)) {
      return {
        customer: null,
        customerId: null,
        error:
          'The customers_v1_restore database RPC is not yet deployed. Apply migration 0003_customers_archive_and_restore.sql in Supabase first.',
      };
    }
    return {
      customer: null,
      customerId: null,
      error: formatCustomerRpcError(error.message, 'Unable to restore customer.'),
    };
  }

  const parsed = extractSingleCustomerRecord(data, verified.organizationId);
  return {
    customer: parsed.customer,
    customerId: parsed.customerId ?? customerId.trim(),
    error: null,
  };
}

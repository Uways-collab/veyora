import { getSupabaseClient } from './client';
import { COUNTRY_OPTIONS } from '../constants/businessOptions';
import type {
  BusinessType,
  Organisation,
  OrganisationMemberRecord,
  OrganisationRole,
} from '../types/domain';

export function normalizeOrganisationRow(raw: Record<string, unknown>): Organisation {
  const rawCountry = typeof raw.country === 'string' ? raw.country.trim() : '';
  const rawBaseCurrency = typeof raw.base_currency === 'string' ? raw.base_currency.trim() : '';
  const rawCurrency = typeof raw.currency === 'string' ? raw.currency.trim() : '';
  const rawDefaultCurrency =
    typeof raw.default_currency === 'string' ? raw.default_currency.trim() : '';

  const currencyCandidates = [rawBaseCurrency, rawCurrency, rawDefaultCurrency].filter(Boolean);
  const validIsoCode = currencyCandidates.find((val) => /^[A-Za-z]{3}$/.test(val));
  const nonCountryCandidate = currencyCandidates.find(
    (val) => !rawCountry || val.toLowerCase() !== rawCountry.toLowerCase()
  );

  const countryMatch = COUNTRY_OPTIONS.find(
    (c) => c.name.toLowerCase() === rawCountry.toLowerCase()
  );

  const resolvedCurrency = (
    validIsoCode ??
    nonCountryCandidate ??
    countryMatch?.defaultCurrency ??
    currencyCandidates[0] ??
    'USD'
  ).toUpperCase();

  const resolvedCountry = rawCountry || 'United States';

  const businessTypeCandidate =
    typeof raw.business_type === 'string'
      ? raw.business_type
      : typeof raw.type === 'string'
        ? raw.type
        : 'retail';

  return {
    id: String(raw.id ?? ''),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Business Workspace',
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    business_type: businessTypeCandidate as BusinessType,
    country: resolvedCountry,
    base_currency: resolvedCurrency,
    timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone : 'UTC',
    business_email:
      typeof raw.business_email === 'string'
        ? raw.business_email
        : typeof raw.email === 'string'
          ? raw.email
          : null,
    business_phone:
      typeof raw.business_phone === 'string'
        ? raw.business_phone
        : typeof raw.phone === 'string'
          ? raw.phone
          : null,
    receipt_settings:
      raw.receipt_settings && typeof raw.receipt_settings === 'object' && !Array.isArray(raw.receipt_settings)
        ? (raw.receipt_settings as Record<string, unknown>)
        : null,
    has_receipt_settings_column: Object.prototype.hasOwnProperty.call(raw, 'receipt_settings'),
    created_by: typeof raw.created_by === 'string' ? raw.created_by : '',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
  };
}

function parseOrganisationRole(role: string): OrganisationRole | null {
  switch (role) {
    case 'owner':
    case 'admin':
    case 'manager':
    case 'staff':
      return role;
    default:
      return null;
  }
}

export async function fetchOrganisationMembers(
  organisationId: string
): Promise<{ members: OrganisationMemberRecord[]; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { members: [], error: 'Supabase client is not configured.' };
  }

  if (!organisationId || !organisationId.trim()) {
    return { members: [], error: 'Active organisation ID is required.' };
  }

  const { data, error } = await supabase.rpc('get_organization_member_roster', {
    p_organization_id: organisationId,
  });

  if (error) {
    return {
      members: [],
      error: error.message || 'Unable to load organisation members.',
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const members: OrganisationMemberRecord[] = [];

  for (const row of rows) {
    const validatedRole = parseOrganisationRole(row.role);
    if (!validatedRole) {
      return {
        members: [],
        error: `Unsupported organisation member role received: "${row.role}".`,
      };
    }

    members.push({
      id: row.id,
      organisation_id: row.organisation_id,
      user_id: row.user_id,
      role: validatedRole,
      is_active: row.is_active,
      created_at: row.created_at,
      profile: row.profile_id
        ? {
            id: row.profile_id,
            email: row.email ?? '',
            full_name: row.full_name ?? null,
          }
        : null,
    });
  }

  return { members, error: null };
}

export async function updateOrganisationProfile(
  organisationId: string,
  patch: {
    name: string;
    business_type: BusinessType;
    country: string;
    base_currency: string;
    timezone: string;
    business_email: string | null;
    business_phone: string | null;
  }
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }

  if (!organisationId || !organisationId.trim()) {
    return { error: 'Active organisation ID is required.' };
  }

  const normalizedName = patch.name.trim();
  if (normalizedName.length < 2 || normalizedName.length > 120) {
    return { error: 'Business name must be between 2 and 120 characters.' };
  }

  const normalizedCountry = patch.country.trim();
  if (!normalizedCountry) {
    return { error: 'Country is required.' };
  }

  const normalizedCurrency = patch.base_currency.trim().toUpperCase();
  if (!normalizedCurrency) {
    return { error: 'Currency is required.' };
  }

  const normalizedTimezone = patch.timezone.trim();
  if (!normalizedTimezone) {
    return { error: 'Timezone is required.' };
  }

  const normalizedEmail = patch.business_email?.trim() || null;
  const normalizedPhone = patch.business_phone?.trim() || null;

  const { error } = await supabase.rpc('update_organization_profile', {
    p_organization_id: organisationId,
    p_name: normalizedName,
    p_business_type: patch.business_type,
    p_country: normalizedCountry,
    p_currency: normalizedCurrency,
    p_timezone: normalizedTimezone,
    p_email: normalizedEmail,
    p_phone: normalizedPhone,
  });

  if (error) {
    return { error: error.message || 'Unable to update organisation settings.' };
  }

  return { error: null };
}

export async function updateOrganisationMemberRole(
  organisationId: string,
  membershipId: string,
  role: OrganisationRole
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }

  if (!organisationId || !organisationId.trim()) {
    return { error: 'Active organisation ID is required.' };
  }

  if (!membershipId || !membershipId.trim()) {
    return { error: 'Membership ID is required.' };
  }

  const validatedRole = parseOrganisationRole(role);
  if (!validatedRole) {
    return { error: `Unsupported organisation role: "${role}".` };
  }

  const { error } = await supabase.rpc('manage_organization_member_role', {
    p_organization_id: organisationId,
    p_membership_id: membershipId,
    p_new_role: validatedRole,
  });

  if (error) {
    return { error: error.message || 'Unable to update member role.' };
  }

  return { error: null };
}

export async function removeOrganisationMember(
  organisationId: string,
  membershipId: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: 'Supabase client is not configured.' };
  }

  if (!organisationId || !organisationId.trim()) {
    return { error: 'Active organisation ID is required.' };
  }

  if (!membershipId || !membershipId.trim()) {
    return { error: 'Membership ID is required.' };
  }

  const { error } = await supabase.rpc('remove_organization_member', {
    p_organization_id: organisationId,
    p_membership_id: membershipId,
  });

  if (error) {
    return { error: error.message || 'Unable to remove organisation member.' };
  }

  return { error: null };
}

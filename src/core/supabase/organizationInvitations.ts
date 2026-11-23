import { getSupabaseClient } from './client';

export type InviteableOrganisationRole = 'manager' | 'staff';

export type InviteOrganisationMemberResult =
  | { status: 'added'; membership_id: string }
  | { status: 'invited'; invitation_id: string; already_pending?: boolean; awaiting_email_confirmation?: boolean; awaiting_existing_account_confirmation?: boolean };

export async function inviteOrganisationMember(
  organisationId: string,
  email: string,
  role: InviteableOrganisationRole
): Promise<{ result: InviteOrganisationMemberResult | null; error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { result: null, error: 'Supabase client is not configured.' };
  if (!organisationId.trim()) return { result: null, error: 'Active organisation is required.' };

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    return { result: null, error: 'Enter a valid email address.' };
  }
  if (role !== 'manager' && role !== 'staff') {
    return { result: null, error: 'Only manager and staff roles can be invited.' };
  }

  const { data, error } = await supabase.functions.invoke('invite-organization-member', {
    body: { organization_id: organisationId, email: normalizedEmail, role },
  });
  if (error) {
    return { result: null, error: error.message || 'Unable to invite organisation member.' };
  }
  if (!data || (data.status !== 'added' && data.status !== 'invited')) {
    return { result: null, error: typeof data?.error === 'string' ? data.error : 'Unexpected invitation response.' };
  }
  return { result: data as InviteOrganisationMemberResult, error: null };
}

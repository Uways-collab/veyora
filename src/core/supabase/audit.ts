import { getSupabaseClient } from '../supabase/client';
import type { AuditLogEntry } from '../types/domain';

export type AuditFetchErrorKind = 'missing_table' | 'permission_denied' | 'other';

export async function fetchOrganisationAuditLogs(
  organisationId: string,
  limit = 10
): Promise<{
  logs: AuditLogEntry[];
  error: string | null;
  errorKind: AuditFetchErrorKind | null;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      logs: [],
      error: 'Supabase client is not configured.',
      errorKind: 'other',
    };
  }

  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    const code = error.code ?? '';
    const lower = error.message.toLowerCase();
    const errorKind: AuditFetchErrorKind =
      code === '42P01' ||
      code === 'PGRST205' ||
      lower.includes('does not exist') ||
      lower.includes('schema cache')
        ? 'missing_table'
        : code === '42501' ||
            lower.includes('permission denied') ||
            lower.includes('row-level security') ||
            lower.includes('policy')
          ? 'permission_denied'
          : 'other';

    return { logs: [], error: error.message, errorKind };
  }

  const filtered = ((data ?? []) as Array<
    Record<string, unknown> & AuditLogEntry & { organization_id?: string }
  >)
    .filter((row) => (row.organization_id ?? row.organisation_id) === organisationId)
    .map((row) => ({
      ...row,
      organisation_id: row.organization_id ?? row.organisation_id ?? organisationId,
    }));

  return {
    logs: filtered,
    error: null,
    errorKind: null,
  };
}

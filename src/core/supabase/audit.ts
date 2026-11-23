import { getSupabaseClient } from '../supabase/client';
import type { AuditLogEntry } from '../types/domain';

export type AuditFetchErrorKind = 'missing_table' | 'permission_denied' | 'other';

interface OrganisationAuditRow {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

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
    return { logs: [], error: 'Supabase client is not configured.', errorKind: 'other' };
  }
  if (!organisationId.trim()) {
    return { logs: [], error: 'Active organisation ID is required.', errorKind: 'other' };
  }

  const { data, error } = await supabase
    .from('organization_audit_log')
    .select('id, organization_id, actor_id, action, entity_type, entity_id, details, created_at')
    .eq('organization_id', organisationId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));

  if (error) {
    const code = error.code ?? '';
    const lower = error.message.toLowerCase();
    const errorKind: AuditFetchErrorKind =
      code === '42P01' || code === 'PGRST205' || lower.includes('does not exist') ||
      lower.includes('schema cache')
        ? 'missing_table'
        : code === '42501' || lower.includes('permission denied') ||
          lower.includes('row-level security') || lower.includes('policy')
          ? 'permission_denied'
          : 'other';
    return { logs: [], error: error.message, errorKind };
  }

  const logs = ((data ?? []) as OrganisationAuditRow[]).map((row) => ({
    id: row.id,
    organisation_id: row.organization_id,
    actor_user_id: row.actor_id,
    module: 'settings' as const,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    metadata: row.details ?? {},
    created_at: row.created_at,
  }));

  return { logs, error: null, errorKind: null };
}

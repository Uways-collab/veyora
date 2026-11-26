import { createClient } from 'npm:@supabase/supabase-js@2';

const OWNER_EMAIL = 'blundigold@gmail.com';
const MAX_PAGE_SIZE = 100;

function json(body: Record<string, unknown>, status = 200, origin = '*') {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }});
}

function getServiceKey(): string | null {
  const direct = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (direct) return direct;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!keys) return null;
  try { return (JSON.parse(keys) as Record<string, string>).default ?? null; } catch { return null; }
}

function pageNumber(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Math.min(Number(value), 10000) : 1;
}

function pageSize(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Math.min(Number(value), MAX_PAGE_SIZE) : 50;
}

function isBanned(user: { banned_until?: string | null }): boolean {
  return Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now());
}

async function countRegisteredUsers(admin: ReturnType<typeof createClient>) {
  let registeredUsers = 0;
  let newUsersLast30Days = 0;
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not count registered accounts.');
    const users = data.users ?? [];
    registeredUsers += users.length;
    newUsersLast30Days += users.filter((user) => Date.parse(user.created_at) >= since).length;
    if (users.length < 1000) break;
  }
  return { registeredUsers, newUsersLast30Days };
}

async function getOrganisationLabels(admin: ReturnType<typeof createClient>, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await admin.from('organizations').select('id,name').in('id', ids);
  if (error) throw new Error('Could not load workspace labels.');
  return new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') ?? '*';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }});
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Sign in to continue.' }, 401, origin);

  const url = Deno.env.get('SUPABASE_URL');
  let anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anonKey) {
    try { anonKey = (JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string,string>).default; } catch { /* missing */ }
  }
  const serviceKey = getServiceKey();
  if (!url || !anonKey || !serviceKey) return json({ error: 'Platform administration is not configured on the server.' }, 503, origin);

  const caller = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  const email = authData.user?.email?.trim().toLowerCase();
  if (authError || !authData.user || email !== OWNER_EMAIL) {
    return json({ error: 'You are not authorised to view Veyora platform administration.' }, 403, origin);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid request.');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Request body must be a valid JSON object.' }, 400, origin);
  }

  const action = typeof body.action === 'string' ? body.action : 'overview';
  const page = pageNumber(body.page);
  const perPage = pageSize(body.per_page);
  const offset = (page - 1) * perPage;

  try {
    if (action === 'overview') {
      const [users, businesses, memberships, active, trialing, pastDue, types, usage] = await Promise.all([
        countRegisteredUsers(admin),
        admin.from('organizations').select('id', { count: 'exact', head: true }),
        admin.from('organization_memberships').select('id', { count: 'exact', head: true }),
        admin.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        admin.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
        admin.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'past_due'),
        admin.from('organizations').select('business_type'),
        admin.from('ai_usage_records').select('feature', { count: 'exact' }).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(10000),
      ]);
      const failure = businesses.error ?? memberships.error ?? active.error ?? trialing.error ?? pastDue.error ?? types.error ?? usage.error;
      if (failure) return json({ error: 'Could not load platform totals. Please retry.' }, 500, origin);
      const businessTypes: Record<string, number> = {};
      for (const row of types.data ?? []) {
        const key = row.business_type || 'unspecified';
        businessTypes[key] = (businessTypes[key] ?? 0) + 1;
      }
      const usageSummary = (usage.data ?? []).reduce((summary, row) => {
        const key = row.feature || 'other';
        summary[key] = (summary[key] ?? 0) + 1;
        return summary;
      }, {} as Record<string, number>);
      return json({
        action,
        ...users,
        businesses: businesses.count ?? 0,
        memberships: memberships.count ?? 0,
        activeSubscriptions: active.count ?? 0,
        trialingSubscriptions: trialing.count ?? 0,
        pastDueSubscriptions: pastDue.count ?? 0,
        businessTypes,
        aiUsageLast30Days: usage.count ?? 0,
        aiUsageByFeature: usageSummary,
        generatedAt: new Date().toISOString(),
      }, 200, origin);
    }

    if (action === 'users') {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return json({ error: 'Could not load registered accounts.' }, 500, origin);
      const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
      const users = (data.users ?? []).filter((user) => !search || (user.email ?? '').toLowerCase().includes(search))
        .map((user) => ({
          id: user.id,
          email: user.email ?? '',
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at ?? null,
          emailConfirmedAt: user.email_confirmed_at ?? null,
          disabled: isBanned(user),
          bannedUntil: user.banned_until ?? null,
          isPlatformOwner: (user.email ?? '').trim().toLowerCase() === OWNER_EMAIL,
        }));
      return json({ action, page, perPage, users }, 200, origin);
    }

    if (action === 'workspaces') {
      const { data: organisations, error } = await admin.from('organizations')
        .select('id,name,business_type,country,currency,created_at')
        .order('created_at', { ascending: false }).range(offset, offset + perPage - 1);
      if (error) return json({ error: 'Could not load business workspaces.' }, 500, origin);
      const ids = (organisations ?? []).map((row) => row.id as string);
      const [memberships, subscriptions] = ids.length ? await Promise.all([
        admin.from('organization_memberships').select('organization_id,role').in('organization_id', ids),
        admin.from('organization_subscriptions').select('organization_id,status,plan_id,trial_ends_at,current_period_ends_at,cancel_at_period_end').in('organization_id', ids),
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (memberships.error || subscriptions.error) return json({ error: 'Could not load workspace access summaries.' }, 500, origin);
      const planIds = [...new Set((subscriptions.data ?? []).map((row) => row.plan_id).filter(Boolean))] as string[];
      const { data: plans, error: plansError } = planIds.length
        ? await admin.from('subscription_plans').select('id,name,code').in('id', planIds)
        : { data: [], error: null };
      if (plansError) return json({ error: 'Could not load plan labels.' }, 500, origin);
      const planMap = new Map((plans ?? []).map((plan) => [plan.id as string, { name: plan.name, code: plan.code }]));
      const result = (organisations ?? []).map((organisation) => {
        const members = (memberships.data ?? []).filter((member) => member.organization_id === organisation.id);
        const subscription = (subscriptions.data ?? []).find((row) => row.organization_id === organisation.id);
        return {
          id: organisation.id,
          name: organisation.name,
          businessType: organisation.business_type,
          country: organisation.country,
          currency: organisation.currency,
          createdAt: organisation.created_at,
          membershipCount: members.length,
          subscription: subscription ? {
            status: subscription.status,
            plan: planMap.get(subscription.plan_id) ?? null,
            trialEndsAt: subscription.trial_ends_at,
            currentPeriodEndsAt: subscription.current_period_ends_at,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          } : null,
        };
      });
      return json({ action, page, perPage, workspaces: result }, 200, origin);
    }

    if (action === 'subscriptions') {
      const { data, error } = await admin.from('organization_subscriptions')
        .select('organization_id,status,plan_id,trial_starts_at,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end,provider,created_at,updated_at')
        .order('updated_at', { ascending: false }).range(offset, offset + perPage - 1);
      if (error) return json({ error: 'Could not load subscription records.' }, 500, origin);
      const orgIds = [...new Set((data ?? []).map((row) => row.organization_id))];
      const planIds = [...new Set((data ?? []).map((row) => row.plan_id).filter(Boolean))] as string[];
      const [orgs, plans] = await Promise.all([
        getOrganisationLabels(admin, orgIds),
        planIds.length ? admin.from('subscription_plans').select('id,name,code,billing_interval,currency,amount_minor_units').in('id', planIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (plans.error) return json({ error: 'Could not load subscription plan details.' }, 500, origin);
      const planMap = new Map((plans.data ?? []).map((plan) => [plan.id as string, plan]));
      return json({
        action, page, perPage,
        subscriptions: (data ?? []).map((row) => ({
          organizationId: row.organization_id,
          organizationName: orgs.get(row.organization_id) ?? 'Workspace',
          status: row.status,
          plan: planMap.get(row.plan_id) ?? null,
          trialStartsAt: row.trial_starts_at,
          trialEndsAt: row.trial_ends_at,
          currentPeriodStartsAt: row.current_period_starts_at,
          currentPeriodEndsAt: row.current_period_ends_at,
          cancelAtPeriodEnd: row.cancel_at_period_end,
          provider: row.provider,
          updatedAt: row.updated_at,
        })),
      }, 200, origin);
    }

    if (action === 'usage') {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data, error } = await admin.from('ai_usage_records')
        .select('organization_id,feature,input_tokens,output_tokens,estimated_cost_minor_units,created_at')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(10000);
      if (error) return json({ error: 'Could not load AI usage totals.' }, 500, origin);
      const orgIds = [...new Set((data ?? []).map((row) => row.organization_id))];
      const names = await getOrganisationLabels(admin, orgIds);
      const totals = new Map<string, { organizationId: string; organizationName: string; feature: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostMinorUnits: number }>();
      for (const row of data ?? []) {
        const key = `${row.organization_id}:${row.feature}`;
        const current = totals.get(key) ?? {
          organizationId: row.organization_id,
          organizationName: names.get(row.organization_id) ?? 'Workspace',
          feature: row.feature,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMinorUnits: 0,
        };
        current.requests += 1;
        current.inputTokens += Number(row.input_tokens) || 0;
        current.outputTokens += Number(row.output_tokens) || 0;
        current.estimatedCostMinorUnits += Number(row.estimated_cost_minor_units) || 0;
        totals.set(key, current);
      }
      return json({ action, since, usage: [...totals.values()].sort((a, b) => b.requests - a.requests) }, 200, origin);
    }

    if (action === 'activity') {
      const [workspaceEvents, adminEvents] = await Promise.all([
        admin.from('organization_audit_log').select('id,organization_id,action,entity_type,created_at')
          .order('created_at', { ascending: false }).limit(perPage),
        admin.from('platform_admin_audit_logs').select('id,actor_user_id,target_user_id,action,reason,created_at')
          .order('created_at', { ascending: false }).limit(perPage),
      ]);
      if (workspaceEvents.error || adminEvents.error) return json({ error: 'Could not load platform activity.' }, 500, origin);
      const orgIds = [...new Set((workspaceEvents.data ?? []).map((row) => row.organization_id))];
      const names = await getOrganisationLabels(admin, orgIds);
      return json({
        action,
        workspaceEvents: (workspaceEvents.data ?? []).map((row) => ({
          id: row.id,
          organizationName: names.get(row.organization_id) ?? 'Workspace',
          action: row.action,
          entityType: row.entity_type,
          createdAt: row.created_at,
        })),
        adminEvents: adminEvents.data ?? [],
      }, 200, origin);
    }

    if (action === 'set-user-access') {
      const targetUserId = typeof body.user_id === 'string' ? body.user_id : '';
      const disabled = body.disabled === true;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return json({ error: 'A valid target account is required.' }, 400, origin);
      }
      if (reason.length < 5 || reason.length > 500) return json({ error: 'Enter an audit reason between 5 and 500 characters.' }, 400, origin);
      if (targetUserId === authData.user.id) return json({ error: 'You cannot disable your own platform-owner account.' }, 400, origin);
      const { data: target, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
      if (targetError || !target.user) return json({ error: 'The target account could not be found.' }, 404, origin);
      if ((target.user.email ?? '').trim().toLowerCase() === OWNER_EMAIL) {
        return json({ error: 'The designated platform-owner account cannot be disabled from this console.' }, 403, origin);
      }
      const wasDisabled = isBanned(target.user);
      const previousBanDuration = wasDisabled
        ? `${Math.max(1, Math.ceil((Date.parse(target.user.banned_until ?? '') - Date.now()) / 3600000))}h`
        : 'none';
      if (wasDisabled === disabled) return json({ error: disabled ? 'This account is already disabled.' : 'This account is already active.' }, 409, origin);

      const { error: updateError } = await admin.auth.admin.updateUserById(targetUserId, {
        ban_duration: disabled ? '876000h' : 'none',
      });
      if (updateError) return json({ error: 'The account access change was rejected by Supabase Auth.' }, 500, origin);

      const { error: auditError } = await admin.from('platform_admin_audit_logs').insert({
        actor_user_id: authData.user.id,
        target_user_id: targetUserId,
        action: disabled ? 'user_access_disabled' : 'user_access_restored',
        reason,
        metadata: { target_email: target.user.email ?? null },
      });
      if (auditError) {
        const rollback = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: previousBanDuration });
        return json({
          error: rollback.error
            ? 'Account access changed, but the audit write and automatic rollback both failed. Treat this as an incident and inspect Auth immediately.'
            : 'The audit record could not be saved. The account change was rolled back.',
        }, 500, origin);
      }
      return json({ action, userId: targetUserId, disabled, auditRecorded: true }, 200, origin);
    }

    return json({ error: 'Unsupported platform-admin action.' }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Platform administration failed.' }, 500, origin);
  }
});

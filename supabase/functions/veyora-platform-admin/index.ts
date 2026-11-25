import { createClient } from 'npm:@supabase/supabase-js@2';

const OWNER_EMAIL = 'blundigold@gmail.com';

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
  if (!url || !anonKey || !serviceKey) return json({ error: 'Platform statistics are not configured on the server.' }, 503, origin);

  const caller = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  const email = authData.user?.email?.trim().toLowerCase();
  if (authError || !authData.user || email !== OWNER_EMAIL) return json({ error: 'You are not authorised to view Veyora platform administration.' }, 403, origin);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let registeredUsers = 0;
  let newUsersLast30Days = 0;
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (let page = 1; page <= 1000; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json({ error: 'Could not count registered accounts.' }, 500, origin);
    const users = data.users ?? [];
    registeredUsers += users.length;
    newUsersLast30Days += users.filter((user) => Date.parse(user.created_at) >= since).length;
    if (users.length < 1000) break;
  }

  const [businesses, memberships, active, trialing, pastDue, types] = await Promise.all([
    admin.from('organizations').select('id', { count: 'exact', head: true }),
    admin.from('organization_memberships').select('id', { count: 'exact', head: true }),
    admin.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
    admin.from('organization_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'past_due'),
    admin.from('organizations').select('business_type'),
  ]);
  const failure = businesses.error ?? memberships.error ?? active.error ?? trialing.error ?? pastDue.error ?? types.error;
  if (failure) return json({ error: 'Could not load platform totals. Please retry.' }, 500, origin);
  const businessTypes: Record<string, number> = {};
  for (const row of types.data ?? []) {
    const key = row.business_type || 'unspecified';
    businessTypes[key] = (businessTypes[key] ?? 0) + 1;
  }

  return json({
    registeredUsers,
    newUsersLast30Days,
    businesses: businesses.count ?? 0,
    memberships: memberships.count ?? 0,
    activeSubscriptions: active.count ?? 0,
    trialingSubscriptions: trialing.count ?? 0,
    pastDueSubscriptions: pastDue.count ?? 0,
    businessTypes,
    generatedAt: new Date().toISOString(),
  }, 200, origin);
});

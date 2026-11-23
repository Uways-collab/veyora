import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response({ error: 'A signed-in session is required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response({ error: 'Server Auth configuration is incomplete' }, 500);
  }

  // Validate the caller against Supabase Auth. Do not trust JWT payload decoding,
  // user_metadata, caller-supplied actor IDs, or a frontend-provided role.
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return response({ error: 'Invalid or expired session' }, 401);

  let input: { organization_id?: unknown; email?: unknown; role?: unknown };
  try {
    input = await req.json();
  } catch {
    return response({ error: 'Request body must be valid JSON' }, 400);
  }
  const organizationId = typeof input.organization_id === 'string' ? input.organization_id : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const role = typeof input.role === 'string' ? input.role : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    return response({ error: 'A valid active organisation is required' }, 400);
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response({ error: 'A valid email address is required' }, 400);
  }
  if (role !== 'manager' && role !== 'staff') {
    return response({ error: 'Only manager and staff roles may be invited' }, 400);
  }

  // The actor id comes only from the Auth-verified user object above.
  // The database RPC is callable only by service_role and re-checks owner
  // membership for the exact organisation before creating any membership/invite.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: result, error: rpcError } = await adminClient.rpc('create_organization_invitation', {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
    p_actor_id: authData.user.id,
  });
  if (rpcError) {
    const denied = rpcError.code === '42501';
    const duplicate = rpcError.code === '23505';
    return response({ error: rpcError.message }, denied ? 403 : duplicate ? 409 : 400);
  }

  const payload = result as { status?: string; invitation_id?: string; membership_id?: string } | null;
  if (payload?.status === 'added') {
    return response({ status: 'added', membership_id: payload.membership_id });
  }
  if (payload?.status !== 'invited' || !payload.invitation_id) {
    return response({ error: 'Unexpected invitation result' }, 500);
  }

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { organization_invitation_id: payload.invitation_id },
  });

  if (!inviteError) {
    return response({
      status: 'invited',
      invitation_id: payload.invitation_id,
      already_pending: Boolean((result as { already_pending?: boolean }).already_pending),
    }, 202);
  }

  // Handle the narrow race where the account was registered after the SQL lookup
  // but before Auth invitation creation. Attach only if Auth confirms exact email.
  const { data: membershipId, error: attachError } = await adminClient.rpc(
    'attach_pending_organization_invitation',
    { p_invitation_id: payload.invitation_id },
  );
  if (!attachError) {
    return response({ status: 'added', membership_id: membershipId, existing_account: true });
  }

  return response({
    error: 'The invitation could not be sent. The pending invitation is retained; retry from Members & Roles.',
    invitation_id: payload.invitation_id,
  }, 502);
});

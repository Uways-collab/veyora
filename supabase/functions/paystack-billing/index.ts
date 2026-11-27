import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function getSecretKey() {
  const direct = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (direct) return direct;
  try {
    return (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>).default ?? null;
  } catch { return null; }
}

function getAnonKey() {
  const direct = Deno.env.get('SUPABASE_ANON_KEY');
  if (direct) return direct;
  try {
    return (JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>).default ?? null;
  } catch { return null; }
}

async function paystackRequest(path: string, secret: string, method = 'GET', body?: Record<string, unknown>) {
  const response = await fetch('https://api.paystack.co' + path, {
    method,
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok || payload?.status !== true) {
    throw new Error(typeof payload?.message === 'string' ? payload.message : 'Paystack request failed.');
  }
  return payload.data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in to manage billing.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = getAnonKey();
  const serviceKey = getSecretKey();
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Billing server configuration is incomplete.' }, 503);

  let body: { action?: unknown; organization_id?: unknown; plan_id?: unknown; reference?: unknown; consent?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  const action = typeof body.action === 'string' ? body.action : '';
  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    return json({ error: 'A valid workspace is required.' }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + token } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'Your session is invalid or expired.' }, 401);

  const { data: membership, error: membershipError } = await userClient
    .from('organization_memberships').select('role')
    .eq('organization_id', organizationId).eq('user_id', authData.user.id).maybeSingle();
  if (membershipError || membership?.role !== 'owner') {
    return json({ error: 'Only the workspace Owner can manage subscriptions and billing.' }, 403);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
  const liveBillingAllowed = Deno.env.get('PAYSTACK_ENABLE_LIVE_BILLING') === 'true';
  const paystackReady = Boolean(paystackSecret?.startsWith('sk_test_') || (paystackSecret?.startsWith('sk_live_') && liveBillingAllowed));

  if (action === 'billing-config') {
    return json({
      trialDays: 7,
      currency: 'NGN',
      paystackConfigured: paystackReady,
      paystackMode: paystackSecret?.startsWith('sk_test_') ? 'test' : paystackSecret?.startsWith('sk_live_') ? 'live' : 'not_configured',
      liveBillingEnabled: liveBillingAllowed,
      planSyncAvailable: paystackReady,
    });
  }

  if (action === 'start-free-trial') {
    const { data: existing, error: existingError } = await serviceClient.from('organization_subscriptions')
      .select('id,status,trial_starts_at,trial_ends_at').eq('organization_id', organizationId).maybeSingle();
    if (existingError) return json({ error: 'Could not check this workspace trial status.' }, 500);
    if (existing) return json({ error: 'This workspace already has a trial or subscription record. Choose a paid plan to continue.' }, 409);

    const { data: plan, error: planError } = await serviceClient.from('subscription_plans')
      .select('id,provider_plan_code').eq('code', 'premium_monthly').eq('is_active', true).maybeSingle();
    if (planError || !plan) return json({ error: 'The Veyora trial plan is not configured. Contact support.' }, 503);

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { error: insertError } = await serviceClient.from('organization_subscriptions').insert({
      organization_id: organizationId,
      plan_id: plan.id,
      status: 'trialing',
      provider: 'paystack',
      provider_plan_code: plan.provider_plan_code,
      trial_starts_at: startsAt.toISOString(),
      trial_ends_at: endsAt.toISOString(),
      card_verified_at: null,
    });
    if (insertError) {
      if (insertError.code === '23505') return json({ error: 'A trial or subscription has already been created for this workspace.' }, 409);
      return json({ error: 'Could not activate the seven-day free trial.' }, 500);
    }
    return json({ success: true, trialDays: 7, trialEndsAt: endsAt.toISOString(), note: 'Your 7-day free trial has started. No card or payment is required.' });
  }

  if (!paystackSecret) return json({ error: 'PAYSTACK_SECRET_KEY is not configured in Supabase Edge Function secrets.' }, 503);
  if (paystackSecret.startsWith('sk_live_') && !liveBillingAllowed) return json({ error: 'Live Paystack billing is intentionally disabled. Configure PAYSTACK_ENABLE_LIVE_BILLING=true only after test-mode verification and Owner approval.' }, 503);
  if (!paystackSecret.startsWith('sk_test_') && !paystackSecret.startsWith('sk_live_')) return json({ error: 'PAYSTACK_SECRET_KEY must be a Paystack test or live secret key.' }, 503);

  if (action === 'sync-plans') {
    const { data: plans, error: plansError } = await serviceClient
      .from('subscription_plans').select('id,code,name,billing_interval,currency,amount_minor_units,provider_plan_code')
      .eq('is_active', true).order('amount_minor_units');
    if (plansError) return json({ error: 'Could not load Veyora plans.' }, 500);
    const synced: Array<{ code: string; providerPlanCode: string }> = [];
    const remotePlans = await paystackRequest('/plan?perPage=100', paystackSecret) as Array<Record<string, unknown>>;
    for (const plan of plans ?? []) {
      if (plan.provider_plan_code) {
        synced.push({ code: plan.code, providerPlanCode: plan.provider_plan_code });
        continue;
      }
      const interval = plan.billing_interval === 'yearly' ? 'annually' : 'monthly';
      const planName = 'Veyora ' + plan.name + ' ' + interval;
      const matchingRemote = remotePlans.find((item) =>
        item.name === planName &&
        Number(item.amount) === Number(plan.amount_minor_units) &&
        item.currency === plan.currency &&
        item.interval === interval
      );
      const created = matchingRemote ?? await paystackRequest('/plan', paystackSecret, 'POST', {
        name: planName,
        description: 'Veyora ' + plan.name + ' subscription',
        amount: Number(plan.amount_minor_units),
        currency: plan.currency,
        interval,
        send_invoices: true,
        send_sms: false,
      });
      const providerPlanCode = String(created.plan_code ?? '');
      if (!providerPlanCode) return json({ error: 'Paystack created a plan but returned no plan code. Contact support before retrying.' }, 502);
      const { error: updateError } = await serviceClient.from('subscription_plans')
        .update({ provider_plan_code: providerPlanCode }).eq('id', plan.id).is('provider_plan_code', null);
      if (updateError) return json({ error: 'Paystack plan was created but could not be linked to Veyora: ' + updateError.message }, 500);
      synced.push({ code: plan.code, providerPlanCode });
    }
    return json({ success: true, plans: synced });
  }

  if (action === 'initialize-subscription-payment') {
    if (!authData.user.email) return json({ error: 'Your Veyora account needs an email address before payment can start.' }, 400);
    const planId = typeof body.plan_id === 'string' ? body.plan_id : '';
    const { data: plan, error: planError } = await serviceClient.from('subscription_plans')
      .select('id,code,name,billing_interval,currency,amount_minor_units,provider_plan_code,is_active')
      .eq('id', planId).eq('is_active', true).maybeSingle();
    if (planError || !plan) return json({ error: 'Choose an active Veyora subscription plan.' }, 400);
    if (!Number.isSafeInteger(Number(plan.amount_minor_units)) || Number(plan.amount_minor_units) <= 0) {
      return json({ error: 'The selected plan has an invalid payment amount.' }, 503);
    }
    if (!plan.provider_plan_code) return json({ error: 'Sync Veyora plans with Paystack before accepting subscription payments.' }, 409);

    const { data: currentSubscription, error: currentSubscriptionError } = await serviceClient.from('organization_subscriptions')
      .select('status,current_period_ends_at,provider_subscription_code').eq('organization_id', organizationId).maybeSingle();
    if (currentSubscriptionError) return json({ error: 'Could not verify the current subscription status.' }, 500);
    if (currentSubscription?.provider_subscription_code) {
      return json({ error: 'This workspace already has a Paystack subscription. Use the payment-management link to update or retry its payment.' }, 409);
    }
    if (currentSubscription?.status === 'active' &&
        (!currentSubscription.current_period_ends_at || new Date(currentSubscription.current_period_ends_at).getTime() > Date.now())) {
      return json({ error: 'This workspace already has an active paid subscription.' }, 409);
    }

    const appBaseUrl = Deno.env.get('APP_BASE_URL') ?? '';
    let callbackUrl = '';
    try {
      const base = new URL(appBaseUrl);
      if (base.protocol !== 'https:') throw new Error('HTTPS required');
      callbackUrl = new URL('/', base).toString();
    } catch {
      return json({ error: 'APP_BASE_URL must be configured as the HTTPS Veyora application URL.' }, 503);
    }

    const { data: pending } = await serviceClient.from('billing_transactions').select('id')
      .eq('organization_id', organizationId).eq('purpose', 'subscription_payment')
      .in('status', ['initializing','pending']).limit(1);
    if (pending?.length) return json({ error: 'A subscription payment is already in progress for this workspace.' }, 409);

    const reference = 'veyora-pay-' + organizationId.slice(0, 8) + '-' + crypto.randomUUID();
    const amount = Number(plan.amount_minor_units);
    const { error: transactionError } = await serviceClient.from('billing_transactions').insert({
      organization_id: organizationId,
      plan_id: plan.id,
      reference,
      purpose: 'subscription_payment',
      amount_minor_units: amount,
      currency: plan.currency,
      status: 'initializing',
      metadata: { organization_id: organizationId, plan_id: plan.id, purpose: 'subscription_payment', billing_interval: plan.billing_interval },
    });
    if (transactionError) return json({ error: 'Could not create the subscription payment record.' }, 500);

    try {
      const checkout = await paystackRequest('/transaction/initialize', paystackSecret, 'POST', {
        email: authData.user.email,
        amount: String(amount),
        currency: plan.currency,
        reference,
        callback_url: callbackUrl,
        metadata: { organization_id: organizationId, plan_id: plan.id, purpose: 'subscription_payment' },
      });
      const { error: pendingError } = await serviceClient.from('billing_transactions')
        .update({ status: 'pending' }).eq('reference', reference);
      if (pendingError) return json({ error: 'Checkout was initialized but its status could not be saved. Do not retry; contact support with reference ' + reference }, 500);
      return json({ authorizationUrl: checkout.authorization_url, reference, amountMinorUnits: amount, currency: plan.currency });
    } catch (error) {
      await serviceClient.from('billing_transactions').update({ status: 'failed' }).eq('reference', reference);
      return json({ error: error instanceof Error ? error.message : 'Could not initialize Paystack payment.' }, 502);
    }
  }

  if (action === 'manage-link') {
    const { data: subscription, error: subscriptionError } = await serviceClient.from('organization_subscriptions')
      .select('provider_subscription_code').eq('organization_id', organizationId).maybeSingle();
    if (subscriptionError || !subscription?.provider_subscription_code) {
      return json({ error: 'There is no active Paystack subscription to manage yet.' }, 404);
    }
    try {
      const result = await paystackRequest('/subscription/' + encodeURIComponent(subscription.provider_subscription_code) + '/manage/link', paystackSecret);
      return json({ url: result.link });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Could not create the subscription management link.' }, 502);
    }
  }

  return json({ error: 'Unsupported billing action.' }, 400);
});

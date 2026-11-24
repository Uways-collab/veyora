import { createClient } from 'npm:@supabase/supabase-js@2';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function getSecretKey() {
  const direct = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (direct) return direct;
  try {
    return (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>).default ?? null;
  } catch { return null; }
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function verifySignature(rawBody: string, request: Request) {
  const modern = request.headers.get('Paystack-Signature');
  const webhookSecret = Deno.env.get('PAYSTACK_WEBHOOK_SECRET');
  if (modern && webhookSecret) {
    let timestamp: number | null = null;
    const signatures: string[] = [];
    for (const part of modern.split(',')) {
      const [key, ...rest] = part.trim().split('=');
      const value = rest.join('=').trim();
      if (key === 't') {
        if (timestamp !== null || !/^\d+$/.test(value)) return false;
        timestamp = Number(value);
      } else if (key === 'v1') {
        const separator = value.indexOf(':');
        if (separator > 0) signatures.push(value.slice(separator + 1));
      }
    }
    if (timestamp === null || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300 || signatures.length === 0) return false;
    const expected = await hmacHex(webhookSecret, timestamp + '.' + rawBody);
    return signatures.some((signature) => /^[0-9a-f]{128}$/.test(signature) && safeEqual(expected, signature));
  }

  const legacy = request.headers.get('x-paystack-signature') ?? '';
  const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!legacy || !secretKey || !/^[0-9a-f]{128}$/.test(legacy)) return false;
  return safeEqual(await hmacHex(secretKey, rawBody), legacy);
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

function subscriptionCode(data: Record<string, any>) {
  return String(data.subscription?.subscription_code ?? data.subscription_code ?? data.subscription?.code ?? '');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const rawBody = await req.text();
  if (rawBody.length > 1024 * 1024) return json({ error: 'Webhook payload too large.' }, 413);
  if (!await verifySignature(rawBody, req)) return json({ error: 'Invalid Paystack webhook signature.' }, 401);

  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = getSecretKey();
  if (!secret || !supabaseUrl || !serviceKey) return json({ error: 'Webhook server configuration is incomplete.' }, 503);
  if (secret.startsWith('sk_live_') && Deno.env.get('PAYSTACK_ENABLE_LIVE_BILLING') !== 'true') return json({ error: 'Live Paystack webhook processing is intentionally disabled until live billing is approved.' }, 503);

  let event: Record<string, any>;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'Invalid webhook JSON.' }, 400); }
  const eventType = typeof event.event === 'string' ? event.event : '';
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, any> : {};
  if (!eventType) return json({ error: 'Webhook event type is missing.' }, 400);

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const eventObjectId = data.id ?? data.reference ?? subscriptionCode(data) ?? 'unknown';
  const eventTime = data.createdAt ?? data.created_at ?? data.paid_at ?? '';
  const eventId = (eventType + ':' + String(eventObjectId) + ':' + String(eventTime)).slice(0, 255);

  const { error: eventInsertError } = await serviceClient.from('paystack_webhook_events').insert({
    event_id: eventId, event_type: eventType, payload: event,
  });
  if (eventInsertError?.code === '23505') {
    const { data: existing } = await serviceClient.from('paystack_webhook_events')
      .select('processed_at,processing_error').eq('event_id', eventId).maybeSingle();
    if (existing?.processed_at) return json({ received: true, duplicate: true });
  } else if (eventInsertError) {
    return json({ error: 'Could not record webhook event for idempotent processing.' }, 500);
  }

  const staleClaimBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: claim, error: claimError } = await serviceClient.from('paystack_webhook_events')
    .update({ processing_started_at: new Date().toISOString() })
    .eq('event_id', eventId).is('processed_at', null)
    .or('processing_started_at.is.null,processing_started_at.lt.' + staleClaimBefore)
    .select('event_id').maybeSingle();
  if (claimError) return json({ error: 'Could not claim webhook event for processing.' }, 500);
  if (!claim) return json({ received: true, processing: true });

  try {
    if (eventType === 'charge.success') {
      const reference = String(data.reference ?? '');
      if (reference) {
        const { data: transaction } = await serviceClient.from('billing_transactions')
          .select('id,organization_id,plan_id,reference,purpose,amount_minor_units,currency,status,provider_subscription_code,provider_refund_id,metadata')
          .eq('reference', reference).maybeSingle();
        if (transaction?.purpose === 'trial_card_verification' && transaction.status !== 'refunded' && !(transaction.status === 'refund_pending' && transaction.provider_refund_id)) {
          const verified = await paystackRequest('/transaction/verify/' + encodeURIComponent(reference), secret);
          const metadata = verified.metadata ?? {};
          if (verified.status !== 'success' ||
              Number(verified.amount) !== Number(transaction.amount_minor_units) ||
              verified.currency !== transaction.currency ||
              String(metadata.organization_id ?? '') !== transaction.organization_id ||
              String(metadata.plan_id ?? '') !== transaction.plan_id) {
            throw new Error('Verified Paystack transaction does not match the expected Veyora card-verification record.');
          }

          const authorizationCode = String(verified.authorization?.authorization_code ?? '');
          const reusable = verified.authorization?.reusable === true;
          const customerCode = String(verified.customer?.customer_code ?? '');
          if (!authorizationCode || !reusable || !customerCode) {
            await serviceClient.from('billing_transactions').update({ status: 'refund_pending' }).eq('id', transaction.id);
            const refund = await paystackRequest('/refund', secret, 'POST', {
              transaction: reference,
              amount: Number(transaction.amount_minor_units),
              customer_note: 'Veyora trial card verification refund',
              merchant_note: 'Card could not be saved for Veyora trial; refund verification charge',
            });
            await serviceClient.from('billing_transactions').update({
              provider_refund_id: Number(refund.id),
              refund_expected_at: refund.expected_at ?? null,
            }).eq('id', transaction.id);
            await serviceClient.from('organization_subscriptions').update({ status: 'expired' })
              .eq('organization_id', transaction.organization_id);
            await serviceClient.from('paystack_webhook_events').update({ processed_at: new Date().toISOString(), processing_error: null }).eq('event_id', eventId);
            await serviceClient.from('paystack_webhook_events').update({ processed_at: new Date().toISOString(), processing_error: null }).eq('event_id', eventId);
            return json({ received: true, refunded: true });
          }

          const { data: plan } = await serviceClient.from('subscription_plans')
            .select('provider_plan_code').eq('id', transaction.plan_id).maybeSingle();
          if (!plan?.provider_plan_code) {
            await serviceClient.from('billing_transactions').update({ status: 'refund_pending' }).eq('id', transaction.id);
            const refund = await paystackRequest('/refund', secret, 'POST', {
              transaction: reference, amount: Number(transaction.amount_minor_units),
              customer_note: 'Veyora trial card verification refund',
              merchant_note: 'Veyora plan configuration issue; refund verification charge',
            });
            await serviceClient.from('billing_transactions').update({ provider_refund_id: Number(refund.id), refund_expected_at: refund.expected_at ?? null }).eq('id', transaction.id);
            await serviceClient.from('organization_subscriptions').update({ status: 'expired' }).eq('organization_id', transaction.organization_id);
            return json({ received: true, refunded: true });
          }

          const { data: existingSubscription } = await serviceClient.from('organization_subscriptions')
            .select('provider_subscription_code,trial_starts_at,trial_ends_at')
            .eq('organization_id', transaction.organization_id).maybeSingle();
          let providerSubscriptionCode = existingSubscription?.provider_subscription_code ?? transaction.provider_subscription_code ?? null;
          let trialStartsAt = String(transaction.metadata?.trial_starts_at ?? existingSubscription?.trial_starts_at ?? new Date().toISOString());
          let trialEndsAt = String(transaction.metadata?.trial_ends_at ?? existingSubscription?.trial_ends_at ?? new Date(new Date(trialStartsAt).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString());

          if (!providerSubscriptionCode) {
            let created: Record<string, unknown>;
            try {
              created = await paystackRequest('/subscription', secret, 'POST', {
                customer: customerCode,
                plan: plan.provider_plan_code,
                authorization: authorizationCode,
                start_date: trialEndsAt,
              });
            } catch (subscriptionError) {
              await serviceClient.from('billing_transactions').update({ status: 'refund_pending' }).eq('id', transaction.id);
              const refund = await paystackRequest('/refund', secret, 'POST', {
                transaction: reference, amount: Number(transaction.amount_minor_units),
                customer_note: 'Veyora trial card verification refund',
                merchant_note: 'Veyora could not create the recurring subscription; refund verification charge',
              });
              await serviceClient.from('billing_transactions').update({ provider_refund_id: Number(refund.id), refund_expected_at: refund.expected_at ?? null }).eq('id', transaction.id);
              await serviceClient.from('organization_subscriptions').update({ status: 'expired' }).eq('organization_id', transaction.organization_id);
              return json({ received: true, refunded: true });
            }
            providerSubscriptionCode = String(created.subscription_code ?? '');
            if (!providerSubscriptionCode) throw new Error('Paystack returned no subscription code.');
          }

          const { error: providerCodeSaveError } = await serviceClient.from('billing_transactions').update({
            provider_subscription_code: providerSubscriptionCode,
            provider_customer_code: customerCode,
            metadata: { ...(transaction.metadata ?? {}), trial_starts_at: trialStartsAt, trial_ends_at: trialEndsAt },
          }).eq('id', transaction.id);
          if (providerCodeSaveError) throw new Error('Could not persist the Paystack subscription reference.');

          const { error: subscriptionSaveError } = await serviceClient.from('organization_subscriptions').upsert({
            organization_id: transaction.organization_id,
            plan_id: transaction.plan_id,
            status: 'trial_pending',
            provider: 'paystack',
            provider_customer_code: customerCode,
            provider_subscription_code: providerSubscriptionCode,
            provider_plan_code: plan.provider_plan_code,
            trial_starts_at: trialStartsAt,
            trial_ends_at: trialEndsAt,
            trial_card_reference: reference,
            card_verified_at: new Date().toISOString(),
            latest_payment_reference: reference,
          }, { onConflict: 'organization_id' });
          if (subscriptionSaveError) throw new Error('Could not save the verified Paystack subscription.');

          await serviceClient.from('billing_transactions').update({
            status: 'succeeded',
            provider_transaction_id: Number(verified.id),
            provider_customer_code: customerCode,
            provider_subscription_code: providerSubscriptionCode,
          }).eq('id', transaction.id);

          if (!transaction.provider_refund_id) {
            await serviceClient.from('billing_transactions').update({
              status: 'refund_pending',
              provider_subscription_code: providerSubscriptionCode,
            }).eq('id', transaction.id);
            const refund = await paystackRequest('/refund', secret, 'POST', {
              transaction: reference,
              amount: Number(transaction.amount_minor_units),
              customer_note: 'Veyora trial card verification refund',
              merchant_note: 'Automatic refund of Veyora trial card verification charge',
            });
            await serviceClient.from('billing_transactions').update({
              provider_refund_id: Number(refund.id),
              refund_expected_at: refund.expected_at ?? null,
            }).eq('id', transaction.id);
          }
        }
      }
    } else if (eventType === 'refund.processed' || eventType === 'refund.failed') {
      const reference = String(data.transaction?.reference ?? data.transaction_reference ?? data.reference ?? '');
      const transactionId = typeof data.transaction === 'number' ? data.transaction : null;
      const nextStatus = eventType === 'refund.processed' ? 'refunded' : 'refund_failed';
      let transaction: Record<string, any> | null = null;
      if (reference) {
        const lookup = await serviceClient.from('billing_transactions')
          .select('id,organization_id,provider_subscription_code').eq('reference', reference).maybeSingle();
        transaction = lookup.data;
      } else if (transactionId !== null) {
        const lookup = await serviceClient.from('billing_transactions')
          .select('id,organization_id,provider_subscription_code').eq('provider_transaction_id', transactionId).maybeSingle();
        transaction = lookup.data;
      }
      if (transaction) {
        await serviceClient.from('billing_transactions').update({
          status: nextStatus,
          refunded_at: eventType === 'refund.processed' ? new Date().toISOString() : null,
          provider_refund_id: data.id ? Number(data.id) : null,
        }).eq('id', transaction.id);
        if (eventType === 'refund.processed') {
          await serviceClient.from('organization_subscriptions').update({
            status: transaction.provider_subscription_code ? 'trialing' : 'expired',
          }).eq('organization_id', transaction.organization_id);
        } else if (!transaction.provider_subscription_code) {
          await serviceClient.from('organization_subscriptions').update({ status: 'expired' })
            .eq('organization_id', transaction.organization_id);
        }
      }
    } else if (eventType === 'charge.failed') {
      const reference = String(data.reference ?? '');
      if (reference) await serviceClient.from('billing_transactions').update({ status: 'failed' })
        .eq('reference', reference).eq('purpose', 'trial_card_verification');
    } else if (eventType === 'invoice.payment_failed') {
      const code = subscriptionCode(data);
      if (code) await serviceClient.from('organization_subscriptions').update({ status: 'past_due' })
        .eq('provider_subscription_code', code);
    } else if (eventType === 'subscription.not_renew') {
      const code = subscriptionCode(data);
      if (code) await serviceClient.from('organization_subscriptions').update({ cancel_at_period_end: true })
        .eq('provider_subscription_code', code);
    } else if (eventType === 'subscription.disable') {
      const code = subscriptionCode(data);
      if (code) await serviceClient.from('organization_subscriptions').update({ status: 'cancelled' })
        .eq('provider_subscription_code', code);
    } else if (eventType === 'invoice.update') {
      const code = subscriptionCode(data);
      if (code && (data.status === 'success' || data.paid === true)) {
        await serviceClient.from('organization_subscriptions').update({
          status: 'active',
          current_period_starts_at: data.period_start ?? data.paid_at ?? new Date().toISOString(),
          current_period_ends_at: data.period_end ?? data.due_date ?? null,
          latest_payment_reference: data.transaction?.reference ?? data.reference ?? null,
        }).eq('provider_subscription_code', code);
      }
    }

    await serviceClient.from('paystack_webhook_events').update({
      processed_at: new Date().toISOString(), processing_error: null,
    }).eq('event_id', eventId);
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed.';
    await serviceClient.from('paystack_webhook_events').update({
      processing_error: message,
      processing_started_at: null,
    }).eq('event_id', eventId);
    return json({ error: message }, 500);
  }
});

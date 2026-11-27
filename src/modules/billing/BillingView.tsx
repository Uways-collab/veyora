import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';

type Plan = { id: string; code: string; name: string; billing_interval: string; currency: string; amount_minor_units: number; included_users: number | null; included_locations: number | null; ai_invoice_scans: number; ai_assistant_requests: number; features: Record<string, boolean>; provider_plan_code: string | null };
type Subscription = { status: string; plan_id: string; trial_starts_at: string | null; trial_ends_at: string | null; current_period_ends_at: string | null; cancel_at_period_end: boolean; provider_subscription_code: string | null };
type Transaction = { reference: string; amount_minor_units: number; currency: string; status: string; purpose: string; created_at: string };
type BillingConfig = { trialDays: number; currency: string; paystackConfigured: boolean; paystackMode?: string; liveBillingEnabled?: boolean; planSyncAvailable: boolean };

export function BillingView() {
  const { activeOrganisation, activeRole } = useAuth();
  const supabase = getSupabaseClient();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isOwner = activeRole === 'owner';

  const invoke = async (body: Record<string, unknown>) => {
    if (!supabase || !activeOrganisation) throw new Error('No active workspace is available.');
    const { data, error: invokeError } = await supabase.functions.invoke('paystack-billing', { body: { organization_id: activeOrganisation.id, ...body } });
    if (invokeError) throw invokeError;
    if (!data || data.error) throw new Error(data?.error ?? 'Billing request failed.');
    return data;
  };

  const load = useCallback(async () => {
    if (!supabase || !activeOrganisation || !isOwner) { setLoading(false); return; }
    setLoading(true); setError(null);
    const [p, s, t, c] = await Promise.all([
      supabase.from('subscription_plans').select('id,code,name,billing_interval,currency,amount_minor_units,included_users,included_locations,ai_invoice_scans,ai_assistant_requests,features,provider_plan_code').eq('is_active', true).order('amount_minor_units'),
      supabase.from('organization_subscriptions').select('status,plan_id,trial_starts_at,trial_ends_at,current_period_ends_at,cancel_at_period_end,provider_subscription_code').eq('organization_id', activeOrganisation.id).maybeSingle(),
      supabase.from('billing_transactions').select('reference,amount_minor_units,currency,status,purpose,created_at').eq('organization_id', activeOrganisation.id).order('created_at', { ascending: false }).limit(10),
      supabase.functions.invoke('paystack-billing', { body: { action: 'billing-config', organization_id: activeOrganisation.id } }),
    ]);
    if (p.error) setError('Could not load plans: ' + p.error.message); else setPlans((p.data ?? []) as Plan[]);
    if (s.error) setError('Could not load subscription: ' + s.error.message); else setSubscription(s.data as Subscription | null);
    if (t.error) setError('Could not load billing history: ' + t.error.message); else setTransactions((t.data ?? []) as Transaction[]);
    if (c.error) setError('Could not check billing configuration: ' + c.error.message); else if (c.data && !c.data.error) setConfig(c.data as BillingConfig);
    setLoading(false);
  }, [supabase, activeOrganisation?.id, isOwner]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference');
    if (!reference || !activeOrganisation || !isOwner || !supabase) return;
    setNotice('Payment returned to Veyora. We are waiting for Paystack’s signed confirmation before restoring workspace access.');
    void load();
    const url = new URL(window.location.href);
    url.searchParams.delete('reference');
    window.history.replaceState({}, '', url.pathname + url.hash + url.search);
  }, [activeOrganisation?.id, isOwner, supabase, load]);

  const startFreeTrial = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await invoke({ action: 'start-free-trial' });
      setNotice(result.note ?? 'Your 7-day free trial has started. No card or payment is required.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start the free trial.'); }
    finally { setBusy(false); }
  };

  const payForPlan = async (planId: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await invoke({ action: 'initialize-subscription-payment', plan_id: planId });
      if (typeof result.authorizationUrl !== 'string' || !result.authorizationUrl.startsWith('https://')) throw new Error('Paystack did not return a secure checkout URL.');
      window.location.assign(result.authorizationUrl);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not initialize subscription payment.'); setBusy(false); }
  };

  const syncPlans = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { const result = await invoke({ action: 'sync-plans' }); setNotice('Paystack plans synchronised. ' + (result.plans?.length ?? 0) + ' plans checked.'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sync Paystack plans.'); }
    finally { setBusy(false); }
  };

  const manage = async () => {
    setBusy(true); setError(null);
    try { const result = await invoke({ action: 'manage-link' }); if (!String(result.url).startsWith('https://')) throw new Error('Invalid Paystack management URL.'); window.open(result.url, '_blank', 'noopener,noreferrer'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not open payment management.'); }
    finally { setBusy(false); }
  };

  const money = (minor: number, currency = 'NGN') => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100); }
    catch { return (minor / 100).toLocaleString() + ' ' + currency; }
  };

  if (!activeOrganisation) return null;
  if (!isOwner) return <section className="rounded-xl border border-slate-200 bg-white p-6"><h1 className="text-lg font-semibold text-slate-900">Subscription & Billing</h1><p className="mt-2 text-sm text-slate-600">Only the workspace Owner can manage plans and payment methods.</p></section>;

  const monthly = plans.filter((p) => p.billing_interval === 'monthly');
  const yearly = plans.filter((p) => p.billing_interval === 'yearly');
  const currentPlan = plans.find((p) => p.id === subscription?.plan_id);
  const trialExpired = Boolean(subscription?.status === 'trialing' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() <= Date.now());
  const trialActive = Boolean(subscription?.status === 'trialing' && subscription.trial_ends_at && new Date(subscription.trial_ends_at).getTime() > Date.now());
  const paidActive = Boolean(subscription?.status === 'active' && (!subscription.current_period_ends_at || new Date(subscription.current_period_ends_at).getTime() > Date.now()));
  const paymentNeedsAttention = trialExpired || subscription?.status === 'past_due' || subscription?.status === 'expired' || (!subscription && false);
  const planFeatureLabels = [
    ['inventory','Inventory'],['sales','Sales & POS'],['purchases','Purchases'],
    ['finance','Finance'],['industry','Business-specific workspace'],['ai_assistant','AI assistant'],
    ['advanced_reports','Advanced reports'],['multi_location','Multiple locations'],['advanced_analytics','Advanced analytics'],['api_exports','Data exports'],
  ] as const;
  const featureSummary = (plan: Plan) => planFeatureLabels.filter(([key]) => plan.features?.[key] === true).map(([,label]) => label);
  const renderPlan = (plan: Plan, annual = false) => <article key={plan.id} className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-900">{plan.name}{annual ? ' Annual' : ''}</h3>{annual && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">2 months free</span>}</div>
    <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{money(plan.amount_minor_units,plan.currency)}<span className="ml-1 text-xs font-normal text-slate-500">/ {annual ? 'year' : 'month'}</span></div>
    <p className="mt-2 text-xs text-slate-500">{plan.included_users ?? '—'} users · {plan.included_locations ?? '—'} locations</p>
    <p className="mt-1 text-[11px] text-slate-500">{plan.ai_invoice_scans} invoice scans · {plan.ai_assistant_requests} AI assistant requests / month</p>
    <p className="mt-3 text-[11px] leading-5 text-slate-600">{featureSummary(plan).join(' · ')}</p>
    <button type="button" onClick={() => void payForPlan(plan.id)} disabled={busy || !config?.paystackConfigured || (!config?.liveBillingEnabled && config?.paystackMode === 'live')} className="mt-4 w-full rounded-lg bg-blue-700 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Please wait…' : paidActive ? 'Change plan & pay' : 'Pay & activate'}</button>
  </article>;

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-700"><CreditCard className="h-4 w-4" /> Workspace billing</div><h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Subscription & Billing</h1><p className="mt-1 text-sm text-slate-600">Manage the Veyora plan for {activeOrganisation.name}.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
    </header>
    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}

    <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold text-slate-900">Current subscription</h2>{subscription ? <p className="mt-1 text-sm text-slate-600">{trialActive ? '7-day free trial' : currentPlan?.name ?? 'Veyora plan'} · <span className="capitalize">{subscription.status.replaceAll('_',' ')}</span></p> : <p className="mt-1 text-sm text-slate-600">No subscription has been activated for this workspace.</p>}{subscription?.trial_ends_at && <p className="mt-1 text-xs text-slate-500">Free trial ends {new Date(subscription.trial_ends_at).toLocaleString()}.</p>}{subscription?.current_period_ends_at && <p className="mt-1 text-xs text-slate-500">Paid period ends {new Date(subscription.current_period_ends_at).toLocaleDateString()}.</p>}{subscription?.cancel_at_period_end && <p className="mt-1 text-xs font-medium text-amber-700">Cancellation is scheduled at the end of this period.</p>}</div>{subscription?.provider_subscription_code && <button type="button" onClick={() => void manage()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Manage payment method <ExternalLink className="h-3.5 w-3.5" /></button>}</div></section>

    {trialActive && <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-blue-700" /><div><h2 className="text-sm font-semibold text-slate-900">Your 7-day free trial is active</h2><p className="mt-1 text-xs leading-5 text-slate-600">Enjoy Veyora for seven days. No credit card, verification charge or payment details are required. At the end of the trial, workspace operations pause until the Owner completes a subscription payment.</p></div></div></section>}

    {paymentNeedsAttention && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><strong>Payment required — business access is locked.</strong><p className="mt-1 text-xs leading-5 text-slate-700">Your free trial has ended or your subscription is no longer active. Choose a plan below and complete payment. Veyora restores workspace access only after Paystack confirms the successful payment.</p></div>}

    {!subscription && <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-blue-700" /><div><h2 className="text-sm font-semibold text-slate-900">Start your 7-day free trial</h2><p className="mt-1 text-xs leading-5 text-slate-600">Get seven days of Veyora access immediately. No credit card, no verification charge and no payment details.</p></div></div><button type="button" onClick={() => void startFreeTrial()} disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Starting…' : 'Start 7-day free trial'}</button></div></section>}

    <section className="space-y-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-base font-semibold text-slate-900">Veyora subscription plans</h2><p className="mt-1 text-xs text-slate-500">Choose monthly or annual billing. Payment is collected only when you choose a paid plan.</p></div><button type="button" onClick={() => void syncPlans()} disabled={busy || !config?.planSyncAvailable || plans.every((p) => p.provider_plan_code)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{busy ? 'Please wait…' : 'Sync Paystack plans'}</button></div>
      {loading ? <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading plans…</div> : <><div className="grid gap-3 md:grid-cols-3">{monthly.map((plan) => renderPlan(plan))}</div><div className="grid gap-3 md:grid-cols-3">{yearly.map((plan) => renderPlan(plan,true))}</div></>}</section>

    <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-900">Recent billing activity</h2></div>{transactions.length === 0 ? <p className="p-6 text-xs text-slate-500">No billing transactions yet.</p> : <div className="divide-y divide-slate-100">{transactions.map((tx) => <div key={tx.reference} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><div className="text-xs font-semibold capitalize text-slate-800">{tx.purpose.replaceAll('_',' ')}</div><div className="mt-1 text-[11px] text-slate-500">{tx.reference} · {new Date(tx.created_at).toLocaleString()}</div></div><div className="text-right"><div className="text-xs font-semibold text-slate-800">{money(tx.amount_minor_units,tx.currency)}</div><div className="mt-1 text-[11px] capitalize text-slate-500">{tx.status.replaceAll('_',' ')}</div></div></div>)}</div>}</section>
  </div>;
}

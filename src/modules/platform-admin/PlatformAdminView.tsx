import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, RefreshCw, ShieldCheck, Users, Building2, UserCheck,
  CreditCard, Clock3, AlertTriangle, Activity, Bot, Search, Ban, CheckCircle2,
} from 'lucide-react';
import { getSupabaseClient } from '../../core/supabase/client';

type AdminTab = 'overview' | 'users' | 'workspaces' | 'subscriptions' | 'usage' | 'activity';
type PlatformStats = {
  registeredUsers: number;
  newUsersLast30Days: number;
  businesses: number;
  memberships: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  businessTypes: Record<string, number>;
  aiUsageLast30Days: number;
  aiUsageByFeature: Record<string, number>;
  invoiceScannerConfigured: boolean;
  generatedAt: string;
};
type UserRow = {
  id: string; email: string; createdAt: string; lastSignInAt: string | null;
  emailConfirmedAt: string | null; disabled: boolean; bannedUntil: string | null; isPlatformOwner: boolean;
};
type WorkspaceRow = {
  id: string; name: string; businessType: string | null; country: string; currency: string;
  createdAt: string; membershipCount: number;
  subscription: { status: string; plan: { name: string; code: string } | null; trialEndsAt: string | null; currentPeriodEndsAt: string | null; cancelAtPeriodEnd: boolean } | null;
};
type SubscriptionRow = {
  organizationId: string; organizationName: string; status: string;
  plan: { name: string; code: string; billing_interval: string; currency: string; amount_minor_units: number } | null;
  trialStartsAt: string | null; trialEndsAt: string | null; currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null; cancelAtPeriodEnd: boolean; provider: string | null; updatedAt: string;
};
type UsageRow = {
  organizationId: string; organizationName: string; feature: string; requests: number;
  inputTokens: number; outputTokens: number; estimatedCostMinorUnits: number;
};
type ActivityRow = { id: string; organizationName?: string; action: string; entityType?: string; createdAt?: string; created_at?: string; reason?: string; actor_user_id?: string; target_user_id?: string };

const number = (value: number) => new Intl.NumberFormat('en-NG').format(value);
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : '—';
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

export function PlatformAdminView() {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [workspaceEvents, setWorkspaceEvents] = useState<ActivityRow[]>([]);
  const [adminEvents, setAdminEvents] = useState<ActivityRow[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [auditReason, setAuditReason] = useState('');
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const invoke = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Veyora is not connected to Supabase.');
    const { data, error: invokeError } = await supabase.functions.invoke('veyora-platform-admin', {
      body: { action, ...extra },
    });
    if (invokeError || data?.error) throw new Error(data?.error ?? invokeError?.message ?? 'Platform request failed.');
    return data as Record<string, any>;
  }, []);

  const load = useCallback(async (selectedTab: AdminTab = tab) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (selectedTab === 'overview') {
        setStats(await invoke('overview') as PlatformStats);
      } else if (selectedTab === 'users') {
        const data = await invoke('users', { page, per_page: 50, search });
        setUsers(data.users ?? []);
      } else if (selectedTab === 'workspaces') {
        const data = await invoke('workspaces', { page, per_page: 50 });
        setWorkspaces(data.workspaces ?? []);
      } else if (selectedTab === 'subscriptions') {
        const data = await invoke('subscriptions', { page, per_page: 50 });
        setSubscriptions(data.subscriptions ?? []);
      } else if (selectedTab === 'usage') {
        const data = await invoke('usage');
        setUsage(data.usage ?? []);
      } else {
        const data = await invoke('activity', { per_page: 50 });
        setWorkspaceEvents(data.workspaceEvents ?? []);
        setAdminEvents(data.adminEvents ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Platform data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [invoke, page, search, tab]);

  useEffect(() => { void load(tab); }, [tab, page, search, load]);

  const changeUserAccess = async (user: UserRow) => {
    const nextDisabled = !user.disabled;
    const actionLabel = nextDisabled ? 'disable' : 'restore';
    if (auditReason.trim().length < 5) {
      setError('Enter a reason of at least five characters before changing account access.');
      return;
    }
    if (!window.confirm(`Are you sure you want to ${actionLabel} ${user.email}? This affects their ability to sign in.`)) return;
    setBusyUser(user.id);
    setError(null);
    setNotice(null);
    try {
      await invoke('set-user-access', { user_id: user.id, disabled: nextDisabled, reason: auditReason.trim() });
      setAuditReason('');
      await load('users');
      setNotice(`Account access ${nextDisabled ? 'disabled' : 'restored'} for ${user.email}. The change was recorded in the platform audit log.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account access could not be changed.');
    } finally {
      setBusyUser(null);
    }
  };

  const cards = stats ? [
    { label: 'Registered users', value: stats.registeredUsers, note: `+${number(stats.newUsersLast30Days)} in the last 30 days`, icon: Users },
    { label: 'Business workspaces', value: stats.businesses, note: 'Organisations registered on Veyora', icon: Building2 },
    { label: 'Workspace memberships', value: stats.memberships, note: 'Owners, admins, managers and staff', icon: UserCheck },
    { label: 'Active subscriptions', value: stats.activeSubscriptions, note: 'Currently paid and active', icon: CreditCard },
    { label: 'Card-backed trials', value: stats.trialingSubscriptions, note: 'Currently within trial period', icon: Clock3 },
    { label: 'Past-due subscriptions', value: stats.pastDueSubscriptions, note: 'Require billing follow-up', icon: AlertTriangle },
    { label: 'AI requests · 30 days', value: stats.aiUsageLast30Days, note: 'Invoice scanning and assistant usage', icon: Bot },
  ] : [];

  const tabs: { id: AdminTab; label: string; icon: typeof Users }[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'workspaces', label: 'Workspaces', icon: Building2 },
    { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
    { id: 'usage', label: 'AI usage', icon: Bot },
    { id: 'activity', label: 'Audit & activity', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700"><ShieldCheck className="h-4 w-4" /> Veyora platform administration</div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Platform control centre</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Manage account access and monitor workspaces, subscriptions, AI usage and audit activity. Customer invoices, sales and private business records stay tenant-isolated.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { window.location.hash = ''; }} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-3.5 w-3.5" /> Business workspace</button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </header>

      <nav aria-label="Platform administration sections" className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setPage(1); }}
            className={tab === id ? 'inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white' : 'inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100'}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </nav>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading {tab === 'overview' ? 'platform overview' : tab}…</div>}

      {!loading && tab === 'overview' && stats && <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ label, value, note, icon: Icon }) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500">{label}</span><Icon className="h-4 w-4 text-slate-400" /></div><div className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{number(value)}</div><p className="mt-1 text-xs text-slate-500">{note}</p></article>)}
        </section>
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Business types</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(stats.businessTypes).sort((a,b)=>b[1]-a[1]).map(([type,count])=><div key={type} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="capitalize text-slate-700">{titleCase(type)}</span><strong className="tabular-nums text-slate-900">{number(count)}</strong></div>)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">AI requests by feature · 30 days</h2>
            <div className="mt-3 space-y-2">
              {Object.entries(stats.aiUsageByFeature).map(([feature,count])=><div key={feature} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="capitalize text-slate-700">{titleCase(feature)}</span><strong className="tabular-nums text-slate-900">{number(count)}</strong></div>)}
              {Object.keys(stats.aiUsageByFeature).length === 0 && <p className="text-xs text-slate-500">No metered AI requests recorded in this period.</p>}
            </div>
          </div>
        </section>
        <div className={stats.invoiceScannerConfigured ? 'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4' : 'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4'}>
          <div><h2 className="text-sm font-semibold text-slate-900">Invoice AI provider configuration</h2><p className="mt-1 text-xs text-slate-600">Checks only whether the Gemini API secret is present; it does not submit an invoice or expose the secret.</p></div>
          <span className={stats.invoiceScannerConfigured ? 'rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700' : 'rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800'}>{stats.invoiceScannerConfigured ? 'Gemini key configured' : 'Gemini key missing'}</span>
        </div>
        <p className="text-[11px] text-slate-500">Last updated: {dateTime(stats.generatedAt)}. Aggregate metrics only; no customer documents or financial transactions are exposed.</p>
      </>}

      {!loading && tab === 'users' && <>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-slate-900">Registered accounts</h2><p className="mt-1 text-xs text-slate-500">Only email and account-status metadata are shown. Suspending an account blocks sign-in and centrally denies workspace access; the platform-owner account cannot be suspended here.</p></div>
            <div className="relative"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search this page by email" className="w-64 rounded-md border border-slate-200 py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-400" /></div>
          </div>
          <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-3">
            <label className="text-xs font-medium text-amber-900">Audit reason for account access changes</label>
            <input value={auditReason} onChange={(e)=>setAuditReason(e.target.value)} maxLength={500} placeholder="Enter a clear reason (at least 5 characters)" className="mt-1 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-xs outline-none focus:border-amber-400" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2 pr-3 font-medium">Account</th><th className="py-2 pr-3 font-medium">Registered</th><th className="py-2 pr-3 font-medium">Last sign-in</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 text-right font-medium">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user)=><tr key={user.id}>
                  <td className="py-3 pr-3"><div className="font-medium text-slate-900">{user.email || 'No email'}</div><div className="mt-0.5 text-[10px] text-slate-400">{user.id}</div></td>
                  <td className="py-3 pr-3 text-slate-600">{dateTime(user.createdAt)}</td>
                  <td className="py-3 pr-3 text-slate-600">{dateTime(user.lastSignInAt)}</td>
                  <td className="py-3 pr-3"><span className={user.disabled ? 'rounded-full bg-rose-50 px-2 py-1 text-rose-700' : 'rounded-full bg-emerald-50 px-2 py-1 text-emerald-700'}>{user.disabled ? 'Disabled' : 'Active'}</span>{user.isPlatformOwner && <span className="ml-2 rounded-full bg-blue-50 px-2 py-1 text-blue-700">Platform owner</span>}</td>
                  <td className="py-3 text-right">{!user.isPlatformOwner && <button type="button" disabled={busyUser === user.id || auditReason.trim().length < 5} onClick={()=>void changeUserAccess(user)} className={user.disabled ? 'inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2.5 py-1.5 font-medium text-emerald-700 disabled:opacity-40' : 'inline-flex items-center gap-1 rounded-md border border-rose-200 px-2.5 py-1.5 font-medium text-rose-700 disabled:opacity-40'}>{busyUser === user.id ? 'Saving…' : user.disabled ? <><CheckCircle2 className="h-3.5 w-3.5" /> Restore</> : <><Ban className="h-3.5 w-3.5" /> Disable</>}</button>}</td>
                </tr>)}
                {users.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No accounts found on this page.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Page {page} · Up to 50 accounts</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={()=>setPage((v)=>Math.max(1,v-1))} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={users.length < 50 || loading} onClick={()=>setPage((v)=>v+1)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40">Next</button></div></div>
        </section>
      </>}

      {!loading && tab === 'workspaces' && <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Business workspaces</h2><p className="mt-1 text-xs text-slate-500">Workspace identity and access summaries only; no operational records are queried.</p>
        <table className="mt-4 w-full min-w-[800px] text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2 pr-3">Workspace</th><th className="py-2 pr-3">Business type</th><th className="py-2 pr-3">Members</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3">Subscription</th><th className="py-2">Created</th></tr></thead><tbody className="divide-y divide-slate-100">{workspaces.map((row)=><tr key={row.id}><td className="py-3 pr-3"><div className="font-medium text-slate-900">{row.name}</div><div className="text-[10px] text-slate-400">{row.country} · {row.currency}</div></td><td className="py-3 pr-3 capitalize text-slate-600">{row.businessType ? titleCase(row.businessType) : '—'}</td><td className="py-3 pr-3 tabular-nums">{number(row.membershipCount)}</td><td className="py-3 pr-3">{row.subscription?.plan?.name ?? '—'}</td><td className="py-3 pr-3 capitalize">{row.subscription?.status ?? 'No subscription'}</td><td className="py-3">{dateTime(row.createdAt)}</td></tr>)}{workspaces.length===0&&<tr><td colSpan={6} className="py-8 text-center text-slate-500">No workspaces found on this page.</td></tr>}</tbody></table>
        <div className="mt-3 flex justify-between border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Page {page} · Up to 50 workspaces</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>setPage(v=>Math.max(1,v-1))} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button disabled={workspaces.length<50} onClick={()=>setPage(v=>v+1)} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40">Next</button></div></div>
      </section>}

      {!loading && tab === 'subscriptions' && <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Subscription oversight</h2><p className="mt-1 text-xs text-slate-500">Billing status is monitored here; Paystack webhooks remain the source of truth. This console does not manually grant or extend subscriptions.</p>
        <table className="mt-4 w-full min-w-[850px] text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2 pr-3">Workspace</th><th className="py-2 pr-3">Plan</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Period ends</th><th className="py-2">Updated</th></tr></thead><tbody className="divide-y divide-slate-100">{subscriptions.map((row)=><tr key={row.organizationId}><td className="py-3 pr-3 font-medium text-slate-900">{row.organizationName}</td><td className="py-3 pr-3">{row.plan?.name ?? '—'}</td><td className="py-3 pr-3 tabular-nums">{row.plan ? `${row.plan.currency} ${(Number(row.plan.amount_minor_units)/100).toLocaleString()}` : '—'}</td><td className="py-3 pr-3 capitalize">{row.status}{row.cancelAtPeriodEnd ? ' · Cancels at period end' : ''}</td><td className="py-3 pr-3">{dateTime(row.currentPeriodEndsAt ?? row.trialEndsAt)}</td><td className="py-3">{dateTime(row.updatedAt)}</td></tr>)}{subscriptions.length===0&&<tr><td colSpan={6} className="py-8 text-center text-slate-500">No subscriptions found on this page.</td></tr>}</tbody></table>
        <div className="mt-3 flex justify-between border-t border-slate-100 pt-3"><span className="text-xs text-slate-500">Page {page} · Up to 50 subscriptions</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>setPage(v=>Math.max(1,v-1))} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button disabled={subscriptions.length<50} onClick={()=>setPage(v=>v+1)} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40">Next</button></div></div>
      </section>}

      {!loading && tab === 'usage' && <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">AI usage · Last 90 days</h2><p className="mt-1 text-xs text-slate-500">Aggregated request, token and estimated-cost totals by workspace and feature. Prompts, invoices and extracted content are not exposed.</p>
        <table className="mt-4 w-full min-w-[780px] text-left text-xs"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="py-2 pr-3">Workspace</th><th className="py-2 pr-3">Feature</th><th className="py-2 pr-3">Requests</th><th className="py-2 pr-3">Input tokens</th><th className="py-2 pr-3">Output tokens</th><th className="py-2">Est. cost (minor units)</th></tr></thead><tbody className="divide-y divide-slate-100">{usage.map((row)=><tr key={row.organizationId+row.feature}><td className="py-3 pr-3 font-medium text-slate-900">{row.organizationName}</td><td className="py-3 pr-3 capitalize">{titleCase(row.feature)}</td><td className="py-3 pr-3 tabular-nums">{number(row.requests)}</td><td className="py-3 pr-3 tabular-nums">{number(row.inputTokens)}</td><td className="py-3 pr-3 tabular-nums">{number(row.outputTokens)}</td><td className="py-3 tabular-nums">{number(row.estimatedCostMinorUnits)}</td></tr>)}{usage.length===0&&<tr><td colSpan={6} className="py-8 text-center text-slate-500">No AI usage recorded in this period.</td></tr>}</tbody></table>
      </section>}

      {!loading && tab === 'activity' && <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-semibold text-slate-900">Workspace activity</h2><p className="mt-1 text-xs text-slate-500">Action metadata only; customer record contents are omitted.</p><div className="mt-3 divide-y divide-slate-100">{workspaceEvents.map((event)=><div key={event.id} className="py-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-800">{titleCase(event.action)}</span><span className="text-[10px] text-slate-400">{dateTime(event.createdAt)}</span></div><p className="mt-1 text-[11px] text-slate-500">{event.organizationName} · {event.entityType ? titleCase(event.entityType) : 'Workspace event'}</p></div>)}{workspaceEvents.length===0&&<p className="py-6 text-xs text-slate-500">No workspace activity found.</p>}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-semibold text-slate-900">Platform-admin audit log</h2><p className="mt-1 text-xs text-slate-500">Every account access change is recorded with its reason and timestamp.</p><div className="mt-3 divide-y divide-slate-100">{adminEvents.map((event)=><div key={event.id} className="py-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-800">{titleCase(event.action)}</span><span className="text-[10px] text-slate-400">{dateTime(event.created_at)}</span></div><p className="mt-1 break-all text-[10px] text-slate-500">Target: {event.target_user_id ?? '—'}</p><p className="mt-1 text-xs text-slate-600">{event.reason}</p></div>)}{adminEvents.length===0&&<p className="py-6 text-xs text-slate-500">No platform-admin actions have been recorded.</p>}</div></div>
      </section>}
    </div>
  );
}

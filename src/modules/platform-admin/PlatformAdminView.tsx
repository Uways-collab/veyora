import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldCheck, Users, Building2, UserCheck, CreditCard, Clock3, AlertTriangle } from 'lucide-react';
import { getSupabaseClient } from '../../core/supabase/client';

type PlatformStats = {
  registeredUsers: number;
  newUsersLast30Days: number;
  businesses: number;
  memberships: number;
  activeSubscriptions: number;
  trialingSubscriptions: number;
  pastDueSubscriptions: number;
  businessTypes: Record<string, number>;
  generatedAt: string;
};

const number = (value: number) => new Intl.NumberFormat('en-NG').format(value);

export function PlatformAdminView() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) { setError('Veyora is not connected to Supabase.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke('veyora-platform-admin');
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? 'Platform statistics could not be loaded.');
      setStats(null);
    } else {
      setStats(data as PlatformStats);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cards = stats ? [
    { label: 'Registered users', value: stats.registeredUsers, note: `+${number(stats.newUsersLast30Days)} in the last 30 days`, icon: Users },
    { label: 'Business workspaces', value: stats.businesses, note: 'Organisations registered on Veyora', icon: Building2 },
    { label: 'Workspace memberships', value: stats.memberships, note: 'Owners, admins, managers and staff', icon: UserCheck },
    { label: 'Active subscriptions', value: stats.activeSubscriptions, note: 'Currently paid and active', icon: CreditCard },
    { label: 'Card-backed trials', value: stats.trialingSubscriptions, note: 'Currently within trial period', icon: Clock3 },
    { label: 'Past-due subscriptions', value: stats.pastDueSubscriptions, note: 'Require billing follow-up', icon: AlertTriangle },
  ] : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700"><ShieldCheck className="h-4 w-4" /> Veyora platform administration</div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Platform overview</h1>
          <p className="mt-1 text-sm text-slate-600">Platform-wide totals only. Customer business records remain private to their organisations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { window.location.hash = ''; }} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-3.5 w-3.5" /> Business workspace</button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh statistics</button>
        </div>
      </header>
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {loading && !stats ? <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading platform statistics…</div> : null}
      {stats && <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ label, value, note, icon: Icon }) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500">{label}</span><Icon className="h-4 w-4 text-slate-400" /></div><div className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{number(value)}</div><p className="mt-1 text-xs text-slate-500">{note}</p></article>)}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Business types</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(stats.businessTypes).sort((a,b)=>b[1]-a[1]).map(([type,count])=><div key={type} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="capitalize text-slate-700">{type.replaceAll('_',' ')}</span><strong className="tabular-nums text-slate-900">{number(count)}</strong></div>)}
          </div>
        </section>
        <p className="text-[11px] text-slate-500">Last updated: {new Date(stats.generatedAt).toLocaleString()} · No customer emails, phone numbers, sales, invoices or financial records are displayed here.</p>
      </>}
    </div>
  );
}

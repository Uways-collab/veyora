import { useCallback, useEffect, useState } from 'react';
import {
  Activity, ArrowUpRight, Building2, CalendarClock, CreditCard,
  LogOut, RefreshCw, ShieldCheck, Users,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';

type AdminOverview = {
  generated_at: string;
  users_total: number;
  users_last_30_days: number;
  users_last_7_days: number;
  banned_users: number;
  workspaces_total: number;
  owner_accounts_total: number;
  memberships_total: number;
  paid_accounts: number;
  trial_accounts: number;
  successful_payments: number;
  failed_payments: number;
  revenue_by_currency: { currency: string; total_minor_units: number; transactions: number }[];
  workspaces_by_type: { business_type: string; count: number }[];
  recent_users: { id: string; email: string; created_at: string; last_sign_in_at: string | null; banned: boolean }[];
  recent_workspaces: { id: string; name: string; business_type: string; country: string; created_at: string; owner_email: string | null }[];
};

const numberFormat = new Intl.NumberFormat('en');
function formatRevenue(amountMinorUnits: number, currency: string) {
  const amount = Number(amountMinorUnits) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${numberFormat.format(amount)}`;
  }
}

const dateFormat = (value: string | null) => value
  ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  : 'Never';

function Metric({ label, value, detail, icon: Icon }: {
  label: string; value: number | string; detail: string; icon: typeof Users;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{typeof value === 'number' ? numberFormat.format(value) : value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

export function PlatformAdminView({ onOpenBusiness }: { onOpenBusiness: () => void }) {
  const { user, signOut } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = getSupabaseClient() as any;
    if (!db) {
      setError('Veyora could not connect to Supabase.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: requestError } = await db.rpc('platform_admin_overview');
    if (requestError) {
      setError(requestError.message || 'Could not load the Platform Admin overview.');
      setOverview(null);
    } else {
      setOverview(data as AdminOverview);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold">Veyora Platform Admin</p>
              <p className="text-xs text-slate-500">Global platform overview · {user?.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={onOpenBusiness} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50">
              Open business workspace
            </button>
            <button onClick={() => void load()} disabled={loading} aria-label="Refresh platform metrics" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button onClick={() => void signOut()} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6 lg:px-8">
        <section className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Platform control centre</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Veyora overview</h1>
            <p className="mt-1 text-sm text-slate-500">Monitor registered users, business workspaces, subscriptions and verified payments across Veyora.</p>
          </div>
          {overview?.generated_at && <p className="text-xs text-slate-400">Updated {dateFormat(overview.generated_at)}</p>}
        </section>

        {error && <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</section>}

        {loading && !overview ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading secure platform metrics…</section>
        ) : overview && <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Registered users" value={overview.users_total} detail={`+${numberFormat.format(overview.users_last_30_days)} in the last 30 days`} icon={Users} />
            <Metric label="Business workspaces" value={overview.workspaces_total} detail={`${numberFormat.format(overview.owner_accounts_total)} Owner accounts`} icon={Building2} />
            <Metric label="Paid accounts" value={overview.paid_accounts} detail="Currently within a paid billing period" icon={CreditCard} />
            <Metric label="Active free trials" value={overview.trial_accounts} detail="Accounts currently within their trial" icon={CalendarClock} />
            <Metric label="New users · 7 days" value={overview.users_last_7_days} detail={`${numberFormat.format(overview.users_last_30_days)} new users in 30 days`} icon={Activity} />
            <Metric label="Workspace memberships" value={overview.memberships_total} detail="Owners, admins, managers and staff" icon={Users} />
            <Metric label="Successful payments" value={overview.successful_payments} detail="Verified subscription payments" icon={CreditCard} />
            <Metric label="Failed payments" value={overview.failed_payments} detail="Failed or abandoned subscription checkouts" icon={Activity} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">Latest registered users</h2><p className="mt-1 text-xs text-slate-500">Most recent Veyora accounts</p></div>
              <div className="divide-y divide-slate-100">
                {overview.recent_users.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{item.email || 'Email unavailable'}</p><p className="mt-1 text-[11px] text-slate-500">Joined {dateFormat(item.created_at)} · Last login {dateFormat(item.last_sign_in_at)}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${item.banned ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{item.banned ? 'Suspended' : 'Active'}</span>
                </div>)}
                {!overview.recent_users.length && <p className="px-5 py-8 text-center text-xs text-slate-500">No registered users yet.</p>}
              </div>
            </article>

            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold">Latest business workspaces</h2><p className="mt-1 text-xs text-slate-500">Workspace type and owning account</p></div>
              <div className="divide-y divide-slate-100">
                {overview.recent_workspaces.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{item.name}</p><p className="mt-1 truncate text-[11px] text-slate-500">{item.owner_email || 'Owner unavailable'} · {item.country || 'Country not set'}</p></div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium capitalize text-slate-600">{item.business_type.replaceAll('_', ' ')}</span>
                </div>)}
                {!overview.recent_workspaces.length && <p className="px-5 py-8 text-center text-xs text-slate-500">No business workspaces yet.</p>}
              </div>
            </article>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold">Workspaces by business type</h2>
              <div className="mt-4 space-y-3">
                {overview.workspaces_by_type.map((item) => <div key={item.business_type}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="capitalize text-slate-600">{item.business_type.replaceAll('_', ' ')}</span><b className="text-slate-900">{numberFormat.format(item.count)}</b></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-700" style={{ width: `${overview.workspaces_total ? Math.max(2, item.count / overview.workspaces_total * 100) : 0}%` }} /></div>
                </div>)}
                {!overview.workspaces_by_type.length && <p className="text-xs text-slate-500">No workspace data available.</p>}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold">Verified subscription revenue</h2>
              <p className="mt-1 text-xs text-slate-500">Grouped by currency to avoid mixing currencies.</p>
              <div className="mt-4 space-y-3">
                {overview.revenue_by_currency.map((item) => <div key={item.currency} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
                  <div><p className="text-xs font-semibold text-slate-800">{item.currency}</p><p className="mt-1 text-[11px] text-slate-500">{numberFormat.format(item.transactions)} verified payments</p></div>
                  <p className="text-sm font-semibold text-slate-950">{formatRevenue(item.total_minor_units, item.currency)}</p>
                </div>)}
                {!overview.revenue_by_currency.length && <p className="text-xs text-slate-500">No successful subscription payments recorded yet.</p>}
              </div>
            </article>
          </section>
        </>}
        <footer className="flex items-center gap-2 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Platform-wide metrics are available only to authorised Veyora Platform Admin accounts.
          <span className="ml-auto inline-flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> Secure overview</span>
        </footer>
      </main>
    </div>
  );
}

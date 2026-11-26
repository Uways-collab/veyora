import { useEffect, useState } from 'react';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { AppShell } from './components/layout/AppShell';
import { AppErrorBoundary } from './components/shared/AppErrorBoundary';
import { AuthProvider, useAuth } from './core/auth/AuthContext';
import { MODULE_REGISTRY } from './core/modules/registry';
import type { ModuleId } from './core/types/domain';
import { AuthScreen } from './modules/auth/AuthScreen';
import { AssistantView } from './modules/ai/AssistantView';
import { LandingPage } from './modules/marketing/LandingPage';
import { CustomersView } from './modules/customers/CustomersView';
import { DashboardView } from './modules/dashboard/DashboardView';
import { ExpensesView } from './modules/expenses/ExpensesView';
import { FinanceView } from './modules/finance/FinanceView';
import { InventoryView } from './modules/inventory/InventoryView';
import { IndustryWorkspacesView } from './modules/industry/IndustryWorkspacesView';
import { BusinessOnboardingScreen } from './modules/onboarding/BusinessOnboardingScreen';
import { BillingView } from './modules/billing/BillingView';
import { PurchasesView } from './modules/purchases/PurchasesView';
import { ReportsView } from './modules/reports/ReportsView';
import { SalesView } from './modules/sales/SalesView';
import { SettingsView, type SettingsTab } from './modules/settings/SettingsView';
import { PlannedModuleView } from './modules/shared/PlannedModuleView';
import { getSupabaseClient } from './core/supabase/client';
import { SuppliersView } from './modules/suppliers/SuppliersView';
import { PWAInstallPrompt } from './components/shared/PWAInstallPrompt';
import { LockedIndustryWorkspaceView } from './modules/industry/LockedIndustryWorkspaceView';

const VALID_MODULE_IDS = new Set<ModuleId>(MODULE_REGISTRY.map((m) => m.id));

function readModuleFromHash(): ModuleId {
  try {
    const raw = window.location.hash.replace(/^#\/?/, '').trim() as ModuleId;
    return VALID_MODULE_IDS.has(raw) ? raw : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

function ProtectedWorkspaceRouter() {
  const {
    status,
    hasLoadedOrgs,
    memberships,
    activeOrganisation,
    activeRole,
    workspaceLoadError,
    refreshMemberships,
    signOut,
  } = useAuth();

  const [activeModule, setActiveModule] = useState<ModuleId>(() => readModuleFromHash());
  const [requestedSettingsTab, setRequestedSettingsTab] = useState<SettingsTab>('auth_orgs');

  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionAccess, setSubscriptionAccess] = useState<{
    allowed: boolean;
    status: string | null;
    features: Record<string, boolean>;
    planName: string | null;
    trialEndsAt: string | null;
    periodEndsAt: string | null;
  }>({ allowed: false, status: null, features: {}, planName: null, trialEndsAt: null, periodEndsAt: null });

  useEffect(() => {
    let cancelled = false;
    const loadSubscription = async () => {
      if (!activeOrganisation) {
        setSubscriptionAccess({ allowed: false, status: null, features: {}, planName: null, trialEndsAt: null, periodEndsAt: null });
        setSubscriptionLoading(false);
        return;
      }
      const db = getSupabaseClient() as any;
      if (!db) {
        setSubscriptionAccess({ allowed: false, status: null, features: {}, planName: null, trialEndsAt: null, periodEndsAt: null });
        setSubscriptionLoading(false);
        return;
      }
      setSubscriptionLoading(true);
      const { data: sub, error: subError } = await db.from('organization_subscriptions')
        .select('status,trial_ends_at,current_period_ends_at,card_verified_at,cancel_at_period_end,plan_id')
        .eq('organization_id', activeOrganisation.id).maybeSingle();
      let plan: any = null;
      if (!subError && sub?.plan_id) {
        const { data } = await db.from('subscription_plans')
          .select('name,features').eq('id', sub.plan_id).maybeSingle();
        plan = data;
      }
      const now = Date.now();
      const trialValid = sub?.status === 'trialing' && Boolean(sub.card_verified_at) &&
        Boolean(sub.trial_ends_at) && new Date(sub.trial_ends_at).getTime() > now;
      const paidValid = sub?.status === 'active' &&
        (!sub.current_period_ends_at || new Date(sub.current_period_ends_at).getTime() > now);
      const cancellationValid = sub?.status === 'cancelled' && sub.cancel_at_period_end === true &&
        Boolean(sub.current_period_ends_at) && new Date(sub.current_period_ends_at).getTime() > now;
      if (!cancelled) {
        setSubscriptionAccess({
          allowed: !subError && Boolean(plan) && (trialValid || paidValid || cancellationValid),
          status: sub?.status ?? null,
          features: plan?.features && typeof plan.features === 'object' ? plan.features : {},
          planName: plan?.name ?? null,
          trialEndsAt: sub?.trial_ends_at ?? null,
          periodEndsAt: sub?.current_period_ends_at ?? null,
        });
        setSubscriptionLoading(false);
      }
    };
    void loadSubscription();
    const refreshOnReturn = () => { void loadSubscription(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshOnReturn();
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeOrganisation?.id]);



  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('reference') || subscriptionLoading || !activeOrganisation) {
      return;
    }
    if (activeRole === 'owner') {
      setActiveModule('billing');
      window.location.hash = '#/billing';
    } else {
      setActiveModule('dashboard');
      window.location.hash = '';
    }
  }, [activeRole, activeOrganisation?.id, subscriptionLoading]);

  useEffect(() => {
    const onHashChange = () => {
      setActiveModule(readModuleFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleSelectModule = (moduleId: ModuleId, settingsTab?: SettingsTab) => {
    if (!subscriptionAccess.allowed && moduleId !== 'dashboard' && !(moduleId === 'billing' && activeRole === 'owner')) {
      if (activeRole === 'owner') {
        setActiveModule('billing');
        window.location.hash = '#/billing';
      }
      return;
    }
    if (settingsTab) {
      setRequestedSettingsTab(settingsTab);
    }
    setActiveModule(moduleId);
    try {
      window.location.hash = moduleId === 'dashboard' ? '' : `#/${moduleId}`;
    } catch {
      // ignore hash write errors
    }
  };

  // Gate 1: Unconfigured, Signed Out, or Password Recovery -> Auth Portal
  if (status === 'signed_out') {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/login') return <AuthScreen initialMode="signin" />;
    if (path === '/signup') return <AuthScreen initialMode="signup" />;
    return <LandingPage />;
  }

  if (
    status === 'unconfigured' ||
    status === 'password_recovery' ||
    status === 'invitation_setup'
  ) {
    return <AuthScreen />;
  }

  // Gate 2: Session or Organisation Memberships Loading
  if (status === 'loading' || (status === 'authenticated' && !hasLoadedOrgs)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-5 text-center space-y-2 max-w-sm w-full">
          <div className="text-sm font-semibold text-slate-900 font-display">
            Veyora Business
          </div>
          <p className="text-xs text-slate-500">
            Verifying authenticated session and organisation memberships...
          </p>
        </div>
      </div>
    );
  }

  // Gate 3: RLS / Expired Session / Missing Schema Diagnostic Screen (never bypasses security)
  if (workspaceLoadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
        <section
          role="alert"
          className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 max-w-lg w-full space-y-5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500">
                Workspace Access Diagnostic
              </div>
              <h1 className="font-display text-lg font-semibold text-slate-900">
                {workspaceLoadError.kind === 'expired_session'
                  ? 'Authentication session expired'
                  : workspaceLoadError.kind === 'permission_denied'
                    ? 'Organisation access denied by Row Level Security'
                    : workspaceLoadError.kind === 'missing_schema'
                      ? 'Required Supabase tables not found'
                      : 'Unable to load business workspace'}
              </h1>
            </div>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            {workspaceLoadError.diagnostic}
          </p>

          <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 break-words">
            {workspaceLoadError.message}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
            {workspaceLoadError.kind !== 'expired_session' && (
              <button
                type="button"
                onClick={() => void refreshMemberships()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry Connection</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{workspaceLoadError.kind === 'expired_session' ? 'Sign In Again' : 'Sign Out'}</span>
            </button>
          </div>
        </section>
      </div>
    );
  }

  // Gate 4: Authenticated user with no organisation -> Guided Business Onboarding
  if (memberships.length === 0 || !activeOrganisation) {
    return <BusinessOnboardingScreen />;
  }

  // Subscription status is re-evaluated from the active organisation only.
  if (subscriptionLoading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4"><div className="rounded-xl border border-slate-200 bg-white p-6 text-center"><p className="text-sm font-semibold text-slate-900">Checking subscription access…</p><p className="mt-1 text-xs text-slate-500">Verifying this business workspace before loading its records.</p></div></div>;
  }

  if (!subscriptionAccess.allowed && (activeModule !== 'billing' || activeRole !== 'owner')) {
    return (
      <AppShell activeModule="dashboard" onSelectModule={handleSelectModule}>
        {activeOrganisation && ['car_dealership', 'hotel', 'restaurant', 'real_estate', 'logistics', 'manufacturing'].includes(activeOrganisation.business_type ?? '')
          ? <LockedIndustryWorkspaceView onSelectModule={handleSelectModule} />
          : <DashboardView onSelectModule={handleSelectModule} subscriptionLocked />}
      </AppShell>
    );
  }

  // Gate 5: Authenticated & Organisation Member -> Protected Workspace Routes
  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard':
        return activeOrganisation && ['car_dealership', 'hotel', 'restaurant', 'real_estate', 'logistics', 'manufacturing'].includes(activeOrganisation.business_type ?? '')
          ? <IndustryWorkspacesView />
          : <DashboardView onSelectModule={handleSelectModule} />;
      case 'inventory':
        return <InventoryView onSelectModule={handleSelectModule} />;
      case 'sales':
        return <SalesView onSelectModule={handleSelectModule} />;
      case 'customers':
        return <CustomersView />;
      case 'purchases':
        return <PurchasesView />;
      case 'suppliers':
        return <SuppliersView />;
      case 'expenses':
        return <ExpensesView />;
      case 'finance':
        return <FinanceView />;
      case 'reports':
        return <ReportsView canExport={true} />;
      case 'ai_assistant':
        return <AssistantView />;
      case 'industry':
        return <IndustryWorkspacesView />;
      case 'billing':
        return <BillingView />;
      case 'settings':
        return <SettingsView requestedTab={requestedSettingsTab} />;
      default:
        return (
          <PlannedModuleView
            moduleId={activeModule}
            onSelectModule={handleSelectModule}
          />
        );
    }
  };

  return (
    <AppShell activeModule={activeModule} onSelectModule={handleSelectModule}>
      {renderModule()}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppErrorBoundary>
        <ProtectedWorkspaceRouter />
      </AppErrorBoundary>
      <PWAInstallPrompt />
    </AuthProvider>
  );
}

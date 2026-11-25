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
import { SuppliersView } from './modules/suppliers/SuppliersView';

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
    workspaceLoadError,
    refreshMemberships,
    signOut,
  } = useAuth();

  const [activeModule, setActiveModule] = useState<ModuleId>(() => readModuleFromHash());
  const [requestedSettingsTab, setRequestedSettingsTab] = useState<SettingsTab>('auth_orgs');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('reference')) {
      setActiveModule('billing');
      window.location.hash = '#/billing';
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setActiveModule(readModuleFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleSelectModule = (moduleId: ModuleId, settingsTab?: SettingsTab) => {
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

  // Gate 5: Authenticated & Organisation Member -> Protected Workspace Routes
  const renderModule = () => {
    switch (activeModule) {
      case 'dashboard':
        return <DashboardView onSelectModule={handleSelectModule} />;
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
        return <ReportsView />;
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
    </AuthProvider>
  );
}

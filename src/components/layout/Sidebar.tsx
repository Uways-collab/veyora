import { LogOut, X } from 'lucide-react';
import {
  MODULE_GROUP_LABELS,
  MODULE_REGISTRY,
} from '../../core/modules/registry';
import type { ModuleGroup, ModuleId } from '../../core/types/domain';
import { useAuth } from '../../core/auth/AuthContext';
import { formatCurrencyDisplay } from '../../core/constants/businessOptions';
import { ModuleIcon } from '../shared/ModuleIcon';

interface SidebarProps {
  activeModule: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const GROUP_ORDER: ModuleGroup[] = [
  'overview',
  'operations',
  'financial',
  'administration',
];

export function Sidebar({
  activeModule,
  onSelectModule,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { status, activeOrganisation, activeRole, user, profile, signOut } = useAuth();

  const handleSelect = (moduleId: ModuleId) => {
    onSelectModule(moduleId);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      {/* Brand Header */}
      <div className="flex h-14 items-center justify-between px-5 border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => handleSelect('dashboard')}
          className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white shrink-0">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                d="M5 6.5L12 18.5L19 6.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 6.5L12 11L14.5 6.5"
                stroke="#60A5FA"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-slate-900 whitespace-nowrap">
            Veyora Business
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation Groups */}
      <nav aria-label="Main Navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {GROUP_ORDER.map((group) => {
          const items = MODULE_REGISTRY.filter((m) => m.group === group);
          return (
            <div key={group}>
              <div className="px-2.5 pb-1.5 text-xs font-medium text-slate-400">
                {MODULE_GROUP_LABELS[group]}
              </div>
              <ul className="space-y-0.5">
                {items.map((mod) => {
                  const isActive = activeModule === mod.id;
                  const isPlanned = mod.stage === 'planned_module';
                  return (
                    <li key={mod.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(mod.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                          isActive
                            ? 'bg-blue-50/80 text-blue-700 font-medium'
                            : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 font-normal'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <ModuleIcon
                            moduleId={mod.id}
                            className={`h-4 w-4 shrink-0 ${
                              isActive ? 'text-blue-700' : 'text-slate-400'
                            }`}
                          />
                          <span className="truncate whitespace-nowrap">{mod.label}</span>
                        </span>
                        {isPlanned && (
                          <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">
                            Planned
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Workspace / Organisation Footer */}
      <div className="border-t border-slate-200 p-4 shrink-0 space-y-3">
        {status === 'authenticated' && activeOrganisation ? (
          <>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {activeOrganisation.name}
              </div>
              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="capitalize">{activeRole ?? 'staff'}</span>
                <span aria-hidden="true">·</span>
                <span>{activeOrganisation.country}</span>
                <span aria-hidden="true">·</span>
                <span>{formatCurrencyDisplay(activeOrganisation.base_currency)}</span>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500 truncate min-w-0">
                {profile?.full_name || user?.email}
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                title="Sign out"
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:underline"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-700">
              {status === 'unconfigured' ? 'Backend Setup Pending' : 'Not Signed In'}
            </div>
            <button
              type="button"
              onClick={() => handleSelect('settings')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
            >
              {status === 'unconfigured' ? 'Configure Supabase' : 'Sign in to workspace'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen">
        {navContent}
      </aside>

      {/* Mobile / Tablet Overlay Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace navigation"
        >
          <div
            className="fixed inset-0 bg-slate-900/35 transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}

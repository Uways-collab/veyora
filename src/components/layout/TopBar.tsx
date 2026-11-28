import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  Settings,
  UserCircle2,
  Users,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';
import { formatCurrencyDisplay } from '../../core/constants/businessOptions';
import { getModuleById } from '../../core/modules/registry';
import type { ModuleId } from '../../core/types/domain';
import type { SettingsTab } from '../../modules/settings/SettingsView';

interface TopBarProps {
  activeModule: ModuleId;
  onOpenMobileMenu: () => void;
  onSelectModule: (moduleId: ModuleId, settingsTab?: SettingsTab) => void;
}

function getUserInitials(name: string | null | undefined, email: string | undefined): string {
  const source = (name ?? '').trim();
  if (source.length > 0) {
    const parts = source.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }
  return (email ?? 'VB').slice(0, 2).toUpperCase();
}

export function TopBar({
  activeModule,
  onOpenMobileMenu,
  onSelectModule,
}: TopBarProps) {
  const {
    user,
    profile,
    memberships,
    activeOrganisation,
    activeRole,
    switchOrganisation,
    refreshMemberships,
    signOut,
  } = useAuth();

  const currentModule = getModuleById(activeModule);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [workspaceUsage, setWorkspaceUsage] = useState<{ active: number; limit: number } | null>(null);

  const switcherRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (switcherRef.current && !switcherRef.current.contains(target)) {
        setSwitcherOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSwitcherOpen(false);
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadWorkspaceUsage = async () => {
      const db = getSupabaseClient() as any;
      if (!db || activeRole !== 'owner') { setWorkspaceUsage(null); return; }
      const { data, error } = await db.rpc('get_account_workspace_usage');
      if (cancelled) return;
      const usage = Array.isArray(data) ? data[0] : data;
      if (error || !usage) { setWorkspaceUsage(null); return; }
      setWorkspaceUsage({ active: Number(usage.active_workspaces) || 0, limit: Number(usage.included_workspaces) || 1 });
    };
    void loadWorkspaceUsage();
    return () => { cancelled = true; };
  }, [activeOrganisation?.id, activeRole]);

  const handleDeleteWorkspace = async () => {
    if (!activeOrganisation || activeRole !== 'owner' || deletingWorkspace) return;
    const typedName = window.prompt(`This will remove access to “${activeOrganisation.name}”. Its records will be retained for audit/recovery. Type the exact workspace name to continue:`);
    if (typedName !== activeOrganisation.name) return;
    const db = getSupabaseClient() as any;
    if (!db) { window.alert('Veyora could not connect to the workspace service. Please try again.'); return; }
    setDeletingWorkspace(true);
    const { error } = await db.rpc('delete_business_workspace', { p_organization_id: activeOrganisation.id, p_confirmation_name: typedName });
    if (error) window.alert(error.message || 'Workspace deletion failed.');
    else { await refreshMemberships(); setSwitcherOpen(false); }
    setDeletingWorkspace(false);
  };

  const displayName = profile?.full_name?.trim() || user?.email || 'Account';
  const initials = getUserInitials(profile?.full_name, user?.email);

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full min-w-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 sm:gap-3 sm:px-6 lg:px-8">
      {/* Zone 1: Mobile Menu + Veyora Business Branding + Active Page Breadcrumb */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-initial sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden -ml-1.5 p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => onSelectModule('dashboard')}
            aria-label="Veyora Business home"
            className="flex min-w-0 shrink items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <img src="https://res.cloudinary.com/mmhrp33c/image/upload/v1795765615/2a0b9d10-ea30-11f1-9c24-171f5719750a.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
            <span className="min-w-0 truncate whitespace-nowrap font-display text-sm font-semibold text-slate-900 transition-colors hover:text-blue-700 sm:text-base">Veyora Business</span>
          </button>
          <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-slate-400 sm:block" aria-hidden="true" />
          <span className="hidden max-w-32 truncate whitespace-nowrap font-medium text-slate-600 md:inline">
            {currentModule.label}
          </span>
        </nav>
      </div>

      {/* Zone 2 & 3: Active Business Switcher, Notifications, User Profile Menu */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {/* Active Business Workspace Switcher */}
        {activeOrganisation && (
          <div className="relative" ref={switcherRef}>
            <button
              type="button"
              onClick={() => {
                setSwitcherOpen((prev) => !prev);
                setNotifOpen(false);
                setProfileOpen(false);
              }}
              aria-expanded={switcherOpen}
              aria-haspopup="menu"
              aria-label="Business workspace switcher"
              className="inline-flex items-center gap-2 h-8 px-2.5 rounded-md border border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-900 hover:bg-slate-100 hover:border-slate-300 transition-colors max-w-[clamp(5.75rem,30vw,15rem)] sm:max-w-[240px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <Building2 className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              <span className="truncate whitespace-nowrap">{activeOrganisation.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            </button>

            {switcherOpen && (
              <div
                role="menu"
                aria-label="Available business workspaces"
                className="absolute right-0 mt-2 w-72 rounded-lg border border-slate-200 bg-white shadow-lg z-40 overflow-hidden"
              >
                <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    Business Workspaces
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {activeRole === 'owner' && workspaceUsage ? `${workspaceUsage.active} / ${workspaceUsage.limit} workspaces` : `${memberships.length} ${memberships.length === 1 ? 'workspace' : 'workspaces'}`}
                  </span>
                </div>

                <div className="py-1 max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {memberships.map((m) => {
                    const isSelected = m.organisation_id === activeOrganisation.id;
                    return (
                      <button
                        key={m.organisation_id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        onClick={() => {
                          if (!isSelected) {
                            switchOrganisation(m.organisation_id);
                          }
                          setSwitcherOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left flex items-start justify-between gap-3 transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {m.organisation.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            <span className="capitalize">{m.role}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{m.organisation.country}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{formatCurrencyDisplay(m.organisation.base_currency)}</span>
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2 px-4 py-2.5 bg-slate-50 border-t border-slate-200">
                  {activeRole === 'owner' && <button type="button" disabled={deletingWorkspace} onClick={() => void handleDeleteWorkspace()} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />{deletingWorkspace ? 'Deleting workspace…' : 'Delete current workspace'}</button>}
                  <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      onSelectModule('settings', 'auth_orgs');
                    }}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800"
                  >
                    Manage workspaces
                  </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notifications Menu */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => {
              setNotifOpen((prev) => !prev);
              setSwitcherOpen(false);
              setProfileOpen(false);
            }}
            aria-expanded={notifOpen}
            aria-haspopup="true"
            aria-label="Workspace notifications"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
          </button>

          {notifOpen && (
            <div
              role="region"
              aria-label="Notifications"
              className="absolute right-0 mt-2 w-72 sm:w-80 rounded-lg border border-slate-200 bg-white shadow-lg z-40 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Notifications</span>
                <span className="text-[11px] text-slate-500 font-mono">0 unread</span>
              </div>
              <div className="p-4 text-xs text-slate-600 space-y-2">
                <p className="font-medium text-slate-800">No workspace notifications yet</p>
                <p className="text-slate-500 leading-relaxed">
                  Alerts for stock thresholds, orders, and team invitations will appear here as operational modules are enabled.
                </p>
              </div>
              <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    onSelectModule('dashboard');
                  }}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800"
                >
                  View activity log
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Account Menu */}
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => {
              setProfileOpen((prev) => !prev);
              setSwitcherOpen(false);
              setNotifOpen(false);
            }}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            aria-label="User profile and account menu"
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-1.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:gap-2 sm:pl-1.5 sm:pr-2.5"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-900 text-[10px] font-semibold text-white">
              {initials}
            </span>
            <span className="hidden md:inline text-xs font-medium text-slate-800 max-w-[130px] truncate whitespace-nowrap">
              {displayName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          </button>

          {profileOpen && (
            <div
              role="menu"
              aria-label="Account options"
              className="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white shadow-lg z-40 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-200 space-y-0.5">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {displayName}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {user?.email}
                </div>
                {activeOrganisation && (
                  <div className="pt-1 text-[11px] text-slate-600 truncate">
                    {activeOrganisation.name}
                    <span aria-hidden="true"> · </span>
                    <span className="capitalize">{activeRole ?? 'staff'}</span>
                  </div>
                )}
              </div>

              <div className="py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    onSelectModule('settings', 'auth_orgs');
                  }}
                  className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5"
                >
                  <UserCircle2 className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Account &amp; Business Profile</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    onSelectModule('settings', 'members_roles');
                  }}
                  className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5"
                >
                  <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Team Members &amp; Roles</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    onSelectModule('settings', 'schema_rls');
                  }}
                  className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2.5"
                >
                  <Settings className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Workspace Settings</span>
                </button>
              </div>

              <div className="border-t border-slate-200 py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    void signOut();
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-50 flex items-center gap-2.5"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

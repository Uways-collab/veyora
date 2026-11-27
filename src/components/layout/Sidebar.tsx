import { X } from 'lucide-react';
import { MODULE_GROUP_LABELS, MODULE_REGISTRY } from '../../core/modules/registry';
import type { ModuleGroup, ModuleId } from '../../core/types/domain';
import { useAuth } from '../../core/auth/AuthContext';
import { ModuleIcon } from '../shared/ModuleIcon';

interface SidebarProps {
  activeModule: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const GROUP_ORDER: ModuleGroup[] = ['overview', 'operations', 'financial', 'administration'];

const SPECIALIST_NAV: Record<string, { modules: ModuleId[]; dashboardLabel: string; operationsLabel: string }> = {
  car_dealership: {
    modules: ['dashboard', 'dealer_stock', 'dealer_leads', 'dealer_test_drives', 'dealer_deals', 'dealer_workshop', 'dealer_reports', 'expenses', 'finance', 'ai_assistant', 'billing', 'settings'],
    dashboardLabel: 'Dealership Dashboard',
    operationsLabel: 'Dealership',
  },
  restaurant: {
    modules: ['dashboard', 'restaurant_pos', 'restaurant_operations', 'expenses', 'finance', 'reports', 'ai_assistant', 'billing', 'settings'],
    dashboardLabel: 'Restaurant Dashboard',
    operationsLabel: 'Restaurant',
  },
  hotel: {
    modules: ['dashboard', 'hotel_reservations', 'hotel_rooms', 'hotel_housekeeping', 'hotel_reports', 'expenses', 'finance', 'ai_assistant', 'billing', 'settings'],
    dashboardLabel: 'Hotel Dashboard',
    operationsLabel: 'Hotel Operations',
  },
};

export function Sidebar({ activeModule, onSelectModule, mobileOpen, onCloseMobile }: SidebarProps) {
  const { activeRole, activeOrganisation } = useAuth();
  const businessType = activeOrganisation?.business_type ?? '';
  const specialist = SPECIALIST_NAV[businessType];

  const handleSelect = (moduleId: ModuleId) => {
    onSelectModule(moduleId);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
        <button type="button" onClick={() => handleSelect('dashboard')} className="flex items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <img src="https://res.cloudinary.com/mmhrp33c/image/upload/v1795765615/2a0b9d10-ea30-11f1-9c24-171f5719750a.png" alt="Veyora logo" className="h-8 w-8 shrink-0 rounded-md object-contain" />
          <span className="whitespace-nowrap font-display text-sm font-semibold tracking-tight text-slate-900">Veyora Business</span>
        </button>
        <button type="button" onClick={onCloseMobile} aria-label="Close navigation menu" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 lg:hidden">
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Main Navigation" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {GROUP_ORDER.map((group) => {
          const items = MODULE_REGISTRY.filter((module) => {
            if (module.group !== group || (module.id === 'billing' && activeRole !== 'owner')) return false;
            return !specialist || specialist.modules.includes(module.id);
          });
          if (!items.length) return null;
          const groupLabel = group === 'overview' && specialist
            ? specialist.operationsLabel
            : MODULE_GROUP_LABELS[group];
          return (
            <div key={group}>
              <div className="px-2.5 pb-1.5 text-xs font-medium text-slate-400">{groupLabel}</div>
              <ul className="space-y-0.5">
                {items.map((module) => {
                  const isActive = activeModule === module.id;
                  const label = module.id === 'dashboard' && specialist ? specialist.dashboardLabel : module.label;
                  return (
                    <li key={module.id}>
                      <button type="button" data-tour={`module-${module.id}`} onClick={() => handleSelect(module.id)} aria-current={isActive ? 'page' : undefined}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${isActive ? 'bg-blue-50/80 font-medium text-blue-700' : 'font-normal text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'}`}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <ModuleIcon moduleId={module.id} className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                          <span className="truncate whitespace-nowrap">{label}</span>
                        </span>
                        {module.stage === 'planned_module' && <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">Planned</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Workspace navigation">
          <div className="fixed inset-0 bg-slate-900/35 transition-opacity" onClick={onCloseMobile} aria-hidden="true" />
          <div className="relative z-10 h-full w-72 max-w-[85vw]">{navContent}</div>
        </div>
      )}
    </>
  );
}

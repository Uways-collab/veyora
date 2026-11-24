import { useState, type ReactNode } from 'react';
import type { ModuleId } from '../../core/types/domain';
import type { SettingsTab } from '../../modules/settings/SettingsView';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { GuidedTour } from '../shared/GuidedTour';

interface AppShellProps {
  activeModule: ModuleId;
  onSelectModule: (moduleId: ModuleId, settingsTab?: SettingsTab) => void;
  children: ReactNode;
}

export function AppShell({
  activeModule,
  onSelectModule,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeModule={activeModule}
        onSelectModule={onSelectModule}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeModule={activeModule}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onSelectModule={onSelectModule}
        />

        <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>
        <GuidedTour onSelectModule={onSelectModule} />
      </div>
    </div>
  );
}

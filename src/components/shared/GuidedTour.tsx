import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, HelpCircle, Pause, Play, X } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import type { ModuleId } from '../../core/types/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../core/supabase/client';

type TourStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';
type TourStep = { title: string; description: string; module?: ModuleId; action: string };

const CORE_STEPS: TourStep[] = [
  { title: 'Your business at a glance', description: 'The dashboard brings together key business activity, recent events and useful shortcuts. You can keep using the workspace while this guide stays out of your way.', module: 'dashboard', action: 'Explore dashboard' },
  { title: 'Find your way around', description: 'Use the left navigation to move between the parts of Veyora your role is allowed to access. Select a section to explore it, then return here to continue.', module: 'dashboard', action: 'Continue' },
  { title: 'Manage your products and stock', description: 'Inventory is where you maintain products, variants, locations and stock movements. Use the existing receiving and stock workflows to keep quantities accurate.', module: 'inventory', action: 'Visit inventory' },
  { title: 'Record sales and customers', description: 'Sales keeps transactions organised, while Customers stores the customer directory and contact details.', module: 'sales', action: 'Visit sales' },
  { title: 'Purchases and suppliers', description: 'Create purchase records, manage suppliers and follow the goods-receiving process. Scanning an invoice does not itself increase stock.', module: 'purchases', action: 'Visit purchases' },
  { title: 'Understand your finances', description: 'Expenses and Finance help you review spending and accounting activity. Reports clearly identify which reporting areas are active and which are upcoming.', module: 'finance', action: 'Visit finance' },
  { title: 'Workspace settings and your team', description: 'Manage your organisation profile, members and roles in Settings. Access depends on your role and organisation permissions.', module: 'settings', action: 'Visit settings' },
  { title: 'Your Veyora AI assistant', description: 'When AI tools are enabled for your workspace, use them to help with supported business tasks. Always review AI-generated results before confirming business actions.', action: 'Finish tour' },
];

export function GuidedTour({ onSelectModule }: { onSelectModule: (moduleId: ModuleId) => void }) {
  const { user, activeOrganisation, activeRole } = useAuth();
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<TourStatus>('not_started');
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const supabase = getSupabaseClient() as unknown as SupabaseClient | null;

  const steps = useMemo(() => {
    const roleStep: TourStep = activeRole === 'owner'
      ? { title: 'You are the workspace Owner', description: 'You can manage workspace-level settings, members and subscription decisions. Give each teammate only the access they need.', module: 'settings', action: 'Continue' }
      : { title: 'Your access is role-based', description: 'Veyora only shows actions available to your role. Ask an organisation Owner or Admin if you need additional access.', action: 'Continue' };
    return [...CORE_STEPS.slice(0, 7), roleStep, CORE_STEPS[7]];
  }, [activeRole]);

  const persist = useCallback(async (nextStatus: TourStatus, nextStep: number) => {
    if (!user || !activeOrganisation) return;
    const payload = {
      organization_id: activeOrganisation.id,
      user_id: user.id,
      status: nextStatus,
      current_step: nextStep,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (supabase) {
      const { error } = await supabase.from('onboarding_tour_progress').upsert(payload, { onConflict: 'organization_id,user_id' });
      if (!error) return;
    }
    try {
      window.localStorage.setItem('veyora-tour-fallback:' + user.id + ':' + activeOrganisation.id, JSON.stringify(payload));
    } catch { /* storage is optional */ }
  }, [user, activeOrganisation, supabase]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user || !activeOrganisation) return;
      let saved: { status?: TourStatus; current_step?: number } | null = null;
      if (supabase) {
        const { data } = await supabase.from('onboarding_tour_progress').select('status,current_step').eq('organization_id', activeOrganisation.id).eq('user_id', user.id).maybeSingle();
        saved = data;
      }
      if (!saved) {
        try {
          const raw = window.localStorage.getItem('veyora-tour-fallback:' + user.id + ':' + activeOrganisation.id);
          if (raw) saved = JSON.parse(raw) as { status?: TourStatus; current_step?: number };
        } catch { /* storage is optional */ }
      }
      if (cancelled) return;
      const savedStatus = saved?.status ?? 'not_started';
      setStatus(savedStatus);
      setStep(Math.min(Math.max(saved?.current_step ?? 0, 0), steps.length - 1));
      setOpen(savedStatus === 'not_started');
      setReady(true);
    }
    void load();
    return () => { cancelled = true; };
  }, [user?.id, activeOrganisation?.id, supabase, steps.length]);

  useEffect(() => {
    if (!open) return;
    const current = steps[step];
    if (!current?.module) return;
    const target = document.querySelector<HTMLElement>(`[data-tour="module-${current.module}"]`);
    target?.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'relative', 'z-50');
    return () => target?.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2', 'relative', 'z-50');
  }, [open, step, steps]);

  const move = (next: number) => {
    const bounded = Math.min(Math.max(next, 0), steps.length - 1);
    setStep(bounded);
    const destination = steps[bounded]?.module;
    if (destination) onSelectModule(destination);
    setStatus('in_progress');
    void persist('in_progress', bounded);
  };
  const pause = () => {
    setOpen(false);
    setStatus('in_progress');
    void persist('in_progress', step);
  };
  const finish = (nextStatus: 'completed' | 'skipped') => {
    setStatus(nextStatus);
    setOpen(false);
    void persist(nextStatus, step);
  };
  const start = () => {
    const resume = status === 'in_progress';
    const nextStep = resume ? step : 0;
    setStep(nextStep);
    setStatus('in_progress');
    setOpen(true);
    const destination = steps[nextStep]?.module;
    if (destination) onSelectModule(destination);
    void persist('in_progress', nextStep);
  };

  if (!ready || !user || !activeOrganisation) return null;
  const current = steps[step];

  return (
    <>
      <button type="button" onClick={start} className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#10223c] px-4 py-3 text-xs font-semibold text-white shadow-xl shadow-slate-950/20 hover:bg-[#1b3557] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Open Help and Guided Tour">
        <HelpCircle className="h-4 w-4" /> Help &amp; Tour
      </button>
      {open && (
        <section role="region" aria-labelledby="veyora-tour-title" className="fixed bottom-20 right-3 z-[80] w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-24 sm:right-5">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><BookOpen className="h-4 w-4 text-blue-700" /> Veyora guided tour</div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={pause} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Pause tour"><Pause className="h-4 w-4" /></button>
              <button type="button" onClick={() => finish('skipped')} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Skip entire tour"><X className="h-4 w-4" /></button>
            </div>
          </header>
          <div className="space-y-4 px-4 py-5">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500"><span>Step {step + 1} of {steps.length}</span><span>{Math.round(((step + 1) / steps.length) * 100)}% complete</span></div>
            <div className="flex gap-1" aria-hidden="true">{steps.map((_, index) => <span key={index} className={'h-1.5 flex-1 rounded-full ' + (index <= step ? 'bg-blue-700' : 'bg-slate-100')} />)}</div>
            <div className="space-y-2">
              <h2 id="veyora-tour-title" className="font-display text-xl font-bold tracking-tight text-[#10223c]">{current.title}</h2>
              <p className="text-sm leading-6 text-slate-600">{current.description}</p>
            </div>
            {current.module && <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-900">The <strong className="capitalize">{current.module}</strong> navigation item is highlighted. You can explore the page while this guide stays open.</div>}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <button type="button" onClick={() => finish('skipped')} className="text-xs font-semibold text-slate-500 hover:text-slate-900">Skip tour</button>
            <div className="flex items-center gap-2">
              {step > 0 && <button type="button" onClick={() => move(step - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>}
              {step < steps.length - 1
                ? <button type="button" onClick={() => move(step + 1)} className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800">Next <ArrowRight className="h-3.5 w-3.5" /></button>
                : <button type="button" onClick={() => finish('completed')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><Check className="h-3.5 w-3.5" /> Finish tour</button>}
            </div>
          </footer>
        </section>
      )}
      {!open && status === 'in_progress' && (
        <button type="button" onClick={start} className="fixed bottom-20 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg hover:bg-slate-50"><Play className="h-3.5 w-3.5" /> Resume tour · Step {step + 1}</button>
      )}
      <span className="sr-only" aria-live="polite">{status === 'completed' ? 'Guided tour completed' : status === 'skipped' ? 'Guided tour skipped' : status === 'in_progress' && !open ? 'Guided tour paused' : ''}</span>
    </>
  );
}

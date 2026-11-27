import { LockKeyhole, ArrowRight, Building2, CarFront, Factory, Hotel, MapPin, Utensils, ClipboardList } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import type { ModuleId } from '../../core/types/domain';

type IndustryKey = 'car_dealership' | 'hotel' | 'restaurant' | 'real_estate' | 'logistics' | 'manufacturing';

const WORKSPACES: Record<IndustryKey, {
  label: string;
  description: string;
  icon: typeof Building2;
  areas: { title: string; description: string }[];
}> = {
  car_dealership: {
    label: 'Dealership workspace',
    description: 'A purpose-built home for vehicle stock, leads, deals and after-sales service.',
    icon: CarFront,
    areas: [
      { title: 'Vehicle inventory', description: 'Stock cards, VIN and mileage records, pricing and availability' },
      { title: 'Leads & test drives', description: 'Prospect pipeline, appointments and follow-up activities' },
      { title: 'Deals & delivery', description: 'Reservations, sales handover and delivery milestones' },
      { title: 'Workshop & service', description: 'Service jobs, maintenance schedules and workshop status' },
    ],
  },
  hotel: {
    label: 'Hotel & hospitality workspace',
    description: 'A front-desk home for reservations, rooms, guests and housekeeping.',
    icon: Hotel,
    areas: [
      { title: 'Front desk & reservations', description: 'Guest bookings, check-in and check-out workflows' },
      { title: 'Rooms & availability', description: 'Room types, occupancy planning and room readiness' },
      { title: 'Housekeeping', description: 'Cleaning assignments, room turnover and maintenance flags' },
      { title: 'Guest operations', description: 'Guest profiles, service requests and stay coordination' },
    ],
  },
  restaurant: {
    label: 'Restaurant & café workspace',
    description: 'A service-focused home for orders, kitchen flow, menus and table operations.',
    icon: Utensils,
    areas: [
      { title: 'Orders & service', description: 'Dine-in, takeaway and delivery order workflows' },
      { title: 'Kitchen workflow', description: 'Preparation queues, kitchen status and service handoff' },
      { title: 'Menu & recipes', description: 'Menu items, recipe references and availability planning' },
      { title: 'Tables & payments', description: 'Table service, bills and payment coordination' },
    ],
  },
  real_estate: {
    label: 'Real estate workspace',
    description: 'A property operations home for units, tenants, leases and maintenance.',
    icon: Building2,
    areas: [
      { title: 'Properties & units', description: 'Property portfolio, unit details and occupancy status' },
      { title: 'Tenants & leases', description: 'Tenant register, lease terms and renewal milestones' },
      { title: 'Rent follow-ups', description: 'Rent schedules, due dates and payment follow-up workflow' },
      { title: 'Maintenance', description: 'Property issues, work requests and resolution tracking' },
    ],
  },
  logistics: {
    label: 'Logistics & fleet workspace',
    description: 'A dispatch home for delivery jobs, vehicles, drivers and proof of delivery.',
    icon: MapPin,
    areas: [
      { title: 'Dispatch & delivery', description: 'Delivery jobs, routes and dispatch status' },
      { title: 'Fleet operations', description: 'Vehicle availability, maintenance and fleet readiness' },
      { title: 'Drivers & assignments', description: 'Driver records, job allocation and shift planning' },
      { title: 'Proof of delivery', description: 'Delivery confirmation, exceptions and recipient handoff' },
    ],
  },
  manufacturing: {
    label: 'Manufacturing workspace',
    description: 'A production home for work orders, materials, quality and output planning.',
    icon: Factory,
    areas: [
      { title: 'Production orders', description: 'Work orders, batch planning and due dates' },
      { title: 'Materials & output', description: 'Material requirements, consumption and finished output' },
      { title: 'Quality checks', description: 'Inspection stages, approvals and non-conformance tracking' },
      { title: 'Production status', description: 'Work-centre progress, completion and capacity visibility' },
    ],
  },
};

const FALLBACK: IndustryKey = 'car_dealership';

export function LockedIndustryWorkspaceView({ onSelectModule }: { onSelectModule: (moduleId: ModuleId) => void }) {
  const { activeOrganisation, activeRole } = useAuth();
  if (!activeOrganisation) return null;
  const key = (Object.prototype.hasOwnProperty.call(WORKSPACES, activeOrganisation.business_type ?? '')
    ? activeOrganisation.business_type
    : FALLBACK) as IndustryKey;
  const workspace = WORKSPACES[key];
  const Icon = workspace.icon;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="bg-slate-950 px-5 py-6 text-white sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10"><Icon className="h-6 w-6" /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Veyora business workspace</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{activeOrganisation.name}</h1>
                <p className="mt-1 text-sm text-slate-300">{workspace.label}</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
              <LockKeyhole className="h-3.5 w-3.5" /> Subscription required
            </span>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-7">
          <div className="sm:col-span-2">
            <h2 className="text-lg font-semibold text-slate-900">{workspace.label} is ready</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{workspace.description} This is a safe workspace preview. Operational records and controls remain unavailable until subscription access is active.</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><LockKeyhole className="h-4 w-4" /> Workspace locked</div>
            <p className="mt-2 text-xs leading-5 text-amber-800">No customer, transaction, inventory or operational data is loaded in this preview.</p>
            {activeRole === 'owner'
              ? <button type="button" onClick={() => onSelectModule('billing')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800">Open billing <ArrowRight className="h-3.5 w-3.5" /></button>
              : <p className="mt-3 text-xs font-medium text-amber-900">Ask your workspace owner to restore subscription access.</p>}
          </div>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900">Your business workspace</h2>
          <span className="text-xs text-slate-500">· Preview only</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workspace.areas.map((area, index) => (
            <article key={area.title} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">0{index + 1}</span>
                <LockKeyhole className="h-4 w-4 text-amber-600" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">{area.title}</h3>
              <p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{area.description}</p>
              <div className="mt-4 border-t border-slate-100 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Unlock with subscription</div>
            </article>
          ))}
        </div>
      </section>
      <footer className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
        Your workspace structure is prepared for {activeOrganisation.name}. Billing and account access remain available; operational queries and actions are intentionally disabled while this workspace is unpaid.
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertCircle, ArrowRight, Building2, CalendarDays, CarFront, CheckCircle2, ClipboardList, Factory, Hotel, Loader2, MapPin, Plus, RefreshCw, Utensils, X } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { HotelWorkspaceView } from './HotelWorkspaceView';
import { DealershipWorkspaceView } from './DealershipWorkspaceView';
import { RealEstateWorkspaceView, RestaurantWorkspaceView, LogisticsWorkspaceView, ManufacturingWorkspaceView } from './SpecialistIndustryDashboards';
import { getSupabaseClient } from '../../core/supabase/client';
import type { BusinessCategory } from '../../core/types/domain';

type FieldType = 'text' | 'email' | 'tel' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select';
type Field = { key: string; label: string; type?: FieldType; required?: boolean; min?: number; step?: string; options?: { value: string; label: string }[] };
type IndustryConfig = {
  category: BusinessCategory;
  label: string;
  description: string;
  table: string;
  singular: string;
  icon: typeof Hotel;
  fields: Field[];
  columns: { key: string; label: string; kind?: 'date' | 'money' | 'status' }[];
  statusField: string;
  statuses: { value: string; label: string }[];
  defaultStatus: string;
};

const STATUS = (values: string[]) => values.map((value) => ({ value, label: value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }));

const INDUSTRIES: IndustryConfig[] = [
  {
    category: 'hotel', label: 'Hotels & Hospitality', singular: 'Reservation', table: 'hotel_reservations', icon: Hotel,
    description: 'Track guest bookings, room allocation, check-in and check-out.',
    fields: [
      { key: 'confirmation_code', label: 'Confirmation code', required: true },
      { key: 'room_label', label: 'Room / unit', required: true },
      { key: 'guest_name', label: 'Guest name', required: true },
      { key: 'guest_email', label: 'Guest email', type: 'email' },
      { key: 'guest_phone', label: 'Guest phone', type: 'tel' },
      { key: 'check_in', label: 'Check-in date', type: 'date', required: true },
      { key: 'check_out', label: 'Check-out date', type: 'date', required: true },
      { key: 'adults', label: 'Adults', type: 'number', min: 1, step: '1' },
      { key: 'children', label: 'Children', type: 'number', min: 0, step: '1' },
      { key: 'total_amount', label: 'Booking total', type: 'number', min: 0, step: '0.01' },
      { key: 'status', label: 'Reservation status', type: 'select', options: STATUS(['booked','checked_in','checked_out','cancelled','no_show']) },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [{ key: 'confirmation_code', label: 'Confirmation' }, { key: 'guest_name', label: 'Guest' }, { key: 'room_label', label: 'Room' }, { key: 'check_in', label: 'Check-in', kind: 'date' }, { key: 'check_out', label: 'Check-out', kind: 'date' }, { key: 'total_amount', label: 'Total', kind: 'money' }, { key: 'status', label: 'Status', kind: 'status' }],
    statusField: 'status', statuses: STATUS(['booked','checked_in','checked_out','cancelled','no_show']), defaultStatus: 'booked',
  },
  {
    category: 'car_dealership', label: 'Car Dealerships', singular: 'Vehicle', table: 'dealer_vehicles', icon: CarFront,
    description: 'Maintain vehicle stock, VINs, mileage, pricing and sales readiness.',
    fields: [
      { key: 'stock_number', label: 'Stock number', required: true }, { key: 'vin', label: 'VIN' },
      { key: 'make', label: 'Make', required: true }, { key: 'model', label: 'Model', required: true },
      { key: 'model_year', label: 'Model year', type: 'number', min: 1900, step: '1', required: true },
      { key: 'mileage', label: 'Mileage', type: 'number', min: 0, step: '1' },
      { key: 'purchase_price', label: 'Purchase price', type: 'number', min: 0, step: '0.01' },
      { key: 'asking_price', label: 'Asking price', type: 'number', min: 0, step: '0.01' },
      { key: 'status', label: 'Stock status', type: 'select', options: STATUS(['in_stock','reserved','sold','in_service']) },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [{ key: 'stock_number', label: 'Stock #' }, { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'model_year', label: 'Year' }, { key: 'mileage', label: 'Mileage' }, { key: 'asking_price', label: 'Asking price', kind: 'money' }, { key: 'status', label: 'Status', kind: 'status' }],
    statusField: 'status', statuses: STATUS(['in_stock','reserved','sold','in_service']), defaultStatus: 'in_stock',
  },
  {
    category: 'real_estate', label: 'Real Estate', singular: 'Lease', table: 'real_estate_leases', icon: Building2,
    description: 'Track rental properties, units, tenants, lease periods and recurring rent terms.',
    fields: [
      { key: 'property_name', label: 'Property name', required: true }, { key: 'unit_reference', label: 'Unit reference', required: true },
      { key: 'tenant_name', label: 'Tenant name', required: true }, { key: 'tenant_email', label: 'Tenant email', type: 'email' }, { key: 'tenant_phone', label: 'Tenant phone', type: 'tel' },
      { key: 'lease_start', label: 'Lease start', type: 'date', required: true }, { key: 'lease_end', label: 'Lease end', type: 'date', required: true },
      { key: 'monthly_rent', label: 'Monthly rent', type: 'number', min: 0, step: '0.01', required: true },
      { key: 'security_deposit', label: 'Security deposit', type: 'number', min: 0, step: '0.01' },
      { key: 'rent_due_day', label: 'Rent due day (1–28)', type: 'number', min: 1, step: '1' },
      { key: 'status', label: 'Lease status', type: 'select', options: STATUS(['draft','active','ended','terminated']) },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    columns: [{ key: 'property_name', label: 'Property' }, { key: 'unit_reference', label: 'Unit' }, { key: 'tenant_name', label: 'Tenant' }, { key: 'lease_start', label: 'Start', kind: 'date' }, { key: 'lease_end', label: 'End', kind: 'date' }, { key: 'monthly_rent', label: 'Monthly rent', kind: 'money' }, { key: 'status', label: 'Status', kind: 'status' }],
    statusField: 'status', statuses: STATUS(['draft','active','ended','terminated']), defaultStatus: 'draft',
  },
  {
    category: 'restaurant', label: 'Restaurants & Cafés', singular: 'Order', table: 'restaurant_orders', icon: Utensils,
    description: 'Capture dine-in, takeaway and delivery orders and move them through kitchen service.',
    fields: [
      { key: 'order_number', label: 'Order number', required: true },
      { key: 'order_type', label: 'Order type', type: 'select', options: [{ value: 'dine_in', label: 'Dine in' }, { value: 'takeaway', label: 'Takeaway' }, { value: 'delivery', label: 'Delivery' }] },
      { key: 'table_label', label: 'Table / pickup reference' }, { key: 'customer_name', label: 'Customer name' },
      { key: 'items_summary', label: 'Order items summary', type: 'textarea', required: true },
      { key: 'total_amount', label: 'Order total', type: 'number', min: 0, step: '0.01' },
      { key: 'status', label: 'Kitchen status', type: 'select', options: STATUS(['new','accepted','preparing','ready','served','completed','cancelled']) },
      { key: 'notes', label: 'Notes / allergies', type: 'textarea' },
    ],
    columns: [{ key: 'order_number', label: 'Order #' }, { key: 'order_type', label: 'Type' }, { key: 'table_label', label: 'Table' }, { key: 'items_summary', label: 'Items' }, { key: 'total_amount', label: 'Total', kind: 'money' }, { key: 'status', label: 'Kitchen status', kind: 'status' }],
    statusField: 'status', statuses: STATUS(['new','accepted','preparing','ready','served','completed','cancelled']), defaultStatus: 'new',
  },
  {
    category: 'logistics', label: 'Logistics & Fleet', singular: 'Delivery job', table: 'delivery_jobs', icon: MapPin,
    description: 'Manage dispatch jobs, recipient details, delivery progress and proof of delivery.',
    fields: [
      { key: 'tracking_number', label: 'Tracking number', required: true }, { key: 'recipient_name', label: 'Recipient name', required: true },
      { key: 'recipient_phone', label: 'Recipient phone', type: 'tel' }, { key: 'origin', label: 'Pickup location', required: true },
      { key: 'destination', label: 'Delivery destination', required: true }, { key: 'scheduled_at', label: 'Scheduled dispatch', type: 'datetime-local' },
      { key: 'status', label: 'Delivery status', type: 'select', options: STATUS(['pending','assigned','in_transit','delivered','failed','returned']) },
      { key: 'proof_of_delivery_url', label: 'Proof of delivery URL (HTTPS)' }, { key: 'notes', label: 'Delivery notes', type: 'textarea' },
    ],
    columns: [{ key: 'tracking_number', label: 'Tracking #' }, { key: 'recipient_name', label: 'Recipient' }, { key: 'origin', label: 'From' }, { key: 'destination', label: 'To' }, { key: 'scheduled_at', label: 'Scheduled', kind: 'date' }, { key: 'status', label: 'Status', kind: 'status' }],
    statusField: 'status', statuses: STATUS(['pending','assigned','in_transit','delivered','failed','returned']), defaultStatus: 'pending',
  },
  {
    category: 'manufacturing', label: 'Manufacturing', singular: 'Production order', table: 'manufacturing_orders', icon: Factory,
    description: 'Plan production batches, quantities, due dates and progress through quality checks.',
    fields: [
      { key: 'order_number', label: 'Production order #', required: true }, { key: 'product_name', label: 'Finished product', required: true },
      { key: 'planned_quantity', label: 'Planned quantity', type: 'number', min: 0.001, step: '0.001', required: true },
      { key: 'completed_quantity', label: 'Completed quantity', type: 'number', min: 0, step: '0.001' },
      { key: 'planned_start', label: 'Planned start', type: 'date' }, { key: 'due_date', label: 'Due date', type: 'date' },
      { key: 'status', label: 'Production status', type: 'select', options: STATUS(['planned','released','in_progress','quality_check','completed','cancelled']) },
      { key: 'notes', label: 'Production notes', type: 'textarea' },
    ],
    columns: [{ key: 'order_number', label: 'Order #' }, { key: 'product_name', label: 'Product' }, { key: 'planned_quantity', label: 'Planned' }, { key: 'completed_quantity', label: 'Completed' }, { key: 'planned_start', label: 'Start', kind: 'date' }, { key: 'due_date', label: 'Due', kind: 'date' }, { key: 'status', label: 'Status', kind: 'status' }],
    statusField: 'status', statuses: STATUS(['planned','released','in_progress','quality_check','completed','cancelled']), defaultStatus: 'planned',
  },
];

const STATUS_TRANSITIONS: Partial<Record<BusinessCategory, Record<string, string[]>>> = {
  hotel: { booked: ['checked_in','cancelled','no_show'], checked_in: ['checked_out'] },
  car_dealership: { in_stock: ['reserved','sold','in_service'], reserved: ['in_stock','sold'], in_service: ['in_stock'] },
  real_estate: { draft: ['active','terminated'], active: ['ended','terminated'] },
  restaurant: { new: ['accepted','cancelled'], accepted: ['preparing','cancelled'], preparing: ['ready','cancelled'], ready: ['served','cancelled'], served: ['completed'] },
  logistics: { pending: ['assigned','failed'], assigned: ['in_transit','failed'], in_transit: ['delivered','failed','returned'], failed: ['pending'] },
  manufacturing: { planned: ['released','cancelled'], released: ['in_progress','cancelled'], in_progress: ['quality_check','cancelled'], quality_check: ['completed','in_progress'] },
};

const ALL_CATEGORIES = INDUSTRIES.map((industry) => industry.category);

function formatDate(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

export function IndustryWorkspacesView() {
  const { activeOrganisation, activeRole } = useAuth();
  const supabase = getSupabaseClient();
  const industrySupabase = supabase as unknown as SupabaseClient<any> | null;
  const [selectedCategories, setSelectedCategories] = useState<BusinessCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<BusinessCategory | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManageCategories = activeRole === 'owner' || activeRole === 'admin';
  const canUpdateRecords = canManageCategories || activeRole === 'manager';
  const industry = useMemo(() => INDUSTRIES.find((item) => item.category === activeCategory) ?? null, [activeCategory]);

  const loadCategories = useCallback(async () => {
    if (!industrySupabase || !activeOrganisation) return;
    const { data, error: queryError } = await industrySupabase.from('organization_business_types')
      .select('business_type,is_primary').eq('organization_id', activeOrganisation.id);
    if (queryError) {
      setError('Unable to load your selected business categories: ' + queryError.message);
      setSelectedCategories([]);
      return;
    }
    const primary = data?.find((item) => item.is_primary)?.business_type as BusinessCategory | undefined;
    const assigned = primary && ALL_CATEGORIES.includes(primary) ? primary : null;
    setSelectedCategories(assigned ? [assigned] : []);
    setActiveCategory(assigned);
  }, [industrySupabase, activeOrganisation?.id]);

  const loadRecords = useCallback(async () => {
    if (!industrySupabase || !activeOrganisation || !industry) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await industrySupabase.from(industry.table).select('*')
      .eq('organization_id', activeOrganisation.id).order('created_at', { ascending: false }).limit(200);
    if (queryError) {
      setError('Unable to load ' + industry.label.toLowerCase() + ': ' + queryError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Record<string, unknown>[]);
    }
    setLoading(false);
  }, [industrySupabase, activeOrganisation?.id, industry]);

  useEffect(() => { void loadCategories(); }, [loadCategories]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  const startCreate = () => {
    if (!industry) return;
    const defaults: Record<string, string> = {};
    for (const field of industry.fields) {
      if (field.key === 'status') defaults[field.key] = industry.defaultStatus;
      else if (field.key === 'adults') defaults[field.key] = '1';
      else if (field.key === 'children' || field.key === 'mileage' || field.key === 'purchase_price' || field.key === 'asking_price' || field.key === 'total_amount' || field.key === 'security_deposit' || field.key === 'completed_quantity' || field.key === 'rent_due_day') defaults[field.key] = '0';
      else if (field.key === 'order_type') defaults[field.key] = 'dine_in';
      else defaults[field.key] = '';
    }
    setFormValues(defaults); setFormOpen(true); setError(null); setNotice(null);
  };

  const createRecord = async (event: FormEvent) => {
    event.preventDefault();
    if (!industrySupabase || !activeOrganisation || !industry) return;
    setSaving(true); setError(null); setNotice(null);
    const payload: Record<string, unknown> = { organization_id: activeOrganisation.id };
    for (const field of industry.fields) {
      const raw = formValues[field.key] ?? '';
      if (field.type === 'number') payload[field.key] = raw === '' ? 0 : Number(raw);
      else if (field.type === 'datetime-local') payload[field.key] = raw ? new Date(raw).toISOString() : null;
      else payload[field.key] = raw.trim() === '' ? null : raw.trim();
    }
    const { error: insertError } = await industrySupabase.from(industry.table).insert(payload);
    if (insertError) {
      setError(insertError.code === '23505' ? 'That reference number is already in use in this workspace.' : insertError.message);
    } else {
      setNotice(industry.singular + ' created successfully.');
      setFormOpen(false);
      await loadRecords();
    }
    setSaving(false);
  };

  const updateStatus = async (id: string, value: string) => {
    if (!industrySupabase || !activeOrganisation || !industry || !canUpdateRecords) return;
    setError(null); setNotice(null);
    const { error: updateError } = await industrySupabase.from(industry.table).update({ [industry.statusField]: value })
      .eq('id', id).eq('organization_id', activeOrganisation.id);
    if (updateError) setError('Status was not changed: ' + updateError.message);
    else { setNotice('Workflow status updated.'); await loadRecords(); }
  };

  const currency = activeOrganisation?.base_currency ?? 'NGN';
  const money = (value: unknown) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '—';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
    catch { return amount.toFixed(2) + ' ' + currency; }
  };

  const overviewMetrics = useMemo(() => {
    if (!industry) return [];
    const count = (statuses: string[]) => rows.filter((row) => statuses.includes(String(row[industry.statusField] ?? ''))).length;
    const sum = (field: string) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const inNext30Days = (field: string) => rows.filter((row) => {
      const date = new Date(String(row[field] ?? ''));
      const days = (date.getTime() - Date.now()) / 86400000;
      return Number.isFinite(date.getTime()) && days >= 0 && days <= 30;
    }).length;
    switch (industry.category) {
      case 'hotel':
        return [
          { label: 'Reservations in view', value: String(rows.length), helper: 'Guest bookings recorded' },
          { label: 'Currently checked in', value: String(count(['checked_in'])), helper: 'Guests staying now' },
          { label: 'Arrivals today', value: String(rows.filter((row) => String(row.check_in ?? '').slice(0, 10) === today).length), helper: 'Scheduled check-ins' },
          { label: 'Booking value', value: money(sum('total_amount')), helper: 'Value across loaded bookings' },
        ];
      case 'car_dealership':
        return [
          { label: 'Vehicles in stock', value: String(count(['in_stock'])), helper: 'Available for sale' },
          { label: 'Reserved vehicles', value: String(count(['reserved'])), helper: 'Deals being held' },
          { label: 'Vehicles sold', value: String(count(['sold'])), helper: 'Marked as sold' },
          { label: 'Listed value', value: money(sum('asking_price')), helper: 'Asking prices in loaded stock' },
        ];
      case 'real_estate':
        return [
          { label: 'Active leases', value: String(count(['active'])), helper: 'Current tenant agreements' },
          { label: 'Monthly rent', value: money(rows.filter((row) => row.status === 'active').reduce((total, row) => total + (Number(row.monthly_rent) || 0), 0)), helper: 'Across active leases' },
          { label: 'Leases ending soon', value: String(inNext30Days('lease_end')), helper: 'Within the next 30 days' },
          { label: 'Lease records', value: String(rows.length), helper: 'Latest records in this workspace' },
        ];
      case 'restaurant':
        return [
          { label: 'Open kitchen orders', value: String(count(['new', 'accepted', 'preparing'])), helper: 'Awaiting completion' },
          { label: 'Ready to serve', value: String(count(['ready'])), helper: 'Ready for collection or service' },
          { label: 'Completed orders', value: String(count(['completed', 'served'])), helper: 'Finished service' },
          { label: 'Order value', value: money(sum('total_amount')), helper: 'Value across loaded orders' },
        ];
      case 'logistics':
        return [
          { label: 'In transit', value: String(count(['in_transit'])), helper: 'Currently on the road' },
          { label: 'Awaiting dispatch', value: String(count(['pending', 'assigned'])), helper: 'Jobs not yet delivered' },
          { label: 'Delivered', value: String(count(['delivered'])), helper: 'Completed deliveries' },
          { label: 'Needs attention', value: String(count(['failed', 'returned'])), helper: 'Failed or returned jobs' },
        ];
      case 'manufacturing':
        return [
          { label: 'In production', value: String(count(['released', 'in_progress'])), helper: 'Orders on the production floor' },
          { label: 'Quality checks', value: String(count(['quality_check'])), helper: 'Awaiting quality approval' },
          { label: 'Completed units', value: sum('completed_quantity').toLocaleString(), helper: 'Across loaded production orders' },
          { label: 'Planned units', value: sum('planned_quantity').toLocaleString(), helper: 'Across loaded production orders' },
        ];
      default:
        return [];
    }
  }, [industry, rows]);

  if (!activeOrganisation) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-700"><ClipboardList className="h-4 w-4" /> Specialist operations</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Industry Workspaces</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Run specialist workflows alongside Veyora's shared inventory, sales, purchasing and finance tools. Your records remain scoped to {activeOrganisation.name}.</p>
        </div>
        <button type="button" onClick={() => void loadCategories()} disabled={loading || saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </header>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      {industry && selectedCategories.includes(industry.category) && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Business workspace</div>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">{industry.label}</h2>
          <p className="mt-1 text-xs text-slate-500">This workspace is configured for one business type. To run another business, create a separate business workspace; unrelated industry tools are not added here.</p>
        </section>
      )}

      {industry && selectedCategories.includes(industry.category) ? (
        <>
        <section className="hidden space-y-3">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">{industry.label} overview</h2><p className="text-xs text-slate-500">A live operational snapshot from the latest records loaded for this workspace.</p></div><span className="text-[10px] font-medium text-slate-400">Up to 200 recent records</span></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overviewMetrics.map((metric, index) => <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.02]"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-slate-500">{metric.label}</p><span className={'h-2 w-2 rounded-full ' + (index === 0 ? 'bg-blue-500' : index === 1 ? 'bg-emerald-500' : index === 2 ? 'bg-violet-500' : 'bg-amber-500')} /></div><p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{metric.value}</p><p className="mt-1 text-[11px] text-slate-500">{metric.helper}</p></div>)}
          </div>
        </section>
        {industry.category === 'hotel' ? <HotelWorkspaceView /> : industry.category === 'car_dealership' ? <DealershipWorkspaceView /> : industry.category === 'real_estate' ? <RealEstateWorkspaceView /> : industry.category === 'restaurant' ? <RestaurantWorkspaceView /> : industry.category === 'logistics' ? <LogisticsWorkspaceView /> : industry.category === 'manufacturing' ? <ManufacturingWorkspaceView /> : <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-base font-semibold text-slate-900">{industry.label}</h2><p className="mt-1 text-xs text-slate-500">{industry.description}</p></div>
            <button type="button" onClick={startCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-800"><Plus className="h-4 w-4" /> New {industry.singular}</button>
          </div>
          {formOpen && (
            <form onSubmit={(event) => void createRecord(event)} className="space-y-4 border-b border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-900">Create {industry.singular.toLowerCase()}</h3><button type="button" onClick={() => setFormOpen(false)} aria-label="Close form" className="rounded-md p-1 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {industry.fields.map((field) => (
                  <label key={field.key} className={'space-y-1 ' + (field.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : '')}>
                    <span className="block text-xs font-medium text-slate-700">{field.label}{field.required && <span className="text-rose-600"> *</span>}</span>
                    {field.type === 'textarea' ? <textarea required={field.required} rows={3} value={formValues[field.key] ?? ''} onChange={(event) => setFormValues((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />
                      : field.type === 'select' ? <select required={field.required} value={formValues[field.key] ?? ''} onChange={(event) => setFormValues((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                      : <input required={field.required} type={field.type ?? 'text'} min={field.min} step={field.step} value={formValues[field.key] ?? ''} onChange={(event) => setFormValues((current) => ({ ...current, [field.key]: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500" />}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save {industry.singular}</button></div>
            </form>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-2 text-xs text-slate-600"><CalendarDays className="h-4 w-4 text-slate-400" /> Latest 200 records</div><span className="text-xs font-semibold text-slate-700">{rows.length} {industry.singular.toLowerCase()}{rows.length === 1 ? '' : 's'}</span></div>
          {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…</div>
            : rows.length === 0 ? <div className="p-12 text-center"><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><ClipboardList className="h-5 w-5" /></span><h3 className="mt-3 text-sm font-semibold text-slate-900">No {industry.singular.toLowerCase()} records yet</h3><p className="mt-1 text-xs text-slate-500">Create your first record to start using this workflow.</p></div>
            : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[11px] font-semibold text-slate-500"><tr>{industry.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3">{column.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={String(row.id)} className="hover:bg-slate-50/70">{industry.columns.map((column) => <td key={column.key} className="max-w-[240px] whitespace-nowrap px-4 py-3 text-slate-700">{column.kind === 'money' ? money(row[column.key]) : column.kind === 'date' ? formatDate(row[column.key]) : column.kind === 'status' ? <select aria-label={'Update status for ' + industry.singular} disabled={!canUpdateRecords} value={String(row[column.key] ?? '')} onChange={(event) => void updateStatus(String(row.id), event.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100">{industry.statuses.map((status) => <option key={status.value} value={status.value} disabled={status.value !== String(row[column.key] ?? '') && !(STATUS_TRANSITIONS[industry.category]?.[String(row[column.key] ?? '')] ?? []).includes(status.value)}>{status.label}</option>)}</select> : <span className="block truncate" title={String(row[column.key] ?? '')}>{String(row[column.key] ?? '—')}</span>}</td>)}</tr>)}</tbody></table></div>}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] leading-5 text-slate-500">This initial workflow manages specialist records and statuses only. Connected financial, inventory and external actions are enabled only when their controls are implemented.</div>
        </section>}
        </>
      ) : (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-sm font-semibold text-slate-900">Choose a selected business category</h2><p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-slate-500">Add or select one of the categories above to open its specialist operational workspace. Your existing core modules remain available separately.</p></section>
      )}
    </div>
  );
}

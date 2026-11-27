import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, BarChart3, CalendarClock, CarFront, CheckCircle2, ClipboardList, Gauge, Loader2, Plus, RefreshCw, Users, Wrench } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

type Tab = 'dashboard' | 'stock' | 'leads' | 'test_drives' | 'deals' | 'workshop' | 'reports';
type Vehicle = { id: string; stock_number: string; vin: string | null; make: string; model: string; model_year: number; mileage: number; purchase_price: number; asking_price: number; status: string; condition: string; body_type: string | null; fuel_type: string | null; transmission: string | null; exterior_color: string | null; location_label: string | null; warranty_until: string | null; notes: string | null };
type Lead = { id: string; full_name: string; phone: string | null; email: string | null; source: string; interest_make: string | null; interest_model: string | null; budget: number; status: string; next_follow_up_at: string | null; assigned_to: string | null; notes: string | null };
type Drive = { id: string; vehicle_id: string; customer_name: string; customer_phone: string | null; scheduled_at: string; duration_minutes: number; status: string; staff_name: string | null; licence_verified: boolean; notes: string | null };
type Deal = { id: string; vehicle_id: string; deal_number: string; customer_name: string; customer_phone: string | null; agreed_price: number; deposit_amount: number; trade_in_description: string | null; trade_in_allowance: number; status: string; expected_delivery_date: string | null; sales_person: string | null; notes: string | null };
type Job = { id: string; vehicle_id: string; job_number: string; customer_name: string | null; job_type: string; description: string; odometer: number; estimated_cost: number; actual_cost: number; status: string; assigned_to: string | null; due_at: string | null; notes: string | null };
type DealerPayment = { id: string; deal_id: string; amount: number; reference: string; paid_at: string; financial_account_id: string; journal_entry_id: string | null };
type FinanceAccount = { id: string; account_name: string; account_type: string; currency_code: string };

const tabs: { id: Tab; label: string; icon: typeof CarFront }[] = [
  { id: 'stock', label: 'Vehicle stock', icon: CarFront }, { id: 'leads', label: 'Customers & leads', icon: Users },
  { id: 'test_drives', label: 'Test drives', icon: CalendarClock }, { id: 'deals', label: 'Sales pipeline', icon: ClipboardList },
  { id: 'workshop', label: 'Workshop', icon: Wrench }, { id: 'reports', label: 'Reports', icon: BarChart3 },
];
const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500';
const labelClass = 'space-y-1 text-xs font-medium text-slate-700';
const money = (n: number, currency: string) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n) || 0); } catch { return (Number(n) || 0).toLocaleString() + ' ' + currency; } };
const pretty = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const localDateTime = (v: string | null) => v ? new Date(v).toLocaleString() : '—';

export function DealershipWorkspaceView({ activeModule = 'dashboard' }: { activeModule?: string }) {
  const { activeOrganisation, activeRole } = useAuth();
  const supabase = getSupabaseClient() as unknown as SupabaseClient<any> | null;
  const canManage = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'manager';
  const tab: Tab = activeModule === 'dealer_stock' ? 'stock' : activeModule === 'dealer_leads' ? 'leads' : activeModule === 'dealer_test_drives' ? 'test_drives' : activeModule === 'dealer_deals' ? 'deals' : activeModule === 'dealer_workshop' ? 'workshop' : activeModule === 'dealer_reports' ? 'reports' : 'dashboard';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [payments, setPayments] = useState<DealerPayment[]>([]);
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);
  const [paymentDealId, setPaymentDealId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currency = activeOrganisation?.base_currency ?? 'NGN';

  const load = useCallback(async () => {
    if (!supabase || !activeOrganisation) { setLoading(false); return; }
    setLoading(true); setError(null);
    const org = activeOrganisation.id;
    const results = await Promise.all([
      supabase.from('dealer_vehicles').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(500),
      supabase.from('dealer_leads').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(500),
      supabase.from('dealer_test_drives').select('*').eq('organization_id', org).order('scheduled_at', { ascending: false }).limit(500),
      supabase.from('dealer_deals').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(500),
      supabase.from('dealer_service_jobs').select('*').eq('organization_id', org).order('created_at', { ascending: false }).limit(500),
      supabase.from('dealer_payments').select('*').eq('organization_id', org).order('paid_at', { ascending: false }).limit(1000),
      supabase.from('finance_accounts').select('id,account_name,account_type,currency_code').eq('organization_id', org).eq('is_active', true).order('account_name'),
    ]);
    const failed = results.find(r => r.error);
    if (failed?.error) setError('Some dealership data could not be loaded: ' + failed.error.message);
    setVehicles((results[0].data ?? []) as Vehicle[]); setLeads((results[1].data ?? []) as Lead[]);
    setDrives((results[2].data ?? []) as Drive[]); setDeals((results[3].data ?? []) as Deal[]);
    setJobs((results[4].data ?? []) as Job[]); setPayments((results[5].data ?? []) as DealerPayment[]); setFinanceAccounts((results[6].data ?? []) as FinanceAccount[]); setLoading(false);
  }, [supabase, activeOrganisation?.id]);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => [
    { label: 'Available vehicles', value: vehicles.filter(v => v.status === 'in_stock').length.toString(), hint: 'Ready for sale' },
    { label: 'Active prospects', value: leads.filter(l => !['won','lost'].includes(l.status)).length.toString(), hint: 'Open customer enquiries' },
    { label: 'Upcoming test drives', value: drives.filter(d => d.status === 'scheduled' && new Date(d.scheduled_at).getTime() >= Date.now()).length.toString(), hint: 'Scheduled appointments' },
    { label: 'Open deals', value: deals.filter(d => !['completed','cancelled'].includes(d.status)).length.toString(), hint: 'Sales not yet delivered' },
  ], [vehicles, leads, drives, deals]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase || !activeOrganisation) return;
    const form = new FormData(event.currentTarget); const v = (key: string) => String(form.get(key) ?? '').trim();
    setSaving(true); setError(null); setNotice(null);
    let table = ''; let payload: Record<string, unknown> = { organization_id: activeOrganisation.id };
    if (tab === 'stock') {
      table = 'dealer_vehicles'; payload = { ...payload, stock_number: v('stock_number'), vin: v('vin') || null, make: v('make'), model: v('model'), model_year: Number(v('model_year')), mileage: Number(v('mileage') || 0), purchase_price: Number(v('purchase_price') || 0), asking_price: Number(v('asking_price') || 0), status: 'in_stock', condition: v('condition'), body_type: v('body_type') || null, fuel_type: v('fuel_type') || null, transmission: v('transmission') || null, exterior_color: v('exterior_color') || null, location_label: v('location_label') || null, warranty_until: v('warranty_until') || null, notes: v('notes') || null };
    } else if (tab === 'leads') {
      table = 'dealer_leads'; payload = { ...payload, full_name: v('full_name'), phone: v('phone') || null, email: v('email') || null, source: v('source'), interest_make: v('interest_make') || null, interest_model: v('interest_model') || null, budget: Number(v('budget') || 0), status: 'new', assigned_to: v('assigned_to') || null, next_follow_up_at: v('next_follow_up_at') ? new Date(v('next_follow_up_at')).toISOString() : null, notes: v('notes') || null };
    } else if (tab === 'test_drives') {
      table = 'dealer_test_drives'; payload = { ...payload, vehicle_id: v('vehicle_id'), customer_name: v('customer_name'), customer_phone: v('customer_phone') || null, scheduled_at: new Date(v('scheduled_at')).toISOString(), duration_minutes: Number(v('duration_minutes') || 30), staff_name: v('staff_name') || null, licence_verified: form.get('licence_verified') === 'on', notes: v('notes') || null };
    } else if (tab === 'deals') {
      table = 'dealer_deals'; payload = { ...payload, vehicle_id: v('vehicle_id'), deal_number: v('deal_number'), customer_name: v('customer_name'), customer_phone: v('customer_phone') || null, agreed_price: Number(v('agreed_price')), deposit_amount: 0, trade_in_description: null, trade_in_allowance: 0, expected_delivery_date: v('expected_delivery_date') || null, sales_person: v('sales_person') || null, status: 'draft', notes: v('notes') || null };
    } else {
      table = 'dealer_service_jobs'; payload = { ...payload, vehicle_id: v('vehicle_id'), job_number: v('job_number'), customer_name: v('customer_name') || null, job_type: v('job_type'), description: v('description'), odometer: Number(v('odometer') || 0), estimated_cost: Number(v('estimated_cost') || 0), actual_cost: 0, status: 'booked', assigned_to: v('assigned_to') || null, due_at: v('due_at') ? new Date(v('due_at')).toISOString() : null, notes: v('notes') || null };
    }
    const { error: insertError } = await supabase.from(table).insert(payload);
    if (insertError) setError(insertError.code === '23505' ? 'That stock, deal or job reference already exists in this organisation.' : insertError.message);
    else { setNotice('Record saved successfully.'); setFormOpen(false); await load(); }
    setSaving(false);
  };

  const changeStatus = async (table: string, id: string, status: string) => {
    if (!supabase || !activeOrganisation || !canManage) return;
    setSaving(true); setError(null); setNotice(null);
    const { data, error: updateError } = await supabase.from(table).update({ status }).eq('id', id).eq('organization_id', activeOrganisation.id).select('id').maybeSingle();
    if (updateError) setError('The workflow status was not saved: ' + updateError.message);
    else if (!data) setError('No record was updated. Check your organisation access and permissions.');
    else { setNotice('Workflow updated.'); await load(); }
    setSaving(false);
  };

  const recordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !activeOrganisation || !paymentDealId || !canManage) return;
    if (!paymentAccountId) { setError('Select the cash or bank account that received this payment.'); return; }
    const amount=Number(paymentAmount);
    if (!Number.isFinite(amount)||amount<=0) { setError('Enter a valid payment amount.'); return; }
    setSaving(true);setError(null);setNotice(null);
    const {error:paymentError}=await supabase.rpc('dealer_record_payment',{
      p_organization_id:activeOrganisation.id,p_deal_id:paymentDealId,p_financial_account_id:paymentAccountId,
      p_amount:amount,p_reference:paymentReference.trim()||null,p_notes:paymentNotes.trim()||null,
      p_idempotency_key:crypto.randomUUID()
    });
    if(paymentError)setError('Deal payment could not be recorded: '+paymentError.message);
    else{setNotice('Payment recorded and posted to the finance ledger.');setPaymentDealId(null);setPaymentAmount('');setPaymentAccountId('');setPaymentReference('');setPaymentNotes('');await load();}
    setSaving(false);
  };

  const completeDelivery = async (dealId:string) => {
    if(!supabase||!activeOrganisation||!canManage)return;
    setSaving(true);setError(null);setNotice(null);
    const {error:deliveryError}=await supabase.rpc('dealer_complete_delivery',{
      p_organization_id:activeOrganisation.id,p_deal_id:dealId,p_idempotency_key:crypto.randomUUID()
    });
    if(deliveryError)setError('Delivery could not be completed: '+deliveryError.message);
    else{setNotice('Vehicle delivery completed. Revenue and cost of sales were posted to the finance ledger.');await load();}
    setSaving(false);
  };

  if (!activeOrganisation) return null;
  const vehicleLabel = (id: string) => { const v = vehicles.find(x => x.id === id); return v ? v.stock_number + ' · ' + v.model_year + ' ' + v.make + ' ' + v.model : 'Vehicle unavailable'; };
  const openForm = () => { setError(null); setNotice(null); setFormOpen(true); };

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700"><CarFront className="h-4 w-4"/> Dealership operations</div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Showroom & vehicle sales</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">Manage stock, customer enquiries, test drives, vehicle deals and after-sales workshop work in one organisation workspace.</p></div>
      <button onClick={() => void load()} disabled={loading || saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"><RefreshCw className="h-4 w-4"/> Refresh</button>
    </header>
    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"><AlertCircle className="h-4 w-4 shrink-0"/>{error}</div>}
    {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0"/>{notice}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(m => <div key={m.label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{m.label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{m.value}</p><p className="mt-1 text-[11px] text-slate-500">{m.hint}</p></div>)}</div>
    {tab !== 'dashboard' && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h3 className="text-sm font-semibold text-slate-900">{tabs.find(t=>t.id===tab)?.label}</h3><p className="mt-1 text-xs text-slate-500">Organisation-scoped records with role-controlled updates.</p></div>{tab !== 'reports' && (canManage || ['leads','test_drives','workshop'].includes(tab)) && <button onClick={openForm} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> Add {tab==='stock'?'vehicle':tab==='leads'?'lead':tab==='test_drives'?'test drive':tab==='deals'?'deal':'workshop job'}</button>}</div>
      {formOpen && <form onSubmit={submit} className="grid gap-3 border-b border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {tab==='stock' && <>
          <label className={labelClass}>Stock number *<input name="stock_number" required className={inputClass}/></label><label className={labelClass}>VIN<input name="vin" className={inputClass}/></label><label className={labelClass}>Make *<input name="make" required className={inputClass}/></label><label className={labelClass}>Model *<input name="model" required className={inputClass}/></label><label className={labelClass}>Model year *<input name="model_year" required type="number" min="1900" max="2100" className={inputClass}/></label><label className={labelClass}>Mileage<input name="mileage" type="number" min="0" defaultValue="0" className={inputClass}/></label><label className={labelClass}>Purchase cost<input name="purchase_price" type="number" min="0" step=".01" defaultValue="0" className={inputClass}/></label><label className={labelClass}>Asking price<input name="asking_price" type="number" min="0" step=".01" defaultValue="0" className={inputClass}/></label><label className={labelClass}>Condition<select name="condition" className={inputClass}><option value="used">Used</option><option value="new">New</option><option value="certified_pre_owned">Certified pre-owned</option></select></label><label className={labelClass}>Body type<input name="body_type" placeholder="SUV, sedan, truck..." className={inputClass}/></label><label className={labelClass}>Fuel type<input name="fuel_type" placeholder="Petrol, diesel, hybrid..." className={inputClass}/></label><label className={labelClass}>Transmission<input name="transmission" placeholder="Automatic / manual" className={inputClass}/></label><label className={labelClass}>Exterior colour<input name="exterior_color" className={inputClass}/></label><label className={labelClass}>Showroom location<input name="location_label" className={inputClass}/></label><label className={labelClass}>Warranty until<input name="warranty_until" type="date" className={inputClass}/></label><label className={labelClass+' sm:col-span-2'}>Notes<input name="notes" className={inputClass}/></label>
        </>}
        {tab==='leads' && <><label className={labelClass}>Customer name *<input name="full_name" required className={inputClass}/></label><label className={labelClass}>Phone<input name="phone" type="tel" className={inputClass}/></label><label className={labelClass}>Email<input name="email" type="email" className={inputClass}/></label><label className={labelClass}>Enquiry source<select name="source" className={inputClass}><option value="walk_in">Walk in</option><option value="website">Website</option><option value="social">Social media</option><option value="referral">Referral</option><option value="phone">Phone</option><option value="marketplace">Marketplace</option><option value="other">Other</option></select></label><label className={labelClass}>Interested make<input name="interest_make" className={inputClass}/></label><label className={labelClass}>Interested model<input name="interest_model" className={inputClass}/></label><label className={labelClass}>Budget<input name="budget" type="number" min="0" defaultValue="0" className={inputClass}/></label><label className={labelClass}>Assigned salesperson<input name="assigned_to" className={inputClass}/></label><label className={labelClass}>Next follow-up<input name="next_follow_up_at" type="datetime-local" className={inputClass}/></label><label className={labelClass+' sm:col-span-2'}>Notes<input name="notes" className={inputClass}/></label></>}
        {tab==='test_drives' && <><label className={labelClass}>Vehicle *<select name="vehicle_id" required className={inputClass}><option value="">Choose vehicle</option>{vehicles.filter(v=>v.status==='in_stock'||v.status==='reserved').map(v=><option key={v.id} value={v.id}>{vehicleLabel(v.id)}</option>)}</select></label><label className={labelClass}>Customer name *<input name="customer_name" required className={inputClass}/></label><label className={labelClass}>Customer phone<input name="customer_phone" className={inputClass}/></label><label className={labelClass}>Appointment *<input name="scheduled_at" required type="datetime-local" min={new Date().toISOString().slice(0,16)} className={inputClass}/></label><label className={labelClass}>Duration (minutes)<input name="duration_minutes" type="number" min="10" max="240" defaultValue="30" className={inputClass}/></label><label className={labelClass}>Salesperson<input name="staff_name" className={inputClass}/></label><label className="flex items-center gap-2 text-xs font-medium"><input name="licence_verified" type="checkbox"/> Driving licence verified</label><label className={labelClass+' sm:col-span-2'}>Notes<input name="notes" className={inputClass}/></label></>}
        {tab==='deals' && <><label className={labelClass}>Vehicle *<select name="vehicle_id" required className={inputClass}><option value="">Choose vehicle</option>{vehicles.filter(v=>v.status==='in_stock'||v.status==='reserved').map(v=><option key={v.id} value={v.id}>{vehicleLabel(v.id)}</option>)}</select></label><label className={labelClass}>Deal reference *<input name="deal_number" required className={inputClass}/></label><label className={labelClass}>Customer name *<input name="customer_name" required className={inputClass}/></label><label className={labelClass}>Customer phone<input name="customer_phone" className={inputClass}/></label><label className={labelClass}>Agreed price *<input name="agreed_price" required type="number" min="0.01" step=".01" className={inputClass}/></label><p className="text-[11px] text-slate-500 sm:col-span-2">Payments are recorded separately and posted to Finance. Trade-in accounting is not enabled in this workflow.</p><label className={labelClass}>Expected delivery<input name="expected_delivery_date" type="date" className={inputClass}/></label><label className={labelClass}>Salesperson<input name="sales_person" className={inputClass}/></label><label className={labelClass+' sm:col-span-2'}>Notes<input name="notes" className={inputClass}/></label></>}
        {tab==='workshop' && <><label className={labelClass}>Vehicle *<select name="vehicle_id" required className={inputClass}><option value="">Choose vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{vehicleLabel(v.id)}</option>)}</select></label><label className={labelClass}>Job reference *<input name="job_number" required className={inputClass}/></label><label className={labelClass}>Customer name<input name="customer_name" className={inputClass}/></label><label className={labelClass}>Job type<select name="job_type" className={inputClass}><option value="inspection">Inspection</option><option value="repair">Repair</option><option value="maintenance">Maintenance</option><option value="detailing">Detailing</option><option value="warranty">Warranty</option><option value="pre_delivery">Pre-delivery preparation</option></select></label><label className={labelClass}>Odometer<input name="odometer" type="number" min="0" defaultValue="0" className={inputClass}/></label><label className={labelClass}>Estimated cost<input name="estimated_cost" type="number" min="0" step=".01" defaultValue="0" className={inputClass}/></label><label className={labelClass}>Assigned technician<input name="assigned_to" className={inputClass}/></label><label className={labelClass}>Due date<input name="due_at" type="datetime-local" className={inputClass}/></label><label className={labelClass+' sm:col-span-2'}>Work description *<input name="description" required className={inputClass}/></label><label className={labelClass+' sm:col-span-2'}>Notes<input name="notes" className={inputClass}/></label></>}
        <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3"><button type="button" onClick={()=>setFormOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving&&<Loader2 className="h-4 w-4 animate-spin"/>}Save record</button></div>
      </form>}
      {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>Loading dealership records…</div> :
      <div className="overflow-x-auto">
        {tab==='reports' && <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Stock acquisition value</p><p className="mt-2 text-xl font-semibold">{money(vehicles.filter(v=>v.status==='in_stock').reduce((n,v)=>n+Number(v.purchase_price||0),0),currency)}</p><p className="mt-1 text-[10px] text-slate-500">Purchase cost of available vehicles</p></article>
          <article className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Available asking value</p><p className="mt-2 text-xl font-semibold">{money(vehicles.filter(v=>v.status==='in_stock').reduce((n,v)=>n+Number(v.asking_price||0),0),currency)}</p><p className="mt-1 text-[10px] text-slate-500">Current advertised value</p></article>
          <article className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Active deal pipeline</p><p className="mt-2 text-xl font-semibold">{money(deals.filter(d=>!['completed','cancelled'].includes(d.status)).reduce((n,d)=>n+Number(d.agreed_price||0),0),currency)}</p><p className="mt-1 text-[10px] text-slate-500">Agreed values, not collected payments</p></article>
          <article className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Lead conversion</p><p className="mt-2 text-xl font-semibold">{leads.length?Math.round(leads.filter(l=>l.status==='won').length/leads.length*100):0}%</p><p className="mt-1 text-[10px] text-slate-500">{leads.filter(l=>l.status==='won').length} won of {leads.length} recorded leads</p></article>
          <article className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Vehicles sold</p><p className="mt-2 text-xl font-semibold">{vehicles.filter(v=>v.status==='sold').length}</p><p className="mt-1 text-[10px] text-slate-500">Inventory currently marked sold</p></article>
          <article className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">Open workshop jobs</p><p className="mt-2 text-xl font-semibold">{jobs.filter(j=>!['completed','cancelled'].includes(j.status)).length}</p><p className="mt-1 text-[10px] text-slate-500">Jobs not yet closed</p></article>
          <p className="text-[11px] leading-5 text-slate-500 sm:col-span-2 xl:col-span-3">Figures reflect the latest organisation-scoped records. Deal deposits are tracking-only; these reports do not represent verified cash receipts or general-ledger postings.</p>
        </div>}
        {tab==='stock' && <table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Stock','Vehicle','VIN','Mileage','Purchase','Asking','Status'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{vehicles.map(v=><tr key={v.id}><td className="px-4 py-3 font-semibold">{v.stock_number}</td><td className="px-4 py-3">{v.model_year} {v.make} {v.model}<div className="text-[10px] text-slate-400">{pretty(v.condition)}{v.exterior_color?' · '+v.exterior_color:''}</div></td><td className="px-4 py-3">{v.vin||'—'}</td><td className="px-4 py-3">{Number(v.mileage).toLocaleString()}</td><td className="px-4 py-3">{money(v.purchase_price,currency)}</td><td className="px-4 py-3">{money(v.asking_price,currency)}</td><td className="px-4 py-3"><select disabled={!canManage} value={v.status} onChange={e=>void changeStatus('dealer_vehicles',v.id,e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1"><option value="in_stock">In stock</option><option value="reserved">Reserved</option><option value="sold">Sold</option><option value="in_service">In service</option></select></td></tr>)}</tbody></table>}
        {tab==='leads' && <table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Customer','Contact','Interest','Budget','Source','Follow-up','Pipeline'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{leads.map(l=><tr key={l.id}><td className="px-4 py-3 font-semibold">{l.full_name}</td><td className="px-4 py-3">{l.phone||l.email||'—'}</td><td className="px-4 py-3">{[l.interest_make,l.interest_model].filter(Boolean).join(' ')||'—'}</td><td className="px-4 py-3">{money(l.budget,currency)}</td><td className="px-4 py-3">{pretty(l.source)}</td><td className="px-4 py-3">{localDateTime(l.next_follow_up_at)}</td><td className="px-4 py-3"><select disabled={!canManage} value={l.status} onChange={e=>void changeStatus('dealer_leads',l.id,e.target.value)} className="rounded-md border border-slate-200 px-2 py-1">{['new','contacted','qualified','test_drive','negotiation','won','lost'].map(s=><option key={s} value={s}>{pretty(s)}</option>)}</select></td></tr>)}</tbody></table>}
        {tab==='test_drives' && <table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Customer','Vehicle','Appointment','Duration','Licence','Salesperson','Status'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{drives.map(d=><tr key={d.id}><td className="px-4 py-3 font-semibold">{d.customer_name}<div className="text-[10px] text-slate-400">{d.customer_phone||''}</div></td><td className="px-4 py-3">{vehicleLabel(d.vehicle_id)}</td><td className="px-4 py-3">{localDateTime(d.scheduled_at)}</td><td className="px-4 py-3">{d.duration_minutes} min</td><td className="px-4 py-3">{d.licence_verified?'Verified':'Not verified'}</td><td className="px-4 py-3">{d.staff_name||'—'}</td><td className="px-4 py-3"><select disabled={!canManage} value={d.status} onChange={e=>void changeStatus('dealer_test_drives',d.id,e.target.value)} className="rounded-md border border-slate-200 px-2 py-1">{['scheduled','in_progress','completed','cancelled','no_show'].map(s=><option key={s} value={s}>{pretty(s)}</option>)}</select></td></tr>)}</tbody></table>}
        {tab==='deals' && <><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Deal','Customer','Vehicle','Agreed price','Paid','Balance','Delivery','Status','Actions'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{deals.map(d=>{const paid=payments.filter(p=>p.deal_id===d.id).reduce((sum,p)=>sum+Number(p.amount||0),0);const balance=Math.max(Number(d.agreed_price)-paid,0);return <tr key={d.id}><td className="px-4 py-3 font-semibold">{d.deal_number}</td><td className="px-4 py-3">{d.customer_name}</td><td className="px-4 py-3">{vehicleLabel(d.vehicle_id)}</td><td className="px-4 py-3">{money(d.agreed_price,currency)}</td><td className="px-4 py-3">{money(paid,currency)}</td><td className="px-4 py-3">{money(balance,currency)}</td><td className="px-4 py-3">{d.expected_delivery_date||'—'}</td><td className="px-4 py-3"><select disabled={!canManage||d.status==='completed'||d.status==='ready_for_delivery'} value={d.status} onChange={e=>void changeStatus('dealer_deals',d.id,e.target.value)} className="rounded-md border border-slate-200 px-2 py-1">{['draft','reserved','awaiting_payment','ready_for_delivery','completed','cancelled'].map(status=><option key={status} value={status} disabled={['ready_for_delivery','completed'].includes(status)||(status==='cancelled'&&paid>0)}>{pretty(status)}</option>)}</select></td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{canManage&&balance>0&&!['completed','cancelled'].includes(d.status)&&<button onClick={()=>{setPaymentDealId(d.id);setPaymentAmount(balance.toFixed(2));setPaymentAccountId(financeAccounts[0]?.id??'');}} className="rounded-md bg-blue-700 px-2 py-1 text-[10px] font-semibold text-white">Record payment</button>}{canManage&&d.status==='ready_for_delivery'&&<button disabled={saving} onClick={()=>void completeDelivery(d.id)} className="rounded-md bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white">Complete delivery</button>}{canManage&&<button onClick={()=>setPaymentDealId(paymentDealId===d.id?null:d.id)} className="rounded-md border border-slate-300 px-2 py-1 text-[10px]">Payments</button>}</div></td></tr>})}</tbody></table>
 {paymentDealId&&(()=>{const d=deals.find(x=>x.id===paymentDealId);if(!d)return null;const history=payments.filter(p=>p.deal_id===d.id);const paid=history.reduce((sum,p)=>sum+Number(p.amount||0),0);return <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4"><div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Payments · {d.deal_number}</h3><p className="mt-1 text-xs text-slate-600">{d.customer_name} · Outstanding {money(Math.max(d.agreed_price-paid,0),currency)}</p></div><button onClick={()=>setPaymentDealId(null)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">Close</button></div>
 <div className="mt-3 space-y-1">{history.map(p=><div key={p.id} className="flex justify-between rounded-md bg-white px-3 py-2 text-xs"><span>{p.reference} · {localDateTime(p.paid_at)}</span><b>{money(p.amount,currency)}</b></div>)}{!history.length&&<p className="text-xs text-slate-500">No verified payments recorded yet.</p>}</div>
 {d.status!=='completed'&&d.status!=='cancelled'&&Math.max(d.agreed_price-paid,0)>0&&<form onSubmit={recordPayment} className="mt-3 grid gap-2 sm:grid-cols-2"><select required value={paymentAccountId} onChange={e=>setPaymentAccountId(e.target.value)} className={inputClass}><option value="">Select receiving account</option>{financeAccounts.map(a=><option key={a.id} value={a.id}>{a.account_name} · {pretty(a.account_type)}</option>)}</select><input required type="number" min="0.01" max={Math.max(d.agreed_price-paid,0)} step=".01" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} placeholder="Amount received" className={inputClass}/><input value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="Payment reference (optional)" className={inputClass}/><input value={paymentNotes} onChange={e=>setPaymentNotes(e.target.value)} placeholder="Notes (optional)" className={inputClass}/><button disabled={saving||!financeAccounts.length} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white sm:col-span-2">{saving?'Recording…':'Record and post payment'}</button>{!financeAccounts.length&&<p className="text-[11px] text-amber-700 sm:col-span-2">No active cash/bank account is configured. Add one in Finance before recording dealership payments.</p>}</form>}</section>})()}
 </>}
        {tab==='workshop' && <table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Job','Vehicle','Customer','Type / work','Technician','Due','Estimate','Status'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{jobs.map(j=><tr key={j.id}><td className="px-4 py-3 font-semibold">{j.job_number}</td><td className="px-4 py-3">{vehicleLabel(j.vehicle_id)}</td><td className="px-4 py-3">{j.customer_name||'—'}</td><td className="px-4 py-3">{pretty(j.job_type)}<div className="text-[10px] text-slate-400">{j.description}</div></td><td className="px-4 py-3">{j.assigned_to||'—'}</td><td className="px-4 py-3">{localDateTime(j.due_at)}</td><td className="px-4 py-3">{money(j.estimated_cost,currency)}</td><td className="px-4 py-3"><select disabled={!canManage} value={j.status} onChange={e=>void changeStatus('dealer_service_jobs',j.id,e.target.value)} className="rounded-md border border-slate-200 px-2 py-1">{['booked','in_progress','waiting_parts','quality_check','completed','cancelled'].map(s=><option key={s} value={s}>{pretty(s)}</option>)}</select></td></tr>)}</tbody></table>}
        {((tab==='stock'&&!vehicles.length)||(tab==='leads'&&!leads.length)||(tab==='test_drives'&&!drives.length)||(tab==='deals'&&!deals.length)||(tab==='workshop'&&!jobs.length))&&<p className="p-10 text-center text-xs text-slate-500">No records here yet. Use Add to create the first record.</p>}
      </div>}
    </section>}
    <p className="text-[11px] leading-5 text-slate-500">Vehicle deals here are a sales pipeline and deal tracker. They do not collect customer payments, issue statutory invoices or post to the general ledger; use Veyora's approved sales and finance workflows for actual payment and accounting until a dedicated vehicle-sale integration is enabled.</p>
  </div>;
}

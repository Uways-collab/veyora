import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardCheck, Factory, Home, Loader2, Plus, RefreshCw, Truck, Utensils } from 'lucide-react';
import { getSupabaseClient } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

type RowRecord = Record<string, any>;
type Field = { name: string; label: string; type?: string; required?: boolean; options?: string[]; wide?: boolean; min?: string; step?: string };

type BoardContext = { rows: RowRecord[]; loading: boolean; saving: boolean; error: string | null; notice: string | null; create: (e: FormEvent<HTMLFormElement>) => Promise<void>; changeStatus: (row: RowRecord, status: string) => Promise<void>; updateField: (row: RowRecord, field: string, value: unknown) => Promise<void>; refresh: () => Promise<void>; form: boolean; setForm: (v: boolean) => void; fields: Field[]; currency: string; canManage: boolean };
const cls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500';
const label = 'block space-y-1 text-xs font-medium text-slate-700';
const titleCase = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const money = (v: unknown, currency: string) => { const n = Number(v) || 0; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); } catch { return n.toLocaleString() + ' ' + currency; } };
const dateText = (v: unknown) => v ? new Date(String(v)).toLocaleDateString() : '—';

function useBoard(table: string, sort: string, fields: Field[], defaults: RowRecord): BoardContext {
  const { activeOrganisation, activeRole } = useAuth();
  const db = getSupabaseClient() as any;
  const [rows, setRows] = useState<RowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [notice, setNotice] = useState<string|null>(null);
  const [form, setForm] = useState(false);
  const currency = activeOrganisation?.base_currency ?? 'NGN';
  const canManage = ['owner','admin','manager'].includes(activeRole ?? '');
  const refresh = useCallback(async () => {
    if (!db || !activeOrganisation) { setRows([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data, error: queryError } = await db.from(table).select('*').eq('organization_id', activeOrganisation.id).order(sort, { ascending: false }).limit(500);
    if (queryError) { setRows([]); setError('Could not load this workspace: ' + queryError.message); }
    else setRows(data ?? []);
    setLoading(false);
  }, [db, activeOrganisation?.id, table, sort]);
  useEffect(() => { void refresh(); }, [refresh]);
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!db || !activeOrganisation) return;
    setSaving(true); setError(null); setNotice(null);
    const fd = new FormData(e.currentTarget);
    const payload: RowRecord = { organization_id: activeOrganisation.id };
    for (const f of fields) {
      const raw = String(fd.get(f.name) ?? '').trim();
      if (f.type === 'number') payload[f.name] = raw === '' ? (defaults[f.name] ?? 0) : Number(raw);
      else if (f.type === 'datetime-local') payload[f.name] = raw ? new Date(raw).toISOString() : null;
      else payload[f.name] = raw || defaults[f.name] || null;
    }
    const { error: insertError } = await db.from(table).insert(payload);
    if (insertError) setError(insertError.code === '23505' ? 'That reference already exists in this organisation.' : insertError.message);
    else { setNotice('Record created successfully.'); setForm(false); await refresh(); }
    setSaving(false);
  };
  const updateField = async (row: RowRecord, field: string, value: unknown) => {
    if (!db || !activeOrganisation || !canManage) return;
    setSaving(true); setError(null); setNotice(null);
    const { data, error: updateError } = await db.from(table).update({ [field]: value }).eq('id', row.id).eq('organization_id', activeOrganisation.id).select('id').maybeSingle();
    if (updateError) setError('Record update failed: ' + updateError.message);
    else if (!data) setError('No record was updated. Check your organisation access and permissions.');
    else { setNotice('Record details updated.'); await refresh(); }
    setSaving(false);
  };
  const changeStatus = async (row: RowRecord, status: string) => {
    if (!db || !activeOrganisation || !canManage) return;
    setSaving(true); setError(null); setNotice(null);
    const { data, error: updateError } = await db.from(table).update({ status }).eq('id', row.id).eq('organization_id', activeOrganisation.id).select('id').maybeSingle();
    if (updateError) setError('Workflow update failed: ' + updateError.message);
    else if (!data) setError('No record was updated. Check your organisation access and permissions.');
    else { setNotice('Workflow status updated.'); await refresh(); }
    setSaving(false);
  };
  return { rows, loading, saving, error, notice, create, changeStatus, updateField, refresh, form, setForm, fields, currency, canManage };
}

function RecordForm({ ctx, onClose, submitLabel }: { ctx: BoardContext; onClose: () => void; submitLabel: string }) {
  return <form onSubmit={ctx.create} className="grid gap-3 border-b border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 xl:grid-cols-3">
    {ctx.fields.map(f => <label key={f.name} className={label + (f.wide ? ' sm:col-span-2 xl:col-span-3' : '')}>
      {f.label}{f.required ? ' *' : ''}
      {f.options ? <select name={f.name} required={f.required} defaultValue="" className={cls}><option value="">Select…</option>{f.options.map(o => <option key={o} value={o}>{titleCase(o)}</option>)}</select>
      : f.type === 'textarea' ? <textarea name={f.name} required={f.required} rows={3} className={cls}/>
      : <input name={f.name} type={f.type ?? 'text'} required={f.required} min={f.min} step={f.step} className={cls}/>}
    </label>)}
    <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-3"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold">Cancel</button><button disabled={ctx.saving} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{ctx.saving ? 'Saving…' : submitLabel}</button></div>
  </form>;
}
function Shell({ eyebrow, heading, description, icon, ctx, children }: { eyebrow:string; heading:string; description:string; icon:ReactNode; ctx:BoardContext; children:ReactNode }) {
  return <div className="space-y-5">
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">{icon}{eyebrow}</div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">{heading}</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p></div><button onClick={() => void ctx.refresh()} disabled={ctx.loading || ctx.saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><RefreshCw className="h-4 w-4"/> Refresh</button></header>
    {ctx.error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><AlertCircle className="h-4 w-4 shrink-0"/>{ctx.error}</div>}
    {ctx.notice && <div role="status" className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0"/>{ctx.notice}</div>}
    {children}
  </div>;
}
function Metric({ label: name, value, hint }: { label:string; value:string; hint:string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{name}</p><p className="mt-2 text-2xl font-semibold text-slate-950 tabular-nums">{value}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div>; }
function StatusSelect({ row, ctx, options }: { row:RowRecord; ctx:BoardContext; options:string[] }) { return <select disabled={!ctx.canManage||ctx.saving} aria-label="Update workflow status" value={row.status} onChange={e => void ctx.changeStatus(row,e.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold">{[row.status,...options].filter((v,i,a)=>a.indexOf(v)===i).map(s=><option key={s} value={s}>{titleCase(s)}</option>)}</select>; }

const propertyFields: Field[] = [
 {name:'property_name',label:'Property / estate name',required:true},{name:'unit_reference',label:'Unit reference',required:true},{name:'tenant_name',label:'Tenant full name',required:true},{name:'tenant_email',label:'Tenant email',type:'email'},{name:'tenant_phone',label:'Tenant phone',type:'tel'},
 {name:'lease_start',label:'Lease start',type:'date',required:true},{name:'lease_end',label:'Lease end',type:'date',required:true},{name:'monthly_rent',label:'Monthly rent',type:'number',min:'0',step:'0.01',required:true},{name:'security_deposit',label:'Security deposit',type:'number',min:'0',step:'0.01'},{name:'rent_due_day',label:'Rent due day (1–28)',type:'number',min:'1',step:'1'},{name:'status',label:'Lease status',options:['draft','active','ended','terminated']},{name:'notes',label:'Property / tenant notes',type:'textarea',wide:true}
];
const restaurantFields: Field[] = [
 {name:'order_number',label:'Order number',required:true},{name:'order_type',label:'Service type',options:['dine_in','takeaway','delivery']},{name:'table_label',label:'Table / pickup reference'},{name:'customer_name',label:'Customer name'},
 {name:'items_summary',label:'Items and modifiers',type:'textarea',required:true,wide:true},{name:'total_amount',label:'Order total',type:'number',min:'0',step:'0.01'},{name:'status',label:'Kitchen status',options:['new','accepted','preparing','ready','served','completed','cancelled']},{name:'notes',label:'Allergies / service notes',type:'textarea',wide:true}
];
const logisticsFields: Field[] = [
 {name:'tracking_number',label:'Tracking number',required:true},{name:'recipient_name',label:'Recipient name',required:true},{name:'recipient_phone',label:'Recipient phone',type:'tel'},{name:'origin',label:'Pickup location',required:true},{name:'destination',label:'Delivery destination',required:true},{name:'scheduled_at',label:'Dispatch time',type:'datetime-local'},{name:'status',label:'Delivery status',options:['pending','assigned','in_transit','delivered','failed','returned']},{name:'proof_of_delivery_url',label:'Proof of delivery URL'},{name:'notes',label:'Dispatch notes',type:'textarea',wide:true}
];
const productionFields: Field[] = [
 {name:'order_number',label:'Production order number',required:true},{name:'product_name',label:'Finished product',required:true},{name:'planned_quantity',label:'Planned quantity',type:'number',min:'0.001',step:'0.001',required:true},{name:'completed_quantity',label:'Completed quantity',type:'number',min:'0',step:'0.001'},{name:'planned_start',label:'Planned start',type:'date'},{name:'due_date',label:'Due date',type:'date'},{name:'status',label:'Production stage',options:['planned','released','in_progress','quality_check','completed','cancelled']},{name:'notes',label:'Production / quality notes',type:'textarea',wide:true}
];

export function RealEstateWorkspaceView() {
 const ctx=useBoard('real_estate_leases','created_at',propertyFields,{security_deposit:0,rent_due_day:1,status:'draft'});
 const active=ctx.rows.filter(r=>r.status==='active');
 const rent=active.reduce((n,r)=>n+Number(r.monthly_rent||0),0);
 const ending=active.filter(r=>{const d=(new Date(r.lease_end).getTime()-Date.now())/86400000;return d>=0&&d<=30;});
 const overdue=active.filter(r=>Number(r.rent_due_day||1)<new Date().getDate());
 return <Shell eyebrow="Property operations" heading="Real estate portfolio" description="Manage properties, occupied units, tenant agreements, lease renewals and rent schedules." icon={<Home className="h-4 w-4"/>} ctx={ctx}>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active leases" value={String(active.length)} hint="Current tenancies"/><Metric label="Scheduled monthly rent" value={money(rent,ctx.currency)} hint="Contracted rent, not cash received"/><Metric label="Renewals due soon" value={String(ending.length)} hint="Lease ends within 30 days"/><Metric label="Rent follow-up" value={String(overdue.length)} hint="Due day has passed this month; verify payment status"/></div>
  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="font-semibold text-slate-900">Lease register</h2><p className="mt-1 text-xs text-slate-500">Tenant agreements, rental terms and expiry tracking.</p></div><button onClick={()=>ctx.setForm(!ctx.form)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> New lease</button></div>
   {ctx.form&&<RecordForm ctx={ctx} onClose={()=>ctx.setForm(false)} submitLabel="Save lease"/>}
   {ctx.loading?<div className="p-12 text-center text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin"/>Loading property register…</div>:<div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Property / unit','Tenant','Lease period','Monthly rent','Security deposit','Status'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{ctx.rows.map(r=><tr key={r.id}><td className="px-4 py-3 font-semibold">{r.property_name}<div className="text-[10px] font-normal text-slate-500">{r.unit_reference}</div></td><td className="px-4 py-3">{r.tenant_name}<div className="text-[10px] text-slate-500">{r.tenant_phone||r.tenant_email||''}</div></td><td className="whitespace-nowrap px-4 py-3">{dateText(r.lease_start)} – {dateText(r.lease_end)}</td><td className="px-4 py-3">{money(r.monthly_rent,ctx.currency)}</td><td className="px-4 py-3">{money(r.security_deposit,ctx.currency)}</td><td className="px-4 py-3"><StatusSelect row={r} ctx={ctx} options={r.status==='draft'?['active','terminated']:r.status==='active'?['ended','terminated']:[]}/></td></tr>)}</tbody></table>{!ctx.rows.length&&<p className="p-10 text-center text-xs text-slate-500">No lease records yet. Add the first tenant agreement.</p>}</div>}
  </section>
  <section className="grid gap-3 lg:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Lease renewals</h3><p className="mt-1 text-xs text-slate-500">Agreements ending in the next 30 days.</p>{ending.length?ending.map(r=><div key={r.id} className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs"><span>{r.property_name} · {r.unit_reference}<small className="block text-slate-500">{r.tenant_name}</small></span><b>{dateText(r.lease_end)}</b></div>):<p className="mt-4 text-xs text-slate-500">No upcoming lease expiries in this window.</p>}</div><div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Rent schedule</h3><p className="mt-1 text-xs text-slate-500">Contractual due dates only. This dashboard does not mark rent as paid or post receipts to finance.</p>{active.slice(0,6).map(r=><div key={r.id} className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs"><span>{r.tenant_name}<small className="block text-slate-500">{r.property_name} · due day {r.rent_due_day}</small></span><b>{money(r.monthly_rent,ctx.currency)}</b></div>)}</div></section>
 </Shell>;
}

export function RestaurantWorkspaceView() {
 const ctx=useBoard('restaurant_orders','ordered_at',restaurantFields,{order_type:'dine_in',total_amount:0,status:'new'});
 const { activeOrganisation } = useAuth();
 const db = getSupabaseClient() as any;
 const [menuItems,setMenuItems]=useState<RowRecord[]>([]);
 const [tables,setTables]=useState<RowRecord[]>([]);
 const [menuName,setMenuName]=useState('');
 const [menuPrice,setMenuPrice]=useState('');
 const [menuStation,setMenuStation]=useState('kitchen');
 const [tableNumber,setTableNumber]=useState('');
 const [tableSeats,setTableSeats]=useState('2');
 const [selectedOrder,setSelectedOrder]=useState<RowRecord|null>(null);
 const [selectedMenuItem,setSelectedMenuItem]=useState('');
 const [itemQuantity,setItemQuantity]=useState('1');
 const [itemModifiers,setItemModifiers]=useState('');
 const [restaurantError,setRestaurantError]=useState<string|null>(null);
 const [restaurantNotice,setRestaurantNotice]=useState<string|null>(null);
 const [restaurantSaving,setRestaurantSaving]=useState(false);
 const [orderItems,setOrderItems]=useState<RowRecord[]>([]);
 const refreshRestaurantSetup=useCallback(async()=>{
  if(!db||!activeOrganisation){setMenuItems([]);setTables([]);return;}
  const [menuResult,tableResult]=await Promise.all([
   db.from('restaurant_menu_items').select('*').eq('organization_id',activeOrganisation.id).order('name'),
   db.from('restaurant_tables').select('*').eq('organization_id',activeOrganisation.id).order('table_number')
  ]);
  if(menuResult.error||tableResult.error){setRestaurantError(menuResult.error?.message||tableResult.error?.message||'Could not load restaurant setup.');return;}
  setMenuItems(menuResult.data??[]);setTables(tableResult.data??[]);setRestaurantError(null);
 },[db,activeOrganisation?.id]);
 useEffect(()=>{void refreshRestaurantSetup();},[refreshRestaurantSetup]);
 const addMenuItem=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_menu_items').insert({organization_id:activeOrganisation.id,name:menuName.trim(),price:Number(menuPrice),prep_station:menuStation});
  if(error)setRestaurantError(error.message);else{setMenuName('');setMenuPrice('');setRestaurantNotice('Menu item saved.');await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const addDiningTable=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_tables').insert({organization_id:activeOrganisation.id,table_number:tableNumber.trim(),seats:Number(tableSeats)});
  if(error)setRestaurantError(error.code==='23505'?'That table number already exists.':error.message);else{setTableNumber('');setRestaurantNotice('Dining table added.');await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const openOrderItems=async(order:RowRecord)=>{
  setSelectedOrder(order);setRestaurantError(null);setRestaurantNotice(null);setSelectedMenuItem('');setItemQuantity('1');setItemModifiers('');
  const {data,error}=await db.from('restaurant_order_items').select('*').eq('organization_id',activeOrganisation?.id).eq('order_id',order.id).order('created_at');
  if(error){setRestaurantError(error.message);setOrderItems([]);}else setOrderItems(data??[]);
 };
 const addOrderItem=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!selectedOrder)return;
  const item=menuItems.find(x=>x.id===selectedMenuItem);if(!item)return;
  setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_order_items').insert({organization_id:activeOrganisation.id,order_id:selectedOrder.id,menu_item_id:item.id,item_name:item.name,quantity:Number(itemQuantity),unit_price:Number(item.price),modifiers:itemModifiers.trim()||null});
  if(error)setRestaurantError(error.message);else{setRestaurantNotice('Order item added. Ticket total recalculated automatically.');await openOrderItems(selectedOrder);await ctx.refresh();}
  setRestaurantSaving(false);
 };
 const count=(...s:string[])=>ctx.rows.filter(r=>s.includes(r.status)).length;
 const count=(...s:string[])=>ctx.rows.filter(r=>s.includes(r.status)).length;
 const queue=ctx.rows.filter(r=>['new','accepted','preparing'].includes(r.status));
 const lanes=[{name:'New tickets',states:['new'],next:'accepted'},{name:'Accepted',states:['accepted'],next:'preparing'},{name:'Kitchen',states:['preparing'],next:'ready'},{name:'Ready to serve',states:['ready'],next:'served'},{name:'Served',states:['served'],next:'completed'}];
 return <Shell eyebrow="Restaurant service" heading="Restaurant & café operations" description="Run the order counter, kitchen preparation queue, table service and takeaway dispatch." icon={<Utensils className="h-4 w-4"/>} ctx={ctx}>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Open tickets" value={String(queue.length)} hint="New, accepted or preparing"/><Metric label="In kitchen" value={String(count('preparing'))} hint="Being prepared now"/><Metric label="Ready to serve" value={String(count('ready'))} hint="Awaiting collection or service"/><Metric label="Completed today" value={String(ctx.rows.filter(r=>['completed','served'].includes(r.status)&&String(r.ordered_at).slice(0,10)===new Date().toISOString().slice(0,10)).length)} hint="Served / completed tickets"/></div>
  {restaurantError&&<div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{restaurantError}</div>}
  {restaurantNotice&&<div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{restaurantNotice}</div>}
  <section className="grid gap-3 xl:grid-cols-2">
   <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold">Menu catalogue</h2><p className="mt-1 text-xs text-slate-500">Prices and kitchen preparation stations.</p></div><span className="text-xs text-slate-500">{menuItems.length} items</span></div>
    <form onSubmit={e=>void addMenuItem(e)} className="mt-3 grid gap-2 sm:grid-cols-3">
     <input required value={menuName} onChange={e=>setMenuName(e.target.value)} placeholder="Menu item name" className={cls}/>
     <input required type="number" min="0" step="0.01" value={menuPrice} onChange={e=>setMenuPrice(e.target.value)} placeholder="Price" className={cls}/>
     <select value={menuStation} onChange={e=>setMenuStation(e.target.value)} className={cls}><option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="dessert">Dessert</option><option value="other">Other</option></select>
     <button disabled={restaurantSaving} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white sm:col-span-3">Add menu item</button>
    </form>
    <div className="mt-3 divide-y divide-slate-100">{menuItems.map(item=><div key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="font-medium">{item.name}<small className="ml-2 text-slate-500">{titleCase(item.prep_station)}</small></span><b>{money(item.price,ctx.currency)}</b></div>)}{!menuItems.length&&<p className="py-4 text-xs text-slate-500">Add your first menu item to begin building itemised tickets.</p>}</div>
   </div>
   <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold">Dining tables</h2><p className="mt-1 text-xs text-slate-500">Track table capacity and live occupancy.</p></div><span className="text-xs text-slate-500">{tables.length} tables</span></div>
    <form onSubmit={e=>void addDiningTable(e)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_100px_auto]">
     <input required value={tableNumber} onChange={e=>setTableNumber(e.target.value)} placeholder="Table number / name" className={cls}/>
     <input required type="number" min="1" step="1" value={tableSeats} onChange={e=>setTableSeats(e.target.value)} aria-label="Seats" className={cls}/>
     <button disabled={restaurantSaving} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">Add table</button>
    </form>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{tables.map(table=><div key={table.id} className="rounded-lg border border-slate-200 p-3"><b className="text-xs">{table.table_number}</b><p className="mt-1 text-[10px] text-slate-500">{table.seats} seats · {titleCase(table.status)}</p></div>)}{!tables.length&&<p className="col-span-full py-4 text-xs text-slate-500">Add dining tables to track dine-in service.</p>}</div>
   </div>
  </section>
  {selectedOrder&&<section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
   <div className="flex items-center justify-between"><div><h2 className="font-semibold">Ticket #{selectedOrder.order_number} items</h2><p className="mt-1 text-xs text-slate-500">Itemised lines update the order total on the database automatically.</p></div><button onClick={()=>setSelectedOrder(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs">Close</button></div>
   <form onSubmit={e=>void addOrderItem(e)} className="mt-3 grid gap-2 sm:grid-cols-4">
    <select required value={selectedMenuItem} onChange={e=>setSelectedMenuItem(e.target.value)} className={cls}><option value="">Choose menu item</option>{menuItems.filter(i=>i.is_available).map(i=><option key={i.id} value={i.id}>{i.name} · {money(i.price,ctx.currency)}</option>)}</select>
    <input required type="number" min="0.001" step="0.001" value={itemQuantity} onChange={e=>setItemQuantity(e.target.value)} className={cls}/>
    <input value={itemModifiers} onChange={e=>setItemModifiers(e.target.value)} placeholder="Modifiers / notes" className={cls}/>
    <button disabled={restaurantSaving||!menuItems.length} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">Add to ticket</button>
   </form>
   <div className="mt-3 divide-y divide-slate-100">{orderItems.map(item=><div key={item.id} className="flex justify-between py-2 text-xs"><span>{item.quantity} × {item.item_name} {item.modifiers&&<small className="text-slate-500"> · {item.modifiers}</small>}</span><b>{money(item.line_total,ctx.currency)}</b></div>)}</div>
  </section>}
  <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Service counter</h2><p className="mt-1 text-xs text-slate-500">Create dine-in, takeaway and delivery tickets.</p></div><button onClick={()=>ctx.setForm(!ctx.form)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> New order</button></div>{ctx.form&&<RecordForm ctx={ctx} onClose={()=>ctx.setForm(false)} submitLabel="Send to kitchen"/>}</section>
  <section className="grid gap-3 xl:grid-cols-4">{lanes.map(l=><div key={l.name} className="min-h-44 rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{l.name}</h3><span className="rounded-full bg-white px-2 py-1 text-xs">{ctx.rows.filter(r=>l.states.includes(r.status)).length}</span></div>{ctx.rows.filter(r=>l.states.includes(r.status)).map(r=><article key={r.id} className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><div className="flex justify-between gap-2"><b className="text-xs">#{r.order_number}</b><span className="text-[10px] text-slate-500">{titleCase(r.order_type)}</span></div><p className="mt-2 text-xs text-slate-700">{r.items_summary}</p><p className="mt-2 text-[10px] text-slate-500">{r.table_label||r.customer_name||'Counter order'} · {money(r.total_amount,ctx.currency)}</p><button disabled={!ctx.canManage||ctx.saving} onClick={()=>void ctx.changeStatus(r,l.next)} className="mt-3 w-full rounded-md bg-slate-900 px-2 py-2 text-[10px] font-semibold text-white">{l.next==='served'?'Mark served':'Move to '+titleCase(l.next)}</button></article>)}</div>)}</section>
  <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><div className="p-4"><h3 className="font-semibold">All orders</h3><p className="mt-1 text-xs text-slate-500">Recent order history and ticket totals.</p></div><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Order','Type','Customer / table','Items','Total','Status','Ticket items'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{ctx.rows.map(r=><tr key={r.id}><td className="px-4 py-3 font-semibold">{r.order_number}</td><td className="px-4 py-3">{titleCase(r.order_type)}</td><td className="px-4 py-3">{r.customer_name||r.table_label||'—'}</td><td className="max-w-56 truncate px-4 py-3">{r.items_summary}</td><td className="px-4 py-3">{money(r.total_amount,ctx.currency)}</td><td className="px-4 py-3">{titleCase(r.status)}</td><td className="px-4 py-3"><button onClick={()=>void openOrderItems(r)} className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-1 text-[10px] font-semibold">Add / view items</button></td></tr>)}</tbody></table>{!ctx.rows.length&&<p className="p-8 text-center text-xs text-slate-500">No orders yet.</p>}</section>
 </Shell>;
}

export function LogisticsWorkspaceView() {
 const ctx=useBoard('delivery_jobs','created_at',logisticsFields,{status:'pending'});
 const n=(...s:string[])=>ctx.rows.filter(r=>s.includes(r.status)).length;
 const active=ctx.rows.filter(r=>['assigned','in_transit'].includes(r.status));
 return <Shell eyebrow="Fleet dispatch" heading="Logistics control tower" description="Coordinate consignments from pickup through dispatch, live delivery progress and proof of delivery." icon={<Truck className="h-4 w-4"/>} ctx={ctx}>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Awaiting assignment" value={String(n('pending'))} hint="Ready for dispatch allocation"/><Metric label="On the road" value={String(n('in_transit'))} hint="Currently in transit"/><Metric label="Delivered" value={String(n('delivered'))} hint="Completed consignments"/><Metric label="Exceptions" value={String(n('failed','returned'))} hint="Require operations follow-up"/></div>
  <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Dispatch manifest</h2><p className="mt-1 text-xs text-slate-500">Register a consignment and follow its delivery milestones.</p></div><button onClick={()=>ctx.setForm(!ctx.form)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> Create consignment</button></div>{ctx.form&&<RecordForm ctx={ctx} onClose={()=>ctx.setForm(false)} submitLabel="Create dispatch"/>}
   {ctx.loading?<p className="p-10 text-center text-xs text-slate-500">Loading dispatch manifest…</p>:<div className="divide-y divide-slate-100">{ctx.rows.map(r=><article key={r.id} className="grid gap-3 p-4 md:grid-cols-[1fr_1.2fr_auto] md:items-center"><div><p className="text-sm font-semibold">{r.tracking_number}</p><p className="mt-1 text-xs text-slate-500">{r.recipient_name} · {r.recipient_phone||'No phone'}</p></div><div className="flex items-center gap-2 text-xs"><span className="max-w-[42%] truncate rounded-md bg-slate-100 px-2 py-1">{r.origin}</span><ArrowUpRight className="h-3 w-3 shrink-0"/><span className="max-w-[42%] truncate rounded-md bg-slate-100 px-2 py-1">{r.destination}</span></div><div className="flex flex-wrap items-center gap-2"><StatusSelect row={r} ctx={ctx} options={r.status==='pending'?['assigned','failed']:r.status==='assigned'?['in_transit','failed']:r.status==='in_transit'?['delivered','failed','returned']:r.status==='failed'?['pending']:[]}/>{r.proof_of_delivery_url&&<a className="text-[10px] font-semibold text-blue-700" href={r.proof_of_delivery_url} target="_blank" rel="noreferrer">Proof</a>}</div></article>)}</div>}
  </section>
  <section className="grid gap-3 lg:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Active fleet movement</h3><p className="mt-1 text-xs text-slate-500">Jobs assigned or currently travelling.</p>{active.map(r=><div key={r.id} className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs"><span>{r.tracking_number}<small className="block text-slate-500">{r.origin} → {r.destination}</small></span><b>{titleCase(r.status)}</b></div>)}{!active.length&&<p className="mt-4 text-xs text-slate-500">No active deliveries.</p>}</div><div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Delivery exceptions</h3><p className="mt-1 text-xs text-slate-500">Failed and returned consignments to review.</p>{ctx.rows.filter(r=>['failed','returned'].includes(r.status)).map(r=><div key={r.id} className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs"><span>{r.tracking_number}<small className="block text-slate-500">{r.recipient_name}</small></span><b>{titleCase(r.status)}</b></div>)}{!ctx.rows.some(r=>['failed','returned'].includes(r.status))&&<p className="mt-4 text-xs text-slate-500">No delivery exceptions.</p>}</div></section>
 </Shell>;
}

export function ManufacturingWorkspaceView() {
 const ctx=useBoard('manufacturing_orders','created_at',productionFields,{completed_quantity:0,status:'planned'});
 const n=(...s:string[])=>ctx.rows.filter(r=>s.includes(r.status)).length;
 const totalPlanned=ctx.rows.reduce((v,r)=>v+Number(r.planned_quantity||0),0);
 const totalDone=ctx.rows.reduce((v,r)=>v+Number(r.completed_quantity||0),0);
 const active=ctx.rows.filter(r=>['released','in_progress','quality_check'].includes(r.status));
 return <Shell eyebrow="Production floor" heading="Manufacturing operations" description="Plan production runs, release work orders, track output, perform quality checks and close completed batches." icon={<Factory className="h-4 w-4"/>} ctx={ctx}>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active work orders" value={String(active.length)} hint="Released, in progress or QA"/><Metric label="Planned output" value={totalPlanned.toLocaleString()} hint="Units across recent orders"/><Metric label="Completed output" value={totalDone.toLocaleString()} hint="Reported completed units"/><Metric label="Awaiting quality" value={String(n('quality_check'))} hint="Requires inspection approval"/></div>
  <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Production work orders</h2><p className="mt-1 text-xs text-slate-500">Batch planning, work-in-progress and output reporting.</p></div><button onClick={()=>ctx.setForm(!ctx.form)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> New work order</button></div>{ctx.form&&<RecordForm ctx={ctx} onClose={()=>ctx.setForm(false)} submitLabel="Release work order"/>}
   {ctx.loading?<p className="p-10 text-center text-xs text-slate-500">Loading production plan…</p>:<div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Work order','Product','Planned','Completed','Progress','Due date','Production stage'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{ctx.rows.map(r=>{const pct=Number(r.planned_quantity)>0?Math.min(100,Math.round(Number(r.completed_quantity||0)/Number(r.planned_quantity)*100)):0;return <tr key={r.id}><td className="px-4 py-3 font-semibold">{r.order_number}</td><td className="px-4 py-3">{r.product_name}</td><td className="px-4 py-3">{Number(r.planned_quantity).toLocaleString()}</td><td className="px-4 py-3"><input aria-label={'Completed quantity for '+r.order_number} type="number" min="0" max={r.planned_quantity} step="0.001" defaultValue={r.completed_quantity||0} disabled={!ctx.canManage||ctx.saving||['completed','cancelled'].includes(r.status)} onBlur={e=>{const value=Number(e.currentTarget.value);if(value>=0&&value<=Number(r.planned_quantity)&&value!==Number(r.completed_quantity||0))void ctx.updateField(r,'completed_quantity',value);}} className="w-24 rounded-md border border-slate-200 px-2 py-1"/></td><td className="min-w-32 px-4 py-3"><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{width:pct+'%'}}/></div><span className="text-[10px] text-slate-500">{pct}%</span></td><td className="whitespace-nowrap px-4 py-3">{dateText(r.due_date)}</td><td className="px-4 py-3"><StatusSelect row={r} ctx={ctx} options={r.status==='planned'?['released','cancelled']:r.status==='released'?['in_progress','cancelled']:r.status==='in_progress'?['quality_check','cancelled']:r.status==='quality_check'?['completed','in_progress']:[]}/></td></tr>})}</tbody></table>{!ctx.rows.length&&<p className="p-10 text-center text-xs text-slate-500">No production work orders yet.</p>}</div>}
  </section>
  <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-blue-700"/><h3 className="font-semibold">Quality control queue</h3></div><p className="mt-1 text-xs text-slate-500">Work orders awaiting quality review before completion.</p>{ctx.rows.filter(r=>r.status==='quality_check').map(r=><div key={r.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs"><span><b>{r.order_number} · {r.product_name}</b><small className="block text-slate-500">{r.completed_quantity} of {r.planned_quantity} units reported</small></span><button disabled={!ctx.canManage||ctx.saving} onClick={()=>void ctx.changeStatus(r,'completed')} className="rounded-md bg-emerald-700 px-3 py-2 text-[10px] font-semibold text-white">Approve & complete</button></div>)}{!ctx.rows.some(r=>r.status==='quality_check')&&<p className="mt-4 text-xs text-slate-500">No batches waiting for quality inspection.</p>}</section>
 </Shell>;
}

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, CheckCircle2, ClipboardCheck, Factory, Home, Loader2, Plus, RefreshCw, Truck, Utensils } from 'lucide-react';
import { getSupabaseClient } from '../../core/supabase/client';
import { useAuth } from '../../core/auth/AuthContext';

type RowRecord = Record<string, any>;
type Field = { name: string; label: string; type?: string; required?: boolean; options?: (string | { value: string; label: string })[]; wide?: boolean; min?: string; step?: string };

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
    if (fd.has('table_id')) payload.table_id = String(fd.get('table_id') ?? '') || null;
    if (fd.has('covers')) payload.covers = Number(fd.get('covers') ?? 1);
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

function RecordForm({ ctx, onClose, submitLabel, extraFields = [] }: { ctx: BoardContext; onClose: () => void; submitLabel: string; extraFields?: Field[] }) {
  return <form onSubmit={ctx.create} className="grid gap-3 border-b border-blue-100 bg-blue-50/40 p-4 sm:grid-cols-2 xl:grid-cols-3">
    {[...ctx.fields, ...extraFields].map(f => <label key={f.name} className={label + (f.wide ? ' sm:col-span-2 xl:col-span-3' : '')}>
      {f.label}{f.required ? ' *' : ''}
      {f.options ? <select name={f.name} required={f.required} defaultValue="" className={cls}><option value="">Select…</option>{f.options.map(o => <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>{typeof o === 'string' ? titleCase(o) : o.label}</option>)}</select>
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
 {name:'items_summary',label:'Order notes / initial summary',type:'textarea',wide:true},{name:'notes',label:'Allergies / service notes',type:'textarea',wide:true}
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
 const ctx=useBoard('restaurant_orders','ordered_at',restaurantFields,{order_type:'dine_in',items_summary:'Itemised order',total_amount:0,status:'new'});
 const { activeOrganisation, activeRole } = useAuth();
 const db = getSupabaseClient() as any;
 const [menuItems,setMenuItems]=useState<RowRecord[]>([]);
 const [menuCategories,setMenuCategories]=useState<RowRecord[]>([]);
 const [tables,setTables]=useState<RowRecord[]>([]);
 const [paymentAccounts,setPaymentAccounts]=useState<RowRecord[]>([]);
 const [inventoryVariants,setInventoryVariants]=useState<RowRecord[]>([]);
 const [inventoryProducts,setInventoryProducts]=useState<RowRecord[]>([]);
 const [inventoryLocations,setInventoryLocations]=useState<RowRecord[]>([]);
 const [recipeIngredients,setRecipeIngredients]=useState<RowRecord[]>([]);
 const [recipeMenuItemId,setRecipeMenuItemId]=useState<string|null>(null);
 const [recipeVariantId,setRecipeVariantId]=useState('');
 const [recipeLocationId,setRecipeLocationId]=useState('');
 const [recipeQuantity,setRecipeQuantity]=useState('1');
 const [orderPayments,setOrderPayments]=useState<RowRecord[]>([]);
 const [paymentAmount,setPaymentAmount]=useState('');
 const [paymentAccountId,setPaymentAccountId]=useState('');
 const [paymentReference,setPaymentReference]=useState('');
 const [paymentNotes,setPaymentNotes]=useState('');
 const [menuName,setMenuName]=useState('');
 const [menuPrice,setMenuPrice]=useState('');
 const [menuStation,setMenuStation]=useState('kitchen');
 const [menuCategoryId,setMenuCategoryId]=useState('');
 const [categoryName,setCategoryName]=useState('');
 const [orderType,setOrderType]=useState('dine_in');
 const [orderTableId,setOrderTableId]=useState('');
 const [orderCovers,setOrderCovers]=useState('1');
 const [orderCustomer,setOrderCustomer]=useState('');
 const [orderNotes,setOrderNotes]=useState('');
 const [orderCart,setOrderCart]=useState<{menu_item_id:string;quantity:string;modifiers:string}[]>([{menu_item_id:'',quantity:'1',modifiers:''}]);
 const [showOrderForm,setShowOrderForm]=useState(false);
 const canManageRestaurant=['owner','admin','manager'].includes(activeRole??'');
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
  if(!db||!activeOrganisation){setMenuItems([]);setMenuCategories([]);setTables([]);setPaymentAccounts([]);setInventoryVariants([]);setInventoryProducts([]);setInventoryLocations([]);setRecipeIngredients([]);return;}
  const [menuResult,categoryResult,tableResult,variantResult,productResult,locationResult]=await Promise.all([
   db.from('restaurant_menu_items').select('*').eq('organization_id',activeOrganisation.id).order('name'),
   db.from('restaurant_menu_categories').select('*').eq('organization_id',activeOrganisation.id).order('sort_order'),
   db.from('restaurant_tables').select('*').eq('organization_id',activeOrganisation.id).order('table_number'),
   db.from('product_variants').select('id,product_id,variant_name,sku,unit_of_measure,is_active').eq('organization_id',activeOrganisation.id).eq('is_active',true).order('sku'),
   db.from('products').select('id,name,product_type,is_active').eq('organization_id',activeOrganisation.id).eq('is_active',true).eq('product_type','physical').order('name'),
   db.from('inventory_locations').select('id,name,location_type').eq('organization_id',activeOrganisation.id).eq('is_active',true).order('name')
  ]);
  if(menuResult.error||categoryResult.error||tableResult.error||variantResult.error||productResult.error||locationResult.error){setRestaurantError(menuResult.error?.message||categoryResult.error?.message||tableResult.error?.message||variantResult.error?.message||productResult.error?.message||locationResult.error?.message||'Could not load restaurant setup.');return;}
  setMenuItems(menuResult.data??[]);setMenuCategories(categoryResult.data??[]);setTables(tableResult.data??[]);
  setInventoryVariants(variantResult.data??[]);setInventoryProducts(productResult.data??[]);setInventoryLocations(locationResult.data??[]);
  const {data:accounts,error:accountsError}=await db.rpc('restaurant_get_payment_accounts',{p_organization_id:activeOrganisation.id});
  if(accountsError){setPaymentAccounts([]);setRestaurantError(accountsError.message);}else{setPaymentAccounts(accounts??[]);setPaymentAccountId(current=>current||accounts?.[0]?.id||'');setRestaurantError(null);}
 },[db,activeOrganisation?.id]);
 useEffect(()=>{void refreshRestaurantSetup();},[refreshRestaurantSetup]);
 const refreshRecipeIngredients=async(menuItemId:string)=>{
  if(!db||!activeOrganisation){setRecipeIngredients([]);return;}
  const {data,error}=await db.from('restaurant_recipe_ingredients').select('*').eq('organization_id',activeOrganisation.id).eq('menu_item_id',menuItemId).order('created_at');
  if(error)setRestaurantError(error.message);else setRecipeIngredients(data??[]);
 };
 const openRecipeEditor=async(menuItemId:string)=>{
  if(!canManageRestaurant)return;setRecipeMenuItemId(menuItemId);setRecipeVariantId('');setRecipeLocationId(inventoryLocations[0]?.id??'');setRecipeQuantity('1');await refreshRecipeIngredients(menuItemId);
 };
 const addRecipeIngredient=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!recipeMenuItemId||!canManageRestaurant)return;
  if(!recipeVariantId||!recipeLocationId||Number(recipeQuantity)<=0){setRestaurantError('Choose a stock item, location and positive quantity per serving.');return;}
  setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_recipe_ingredients').insert({
   organization_id:activeOrganisation.id,menu_item_id:recipeMenuItemId,variant_id:recipeVariantId,
   location_id:recipeLocationId,quantity_per_serving:Number(recipeQuantity)
  });
  if(error)setRestaurantError(error.code==='23505'?'That stock item is already linked to this recipe.':error.message);
  else{setRestaurantNotice('Recipe ingredient saved. Stock will be deducted when the ticket is completed.');await refreshRecipeIngredients(recipeMenuItemId);}
  setRestaurantSaving(false);
 };
 const removeRecipeIngredient=async(id:string)=>{
  if(!db||!activeOrganisation||!canManageRestaurant)return;setRestaurantSaving(true);setRestaurantError(null);
  const {error}=await db.from('restaurant_recipe_ingredients').delete().eq('id',id).eq('organization_id',activeOrganisation.id);
  if(error)setRestaurantError(error.message);else if(recipeMenuItemId)await refreshRecipeIngredients(recipeMenuItemId);
  setRestaurantSaving(false);
 };
 const addMenuItem=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!canManageRestaurant)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_menu_items').insert({organization_id:activeOrganisation.id,category_id:menuCategoryId||null,name:menuName.trim(),price:Number(menuPrice),prep_station:menuStation,is_available:true});
  if(error)setRestaurantError(error.message);else{setMenuName('');setMenuPrice('');setMenuCategoryId('');setRestaurantNotice('Menu item saved.');await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const addMenuCategory=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!canManageRestaurant)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_menu_categories').insert({organization_id:activeOrganisation.id,name:categoryName.trim(),sort_order:menuCategories.length});
  if(error)setRestaurantError(error.code==='23505'?'That menu category already exists.':error.message);
  else{setCategoryName('');setRestaurantNotice('Menu category saved.');await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const toggleMenuAvailability=async(item:RowRecord)=>{
  if(!db||!activeOrganisation||!canManageRestaurant)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_menu_items').update({is_available:!item.is_available}).eq('id',item.id).eq('organization_id',activeOrganisation.id);
  if(error)setRestaurantError(error.message);else{setRestaurantNotice('Menu availability updated.');await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const createRestaurantOrder=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation)return;
  const items=orderCart.filter(line=>line.menu_item_id&&Number(line.quantity)>0);
  if(!items.length){setRestaurantError('Add at least one available menu item to the order.');return;}
  setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {data,error}=await db.rpc('restaurant_create_order_with_items',{
   p_organization_id:activeOrganisation.id,p_order_type:orderType,
   p_table_id:orderType==='dine_in'?(orderTableId||null):null,p_covers:Number(orderCovers)||1,
   p_customer_name:orderCustomer.trim()||null,p_notes:orderNotes.trim()||null,
   p_items:items.map(line=>({menu_item_id:line.menu_item_id,quantity:Number(line.quantity),modifiers:line.modifiers.trim()||null}))
  });
  if(error)setRestaurantError('Order could not be sent to the kitchen: '+error.message);
  else{setRestaurantNotice('Itemised order created and sent to the kitchen.');setShowOrderForm(false);setOrderCart([{menu_item_id:'',quantity:'1',modifiers:''}]);setOrderTableId('');setOrderCustomer('');setOrderNotes('');setOrderCovers('1');await ctx.refresh();await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const addDiningTable=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!canManageRestaurant)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.from('restaurant_tables').insert({organization_id:activeOrganisation.id,table_number:tableNumber.trim(),seats:Number(tableSeats)});
  if(error)setRestaurantError(error.code==='23505'?'That table number already exists.':error.message);else{setTableNumber('');setRestaurantNotice('Dining table added.');await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const openOrderItems=async(order:RowRecord)=>{
  setSelectedOrder(order);setRestaurantError(null);setRestaurantNotice(null);setSelectedMenuItem('');setItemQuantity('1');setItemModifiers('');
  const [{data,error},{data:payments,error:paymentsError}]=await Promise.all([
   db.from('restaurant_order_items').select('*').eq('organization_id',activeOrganisation?.id).eq('order_id',order.id).order('created_at'),
   db.from('restaurant_order_payments').select('id,amount,reference,paid_at,financial_account_id,received_by').eq('organization_id',activeOrganisation?.id).eq('order_id',order.id).order('paid_at')
  ]);
  if(error||paymentsError){setRestaurantError(error?.message||paymentsError?.message||'Could not load ticket details.');setOrderItems([]);setOrderPayments([]);}
  else{setOrderItems(data??[]);setOrderPayments(payments??[]);setPaymentAmount('');setPaymentAccountId('');setPaymentReference('');setPaymentNotes('');}
 };
 const addOrderItem=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!selectedOrder)return;
  if(['completed','cancelled'].includes(selectedOrder.status)){setRestaurantError('This ticket is closed and can no longer be changed.');return;}
  const item=menuItems.find(x=>x.id===selectedMenuItem);if(!item)return;
  if(!item.is_available){setRestaurantError('That menu item is no longer available.');return;}
  setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.rpc('restaurant_add_order_item',{p_organization_id:activeOrganisation.id,p_order_id:selectedOrder.id,p_menu_item_id:item.id,p_quantity:Number(itemQuantity),p_modifiers:itemModifiers.trim()||null,p_notes:null});
  if(error)setRestaurantError(error.message);else{setRestaurantNotice('Order item added. Ticket total recalculated automatically.');await openOrderItems(selectedOrder);await ctx.refresh();}
  setRestaurantSaving(false);
 };
 const recordRestaurantPayment=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();if(!db||!activeOrganisation||!selectedOrder)return;
  if(!paymentAccountId){setRestaurantError('Select the cash, bank or wallet account that received this payment.');return;}
  const amount=Number(paymentAmount);
  if(!Number.isFinite(amount)||amount<=0){setRestaurantError('Enter a valid payment amount.');return;}
  setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  const {error}=await db.rpc('restaurant_record_payment',{
   p_organization_id:activeOrganisation.id,p_order_id:selectedOrder.id,p_financial_account_id:paymentAccountId,
   p_amount:amount,p_reference:paymentReference.trim()||null,p_notes:paymentNotes.trim()||null,p_idempotency_key:crypto.randomUUID()
  });
  if(error)setRestaurantError('Payment could not be recorded: '+error.message);
  else{setRestaurantNotice('Payment recorded and posted to the finance ledger.');await openOrderItems(selectedOrder);await ctx.refresh();}
  setRestaurantSaving(false);
 };
 const advanceOrderStatus=async(row:RowRecord,status:string)=>{
  if(!db||!activeOrganisation)return;setRestaurantSaving(true);setRestaurantError(null);setRestaurantNotice(null);
  let error: any=null;
  if(status==='completed'){
   const result=await db.rpc('restaurant_complete_order',{p_organization_id:activeOrganisation.id,p_order_id:row.id});
   error=result.error;
  }else{
   const result=await db.from('restaurant_orders').update({status}).eq('id',row.id).eq('organization_id',activeOrganisation.id).select('id').maybeSingle();
   error=result.error;
   if(!error&&!result.data)error=new Error('Kitchen ticket was not updated. Check staff access.');
  }
  if(error)setRestaurantError('Kitchen status could not be updated: '+error.message);
  else{setRestaurantNotice('Kitchen ticket updated.');await ctx.refresh();await refreshRestaurantSetup();}
  setRestaurantSaving(false);
 };
 const count=(...s:string[])=>ctx.rows.filter(r=>s.includes(r.status)).length;
 const queue=ctx.rows.filter(r=>['new','accepted','preparing'].includes(r.status));
 const lanes=[{name:'New tickets',states:['new'],next:'accepted'},{name:'Accepted',states:['accepted'],next:'preparing'},{name:'Kitchen',states:['preparing'],next:'ready'},{name:'Ready to serve',states:['ready'],next:'served'},{name:'Served',states:['served'],next:'completed'}];
 return <Shell eyebrow="Restaurant service" heading="Restaurant & café operations" description="Run the order counter, kitchen preparation queue, table service and takeaway dispatch." icon={<Utensils className="h-4 w-4"/>} ctx={ctx}>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Open tickets" value={String(queue.length)} hint="New, accepted or preparing"/><Metric label="In kitchen" value={String(count('preparing'))} hint="Being prepared now"/><Metric label="Ready to serve" value={String(count('ready'))} hint="Awaiting collection or service"/><Metric label="Completed today" value={String(ctx.rows.filter(r=>['completed','served'].includes(r.status)&&String(r.ordered_at).slice(0,10)===new Date().toISOString().slice(0,10)).length)} hint="Served / completed tickets"/></div>
  {restaurantError&&<div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{restaurantError}</div>}
  {restaurantNotice&&<div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{restaurantNotice}</div>}
  <section className="grid gap-3 xl:grid-cols-2">
   <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold">Menu catalogue</h2><p className="mt-1 text-xs text-slate-500">Menu categories, prices and preparation stations.</p></div><span className="text-xs text-slate-500">{menuItems.length} items</span></div>
    {canManageRestaurant&&<form onSubmit={e=>void addMenuCategory(e)} className="mt-3 flex gap-2"><input required value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="New menu category" className={cls}/><button disabled={restaurantSaving} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Add category</button></form>}
    {canManageRestaurant&&<form onSubmit={e=>void addMenuItem(e)} className="mt-3 grid gap-2 sm:grid-cols-2">
     <input required value={menuName} onChange={e=>setMenuName(e.target.value)} placeholder="Menu item name" className={cls}/>
     <input required type="number" min="0" step="0.01" value={menuPrice} onChange={e=>setMenuPrice(e.target.value)} placeholder="Selling price" className={cls}/>
     <select value={menuCategoryId} onChange={e=>setMenuCategoryId(e.target.value)} className={cls}><option value="">No category</option>{menuCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
     <select value={menuStation} onChange={e=>setMenuStation(e.target.value)} className={cls}><option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="dessert">Dessert</option><option value="other">Other</option></select>
     <button disabled={restaurantSaving} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white sm:col-span-2">Add menu item</button>
    </form>}
    <div className="mt-3 divide-y divide-slate-100">{menuItems.map(item=><div key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0"><b>{item.name}</b><small className="ml-2 text-slate-500">{titleCase(item.prep_station)}{item.category_id&&menuCategories.find(c=>c.id===item.category_id)?' · '+menuCategories.find(c=>c.id===item.category_id)?.name:''}</small><small className="ml-2 text-slate-500">{item.is_available?'Available':'Unavailable'}</small></span><div className="flex items-center gap-2"><b>{money(item.price,ctx.currency)}</b>{canManageRestaurant&&<><button disabled={restaurantSaving} onClick={()=>void openRecipeEditor(item.id)} className="rounded-md border border-slate-300 px-2 py-1 text-[10px]">Recipe</button><button disabled={restaurantSaving} onClick={()=>void toggleMenuAvailability(item)} className="rounded-md border border-slate-300 px-2 py-1 text-[10px]">{item.is_available?'Disable':'Enable'}</button></>}</div></div>)}{!menuItems.length&&<p className="py-4 text-xs text-slate-500">Add your first menu item to begin building itemised tickets.</p>}</div>
   </div>
   <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold">Dining tables</h2><p className="mt-1 text-xs text-slate-500">Track table capacity and live occupancy.</p></div><span className="text-xs text-slate-500">{tables.length} tables</span></div>
    {canManageRestaurant&&<form onSubmit={e=>void addDiningTable(e)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_100px_auto]">
     <input required value={tableNumber} onChange={e=>setTableNumber(e.target.value)} placeholder="Table number / name" className={cls}/>
     <input required type="number" min="1" step="1" value={tableSeats} onChange={e=>setTableSeats(e.target.value)} aria-label="Seats" className={cls}/>
     <button disabled={restaurantSaving} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">Add table</button>
    </form>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{tables.map(table=><div key={table.id} className="rounded-lg border border-slate-200 p-3"><b className="text-xs">{table.table_number}</b><p className="mt-1 text-[10px] text-slate-500">{table.seats} seats · {titleCase(table.status)}</p></div>)}{!tables.length&&<p className="col-span-full py-4 text-xs text-slate-500">Add dining tables to track dine-in service.</p>}</div>
   </div>
  </section>
  {recipeMenuItemId&&<section className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
   <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">Recipe · {menuItems.find(m=>m.id===recipeMenuItemId)?.name}</h2><p className="mt-1 text-xs text-slate-600">Ingredients are deducted from inventory when a paid ticket is completed. Insufficient stock prevents completion.</p></div><button onClick={()=>{setRecipeMenuItemId(null);setRecipeIngredients([]);}} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">Close recipe</button></div>
   <form onSubmit={e=>void addRecipeIngredient(e)} className="mt-3 grid gap-2 sm:grid-cols-[2fr_1.5fr_110px_auto]">
    <select required value={recipeVariantId} onChange={e=>setRecipeVariantId(e.target.value)} className={cls}><option value="">Choose physical stock item</option>{inventoryVariants.filter(v=>inventoryProducts.some(p=>p.id===v.product_id)).map(v=><option key={v.id} value={v.id}>{inventoryProducts.find(p=>p.id===v.product_id)?.name} · {v.variant_name} · {v.sku}</option>)}</select>
    <select required value={recipeLocationId} onChange={e=>setRecipeLocationId(e.target.value)} className={cls}><option value="">Choose stock location</option>{inventoryLocations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
    <input required type="number" min="0.0001" step="0.0001" value={recipeQuantity} onChange={e=>setRecipeQuantity(e.target.value)} placeholder="Qty / serving" className={cls}/>
    <button disabled={restaurantSaving||!inventoryVariants.length||!inventoryLocations.length} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Add ingredient</button>
   </form>
   <div className="mt-3 divide-y divide-emerald-100">{recipeIngredients.map(ri=>{const variant=inventoryVariants.find(v=>v.id===ri.variant_id);const product=inventoryProducts.find(p=>p.id===variant?.product_id);const location=inventoryLocations.find(l=>l.id===ri.location_id);return <div key={ri.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span><b>{product?.name??'Stock item'} · {variant?.variant_name??''}</b><small className="ml-2 text-slate-500">{ri.quantity_per_serving} {variant?.unit_of_measure??'units'} / serving · {location?.name??'Location'}</small></span><button disabled={restaurantSaving} onClick={()=>void removeRecipeIngredient(ri.id)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px]">Remove</button></div>})}{!recipeIngredients.length&&<p className="py-3 text-xs text-slate-500">No ingredients linked yet. This menu item will not deduct stock until you add recipe ingredients.</p>}</div>
   {(!inventoryVariants.length||!inventoryLocations.length)&&<p className="mt-2 text-[11px] text-amber-700">Add active physical products and at least one active inventory location before configuring recipes.</p>}
  </section>}
  {selectedOrder&&<section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4">
   <div className="flex items-center justify-between"><div><h2 className="font-semibold">Ticket #{selectedOrder.order_number} items</h2><p className="mt-1 text-xs text-slate-500">Itemised lines update the order total on the database automatically.</p></div><button onClick={()=>setSelectedOrder(null)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs">Close</button></div>
   <form onSubmit={e=>void addOrderItem(e)} className="mt-3 grid gap-2 sm:grid-cols-4">
    <select required value={selectedMenuItem} onChange={e=>setSelectedMenuItem(e.target.value)} className={cls}><option value="">Choose menu item</option>{menuItems.filter(i=>i.is_available).map(i=><option key={i.id} value={i.id}>{i.name} · {money(i.price,ctx.currency)}</option>)}</select>
    <input required type="number" min="0.001" step="0.001" value={itemQuantity} onChange={e=>setItemQuantity(e.target.value)} className={cls}/>
    <input value={itemModifiers} onChange={e=>setItemModifiers(e.target.value)} placeholder="Modifiers / notes" className={cls}/>
    <button disabled={restaurantSaving||!menuItems.length} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">Add to ticket</button>
   </form>
   <div className="mt-3 divide-y divide-slate-100">{orderItems.map(item=><div key={item.id} className="flex justify-between py-2 text-xs"><span>{item.quantity} × {item.item_name} {item.modifiers&&<small className="text-slate-500"> · {item.modifiers}</small>}</span><b>{money(item.line_total,ctx.currency)}</b></div>)}</div>
   <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold">Payments & balance</h3><p className="text-xs">Paid <b>{money(orderPayments.reduce((sum,p)=>sum+Number(p.amount||0),0),ctx.currency)}</b> · Due <b>{money(Math.max(Number(selectedOrder.total_amount||0)-orderPayments.reduce((sum,p)=>sum+Number(p.amount||0),0),0),ctx.currency)}</b></p></div>
    <div className="mt-2 divide-y divide-slate-100">{orderPayments.map(p=><div key={p.id} className="flex justify-between py-1.5 text-[11px]"><span>{p.reference} · {new Date(p.paid_at).toLocaleString()}</span><b>{money(p.amount,ctx.currency)}</b></div>)}</div>
    {!['completed','cancelled'].includes(selectedOrder.status)&&<form onSubmit={e=>void recordRestaurantPayment(e)} className="mt-3 grid gap-2 sm:grid-cols-2">
     <select required value={paymentAccountId} onChange={e=>setPaymentAccountId(e.target.value)} className={cls}><option value="">Select receiving account</option>{paymentAccounts.map(a=><option key={a.id} value={a.id}>{a.account_name} · {titleCase(a.account_type)}</option>)}</select>
     <input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} placeholder="Amount received" className={cls}/>
     <input value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} placeholder="Payment reference (optional)" className={cls}/>
     <input value={paymentNotes} onChange={e=>setPaymentNotes(e.target.value)} placeholder="Payment note (optional)" className={cls}/>
     <button disabled={restaurantSaving||!paymentAccounts.length} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white sm:col-span-2">{restaurantSaving?'Recording…':'Record payment'}</button>
     {!paymentAccounts.length&&<p className="text-[11px] text-amber-700 sm:col-span-2">No active cash/bank account is configured. The Owner or Manager must add one in Finance before collecting POS payments.</p>}
    </form>}
   </div>
  </section>}
  <section className="rounded-xl border border-slate-200 bg-white">
   <div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Service counter</h2><p className="mt-1 text-xs text-slate-500">Create a complete itemised ticket before it enters the kitchen.</p></div><button onClick={()=>setShowOrderForm(!showOrderForm)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4"/> New order</button></div>
   {showOrderForm&&<form onSubmit={e=>void createRestaurantOrder(e)} className="space-y-3 border-b border-blue-100 bg-blue-50/40 p-4">
    <div className="grid gap-2 sm:grid-cols-4">
     <label className="text-xs font-medium">Order type<select value={orderType} onChange={e=>{setOrderType(e.target.value);if(e.target.value!=='dine_in')setOrderTableId('');}} className={cls}><option value="dine_in">Dine in</option><option value="takeaway">Takeaway</option><option value="delivery">Delivery</option></select></label>
     <label className="text-xs font-medium">Dining table<select disabled={orderType!=='dine_in'} value={orderTableId} onChange={e=>setOrderTableId(e.target.value)} className={cls}><option value="">No table selected</option>{tables.filter(t=>['available','reserved'].includes(t.status)).map(t=><option key={t.id} value={t.id}>{t.table_number} · {t.seats} seats</option>)}</select></label>
     <label className="text-xs font-medium">Guests<input type="number" min="1" step="1" value={orderCovers} onChange={e=>setOrderCovers(e.target.value)} className={cls}/></label>
     <label className="text-xs font-medium">Customer name<input value={orderCustomer} onChange={e=>setOrderCustomer(e.target.value)} className={cls}/></label>
    </div>
    <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Ticket items</h3><button type="button" onClick={()=>setOrderCart(current=>[...current,{menu_item_id:'',quantity:'1',modifiers:''}])} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold">Add item line</button></div>
     {orderCart.map((line,index)=><div key={index} className="grid gap-2 sm:grid-cols-[2fr_100px_1fr_auto]">
      <select required value={line.menu_item_id} onChange={e=>setOrderCart(current=>current.map((x,i)=>i===index?{...x,menu_item_id:e.target.value}:x))} className={cls}><option value="">Choose available menu item</option>{menuItems.filter(i=>i.is_available).map(i=><option key={i.id} value={i.id}>{i.name} · {money(i.price,ctx.currency)}</option>)}</select>
      <input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>setOrderCart(current=>current.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))} className={cls}/>
      <input value={line.modifiers} onChange={e=>setOrderCart(current=>current.map((x,i)=>i===index?{...x,modifiers:e.target.value}:x))} placeholder="Modifiers" className={cls}/>
      <button type="button" disabled={orderCart.length===1} onClick={()=>setOrderCart(current=>current.filter((_,i)=>i!==index))} className="rounded-md border border-slate-300 bg-white px-2 text-xs">Remove</button>
     </div>)}
    </div>
    <label className="block text-xs font-medium">Allergies / service notes<textarea value={orderNotes} onChange={e=>setOrderNotes(e.target.value)} rows={2} className={cls}/></label>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-600">Estimated ticket total: <b>{money(orderCart.reduce((sum,line)=>{const item=menuItems.find(x=>x.id===line.menu_item_id);return sum+(Number(item?.price)||0)*(Number(line.quantity)||0);},0),ctx.currency)}</b></p><button disabled={restaurantSaving||!menuItems.some(i=>i.is_available)} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white">{restaurantSaving?'Sending…':'Send itemised ticket to kitchen'}</button></div>
   </form>}
  </section>
  <section className="grid gap-3 xl:grid-cols-4">{lanes.map(l=><div key={l.name} className="min-h-44 rounded-xl border border-slate-200 bg-slate-50/70 p-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{l.name}</h3><span className="rounded-full bg-white px-2 py-1 text-xs">{ctx.rows.filter(r=>l.states.includes(r.status)).length}</span></div>{ctx.rows.filter(r=>l.states.includes(r.status)).map(r=><article key={r.id} className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><div className="flex justify-between gap-2"><b className="text-xs">#{r.order_number}</b><span className="text-[10px] text-slate-500">{titleCase(r.order_type)}</span></div><p className="mt-2 text-xs text-slate-700">{r.items_summary}</p><p className="mt-2 text-[10px] text-slate-500">{r.table_label||tables.find(t=>t.id===r.table_id)?.table_number||r.customer_name||'Counter order'} · {money(r.total_amount,ctx.currency)}</p><button disabled={!['owner','admin','manager','staff'].includes(activeRole??'')||restaurantSaving} onClick={()=>void advanceOrderStatus(r,l.next)} className="mt-3 w-full rounded-md bg-slate-900 px-2 py-2 text-[10px] font-semibold text-white">{l.next==='served'?'Mark served':'Move to '+titleCase(l.next)}</button></article>)}</div>)}</section>
  <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><div className="p-4"><h3 className="font-semibold">All orders</h3><p className="mt-1 text-xs text-slate-500">Recent order history and ticket totals.</p></div><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Order','Type','Customer / table','Items','Total','Status','Ticket items'].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{ctx.rows.map(r=><tr key={r.id}><td className="px-4 py-3 font-semibold">{r.order_number}</td><td className="px-4 py-3">{titleCase(r.order_type)}</td><td className="px-4 py-3">{r.customer_name||r.table_label||tables.find(t=>t.id===r.table_id)?.table_number||'—'}</td><td className="max-w-56 truncate px-4 py-3">{r.items_summary}</td><td className="px-4 py-3">{money(r.total_amount,ctx.currency)}</td><td className="px-4 py-3">{titleCase(r.status)}</td><td className="px-4 py-3"><button onClick={()=>void openOrderItems(r)} className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-1 text-[10px] font-semibold">Add / view items</button></td></tr>)}</tbody></table>{!ctx.rows.length&&<p className="p-8 text-center text-xs text-slate-500">No orders yet.</p>}</section>
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

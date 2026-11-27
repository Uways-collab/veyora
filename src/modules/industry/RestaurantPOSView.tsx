import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Printer, RefreshCw, ShoppingCart } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getSupabaseClient } from '../../core/supabase/client';

type MenuItem = { id: string; name: string; price: number; prep_station: string; is_available: boolean };
type DiningTable = { id: string; table_number: string; seats: number; status: string };
type Account = { id: string; account_name: string; account_type: string; currency_code: string };
type CartLine = { menu_item_id: string; quantity: number; modifiers: string };
type Order = { id: string; order_number: string; order_type: string; customer_name: string | null; table_id: string | null; table_label: string | null; total_amount: number; status: string; ordered_at: string; notes: string | null };
type Receipt = { order: Order; items: Array<{ item_name: string; quantity: number; unit_price: number; line_total: number; modifiers: string | null }>; payments: Array<{ amount: number; reference: string; paid_at: string }>; };

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500';
const formatMoney = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return amount.toFixed(2) + ' ' + currency; }
};

export function RestaurantPOSView() {
  const { activeOrganisation, activeRole } = useAuth();
  const db = getSupabaseClient() as any;
  const org = activeOrganisation as any;
  const currency = org?.base_currency ?? org?.currency ?? 'NGN';
  const canOperate = ['owner', 'admin', 'manager', 'staff'].includes(activeRole ?? '');
  const canManage = ['owner', 'admin', 'manager'].includes(activeRole ?? '');
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState('dine_in');
  const [tableId, setTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [history, setHistory] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!db || !org?.id) { setLoading(false); return; }
    setLoading(true); setError(null);
    const [menu, tableRows, paymentAccounts, recent] = await Promise.all([
      db.from('restaurant_menu_items').select('id,name,price,prep_station,is_available').eq('organization_id', org.id).eq('is_available', true).order('name'),
      db.from('restaurant_tables').select('id,table_number,seats,status').eq('organization_id', org.id).order('table_number'),
      db.rpc('restaurant_get_payment_accounts', { p_organization_id: org.id }),
      db.from('restaurant_orders').select('id,order_number,order_type,customer_name,table_id,table_label,total_amount,status,ordered_at,notes').eq('organization_id', org.id).order('ordered_at', { ascending: false }).limit(20),
    ]);
    const firstError = menu.error || tableRows.error || paymentAccounts.error || recent.error;
    if (firstError) setError('POS data could not be loaded: ' + firstError.message);
    else {
      setMenuItems(menu.data ?? []); setTables(tableRows.data ?? []);
      setAccounts(paymentAccounts.data ?? []); setHistory(recent.data ?? []);
      setAccountId(current => current || paymentAccounts.data?.[0]?.id || '');
    }
    setLoading(false);
  }, [db, org?.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (receipt) window.print();
  }, [receipt]);

  const cartTotal = useMemo(() => cart.reduce((sum, line) => {
    const item = menuItems.find(row => row.id === line.menu_item_id);
    return sum + Number(item?.price ?? 0) * line.quantity;
  }, 0), [cart, menuItems]);

  const addToCart = (item: MenuItem) => {
    setCart(current => {
      const found = current.find(line => line.menu_item_id === item.id);
      if (found) return current.map(line => line.menu_item_id === item.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { menu_item_id: item.id, quantity: 1, modifiers: '' }];
    });
  };

  const createOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !org?.id || !canOperate) return;
    if (!cart.length) { setError('Add at least one menu item before checkout.'); return; }
    if (orderType === 'dine_in' && tableId && !tables.some(table => table.id === tableId && ['available', 'reserved'].includes(table.status))) {
      setError('That table is no longer available. Refresh the POS and choose another table.'); return;
    }
    setSaving(true); setError(null); setNotice(null);
    const { data, error: createError } = await db.rpc('restaurant_create_order_with_items', {
      p_organization_id: org.id,
      p_order_type: orderType,
      p_table_id: orderType === 'dine_in' ? (tableId || null) : null,
      p_covers: 1,
      p_customer_name: customerName.trim() || null,
      p_notes: notes.trim() || null,
      p_items: cart.map(line => ({ menu_item_id: line.menu_item_id, quantity: line.quantity, modifiers: line.modifiers.trim() || null })),
    });
    if (createError) setError('Order could not be created: ' + createError.message);
    else {
      const { data: created, error: readError } = await db.from('restaurant_orders').select('id,order_number,order_type,customer_name,table_id,table_label,total_amount,status,ordered_at,notes').eq('id', data).eq('organization_id', org.id).single();
      if (readError) setError('Order was created, but its receipt details could not be loaded: ' + readError.message);
      else {
        setActiveOrder(created); setNotice('Order created and sent to the kitchen. Record payment below to complete checkout.');
        setCart([]); setNotes(''); setTableId('');
        setPaymentAmount(String(Number(created.total_amount || 0)));
        await refresh();
      }
    }
    setSaving(false);
  };

  const recordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !org?.id || !activeOrder) return;
    const amount = Number(paymentAmount);
    if (!accountId) { setError('Choose the cash, bank or wallet account receiving this payment.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid payment amount greater than zero.'); return; }
    setSaving(true); setError(null); setNotice(null);
    const { error: paymentError } = await db.rpc('restaurant_record_payment', {
      p_organization_id: org.id,
      p_order_id: activeOrder.id,
      p_financial_account_id: accountId,
      p_amount: amount,
      p_reference: paymentReference.trim() || null,
      p_notes: null,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (paymentError) setError('Payment was not recorded: ' + paymentError.message);
    else {
      setNotice('Payment recorded and posted through Veyora Finance.');
      setPaymentReference('');
      await loadReceipt(activeOrder);
      await refresh();
    }
    setSaving(false);
  };

  const loadReceipt = async (order: Order) => {
    if (!db || !org?.id) return;
    const [{ data: lines, error: linesError }, { data: payments, error: paymentsError }] = await Promise.all([
      db.from('restaurant_order_items').select('item_name,quantity,unit_price,line_total,modifiers').eq('organization_id', org.id).eq('order_id', order.id).order('created_at'),
      db.from('restaurant_order_payments').select('amount,reference,paid_at').eq('organization_id', org.id).eq('order_id', order.id).order('paid_at'),
    ]);
    if (linesError || paymentsError) { setError('Receipt could not be prepared: ' + (linesError?.message || paymentsError?.message)); return; }
    setReceipt({ order, items: lines ?? [], payments: payments ?? [] });
  };

  const openExistingReceipt = async (order: Order) => {
    setError(null); setActiveOrder(order); await loadReceipt(order);
    const { data: payments } = await db.from('restaurant_order_payments').select('amount').eq('organization_id', org.id).eq('order_id', order.id);
    const paid = (payments ?? []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    setPaymentAmount(String(Math.max(0, Number(order.total_amount || 0) - paid)));
  };

  const paidTotal = receipt?.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) ?? 0;
  const receiptSettings = org?.receipt_settings ?? {};

  return <div className="space-y-5">
    <style>{`
      @media print {
        @page { size: 80mm auto; margin: 4mm; }
        body * { visibility: hidden !important; }
        #veyora-pos-receipt, #veyora-pos-receipt * { visibility: visible !important; }
        #veyora-pos-receipt { display: block !important; position: absolute; inset: 0 auto auto 0; width: 72mm; color: #000 !important; background: #fff !important; font: 11px/1.35 monospace; }
        .no-print { display: none !important; }
      }
      #veyora-pos-receipt { display: none; }
    `}</style>
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between no-print">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700"><ShoppingCart className="h-4 w-4"/> Restaurant checkout</div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">Point of Sale</h1><p className="mt-1 text-sm text-slate-600">Build an order, send it to the kitchen, collect payment and print a customer receipt.</p></div>
      <button onClick={() => void refresh()} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><RefreshCw className="h-4 w-4"/> Refresh</button>
    </header>
    {error && <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 no-print"><AlertCircle className="h-4 w-4 shrink-0"/>{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 no-print">{notice}</div>}
    {loading ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 no-print">Loading restaurant POS…</div> : <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] no-print">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Menu items</h2><p className="mt-1 text-xs text-slate-500">Tap an item to add it to the current cart.</p></div><span className="text-xs text-slate-500">{menuItems.length} available</span></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {menuItems.map(item => <button key={item.id} type="button" onClick={() => addToCart(item)} className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50/50"><span className="block text-sm font-semibold text-slate-900">{item.name}</span><span className="mt-2 block text-xs font-semibold text-blue-700">{formatMoney(Number(item.price), currency)}</span><span className="mt-1 block text-[10px] text-slate-500">{item.prep_station.replaceAll('_', ' ')}</span></button>)}
            {!menuItems.length && <p className="col-span-full rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-500">No available menu items. Add and enable menu items in Restaurant Operations first.</p>}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Current cart</h2><button type="button" onClick={() => setCart([])} disabled={!cart.length || saving} className="text-xs font-semibold text-rose-700">Clear cart</button></div>
          <form onSubmit={createOrder} className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-slate-700">Order type<select value={orderType} onChange={e => { setOrderType(e.target.value); if (e.target.value !== 'dine_in') setTableId(''); }} className={field}><option value="dine_in">Dine in</option><option value="takeaway">Takeaway</option><option value="delivery">Delivery</option></select></label>
              <label className="text-xs font-medium text-slate-700">Table<select disabled={orderType !== 'dine_in'} value={tableId} onChange={e => setTableId(e.target.value)} className={field}><option value="">No table</option>{tables.filter(table => ['available', 'reserved'].includes(table.status)).map(table => <option key={table.id} value={table.id}>{table.table_number} · {table.seats} seats</option>)}</select></label>
            </div>
            <label className="block text-xs font-medium text-slate-700">Customer name<input value={customerName} onChange={e => setCustomerName(e.target.value)} className={field}/></label>
            <div className="space-y-2">
              {cart.map(line => { const item = menuItems.find(row => row.id === line.menu_item_id); return <div key={line.menu_item_id} className="rounded-lg border border-slate-100 p-2"><div className="flex items-center justify-between gap-2"><b className="text-xs">{item?.name}</b><b className="text-xs">{formatMoney(Number(item?.price || 0) * line.quantity, currency)}</b></div><div className="mt-2 flex items-center gap-2"><button type="button" onClick={() => setCart(current => current.map(row => row.menu_item_id === line.menu_item_id ? { ...row, quantity: Math.max(1, row.quantity - 1) } : row))} className="rounded border px-2 py-1 text-xs">−</button><span className="min-w-6 text-center text-xs">{line.quantity}</span><button type="button" onClick={() => setCart(current => current.map(row => row.menu_item_id === line.menu_item_id ? { ...row, quantity: row.quantity + 1 } : row))} className="rounded border px-2 py-1 text-xs">+</button><input aria-label={'Modifiers for ' + item?.name} value={line.modifiers} onChange={e => setCart(current => current.map(row => row.menu_item_id === line.menu_item_id ? { ...row, modifiers: e.target.value } : row))} placeholder="Modifiers / no onions…" className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"/></div></div>; })}
              {!cart.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-xs text-slate-500">Your cart is empty. Select menu items to begin.</p>}
            </div>
            <label className="block text-xs font-medium text-slate-700">Kitchen / allergy notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={field}/></label>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-sm font-semibold">Total</span><span className="text-lg font-bold tabular-nums">{formatMoney(cartTotal, currency)}</span></div>
            <button disabled={!canOperate || saving || !cart.length} className="w-full rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Creating order…' : 'Create order & send to kitchen'}</button>
          </form>
        </section>
      </div>
      {activeOrder && <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-4 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Checkout · #{activeOrder.order_number}</h2><p className="mt-1 text-xs text-slate-600">Order total {formatMoney(Number(activeOrder.total_amount), currency)} · {activeOrder.status.replaceAll('_', ' ')}</p></div><button type="button" onClick={() => setActiveOrder(null)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs">Close checkout</button></div>
        <form onSubmit={recordPayment} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-slate-700">Receiving account<select required value={accountId} onChange={e => setAccountId(e.target.value)} className={field}><option value="">Select account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.account_name} · {account.account_type}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-700">Amount received<input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className={field}/></label>
          <label className="text-xs font-medium text-slate-700">Payment reference<input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className={field}/></label>
          <div className="flex items-end"><button disabled={saving || !accounts.length || !canOperate} className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Recording…' : 'Record payment'}</button></div>
        </form>
        {!accounts.length && <p className="mt-2 text-xs text-amber-800">No active receiving account is configured. Add a cash or bank account in Finance before taking payment.</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void loadReceipt(activeOrder)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"><Printer className="h-4 w-4"/> Preview / print receipt</button></div>
      </section>}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white no-print">
        <div className="border-b border-slate-100 p-4"><h2 className="font-semibold">Recent orders & reprint</h2><p className="mt-1 text-xs text-slate-500">Open a previous ticket to print another copy of its receipt.</p></div>
        <div className="divide-y divide-slate-100">{history.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><b className="text-xs">#{order.order_number}</b><p className="mt-1 text-[11px] text-slate-500">{order.customer_name || order.table_label || order.order_type} · {new Date(order.ordered_at).toLocaleString()}</p></div><div className="flex items-center gap-3"><b className="text-xs">{formatMoney(Number(order.total_amount), currency)}</b><button type="button" onClick={() => void openExistingReceipt(order)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold">Reprint receipt</button></div></div>)}{!history.length && <p className="p-8 text-center text-xs text-slate-500">No restaurant orders yet.</p>}</div>
      </section>
    </>}
    {receipt && <div id="veyora-pos-receipt">
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 16 }}>{org?.name ?? 'Restaurant'}</strong>
        {org?.business_phone && <div>{org.business_phone}</div>}
        {org?.business_email && <div>{org.business_email}</div>}
        {typeof receiptSettings?.header === 'string' && <div>{receiptSettings.header}</div>}
        <div style={{ marginTop: 8, borderTop: '1px dashed #000', paddingTop: 6 }}>CUSTOMER RECEIPT</div>
      </div>
      <div>Receipt: {receipt.order.order_number}</div>
      <div>Date: {new Date(receipt.order.ordered_at).toLocaleString()}</div>
      <div>Type: {receipt.order.order_type.replaceAll('_', ' ')}</div>
      {receipt.order.customer_name && <div>Customer: {receipt.order.customer_name}</div>}
      {receipt.order.table_label && <div>Table: {receipt.order.table_label}</div>}
      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }}/>
      {receipt.items.map((item, index) => <div key={index} style={{ marginBottom: 6 }}>
        <div>{item.quantity} × {item.item_name}</div>
        {item.modifiers && <div>{item.modifiers}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{formatMoney(Number(item.unit_price), currency)} each</span><strong>{formatMoney(Number(item.line_total), currency)}</strong></div>
      </div>)}
      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }}/>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><strong>TOTAL</strong><strong>{formatMoney(Number(receipt.order.total_amount), currency)}</strong></div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Paid</span><strong>{formatMoney(paidTotal, currency)}</strong></div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Balance due</span><strong>{formatMoney(Math.max(0, Number(receipt.order.total_amount) - paidTotal), currency)}</strong></div>
      {receipt.payments.map((payment, index) => <div key={index} style={{ marginTop: 4 }}>Payment: {formatMoney(Number(payment.amount), currency)} · {payment.reference || 'No reference'}</div>)}
      {typeof receiptSettings?.footer === 'string' && <div style={{ textAlign: 'center', marginTop: 10 }}>{receiptSettings.footer}</div>}
      <div style={{ textAlign: 'center', marginTop: 10 }}>Thank you. Please visit again.</div>
    </div>}
  </div>;
}

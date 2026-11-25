import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { fetchSalesModuleData } from '../sales/salesService';
import type { SaleRecord } from '../sales/salesTypes';
import { fetchPurchasesList } from '../purchases/purchasesService';
import type { PurchaseRecord } from '../purchases/purchasesTypes';
import { loadFinanceReportLines, type FinanceReportLine } from '../finance/financeService';

type Domain = 'sales' | 'purchases' | 'finance';
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const money = (value: number, currency: string) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
const dateInRange = (value: string | null | undefined, from: string, to: string) => {
  if (!value) return false;
  const day = value.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};
const downloadCsv = (name: string, rows: Array<Array<string | number>>) => {
  const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
};

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</div>{detail && <div className="mt-1 text-[11px] text-slate-500">{detail}</div>}</div>;
}

export function OperationalReportsPanel({ domain, canExport = false }: { domain: Domain; canExport?: boolean }) {
  const { activeOrganisation } = useAuth();
  const orgId = activeOrganisation?.id ?? null;
  const currency = activeOrganisation?.base_currency ?? 'NGN';
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [financeLines, setFinanceLines] = useState<FinanceReportLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setSales([]); setPurchases([]); setFinanceLines([]); setLoading(false); return; }
    setLoading(true); setError(null); setWarning(null);
    try {
      if (domain === 'sales') {
        const result = await fetchSalesModuleData(orgId, currency);
        const failures = Object.values(result.errors).filter(Boolean);
        if (failures.length) setWarning(failures.join(' · '));
        setSales(result.sales);
      } else if (domain === 'purchases') {
        const result = await fetchPurchasesList(orgId, { defaultCurrency: currency });
        if (result.error) throw new Error(result.error);
        if (result.itemsWarning) setWarning(result.itemsWarning);
        setPurchases(result.purchases);
      } else {
        const rows = await loadFinanceReportLines(orgId, to || today());
        setFinanceLines(rows);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load this report.');
    } finally { setLoading(false); }
  }, [orgId, currency, domain, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredSales = useMemo(() => sales.filter(s => s.status === 'completed' && dateInRange(s.soldAt, from, to)), [sales, from, to]);
  const filteredPurchases = useMemo(() => purchases.filter(p => p.status !== 'cancelled' && dateInRange(p.orderDate ?? p.createdAt, from, to)), [purchases, from, to]);
  const filteredFinance = useMemo(() => financeLines.filter(line => dateInRange(line.finance_journal_entries.entry_date, from, to)), [financeLines, from, to]);

  const saleTotals = useMemo(() => {
    const gross = filteredSales.reduce((sum, s) => sum + s.totalAmount, 0);
    const returns = filteredSales.reduce((sum, s) => sum + s.returnedAmount, 0);
    const paid = filteredSales.reduce((sum, s) => sum + s.paidAmount, 0);
    const outstanding = filteredSales.reduce((sum, s) => sum + s.outstandingAmount, 0);
    const cost = filteredSales.reduce((sum, s) => sum + s.items.reduce((n, item) => n + Math.max(0, item.quantity - item.returnedQuantity) * item.unitCost, 0), 0);
    return { gross, returns, net: gross - returns, paid, outstanding, margin: gross - returns - cost, cost };
  }, [filteredSales]);

  const purchaseTotals = useMemo(() => ({
    spend: filteredPurchases.reduce((sum, p) => sum + p.totalAmount, 0),
    orders: filteredPurchases.length,
    received: filteredPurchases.filter(p => p.status === 'received').length,
    open: filteredPurchases.filter(p => p.status === 'ordered' || p.status === 'partially_received').length,
  }), [filteredPurchases]);

  const financeTotals = useMemo(() => {
    let revenue = 0, expenses = 0, debits = 0, credits = 0;
    for (const line of filteredFinance) {
      const debit = Number(line.debit) || 0, credit = Number(line.credit) || 0;
      debits += debit; credits += credit;
      const type = line.finance_ledger_accounts.account_type;
      const normal = line.finance_ledger_accounts.normal_balance;
      const movement = normal === 'credit' ? credit - debit : debit - credit;
      if (type === 'revenue') revenue += movement;
      if (type === 'expense') expenses += movement;
    }
    return { revenue, expenses, profit: revenue - expenses, debits, credits };
  }, [filteredFinance]);

  const title = domain === 'sales' ? 'Sales performance' : domain === 'purchases' ? 'Purchases & supplier spend' : 'Finance & profit and loss';
  const exportRows = () => {
    if (!canExport) return;
    if (domain === 'sales') downloadCsv('sales-report.csv', [['Sale','Date','Customer','Location','Status','Payment status','Gross','Returns','Net sales','Paid','Outstanding','Gross margin'], ...filteredSales.map(s => [s.saleNumber,s.soldAt,s.customerName ?? 'Walk-in',s.locationName,s.status,s.paymentStatus,s.totalAmount,s.returnedAmount,s.totalAmount-s.returnedAmount,s.paidAmount,s.outstandingAmount,s.totalAmount-s.returnedAmount-s.items.reduce((n,i)=>n+Math.max(0,i.quantity-i.returnedQuantity)*i.unitCost,0)])]);
    if (domain === 'purchases') downloadCsv('purchases-report.csv', [['Purchase','Date','Supplier','Status','Currency','Subtotal','Discount','Tax','Total'], ...filteredPurchases.map(p => [p.purchaseNumber,p.orderDate ?? '',p.supplierName,p.status,p.currencyCode,p.subtotal,p.discountAmount,p.taxAmount,p.totalAmount])]);
    if (domain === 'finance') downloadCsv('finance-ledger-report.csv', [['Date','Journal','Description','Account code','Account','Type','Debit','Credit'], ...filteredFinance.map(l => [l.finance_journal_entries.entry_date,l.finance_journal_entries.journal_number,l.finance_journal_entries.description,l.finance_ledger_accounts.account_code,l.finance_ledger_accounts.account_name,l.finance_ledger_accounts.account_type,Number(l.debit),Number(l.credit)])]);
  };

  return <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">Live records from this organisation · Read-only · {from || 'All dates'} to {to || 'Present'}</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5"/>Refresh</button><button type="button" onClick={exportRows} disabled={!canExport || loading} title={canExport ? 'Export CSV' : 'CSV exports require the Premium plan'} className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Download className="h-3.5 w-3.5"/>Export CSV</button></div></div>
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3"><label className="grid gap-1 text-xs text-slate-600">From<input type="date" value={from} max={to || undefined} onChange={e=>setFrom(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"/></label><label className="grid gap-1 text-xs text-slate-600">To<input type="date" value={to} min={from || undefined} onChange={e=>setTo(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900"/></label><button type="button" onClick={()=>{setFrom('');setTo('');}} className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-700">All dates</button></div>
    {loading ? <div className="rounded-md border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading report data…</div> : error ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle className="mr-2 inline h-4 w-4"/>{error}</div> : <>
      {warning && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Some supporting data could not be loaded: {warning}</div>}
      {domain === 'sales' && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Net sales" value={money(saleTotals.net,currency)} detail="Completed sales less recorded returns"/><Metric label="Payments received" value={money(saleTotals.paid,currency)}/><Metric label="Outstanding" value={money(saleTotals.outstanding,currency)}/><Metric label="Gross margin" value={money(saleTotals.margin,currency)} detail="Net sales less recorded item cost"/></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Completed transactions" value={String(filteredSales.length)}/><Metric label="Gross sales" value={money(saleTotals.gross,currency)}/><Metric label="Returns" value={money(saleTotals.returns,currency)}/><Metric label="Cost of goods" value={money(saleTotals.cost,currency)}/></div><div className="overflow-x-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Sale','Date','Customer','Location','Payment','Net sales','Paid','Outstanding'].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead><tbody>{filteredSales.slice().sort((a,b)=>b.soldAt.localeCompare(a.soldAt)).map(s=><tr key={s.id} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-900">{s.saleNumber}</td><td className="px-3 py-2">{s.soldAt.slice(0,10)}</td><td className="px-3 py-2">{s.customerName || 'Walk-in'}</td><td className="px-3 py-2">{s.locationName}</td><td className="px-3 py-2 capitalize">{s.paymentStatus}</td><td className="px-3 py-2 tabular-nums">{money(s.totalAmount-s.returnedAmount,s.currency)}</td><td className="px-3 py-2 tabular-nums">{money(s.paidAmount,s.currency)}</td><td className="px-3 py-2 tabular-nums">{money(s.outstandingAmount,s.currency)}</td></tr>)}</tbody></table>{filteredSales.length===0 && <p className="p-6 text-center text-sm text-slate-500">No completed sales found for this date range.</p>}</div></>}
      {domain === 'purchases' && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Purchase spend" value={money(purchaseTotals.spend,currency)}/><Metric label="Purchase orders" value={String(purchaseTotals.orders)}/><Metric label="Received orders" value={String(purchaseTotals.received)}/><Metric label="Open orders" value={String(purchaseTotals.open)}/></div><div className="overflow-x-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Purchase','Date','Supplier','Status','Total'].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead><tbody>{filteredPurchases.slice().sort((a,b)=>(b.orderDate ?? '').localeCompare(a.orderDate ?? '')).map(p=><tr key={p.id} className="border-t border-slate-100"><td className="px-3 py-2 font-medium text-slate-900">{p.purchaseNumber}</td><td className="px-3 py-2">{(p.orderDate ?? '').slice(0,10) || '—'}</td><td className="px-3 py-2">{p.supplierName}</td><td className="px-3 py-2 capitalize">{p.status.replaceAll('_',' ')}</td><td className="px-3 py-2 tabular-nums">{money(p.totalAmount,p.currencyCode)}</td></tr>)}</tbody></table>{filteredPurchases.length===0 && <p className="p-6 text-center text-sm text-slate-500">No purchase orders found for this date range.</p>}</div></>}
      {domain === 'finance' && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Recognised revenue" value={money(financeTotals.revenue,currency)}/><Metric label="Recorded expenses" value={money(financeTotals.expenses,currency)}/><Metric label="Net profit" value={money(financeTotals.profit,currency)}/><Metric label="Posted journal lines" value={String(filteredFinance.length)}/></div><div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">Calculated from posted general-ledger journal lines. Debits: {money(financeTotals.debits,currency)} · Credits: {money(financeTotals.credits,currency)}. This is an operational P&amp;L view, not a tax filing or audited statement.</div><div className="overflow-x-auto rounded-md border border-slate-200 bg-white"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Date','Journal','Account','Type','Debit','Credit'].map(x=><th key={x} className="px-3 py-2 font-medium">{x}</th>)}</tr></thead><tbody>{filteredFinance.slice().sort((a,b)=>b.finance_journal_entries.entry_date.localeCompare(a.finance_journal_entries.entry_date)).map(l=><tr key={l.id} className="border-t border-slate-100"><td className="px-3 py-2">{l.finance_journal_entries.entry_date}</td><td className="px-3 py-2">{l.finance_journal_entries.journal_number}</td><td className="px-3 py-2">{l.finance_ledger_accounts.account_name}</td><td className="px-3 py-2 capitalize">{l.finance_ledger_accounts.account_type}</td><td className="px-3 py-2 tabular-nums">{money(Number(l.debit),currency)}</td><td className="px-3 py-2 tabular-nums">{money(Number(l.credit),currency)}</td></tr>)}</tbody></table>{filteredFinance.length===0 && <p className="p-6 text-center text-sm text-slate-500">No posted journal entries found for this date range.</p>}</div></>}
    </>}
  </section>;
}

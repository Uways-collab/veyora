import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { fetchSalesModuleData } from '../sales/salesService';
import type { SalesModuleData } from '../sales/salesTypes';
import { fetchPurchaseReferenceData, fetchPurchasesList } from '../purchases/purchasesService';
import type { PurchaseRecord } from '../purchases/purchasesTypes';
import { loadFinanceReportLines } from '../finance/financeService';
import type { FinanceReportLine } from '../finance/financeService';

type ReportDomain = 'sales' | 'purchases' | 'finance';

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
}
function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  return '"' + raw.replace(/"/g, '""') + '"';
}
function downloadCsv(filename: string, rows: unknown[][]): void {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-500">{note}</p></div>;
}
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-4"><div className="mb-3"><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>{children}</section>;
}
function EmptyRows({ children = 'No matching transactions were found for this date range.' }: { children?: string }) {
  return <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-500">{children}</div>;
}
function inRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!value) return false;
  const day = value.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

export function OperationalReportsPanel({ domain, canExport = false }: { domain: ReportDomain; canExport?: boolean }) {
  const { activeOrganisation } = useAuth();
  const orgId = activeOrganisation?.id ?? null;
  const currency = (activeOrganisation?.base_currency ?? 'NGN').toUpperCase();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [salesData, setSalesData] = useState<SalesModuleData | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [purchaseWarning, setPurchaseWarning] = useState<string | null>(null);
  const [financeLines, setFinanceLines] = useState<FinanceReportLine[]>([]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);

  useEffect(() => {
    let live = true;
    if (!orgId) {
      setSalesData(null); setPurchases([]); setFinanceLines([]); setLoading(false);
      return;
    }
    setLoading(true); setError(null); setPurchaseWarning(null);
    const load = async () => {
      try {
        if (domain === 'sales') {
          const result = await fetchSalesModuleData(orgId, currency);
          const errors = Object.values(result.errors).filter(Boolean);
          if (errors.length) throw new Error(errors.join(' · '));
          if (live) setSalesData(result);
        } else if (domain === 'purchases') {
          const reference = await fetchPurchaseReferenceData(orgId);
          if (reference.catalogError || reference.suppliersError) {
            throw new Error([reference.catalogError, reference.suppliersError].filter(Boolean).join(' · '));
          }
          const result = await fetchPurchasesList(orgId, {
            defaultCurrency: currency,
            suppliersById: reference.allSuppliersById,
            catalogVariants: reference.catalogVariants,
          });
          if (result.error) throw new Error(result.error);
          if (live) {
            setPurchases(result.purchases);
            setPurchaseWarning(result.itemsWarning ?? null);
          }
        } else {
          const result = await loadFinanceReportLines(orgId, to || new Date().toISOString().slice(0, 10));
          if (live) setFinanceLines(result);
        }
      } catch (reason) {
        if (live) setError(reason instanceof Error ? reason.message : 'Unable to load this report.');
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => { live = false; };
  }, [orgId, currency, domain, to, refreshKey]);

  const filteredSales = useMemo(() => (salesData?.sales ?? []).filter(sale =>
    inRange(sale.soldAt, from, to) &&
    (sale.saleNumber + ' ' + (sale.customerName ?? '') + ' ' + sale.locationName).toLowerCase().includes(search.toLowerCase())
  ), [salesData, from, to, search]);

  const salesMetrics = useMemo(() => {
    const completed = filteredSales.filter(sale => sale.status !== 'cancelled');
    const gross = completed.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const returned = completed.reduce((sum, sale) => sum + sale.returnedAmount, 0);
    const net = Math.max(0, gross - returned);
    const collected = completed.reduce((sum, sale) => sum + sale.payments.reduce((p, payment) => p + payment.amount, 0), 0);
    const refunded = completed.reduce((sum, sale) => sum + sale.refunds.reduce((p, refund) => p + refund.amount, 0), 0);
    const cogs = completed.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) =>
      itemSum + item.unitCost * Math.max(0, item.quantity - item.returnedQuantity), 0), 0);
    const byProduct = new Map<string, { name: string; quantity: number; revenue: number; cost: number }>();
    const byPayment = new Map<string, number>();
    for (const sale of completed) {
      for (const item of sale.items) {
        const key = item.productName;
        const current = byProduct.get(key) ?? { name: key, quantity: 0, revenue: 0, cost: 0 };
        current.quantity += Math.max(0, item.quantity - item.returnedQuantity);
        current.revenue += Math.max(0, item.lineFinalAmount - item.returnedAmount);
        current.cost += item.unitCost * Math.max(0, item.quantity - item.returnedQuantity);
        byProduct.set(key, current);
      }
      for (const payment of sale.payments) byPayment.set(payment.methodName, (byPayment.get(payment.methodName) ?? 0) + payment.amount);
    }
    return {
      completedCount: completed.length, cancelledCount: filteredSales.length - completed.length,
      gross, returned, net, collected, refunded, outstanding: completed.reduce((sum, sale) => sum + sale.outstandingAmount, 0),
      cogs, grossProfit: net - cogs,
      products: Array.from(byProduct.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      payments: Array.from(byPayment.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [filteredSales]);

  const filteredPurchases = useMemo(() => purchases.filter(purchase =>
    inRange(purchase.orderDate ?? purchase.createdAt, from, to) &&
    (purchase.purchaseNumber + ' ' + purchase.supplierName + ' ' + purchase.status).toLowerCase().includes(search.toLowerCase())
  ), [purchases, from, to, search]);

  const purchaseMetrics = useMemo(() => {
    const active = filteredPurchases.filter(p => p.status !== 'cancelled' && p.status !== 'draft');
    const committed = active.reduce((sum, p) => sum + p.totalAmount, 0);
    const receivedValue = active.reduce((sum, p) => sum + p.items.reduce((itemSum, item) =>
      itemSum + (item.orderedQuantity > 0 ? item.lineTotal * Math.min(1, item.receivedQuantity / item.orderedQuantity) : 0), 0), 0);
    const supplierTotals = new Map<string, number>();
    for (const purchase of active) supplierTotals.set(purchase.supplierName, (supplierTotals.get(purchase.supplierName) ?? 0) + purchase.totalAmount);
    return {
      count: filteredPurchases.length, activeCount: active.length, committed, receivedValue,
      draftCount: filteredPurchases.filter(p => p.status === 'draft').length,
      cancelledCount: filteredPurchases.filter(p => p.status === 'cancelled').length,
      suppliers: Array.from(supplierTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [filteredPurchases]);

  const finance = useMemo(() => {
    const asOf = financeLines.filter(line => line.finance_journal_entries.entry_date <= (to || new Date().toISOString().slice(0, 10)));
    const period = asOf.filter(line => !from || line.finance_journal_entries.entry_date >= from);
    const sum = (rows: FinanceReportLine[], type: string, normal: 'debit' | 'credit') => rows
      .filter(line => line.finance_ledger_accounts.account_type === type)
      .reduce((total, line) => total + (normal === 'debit' ? Number(line.debit) - Number(line.credit) : Number(line.credit) - Number(line.debit)), 0);
    const accounts = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
    for (const line of asOf) {
      const id = line.ledger_account_id;
      const row = accounts.get(id) ?? { code: line.finance_ledger_accounts.account_code, name: line.finance_ledger_accounts.account_name, type: line.finance_ledger_accounts.account_type, debit: 0, credit: 0 };
      row.debit += Number(line.debit); row.credit += Number(line.credit); accounts.set(id, row);
    }
    const trial = Array.from(accounts.entries()).map(([id, row]) => ({
      id, ...row, balance: row.type === 'asset' || row.type === 'expense' ? row.debit - row.credit : row.credit - row.debit,
    })).sort((a, b) => a.code.localeCompare(b.code));
    const revenue = sum(period, 'revenue', 'credit');
    const expenses = sum(period, 'expense', 'debit');
    const cumulativeIncome = sum(asOf, 'revenue', 'credit') - sum(asOf, 'expense', 'debit');
    const assets = trial.filter(a => a.type === 'asset').reduce((s, a) => s + a.balance, 0);
    const liabilities = trial.filter(a => a.type === 'liability').reduce((s, a) => s + a.balance, 0);
    const equity = trial.filter(a => a.type === 'equity').reduce((s, a) => s + a.balance, 0) + cumulativeIncome;
    return { period, trial, revenue, expenses, net: revenue - expenses, assets, liabilities, equity,
      debits: trial.reduce((s, a) => s + a.debit, 0), credits: trial.reduce((s, a) => s + a.credit, 0) };
  }, [financeLines, from, to]);

  const exportReport = () => {
    if (!canExport) return;
    if (domain === 'sales') {
      downloadCsv('sales-report.csv', [
        ['Sale number', 'Date', 'Customer', 'Location', 'Status', 'Gross', 'Returns', 'Net sales', 'Collected', 'Outstanding', 'Currency'],
        ...filteredSales.map(s => [s.saleNumber, s.soldAt, s.customerName ?? '', s.locationName, s.status, s.totalAmount, s.returnedAmount, s.totalAmount - s.returnedAmount, s.paidAmount, s.outstandingAmount, s.currency]),
      ]);
    } else if (domain === 'purchases') {
      downloadCsv('purchases-report.csv', [
        ['Purchase number', 'Order date', 'Supplier', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Currency'],
        ...filteredPurchases.map(p => [p.purchaseNumber, p.orderDate ?? '', p.supplierName, p.status, p.subtotal, p.discountAmount, p.taxAmount, p.totalAmount, p.currencyCode]),
      ]);
    } else {
      downloadCsv('finance-ledger-report.csv', [
        ['Date', 'Journal', 'Source', 'Account code', 'Account', 'Debit', 'Credit', 'Currency'],
        ...finance.period.map(l => [l.finance_journal_entries.entry_date, l.finance_journal_entries.journal_number, l.finance_journal_entries.source_type, l.finance_ledger_accounts.account_code, l.finance_ledger_accounts.account_name, l.debit, l.credit, currency]),
      ]);
    }
  };

  const heading = domain === 'sales' ? 'Sales performance' : domain === 'purchases' ? 'Purchases & supplier spend' : 'Financial statements & ledger';
  const description = domain === 'sales'
    ? 'Sales totals, returns, collections, outstanding balances and product performance from recorded POS transactions.'
    : domain === 'purchases'
      ? 'Purchase commitments, goods received, supplier spend and order status from recorded purchase orders.'
      : 'Profit and loss, balance sheet, trial balance and posted general-ledger activity.';

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-lg font-semibold text-slate-900">{heading}</h2><p className="mt-1 max-w-2xl text-xs text-slate-500">{description}</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[11px] text-slate-500">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 rounded-md border border-slate-300 px-2 text-xs text-slate-800"/></label>
        <label className="grid gap-1 text-[11px] text-slate-500">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 rounded-md border border-slate-300 px-2 text-xs text-slate-800"/></label>
        {domain !== 'finance' && <label className="grid gap-1 text-[11px] text-slate-500">Search<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search records" className="h-9 w-40 rounded-md border border-slate-300 px-2 text-xs text-slate-800"/></label>}
        <button type="button" onClick={refresh} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}/>Refresh</button>
        {canExport && <button type="button" onClick={exportReport} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-medium text-white disabled:opacity-50"><Download className="h-3.5 w-3.5"/>Export CSV</button>}
      </div>
    </div>
    {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>{error}</span></div>}
    {purchaseWarning && domain === 'purchases' && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Some purchase line details could not be loaded: {purchaseWarning}</div>}
    {loading ? <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading organisation report data…</div> : error ? null : domain === 'sales' ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Net sales" value={money(salesMetrics.net, currency)} note={`${salesMetrics.completedCount} completed sales · after returns`}/>
        <Metric label="Payments collected" value={money(salesMetrics.collected, currency)} note={`${money(salesMetrics.refunded, currency)} refunded`}/>
        <Metric label="Outstanding balances" value={money(salesMetrics.outstanding, currency)} note="Open customer balances on completed sales"/>
        <Metric label="Gross profit" value={money(salesMetrics.grossProfit, currency)} note="Net sales less sale-time item cost snapshots"/>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Top products by net sales" note="Based on completed sale line items, less recorded returns.">
          {salesMetrics.products.length ? <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-xs"><thead><tr className="text-left text-slate-500"><th className="py-2">Product</th><th className="py-2 text-right">Qty sold</th><th className="py-2 text-right">Net sales</th><th className="py-2 text-right">Gross profit</th></tr></thead><tbody>{salesMetrics.products.map(p=><tr key={p.name} className="border-t border-slate-100"><td className="py-2 font-medium text-slate-800">{p.name}</td><td className="py-2 text-right">{p.quantity.toLocaleString()}</td><td className="py-2 text-right font-mono">{money(p.revenue,currency)}</td><td className="py-2 text-right font-mono">{money(p.revenue-p.cost,currency)}</td></tr>)}</tbody></table></div> : <EmptyRows/>}
        </Section>
        <Section title="Collections by payment method">
          {salesMetrics.payments.length ? <div className="space-y-3">{salesMetrics.payments.map(([name, amount])=><div key={name}><div className="flex justify-between gap-3 text-xs"><span>{name}</span><span className="font-mono">{money(amount,currency)}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{width:`${salesMetrics.collected ? amount/salesMetrics.collected*100 : 0}%`}}/></div></div>)}</div> : <EmptyRows/>}
        </Section>
      </div>
      <Section title="Sales transactions" note={`${filteredSales.length} records · cancelled sales are shown but excluded from sales KPIs`}>
        {filteredSales.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead><tr className="text-left text-slate-500"><th className="py-2">Sale</th><th className="py-2">Date</th><th className="py-2">Customer</th><th className="py-2">Location</th><th className="py-2">Status</th><th className="py-2 text-right">Net sales</th><th className="py-2 text-right">Outstanding</th></tr></thead><tbody>{filteredSales.slice().sort((a,b)=>b.soldAt.localeCompare(a.soldAt)).map(s=><tr key={s.id} className="border-t border-slate-100"><td className="py-2 font-medium">{s.saleNumber}</td><td className="py-2">{dateLabel(s.soldAt)}</td><td className="py-2">{s.customerName ?? 'Walk-in'}</td><td className="py-2">{s.locationName}</td><td className="py-2 capitalize">{s.status}</td><td className="py-2 text-right font-mono">{money(s.totalAmount-s.returnedAmount,s.currency || currency)}</td><td className="py-2 text-right font-mono">{money(s.outstandingAmount,s.currency || currency)}</td></tr>)}</tbody></table></div> : <EmptyRows/>}
      </Section>
    </> : domain === 'purchases' ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Committed purchase value" value={money(purchaseMetrics.committed,currency)} note="Ordered, partially received and received orders"/>
        <Metric label="Received line value" value={money(purchaseMetrics.receivedValue,currency)} note="Pro-rated from recorded received quantities"/>
        <Metric label="Purchase orders" value={String(purchaseMetrics.activeCount)} note={`${purchaseMetrics.draftCount} drafts · ${purchaseMetrics.cancelledCount} cancelled`}/>
        <Metric label="Suppliers" value={String(new Set(filteredPurchases.map(p=>p.supplierId).filter(Boolean)).size)} note="Suppliers represented in this period"/>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Supplier spend ranking" note="Order value, excluding drafts and cancelled orders.">
          {purchaseMetrics.suppliers.length ? <div className="space-y-2">{purchaseMetrics.suppliers.map(([name, amount])=><div key={name} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 text-xs"><span className="font-medium text-slate-800">{name}</span><span className="font-mono">{money(amount,currency)}</span></div>)}</div> : <EmptyRows/>}
        </Section>
        <Section title="Order status breakdown">
          {(['draft','ordered','partially_received','received','cancelled'] as const).map(status=>{const count=filteredPurchases.filter(p=>p.status===status).length;return <div key={status} className="flex items-center justify-between border-b border-slate-100 py-2 text-xs"><span className="capitalize">{status.replace(/_/g,' ')}</span><span className="font-mono">{count}</span></div>;})}
        </Section>
      </div>
      <Section title="Purchase orders" note={`${filteredPurchases.length} records in the selected period`}>
        {filteredPurchases.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead><tr className="text-left text-slate-500"><th className="py-2">Purchase</th><th className="py-2">Date</th><th className="py-2">Supplier</th><th className="py-2">Status</th><th className="py-2 text-right">Subtotal</th><th className="py-2 text-right">Tax</th><th className="py-2 text-right">Total</th></tr></thead><tbody>{filteredPurchases.slice().sort((a,b)=>(b.orderDate??'').localeCompare(a.orderDate??'')).map(p=><tr key={p.id} className="border-t border-slate-100"><td className="py-2 font-medium">{p.purchaseNumber}</td><td className="py-2">{dateLabel(p.orderDate)}</td><td className="py-2">{p.supplierName}</td><td className="py-2 capitalize">{p.status.replace(/_/g,' ')}</td><td className="py-2 text-right font-mono">{money(p.subtotal,p.currencyCode)}</td><td className="py-2 text-right font-mono">{money(p.taxAmount,p.currencyCode)}</td><td className="py-2 text-right font-mono">{money(p.totalAmount,p.currencyCode)}</td></tr>)}</tbody></table></div> : <EmptyRows/>}
      </Section>
    </> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Revenue" value={money(finance.revenue,currency)} note="Posted revenue in selected period"/>
        <Metric label="Expenses" value={money(finance.expenses,currency)} note="Posted expenses in selected period"/>
        <Metric label="Net profit" value={money(finance.net,currency)} note="Revenue less expenses"/>
        <Metric label="Trial balance" value={money(finance.debits,currency)} note={`Debits · credits ${money(finance.credits,currency)}`}/>
      </div>
      <Section title={`Balance sheet · as at ${to}`} note="Calculated from posted journal lines through the selected end date. Retained earnings include cumulative posted profit.">
        <div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">Assets</p><p className="mt-1 text-lg font-semibold">{money(finance.assets,currency)}</p></div><div><p className="text-xs text-slate-500">Liabilities</p><p className="mt-1 text-lg font-semibold">{money(finance.liabilities,currency)}</p></div><div><p className="text-xs text-slate-500">Equity incl. retained earnings</p><p className="mt-1 text-lg font-semibold">{money(finance.equity,currency)}</p></div></div>
        <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600">Balance check (assets − liabilities − equity): <strong className="font-mono">{money(finance.assets-finance.liabilities-finance.equity,currency)}</strong></div>
      </Section>
      <Section title={`Trial balance · as at ${to}`} note="All posted journal activity through the selected end date.">
        {finance.trial.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead><tr className="text-left text-slate-500"><th className="py-2">Account</th><th className="py-2 text-right">Debits</th><th className="py-2 text-right">Credits</th><th className="py-2 text-right">Balance</th></tr></thead><tbody>{finance.trial.map(a=><tr key={a.id} className="border-t border-slate-100"><td className="py-2">{a.code} · {a.name}</td><td className="py-2 text-right font-mono">{money(a.debit,currency)}</td><td className="py-2 text-right font-mono">{money(a.credit,currency)}</td><td className="py-2 text-right font-mono">{money(a.balance,currency)}</td></tr>)}</tbody><tfoot><tr className="border-t border-slate-200 font-semibold"><td className="py-2">Totals</td><td className="py-2 text-right font-mono">{money(finance.debits,currency)}</td><td className="py-2 text-right font-mono">{money(finance.credits,currency)}</td><td className="py-2 text-right font-mono">{money(finance.debits-finance.credits,currency)}</td></tr></tfoot></table></div> : <EmptyRows/>}
      </Section>
      <Section title={`General ledger · ${from || 'All dates'} to ${to}`} note="Posted journal-line detail with source references.">
        {finance.period.length ? <div className="max-h-[480px] overflow-auto"><table className="w-full min-w-[760px] text-xs"><thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="p-2">Date / journal</th><th className="p-2">Account</th><th className="p-2">Source / description</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th></tr></thead><tbody>{finance.period.map(line=><tr key={line.id} className="border-t border-slate-100"><td className="p-2">{line.finance_journal_entries.entry_date}<br/>{line.finance_journal_entries.journal_number}</td><td className="p-2">{line.finance_ledger_accounts.account_code} · {line.finance_ledger_accounts.account_name}</td><td className="p-2">{line.finance_journal_entries.source_type} · {line.finance_journal_entries.description}</td><td className="p-2 text-right font-mono">{money(Number(line.debit),currency)}</td><td className="p-2 text-right font-mono">{money(Number(line.credit),currency)}</td></tr>)}</tbody></table></div> : <EmptyRows/>}
      </Section>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Finance reports are ledger-derived. Operational transactions that have not produced posted journal entries are not included; reconcile source-event status before using these figures as final statutory accounts.</div>
    </>}
  </div>;
}

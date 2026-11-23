import { useState, type FormEvent } from 'react';
import { CheckCircle2, Circle, Landmark, Plus, Wallet } from 'lucide-react';
import { createConfiguredFinancialAccount, createSetupLedgerAccount, mapSetupExpenseCategory, mapSetupPaymentMethod, type SetupExpenseCategory, type SetupFinancialAccount, type SetupLedgerAccount, type SetupPaymentMethod } from './financeSetupService';

type Props = {
 organizationId:string; canManage:boolean; currency:string;
 ledger:SetupLedgerAccount[]; accounts:SetupFinancialAccount[];
 paymentMethods:SetupPaymentMethod[]; categories:SetupExpenseCategory[];
 onChanged:()=>Promise<void>;
};
const input='w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const primary='rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50';
const steps=['Financial accounts','Payment methods','Expense categories'];
export function FinanceSetupView({organizationId,canManage,currency,ledger,accounts,paymentMethods,categories,onChanged}:Props) {
 const [step,setStep]=useState(0),[name,setName]=useState(''),[type,setType]=useState('cash'),[institution,setInstitution]=useState(''),[ledgerId,setLedgerId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [ledgerCode,setLedgerCode]=useState(''),[ledgerName,setLedgerName]=useState(''),[ledgerType,setLedgerType]=useState<'asset'|'liability'|'equity'|'revenue'|'expense'>('asset');
 const [methodMap,setMethodMap]=useState<Record<string,string>>({}),[expenseMap,setExpenseMap]=useState<Record<string,string>>({});
 const assetLedger=ledger.filter(a=>a.is_active&&a.account_type==='asset');
 const expenseLedger=ledger.filter(a=>a.is_active&&a.account_type==='expense');
 const accountDone=accounts.some(a=>a.is_active);
 const paymentDone=paymentMethods.filter(m=>m.is_active).every(m=>!!m.finance_account_id&&accounts.some(a=>a.id===m.finance_account_id&&a.is_active));
 const expenseDone=categories.filter(c=>c.is_active).every(c=>!!c.ledger_account_id);
 const done=[accountDone,paymentDone,expenseDone];
 async function perform(fn:()=>Promise<unknown>) {setBusy(true);setError('');try{await fn();await onChanged();}catch(e){setError(e instanceof Error?e.message:'Setup could not be saved.');}finally{setBusy(false);}}
 async function addAccount(e:FormEvent) {e.preventDefault();if(!canManage)return;if(!ledgerId){setError('Choose the asset ledger account this cash/bank/wallet account represents.');return;}await perform(async()=>{await createConfiguredFinancialAccount({organizationId,name:name.trim(),type,institution,ledgerAccountId:ledgerId});setName('');setInstitution('');});}
 const typeLabel=type==='cash'?'Cash drawer':type==='bank'?'Bank account':type==='mobile_wallet'?'Mobile money / wallet':'POS settlement / other';
 return <section className="space-y-4">
  <div className="rounded-lg border border-slate-200 bg-white p-4">
   <div className="flex items-center gap-2"><Landmark className="h-5 w-5 text-slate-600"/><div><h2 className="text-sm font-semibold text-slate-900">Organisation finance setup</h2><p className="text-xs text-slate-500">Configure real destinations and ledger links before enabling operational posting.</p></div></div>
   <div className="mt-4 grid gap-2 sm:grid-cols-3">{steps.map((s,i)=><button key={s} onClick={()=>setStep(i)} className={'rounded-md border p-3 text-left '+(step===i?'border-slate-900 bg-slate-50':'border-slate-200')}><div className="flex items-center gap-2 text-xs font-semibold">{done[i]?<CheckCircle2 className="h-4 w-4 text-emerald-600"/>:<Circle className="h-4 w-4 text-slate-400"/>}{i+1}. {s}</div><p className="mt-1 text-[11px] text-slate-500">{i===0?'Add actual money-holding destinations':i===1?'Connect each active payment method':'Assign expense categories to expense accounts'}</p></button>)}</div>
   {error&&<p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  </div>
  {step===0&&<div className="rounded-lg border border-slate-200 bg-white p-4">
   <details className="mb-4 rounded-md border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Add a ledger account (use your organisation’s approved code and name)</summary><form className="mt-3 grid gap-2 sm:grid-cols-3" onSubmit={e=>{e.preventDefault();if(!canManage)return;void perform(async()=>{await createSetupLedgerAccount({organizationId,code:ledgerCode,name:ledgerName,type:ledgerType});setLedgerCode('');setLedgerName('');});}}><input required className={input} maxLength={20} value={ledgerCode} onChange={e=>setLedgerCode(e.target.value)} placeholder="Account code"/><input required className={input} maxLength={120} value={ledgerName} onChange={e=>setLedgerName(e.target.value)} placeholder="Account name"/><select className={input} value={ledgerType} onChange={e=>setLedgerType(e.target.value as typeof ledgerType)}><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="revenue">Revenue</option><option value="expense">Expense</option></select><button className={primary+' sm:col-span-3'} disabled={!canManage||busy}>Create ledger account</button></form></details>
   <h3 className="text-sm font-semibold">Add a financial account</h3><p className="mt-1 text-xs text-slate-500">Names and destinations are supplied by your organisation. No full bank account number is requested. Currency is the organisation base currency ({currency}).</p>
   {canManage?<form onSubmit={addAccount} className="mt-4 grid gap-3 sm:grid-cols-2">
    <label className="text-xs font-medium text-slate-600">Account display name<input required maxLength={120} className={input+' mt-1'} value={name} onChange={e=>setName(e.target.value)} placeholder="Enter your own account name"/></label>
    <label className="text-xs font-medium text-slate-600">Destination type<select className={input+' mt-1'} value={type} onChange={e=>setType(e.target.value)}><option value="cash">Cash drawer</option><option value="bank">Bank account</option><option value="mobile_wallet">Mobile money / wallet</option><option value="other">POS settlement / other</option></select></label>
    <label className="text-xs font-medium text-slate-600">Bank / provider (optional)<input className={input+' mt-1'} value={institution} onChange={e=>setInstitution(e.target.value)} placeholder="Optional provider name"/></label>
    <label className="text-xs font-medium text-slate-600">Linked asset ledger account<select required className={input+' mt-1'} value={ledgerId} onChange={e=>setLedgerId(e.target.value)}><option value="">Select the correct ledger account</option>{assetLedger.map(a=><option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}</select></label>
    {!assetLedger.length&&<p className="text-xs text-amber-800 sm:col-span-2">No active asset ledger accounts are available. An authorised manager must add or activate an appropriate asset account in Chart of accounts first.</p>}
    <button disabled={busy||!assetLedger.length} className={primary+' sm:col-span-2'}><Plus className="mr-1 inline h-4 w-4"/>Add {typeLabel}</button>
   </form>:<p className="mt-3 text-xs text-slate-500">An organisation owner, admin or manager must add financial accounts.</p>}
   <div className="mt-5 divide-y divide-slate-100">{accounts.map(a=><div key={a.id} className="flex items-center justify-between py-2 text-sm"><span>{a.account_name} <span className="text-xs text-slate-500">· {a.account_type.replace('_',' ')}</span></span><span className="text-xs text-slate-500">{a.is_active?'Active':'Inactive'}</span></div>)}</div>
  </div>}
  {step===1&&<div className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="text-sm font-semibold">Map payment methods</h3><p className="mt-1 text-xs text-slate-500">Choose the actual account that receives each payment method. Unmapped or inactive destinations remain blocked from posting.</p>{paymentMethods.filter(m=>m.is_active).map(m=><div key={m.id} className="grid gap-2 border-t border-slate-100 py-3 sm:grid-cols-[1fr_1.3fr] sm:items-center"><div><p className="text-sm font-medium">{m.name}</p><p className="text-xs text-slate-500">{m.method_code}</p></div><div className="flex gap-2"><select className={input} value={methodMap[m.id]??m.finance_account_id??''} disabled={!canManage||busy} onChange={e=>setMethodMap(v=>({...v,[m.id]:e.target.value}))}><option value="">Select receiving account</option>{accounts.filter(a=>a.is_active).map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}</select><button className={primary} disabled={!canManage||busy||!(methodMap[m.id]??m.finance_account_id)} onClick={()=>void perform(()=>mapSetupPaymentMethod(organizationId,m.id,methodMap[m.id]??m.finance_account_id!))}>Save</button></div></div>)}
   {!paymentMethods.some(m=>m.is_active)&&<p className="py-4 text-xs text-slate-500">No active payment methods exist for this organisation yet.</p>}
  </div>}
  {step===2&&<div className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="text-sm font-semibold">Map expense categories</h3><p className="mt-1 text-xs text-slate-500">Each expense category must post to the correct active expense ledger account.</p>{categories.filter(c=>c.is_active).map(c=><div key={c.id} className="grid gap-2 border-t border-slate-100 py-3 sm:grid-cols-[1fr_1.3fr] sm:items-center"><p className="text-sm font-medium">{c.name}</p><div className="flex gap-2"><select className={input} value={expenseMap[c.id]??c.ledger_account_id??''} disabled={!canManage||busy} onChange={e=>setExpenseMap(v=>({...v,[c.id]:e.target.value}))}><option value="">Select expense ledger</option>{expenseLedger.map(a=><option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}</select><button className={primary} disabled={!canManage||busy||!(expenseMap[c.id]??c.ledger_account_id)} onClick={()=>void perform(()=>mapSetupExpenseCategory(organizationId,c.id,expenseMap[c.id]??c.ledger_account_id!))}>Save</button></div></div>)}
   {!categories.some(c=>c.is_active)&&<p className="py-4 text-xs text-slate-500">No active expense categories exist for this organisation yet.</p>}
  </div>}
  <div className="flex items-center justify-between"><button className="rounded-md border border-slate-300 px-3 py-2 text-sm" disabled={step===0} onClick={()=>setStep(s=>s-1)}>Previous</button><button className={primary} disabled={step===2} onClick={()=>setStep(s=>s+1)}>Next step</button></div>
  <p className="text-xs text-slate-500"><Wallet className="mr-1 inline h-3.5 w-3.5"/>Setup status: {done.filter(Boolean).length} of 3 sections have at least the required configuration. All active methods and categories must be mapped for full readiness.</p>
 </section>;
}

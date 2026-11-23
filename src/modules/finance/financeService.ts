import { getSupabaseClient } from '../../core/supabase/client';

export type FinanceLedgerAccount = {
  id: string; organization_id: string; account_code: string; account_name: string;
  account_type: 'asset'|'liability'|'equity'|'revenue'|'expense';
  normal_balance: 'debit'|'credit'; is_system_account: boolean; is_active: boolean;
};
export type FinanceAccount = {
  id: string; organization_id: string; account_name: string; account_type: string;
  currency_code: string; ledger_account_id: string; institution_name: string|null;
  account_number_last4: string|null; is_active: boolean;
};
export type FinancePaymentMethod = { id:string; name:string; method_code:string; finance_account_id:string|null; is_active:boolean };
export type FinanceExpenseCategory = { id:string; name:string; is_active:boolean; ledger_account_id:string|null };
export type FinanceSourceStatus = { posted:number; pending:number; reversed:number; skipped:number; events:Array<{id:string;event_type:string;source_id:string;status:string;last_error:string|null;created_at:string;journal_entry_id:string|null}> };
export type FinanceJournalEntry = {
  id: string; journal_number: string; entry_date: string; description: string;
  currency_code: string; status: string; source_type: string; source_id: string|null;
  reversal_of_entry_id: string|null; created_at: string; posted_at: string|null;
};
export type FinanceJournalLine = {
  id: string; journal_entry_id: string; ledger_account_id: string;
  financial_account_id: string|null; line_number: number; description: string|null;
  debit: number; credit: number;
};
export type FinanceBalances = {
  currency: string;
  accounts: Array<{financial_account_id:string;account_name:string;account_type:string;currency_code:string;is_active:boolean;balance:number}>;
  profit_and_loss: {revenue:number;expenses:number;net_profit:number};
  journal_totals: {debits:number;credits:number};
};

function client(): any {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}
function unwrap<T>(result: {data:T|null;error:{message:string}|null}):T {
  if(result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function loadFinanceWorkspace(orgId:string, from:string, to:string) {
  const db = client() as any;
  const [ledgerRes, accountRes, entryRes, balanceRes, paymentMethodRes, sourceStatusRes, expenseCategoryRes, expenseMappingRes] = await Promise.all([
    db.from('finance_ledger_accounts').select('id,organization_id,account_code,account_name,account_type,normal_balance,is_system_account,is_active').eq('organization_id',orgId).order('account_code'),
    db.from('finance_accounts').select('id,organization_id,account_name,account_type,currency_code,ledger_account_id,institution_name,account_number_last4,is_active').eq('organization_id',orgId).order('account_name'),
    db.from('finance_journal_entries').select('id,journal_number,entry_date,description,currency_code,status,source_type,source_id,reversal_of_entry_id,created_at,posted_at').eq('organization_id',orgId).order('entry_date',{ascending:false}).order('created_at',{ascending:false}).limit(100),
    db.rpc('finance_get_balances',{p_organization_id:orgId,p_date_from:from||null,p_date_to:to||null}),
    db.from('payment_methods').select('id,name,method_code,finance_account_id,is_active').eq('organization_id',orgId).order('name'),
    db.rpc('finance_get_source_status',{p_organization_id:orgId}),
    db.from('expense_categories').select('id,name,is_active').eq('organization_id',orgId).order('name'),
    db.from('finance_expense_category_mappings').select('expense_category_id,ledger_account_id').eq('organization_id',orgId),
  ]);
  return {
    ledgerAccounts: unwrap<FinanceLedgerAccount[]>(ledgerRes),
    financialAccounts: unwrap<FinanceAccount[]>(accountRes),
    entries: unwrap<FinanceJournalEntry[]>(entryRes),
    balances: unwrap<FinanceBalances>(balanceRes),
    paymentMethods: unwrap<FinancePaymentMethod[]>(paymentMethodRes),
    sourceStatus: unwrap<FinanceSourceStatus>(sourceStatusRes),
    expenseCategories: unwrap<Array<{id:string;name:string;is_active:boolean}>>(expenseCategoryRes).map(category=>({ ...category, ledger_account_id: unwrap<Array<{expense_category_id:string;ledger_account_id:string}>>(expenseMappingRes).find(mapping=>mapping.expense_category_id===category.id)?.ledger_account_id??null })),
  };
}

export async function mapExpenseCategory(orgId:string,categoryId:string,ledgerAccountId:string) {
  return unwrap<void>(await client().rpc('finance_map_expense_category',{p_organization_id:orgId,p_expense_category_id:categoryId,p_ledger_account_id:ledgerAccountId}));
}
export async function retryFinanceSourceEvents(orgId:string) {
  return unwrap<{posted:number;pending:number;skipped:number;reversed:number}>(await client().rpc('finance_retry_pending_events',{p_organization_id:orgId}));
}
export async function mapPaymentMethod(orgId:string,methodId:string,financialAccountId:string) {
  return unwrap<void>(await client().rpc('finance_map_payment_method',{
    p_organization_id:orgId,p_payment_method_id:methodId,p_financial_account_id:financialAccountId,
  }));
}
export async function loadJournalLines(orgId:string, entryId:string) {
  const db=client() as any;
  const res=await db.from('finance_journal_lines')
    .select('id,journal_entry_id,ledger_account_id,financial_account_id,line_number,description,debit,credit')
    .eq('organization_id',orgId).eq('journal_entry_id',entryId).order('line_number');
  return unwrap<FinanceJournalLine[]>(res);
}
export async function createFinancialAccount(input:{
  organizationId:string;name:string;type:string;institution:string;last4:string;
}) {
  return unwrap<string>(await client().rpc('finance_create_account',{
    p_organization_id:input.organizationId,p_account_name:input.name,p_account_type:input.type,
    p_institution_name:input.institution||null,p_account_number_last4:input.last4||null,p_ledger_account_id:null,
  }));
}
export async function updateFinancialAccount(input:{
  organizationId:string;id:string;name:string;institution:string;last4:string;
}) {
  return unwrap<void>(await client().rpc('finance_update_account',{
    p_organization_id:input.organizationId,p_financial_account_id:input.id,p_account_name:input.name,
    p_institution_name:input.institution||null,p_account_number_last4:input.last4||null,
  }));
}
export async function setFinancialAccountActive(orgId:string,id:string,active:boolean) {
  return unwrap<void>(await client().rpc('finance_set_account_active',{
    p_organization_id:orgId,p_financial_account_id:id,p_is_active:active,
  }));
}
export async function createOpeningBalance(orgId:string,accountId:string,amount:number,date:string,key:string) {
  return unwrap<string>(await client().rpc('finance_opening_balance',{
    p_organization_id:orgId,p_financial_account_id:accountId,p_amount:amount,p_as_of_date:date,p_idempotency_key:key,
  }));
}
export async function transferFunds(input:{
  organizationId:string;fromId:string;toId:string;amount:number;date:string;description:string;key:string;
}) {
  return unwrap<string>(await client().rpc('finance_transfer',{
    p_organization_id:input.organizationId,p_from_account_id:input.fromId,p_to_account_id:input.toId,
    p_amount:input.amount,p_transfer_date:input.date,p_description:input.description,p_idempotency_key:input.key,
  }));
}
export async function postManualJournal(input:{
  organizationId:string;date:string;description:string;key:string;
  lines:Array<{ledger_account_id:string;financial_account_id?:string|null;debit:number;credit:number;description?:string}>;
}) {
  return unwrap<string>(await client().rpc('finance_post_journal',{
    p_organization_id:input.organizationId,p_entry_date:input.date,p_description:input.description,
    p_source_type:'manual',p_source_id:null,p_idempotency_key:input.key,p_lines:input.lines,
  }));
}
export async function reverseJournal(orgId:string,entryId:string,reason:string,key:string) {
  return unwrap<string>(await client().rpc('finance_reverse_journal',{
    p_organization_id:orgId,p_entry_id:entryId,p_reason:reason,p_idempotency_key:key,
  }));
}

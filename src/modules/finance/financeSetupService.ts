import { getSupabaseClient } from '../../core/supabase/client';

export type SetupLedgerAccount = { id:string; account_code:string; account_name:string; account_type:string; is_active:boolean };
export type SetupFinancialAccount = { id:string; account_name:string; account_type:string; ledger_account_id:string; is_active:boolean };
export type SetupPaymentMethod = { id:string; name:string; method_code:string; finance_account_id:string|null; is_active:boolean };
export type SetupExpenseCategory = { id:string; name:string; ledger_account_id:string|null; is_active:boolean };

function client():any { const db=getSupabaseClient(); if(!db) throw new Error('Supabase is not configured.'); return db; }
function unwrap<T>(r:{data:T|null;error:{message:string}|null}):T { if(r.error) throw new Error(r.error.message); return r.data as T; }
export async function createConfiguredFinancialAccount(input:{organizationId:string;name:string;type:string;institution:string;ledgerAccountId:string}) {
 return unwrap<string>(await client().rpc('finance_create_account',{p_organization_id:input.organizationId,p_account_name:input.name,p_account_type:input.type,p_institution_name:input.institution||null,p_account_number_last4:null,p_ledger_account_id:input.ledgerAccountId}));
}
export async function mapSetupPaymentMethod(orgId:string,methodId:string,accountId:string) {
 return unwrap<void>(await client().rpc('finance_map_payment_method',{p_organization_id:orgId,p_payment_method_id:methodId,p_financial_account_id:accountId}));
}
export async function mapSetupExpenseCategory(orgId:string,categoryId:string,ledgerId:string) {
 return unwrap<void>(await client().rpc('finance_map_expense_category',{p_organization_id:orgId,p_expense_category_id:categoryId,p_ledger_account_id:ledgerId}));
}

export async function createSetupLedgerAccount(input:{organizationId:string;code:string;name:string;type:'asset'|'liability'|'equity'|'revenue'|'expense'}) {
 const normal=input.type==='asset'||input.type==='expense'?'debit':'credit';
 return unwrap<string>(await client().rpc('finance_create_ledger_account',{p_organization_id:input.organizationId,p_account_code:input.code,p_account_name:input.name,p_account_type:input.type,p_normal_balance:normal}));
}

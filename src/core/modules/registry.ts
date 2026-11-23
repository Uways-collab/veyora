import type { ModuleDefinition, ModuleGroup, ModuleId } from '../types/domain';

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  overview: 'Overview',
  operations: 'Operations',
  financial: 'Finance & Intelligence',
  administration: 'Administration',
};

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    group: 'overview',
    stage: 'foundation_active',
    summary:
      'Central operational workspace summarizing organisation status, connected modules, and real-time activity.',
    primaryEntities: ['Organisation Summary', 'Audit Trail', 'System Readiness'],
    plannedTables: ['organizations', 'organization_memberships', 'organization_audit_log'],
    connectedModules: ['inventory', 'sales', 'purchases', 'finance', 'reports'],
    targetPhase: 'Stage 1 (Active Foundation)',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    group: 'operations',
    stage: 'foundation_active',
    summary:
      'Catalog products, product categories, variants, multi-location stock balances, movements, and transfers.',
    primaryEntities: ['Products & SKUs', 'Categories', 'Locations', 'Stock Balances & Movements'],
    plannedTables: [
      'products',
      'product_variants',
      'product_categories',
      'inventory_locations',
      'inventory_balances',
      'stock_movements',
      'stock_transfers',
      'stock_transfer_items',
    ],
    connectedModules: ['sales', 'purchases', 'suppliers', 'reports'],
    targetPhase: 'Phase 1 (Active Overview)',
  },
  {
    id: 'sales',
    label: 'Sales',
    group: 'operations',
    stage: 'foundation_active',
    summary:
      'Point-of-sale checkout, split and follow-up credit payments, customer receipts, returns, refunds, and payment methods.',
    primaryEntities: ['POS Checkout', 'Sales History', 'Returns & Refunds', 'Payment Methods'],
    plannedTables: [
      'sales',
      'sale_items',
      'sale_payments',
      'sales_returns',
      'sales_return_items',
      'sale_refunds',
      'payment_methods',
    ],
    connectedModules: ['inventory', 'customers', 'finance', 'reports'],
    targetPhase: 'Phase 2 (Active Sales & POS)',
  },
  {
    id: 'customers',
    label: 'Customers',
    group: 'operations',
    stage: 'foundation_active',
    summary:
      'Active customer directory with search, contact details, address notes, and role-governed lifecycle management.',
    primaryEntities: ['Customer Directory', 'Contact Details', 'Address & Notes'],
    plannedTables: ['customers'],
    connectedModules: ['sales', 'finance', 'reports'],
    targetPhase: 'Active Customer Directory',
  },
  {
    id: 'purchases',
    label: 'Purchases',
    group: 'operations',
    stage: 'foundation_active',
    summary:
      'Supplier directory, purchase drafts, confirmed purchase orders, and procurement tracking.',
    primaryEntities: ['Purchase Orders', 'Purchase Drafts', 'Suppliers Directory', 'Payment Terms'],
    plannedTables: ['suppliers', 'purchases', 'purchase_items'],
    connectedModules: ['inventory', 'finance', 'reports'],
    targetPhase: 'Active Purchase Orders & Suppliers',
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    group: 'operations',
    stage: 'foundation_active',
    summary:
      'Active supplier directory with contact details, payment terms, search, and archive or restore management.',
    primaryEntities: ['Supplier Directory', 'Contact Details', 'Payment Terms'],
    plannedTables: ['suppliers'],
    connectedModules: ['purchases', 'inventory', 'finance'],
    targetPhase: 'Active Suppliers Directory',
  },
  {
    id: 'expenses',
    label: 'Expenses',
    group: 'financial',
    stage: 'foundation_active',
    summary:
      'Business expense recording, categories, receipt attachments, audit history, and currency-grouped expense reporting.',
    primaryEntities: ['Expense Ledger', 'Expense Categories', 'Receipts', 'Audit Trail'],
    plannedTables: ['expenses', 'expense_categories', 'expense_sequences', 'expense_audit_logs'],
    connectedModules: ['finance', 'reports'],
    targetPhase: 'Active Expenses',
  },
  {
    id: 'finance',
    label: 'Finance',
    group: 'financial',
    stage: 'foundation_active',
    summary:
      'Double-entry general ledger, cash and bank accounts, journal entries, opening balances, transfers, and ledger-based financial reporting.',
    primaryEntities: ['Chart of Accounts', 'Cash & Bank Accounts', 'Journal Entries', 'Financial Reports'],
    plannedTables: ['finance_ledger_accounts', 'finance_accounts', 'finance_journal_entries', 'finance_journal_lines'],
    connectedModules: ['sales', 'purchases', 'customers', 'suppliers', 'reports'],
    targetPhase: 'Finance Foundation Active',
  },
  {
    id: 'reports',
    label: 'Reports',
    group: 'financial',
    stage: 'foundation_active',
    summary:
      'Central operational reporting workspace. Inventory reports are active with read-only metrics and CSV exports; Sales, Purchases, and Finance reports are upcoming.',
    primaryEntities: [
      'Inventory Reports (Active)',
      'Sales Reports (Upcoming)',
      'Purchases Reports (Upcoming)',
      'Finance Reports (Upcoming)',
    ],
    plannedTables: [
      'inventory_balances',
      'stock_movements',
      'stock_transfers',
      'products',
      'product_variants',
    ],
    connectedModules: ['inventory', 'sales', 'purchases', 'finance'],
    targetPhase: 'Inventory Active · Other Domains Upcoming',
  },
  {
    id: 'settings',
    label: 'Settings',
    group: 'administration',
    stage: 'foundation_active',
    summary:
      'Supabase connection status, authentication, organisation profile, member roles, and RLS security inspection.',
    primaryEntities: ['Organisation Profile', 'Authentication', 'Supabase & RLS', 'Storage Policies'],
    plannedTables: ['organizations', 'organization_memberships', 'profiles'],
    connectedModules: ['dashboard'],
    targetPhase: 'Stage 1 (Active Foundation)',
  },
];

export function getModuleById(id: ModuleId): ModuleDefinition {
  const found = MODULE_REGISTRY.find((m) => m.id === id);
  if (!found) {
    return MODULE_REGISTRY[0];
  }
  return found;
}

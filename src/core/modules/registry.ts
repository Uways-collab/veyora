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
    plannedTables: ['organizations', 'organization_memberships', 'audit_logs'],
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
    stage: 'planned_module',
    summary:
      'Procurement workflows covering purchase requisitions, supplier orders, goods received notes, and landed costs.',
    primaryEntities: ['Purchase Orders', 'Goods Receipts', 'Supplier Bills', 'Cost Allocations'],
    plannedTables: ['purchase_orders', 'purchase_order_lines', 'goods_receipts'],
    connectedModules: ['inventory', 'suppliers', 'finance', 'reports'],
    targetPhase: 'Phase 3',
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    group: 'operations',
    stage: 'planned_module',
    summary:
      'Vendor profiles, lead-time agreements, supplier SKU pricing, payment terms, and compliance documents.',
    primaryEntities: ['Vendor Directory', 'Supplier Catalogs', 'Lead Times', 'Vendor Documents'],
    plannedTables: ['suppliers', 'supplier_contacts', 'supplier_products'],
    connectedModules: ['purchases', 'inventory', 'finance'],
    targetPhase: 'Phase 2',
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
    stage: 'planned_module',
    summary:
      'Double-entry general ledger, accounts payable and receivable, payment reconciliation, and tax configuration.',
    primaryEntities: ['Chart of Accounts', 'Journal Entries', 'Receivables', 'Payables'],
    plannedTables: ['ledger_accounts', 'journal_entries', 'payments', 'tax_rates'],
    connectedModules: ['sales', 'purchases', 'customers', 'suppliers', 'reports'],
    targetPhase: 'Phase 5',
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

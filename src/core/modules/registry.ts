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
      'Central operational reporting workspace with live inventory, sales, purchases, and finance reporting.',
    primaryEntities: [
      'Inventory Reports (Active)',
      'Sales Reports (Active)',
      'Purchases Reports (Active)',
      'Finance Reports (Active)',
    ],
    plannedTables: [
      'inventory_balances',
      'stock_movements',
      'stock_transfers',
      'products',
      'product_variants',
    ],
    connectedModules: ['inventory', 'sales', 'purchases', 'finance'],
    targetPhase: 'Inventory, Sales, Purchases & Finance Reports Active',
  },
  {
    id: 'ai_assistant',
    label: 'AI Assistant',
    group: 'financial',
    stage: 'foundation_active',
    summary: 'Read-only, organisation-scoped AI guidance using approved operational summaries and metered model usage.',
    primaryEntities: ['Business Questions', 'Operational Summaries', 'AI Usage'],
    plannedTables: ['ai_usage_records'],
    connectedModules: ['dashboard', 'inventory', 'sales', 'customers', 'finance', 'reports'],
    targetPhase: 'AI Assistant (Initial Release)',
  },
  {
    id: 'billing',
    label: 'Subscription & Billing',
    group: 'administration',
    stage: 'foundation_active',
    summary: 'Owner-only subscription plan selection, trial setup, Paystack payment method management and billing history.',
    primaryEntities: ['Subscription Plans', 'Organisation Subscription', 'Billing Transactions'],
    plannedTables: ['subscription_plans', 'organization_subscriptions', 'billing_transactions'],
    connectedModules: ['settings'],
    targetPhase: 'Commercial Billing Foundation',
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

  { id: 'dealer_stock', label: 'Vehicle Inventory', group: 'operations', stage: 'foundation_active', summary: 'Manage dealership vehicle stock.', primaryEntities: ['Vehicles'], plannedTables: ['dealer_vehicles'], connectedModules: ['dealer_deals','dealer_leads'], targetPhase: 'Active Dealership Operations' },
  { id: 'dealer_leads', label: 'Customers & Leads', group: 'operations', stage: 'foundation_active', summary: 'Manage customer enquiries and follow-ups.', primaryEntities: ['Leads'], plannedTables: ['dealer_leads'], connectedModules: ['dealer_test_drives','dealer_deals'], targetPhase: 'Active Dealership Operations' },
  { id: 'dealer_test_drives', label: 'Test Drives', group: 'operations', stage: 'foundation_active', summary: 'Schedule and track vehicle test drives.', primaryEntities: ['Test Drives'], plannedTables: ['dealer_test_drives'], connectedModules: ['dealer_stock','dealer_leads'], targetPhase: 'Active Dealership Operations' },
  { id: 'dealer_deals', label: 'Sales & Deals', group: 'operations', stage: 'foundation_active', summary: 'Track vehicle deals, payments and deliveries.', primaryEntities: ['Vehicle Deals'], plannedTables: ['dealer_deals','dealer_payments'], connectedModules: ['dealer_stock','finance'], targetPhase: 'Active Dealership Operations' },
  { id: 'dealer_workshop', label: 'Workshop', group: 'operations', stage: 'foundation_active', summary: 'Manage vehicle service jobs.', primaryEntities: ['Service Jobs'], plannedTables: ['dealer_service_jobs'], connectedModules: ['dealer_stock','finance'], targetPhase: 'Active Dealership Operations' },
  { id: 'dealer_reports', label: 'Dealership Reports', group: 'financial', stage: 'foundation_active', summary: 'Review dealership stock and sales performance.', primaryEntities: ['Dealership Metrics'], plannedTables: ['dealer_vehicles','dealer_deals','dealer_leads'], connectedModules: ['dealer_stock','dealer_deals'], targetPhase: 'Active Dealership Operations' },
  { id: 'hotel_reservations', label: 'Reservations', group: 'operations', stage: 'foundation_active', summary: 'Manage guest bookings and stay dates.', primaryEntities: ['Reservations'], plannedTables: ['hotel_reservations'], connectedModules: ['hotel_rooms'], targetPhase: 'Active Hotel Operations' },
  { id: 'hotel_rooms', label: 'Room Management', group: 'operations', stage: 'foundation_active', summary: 'Manage room inventory, rates and readiness.', primaryEntities: ['Rooms'], plannedTables: ['hotel_rooms'], connectedModules: ['hotel_reservations','hotel_housekeeping'], targetPhase: 'Active Hotel Operations' },
  { id: 'hotel_housekeeping', label: 'Housekeeping', group: 'operations', stage: 'foundation_active', summary: 'Manage cleaning and room-turnover tasks.', primaryEntities: ['Housekeeping Tasks'], plannedTables: ['hotel_housekeeping_tasks'], connectedModules: ['hotel_rooms'], targetPhase: 'Active Hotel Operations' },
  { id: 'hotel_reports', label: 'Hotel Reports', group: 'financial', stage: 'foundation_active', summary: 'Review occupancy, booking value and housekeeping workload.', primaryEntities: ['Hotel Metrics'], plannedTables: ['hotel_rooms','hotel_reservations','hotel_housekeeping_tasks'], connectedModules: ['hotel_reservations','hotel_rooms'], targetPhase: 'Active Hotel Operations' },
  { id: 'restaurant_pos', label: 'Restaurant POS', group: 'operations', stage: 'foundation_active', summary: 'Take restaurant orders, record payments and print or reprint customer receipts.', primaryEntities: ['POS Checkout','Restaurant Orders','Payments','Receipts'], plannedTables: ['restaurant_orders','restaurant_order_items','restaurant_order_payments'], connectedModules: ['restaurant_operations','finance'], targetPhase: 'Active Restaurant POS' },
  { id: 'restaurant_operations', label: 'Restaurant Operations', group: 'operations', stage: 'foundation_active', summary: 'Manage menu, tables, orders, kitchen workflow and payments.', primaryEntities: ['Menu','Tables','Orders','Kitchen Tickets'], plannedTables: ['restaurant_menu_items','restaurant_tables','restaurant_orders'], connectedModules: ['inventory','finance'], targetPhase: 'Active Restaurant Operations' },
];

export function getModuleById(id: ModuleId): ModuleDefinition {
  const found = MODULE_REGISTRY.find((m) => m.id === id);
  if (!found) {
    return MODULE_REGISTRY[0];
  }
  return found;
}

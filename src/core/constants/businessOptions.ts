import type { BusinessCategory, BusinessType, OrganisationRoleDefinition } from '../types/domain';

export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string; description: string }[] = [
  {
    value: 'retail',
    label: 'Retail Store / Shop',
    description: 'Direct-to-consumer storefront, POS, and multi-channel retail',
  },
  {
    value: 'wholesale',
    label: 'Wholesale Trading',
    description: 'B2B bulk orders, tiered pricing, and account terms',
  },
  {
    value: 'distribution',
    label: 'Distribution & Logistics',
    description: 'Multi-warehouse stock allocation and supplier procurement',
  },
  {
    value: 'services',
    label: 'Business Services',
    description: 'Service invoicing, client accounts, and expense management',
  },
  {
    value: 'hybrid',
    label: 'Hybrid Operations',
    description: 'Combined retail, wholesale, and service workflows',
  },
];


export const BUSINESS_CATEGORY_OPTIONS: { value: BusinessCategory; label: string; description: string }[] = [
  { value: 'retail', label: 'Retail & E-commerce', description: 'Shops, POS, online orders and stock control' },
  { value: 'wholesale', label: 'Wholesale', description: 'Bulk orders, trade pricing and account customers' },
  { value: 'distribution', label: 'Distribution', description: 'Warehouses, stock allocation and supplier networks' },
  { value: 'services', label: 'Professional Services', description: 'Client work, service billing and expenses' },
  { value: 'hybrid', label: 'Multi-activity Business', description: 'A combination of products, trade and services' },
  { value: 'hotel', label: 'Hotels & Hospitality', description: 'Rooms, reservations, guests and housekeeping' },
  { value: 'car_dealership', label: 'Car Dealerships', description: 'Vehicle inventory, deals, deposits and margins' },
  { value: 'real_estate', label: 'Real Estate', description: 'Properties, units, tenants, leases and rent' },
  { value: 'restaurant', label: 'Restaurants & Food Service', description: 'Menus, tables, orders and kitchen operations' },
  { value: 'logistics', label: 'Logistics & Fleet', description: 'Vehicles, dispatch, deliveries and routes' },
  { value: 'manufacturing', label: 'Manufacturing', description: 'Raw materials, production and finished goods' },
];

export const COUNTRY_OPTIONS: { name: string; defaultCurrency: string; defaultTimezone: string }[] = [
  { name: 'United States', defaultCurrency: 'USD', defaultTimezone: 'America/New_York' },
  { name: 'United Kingdom', defaultCurrency: 'GBP', defaultTimezone: 'Europe/London' },
  { name: 'Canada', defaultCurrency: 'CAD', defaultTimezone: 'America/Toronto' },
  { name: 'Australia', defaultCurrency: 'AUD', defaultTimezone: 'Australia/Sydney' },
  { name: 'Germany', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Berlin' },
  { name: 'France', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Paris' },
  { name: 'Netherlands', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Amsterdam' },
  { name: 'Ireland', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Dublin' },
  { name: 'Nigeria', defaultCurrency: 'NGN', defaultTimezone: 'Africa/Lagos' },
  { name: 'Kenya', defaultCurrency: 'KES', defaultTimezone: 'Africa/Nairobi' },
  { name: 'South Africa', defaultCurrency: 'ZAR', defaultTimezone: 'Africa/Johannesburg' },
  { name: 'Ghana', defaultCurrency: 'GHS', defaultTimezone: 'Africa/Accra' },
  { name: 'United Arab Emirates', defaultCurrency: 'AED', defaultTimezone: 'Asia/Dubai' },
  { name: 'Singapore', defaultCurrency: 'SGD', defaultTimezone: 'Asia/Singapore' },
  { name: 'India', defaultCurrency: 'INR', defaultTimezone: 'Asia/Kolkata' },
  { name: 'Other', defaultCurrency: 'USD', defaultTimezone: 'UTC' },
];

export const CURRENCY_OPTIONS: { code: string; name: string; label: string }[] = [
  { code: 'USD', name: 'US Dollar', label: 'USD — US Dollar' },
  { code: 'GBP', name: 'British Pound', label: 'GBP — British Pound' },
  { code: 'EUR', name: 'Euro', label: 'EUR — Euro' },
  { code: 'CAD', name: 'Canadian Dollar', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar', label: 'AUD — Australian Dollar' },
  { code: 'NGN', name: 'Nigerian Naira', label: 'NGN — Nigerian Naira' },
  { code: 'KES', name: 'Kenyan Shilling', label: 'KES — Kenyan Shilling' },
  { code: 'ZAR', name: 'South African Rand', label: 'ZAR — South African Rand' },
  { code: 'GHS', name: 'Ghanaian Cedi', label: 'GHS — Ghanaian Cedi' },
  { code: 'AED', name: 'UAE Dirham', label: 'AED — UAE Dirham' },
  { code: 'SGD', name: 'Singapore Dollar', label: 'SGD — Singapore Dollar' },
  { code: 'INR', name: 'Indian Rupee', label: 'INR — Indian Rupee' },
];

export function getCurrencyName(code: string | null | undefined): string | null {
  const normalized = (code ?? '').trim().toUpperCase();
  if (!normalized) return null;

  const known = CURRENCY_OPTIONS.find((item) => item.code === normalized);
  if (known) {
    return known.name;
  }

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
      const resolved = displayNames.of(normalized);
      if (resolved && resolved.toUpperCase() !== normalized) {
        return resolved;
      }
    }
  } catch {
    // Ignore Intl errors for unsupported currency codes
  }

  return null;
}

export function formatCurrencyDisplay(code: string | null | undefined): string {
  const normalized = (code ?? '').trim().toUpperCase();
  if (!normalized) return '—';
  const name = getCurrencyName(normalized);
  return name ? `${normalized} (${name})` : normalized;
}

export const ORGANISATION_ROLES: OrganisationRoleDefinition[] = [
  {
    key: 'owner',
    label: 'Owner',
    description: 'Full control over business profile, security policies, and member roles.',
    rank: 100,
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Manage business configuration, operational workflows, and Manager/Staff members.',
    rank: 80,
  },
  {
    key: 'manager',
    label: 'Manager',
    description: 'Oversee daily operations, approvals, and team workflows.',
    rank: 50,
  },
  {
    key: 'staff',
    label: 'Staff',
    description: 'Standard operational access within assigned workspace modules.',
    rank: 20,
  },
];

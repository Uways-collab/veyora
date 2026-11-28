export type ModuleId =
  | 'dashboard'
  | 'inventory'
  | 'sales'
  | 'customers'
  | 'purchases'
  | 'suppliers'
  | 'expenses'
  | 'finance'
  | 'reports'
  | 'ai_assistant'
  | 'billing'
  | 'settings'
  | 'dealer_stock' | 'dealer_leads' | 'dealer_test_drives' | 'dealer_deals' | 'dealer_workshop' | 'dealer_reports'
  | 'hotel_reservations' | 'hotel_rooms' | 'hotel_housekeeping' | 'hotel_reports'
  | 'restaurant_operations' | 'restaurant_pos'
  | 'real_estate_leases' | 'real_estate_reports'
  | 'logistics_dispatch' | 'logistics_tracking' | 'logistics_reports'
  | 'manufacturing_orders' | 'manufacturing_quality' | 'manufacturing_reports';

export type ModuleGroup = 'overview' | 'operations' | 'financial' | 'administration';
export type ModuleStage = 'foundation_active' | 'planned_module';
export type OrganisationRole = 'owner' | 'admin' | 'manager' | 'staff';
export type BusinessType = BusinessCategory;

export type BusinessCategory =
  | 'retail' | 'wholesale' | 'distribution' | 'services' | 'hybrid'
  | 'hotel' | 'car_dealership' | 'real_estate' | 'restaurant' | 'logistics' | 'manufacturing';

export interface OrganisationRoleDefinition {
  key: OrganisationRole;
  label: string;
  description: string;
  rank: number;
}
export interface Organisation {
  id: string;
  name: string;
  slug: string;
  business_type: BusinessType;
  country: string;
  base_currency: string;
  timezone: string;
  business_email: string | null;
  business_phone: string | null;
  receipt_settings: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface OrganisationMembership {
  id: string;
  organisation_id: string;
  user_id: string;
  role: OrganisationRole;
  is_active: boolean;
  created_at: string;
  organisation: Organisation;
}
export interface OrganisationMemberRecord {
  id: string;
  organisation_id: string;
  user_id: string;
  role: OrganisationRole;
  is_active: boolean;
  created_at: string;
  profile: { id: string; email: string; full_name: string | null } | null;
}
export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}
export interface AuditLogEntry {
  id: string;
  organisation_id: string;
  actor_user_id: string | null;
  module: ModuleId;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  group: ModuleGroup;
  stage: ModuleStage;
  summary: string;
  primaryEntities: string[];
  plannedTables: string[];
  connectedModules: ModuleId[];
  targetPhase: string;
}

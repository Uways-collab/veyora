export type ModuleId =
  | 'dashboard'
  | 'inventory'
  | 'sales'
  | 'customers'
  | 'purchases'
  | 'suppliers'
  | 'finance'
  | 'reports'
  | 'settings';

export type ModuleGroup =
  | 'overview'
  | 'operations'
  | 'financial'
  | 'administration';

export type ModuleStage = 'foundation_active' | 'planned_module';

export type OrganisationRole = 'owner' | 'admin' | 'manager' | 'staff';

export type BusinessType =
  | 'retail'
  | 'wholesale'
  | 'distribution'
  | 'services'
  | 'hybrid';

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
  profile: {
    id: string;
    email: string;
    full_name: string | null;
  } | null;
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

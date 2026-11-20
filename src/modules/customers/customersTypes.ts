import type { OrganisationRole } from '../../core/types/domain';

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CustomerMutationInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface CustomerSearchResult {
  customers: CustomerRecord[];
  hitLimit: boolean;
  error: string | null;
}

export interface CustomerMutationResult {
  customer: CustomerRecord | null;
  customerId: string | null;
  error: string | null;
}

export function canManageCustomers(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

import type { OrganisationRole } from '../../core/types/domain';

export interface SupplierRecord {
  id: string;
  organizationId: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number;
  notes: string | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SupplierMutationInput {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  paymentTerms: string;
  address: string;
  notes: string;
}

export interface SupplierSearchResult {
  suppliers: SupplierRecord[];
  hitLimit: boolean;
  error: string | null;
}

export interface SupplierMutationResult {
  supplier: SupplierRecord | null;
  supplierId: string | null;
  error: string | null;
}

export function canManageSuppliers(role: OrganisationRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

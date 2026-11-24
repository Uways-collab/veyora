import type { BusinessType, ModuleId, OrganisationRole } from '../types/domain';

type InventoryTableRecord = {
  Row: Record<string, unknown> & {
    id?: string;
    organization_id?: string;
    organisation_id?: string;
    is_active?: boolean;
    created_at?: string;
    updated_at?: string;
  };
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organisation_roles: {
        Row: {
          key: OrganisationRole;
          label: string;
          description: string;
          rank: number;
          created_at: string;
        };
        Insert: {
          key: OrganisationRole;
          label: string;
          description: string;
          rank: number;
          created_at?: string;
        };
        Update: {
          label?: string;
          description?: string;
          rank?: number;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          business_type: BusinessType;
          country: string;
          currency: string;
          timezone: string;
          email: string | null;
          phone: string | null;
          receipt_settings: Record<string, unknown> | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          business_type?: BusinessType;
          country?: string;
          currency?: string;
          timezone?: string;
          email?: string | null;
          phone?: string | null;
          receipt_settings?: Record<string, unknown> | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          business_type?: BusinessType;
          country?: string;
          currency?: string;
          timezone?: string;
          email?: string | null;
          phone?: string | null;
          receipt_settings?: Record<string, unknown> | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_business_types: InventoryTableRecord;
      organization_memberships: {
        Row: {
          id: string;
          organization_id?: string;
          organisation_id?: string;
          user_id: string;
          role: OrganisationRole;
          is_active?: boolean;
          created_at: string;
          updated_at?: string;
        };
        Insert: {
          id?: string;
          organization_id?: string;
          organisation_id?: string;
          user_id: string;
          role?: OrganisationRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          role?: OrganisationRole;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          organisation_id: string;
          actor_user_id: string | null;
          module: ModuleId;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          organisation_id: string;
          actor_user_id?: string | null;
          module: ModuleId;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          action?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_organisation_id_fkey';
            columns: ['organisation_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      products: {
        Row: {
          id: string;
          organization_id: string;
          category_id: string | null;
          name: string;
          description: string | null;
          product_type: string;
          image_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          category_id?: string | null;
          name: string;
          description?: string | null;
          product_type: string;
          image_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          name?: string;
          description?: string | null;
          product_type?: string;
          image_url?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'products_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'product_categories';
            referencedColumns: ['id'];
          }
        ];
      };
      product_variants: {
        Row: {
          id: string;
          organization_id: string;
          product_id: string;
          variant_name: string;
          sku: string;
          barcode: string | null;
          unit_of_measure: string;
          cost_price: number;
          selling_price: number;
          attributes: Record<string, unknown>;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          product_id: string;
          variant_name: string;
          sku: string;
          barcode?: string | null;
          unit_of_measure: string;
          cost_price: number;
          selling_price: number;
          attributes?: Record<string, unknown>;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          variant_name?: string;
          sku?: string;
          barcode?: string | null;
          unit_of_measure?: string;
          cost_price?: number;
          selling_price?: number;
          attributes?: Record<string, unknown>;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'product_variants_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_variants_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          }
        ];
      };
      product_categories: {
        Row: {
          id: string;
          organization_id: string;
          parent_id: string | null;
          name: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          parent_id?: string | null;
          name: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          parent_id?: string | null;
          name?: string;
          description?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_categories_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'product_categories';
            referencedColumns: ['id'];
          }
        ];
      };
      inventory_locations: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          location_type: string;
          address: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          location_type: string;
          address?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          location_type?: string;
          address?: string | null;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_locations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      inventory_balances: {
        Row: {
          id: string;
          organization_id: string;
          variant_id: string;
          location_id: string;
          quantity: number;
          reorder_level: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          variant_id: string;
          location_id: string;
          quantity?: number;
          reorder_level?: number;
          updated_at?: string;
        };
        Update: {
          quantity?: number;
          reorder_level?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_balances_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_balances_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_balances_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'inventory_locations';
            referencedColumns: ['id'];
          }
        ];
      };
      stock_movements: InventoryTableRecord;
      stock_transfers: {
        Row: {
          id: string;
          organization_id: string;
          source_location_id: string;
          destination_location_id: string;
          status: string;
          notes: string | null;
          created_by: string | null;
          completed_by: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          source_location_id: string;
          destination_location_id: string;
          status?: string;
          notes?: string | null;
          created_by?: string | null;
          completed_by?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          status?: string;
          notes?: string | null;
          completed_by?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      stock_transfer_items: {
        Row: {
          id: string;
          organization_id: string;
          transfer_id: string;
          variant_id: string;
          quantity: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          transfer_id: string;
          variant_id: string;
          quantity: number;
        };
        Update: {
          quantity?: number;
        };
        Relationships: [];
      };
      payment_methods: InventoryTableRecord;
      sale_sequences: InventoryTableRecord;
      sales: InventoryTableRecord;
      sale_items: InventoryTableRecord;
      sale_payments: InventoryTableRecord;
      sales_returns: InventoryTableRecord;
      sales_return_items: InventoryTableRecord;
      sale_refunds: InventoryTableRecord;
      customers: InventoryTableRecord;
      expense_categories: InventoryTableRecord;
      expense_sequences: InventoryTableRecord;
      expenses: InventoryTableRecord;
      expense_audit_logs: InventoryTableRecord;
      suppliers: InventoryTableRecord;
      purchases: InventoryTableRecord;
      purchase_orders: InventoryTableRecord;
      purchase_items: InventoryTableRecord;
      purchase_order_items: InventoryTableRecord;
      purchase_order_lines: InventoryTableRecord;
      purchase_receipts: {
        Row: {
          id: string;
          organization_id: string;
          purchase_id: string;
          receipt_number: string;
          received_at: string;
          received_by: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          purchase_id: string;
          receipt_number: string;
          received_at?: string;
          received_by?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          notes?: string | null;
        };
        Relationships: [];
      };
      purchase_receipt_items: {
        Row: {
          id: string;
          organization_id: string;
          receipt_id: string;
          purchase_item_id: string;
          variant_id: string;
          location_id: string;
          received_quantity: number;
          accepted_quantity: number;
          damaged_quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          receipt_id: string;
          purchase_item_id: string;
          variant_id: string;
          location_id: string;
          received_quantity: number;
          accepted_quantity: number;
          damaged_quantity: number;
          created_at?: string;
        };
        Update: {
          received_quantity?: number;
          accepted_quantity?: number;
          damaged_quantity?: number;
        };
        Relationships: [];
      };
      purchase_returns: InventoryTableRecord;
      purchase_return_items: InventoryTableRecord;
    };
    Views: Record<string, never>;
    Functions: {
      is_org_member: {
        Args: { target_org_id: string };
        Returns: boolean;
      };
      has_org_role: {
        Args: { target_org_id: string; allowed_roles: string[] };
        Returns: boolean;
      };
      shares_org_with_user: {
        Args: { target_user_id: string };
        Returns: boolean;
      };
      create_business_workspace: {
        Args: {
          p_name: string;
          p_business_type: string;
          p_country: string;
          p_base_currency: string;
          p_business_email: string | null;
          p_business_phone: string | null;
          p_timezone: string;
        };
        Returns: string | Database['public']['Tables']['organizations']['Row'];
      };
      get_organization_member_roster: {
        Args: {
          p_organization_id: string;
        };
        Returns: Array<{
          id: string;
          organisation_id: string;
          user_id: string;
          role: string;
          is_active: boolean;
          created_at: string;
          profile_id: string | null;
          email: string | null;
          full_name: string | null;
        }>;
      };
      update_organization_profile: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_business_type: string;
          p_country: string;
          p_currency: string;
          p_timezone: string;
          p_email: string | null;
          p_phone: string | null;
        };
        Returns: string;
      };
      manage_organization_member_role: {
        Args: {
          p_organization_id: string;
          p_membership_id: string;
          p_new_role: string;
        };
        Returns: string;
      };
      remove_organization_member: {
        Args: {
          p_organization_id: string;
          p_membership_id: string;
        };
        Returns: string;
      };
      adjust_inventory_stock: {
        Args: {
          p_organization_id: string;
          p_variant_id: string;
          p_location_id: string;
          p_quantity_change: number;
          p_movement_type: string;
          p_reference: string | null;
          p_notes: string | null;
        };
        Returns: string;
      };
      update_inventory_reorder_level: {
        Args: {
          p_organization_id: string;
          p_variant_id: string;
          p_location_id: string;
          p_reorder_level: number;
        };
        Returns: string;
      };
      create_inventory_transfer: {
        Args: {
          p_organization_id: string;
          p_source_location_id: string;
          p_destination_location_id: string;
          p_notes: string | null;
        };
        Returns: string;
      };
      add_inventory_transfer_item: {
        Args: {
          p_organization_id: string;
          p_transfer_id: string;
          p_variant_id: string;
          p_quantity: number;
        };
        Returns: string;
      };
      complete_inventory_transfer: {
        Args: {
          p_organization_id: string;
          p_transfer_id: string;
        };
        Returns: string;
      };
      cancel_inventory_transfer: {
        Args: {
          p_organization_id: string;
          p_transfer_id: string;
        };
        Returns: string;
      };
      sales_v1_checkout: {
        Args: {
          p_organization_id: string;
          p_location_id: string;
          p_items: Array<{
            variant_id: string;
            quantity: number;
            discount_amount: number;
          }>;
          p_payments: Array<{
            payment_method_id: string;
            amount: number;
            reference: string | null;
          }>;
          p_idempotency_key: string;
          p_customer_name: string | null;
          p_customer_phone: string | null;
          p_order_discount_amount: number;
        };
        Returns: unknown;
      };
      sales_v2_checkout: {
        Args: {
          p_organization_id: string;
          p_location_id: string;
          p_items: Array<{
            variant_id: string;
            quantity: number;
            discount_amount: number;
          }>;
          p_payments: Array<{
            payment_method_id: string;
            amount: number;
            reference: string | null;
          }>;
          p_idempotency_key: string;
          p_customer_name: string | null;
          p_customer_phone: string | null;
          p_order_discount_amount: number;
          p_customer_id: string | null;
        };
        Returns: string;
      };
      sales_v1_record_follow_up_payment: {
        Args: {
          p_organization_id: string;
          p_sale_id: string;
          p_payment_method_id: string;
          p_amount: number;
          p_idempotency_key: string;
          p_reference: string | null;
        };
        Returns: unknown;
      };
      sales_v1_get_outstanding_balances: {
        Args: {
          p_organization_id: string;
          p_search?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: unknown;
      };
      sales_v1_record_return: {
        Args: {
          p_organization_id: string;
          p_sale_id: string;
          p_reason: string;
          p_items: Array<{
            sale_item_id: string;
            quantity: number;
            restock_quantity: number;
            restock_location_id: string | null;
            condition_notes: string | null;
          }>;
          p_idempotency_key: string;
        };
        Returns: unknown;
      };
      sales_v1_record_refund: {
        Args: {
          p_organization_id: string;
          p_sale_id: string;
          p_refund_source: string;
          p_return_id: string | null;
          p_payment_method_id: string;
          p_amount: number;
          p_reason: string;
          p_idempotency_key: string;
          p_reference: string | null;
        };
        Returns: unknown;
      };
      sales_v1_cancel_sale: {
        Args: {
          p_organization_id: string;
          p_sale_id: string;
          p_reason: string;
          p_idempotency_key: string;
        };
        Returns: unknown;
      };
      sales_v1_create_payment_method: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_method_code: string;
          p_requires_reference: boolean;
        };
        Returns: unknown;
      };
      sales_v1_update_payment_method: {
        Args: {
          p_organization_id: string;
          p_payment_method_id: string;
          p_name: string;
          p_requires_reference: boolean;
          p_is_active: boolean;
        };
        Returns: unknown;
      };
      sales_v1_archive_payment_method: {
        Args: {
          p_organization_id: string;
          p_payment_method_id: string;
        };
        Returns: unknown;
      };
      customers_v1_search: {
        Args: {
          p_organization_id: string;
          p_search: string | null;
          p_limit: number;
          p_is_active?: boolean | null;
        };
        Returns: unknown;
      };
      customers_v1_create: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_phone: string | null;
          p_email: string | null;
          p_address: string | null;
          p_notes: string | null;
        };
        Returns: unknown;
      };
      customers_v1_update: {
        Args: {
          p_organization_id: string;
          p_customer_id: string;
          p_name: string;
          p_phone: string | null;
          p_email: string | null;
          p_address: string | null;
          p_notes: string | null;
        };
        Returns: unknown;
      };
      customers_v1_archive: {
        Args: {
          p_organization_id: string;
          p_customer_id: string;
        };
        Returns: unknown;
      };
      customers_v1_restore: {
        Args: {
          p_organization_id: string;
          p_customer_id: string;
        };
        Returns: unknown;
      };
      customers_v1_get_purchase_history: {
        Args: {
          p_organization_id: string;
          p_customer_id: string;
          p_limit?: number;
        };
        Returns: unknown;
      };
      expenses_v1_list_categories: {
        Args: {
          p_organization_id: string;
          p_include_archived?: boolean;
        };
        Returns: unknown;
      };
      expenses_v1_create_category: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_description?: string | null;
        };
        Returns: unknown;
      };
      expenses_v1_update_category: {
        Args: {
          p_organization_id: string;
          p_category_id: string;
          p_name: string;
          p_description?: string | null;
        };
        Returns: unknown;
      };
      expenses_v1_archive_category: {
        Args: {
          p_organization_id: string;
          p_category_id: string;
        };
        Returns: unknown;
      };
      expenses_v1_create: {
        Args: {
          p_organization_id: string;
          p_category_id: string;
          p_payment_method_id: string;
          p_expense_date: string;
          p_amount: number;
          p_description: string;
          p_idempotency_key: string;
          p_vendor_payee?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
          p_receipt_storage_path?: string | null;
        };
        Returns: unknown;
      };
      expenses_v1_update: {
        Args: {
          p_organization_id: string;
          p_expense_id: string;
          p_category_id: string;
          p_payment_method_id: string;
          p_expense_date: string;
          p_amount: number;
          p_description: string;
          p_edit_reason: string;
          p_vendor_payee?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
          p_receipt_storage_path?: string | null;
        };
        Returns: unknown;
      };
      expenses_v1_void: {
        Args: {
          p_organization_id: string;
          p_expense_id: string;
          p_reason: string;
        };
        Returns: unknown;
      };
      expenses_v1_list: {
        Args: {
          p_organization_id: string;
          p_search?: string | null;
          p_category_id?: string | null;
          p_payment_method_id?: string | null;
          p_status?: string | null;
          p_date_from?: string | null;
          p_date_to?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: unknown;
      };
      expenses_v1_get_detail: {
        Args: {
          p_organization_id: string;
          p_expense_id: string;
        };
        Returns: unknown;
      };
      expenses_v1_get_summary: {
        Args: {
          p_organization_id: string;
          p_date_from?: string | null;
          p_date_to?: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_search_suppliers: {
        Args: {
          p_organization_id: string;
          p_search?: string | null;
          p_is_active?: boolean | null;
          p_include_archived?: boolean;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: unknown;
      };
      purchases_v1_create_supplier: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_contact_person?: string | null;
          p_contact_name?: string | null;
          p_email?: string | null;
          p_phone?: string | null;
          p_address?: string | null;
          p_payment_terms_days?: number;
          p_payment_terms?: number;
          p_notes?: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_update_supplier: {
        Args: {
          p_organization_id: string;
          p_supplier_id: string;
          p_name: string;
          p_contact_person?: string | null;
          p_contact_name?: string | null;
          p_email?: string | null;
          p_phone?: string | null;
          p_address?: string | null;
          p_payment_terms_days?: number;
          p_payment_terms?: number;
          p_notes?: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_archive_supplier: {
        Args: {
          p_organization_id: string;
          p_supplier_id?: string;
          p_id?: string;
        };
        Returns: unknown;
      };
      purchases_v1_restore_supplier: {
        Args: {
          p_organization_id: string;
          p_supplier_id?: string;
          p_id?: string;
        };
        Returns: unknown;
      };
      purchases_v1_create_draft: {
        Args: {
          p_organization_id: string;
          p_supplier_id: string;
          p_items: Array<{
            variant_id: string;
            quantity: number;
            ordered_quantity?: number;
            unit_cost: number;
          }>;
          p_discount_amount?: number;
          p_tax_amount?: number;
          p_supplier_invoice_number?: string | null;
          p_invoice_number?: string | null;
          p_expected_delivery_date?: string | null;
          p_expected_date?: string | null;
          p_order_date?: string | null;
          p_notes?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_update_draft: {
        Args: {
          p_organization_id: string;
          p_purchase_id?: string;
          p_purchase_order_id?: string;
          p_supplier_id: string;
          p_items: Array<{
            variant_id: string;
            quantity: number;
            ordered_quantity?: number;
            unit_cost: number;
          }>;
          p_discount_amount?: number;
          p_tax_amount?: number;
          p_supplier_invoice_number?: string | null;
          p_invoice_number?: string | null;
          p_expected_delivery_date?: string | null;
          p_expected_date?: string | null;
          p_order_date?: string | null;
          p_notes?: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_confirm_order: {
        Args: {
          p_organization_id: string;
          p_purchase_id?: string;
          p_purchase_order_id?: string;
          p_id?: string;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_list: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_list_purchases: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_list_orders: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_search: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_search_purchases: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_get_purchases: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_get_orders: {
        Args: {
          p_organization_id: string;
        };
        Returns: unknown;
      };
      purchases_v1_get_detail: {
        Args: {
          p_organization_id: string;
          p_purchase_id?: string;
          p_purchase_order_id?: string;
        };
        Returns: unknown;
      };
      purchases_v1_get_purchase: {
        Args: {
          p_organization_id: string;
          p_purchase_id?: string;
          p_purchase_order_id?: string;
        };
        Returns: unknown;
      };
      purchases_v1_receive_goods: {
        Args: {
          p_organization_id: string;
          p_purchase_id: string;
          p_items: Array<{
            purchase_item_id: string;
            location_id: string;
            received_quantity: number;
            accepted_quantity: number;
            damaged_quantity: number;
          }>;
          p_notes?: string | null;
        };
        Returns: string;
      };
      purchases_v2_receive_goods: {
        Args: {
          p_organization_id: string;
          p_purchase_id: string;
          p_items: Array<{
            purchase_item_id: string;
            location_id: string;
            received_quantity: number;
            accepted_quantity: number;
            damaged_quantity: number;
          }>;
          p_notes: string | null;
          p_idempotency_key: string;
        };
        Returns: string;
      };
      purchases_v1_create_return_draft: {
        Args: {
          p_organization_id: string;
          p_purchase_id: string;
          p_reason: string;
          p_items: Array<{
            purchase_item_id: string;
            variant_id: string;
            location_id: string;
            quantity: number;
            unit_cost: number;
            line_total: number;
          }>;
        };
        Returns: unknown;
      };
      purchases_v1_complete_return: {
        Args: {
          p_organization_id: string;
          p_return_id: string;
          p_supplier_credit_reference: string | null;
        };
        Returns: unknown;
      };
      purchases_v1_cancel_return: {
        Args: {
          p_organization_id: string;
          p_return_id: string;
          p_reason: string;
        };
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

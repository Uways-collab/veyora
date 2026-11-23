import { getSupabaseClient } from '../../core/supabase/client';
import { fetchOrganisationMembers } from '../../core/supabase/organisations';
import {
  fetchInventoryOverview,
  formatUnitOfMeasureLabel,
  verifyActiveWorkspaceContext,
  type InventoryBalanceRecord,
  type InventoryLocationRecord,
} from '../inventory/inventoryService';
import {
  formatPurchaseNumberPrecision,
  formatPurchaseReadError,
  roundFourDecimals,
  hasMoreThanFourDecimals,
} from './purchasesService';
import {
  isPurchaseReturnEligibleStatus,
  type PurchaseCatalogVariant,
  type PurchaseItemRecord,
  type PurchaseRecord,
  type PurchaseReturnCompleteResult,
  type PurchaseReturnCompleteStockUpdate,
  type PurchaseReturnCreateRpcItem,
  type PurchaseReturnDraftFormInput,
  type PurchaseReturnItemAvailability,
  type PurchaseReturnItemRecord,
  type PurchaseReturnListResult,
  type PurchaseReturnLocationBalance,
  type PurchaseReturnMutationResult,
  type PurchaseReturnRecord,
  type PurchaseReturnStatusValue,
} from './purchasesTypes';

export interface PurchaseAcceptedReceiptRow {
  id: string;
  purchaseItemId: string;
  variantId: string;
  locationId: string;
  receivedQuantity: number;
  acceptedQuantity: number;
  damagedQuantity: number;
}

export interface PurchaseAcceptedReceiptsResult {
  rows: PurchaseAcceptedReceiptRow[];
  error: string | null;
}

function readString(...values: unknown[]): string | null {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const val of values) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
    if (typeof val === 'string' && val.trim() !== '') {
      const parsed = Number(val.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const lower = (error.message ?? '').toLowerCase();
  return lower.includes('column') && lower.includes('does not exist');
}

export function formatPurchaseReturnStatusLabel(status: PurchaseReturnStatusValue): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function formatPurchaseReturnRpcError(
  rawMessage: string | undefined | null,
  fallback: string
): string {
  const msg = (rawMessage ?? '').trim();
  if (!msg) return fallback;
  const lower = msg.toLowerCase();

  if (
    lower.includes('permission denied') ||
    lower.includes('not authorized') ||
    lower.includes('row-level security') ||
    lower.includes('policy')
  ) {
    return 'Permission denied. Only Owners, Admins, and Managers can create, complete, or cancel purchase returns in the active organization.';
  }

  return msg;
}

function normalizeReturnStatus(raw: unknown): PurchaseReturnStatusValue {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'completed' || value === 'complete' || value === 'posted') return 'completed';
  if (value === 'cancelled' || value === 'canceled' || value === 'void') return 'cancelled';
  return 'draft';
}

function extractReturnIdentifier(data: unknown): string | null {
  if (typeof data === 'string' && data.trim()) {
    const trimmed = data.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return trimmed;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return extractReturnIdentifier(parsed);
    } catch {
      return trimmed;
    }
  }
  const target = Array.isArray(data) ? data[0] : data;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const obj = target as Record<string, unknown>;
    const nested =
      (obj.purchase_return as Record<string, unknown> | undefined) ??
      (obj.return as Record<string, unknown> | undefined) ??
      (obj.purchases_v1_create_return_draft as Record<string, unknown> | undefined) ??
      (obj.purchases_v1_complete_return as Record<string, unknown> | undefined) ??
      (obj.purchases_v1_cancel_return as Record<string, unknown> | undefined) ??
      obj;
    return readString(
      nested.id,
      nested.return_id,
      nested.purchase_return_id,
      obj.return_id,
      obj.purchase_return_id,
      obj.id
    );
  }
  return null;
}

function buildMemberNameMap(
  membersRes: Awaited<ReturnType<typeof fetchOrganisationMembers>>
): Map<string, string> {
  const map = new Map<string, string>();
  if (!membersRes.error) {
    for (const member of membersRes.members) {
      const displayName =
        member.profile?.full_name?.trim() || member.profile?.email?.trim() || null;
      if (displayName) {
        map.set(member.user_id, displayName);
      }
    }
  }
  return map;
}

function resolveMemberName(
  userId: string | null,
  memberNameByUserId: Map<string, string>,
  fallbackLabel = 'System'
): string {
  if (!userId) return fallbackLabel;
  return memberNameByUserId.get(userId) ?? `User ${userId.slice(0, 8)}`;
}

function normalizeReturnItem(
  rawItem: Record<string, unknown>,
  orgId: string,
  index: number,
  options: {
    purchaseItemById: Map<string, PurchaseItemRecord>;
    variantById: Map<string, PurchaseCatalogVariant>;
    locationsById: Record<string, InventoryLocationRecord>;
  }
): PurchaseReturnItemRecord | null {
  const itemOrg = readString(rawItem.organization_id, rawItem.organisation_id);
  if (itemOrg && itemOrg.toLowerCase() !== orgId.toLowerCase()) return null;

  const returnId = readString(rawItem.return_id, rawItem.purchase_return_id);
  const purchaseItemId = readString(rawItem.purchase_item_id) ?? '';
  const variantId = readString(rawItem.variant_id, rawItem.product_variant_id) ?? '';
  const locationId = readString(rawItem.location_id) ?? '';
  if (!returnId || (!purchaseItemId && !variantId)) return null;

  const purchaseItem = purchaseItemId ? options.purchaseItemById.get(purchaseItemId) : undefined;
  const variant = variantId ? options.variantById.get(variantId) : undefined;
  const location = locationId ? options.locationsById[locationId] : undefined;

  const quantity = roundFourDecimals(readNumber(rawItem.quantity, rawItem.return_quantity) ?? 0);
  const unitCost = roundFourDecimals(
    readNumber(rawItem.unit_cost, purchaseItem?.unitCost, variant?.defaultCostPrice) ?? 0
  );
  const lineTotal = roundFourDecimals(
    readNumber(rawItem.line_total, rawItem.subtotal) ?? quantity * unitCost
  );

  return {
    id: readString(rawItem.id, rawItem.return_item_id) ?? `${returnId}-${index}`,
    organizationId: itemOrg ?? orgId,
    returnId,
    purchaseItemId,
    variantId: variantId || purchaseItem?.variantId || '',
    locationId,
    locationName:
      readString(rawItem.location_name, rawItem.location_name_snapshot) ??
      location?.name ??
      'Unknown Location',
    productName:
      readString(rawItem.product_name, rawItem.product_name_snapshot) ??
      purchaseItem?.productName ??
      variant?.productName ??
      'Product',
    variantName:
      readString(rawItem.variant_name, rawItem.variant_name_snapshot) ??
      purchaseItem?.variantName ??
      variant?.variantName ??
      'Variant',
    sku:
      readString(rawItem.sku, rawItem.sku_snapshot) ??
      purchaseItem?.sku ??
      variant?.sku ??
      '—',
    unitOfMeasure: formatUnitOfMeasureLabel(
      readString(rawItem.unit_of_measure, rawItem.unit_of_measure_snapshot) ??
        purchaseItem?.unitOfMeasure ??
        variant?.unitOfMeasure ??
        'Unit'
    ),
    quantity,
    unitCost,
    lineTotal,
    createdAt: readString(rawItem.created_at),
  };
}

function buildReturnRecords(
  rawReturns: Record<string, unknown>[],
  rawReturnItems: Record<string, unknown>[],
  orgId: string,
  options: {
    purchasesById: Map<string, PurchaseRecord>;
    purchaseItemById: Map<string, PurchaseItemRecord>;
    variantById: Map<string, PurchaseCatalogVariant>;
    locationsById: Record<string, InventoryLocationRecord>;
    memberNameByUserId: Map<string, string>;
    defaultCurrency: string;
  }
): PurchaseReturnRecord[] {
  const itemsByReturnId = new Map<string, PurchaseReturnItemRecord[]>();

  rawReturnItems.forEach((rawItem, idx) => {
    const normalized = normalizeReturnItem(rawItem, orgId, idx, options);
    if (!normalized) return;
    const existing = itemsByReturnId.get(normalized.returnId) ?? [];
    existing.push(normalized);
    itemsByReturnId.set(normalized.returnId, existing);
  });

  return rawReturns
    .map((row) => {
      const id = readString(row.id, row.return_id, row.purchase_return_id);
      if (!id) return null;

      const purchaseId = readString(row.purchase_id, row.purchase_order_id) ?? '';
      const purchase = purchaseId ? options.purchasesById.get(purchaseId) : undefined;
      const items = itemsByReturnId.get(id) ?? [];

      const computedTotal = roundFourDecimals(
        items.reduce((sum, item) => sum + item.lineTotal, 0)
      );
      const totalAmount = roundFourDecimals(
        readNumber(row.total_amount, row.total_return_amount, row.return_total) ?? computedTotal
      );
      const status = normalizeReturnStatus(row.status);

      const createdBy = readString(row.created_by);
      const completedBy = readString(row.completed_by, row.confirmed_by, row.processed_by);
      const cancelledBy = readString(row.cancelled_by, row.canceled_by, row.voided_by);

      const completedAt = readString(row.completed_at, row.confirmed_at);
      const cancelledAt = readString(row.cancelled_at, row.canceled_at, row.voided_at);
      const returnDate = readString(
        row.return_date,
        row.returned_at,
        completedAt,
        row.created_at
      );

      return {
        id,
        organizationId: orgId,
        purchaseId,
        purchaseNumber:
          readString(row.purchase_number, row.po_number) ??
          purchase?.purchaseNumber ??
          (purchaseId ? `PO-${purchaseId.slice(0, 8).toUpperCase()}` : '—'),
        supplierId: readString(row.supplier_id) ?? purchase?.supplierId ?? '',
        supplierName:
          readString(row.supplier_name, row.supplier_name_snapshot) ??
          purchase?.supplierName ??
          'Unknown Supplier',
        currencyCode: (
          readString(row.currency, row.currency_code) ??
          purchase?.currencyCode ??
          options.defaultCurrency
        ).toUpperCase(),
        returnNumber:
          readString(row.return_number, row.pr_number, row.reference_number) ??
          `PRET-${id.slice(0, 8).toUpperCase()}`,
        status,
        reason: readString(row.reason, row.return_reason) ?? '',
        supplierCreditReference: readString(
          row.supplier_credit_reference,
          row.credit_reference,
          row.credit_note_reference
        ),
        cancellationReason: readString(
          row.cancellation_reason,
          row.cancel_reason,
          row.void_reason
        ),
        totalAmount,
        returnDate,
        completedAt,
        cancelledAt,
        createdBy,
        createdByName: resolveMemberName(createdBy, options.memberNameByUserId, 'Team Member'),
        completedBy,
        completedByName: completedBy
          ? resolveMemberName(completedBy, options.memberNameByUserId, 'Team Member')
          : null,
        cancelledBy,
        cancelledByName: cancelledBy
          ? resolveMemberName(cancelledBy, options.memberNameByUserId, 'Team Member')
          : null,
        createdAt: readString(row.created_at),
        updatedAt: readString(row.updated_at),
        items,
      };
    })
    .filter((record): record is PurchaseReturnRecord => Boolean(record));
}

export async function fetchPurchaseReturns(
  organisationId: string,
  options: {
    defaultCurrency?: string;
    purchases?: PurchaseRecord[];
    catalogVariants?: PurchaseCatalogVariant[];
    locationsById?: Record<string, InventoryLocationRecord>;
  } = {}
): Promise<PurchaseReturnListResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { returns: [], error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { returns: [], error: verified.error };
  }

  const orgId = verified.organizationId;
  const fallbackCurrency = (options.defaultCurrency || 'USD').trim().toUpperCase();

  const [returnsRes, membersRes] = await Promise.all([
    supabase
      .from('purchase_returns')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false }),
    fetchOrganisationMembers(orgId),
  ]);

  if (returnsRes.error) {
    return {
      returns: [],
      error: formatPurchaseReadError(
        returnsRes.error.message,
        'Unable to load purchase returns.'
      ),
    };
  }

  const rawReturns = ((returnsRes.data ?? []) as Record<string, unknown>[]).filter((row) => {
    const rowOrg = readString(row.organization_id, row.organisation_id);
    return !rowOrg || rowOrg.toLowerCase() === orgId.toLowerCase();
  });

  if (rawReturns.length === 0) {
    return { returns: [], error: null };
  }

  const returnIds = rawReturns
    .map((row) => readString(row.id, row.return_id, row.purchase_return_id))
    .filter((id): id is string => Boolean(id));

  let rawReturnItems: Record<string, unknown>[] = [];
  let itemsWarning: string | null = null;

  const itemsRes = await supabase
    .from('purchase_return_items')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });

  if (!itemsRes.error) {
    rawReturnItems = (itemsRes.data ?? []) as Record<string, unknown>[];
  } else if (isMissingColumnError(itemsRes.error) && returnIds.length > 0) {
    let loadedFallback = false;
    for (const fkCol of ['return_id', 'purchase_return_id'] as const) {
      const fkRes = await supabase
        .from('purchase_return_items')
        .select('*')
        .in(fkCol, returnIds);
      if (!fkRes.error) {
        rawReturnItems = (fkRes.data ?? []) as Record<string, unknown>[];
        loadedFallback = true;
        break;
      }
      if (!isMissingColumnError(fkRes.error)) {
        itemsWarning = formatPurchaseReadError(
          fkRes.error.message,
          'Purchase return line items could not be loaded.'
        );
        break;
      }
    }
    if (!loadedFallback && !itemsWarning) {
      itemsWarning = formatPurchaseReadError(
        itemsRes.error.message,
        'Purchase return line items could not be loaded.'
      );
    }
  } else {
    itemsWarning = formatPurchaseReadError(
      itemsRes.error.message,
      'Purchase return line items could not be loaded.'
    );
  }

  const purchasesById = new Map((options.purchases ?? []).map((p) => [p.id, p]));
  const purchaseItemById = new Map<string, PurchaseItemRecord>();
  for (const purchase of options.purchases ?? []) {
    for (const item of purchase.items) {
      purchaseItemById.set(item.id, item);
    }
  }
  const variantById = new Map((options.catalogVariants ?? []).map((v) => [v.variantId, v]));

  const returns = buildReturnRecords(rawReturns, rawReturnItems, orgId, {
    purchasesById,
    purchaseItemById,
    variantById,
    locationsById: options.locationsById ?? {},
    memberNameByUserId: buildMemberNameMap(membersRes),
    defaultCurrency: fallbackCurrency,
  });

  return { returns, error: null, itemsWarning };
}

export async function fetchAcceptedReceiptRows(
  organisationId: string,
  purchaseItemIds?: string[]
): Promise<PurchaseAcceptedReceiptsResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { rows: [], error: 'Supabase client is not configured.' };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { rows: [], error: verified.error };
  }

  const orgId = verified.organizationId;

  let query = supabase
    .from('purchase_receipt_items')
    .select(
      'id, organization_id, receipt_id, purchase_item_id, variant_id, location_id, received_quantity, accepted_quantity, damaged_quantity'
    )
    .eq('organization_id', orgId);

  if (purchaseItemIds && purchaseItemIds.length > 0) {
    query = query.in('purchase_item_id', purchaseItemIds);
  }

  const res = await query;
  if (res.error) {
    return {
      rows: [],
      error: formatPurchaseReadError(
        res.error.message,
        'Unable to load accepted receipt allocations.'
      ),
    };
  }

  const rows: PurchaseAcceptedReceiptRow[] = (res.data ?? [])
    .filter((row) => row.organization_id.toLowerCase() === orgId.toLowerCase())
    .map((row) => ({
      id: row.id,
      purchaseItemId: row.purchase_item_id,
      variantId: row.variant_id,
      locationId: row.location_id,
      receivedQuantity: roundFourDecimals(Number(row.received_quantity) || 0),
      acceptedQuantity: roundFourDecimals(Number(row.accepted_quantity) || 0),
      damagedQuantity: roundFourDecimals(Number(row.damaged_quantity) || 0),
    }));

  return { rows, error: null };
}

export function computePurchaseReturnAvailability(
  purchase: PurchaseRecord,
  acceptedReceiptRows: PurchaseAcceptedReceiptRow[],
  allReturns: PurchaseReturnRecord[],
  locationsById: Record<string, InventoryLocationRecord>,
  inventoryBalances: InventoryBalanceRecord[]
): Map<string, PurchaseReturnItemAvailability> {
  const acceptedByItemLocation = new Map<string, number>();
  const acceptedByItem = new Map<string, number>();
  const locationsPerItem = new Map<string, Set<string>>();

  for (const row of acceptedReceiptRows) {
    const acc = roundFourDecimals(row.acceptedQuantity);
    if (acc <= 0) continue;
    const pairKey = `${row.purchaseItemId}:${row.locationId}`;
    acceptedByItemLocation.set(
      pairKey,
      roundFourDecimals((acceptedByItemLocation.get(pairKey) ?? 0) + acc)
    );
    acceptedByItem.set(
      row.purchaseItemId,
      roundFourDecimals((acceptedByItem.get(row.purchaseItemId) ?? 0) + acc)
    );
    const locSet = locationsPerItem.get(row.purchaseItemId) ?? new Set<string>();
    locSet.add(row.locationId);
    locationsPerItem.set(row.purchaseItemId, locSet);
  }

  const completedByItemLocation = new Map<string, number>();
  const completedByItem = new Map<string, number>();
  const draftByItemLocation = new Map<string, number>();
  const draftByItem = new Map<string, number>();

  for (const ret of allReturns) {
    if (ret.status === 'cancelled') continue;
    for (const rItem of ret.items) {
      if (!rItem.purchaseItemId || rItem.quantity <= 0) continue;
      const qty = roundFourDecimals(rItem.quantity);
      const pairKey = `${rItem.purchaseItemId}:${rItem.locationId}`;

      if (ret.status === 'completed') {
        completedByItemLocation.set(
          pairKey,
          roundFourDecimals((completedByItemLocation.get(pairKey) ?? 0) + qty)
        );
        completedByItem.set(
          rItem.purchaseItemId,
          roundFourDecimals((completedByItem.get(rItem.purchaseItemId) ?? 0) + qty)
        );
      } else if (ret.status === 'draft') {
        draftByItemLocation.set(
          pairKey,
          roundFourDecimals((draftByItemLocation.get(pairKey) ?? 0) + qty)
        );
        draftByItem.set(
          rItem.purchaseItemId,
          roundFourDecimals((draftByItem.get(rItem.purchaseItemId) ?? 0) + qty)
        );
      }
    }
  }

  const stockBalanceMap = new Map<string, number>();
  for (const bal of inventoryBalances) {
    stockBalanceMap.set(`${bal.variantId}:${bal.locationId}`, roundFourDecimals(bal.quantity));
  }

  const result = new Map<string, PurchaseReturnItemAvailability>();

  for (const item of purchase.items) {
    const locIds = Array.from(locationsPerItem.get(item.id) ?? []);
    const byLocation: PurchaseReturnLocationBalance[] = locIds
      .map((locationId) => {
        const pairKey = `${item.id}:${locationId}`;
        const loc = locationsById[locationId];
        const acceptedAtLoc = acceptedByItemLocation.get(pairKey) ?? 0;
        const completedAtLoc = completedByItemLocation.get(pairKey) ?? 0;
        const draftAtLoc = draftByItemLocation.get(pairKey) ?? 0;
        const remainingAtLoc = Math.max(
          0,
          roundFourDecimals(acceptedAtLoc - completedAtLoc - draftAtLoc)
        );
        const stockAtLoc = stockBalanceMap.has(`${item.variantId}:${locationId}`)
          ? (stockBalanceMap.get(`${item.variantId}:${locationId}`) ?? 0)
          : null;

        return {
          locationId,
          locationName: loc?.name ?? 'Unknown Location',
          locationIsActive: loc ? loc.isActive : true,
          acceptedReceivedQuantity: acceptedAtLoc,
          completedReturnedQuantity: completedAtLoc,
          draftReservedQuantity: draftAtLoc,
          remainingReturnableQuantity: remainingAtLoc,
          currentStockQuantity: stockAtLoc,
        };
      })
      .sort((a, b) => a.locationName.localeCompare(b.locationName));

    const acceptedTotal = acceptedByItem.get(item.id) ?? 0;
    const physicallyReceived = roundFourDecimals(item.receivedQuantity);
    const damagedTotal = Math.max(0, roundFourDecimals(physicallyReceived - acceptedTotal));
    const completedTotal = completedByItem.get(item.id) ?? 0;
    const draftTotal = draftByItem.get(item.id) ?? 0;
    const remainingTotal = Math.max(
      0,
      roundFourDecimals(acceptedTotal - completedTotal - draftTotal)
    );

    result.set(item.id, {
      purchaseItemId: item.id,
      variantId: item.variantId,
      acceptedReceivedQuantity: acceptedTotal,
      physicallyReceivedQuantity: physicallyReceived,
      damagedQuantity: damagedTotal,
      completedReturnedQuantity: completedTotal,
      draftReservedQuantity: draftTotal,
      remainingReturnableQuantity: remainingTotal,
      byLocation,
    });
  }

  return result;
}

export interface ValidatedPurchaseReturnDraftPayload {
  reason: string;
  rpcItems: PurchaseReturnCreateRpcItem[];
  totalQuantity: number;
  totalValue: number;
  distinctItemCount: number;
}

export function validatePurchaseReturnDraftInput(
  purchase: PurchaseRecord,
  input: PurchaseReturnDraftFormInput,
  availabilityByItemId: Map<string, PurchaseReturnItemAvailability>
):
  | { ok: true; normalized: ValidatedPurchaseReturnDraftPayload }
  | { ok: false; error: string } {
  if (!isPurchaseReturnEligibleStatus(purchase.status)) {
    return {
      ok: false,
      error:
        'Purchase returns can only be created for Partially Received or Received purchase orders.',
    };
  }

  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, error: 'Return reason is required.' };
  }
  if (reason.length > 1000) {
    return { ok: false, error: 'Return reason must be 1,000 characters or fewer.' };
  }

  const itemById = new Map(purchase.items.map((item) => [item.id, item]));
  const seenItemLocationPairs = new Set<string>();
  const accumulatedByItemId = new Map<string, number>();
  const distinctItemIds = new Set<string>();
  const rpcItems: PurchaseReturnCreateRpcItem[] = [];

  let totalQuantity = 0;
  let totalValue = 0;

  for (const line of input.lines) {
    const item = itemById.get(line.purchaseItemId);
    if (!item) {
      return {
        ok: false,
        error: 'A selected purchase item could not be found on this purchase order.',
      };
    }

    const itemLabel = `${item.productName} (${item.variantName})`;
    const qtyRaw = line.quantity.trim();

    if (qtyRaw && hasMoreThanFourDecimals(qtyRaw)) {
      return {
        ok: false,
        error: `${itemLabel}: return quantity supports up to 4 decimal places.`,
      };
    }

    const parsedQty = qtyRaw === '' ? 0 : Number(qtyRaw);
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      return {
        ok: false,
        error: `${itemLabel}: return quantity must be 0 or greater.`,
      };
    }

    const quantity = roundFourDecimals(parsedQty);
    if (quantity === 0) {
      continue;
    }

    const availability = availabilityByItemId.get(item.id);
    if (!availability || availability.acceptedReceivedQuantity <= 0) {
      return {
        ok: false,
        error: `${itemLabel}: only accepted goods that entered inventory can be returned (damaged goods cannot be returned).`,
      };
    }

    const locationId = line.locationId.trim();
    if (!locationId) {
      return {
        ok: false,
        error: `${itemLabel}: select the inventory location holding the stock to return.`,
      };
    }

    const pairKey = `${item.id}:${locationId}`;
    if (seenItemLocationPairs.has(pairKey)) {
      return {
        ok: false,
        error: `${itemLabel}: combine return quantities from the same location onto a single row.`,
      };
    }
    seenItemLocationPairs.add(pairKey);

    const locBalance = availability.byLocation.find((b) => b.locationId === locationId);
    if (!locBalance || locBalance.acceptedReceivedQuantity <= 0) {
      return {
        ok: false,
        error: `${itemLabel}: no accepted stock was received into the selected location for this order.`,
      };
    }

    if (quantity > locBalance.remainingReturnableQuantity) {
      const reservedNote =
        locBalance.draftReservedQuantity > 0
          ? ` (${formatPurchaseNumberPrecision(locBalance.draftReservedQuantity)} already reserved in draft returns)`
          : '';
      return {
        ok: false,
        error: `${itemLabel} at ${locBalance.locationName}: return quantity (${formatPurchaseNumberPrecision(quantity)}) exceeds remaining returnable accepted quantity (${formatPurchaseNumberPrecision(locBalance.remainingReturnableQuantity)})${reservedNote}.`,
      };
    }

    if (
      locBalance.currentStockQuantity !== null &&
      quantity > locBalance.currentStockQuantity
    ) {
      return {
        ok: false,
        error: `${itemLabel} at ${locBalance.locationName}: return quantity (${formatPurchaseNumberPrecision(quantity)}) exceeds current inventory stock on hand (${formatPurchaseNumberPrecision(locBalance.currentStockQuantity)}).`,
      };
    }

    const prevItemSum = accumulatedByItemId.get(item.id) ?? 0;
    const nextItemSum = roundFourDecimals(prevItemSum + quantity);
    accumulatedByItemId.set(item.id, nextItemSum);

    if (nextItemSum > availability.remainingReturnableQuantity) {
      return {
        ok: false,
        error: `${itemLabel}: combined return quantity (${formatPurchaseNumberPrecision(nextItemSum)}) exceeds total remaining returnable quantity (${formatPurchaseNumberPrecision(availability.remainingReturnableQuantity)}).`,
      };
    }

    const unitCost = roundFourDecimals(item.unitCost);
    const lineTotal = roundFourDecimals(quantity * unitCost);

    distinctItemIds.add(item.id);
    totalQuantity = roundFourDecimals(totalQuantity + quantity);
    totalValue = roundFourDecimals(totalValue + lineTotal);

    rpcItems.push({
      purchase_item_id: item.id,
      variant_id: item.variantId,
      location_id: locationId,
      quantity,
      unit_cost: unitCost,
      line_total: lineTotal,
    });
  }

  if (rpcItems.length === 0) {
    return {
      ok: false,
      error: 'Enter a return quantity greater than 0 for at least one accepted purchase item.',
    };
  }

  return {
    ok: true,
    normalized: {
      reason,
      rpcItems,
      totalQuantity,
      totalValue,
      distinctItemCount: distinctItemIds.size,
    },
  };
}

async function fetchSinglePurchaseReturn(
  organisationId: string,
  returnId: string,
  options: {
    purchases?: PurchaseRecord[];
    catalogVariants?: PurchaseCatalogVariant[];
    locationsById?: Record<string, InventoryLocationRecord>;
    defaultCurrency?: string;
  } = {}
): Promise<PurchaseReturnRecord | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !returnId) return null;

  const [retRes, membersRes] = await Promise.all([
    supabase
      .from('purchase_returns')
      .select('*')
      .eq('organization_id', organisationId)
      .eq('id', returnId)
      .maybeSingle(),
    fetchOrganisationMembers(organisationId),
  ]);

  if (retRes.error || !retRes.data) return null;

  let rawItems: Record<string, unknown>[] = [];
  const itemsRes = await supabase
    .from('purchase_return_items')
    .select('*')
    .eq('organization_id', organisationId)
    .eq('return_id', returnId);

  if (!itemsRes.error) {
    rawItems = (itemsRes.data ?? []) as Record<string, unknown>[];
  } else if (isMissingColumnError(itemsRes.error)) {
    const fkRes = await supabase
      .from('purchase_return_items')
      .select('*')
      .eq('return_id', returnId);
    if (!fkRes.error) {
      rawItems = (fkRes.data ?? []) as Record<string, unknown>[];
    }
  }

  const purchasesById = new Map((options.purchases ?? []).map((p) => [p.id, p]));
  const purchaseItemById = new Map<string, PurchaseItemRecord>();
  for (const purchase of options.purchases ?? []) {
    for (const item of purchase.items) {
      purchaseItemById.set(item.id, item);
    }
  }
  const variantById = new Map((options.catalogVariants ?? []).map((v) => [v.variantId, v]));

  return (
    buildReturnRecords([retRes.data as Record<string, unknown>], rawItems, organisationId, {
      purchasesById,
      purchaseItemById,
      variantById,
      locationsById: options.locationsById ?? {},
      memberNameByUserId: buildMemberNameMap(membersRes),
      defaultCurrency: (options.defaultCurrency || 'USD').trim().toUpperCase(),
    })[0] ?? null
  );
}

export async function createPurchaseReturnDraft(
  organisationId: string,
  purchase: PurchaseRecord,
  input: PurchaseReturnDraftFormInput,
  availabilityByItemId: Map<string, PurchaseReturnItemAvailability>,
  options: {
    purchases?: PurchaseRecord[];
    catalogVariants?: PurchaseCatalogVariant[];
    locationsById?: Record<string, InventoryLocationRecord>;
    defaultCurrency?: string;
  } = {}
): Promise<PurchaseReturnMutationResult> {
  if (!purchase.id) {
    return { returnId: null, returnRecord: null, error: 'Purchase order is required.' };
  }

  const validation = validatePurchaseReturnDraftInput(purchase, input, availabilityByItemId);
  if (!validation.ok) {
    return { returnId: null, returnRecord: null, error: validation.error };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      returnId: null,
      returnRecord: null,
      error: 'Supabase client is not configured.',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { returnId: null, returnRecord: null, error: verified.error };
  }

  const orgId = verified.organizationId;

  const { data, error } = await supabase.rpc('purchases_v1_create_return_draft', {
    p_organization_id: orgId,
    p_purchase_id: purchase.id,
    p_reason: validation.normalized.reason,
    p_items: validation.normalized.rpcItems,
  });

  if (error) {
    return {
      returnId: null,
      returnRecord: null,
      error: formatPurchaseReturnRpcError(
        error.message,
        'Unable to create purchase return draft.'
      ),
    };
  }

  const returnId = extractReturnIdentifier(data);
  const returnRecord = returnId
    ? await fetchSinglePurchaseReturn(orgId, returnId, {
        purchases: options.purchases ?? [purchase],
        catalogVariants: options.catalogVariants,
        locationsById: options.locationsById,
        defaultCurrency: options.defaultCurrency ?? purchase.currencyCode,
      })
    : null;

  return {
    returnId,
    returnRecord,
    error: null,
  };
}

export async function completePurchaseReturn(
  organisationId: string,
  returnRecord: PurchaseReturnRecord,
  supplierCreditReference: string | null,
  options: {
    purchases?: PurchaseRecord[];
    catalogVariants?: PurchaseCatalogVariant[];
    locationsById?: Record<string, InventoryLocationRecord>;
    defaultCurrency?: string;
  } = {}
): Promise<PurchaseReturnCompleteResult> {
  if (!returnRecord.id) {
    return {
      returnId: null,
      returnNumber: null,
      returnRecord: null,
      stockUpdates: [],
      error: 'Return ID is required.',
    };
  }
  if (returnRecord.status !== 'draft') {
    return {
      returnId: null,
      returnNumber: null,
      returnRecord: null,
      stockUpdates: [],
      error: 'Only draft purchase returns can be completed.',
    };
  }

  const trimmedCreditRef = supplierCreditReference?.trim() || null;
  if (trimmedCreditRef && trimmedCreditRef.length > 150) {
    return {
      returnId: null,
      returnNumber: null,
      returnRecord: null,
      stockUpdates: [],
      error: 'Supplier credit reference must be 150 characters or fewer.',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      returnId: null,
      returnNumber: null,
      returnRecord: null,
      stockUpdates: [],
      error: 'Supabase client is not configured.',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return {
      returnId: null,
      returnNumber: null,
      returnRecord: null,
      stockUpdates: [],
      error: verified.error,
    };
  }

  const orgId = verified.organizationId;

  const { data, error } = await supabase.rpc('purchases_v1_complete_return', {
    p_organization_id: orgId,
    p_return_id: returnRecord.id,
    p_supplier_credit_reference: trimmedCreditRef,
  });

  if (error) {
    return {
      returnId: null,
      returnNumber: null,
      returnRecord: null,
      stockUpdates: [],
      error: formatPurchaseReturnRpcError(error.message, 'Unable to complete purchase return.'),
    };
  }

  const resolvedReturnId = extractReturnIdentifier(data) ?? returnRecord.id;

  const [updatedReturn, inventoryRes] = await Promise.all([
    fetchSinglePurchaseReturn(orgId, resolvedReturnId, {
      purchases: options.purchases,
      catalogVariants: options.catalogVariants,
      locationsById: options.locationsById,
      defaultCurrency: options.defaultCurrency ?? returnRecord.currencyCode,
    }),
    fetchInventoryOverview(orgId),
  ]);

  const refreshedLocationsById: Record<string, InventoryLocationRecord> = {
    ...(options.locationsById ?? {}),
  };
  for (const loc of inventoryRes.locations) {
    refreshedLocationsById[loc.id] = loc;
  }

  const balanceMap = new Map<string, number>();
  for (const bal of inventoryRes.balances) {
    balanceMap.set(`${bal.variantId}:${bal.locationId}`, roundFourDecimals(bal.quantity));
  }

  const itemsForStockSummary = updatedReturn?.items.length
    ? updatedReturn.items
    : returnRecord.items;

  const stockUpdates: PurchaseReturnCompleteStockUpdate[] = itemsForStockSummary
    .filter((item) => item.quantity > 0 && item.variantId && item.locationId)
    .map((item) => ({
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      unitOfMeasure: item.unitOfMeasure,
      locationId: item.locationId,
      locationName:
        refreshedLocationsById[item.locationId]?.name ?? item.locationName ?? 'Selected Location',
      returnedQuantity: item.quantity,
      newStockQuantity: balanceMap.get(`${item.variantId}:${item.locationId}`) ?? null,
    }));

  return {
    returnId: resolvedReturnId,
    returnNumber: updatedReturn?.returnNumber ?? returnRecord.returnNumber ?? null,
    returnRecord: updatedReturn,
    stockUpdates,
    error: null,
  };
}

export async function cancelPurchaseReturnDraft(
  organisationId: string,
  returnRecord: PurchaseReturnRecord,
  reason: string
): Promise<PurchaseReturnMutationResult> {
  if (!returnRecord.id) {
    return { returnId: null, returnRecord: null, error: 'Return ID is required.' };
  }
  if (returnRecord.status !== 'draft') {
    return {
      returnId: null,
      returnRecord: null,
      error: 'Only draft purchase returns can be cancelled. Completed returns cannot be cancelled.',
    };
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return {
      returnId: null,
      returnRecord: null,
      error: 'A cancellation reason is required to cancel a draft return.',
    };
  }
  if (trimmedReason.length > 1000) {
    return {
      returnId: null,
      returnRecord: null,
      error: 'Cancellation reason must be 1,000 characters or fewer.',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      returnId: null,
      returnRecord: null,
      error: 'Supabase client is not configured.',
    };
  }

  const verified = await verifyActiveWorkspaceContext(organisationId, 'none');
  if (!verified.ok) {
    return { returnId: null, returnRecord: null, error: verified.error };
  }

  const { error } = await supabase.rpc('purchases_v1_cancel_return', {
    p_organization_id: verified.organizationId,
    p_return_id: returnRecord.id,
    p_reason: trimmedReason,
  });

  if (error) {
    return {
      returnId: null,
      returnRecord: null,
      error: formatPurchaseReturnRpcError(
        error.message,
        'Unable to cancel purchase return draft.'
      ),
    };
  }

  return {
    returnId: returnRecord.id,
    returnRecord: null,
    error: null,
  };
}

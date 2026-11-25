import { useEffect, useMemo, useRef, useState } from 'react';
import { BarcodeCameraScanner } from '../inventory/BarcodeCameraScanner';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  MapPin,
  Minus,
  Package,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import type { OrganisationRole } from '../../core/types/domain';
import { searchCustomers } from '../customers/customersService';
import type { CustomerRecord } from '../customers/customersTypes';
import {
  formatMoneyAmount,
  formatUnitOfMeasureLabel,
} from '../inventory/inventoryService';
import {
  generateIdempotencyKey,
  roundMoney,
  roundQuantity,
} from './salesFormatters';
import { buildPosCatalogItems, checkoutSale } from './salesService';
import {
  canApplySalesDiscounts,
  canCreateCreditSales,
  isPaymentReferenceRequired,
  type PaymentMethodRecord,
  type PosCartLine,
  type PosCatalogItem,
  type PosPaymentDraft,
  type SaleRecord,
  type SalesModuleData,
} from './salesTypes';

interface PosCheckoutPanelProps {
  organisationId: string;
  currencyCode: string;
  activeRole: OrganisationRole | null;
  data: SalesModuleData;
  loading: boolean;
  onReload: () => Promise<void>;
  onOpenReceipt: (sale: SaleRecord) => void;
}

function createDraftRowKey(): string {
  return `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function pickDefaultPaymentMethod(methods: PaymentMethodRecord[]): PaymentMethodRecord | null {
  const cash = methods.find((m) => m.methodCode === 'cash');
  return cash ?? methods[0] ?? null;
}

export function PosCheckoutPanel({
  organisationId,
  currencyCode,
  activeRole,
  data,
  loading,
  onReload,
  onOpenReceipt,
}: PosCheckoutPanelProps) {
  const allowDiscounts = canApplySalesDiscounts(activeRole);
  const allowCreditSales = canCreateCreditSales(activeRole);

  const activeLocations = useMemo(
    () => data.locations.filter((l) => l.isActive),
    [data.locations]
  );
  const activeMethods = useMemo(
    () => data.paymentMethods.filter((m) => m.isActive),
    [data.paymentMethods]
  );
  const catalogItems = useMemo(
    () => buildPosCatalogItems(data.products, data.variants),
    [data.products, data.variants]
  );

  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'physical' | 'service'>('all');

  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [orderDiscountInput, setOrderDiscountInput] = useState<string>('0');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<CustomerRecord[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentDrafts, setPaymentDrafts] = useState<PosPaymentDraft[]>([]);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastCompletedSaleId, setLastCompletedSaleId] = useState<string | null>(null);

  const submitLockRef = useRef(false);
  const pendingIdempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const customerSearchSeqRef = useRef(0);
  const activeOrgRef = useRef(organisationId);
  const prevOrgIdRef = useRef(organisationId);
  const isMountedRef = useRef(true);
  const customerPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset entire checkout draft, customer selection, search state, and idempotency key when workspace changes
  useEffect(() => {
    activeOrgRef.current = organisationId;
    if (prevOrgIdRef.current === organisationId) {
      return;
    }
    prevOrgIdRef.current = organisationId;
    customerSearchSeqRef.current += 1;
    pendingIdempotencyRef.current = null;
    submitLockRef.current = false;

    setSelectedLocationId('');
    setSearchQuery('');
    setCategoryFilter('all');
    setTypeFilter('all');
    setCart([]);
    setOrderDiscountInput('0');
    setSelectedCustomer(null);
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
    setCustomerSearchLoading(false);
    setCustomerSearchError(null);
    setCustomerDropdownOpen(false);
    setCustomerName('');
    setCustomerPhone('');
    setPaymentDrafts([]);
    setShowConfirmModal(false);
    setSubmitting(false);
    setFormError(null);
    setSuccessMessage(null);
    setLastCompletedSaleId(null);
  }, [organisationId]);

  // Close customer dropdown on outside click or Escape
  useEffect(() => {
    if (!customerDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        customerPickerRef.current &&
        !customerPickerRef.current.contains(event.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [customerDropdownOpen]);

  // Query-based debounced active customer search for POS selection
  useEffect(() => {
    const trimmed = customerSearchQuery.trim();
    if (!organisationId || selectedCustomer || (!customerDropdownOpen && trimmed.length === 0)) {
      setCustomerSearchLoading(false);
      return;
    }

    const seq = ++customerSearchSeqRef.current;
    const targetOrgId = organisationId;
    const delay = trimmed.length === 0 ? 0 : 250;
    setCustomerSearchLoading(true);
    setCustomerSearchError(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        const result = await searchCustomers(targetOrgId, trimmed, 25);
        if (
          !isMountedRef.current ||
          activeOrgRef.current !== targetOrgId ||
          customerSearchSeqRef.current !== seq
        ) {
          return;
        }
        setCustomerSearchLoading(false);
        if (result.error) {
          setCustomerSearchResults([]);
          setCustomerSearchError(result.error);
        } else {
          setCustomerSearchResults(result.customers);
          setCustomerSearchError(null);
        }
      })();
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [organisationId, customerSearchQuery, customerDropdownOpen, selectedCustomer]);

  // Sync default location
  useEffect(() => {
    if (activeLocations.length === 0) {
      setSelectedLocationId('');
      return;
    }
    if (!selectedLocationId || !activeLocations.some((l) => l.id === selectedLocationId)) {
      setSelectedLocationId(activeLocations[0].id);
    }
  }, [activeLocations, selectedLocationId]);

  // Ensure at least one payment draft row when active payment methods load
  useEffect(() => {
    if (activeMethods.length === 0) return;
    setPaymentDrafts((prev) => {
      if (prev.length === 0) {
        const defaultMethod = pickDefaultPaymentMethod(activeMethods);
        return [
          {
            rowKey: createDraftRowKey(),
            paymentMethodId: defaultMethod?.id ?? '',
            amount: '',
            reference: '',
          },
        ];
      }
      return prev.map((row) =>
        activeMethods.some((m) => m.id === row.paymentMethodId)
          ? row
          : {
              ...row,
              paymentMethodId: pickDefaultPaymentMethod(activeMethods)?.id ?? '',
            }
      );
    });
  }, [activeMethods]);

  const methodById = useMemo(
    () => new Map(activeMethods.map((m) => [m.id, m])),
    [activeMethods]
  );

  // Available quantity per variant at selected location
  const stockByVariantId = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedLocationId) return map;
    for (const balance of data.balances) {
      if (balance.locationId === selectedLocationId) {
        map.set(balance.variantId, roundQuantity(balance.quantity));
      }
    }
    return map;
  }, [data.balances, selectedLocationId]);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalogItems.filter((item) => {
      if (typeFilter !== 'all' && item.productType !== typeFilter) return false;
      if (categoryFilter !== 'all' && (item.categoryId ?? 'uncategorized') !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.productName.toLowerCase().includes(q) ||
        item.variantName.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode ?? '').toLowerCase().includes(q) ||
        item.categoryPath.toLowerCase().includes(q)
      );
    });
  }, [catalogItems, searchQuery, typeFilter, categoryFilter]);

  const cartQtyByVariant = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart) {
      map.set(line.variantId, line.quantity);
    }
    return map;
  }, [cart]);

  // Financial calculations (Authoritative computation happens in RPC; UI gives live accurate preview)
  const subtotalAmount = useMemo(
    () =>
      roundMoney(
        cart.reduce((sum, line) => sum + roundMoney(line.unitPrice * line.quantity), 0)
      ),
    [cart]
  );

  const lineDiscountTotal = useMemo(() => {
    if (!allowDiscounts) return 0;
    return roundMoney(cart.reduce((sum, line) => sum + roundMoney(line.lineDiscountAmount), 0));
  }, [cart, allowDiscounts]);

  const maxOrderDiscount = roundMoney(Math.max(0, subtotalAmount - lineDiscountTotal));
  const trimmedOrderDiscount = orderDiscountInput.trim();
  const rawOrderDiscountNum = trimmedOrderDiscount === '' ? 0 : Number(trimmedOrderDiscount);
  const hasInvalidOrderDiscount =
    allowDiscounts && (!Number.isFinite(rawOrderDiscountNum) || rawOrderDiscountNum < 0);
  const parsedOrderDiscount =
    allowDiscounts && Number.isFinite(rawOrderDiscountNum) && rawOrderDiscountNum > 0
      ? roundMoney(rawOrderDiscountNum)
      : 0;
  const orderDiscountExceedsMax = allowDiscounts && parsedOrderDiscount > maxOrderDiscount;
  const effectiveOrderDiscount = Math.min(parsedOrderDiscount, maxOrderDiscount);
  const totalDiscounts = roundMoney(lineDiscountTotal + effectiveOrderDiscount);
  const finalTotal = roundMoney(Math.max(0, subtotalAmount - totalDiscounts));

  const parsedPayments = useMemo(() => {
    return paymentDrafts.map((row) => {
      const amount = roundMoney(Math.max(0, Number(row.amount) || 0));
      const method = methodById.get(row.paymentMethodId) ?? null;
      return {
        ...row,
        numericAmount: amount,
        method,
      };
    });
  }, [paymentDrafts, methodById]);

  const activePaymentRows = useMemo(
    () => parsedPayments.filter((p) => p.numericAmount > 0),
    [parsedPayments]
  );

  const totalPaid = useMemo(
    () => roundMoney(activePaymentRows.reduce((sum, p) => sum + p.numericAmount, 0)),
    [activePaymentRows]
  );

  const outstandingBalance = roundMoney(Math.max(0, finalTotal - totalPaid));
  const isOverpaid = totalPaid > finalTotal;
  const isCreditSale = finalTotal > 0 && outstandingBalance > 0;
  const isStaffBlockedFromCredit = isCreditSale && !allowCreditSales;

  // Check if any cart line violates stock at the active location or zero-price rule
  const cartIssues = useMemo(() => {
    const issues: string[] = [];
    for (const line of cart) {
      if (line.unitPrice <= 0) {
        issues.push(`${line.productName} (${line.variantName}) has a zero selling price and cannot be sold.`);
      }
      if (line.productType === 'physical') {
        const available = stockByVariantId.get(line.variantId) ?? 0;
        if (line.quantity > available) {
          issues.push(
            `${line.productName} (${line.variantName}) quantity (${line.quantity}) exceeds available stock (${available}) at this location.`
          );
        }
      }
    }
    return issues;
  }, [cart, stockByVariantId]);

  const lastCompletedSale = useMemo(() => {
    if (!lastCompletedSaleId) return null;
    return data.sales.find((s) => s.id === lastCompletedSaleId) ?? null;
  }, [data.sales, lastCompletedSaleId]);

  const handleAddToCart = (item: PosCatalogItem) => {
    setFormError(null);
    setSuccessMessage(null);
    setLastCompletedSaleId(null);

    if (!selectedLocationId) {
      setFormError('Select an active inventory location before adding items.');
      return;
    }
    if (item.sellingPrice <= 0) {
      setFormError(`"${item.productName} (${item.variantName})" cannot be sold because its selling price is 0.`);
      return;
    }

    const available = stockByVariantId.get(item.variantId) ?? 0;
    const existingQty = cartQtyByVariant.get(item.variantId) ?? 0;

    if (item.productType === 'physical') {
      if (available <= 0) {
        setFormError(`"${item.productName} (${item.variantName})" is out of stock at this location.`);
        return;
      }
      if (existingQty + 1 > available) {
        setFormError(
          `Only ${available} ${formatUnitOfMeasureLabel(item.unitOfMeasure)} available for "${item.productName} (${item.variantName})" at this location.`
        );
        return;
      }
    }

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.variantId === item.variantId);
      if (idx === -1) {
        return [
          ...prev,
          {
            variantId: item.variantId,
            productId: item.productId,
            productName: item.productName,
            variantName: item.variantName,
            productType: item.productType,
            sku: item.sku,
            unitOfMeasure: item.unitOfMeasure,
            unitPrice: roundMoney(item.sellingPrice),
            quantity: 1,
            lineDiscountAmount: 0,
          },
        ];
      }
      return prev.map((line, i) =>
        i === idx ? { ...line, quantity: roundQuantity(line.quantity + 1) } : line
      );
    });
  };

  const handleUpdateCartQty = (variantId: string, rawQty: number) => {
    setFormError(null);
    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      setCart((prev) => prev.filter((l) => l.variantId !== variantId));
      return;
    }
    const nextQty = roundQuantity(rawQty);
    setCart((prev) =>
      prev.map((line) => {
        if (line.variantId !== variantId) return line;
        let clampedQty = nextQty;
        if (line.productType === 'physical') {
          const available = stockByVariantId.get(variantId) ?? 0;
          if (clampedQty > available) {
            clampedQty = available;
            setFormError(
              `Adjusted "${line.productName} (${line.variantName})" quantity to available stock (${available}).`
            );
          }
        }
        const maxLineDisc = roundMoney(line.unitPrice * clampedQty);
        return {
          ...line,
          quantity: clampedQty,
          lineDiscountAmount: Math.min(line.lineDiscountAmount, maxLineDisc),
        };
      })
    );
  };

  const handleUpdateLineDiscount = (variantId: string, rawValue: string) => {
    if (!allowDiscounts) return;
    setFormError(null);
    const val = roundMoney(Math.max(0, Number(rawValue) || 0));
    setCart((prev) =>
      prev.map((line) => {
        if (line.variantId !== variantId) return line;
        const maxDisc = roundMoney(line.unitPrice * line.quantity);
        return {
          ...line,
          lineDiscountAmount: Math.min(val, maxDisc),
        };
      })
    );
  };

  const handleRemoveCartLine = (variantId: string) => {
    setFormError(null);
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  };

  const handleSelectCustomer = (customer: CustomerRecord) => {
    setSelectedCustomer(customer);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone ?? '');
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
    setCustomerSearchError(null);
    setCustomerDropdownOpen(false);
    setFormError(null);
  };

  const handleClearSelectedCustomer = () => {
    customerSearchSeqRef.current += 1;
    setSelectedCustomer(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
    setCustomerSearchError(null);
    setCustomerSearchLoading(false);
    setCustomerDropdownOpen(false);
    setFormError(null);
  };

  const handleClearSaleDraft = () => {
    customerSearchSeqRef.current += 1;
    setCart([]);
    setOrderDiscountInput('0');
    setSelectedCustomer(null);
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
    setCustomerSearchError(null);
    setCustomerSearchLoading(false);
    setCustomerDropdownOpen(false);
    setCustomerName('');
    setCustomerPhone('');
    setFormError(null);
    const defaultMethod = pickDefaultPaymentMethod(activeMethods);
    setPaymentDrafts([
      {
        rowKey: createDraftRowKey(),
        paymentMethodId: defaultMethod?.id ?? '',
        amount: '',
        reference: '',
      },
    ]);
    pendingIdempotencyRef.current = null;
  };

  const handleAddPaymentRow = () => {
    const usedIds = new Set(paymentDrafts.map((p) => p.paymentMethodId));
    const unused = activeMethods.find((m) => !usedIds.has(m.id)) ?? activeMethods[0];
    setPaymentDrafts((prev) => [
      ...prev,
      {
        rowKey: createDraftRowKey(),
        paymentMethodId: unused?.id ?? '',
        amount: '',
        reference: '',
      },
    ]);
  };

  const handleUpdatePaymentRow = (
    rowKey: string,
    patch: Partial<Omit<PosPaymentDraft, 'rowKey'>>
  ) => {
    setFormError(null);
    setPaymentDrafts((prev) =>
      prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row))
    );
  };

  const handleRemovePaymentRow = (rowKey: string) => {
    setFormError(null);
    setPaymentDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.rowKey !== rowKey)));
  };

  const handleFillRemaining = (rowKey: string) => {
    setFormError(null);
    const otherPaid = parsedPayments
      .filter((r) => r.rowKey !== rowKey)
      .reduce((sum, r) => sum + r.numericAmount, 0);
    const remainingForRow = roundMoney(Math.max(0, finalTotal - otherPaid));
    handleUpdatePaymentRow(rowKey, {
      amount: remainingForRow > 0 ? String(remainingForRow) : '0',
    });
  };

  const validateCheckout = (): string | null => {
    if (!selectedLocationId) {
      return 'Please select a sales location.';
    }
    if (cart.length === 0) {
      return 'Add at least one item to the cart before checking out.';
    }
    if (cartIssues.length > 0) {
      return cartIssues[0];
    }
    if (hasInvalidOrderDiscount) {
      return 'Order discount must be zero or a positive amount.';
    }
    if (orderDiscountExceedsMax) {
      return 'Order discount exceeds the remaining subtotal after line discounts.';
    }
    if (isOverpaid) {
      return `Total payment (${formatMoneyAmount(totalPaid, currencyCode)}) cannot exceed Final Total (${formatMoneyAmount(finalTotal, currencyCode)}).`;
    }
    if (finalTotal > 0 && activeMethods.length === 0 && !allowCreditSales) {
      return 'No active payment methods are available.';
    }
    for (const row of activePaymentRows) {
      if (!row.paymentMethodId || !row.method) {
        return 'Select a valid payment method for every payment amount entered.';
      }
      if (isPaymentReferenceRequired(row.method) && !row.reference.trim()) {
        return `Payment reference is required for "${row.method.name}".`;
      }
    }
    if (isCreditSale) {
      if (!allowCreditSales) {
        return 'Staff users must collect full payment at checkout. Credit or partial sales require manager, admin, or owner approval.';
      }
      const effectiveCustomerName = selectedCustomer
        ? selectedCustomer.name.trim()
        : customerName.trim();
      if (!effectiveCustomerName) {
        return 'Customer name is required for partial or unpaid credit sales.';
      }
    }
    return null;
  };

  const handleOpenConfirm = () => {
    setFormError(null);
    setSuccessMessage(null);
    const err = validateCheckout();
    if (err) {
      setFormError(err);
      return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirmCheckout = async () => {
    if (submitLockRef.current || submitting) return;
    const err = validateCheckout();
    if (err) {
      setFormError(err);
      setShowConfirmModal(false);
      return;
    }

    const payloadItems = cart.map((line) => ({
      variantId: line.variantId,
      quantity: roundQuantity(line.quantity),
      discountAmount: allowDiscounts ? roundMoney(line.lineDiscountAmount) : 0,
    }));
    const payloadPayments = activePaymentRows.map((row) => ({
      paymentMethodId: row.paymentMethodId,
      amount: roundMoney(row.numericAmount),
      reference: row.reference.trim() || null,
    }));
    const orderDiscount = allowDiscounts ? effectiveOrderDiscount : 0;
    const customerId = selectedCustomer?.id ?? null;
    const custName = (selectedCustomer ? selectedCustomer.name : customerName).trim() || null;
    const custPhone = (selectedCustomer ? (selectedCustomer.phone ?? '') : customerPhone).trim() || null;

    const signature = JSON.stringify({
      organisationId,
      selectedLocationId,
      payloadItems,
      payloadPayments,
      orderDiscount,
      customerId,
      custName,
      custPhone,
    });

    if (
      !pendingIdempotencyRef.current ||
      pendingIdempotencyRef.current.signature !== signature
    ) {
      pendingIdempotencyRef.current = {
        signature,
        key: generateIdempotencyKey(),
      };
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setFormError(null);

    try {
      const result = await checkoutSale(organisationId, {
        locationId: selectedLocationId,
        items: payloadItems,
        payments: payloadPayments,
        orderDiscountAmount: orderDiscount,
        customerId,
        customerName: custName,
        customerPhone: custPhone,
        idempotencyKey: pendingIdempotencyRef.current.key,
      });

      if (result.error) {
        setFormError(result.error);
        setShowConfirmModal(false);
        return;
      }

      pendingIdempotencyRef.current = null;
      setShowConfirmModal(false);
      handleClearSaleDraft();
      setLastCompletedSaleId(result.saleId);
      setSuccessMessage('Sale completed and recorded in the ledger.');
      await onReload();
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const selectedLocationName =
    activeLocations.find((l) => l.id === selectedLocationId)?.name ?? 'No location selected';

  return (
    <div className="space-y-6">
      {successMessage && (
        <section
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="font-semibold">{successMessage}</div>
              {lastCompletedSale && (
                <div className="text-emerald-800 mt-0.5">
                  Receipt <span className="font-mono font-semibold">{lastCompletedSale.saleNumber}</span>{' '}
                  · Total {formatMoneyAmount(lastCompletedSale.totalAmount, lastCompletedSale.currency)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastCompletedSale && (
              <button
                type="button"
                onClick={() => onOpenReceipt(lastCompletedSale)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 transition-colors"
              >
                <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                <span>View Receipt</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSuccessMessage(null);
                setLastCompletedSaleId(null);
              }}
              className="px-3 py-1.5 rounded-md border border-emerald-300 bg-white text-xs font-medium text-emerald-900 hover:bg-emerald-50"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {formError && (
        <section
          role="alert"
          className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2.5 text-xs text-red-900"
        >
          <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="font-medium">{formError}</div>
        </section>
      )}

      {activeLocations.length === 0 && !loading && (
        <section
          role="alert"
          className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-2.5 text-xs text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            No active inventory locations exist for this organization. Create or activate a location in Inventory before processing sales.
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Product Catalog & Search (7 columns) */}
        <section
          aria-labelledby="pos-catalog-heading"
          className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 id="pos-catalog-heading" className="text-sm font-semibold text-slate-900">
                POS Catalog
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select a location and add active products or services to the cart.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              <label htmlFor="pos-location-select" className="sr-only">
                Sales Location
              </label>
              <select
                id="pos-location-select"
                value={selectedLocationId}
                onChange={(e) => {
                  setSelectedLocationId(e.target.value);
                  setFormError(null);
                }}
                disabled={activeLocations.length === 0}
                className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {activeLocations.length === 0 ? (
                  <option value="">No active locations</option>
                ) : (
                  activeLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.locationType})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-6 relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    const q = searchQuery.trim().toLowerCase();
                    const exact = catalogItems.find(
                      (item) =>
                        item.sku.toLowerCase() === q ||
                        (item.barcode ?? '').toLowerCase() === q
                    );
                    if (exact) {
                      e.preventDefault();
                      handleAddToCart(exact);
                      setSearchQuery('');
                    }
                  }
                }}
                placeholder="Search product, SKU, or scan barcode..."
                aria-label="Search catalog by name, SKU, or barcode"
                className="w-full pl-8 pr-28 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <BarcodeCameraScanner onDetected={(value) => {
                  const match = catalogItems.find((item) => (item.barcode ?? '').trim() === value);
                  if (match) {
                    handleAddToCart(match);
                    setSearchQuery('');
                  } else {
                    setSearchQuery(value);
                  }
                }} />
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="pos-category-filter" className="sr-only">
                Filter by category
              </label>
              <select
                id="pos-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="all">All categories</option>
                {data.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
                <option value="uncategorized">Uncategorized</option>
              </select>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="pos-type-filter" className="sr-only">
                Filter by product type
              </label>
              <select
                id="pos-type-filter"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as 'all' | 'physical' | 'service')
                }
                className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="all">All types</option>
                <option value="physical">Physical products</option>
                <option value="service">Services</option>
              </select>
            </div>
          </div>

          {/* Catalog Items */}
          {loading ? (
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy="true">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-24 bg-slate-100 rounded-md animate-pulse" />
              ))}
            </div>
          ) : data.errors.catalog ? (
            <div className="p-6 text-xs text-amber-800 bg-amber-50/50">
              Unable to load catalog: {data.errors.catalog}
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="p-10 text-center space-y-1.5">
              <Package className="h-6 w-6 text-slate-400 mx-auto" aria-hidden="true" />
              <div className="text-xs font-semibold text-slate-900">
                No matching active items found
              </div>
              <p className="text-xs text-slate-500">
                Adjust your search or verify that products and variants are active in Inventory.
              </p>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[680px] overflow-y-auto">
              {filteredCatalog.map((item) => {
                const available = stockByVariantId.get(item.variantId) ?? 0;
                const inCartQty = cartQtyByVariant.get(item.variantId) ?? 0;
                const isZeroPrice = item.sellingPrice <= 0;
                const isOutOfStock = item.productType === 'physical' && available <= 0;
                const isMaxedInCart =
                  item.productType === 'physical' && inCartQty >= available && available > 0;
                const disabled =
                  !selectedLocationId || isZeroPrice || isOutOfStock || isMaxedInCart;

                return (
                  <div
                    key={item.variantId}
                    className={`border rounded-md p-3.5 flex flex-col justify-between gap-3 transition-colors ${
                      isZeroPrice || isOutOfStock
                        ? 'border-slate-200 bg-slate-50/70'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {item.productName}
                          </div>
                          <div className="text-[11px] text-slate-600 truncate">
                            {item.variantName}
                          </div>
                        </div>
                        <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                          {formatMoneyAmount(item.sellingPrice, currencyCode)}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                        <span className="font-mono">{item.sku}</span>
                        {item.barcode && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">BC: {item.barcode}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{item.categoryName}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                      <div className="text-[11px]">
                        {isZeroPrice ? (
                          <span className="font-medium text-red-700">
                            Price &gt; 0 required
                          </span>
                        ) : item.productType === 'service' ? (
                          <span className="text-slate-500">Service · No stock limit</span>
                        ) : available <= 0 ? (
                          <span className="font-medium text-red-700">Out of stock</span>
                        ) : (
                          <span className="text-emerald-700 font-medium font-mono tabular-nums">
                            {available} {formatUnitOfMeasureLabel(item.unitOfMeasure)} avail
                            {inCartQty > 0 ? ` (${inCartQty} in cart)` : ''}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddToCart(item)}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-700 text-white text-[11px] font-medium hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        <span>{inCartQty > 0 ? 'Add 1' : 'Add'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Cart, Discounts (Role-Gated), Customer & Payments (5 columns) */}
        <section
          aria-labelledby="pos-cart-heading"
          className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-200"
        >
          {/* Cart Header */}
          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-slate-600" aria-hidden="true" />
              <div>
                <h2 id="pos-cart-heading" className="text-sm font-semibold text-slate-900">
                  Current Sale ({cart.length})
                </h2>
                <p className="text-[11px] text-slate-500">{selectedLocationName}</p>
              </div>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={handleClearSaleDraft}
                className="text-xs font-medium text-slate-500 hover:text-red-700 transition-colors"
              >
                Clear cart
              </button>
            )}
          </div>

          {/* Cart Issues Banner */}
          {cartIssues.length > 0 && (
            <div className="px-5 py-3 bg-amber-50 text-xs text-amber-900 space-y-1">
              {cartIssues.map((issue) => (
                <div key={issue} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{issue}</span>
                </div>
              ))}
            </div>
          )}

          {/* Cart Items List */}
          <div className="divide-y divide-slate-100 max-h-[340px] overflow-y-auto">
            {cart.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Cart is empty. Select items from the catalog to start a sale.
              </div>
            ) : (
              cart.map((line) => {
                const lineSubtotal = roundMoney(line.unitPrice * line.quantity);
                const lineNet = roundMoney(
                  Math.max(0, lineSubtotal - (allowDiscounts ? line.lineDiscountAmount : 0))
                );
                const available =
                  line.productType === 'physical'
                    ? (stockByVariantId.get(line.variantId) ?? 0)
                    : null;

                return (
                  <div key={line.variantId} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          {line.productName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {line.variantName} · {formatMoneyAmount(line.unitPrice, currencyCode)} /{' '}
                          {formatUnitOfMeasureLabel(line.unitOfMeasure)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                          {formatMoneyAmount(lineNet, currencyCode)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCartLine(line.variantId)}
                          aria-label={`Remove ${line.productName} ${line.variantName}`}
                          className="p-1 rounded text-slate-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="inline-flex items-center border border-slate-200 rounded-md overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(line.variantId, line.quantity - 1)}
                          aria-label={`Decrease quantity for ${line.productName}`}
                          className="px-2 py-1 text-slate-600 hover:bg-slate-100"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          max={available !== null ? roundQuantity(available) : undefined}
                          value={line.quantity}
                          onChange={(e) =>
                            handleUpdateCartQty(line.variantId, Number(e.target.value))
                          }
                          aria-label={`Quantity for ${line.productName}`}
                          className="w-16 text-center py-1 text-xs font-mono tabular-nums text-slate-900 border-x border-slate-200 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(line.variantId, line.quantity + 1)}
                          disabled={available !== null && line.quantity >= available}
                          aria-label={`Increase quantity for ${line.productName}`}
                          className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>

                      {allowDiscounts && (
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`line-disc-${line.variantId}`}
                            className="text-[11px] text-slate-500 whitespace-nowrap"
                          >
                            Line disc ({currencyCode})
                          </label>
                          <input
                            id={`line-disc-${line.variantId}`}
                            type="number"
                            min="0"
                            step="0.01"
                            max={lineSubtotal}
                            value={line.lineDiscountAmount || ''}
                            placeholder="0"
                            onChange={(e) =>
                              handleUpdateLineDiscount(line.variantId, e.target.value)
                            }
                            className="w-24 px-2 py-1 rounded-md border border-slate-200 text-right text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Totals & Order Discount (Role-gated) */}
          <div className="p-4 space-y-2.5 bg-slate-50/50 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums text-slate-900">
                {formatMoneyAmount(subtotalAmount, currencyCode)}
              </span>
            </div>

            {allowDiscounts && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="pos-order-discount" className="text-slate-600">
                    Order Discount ({currencyCode})
                  </label>
                  <input
                    id="pos-order-discount"
                    type="number"
                    min="0"
                    step="0.01"
                    max={maxOrderDiscount}
                    value={orderDiscountInput}
                    onChange={(e) => {
                      setOrderDiscountInput(e.target.value);
                      setFormError(null);
                    }}
                    disabled={cart.length === 0}
                    className={`w-28 px-2.5 py-1 rounded-md border bg-white text-right text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                      hasInvalidOrderDiscount || orderDiscountExceedsMax
                        ? 'border-red-400'
                        : 'border-slate-200'
                    }`}
                  />
                </div>
                {(hasInvalidOrderDiscount || orderDiscountExceedsMax) && (
                  <p className="text-[11px] text-red-700 text-right">
                    {hasInvalidOrderDiscount
                      ? 'Order discount cannot be negative or invalid.'
                      : `Exceeds remaining subtotal (${formatMoneyAmount(maxOrderDiscount, currencyCode)}).`}
                  </p>
                )}
              </div>
            )}

            {totalDiscounts > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>Total Discounts</span>
                <span className="font-mono tabular-nums">
                  -{formatMoneyAmount(totalDiscounts, currencyCode)}
                </span>
              </div>
            )}

            <div className="flex justify-between text-slate-500">
              <span>Tax (Sales v1)</span>
              <span className="font-mono tabular-nums">
                {formatMoneyAmount(0, currencyCode)}
              </span>
            </div>

            <div className="flex justify-between items-baseline pt-2 border-t border-slate-200 text-sm font-semibold text-slate-900">
              <span>Final Total</span>
              <span className="font-mono text-base tabular-nums">
                {formatMoneyAmount(finalTotal, currencyCode)}
              </span>
            </div>
          </div>

          {/* Payments */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <CreditCard className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>Payments</span>
              </div>
              {activeMethods.length > 0 && (
                <button
                  type="button"
                  onClick={handleAddPaymentRow}
                  className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                >
                  + Add Split Payment
                </button>
              )}
            </div>

            {activeMethods.length === 0 ? (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                No active payment methods configured. An Owner or Admin must create/activate a payment method before collecting payments.
              </div>
            ) : (
              <div className="space-y-2.5">
                {paymentDrafts.map((row, index) => {
                  const method = methodById.get(row.paymentMethodId) ?? null;
                  const refRequired = isPaymentReferenceRequired(method);
                  const numericAmt = roundMoney(Math.max(0, Number(row.amount) || 0));

                  return (
                    <div
                      key={row.rowKey}
                      className="p-3 rounded-md border border-slate-200 bg-slate-50/40 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor={`pay-method-${row.rowKey}`} className="sr-only">
                          Payment method {index + 1}
                        </label>
                        <select
                          id={`pay-method-${row.rowKey}`}
                          value={row.paymentMethodId}
                          onChange={(e) =>
                            handleUpdatePaymentRow(row.rowKey, {
                              paymentMethodId: e.target.value,
                            })
                          }
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          {activeMethods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.amount}
                          onChange={(e) =>
                            handleUpdatePaymentRow(row.rowKey, { amount: e.target.value })
                          }
                          placeholder="0.00"
                          aria-label={`Payment amount ${index + 1}`}
                          className="w-28 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-right text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />

                        <button
                          type="button"
                          onClick={() => handleFillRemaining(row.rowKey)}
                          disabled={finalTotal <= 0}
                          className="px-2 py-1.5 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 whitespace-nowrap"
                        >
                          Fill
                        </button>

                        {paymentDrafts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemovePaymentRow(row.rowKey)}
                            aria-label="Remove payment row"
                            className="p-1 rounded text-slate-400 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div>
                        <input
                          type="text"
                          value={row.reference}
                          onChange={(e) =>
                            handleUpdatePaymentRow(row.rowKey, {
                              reference: e.target.value,
                            })
                          }
                          placeholder={
                            refRequired && numericAmt > 0
                              ? 'Reference required (e.g. bank transfer ref)'
                              : refRequired
                                ? 'Reference required when amount > 0'
                                : 'Reference (optional)'
                          }
                          aria-label={`Payment reference ${index + 1}`}
                          className={`w-full px-2.5 py-1.5 rounded-md border bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                            refRequired && numericAmt > 0 && !row.reference.trim()
                              ? 'border-amber-400'
                              : 'border-slate-200'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-1 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Total Paid</span>
                <span className="font-mono font-semibold tabular-nums text-emerald-700">
                  {formatMoneyAmount(totalPaid, currencyCode)}
                </span>
              </div>
              {isOverpaid ? (
                <div className="text-red-700 font-medium">
                  Overpayment of {formatMoneyAmount(roundMoney(totalPaid - finalTotal), currencyCode)} is not allowed.
                </div>
              ) : (
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    {isCreditSale ? 'Outstanding Balance (Credit)' : 'Remaining Balance'}
                  </span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      isCreditSale ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {formatMoneyAmount(outstandingBalance, currencyCode)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Customer Details */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <User className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                <span>Customer Details</span>
              </div>
              <span className="text-[11px] text-slate-500">
                {isCreditSale ? 'Name compulsory for credit sales' : 'Optional for paid walk-in sales'}
              </span>
            </div>

            {isStaffBlockedFromCredit && cart.length > 0 && (
              <div
                role="alert"
                className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900"
              >
                Staff accounts must collect full payment at checkout ({formatMoneyAmount(finalTotal, currencyCode)}). Credit and partial sales are restricted to owners, admins, and managers.
              </div>
            )}

            {selectedCustomer ? (
              <div className="rounded-md border border-blue-200 bg-blue-50/70 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <UserCheck className="h-4 w-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {selectedCustomer.name}
                    </div>
                    <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="text-blue-800 font-medium">Registered customer</span>
                      {selectedCustomer.phone && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{selectedCustomer.phone}</span>
                        </>
                      )}
                      {selectedCustomer.email && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{selectedCustomer.email}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearSelectedCustomer}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 self-start sm:self-center"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                  <span>Clear / Switch to Walk-in</span>
                </button>
              </div>
            ) : (
              <div ref={customerPickerRef} className="relative">
                <label
                  htmlFor="pos-customer-search"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Select Registered Customer (Optional)
                </label>
                <div className="relative">
                  <Search
                    className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="pos-customer-search"
                    type="text"
                    value={customerSearchQuery}
                    onFocus={() => setCustomerDropdownOpen(true)}
                    onChange={(e) => {
                      setCustomerSearchQuery(e.target.value);
                      setCustomerDropdownOpen(true);
                    }}
                    placeholder="Search active customers by name, phone, or email..."
                    autoComplete="off"
                    className="w-full pl-8 pr-8 py-1.5 rounded-md border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {customerSearchLoading ? (
                    <Loader2
                      className="h-3.5 w-3.5 text-slate-400 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                  ) : (
                    customerSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerSearchQuery('');
                          setCustomerDropdownOpen(true);
                        }}
                        aria-label="Clear customer search"
                        className="p-0.5 rounded text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )
                  )}
                </div>

                {customerDropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Registered customers"
                    className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto"
                  >
                    {customerSearchLoading && customerSearchResults.length === 0 ? (
                      <div className="px-3 py-2.5 text-xs text-slate-500 flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        <span>Searching active customers...</span>
                      </div>
                    ) : customerSearchError ? (
                      <div className="px-3 py-2.5 text-xs text-amber-800 bg-amber-50">
                        {customerSearchError}
                      </div>
                    ) : customerSearchResults.length === 0 ? (
                      <div className="px-3 py-2.5 text-xs text-slate-500">
                        {customerSearchQuery.trim()
                          ? `No active customers match "${customerSearchQuery.trim()}". Enter walk-in details below.`
                          : 'No active registered customers found. Enter walk-in details below.'}
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {customerSearchResults.map((customer) => (
                          <button
                            key={customer.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => handleSelectCustomer(customer)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-900 truncate">
                                {customer.name}
                              </div>
                              {(customer.phone || customer.email) && (
                                <div className="text-[11px] text-slate-500 truncate">
                                  {customer.phone ? customer.phone : ''}
                                  {customer.phone && customer.email ? ' · ' : ''}
                                  {customer.email ? customer.email : ''}
                                </div>
                              )}
                            </div>
                            <span className="text-[11px] font-medium text-blue-700 shrink-0">
                              Select
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="pos-customer-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Customer Name {isCreditSale && <span className="text-red-600">*</span>}
                </label>
                <input
                  id="pos-customer-name"
                  type="text"
                  value={customerName}
                  readOnly={Boolean(selectedCustomer)}
                  disabled={Boolean(selectedCustomer)}
                  onChange={(e) => {
                    if (selectedCustomer) return;
                    setCustomerName(e.target.value);
                    setFormError(null);
                  }}
                  placeholder={isCreditSale ? 'Required customer name' : 'Walk-in customer'}
                  className={`w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                    selectedCustomer
                      ? 'bg-slate-50 text-slate-600 cursor-not-allowed'
                      : 'bg-white text-slate-900'
                  }`}
                />
              </div>
              <div>
                <label htmlFor="pos-customer-phone" className="block text-[11px] font-medium text-slate-600 mb-1">
                  Phone (Optional)
                </label>
                <input
                  id="pos-customer-phone"
                  type="tel"
                  value={customerPhone}
                  readOnly={Boolean(selectedCustomer)}
                  disabled={Boolean(selectedCustomer)}
                  onChange={(e) => {
                    if (selectedCustomer) return;
                    setCustomerPhone(e.target.value);
                  }}
                  placeholder="Optional phone number"
                  className={`w-full px-2.5 py-1.5 rounded-md border border-slate-200 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                    selectedCustomer
                      ? 'bg-slate-50 text-slate-600 cursor-not-allowed'
                      : 'bg-white text-slate-900'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Checkout Submit Button */}
          <div className="p-4 bg-slate-50/60">
            <button
              type="button"
              onClick={handleOpenConfirm}
              disabled={
                cart.length === 0 ||
                !selectedLocationId ||
                cartIssues.length > 0 ||
                hasInvalidOrderDiscount ||
                orderDiscountExceedsMax ||
                isOverpaid ||
                isStaffBlockedFromCredit ||
                submitting
              }
              className="w-full py-2.5 px-4 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              {isCreditSale
                ? `Review Credit Sale (${formatMoneyAmount(finalTotal, currencyCode)})`
                : `Complete Sale (${formatMoneyAmount(finalTotal, currencyCode)})`}
            </button>
          </div>
        </section>
      </div>

      {/* Checkout Confirmation Modal */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-checkout-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 id="confirm-checkout-title" className="text-sm font-semibold text-slate-900">
                Confirm Sale Checkout
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Review totals, stock location, and payment allocation before posting to the ledger.
              </p>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Location</span>
                <span className="font-medium text-slate-900">{selectedLocationName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cart Items</span>
                <span className="font-mono text-slate-900">{cart.length} line(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-mono tabular-nums text-slate-900">
                  {formatMoneyAmount(subtotalAmount, currencyCode)}
                </span>
              </div>
              {lineDiscountTotal > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>Line Discounts</span>
                  <span className="font-mono tabular-nums">
                    -{formatMoneyAmount(lineDiscountTotal, currencyCode)}
                  </span>
                </div>
              )}
              {effectiveOrderDiscount > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>Order Discount</span>
                  <span className="font-mono tabular-nums">
                    -{formatMoneyAmount(effectiveOrderDiscount, currencyCode)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-100 font-semibold text-slate-900">
                <span>Final Total</span>
                <span className="font-mono tabular-nums">
                  {formatMoneyAmount(finalTotal, currencyCode)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount Collected Now</span>
                <span className="font-mono font-medium text-emerald-700 tabular-nums">
                  {formatMoneyAmount(totalPaid, currencyCode)}
                </span>
              </div>
              {isCreditSale && (
                <div className="flex justify-between text-amber-700 font-semibold">
                  <span>Credit Balance</span>
                  <span className="font-mono tabular-nums">
                    {formatMoneyAmount(outstandingBalance, currencyCode)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Customer</span>
                <span className="text-slate-900 text-right">
                  {selectedCustomer ? (
                    <>
                      <span className="font-medium">{selectedCustomer.name}</span>
                      {selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ''}
                      <span className="text-blue-700 font-medium"> · Registered</span>
                    </>
                  ) : customerName.trim() || customerPhone.trim() ? (
                    <>
                      {customerName.trim() || 'Walk-in'}
                      {customerPhone.trim() ? ` (${customerPhone.trim()})` : ''}
                      <span className="text-slate-500"> · Walk-in</span>
                    </>
                  ) : (
                    'Walk-in Customer'
                  )}
                </span>
              </div>
              {activePaymentRows.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  <div className="text-[11px] font-medium text-slate-500">Payments</div>
                  {activePaymentRows.map((p) => (
                    <div key={p.rowKey} className="flex justify-between">
                      <span className="text-slate-700">
                        {p.method?.name}
                        {p.reference.trim() ? ` (Ref: ${p.reference.trim()})` : ''}
                      </span>
                      <span className="font-mono tabular-nums text-slate-900">
                        {formatMoneyAmount(p.numericAmount, currencyCode)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCheckout()}
                disabled={submitting}
                className="px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50"
              >
                {submitting ? 'Posting Sale...' : 'Confirm & Post Sale'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

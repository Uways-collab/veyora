import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Download,
  History,
  Info,
  PackageX,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  STOCK_MOVEMENT_TYPE_OPTIONS,
  formatMoneyAmount,
  formatUnitOfMeasureLabel,
  type InventoryOverviewData,
  type StockTransferStatusValue,
} from '../inventory/inventoryService';
import {
  DEFAULT_MOVEMENT_REPORT_LIMIT,
  buildInventorySummaryReport,
  buildLowStockOutOfStockReport,
  buildReportCsv,
  buildStockTransferReport,
  buildStockValuationReport,
  fetchInventoryReportsBaseData,
  fetchStockMovementReport,
  resolveReportingTimezone,
  type StockMovementReportResult,
  type UnitQuantitySummary,
} from './inventoryReportsService';

type InventoryReportTab =
  | 'summary'
  | 'valuation'
  | 'movements'
  | 'transfers'
  | 'low_stock';

type ValuationViewMode = 'detail' | 'by_location' | 'by_category';

function formatQuantity(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
      maximumFractionDigits: 4,
    }).format(safe);
  } catch {
    return String(safe);
  }
}

function formatSignedQuantity(value: number): string {
  const formatted = formatQuantity(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatZonedDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatUnitSummaryInline(summary: UnitQuantitySummary, signed = false): string {
  if (summary.breakdown.length === 0) return '0';
  return summary.breakdown
    .map((b) => {
      const qtyText = signed ? formatSignedQuantity(b.totalQuantity) : formatQuantity(b.totalQuantity);
      return `${qtyText} ${b.unitLabel}`;
    })
    .join(' · ');
}

function UnitSummaryValue({
  summary,
  signed = false,
}: {
  summary: UnitQuantitySummary;
  signed?: boolean;
}) {
  if (summary.breakdown.length === 0) {
    return <span className="font-mono text-slate-900">0</span>;
  }
  if (!summary.hasMixedUnits) {
    const only = summary.breakdown[0];
    return (
      <span className="font-mono text-slate-900">
        {signed ? formatSignedQuantity(only.totalQuantity) : formatQuantity(only.totalQuantity)}{' '}
        <span className="font-sans text-xs font-normal text-slate-600">{only.unitLabel}</span>
      </span>
    );
  }
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-semibold text-slate-900">
        Mixed units ({summary.distinctUnitsCount})
      </div>
      <div className="text-[11px] font-mono text-slate-600 leading-snug">
        {formatUnitSummaryInline(summary, signed)}
      </div>
    </div>
  );
}

function triggerCsvDownload(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sanitizeFilenameSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'organisation'
  );
}

export function InventoryReportsPanel() {
  const { status, activeOrganisation, activeMembership, activeRole } = useAuth();

  const activeOrgId =
    status === 'authenticated' &&
    activeOrganisation?.id &&
    activeMembership?.organisation_id === activeOrganisation.id
      ? activeOrganisation.id
      : null;

  const orgName = activeOrganisation?.name ?? 'Business Workspace';
  const currencyCode = activeOrganisation?.base_currency ?? 'USD';
  const tzInfo = useMemo(
    () => resolveReportingTimezone(activeOrganisation?.timezone),
    [activeOrganisation?.timezone]
  );
  const tzSourceLabel =
    tzInfo.source === 'organisation' ? 'Organisation timezone' : 'Browser local timezone';

  const [reportTab, setReportTab] = useState<InventoryReportTab>('summary');
  const [baseData, setBaseData] = useState<InventoryOverviewData | null>(null);
  const [totalMovementsCount, setTotalMovementsCount] = useState<number | null>(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [refreshingBase, setRefreshingBase] = useState(false);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Stock Valuation filters
  const [valViewMode, setValViewMode] = useState<ValuationViewMode>('detail');
  const [valLocationId, setValLocationId] = useState('all');
  const [valCategoryId, setValCategoryId] = useState('all');
  const [valIncludeZero, setValIncludeZero] = useState(false);
  const [valIncludeArchived, setValIncludeArchived] = useState(false);
  const [valSearch, setValSearch] = useState('');

  // Stock Movements dedicated query & filters
  const [movFromDate, setMovFromDate] = useState('');
  const [movToDate, setMovToDate] = useState('');
  const [movLocationId, setMovLocationId] = useState('all');
  const [movTypeFilter, setMovTypeFilter] = useState('all');
  const [movSearch, setMovSearch] = useState('');
  const [movLimit, setMovLimit] = useState<number>(DEFAULT_MOVEMENT_REPORT_LIMIT);
  const [movOffset, setMovOffset] = useState(0);
  const [movementReport, setMovementReport] = useState<StockMovementReportResult | null>(null);
  const [loadingMovements, setLoadingMovements] = useState(false);

  // Stock Transfers report filters
  const [trfFromDate, setTrfFromDate] = useState('');
  const [trfToDate, setTrfToDate] = useState('');
  const [trfStatus, setTrfStatus] = useState<'all' | StockTransferStatusValue>('all');
  const [trfSourceId, setTrfSourceId] = useState('all');
  const [trfDestId, setTrfDestId] = useState('all');
  const [trfSearch, setTrfSearch] = useState('');

  // Low-Stock & Out-of-Stock report filters
  const [lowSeverity, setLowSeverity] = useState<'all_alerts' | 'low_stock' | 'out_of_stock'>('all_alerts');
  const [lowLocationId, setLowLocationId] = useState('all');
  const [lowCategoryId, setLowCategoryId] = useState('all');
  const [lowIncludeArchived, setLowIncludeArchived] = useState(false);
  const [lowSearch, setLowSearch] = useState('');

  const loadBaseData = useCallback(async (orgId: string, isRefresh = false) => {
    if (isRefresh) setRefreshingBase(true);
    else setLoadingBase(true);
    setBaseError(null);
    setExportError(null);

    try {
      const res = await fetchInventoryReportsBaseData(orgId);
      if (res.error || !res.data) {
        setBaseData(null);
        setTotalMovementsCount(null);
        setBaseError(res.error ?? 'Unable to load inventory report data.');
      } else {
        setBaseData(res.data);
        setTotalMovementsCount(res.totalMovementsCount);
      }
    } finally {
      setLoadingBase(false);
      setRefreshingBase(false);
    }
  }, []);

  useEffect(() => {
    setValViewMode('detail');
    setValLocationId('all');
    setValCategoryId('all');
    setValIncludeZero(false);
    setValIncludeArchived(false);
    setValSearch('');
    setMovFromDate('');
    setMovToDate('');
    setMovLocationId('all');
    setMovTypeFilter('all');
    setMovSearch('');
    setMovLimit(DEFAULT_MOVEMENT_REPORT_LIMIT);
    setMovOffset(0);
    setMovementReport(null);
    setTrfFromDate('');
    setTrfToDate('');
    setTrfStatus('all');
    setTrfSourceId('all');
    setTrfDestId('all');
    setTrfSearch('');
    setLowSeverity('all_alerts');
    setLowLocationId('all');
    setLowCategoryId('all');
    setLowIncludeArchived(false);
    setLowSearch('');
    setExportError(null);

    if (activeOrgId) {
      void loadBaseData(activeOrgId, false);
    } else {
      setBaseData(null);
      setTotalMovementsCount(null);
      setLoadingBase(false);
    }
  }, [activeOrgId, loadBaseData]);

  const loadMovementReport = useCallback(
    async (
      orgId: string,
      offsetOverride?: number,
      limitOverride?: number
    ) => {
      setLoadingMovements(true);
      try {
        const res = await fetchStockMovementReport(
          orgId,
          {
            fromDate: movFromDate || undefined,
            toDate: movToDate || undefined,
            timeZone: tzInfo.timeZone,
            locationId: movLocationId,
            movementType: movTypeFilter,
            limit: limitOverride ?? movLimit,
            offset: offsetOverride ?? movOffset,
          },
          baseData
            ? {
                products: baseData.products,
                variants: baseData.variants,
                locations: baseData.locations,
              }
            : undefined
        );
        setMovementReport(res);
      } finally {
        setLoadingMovements(false);
      }
    },
    [movFromDate, movToDate, tzInfo.timeZone, movLocationId, movTypeFilter, movLimit, movOffset, baseData]
  );

  useEffect(() => {
    if (reportTab === 'movements' && activeOrgId && baseData) {
      void loadMovementReport(activeOrgId);
    }
  }, [reportTab, activeOrgId, baseData, loadMovementReport]);

  const summaryReport = useMemo(() => {
    if (!baseData || !activeOrgId) return null;
    return buildInventorySummaryReport(baseData, activeOrgId, totalMovementsCount);
  }, [baseData, activeOrgId, totalMovementsCount]);

  const valuationReport = useMemo(() => {
    if (!baseData || !activeOrgId) return null;
    return buildStockValuationReport(baseData, activeOrgId, {
      locationId: valLocationId,
      categoryId: valCategoryId,
      includeArchived: valIncludeArchived,
      includeZeroQuantity: valIncludeZero,
      search: valSearch,
    });
  }, [baseData, activeOrgId, valLocationId, valCategoryId, valIncludeArchived, valIncludeZero, valSearch]);

  const transferReport = useMemo(() => {
    if (!baseData || !activeOrgId) return null;
    return buildStockTransferReport(baseData, activeOrgId, {
      status: trfStatus,
      sourceLocationId: trfSourceId,
      destinationLocationId: trfDestId,
      fromDate: trfFromDate,
      toDate: trfToDate,
      timeZone: tzInfo.timeZone,
      search: trfSearch,
    });
  }, [baseData, activeOrgId, trfStatus, trfSourceId, trfDestId, trfFromDate, trfToDate, tzInfo.timeZone, trfSearch]);

  const lowStockReport = useMemo(() => {
    if (!baseData || !activeOrgId) return null;
    return buildLowStockOutOfStockReport(baseData, activeOrgId, {
      severity: lowSeverity,
      locationId: lowLocationId,
      categoryId: lowCategoryId,
      includeArchived: lowIncludeArchived,
      search: lowSearch,
    });
  }, [baseData, activeOrgId, lowSeverity, lowLocationId, lowCategoryId, lowIncludeArchived, lowSearch]);

  const filteredLoadedMovements = useMemo(() => {
    const list = movementReport?.movements ?? [];
    const q = movSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) =>
      [
        m.productName,
        m.variantName,
        m.sku,
        m.locationName,
        m.movementTypeLabel,
        m.reference ?? '',
        m.notes ?? '',
        m.performedByName ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [movementReport, movSearch]);

  const scopedLocations = useMemo(() => {
    if (!baseData || !activeOrgId) return [];
    return baseData.locations.filter((l) => l.organizationId === activeOrgId);
  }, [baseData, activeOrgId]);

  const scopedCategories = useMemo(() => {
    if (!baseData || !activeOrgId) return [];
    return baseData.categories.filter((c) => c.organizationId === activeOrgId);
  }, [baseData, activeOrgId]);

  const baseLoadErrors = useMemo(() => {
    if (!baseData) return [];
    return [
      baseData.errors.products ? `Products: ${baseData.errors.products}` : null,
      baseData.errors.categories ? `Categories: ${baseData.errors.categories}` : null,
      baseData.errors.variants ? `Variants: ${baseData.errors.variants}` : null,
      baseData.errors.locations ? `Locations: ${baseData.errors.locations}` : null,
      baseData.errors.balances ? `Stock balances: ${baseData.errors.balances}` : null,
      baseData.errors.transfers ? `Stock transfers: ${baseData.errors.transfers}` : null,
    ].filter((msg): msg is string => Boolean(msg));
  }, [baseData]);

  const handleExportValuationCsv = () => {
    if (!activeOrgId || !valuationReport) return;
    setExportError(null);
    const orgSlug = sanitizeFilenameSlug(orgName);
    const meta: Array<[string, string]> = [
      ['Organisation', orgName],
      ['Report', 'Stock Valuation Report (Point-in-Time Estimate)'],
      ['Currency', currencyCode],
      ['Timezone', `${tzInfo.timeZone} (${tzSourceLabel})`],
      ['Valuation Note', valuationReport.valuationNote],
      ['Exported At', formatZonedDateTime(new Date().toISOString(), tzInfo.timeZone)],
    ];

    const res = buildReportCsv(
      activeOrgId,
      valuationReport.rows.map((r) => r.organizationId),
      [
        'Product',
        'Category',
        'Variant',
        'SKU',
        'Location',
        'Location Type',
        'Quantity On Hand',
        'Unit of Measure',
        `Unit Cost (${currencyCode})`,
        `Unit Selling Price (${currencyCode})`,
        `Estimated Cost Value (${currencyCode})`,
        `Estimated Retail Value (${currencyCode})`,
        `Estimated Margin (${currencyCode})`,
        'Last Updated',
      ],
      valuationReport.rows.map((r) => [
        r.productName,
        r.categoryPath,
        r.variantName,
        r.sku,
        r.locationName,
        r.locationType,
        r.quantity,
        formatUnitOfMeasureLabel(r.unitOfMeasure),
        r.costPrice.toFixed(2),
        r.sellingPrice.toFixed(2),
        r.estimatedCostValue.toFixed(2),
        r.estimatedRetailValue.toFixed(2),
        r.estimatedMarginValue.toFixed(2),
        formatZonedDateTime(r.updatedAt, tzInfo.timeZone),
      ]),
      meta
    );

    if (res.error || !res.csv) {
      setExportError(res.error ?? 'Unable to generate CSV export.');
      return;
    }
    triggerCsvDownload(`${orgSlug}-stock-valuation-report.csv`, res.csv);
  };

  const handleExportMovementsCsv = () => {
    if (!activeOrgId || !movementReport) return;
    setExportError(null);
    const orgSlug = sanitizeFilenameSlug(orgName);
    const dateRangeLabel =
      movFromDate || movToDate
        ? `${movFromDate || 'Start'} to ${movToDate || 'Present'} (${tzInfo.timeZone}, end date inclusive)`
        : `All recorded dates (${tzInfo.timeZone})`;

    const res = buildReportCsv(
      activeOrgId,
      filteredLoadedMovements.map((m) => m.organizationId),
      [
        `Date & Time (${tzInfo.timeZone})`,
        'Product',
        'Variant',
        'SKU',
        'Location',
        'Movement Type',
        'Quantity Change',
        'Unit of Measure',
        'Quantity Before',
        'Quantity After',
        'Reference',
        'Notes',
        'Performed By',
      ],
      filteredLoadedMovements.map((m) => [
        formatZonedDateTime(m.createdAt, tzInfo.timeZone),
        m.productName,
        m.variantName,
        m.sku,
        m.locationName,
        m.movementTypeLabel,
        m.quantityChange,
        formatUnitOfMeasureLabel(m.unitOfMeasure),
        m.quantityBefore ?? '',
        m.quantityAfter ?? '',
        m.reference ?? '',
        m.notes ?? '',
        m.performedByName ?? '',
      ]),
      [
        ['Organisation', orgName],
        ['Report', 'Stock Movement Report'],
        ['Timezone', `${tzInfo.timeZone} (${tzSourceLabel})`],
        ['Date Range', dateRangeLabel],
        [
          'Rows Scope',
          `Exported ${filteredLoadedMovements.length} rows (page offset ${movementReport.offset}, total matching in database: ${movementReport.totalCount})`,
        ],
        ['Exported At', formatZonedDateTime(new Date().toISOString(), tzInfo.timeZone)],
      ]
    );

    if (res.error || !res.csv) {
      setExportError(res.error ?? 'Unable to generate CSV export.');
      return;
    }
    triggerCsvDownload(`${orgSlug}-stock-movements-report.csv`, res.csv);
  };

  const handleExportTransfersCsv = () => {
    if (!activeOrgId || !transferReport) return;
    setExportError(null);
    const orgSlug = sanitizeFilenameSlug(orgName);
    const dateRangeLabel =
      trfFromDate || trfToDate
        ? `${trfFromDate || 'Start'} to ${trfToDate || 'Present'} (${tzInfo.timeZone}, end date inclusive)`
        : `All recorded dates (${tzInfo.timeZone})`;

    const res = buildReportCsv(
      activeOrgId,
      transferReport.rows.map((r) => r.transfer.organizationId),
      [
        'Reference',
        'Status',
        'Source Location',
        'Destination Location',
        'Item Lines',
        'Quantity Breakdown',
        `Estimated Current Cost Value (${currencyCode})`,
        `Created At (${tzInfo.timeZone})`,
        'Created By',
        `Completed At (${tzInfo.timeZone})`,
        'Completed By',
        'Notes',
      ],
      transferReport.rows.map((r) => [
        r.transfer.referenceCode,
        r.transfer.statusLabel,
        r.transfer.sourceLocationName,
        r.transfer.destinationLocationName,
        r.transfer.itemCount,
        formatUnitSummaryInline(r.unitQuantities),
        r.estimatedCostValue.toFixed(2),
        formatZonedDateTime(r.transfer.createdAt, tzInfo.timeZone),
        r.transfer.createdByName ?? '',
        formatZonedDateTime(r.transfer.completedAt, tzInfo.timeZone),
        r.transfer.completedByName ?? '',
        r.transfer.notes ?? '',
      ]),
      [
        ['Organisation', orgName],
        ['Report', 'Stock Transfer Report'],
        ['Timezone', `${tzInfo.timeZone} (${tzSourceLabel})`],
        ['Date Range', dateRangeLabel],
        ['Exported At', formatZonedDateTime(new Date().toISOString(), tzInfo.timeZone)],
      ]
    );

    if (res.error || !res.csv) {
      setExportError(res.error ?? 'Unable to generate CSV export.');
      return;
    }
    triggerCsvDownload(`${orgSlug}-stock-transfers-report.csv`, res.csv);
  };

  const handleExportLowStockCsv = () => {
    if (!activeOrgId || !lowStockReport) return;
    setExportError(null);
    const orgSlug = sanitizeFilenameSlug(orgName);

    const res = buildReportCsv(
      activeOrgId,
      lowStockReport.rows.map((r) => r.organizationId),
      [
        'Alert Status',
        'Product',
        'Category',
        'Variant',
        'SKU',
        'Location',
        'On Hand',
        'Reorder Level',
        'Shortfall to Reorder',
        'Unit of Measure',
        `Estimated Restock Cost (${currencyCode})`,
        `Last Updated (${tzInfo.timeZone})`,
      ],
      lowStockReport.rows.map((r) => [
        r.stockStatusLabel,
        r.productName,
        r.categoryPath,
        r.variantName,
        r.sku,
        r.locationName,
        r.quantity,
        r.reorderLevel,
        r.shortfallToReorder,
        formatUnitOfMeasureLabel(r.unitOfMeasure),
        r.estimatedRestockCost.toFixed(2),
        formatZonedDateTime(r.updatedAt, tzInfo.timeZone),
      ]),
      [
        ['Organisation', orgName],
        ['Report', 'Low-Stock & Out-of-Stock Report (Current Snapshot)'],
        ['Currency', currencyCode],
        ['Timezone', `${tzInfo.timeZone} (${tzSourceLabel})`],
        ['Exported At', formatZonedDateTime(new Date().toISOString(), tzInfo.timeZone)],
      ]
    );

    if (res.error || !res.csv) {
      setExportError(res.error ?? 'Unable to generate CSV export.');
      return;
    }
    triggerCsvDownload(`${orgSlug}-low-stock-report.csv`, res.csv);
  };

  if (!activeOrgId) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-600">
        Select an active authenticated business workspace to view inventory reports.
      </div>
    );
  }

  const isInitialLoading = loadingBase && !refreshingBase;

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <span>
            Reporting timezone:{' '}
            <strong className="font-mono text-slate-900">{tzInfo.timeZone}</strong>{' '}
            <span className="text-slate-500">({tzSourceLabel})</span>
          </span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span>
            Currency: <strong className="font-mono text-slate-900">{currencyCode}</strong>
          </span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span className="capitalize">Read-only ({activeRole ?? 'staff'})</span>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadBaseData(activeOrgId, true);
            if (reportTab === 'movements') {
              void loadMovementReport(activeOrgId);
            }
          }}
          disabled={loadingBase || refreshingBase || loadingMovements}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-colors whitespace-nowrap self-start sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loadingBase || refreshingBase || loadingMovements ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{refreshingBase ? 'Refreshing...' : 'Refresh Reports'}</span>
        </button>
      </div>

      {/* Report Sub-Tabs */}
      <div
        role="tablist"
        aria-label="Inventory reports"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        {(
          [
            { id: 'summary', label: 'Inventory Summary' },
            { id: 'valuation', label: 'Stock Valuation' },
            { id: 'movements', label: 'Stock Movements' },
            { id: 'transfers', label: 'Stock Transfers' },
            { id: 'low_stock', label: 'Low-Stock & Out-of-Stock' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={reportTab === tab.id}
            onClick={() => {
              setExportError(null);
              setReportTab(tab.id);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              reportTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error Alerts */}
      {(baseError || baseLoadErrors.length > 0 || exportError) && (
        <section
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900 space-y-1"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            <span>{exportError ? 'Export blocked' : 'Unable to load complete report data'}</span>
          </div>
          {exportError && <p>{exportError}</p>}
          {baseError && <p className="font-mono text-[11px]">{baseError}</p>}
          {baseLoadErrors.length > 0 && (
            <ul className="space-y-0.5 font-mono text-[11px] text-amber-800">
              {baseLoadErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 1. INVENTORY SUMMARY REPORT */}
      {reportTab === 'summary' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {summaryReport?.valuationNote ??
                'Estimated current point-in-time inventory valuation calculated from live stock balances and current variant prices.'}
            </span>
          </div>

          {isInitialLoading || !summaryReport ? (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3" aria-busy="true">
              <div className="h-16 bg-slate-100 rounded animate-pulse" />
              <div className="h-24 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : (
            <>
              {/* Catalog & Current Valuation KPIs */}
              <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>Active Catalog &amp; Sites</span>
                    <Boxes className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </div>
                  <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {summaryReport.catalog.activeProductCount}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {summaryReport.catalog.activePhysicalProductCount} physical ·{' '}
                    {summaryReport.catalog.activeServiceProductCount} service ·{' '}
                    {summaryReport.catalog.activeVariantCount} variants ·{' '}
                    {summaryReport.catalog.activeLocationCount} locations
                  </p>
                </div>

                <div className="p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>Estimated Cost Value</span>
                    <Coins className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </div>
                  <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums truncate">
                    {formatMoneyAmount(summaryReport.balances.estimatedCostValue, currencyCode)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Point-in-time estimate · {summaryReport.balances.stockedVariantCount} stocked variants
                  </div>
                </div>

                <div className="p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>Estimated Retail Value</span>
                    <Coins className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  </div>
                  <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums truncate">
                    {formatMoneyAmount(summaryReport.balances.estimatedRetailValue, currencyCode)}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Est. gross margin:{' '}
                    <span className="font-mono text-slate-700">
                      {formatMoneyAmount(summaryReport.balances.estimatedGrossProfit, currencyCode)}
                    </span>
                  </p>
                </div>

                <div className="p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>Replenishment Alerts</span>
                    <PackageX className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  </div>
                  <div className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {summaryReport.balances.needingReplenishmentCount}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    <span className="text-amber-700 font-medium">
                      {summaryReport.balances.lowStockCount} low stock
                    </span>{' '}
                    ·{' '}
                    <span className="text-red-700 font-medium">
                      {summaryReport.balances.outOfStockCount} out of stock
                    </span>
                  </p>
                </div>
              </section>

              {/* Active Stock Quantity by Unit & Activity Snapshot */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      On-Hand Quantity Breakdown
                    </h3>
                    <button
                      type="button"
                      onClick={() => setReportTab('valuation')}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800"
                    >
                      Open Valuation Report
                    </button>
                  </div>
                  <UnitSummaryValue summary={summaryReport.balances.unitQuantities} />
                  <p className="text-[11px] text-slate-500">
                    Across {summaryReport.balances.activeBalanceRowCount} active-product balance records
                    {summaryReport.balances.archivedProductBalanceCount > 0
                      ? ` (${summaryReport.balances.archivedProductBalanceCount} archived-product records excluded)`
                      : ''}
                    .
                  </p>
                </section>

                <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Movement &amp; Transfer Activity
                    </h3>
                    <div className="flex items-center gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setReportTab('movements')}
                        className="font-medium text-blue-700 hover:text-blue-800"
                      >
                        Movements
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportTab('transfers')}
                        className="font-medium text-blue-700 hover:text-blue-800"
                      >
                        Transfers
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
                      <div className="text-[11px] text-slate-500">Total Movements</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-slate-900">
                        {summaryReport.activitySnapshot.totalMovementsCount !== null
                          ? summaryReport.activitySnapshot.totalMovementsCount
                          : `${summaryReport.activitySnapshot.recentMovementsLoadedCount}+`}
                      </div>
                    </div>
                    <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
                      <div className="text-[11px] text-slate-500">Completed Transfers</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-emerald-700">
                        {summaryReport.activitySnapshot.completedTransferCount}
                      </div>
                    </div>
                    <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
                      <div className="text-[11px] text-slate-500">Draft Transfers</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-amber-700">
                        {summaryReport.activitySnapshot.draftTransferCount}
                      </div>
                    </div>
                    <div className="p-3 rounded-md border border-slate-200 bg-slate-50/50">
                      <div className="text-[11px] text-slate-500">Cancelled Transfers</div>
                      <div className="mt-1 font-mono text-lg font-semibold text-slate-500">
                        {summaryReport.activitySnapshot.cancelledTransferCount}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {summaryReport.activitySnapshot.activityNote}
                  </p>
                </section>
              </div>

              {/* Valuation & Alert Summary by Location */}
              <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Current Valuation &amp; Stock Health by Location
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Estimated current cost and retail values per storage location.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReportTab('low_stock')}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                  >
                    View Low-Stock Report
                  </button>
                </div>

                {summaryReport.byLocation.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No inventory locations configured yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Balance Rows</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Quantity by Unit</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Cost Value</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Retail Value</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Low Stock</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Out of Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {summaryReport.byLocation.map((loc) => (
                          <tr key={loc.locationId} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                              <span>{loc.locationName}</span>{' '}
                              <span className="text-[11px] text-slate-400">({loc.locationType})</span>
                              {!loc.isActive && (
                                <span className="ml-1.5 text-[10px] text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">
                                  Archived
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                              {loc.balanceRowCount}
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              <UnitSummaryValue summary={loc.unitQuantities} />
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {formatMoneyAmount(loc.estimatedCostValue, currencyCode)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {formatMoneyAmount(loc.estimatedRetailValue, currencyCode)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700">
                              {loc.lowStockCount}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-red-700">
                              {loc.outOfStockCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* 2. STOCK VALUATION REPORT */}
      {reportTab === 'valuation' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {valuationReport?.valuationNote ??
                'Estimated current point-in-time valuation calculated from live stock balances and current variant prices.'}
            </span>
          </div>

          {/* Summary Strip */}
          {valuationReport && (
            <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              <div className="p-4">
                <div className="text-xs font-medium text-slate-600">Matching Records</div>
                <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                  {valuationReport.totals.rowCount}
                </div>
                <div className="text-[11px] text-slate-500">
                  {valuationReport.totals.distinctVariantCount} distinct variants
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs font-medium text-slate-600">Stock On Hand</div>
                <div className="mt-1">
                  <UnitSummaryValue summary={valuationReport.totals.unitQuantities} />
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs font-medium text-slate-600">Est. Cost Value</div>
                <div className="mt-1 font-mono text-xl font-semibold text-slate-900 truncate">
                  {formatMoneyAmount(valuationReport.totals.estimatedCostValue, currencyCode)}
                </div>
                <div className="text-[11px] text-slate-500">Estimate ({currencyCode})</div>
              </div>
              <div className="p-4">
                <div className="text-xs font-medium text-slate-600">Est. Retail Value</div>
                <div className="mt-1 font-mono text-xl font-semibold text-slate-900 truncate">
                  {formatMoneyAmount(valuationReport.totals.estimatedRetailValue, currencyCode)}
                </div>
                <div className="text-[11px] text-slate-500">Estimate ({currencyCode})</div>
              </div>
              <div className="p-4">
                <div className="text-xs font-medium text-slate-600">Est. Gross Margin</div>
                <div className="mt-1 font-mono text-xl font-semibold text-emerald-700 truncate">
                  {formatMoneyAmount(valuationReport.totals.estimatedMarginValue, currencyCode)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {valuationReport.totals.estimatedMarginPercent !== null
                    ? `${valuationReport.totals.estimatedMarginPercent.toFixed(1)}% of retail`
                    : '—'}
                </div>
              </div>
            </section>
          )}

          {/* Filters & Export */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Stock Valuation Breakdown
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Current point-in-time estimate across active inventory balances.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!valuationReport || valuationReport.rows.length === 0}
                  onClick={handleExportValuationCsv}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Export CSV</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="relative">
                  <Search
                    className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={valSearch}
                    onChange={(e) => setValSearch(e.target.value)}
                    placeholder="Search product, variant, SKU..."
                    aria-label="Search stock valuation"
                    className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <select
                  value={valLocationId}
                  onChange={(e) => setValLocationId(e.target.value)}
                  aria-label="Filter valuation by location"
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All locations ({scopedLocations.length})</option>
                  {scopedLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.locationType})
                    </option>
                  ))}
                </select>

                <select
                  value={valCategoryId}
                  onChange={(e) => setValCategoryId(e.target.value)}
                  aria-label="Filter valuation by category"
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All categories</option>
                  <option value="uncategorized">Uncategorized</option>
                  {scopedCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.parentName ? `${cat.parentName} / ${cat.name}` : cat.name}
                    </option>
                  ))}
                </select>

                <select
                  value={valViewMode}
                  onChange={(e) => setValViewMode(e.target.value as ValuationViewMode)}
                  aria-label="Valuation grouping mode"
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="detail">View: Variant × Location Detail</option>
                  <option value="by_location">View: Grouped by Location</option>
                  <option value="by_category">View: Grouped by Category</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={valIncludeZero}
                    onChange={(e) => setValIncludeZero(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Include zero-quantity rows</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={valIncludeArchived}
                    onChange={(e) => setValIncludeArchived(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Include archived products, variants, or locations</span>
                </label>
              </div>
            </div>

            {isInitialLoading || !valuationReport ? (
              <div className="p-5 space-y-2.5" aria-busy="true">
                <div className="h-10 bg-slate-100 rounded animate-pulse" />
                <div className="h-10 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : valuationReport.rows.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                No stock valuation records match the selected filters.
              </div>
            ) : valViewMode === 'detail' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4 whitespace-nowrap">Product / Category</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Variant &amp; SKU</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Qty On Hand</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Unit</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Unit Cost</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Cost Value</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Retail Value</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {valuationReport.rows.map((r) => (
                      <tr key={r.balanceId} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 min-w-[170px]">
                          <div className="font-medium text-slate-900">{r.productName}</div>
                          <div className="text-[11px] text-slate-500">{r.categoryPath}</div>
                        </td>
                        <td className="py-3 px-4 min-w-[150px]">
                          <div className="text-slate-800">{r.variantName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{r.sku}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                          {r.locationName}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {formatQuantity(r.quantity)}
                        </td>
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                          {formatUnitOfMeasureLabel(r.unitOfMeasure)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatMoneyAmount(r.costPrice, currencyCode)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatMoneyAmount(r.estimatedCostValue, currencyCode)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatMoneyAmount(r.estimatedRetailValue, currencyCode)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                          {formatMoneyAmount(r.estimatedMarginValue, currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4 whitespace-nowrap">
                        {valViewMode === 'by_location' ? 'Location' : 'Category'}
                      </th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Balance Rows</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">Quantity by Unit</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Cost Value</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Retail Value</th>
                      <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {(valViewMode === 'by_location'
                      ? valuationReport.byLocation
                      : valuationReport.byCategory
                    ).map((grp) => (
                      <tr key={grp.groupId} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {grp.groupName}
                          {valViewMode === 'by_location' && (
                            <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                              ({grp.groupMeta})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                          {grp.balanceRowCount}
                        </td>
                        <td className="py-3 px-4">
                          <UnitSummaryValue summary={grp.unitQuantities} />
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatMoneyAmount(grp.estimatedCostValue, currencyCode)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatMoneyAmount(grp.estimatedRetailValue, currencyCode)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                          {formatMoneyAmount(grp.estimatedMarginValue, currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 3. STOCK MOVEMENT REPORT */}
      {reportTab === 'movements' && (
        <div className="space-y-6">
          {/* Filters */}
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Stock Movement Report
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Read-only movement ledger from <span className="font-mono">public.stock_movements</span>.
                  Date boundaries use <strong className="text-slate-700">{tzInfo.timeZone}</strong> ({tzSourceLabel}) with inclusive end date.
                </p>
              </div>
              <button
                type="button"
                disabled={!movementReport || filteredLoadedMovements.length === 0}
                onClick={handleExportMovementsCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="space-y-1">
                <label htmlFor="mov-report-from" className="block text-[11px] font-medium text-slate-600">
                  From Date ({tzInfo.timeZone})
                </label>
                <input
                  id="mov-report-from"
                  type="date"
                  value={movFromDate}
                  onChange={(e) => {
                    setMovOffset(0);
                    setMovFromDate(e.target.value);
                  }}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="mov-report-to" className="block text-[11px] font-medium text-slate-600">
                  To Date (inclusive)
                </label>
                <input
                  id="mov-report-to"
                  type="date"
                  value={movToDate}
                  onChange={(e) => {
                    setMovOffset(0);
                    setMovToDate(e.target.value);
                  }}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="mov-report-location" className="block text-[11px] font-medium text-slate-600">
                  Location
                </label>
                <select
                  id="mov-report-location"
                  value={movLocationId}
                  onChange={(e) => {
                    setMovOffset(0);
                    setMovLocationId(e.target.value);
                  }}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All locations</option>
                  {scopedLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="mov-report-type" className="block text-[11px] font-medium text-slate-600">
                  Movement Type
                </label>
                <select
                  id="mov-report-type"
                  value={movTypeFilter}
                  onChange={(e) => {
                    setMovOffset(0);
                    setMovTypeFilter(e.target.value);
                  }}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All types</option>
                  {STOCK_MOVEMENT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  <option value="transfer_in">Transfer In</option>
                  <option value="transfer_out">Transfer Out</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="mov-report-limit" className="block text-[11px] font-medium text-slate-600">
                  Page Size
                </label>
                <select
                  id="mov-report-limit"
                  value={movLimit}
                  onChange={(e) => {
                    setMovOffset(0);
                    setMovLimit(Number(e.target.value));
                  }}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value={100}>100 rows</option>
                  <option value={250}>250 rows</option>
                  <option value={500}>500 rows</option>
                  <option value={1000}>1,000 rows (max)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="mov-report-search" className="block text-[11px] font-medium text-slate-600">
                  Filter Page Results
                </label>
                <input
                  id="mov-report-search"
                  type="search"
                  value={movSearch}
                  onChange={(e) => setMovSearch(e.target.value)}
                  placeholder="Product, SKU, ref..."
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>
            </div>

            {movementReport && !movementReport.error && (
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Showing{' '}
                  <strong className="font-mono text-slate-800">
                    {movementReport.totalCount === 0 ? 0 : movementReport.offset + 1}–
                    {movementReport.offset + movementReport.movements.length}
                  </strong>{' '}
                  of <strong className="font-mono text-slate-800">{movementReport.totalCount}</strong>{' '}
                  matching movements ({movementReport.appliedTimeZone}).
                  {movementReport.isLimited &&
                    ' Summary totals below reflect the currently loaded page.'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={loadingMovements || movementReport.offset <= 0}
                    onClick={() => setMovOffset(Math.max(0, movementReport.offset - movementReport.limit))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Previous</span>
                  </button>
                  <button
                    type="button"
                    disabled={loadingMovements || !movementReport.hasMore}
                    onClick={() => setMovOffset(movementReport.offset + movementReport.limit)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </section>

          {movementReport?.error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
              Error loading stock movement report: {movementReport.error}
            </div>
          )}

          {movementReport && !movementReport.error && (
            <>
              <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Total Matching</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                    {movementReport.totalCount}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {movementReport.movements.length} on current page
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Inbound (Page)</div>
                  <div className="mt-1">
                    <UnitSummaryValue summary={movementReport.summary.inboundUnits} />
                  </div>
                  <div className="text-[11px] text-emerald-700">
                    {movementReport.summary.inboundCount} inbound entries
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Outbound (Page)</div>
                  <div className="mt-1">
                    <UnitSummaryValue summary={movementReport.summary.outboundUnits} />
                  </div>
                  <div className="text-[11px] text-red-700">
                    {movementReport.summary.outboundCount} outbound entries
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Net Change (Page)</div>
                  <div className="mt-1">
                    <UnitSummaryValue summary={movementReport.summary.netUnits} signed />
                  </div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {loadingMovements ? (
                  <div className="p-5 space-y-2.5" aria-busy="true">
                    <div className="h-10 bg-slate-100 rounded animate-pulse" />
                    <div className="h-10 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : filteredLoadedMovements.length === 0 ? (
                  <div className="p-10 text-center space-y-1.5">
                    <History className="h-5 w-5 text-slate-400 mx-auto" aria-hidden="true" />
                    <div className="text-xs font-semibold text-slate-900">
                      No matching stock movements
                    </div>
                    <p className="text-xs text-slate-500">
                      Adjust the date range, location, movement type, or search filter.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 px-4 whitespace-nowrap">Date &amp; Time ({tzInfo.timeZone})</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Product</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Variant</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">SKU</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Movement Type</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Change</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Unit</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Before → After</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Reference</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Actor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {filteredLoadedMovements.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                              {formatZonedDateTime(m.createdAt, tzInfo.timeZone)}
                            </td>
                            <td className="py-3 px-4 min-w-[160px] font-medium text-slate-900">
                              {m.productName}
                            </td>
                            <td className="py-3 px-4 min-w-[130px] text-slate-700">
                              {m.variantName}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                              {m.sku}
                            </td>
                            <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {m.locationName}
                            </td>
                            <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {m.movementTypeLabel}
                            </td>
                            <td
                              className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                                m.quantityChange < 0 ? 'text-red-700' : 'text-emerald-700'
                              }`}
                            >
                              {formatSignedQuantity(m.quantityChange)}
                            </td>
                            <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                              {formatUnitOfMeasureLabel(m.unitOfMeasure)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap">
                              {m.quantityBefore !== null ? formatQuantity(m.quantityBefore) : '—'} →{' '}
                              {m.quantityAfter !== null ? formatQuantity(m.quantityAfter) : '—'}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {m.reference ?? '—'}
                            </td>
                            <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {m.performedByName ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* 4. STOCK TRANSFER REPORT */}
      {reportTab === 'transfers' && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Stock Transfer Report
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Read-only report from <span className="font-mono">public.stock_transfers</span> and{' '}
                  <span className="font-mono">public.stock_transfer_items</span>. Date filters use{' '}
                  <strong className="text-slate-700">{tzInfo.timeZone}</strong> ({tzSourceLabel}) with inclusive end date.
                </p>
              </div>
              <button
                type="button"
                disabled={!transferReport || transferReport.rows.length === 0}
                onClick={handleExportTransfersCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="space-y-1">
                <label htmlFor="trf-report-from" className="block text-[11px] font-medium text-slate-600">
                  Created From ({tzInfo.timeZone})
                </label>
                <input
                  id="trf-report-from"
                  type="date"
                  value={trfFromDate}
                  onChange={(e) => setTrfFromDate(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="trf-report-to" className="block text-[11px] font-medium text-slate-600">
                  Created To (inclusive)
                </label>
                <input
                  id="trf-report-to"
                  type="date"
                  value={trfToDate}
                  onChange={(e) => setTrfToDate(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="trf-report-status" className="block text-[11px] font-medium text-slate-600">
                  Status
                </label>
                <select
                  id="trf-report-status"
                  value={trfStatus}
                  onChange={(e) => setTrfStatus(e.target.value as 'all' | StockTransferStatusValue)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="trf-report-source" className="block text-[11px] font-medium text-slate-600">
                  Source Location
                </label>
                <select
                  id="trf-report-source"
                  value={trfSourceId}
                  onChange={(e) => setTrfSourceId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All sources</option>
                  {scopedLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="trf-report-dest" className="block text-[11px] font-medium text-slate-600">
                  Destination Location
                </label>
                <select
                  id="trf-report-dest"
                  value={trfDestId}
                  onChange={(e) => setTrfDestId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
                >
                  <option value="all">All destinations</option>
                  {scopedLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="trf-report-search" className="block text-[11px] font-medium text-slate-600">
                  Search
                </label>
                <input
                  id="trf-report-search"
                  type="search"
                  value={trfSearch}
                  onChange={(e) => setTrfSearch(e.target.value)}
                  placeholder="TRF-..., SKU, actor..."
                  className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>
            </div>
          </section>

          {transferReport && (
            <>
              <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Matching Transfers</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                    {transferReport.totals.totalTransfers}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {transferReport.totals.totalLineItems} item lines
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Draft</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-amber-700">
                    {transferReport.totals.draftCount}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Completed</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-emerald-700">
                    {transferReport.totals.completedCount}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Completed Units</div>
                  <div className="mt-1">
                    <UnitSummaryValue summary={transferReport.totals.completedUnits} />
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Est. Completed Cost Value</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900 truncate">
                    {formatMoneyAmount(transferReport.totals.estimatedCompletedCostValue, currencyCode)}
                  </div>
                  <div className="text-[11px] text-slate-500">Based on current variant cost</div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {transferReport.rows.length === 0 ? (
                  <div className="p-10 text-center space-y-1.5">
                    <ArrowLeftRight className="h-5 w-5 text-slate-400 mx-auto" aria-hidden="true" />
                    <div className="text-xs font-semibold text-slate-900">
                      No matching stock transfers
                    </div>
                    <p className="text-xs text-slate-500">
                      Adjust your date range, status, or location filters.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 px-4 whitespace-nowrap">Reference</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Source → Destination</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Items</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Quantity by Unit</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Est. Cost Value</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Created ({tzInfo.timeZone})</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Creator</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {transferReport.rows.map((r) => (
                          <tr key={r.transfer.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                              {r.transfer.referenceCode}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`font-medium ${
                                  r.transfer.status === 'completed'
                                    ? 'text-emerald-700'
                                    : r.transfer.status === 'cancelled'
                                      ? 'text-slate-500'
                                      : 'text-amber-700'
                                }`}
                              >
                                {r.transfer.statusLabel}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {r.transfer.sourceLocationName} → {r.transfer.destinationLocationName}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                              {r.transfer.itemCount}
                            </td>
                            <td className="py-3 px-4">
                              <UnitSummaryValue summary={r.unitQuantities} />
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                              {formatMoneyAmount(r.estimatedCostValue, currencyCode)}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                              {formatZonedDateTime(r.transfer.createdAt, tzInfo.timeZone)}
                            </td>
                            <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                              {r.transfer.createdByName ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* 5. LOW-STOCK & OUT-OF-STOCK REPORT */}
      {reportTab === 'low_stock' && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Low-Stock &amp; Out-of-Stock Report
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Current point-in-time replenishment shortfalls calculated from{' '}
                  <span className="font-mono">public.inventory_balances</span> reorder thresholds.
                </p>
              </div>
              <button
                type="button"
                disabled={!lowStockReport || lowStockReport.rows.length === 0}
                onClick={handleExportLowStockCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export CSV</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="relative">
                <Search
                  className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={lowSearch}
                  onChange={(e) => setLowSearch(e.target.value)}
                  placeholder="Search product, variant, SKU..."
                  aria-label="Search low stock report"
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 text-xs text-slate-900"
                />
              </div>

              <select
                value={lowSeverity}
                onChange={(e) =>
                  setLowSeverity(e.target.value as 'all_alerts' | 'low_stock' | 'out_of_stock')
                }
                aria-label="Filter by alert severity"
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
              >
                <option value="all_alerts">All alerts (Low + Out of Stock)</option>
                <option value="out_of_stock">Out of stock only (qty = 0)</option>
                <option value="low_stock">Low stock only (0 &lt; qty &le; reorder)</option>
              </select>

              <select
                value={lowLocationId}
                onChange={(e) => setLowLocationId(e.target.value)}
                aria-label="Filter alerts by location"
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
              >
                <option value="all">All locations</option>
                {scopedLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>

              <select
                value={lowCategoryId}
                onChange={(e) => setLowCategoryId(e.target.value)}
                aria-label="Filter alerts by category"
                className="w-full h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
              >
                <option value="all">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {scopedCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.parentName ? `${cat.parentName} / ${cat.name}` : cat.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={lowIncludeArchived}
                onChange={(e) => setLowIncludeArchived(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Include archived products, variants, or locations</span>
            </label>
          </section>

          {lowStockReport && (
            <>
              <section className="bg-white border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Total Alert Records</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900">
                    {lowStockReport.totals.alertCount}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Out of Stock</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-red-700">
                    {lowStockReport.totals.outOfStockCount}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Low Stock</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-amber-700">
                    {lowStockReport.totals.lowStockCount}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Shortfall to Reorder</div>
                  <div className="mt-1">
                    <UnitSummaryValue summary={lowStockReport.totals.shortfallUnits} />
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-slate-600">Est. Restock Cost</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-slate-900 truncate">
                    {formatMoneyAmount(lowStockReport.totals.estimatedRestockCost, currencyCode)}
                  </div>
                  <div className="text-[11px] text-slate-500">To reach reorder level</div>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                {lowStockReport.rows.length === 0 ? (
                  <div className="p-10 text-center text-xs text-slate-500">
                    No low-stock or out-of-stock records match your current filters.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 px-4 whitespace-nowrap">Alert</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Product</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Variant</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">SKU</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Location</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">On Hand</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Reorder Level</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Shortfall</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">Unit</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Estimated Restock Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {lowStockReport.rows.map((r) => (
                          <tr key={r.balanceId} className="hover:bg-slate-50/60">
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1.5 font-medium ${
                                  r.stockStatus === 'out_of_stock'
                                    ? 'text-red-700'
                                    : 'text-amber-700'
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    r.stockStatus === 'out_of_stock' ? 'bg-red-600' : 'bg-amber-500'
                                  }`}
                                />
                                <span>{r.stockStatusLabel}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4 min-w-[160px] font-medium text-slate-900">
                              {r.productName}
                            </td>
                            <td className="py-3 px-4 min-w-[130px] text-slate-600 whitespace-nowrap">
                              {r.categoryPath}
                            </td>
                            <td className="py-3 px-4 min-w-[130px] text-slate-800">
                              {r.variantName}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {r.sku}
                            </td>
                            <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                              {r.locationName}
                            </td>
                            <td
                              className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                                r.stockStatus === 'out_of_stock' ? 'text-red-700' : 'text-amber-700'
                              }`}
                            >
                              {formatQuantity(r.quantity)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                              {formatQuantity(r.reorderLevel)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {formatQuantity(r.shortfallToReorder)}
                            </td>
                            <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                              {formatUnitOfMeasureLabel(r.unitOfMeasure)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                              {formatMoneyAmount(r.estimatedRestockCost, currencyCode)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

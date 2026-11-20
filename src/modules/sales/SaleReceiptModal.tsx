import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { ReceiptDocument } from '../../components/receipts/ReceiptDocument';
import {
  loadOrganizationReceiptSettings,
  subscribeReceiptSettingsUpdates,
} from '../../core/receipts/receiptSettingsService';
import {
  DEFAULT_RECEIPT_SETTINGS,
  getEffectiveReceiptWidthMm,
  type ReceiptSettings,
} from '../../core/receipts/receiptSettingsTypes';
import type { Organisation } from '../../core/types/domain';
import type { SaleRecord } from './salesTypes';

interface SaleReceiptModalProps {
  sale: SaleRecord | null;
  organisation: Organisation | null;
  receiptSettings?: ReceiptSettings | null;
  onClose: () => void;
}

const PRINT_HOST_ID = 'veyora-receipt-print-host';
const PRINT_PAGE_STYLE_ID = 'veyora-receipt-page-style';

function formatPaperBadge(settings: ReceiptSettings): string {
  switch (settings.paperSize) {
    case '58mm':
      return '58mm Thermal';
    case '80mm':
      return '80mm Thermal';
    case 'a4':
      return 'A4 Full Page';
    case 'custom':
      return `Custom (${getEffectiveReceiptWidthMm(settings)}mm)`;
  }
}

function buildPrintPageCss(settings: ReceiptSettings): string {
  if (settings.paperSize === 'a4') {
    return `@page { size: A4 portrait; margin: 12mm; }`;
  }
  const widthMm = getEffectiveReceiptWidthMm(settings);
  return `@page { size: ${widthMm}mm auto; margin: 2mm; }`;
}

export function SaleReceiptModal({
  sale,
  organisation,
  receiptSettings,
  onClose,
}: SaleReceiptModalProps) {
  const [loadedSettings, setLoadedSettings] = useState<ReceiptSettings>(
    receiptSettings ?? DEFAULT_RECEIPT_SETTINGS
  );
  const [printHost, setPrintHost] = useState<HTMLElement | null>(null);

  const orgId = organisation?.id ?? null;

  useEffect(() => {
    if (receiptSettings) {
      setLoadedSettings(receiptSettings);
      return;
    }
    let active = true;
    void loadOrganizationReceiptSettings(organisation).then((res) => {
      if (active) setLoadedSettings(res.settings);
    });
    return () => {
      active = false;
    };
  }, [receiptSettings, organisation, orgId]);

  useEffect(() => {
    return subscribeReceiptSettingsUpdates(orgId, (nextSettings) => {
      setLoadedSettings(nextSettings);
    });
  }, [orgId]);

  const activeSettings = receiptSettings ?? loadedSettings;

  // Escape key closes modal
  useEffect(() => {
    if (!sale) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sale, onClose]);

  // Manage dedicated document.body portal host, body.veyora-printing-receipt class, and @page size rule
  const pageCss = useMemo(() => buildPrintPageCss(activeSettings), [activeSettings]);

  useEffect(() => {
    if (!sale) {
      document.body.classList.remove('veyora-printing-receipt');
      const existingStyle = document.getElementById(PRINT_PAGE_STYLE_ID);
      if (existingStyle) existingStyle.remove();
      setPrintHost(null);
      return;
    }

    let host = document.getElementById(PRINT_HOST_ID);
    let createdHost = false;
    if (!host) {
      host = document.createElement('div');
      host.id = PRINT_HOST_ID;
      document.body.appendChild(host);
      createdHost = true;
    }
    setPrintHost(host);

    document.body.classList.add('veyora-printing-receipt');

    let styleEl = document.getElementById(PRINT_PAGE_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = PRINT_PAGE_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = pageCss;

    return () => {
      document.body.classList.remove('veyora-printing-receipt');
      const activeStyle = document.getElementById(PRINT_PAGE_STYLE_ID);
      if (activeStyle) activeStyle.remove();
      if (createdHost && host?.parentNode) {
        host.parentNode.removeChild(host);
      }
    };
  }, [sale, pageCss]);

  if (!sale) return null;

  const modalMaxWidthClass =
    activeSettings.paperSize === 'a4' ||
    (activeSettings.paperSize === 'custom' &&
      getEffectiveReceiptWidthMm(activeSettings) >= 130)
      ? 'max-w-3xl'
      : 'max-w-lg';

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 print:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-receipt-title"
      >
        <div
          className={`bg-white border border-slate-200 rounded-lg w-full ${modalMaxWidthClass} max-h-[90vh] flex flex-col overflow-hidden shadow-xl`}
        >
          {/* Modal Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="sale-receipt-title" className="text-sm font-semibold text-slate-900">
                  Sale Receipt
                </h2>
                <span className="text-[11px] font-mono text-slate-600 px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                  {formatPaperBadge(activeSettings)}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-500 mt-0.5">{sale.saleNumber}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 transition-colors whitespace-nowrap"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Print Receipt</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close receipt"
                className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Screen Receipt Preview Stage */}
          <div className="p-4 sm:p-6 bg-slate-100 overflow-auto flex-1">
            <div className="mx-auto w-fit max-w-full bg-white border border-slate-300 shadow-sm">
              <ReceiptDocument
                sale={sale}
                organisation={organisation}
                settings={activeSettings}
                mode="modal"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Print-only Portal Host (prints ONLY the receipt on paper) */}
      {printHost &&
        createPortal(
          <ReceiptDocument
            sale={sale}
            organisation={organisation}
            settings={activeSettings}
            mode="print"
          />,
          printHost
        )}
    </>
  );
}

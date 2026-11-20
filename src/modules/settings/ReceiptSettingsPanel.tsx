import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  ImagePlus,
  Loader2,
  Printer,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { ReceiptDocument } from '../../components/receipts/ReceiptDocument';
import {
  getDefaultReceiptSettings,
  getOrganizationReceiptSettings,
  processAndStoreReceiptLogo,
  saveOrganizationReceiptSettings,
} from '../../core/receipts/receiptSettingsService';
import {
  buildSamplePreviewSale,
  clampCustomWidthMm,
  getEffectiveReceiptWidthMm,
  MAX_CUSTOM_WIDTH_MM,
  MIN_CUSTOM_WIDTH_MM,
  RECEIPT_PAPER_SIZE_OPTIONS,
  type ReceiptPaperSize,
  type ReceiptSettings,
} from '../../core/receipts/receiptSettingsTypes';
import type { Organisation, OrganisationRole } from '../../core/types/domain';

interface ReceiptSettingsPanelProps {
  organisation: Organisation | null;
  activeRole: OrganisationRole | null;
  onRefreshOrganisation?: () => Promise<void>;
}

function areSettingsEqual(a: ReceiptSettings, b: ReceiptSettings): boolean {
  return (
    a.paperSize === b.paperSize &&
    a.customWidthMm === b.customWidthMm &&
    a.showLogo === b.showLogo &&
    a.logoUrl === b.logoUrl &&
    a.logoStoragePath === b.logoStoragePath &&
    a.showAddress === b.showAddress &&
    a.businessAddress === b.businessAddress &&
    a.showPhone === b.showPhone &&
    a.showEmail === b.showEmail &&
    a.showCashier === b.showCashier &&
    a.showCustomer === b.showCustomer &&
    a.showPaymentMethod === b.showPaymentMethod &&
    a.showPaymentReference === b.showPaymentReference &&
    a.showSubtotal === b.showSubtotal &&
    a.showDiscounts === b.showDiscounts &&
    a.showAmountPaid === b.showAmountPaid &&
    a.showOutstandingBalance === b.showOutstandingBalance &&
    a.footerText === b.footerText
  );
}

export function ReceiptSettingsPanel({
  organisation,
  activeRole,
  onRefreshOrganisation,
}: ReceiptSettingsPanelProps) {
  const canEdit = activeRole === 'owner' || activeRole === 'admin';
  const orgId = organisation?.id ?? null;

  const [savedSettings, setSavedSettings] = useState<ReceiptSettings>(() =>
    getOrganizationReceiptSettings(organisation)
  );
  const [draft, setDraft] = useState<ReceiptSettings>(() =>
    getOrganizationReceiptSettings(organisation)
  );
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const saveLockRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevOrgIdRef = useRef<string | null>(orgId);
  const draftRef = useRef<ReceiptSettings>(draft);
  const savedSettingsRef = useRef<ReceiptSettings>(savedSettings);
  draftRef.current = draft;
  savedSettingsRef.current = savedSettings;

  useEffect(() => {
    const nextFromOrg = getOrganizationReceiptSettings(organisation);
    const orgSwitched = prevOrgIdRef.current !== orgId;

    if (orgSwitched) {
      prevOrgIdRef.current = orgId;
      setSavedSettings(nextFromOrg);
      setDraft(nextFromOrg);
      setFeedback(null);
      return;
    }

    const wasDirty = !areSettingsEqual(draftRef.current, savedSettingsRef.current);
    setSavedSettings(nextFromOrg);
    if (!wasDirty) {
      setDraft(nextFromOrg);
    }
  }, [orgId, organisation]);

  const sampleSale = useMemo(
    () => buildSamplePreviewSale(organisation),
    [organisation]
  );

  const isDirty = useMemo(
    () => !areSettingsEqual(draft, savedSettings),
    [draft, savedSettings]
  );

  if (!canEdit) {
    return (
      <section
        role="alert"
        className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex items-start gap-2.5 text-xs text-amber-900"
      >
        <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          Receipt settings are restricted to Organization Owners and Admins. Managers and Staff automatically use the active organization&apos;s saved receipt layout when printing sales receipts.
        </div>
      </section>
    );
  }

  if (!organisation) {
    return null;
  }

  const handleToggle = (key: keyof ReceiptSettings) => {
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handlePaperSizeChange = (size: ReceiptPaperSize) => {
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      paperSize: size,
    }));
  };

  const handleLogoFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !organisation) return;

    setUploadingLogo(true);
    setFeedback(null);

    try {
      const result = await processAndStoreReceiptLogo(
        organisation.id,
        file,
        activeRole
      );
      if (result.error) {
        setFeedback({ type: 'error', message: result.error });
        return;
      }
      setDraft((prev) => ({
        ...prev,
        showLogo: true,
        logoUrl: result.logoUrl,
        logoStoragePath: result.logoStoragePath,
      }));
      setFeedback({
        type: 'success',
        message: 'Logo uploaded and loaded into preview. Click Save Settings to apply for this organization.',
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    setFeedback(null);
    setDraft((prev) => ({
      ...prev,
      logoUrl: null,
      logoStoragePath: null,
    }));
  };

  const handleRestoreDefaults = () => {
    setFeedback({
      type: 'warning',
      message: 'Default receipt preferences loaded in preview. Click Save Settings to persist changes.',
    });
    setDraft(getDefaultReceiptSettings());
  };

  const handleSave = async () => {
    if (!organisation || saveLockRef.current || saving) return;

    saveLockRef.current = true;
    setSaving(true);
    setFeedback(null);

    try {
      const sanitizedDraft: ReceiptSettings = {
        ...draft,
        customWidthMm: clampCustomWidthMm(draft.customWidthMm),
      };

      const res = await saveOrganizationReceiptSettings(
        organisation,
        sanitizedDraft,
        activeRole,
        savedSettings.logoStoragePath
      );

      if (res.error || !res.settings) {
        setFeedback({
          type: 'error',
          message: res.error ?? 'Failed to save receipt settings. Your unsaved draft has been preserved.',
        });
        return;
      }

      setSavedSettings(res.settings);
      setDraft(res.settings);

      if (onRefreshOrganisation) {
        try {
          await onRefreshOrganisation();
        } catch {
          // Non-fatal refresh error; database update already succeeded
        }
      }

      setFeedback({
        type: 'success',
        message: `Receipt settings saved to organization record for ${organisation.name}.`,
      });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  };

  const effectiveWidthMm = getEffectiveReceiptWidthMm(draft);

  return (
    <div className="space-y-6">
      {feedback && (
        <section
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 flex items-start gap-2.5 text-xs ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : feedback.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          {feedback.type === 'error' || feedback.type === 'warning' ? (
            <AlertTriangle
              className={`h-4 w-4 shrink-0 mt-0.5 ${
                feedback.type === 'error' ? 'text-red-700' : 'text-amber-700'
              }`}
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span className="font-medium leading-relaxed">{feedback.message}</span>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Receipt Settings Form (7 columns) */}
        <div className="xl:col-span-7 space-y-6">
          {/* Header & Actions */}
          <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <Printer className="h-4 w-4 text-slate-600 shrink-0" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Receipt Settings · {organisation.name}
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                Configure thermal and A4 receipt printing independently for this organization. Stored on the organization record.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRestoreDefaults}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Restore Defaults</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{saving ? 'Saving...' : isDirty ? 'Save Settings*' : 'Save Settings'}</span>
              </button>
            </div>
          </section>

          <>
              {/* 1. Paper Size */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Paper Size</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select the target paper roll or page format for printed sales receipts.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Receipt paper size">
                  {RECEIPT_PAPER_SIZE_OPTIONS.map((opt) => {
                    const selected = draft.paperSize === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-2.5 p-3 rounded-md border cursor-pointer transition-colors ${
                          selected
                            ? 'border-blue-600 bg-blue-50/40'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="receipt-paper-size"
                          value={opt.value}
                          checked={selected}
                          onChange={() => handlePaperSizeChange(opt.value)}
                          className="mt-0.5 text-blue-700 focus:ring-blue-600"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900">{opt.label}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                            {opt.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {draft.paperSize === 'custom' && (
                  <div className="p-3.5 rounded-md border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <label
                        htmlFor="receipt-custom-width-mm"
                        className="block text-xs font-medium text-slate-900"
                      >
                        Custom Receipt Width (mm)
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Supported range: {MIN_CUSTOM_WIDTH_MM}mm – {MAX_CUSTOM_WIDTH_MM}mm.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        id="receipt-custom-width-mm"
                        type="number"
                        min={MIN_CUSTOM_WIDTH_MM}
                        max={MAX_CUSTOM_WIDTH_MM}
                        step={1}
                        value={draft.customWidthMm}
                        onChange={(e) => {
                          setFeedback(null);
                          const parsed = Number(e.target.value);
                          setDraft((prev) => ({
                            ...prev,
                            customWidthMm: Number.isFinite(parsed)
                              ? parsed
                              : MIN_CUSTOM_WIDTH_MM,
                          }));
                        }}
                        onBlur={() =>
                          setDraft((prev) => ({
                            ...prev,
                            customWidthMm: clampCustomWidthMm(prev.customWidthMm),
                          }))
                        }
                        className="w-24 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-right text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <span className="text-xs text-slate-500 font-mono">mm</span>
                    </div>
                  </div>
                )}
              </section>

              {/* 2. Business Information */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Business Information</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Business details are read from <span className="font-medium text-slate-700">{organisation.name}</span>.
                  </p>
                </div>

                {/* Logo Uploader */}
                <div className="p-3.5 rounded-md border border-slate-200 bg-slate-50/50 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <label className="flex items-center gap-2.5 text-xs font-medium text-slate-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.showLogo}
                        onChange={() => handleToggle('showLogo')}
                        className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                      <span>Show Business Logo</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(e) => void handleLogoFileChange(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingLogo}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {uploadingLogo ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{draft.logoUrl ? 'Change Logo' : 'Upload Logo'}</span>
                      </button>
                      {draft.logoUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {draft.logoUrl && (
                    <div className="flex items-center gap-3 pt-1">
                      <div className="p-2 rounded border border-slate-200 bg-white">
                        <img
                          src={draft.logoUrl}
                          alt={`${organisation.name} receipt logo`}
                          className="max-h-12 max-w-[140px] object-contain"
                        />
                      </div>
                      <span className="text-[11px] text-slate-500">
                        Optimized for crisp thermal &amp; A4 printing.
                      </span>
                    </div>
                  )}
                </div>

                {/* Business Contact & Address Toggles */}
                <div className="space-y-3 text-xs">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 font-medium text-slate-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.showAddress}
                        onChange={() => handleToggle('showAddress')}
                        className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                      <span>Show Business Address</span>
                    </label>
                    {draft.showAddress && (
                      <div className="pl-6 space-y-1">
                        <label
                          htmlFor="receipt-business-address"
                          className="block text-[11px] text-slate-600"
                        >
                          Receipt Business Address (optional — falls back to the sale location&apos;s address if left blank)
                        </label>
                        <textarea
                          id="receipt-business-address"
                          rows={2}
                          value={draft.businessAddress}
                          onChange={(e) => {
                            setFeedback(null);
                            setDraft((prev) => ({
                              ...prev,
                              businessAddress: e.target.value,
                            }));
                          }}
                          placeholder="Street address, city, and branch details..."
                          className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    )}
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.showPhone}
                      onChange={() => handleToggle('showPhone')}
                      className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span>
                      <span className="font-medium text-slate-900 block">
                        Show Phone Number
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {organisation.business_phone
                          ? `Current: ${organisation.business_phone}`
                          : 'No phone number set on Business Profile yet.'}
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.showEmail}
                      onChange={() => handleToggle('showEmail')}
                      className="mt-0.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                    />
                    <span>
                      <span className="font-medium text-slate-900 block">
                        Show Email Address
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {organisation.business_email
                          ? `Current: ${organisation.business_email}`
                          : 'No email address set on Business Profile yet.'}
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              {/* 3. Receipt Content */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Receipt Content</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Choose which transaction fields appear on printed receipts. Final totals remain visible on all receipts.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {(
                    [
                      { key: 'showCashier', label: 'Show Cashier Name' },
                      { key: 'showCustomer', label: 'Show Customer Information' },
                      { key: 'showPaymentMethod', label: 'Show Payment Method' },
                      { key: 'showPaymentReference', label: 'Show Payment Reference' },
                      { key: 'showSubtotal', label: 'Show Subtotal' },
                      { key: 'showDiscounts', label: 'Show Discounts' },
                      { key: 'showAmountPaid', label: 'Show Amount Paid' },
                      { key: 'showOutstandingBalance', label: 'Show Outstanding Balance' },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center gap-2.5 p-2.5 rounded-md border border-slate-200 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={draft[item.key]}
                        onChange={() => handleToggle(item.key)}
                        className="rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                      <span className="font-medium text-slate-800">{item.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              {/* 4. Receipt Footer */}
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="border-b border-slate-200 pb-3">
                  <h3 className="text-sm font-semibold text-slate-900">Receipt Footer</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Optional closing message printed at the bottom of each receipt.
                  </p>
                </div>
                <div>
                  <label htmlFor="receipt-footer-text" className="sr-only">
                    Custom receipt footer message
                  </label>
                  <textarea
                    id="receipt-footer-text"
                    rows={2}
                    maxLength={300}
                    value={draft.footerText}
                    onChange={(e) => {
                      setFeedback(null);
                      setDraft((prev) => ({
                        ...prev,
                        footerText: e.target.value,
                      }));
                    }}
                    placeholder="Thank you for shopping with us!"
                    className="w-full px-3 py-2 rounded-md border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </section>
            </>
        </div>

        {/* Right Column: Live Receipt Preview (5 columns) */}
        <aside className="xl:col-span-5 xl:sticky xl:top-20 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-slate-600 shrink-0" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Live Receipt Preview</h3>
                <p className="text-[11px] text-slate-500">
                  Updates live using sample transaction values.
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono text-slate-600 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 whitespace-nowrap">
              {draft.paperSize === 'a4'
                ? 'A4 (210mm)'
                : `${effectiveWidthMm}mm`}
            </span>
          </div>

          <div className="p-4 sm:p-6 bg-slate-100/90 overflow-x-auto max-h-[780px] overflow-y-auto">
            <div className="mx-auto w-fit max-w-full bg-white border border-slate-300 shadow-sm">
              <ReceiptDocument
                sale={sampleSale}
                organisation={organisation}
                settings={draft}
                mode="preview"
                isSamplePreview
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

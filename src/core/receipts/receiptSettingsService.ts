import { getSupabaseClient } from '../supabase/client';
import type { Organisation, OrganisationRole } from '../types/domain';
import {
  DEFAULT_RECEIPT_SETTINGS,
  normalizeReceiptSettings,
  type ReceiptSettings,
} from './receiptSettingsTypes';

const RECEIPT_STORAGE_BUCKET = 'organisation-files';
const RECEIPT_SETTINGS_UPDATED_EVENT = 'veyora:receipt-settings-updated';

export function getDefaultReceiptSettings(): ReceiptSettings {
  return { ...DEFAULT_RECEIPT_SETTINGS };
}

export function getOrganizationReceiptSettings(
  organisation: Organisation | null
): ReceiptSettings {
  if (!organisation?.id) {
    return getDefaultReceiptSettings();
  }
  return normalizeReceiptSettings(organisation.receipt_settings);
}

export function notifyReceiptSettingsUpdated(
  organisationId: string,
  settings: ReceiptSettings
): void {
  try {
    window.dispatchEvent(
      new CustomEvent(RECEIPT_SETTINGS_UPDATED_EVENT, {
        detail: { organisationId, settings },
      })
    );
  } catch {
    // Ignore event dispatch failure
  }
}

export function subscribeReceiptSettingsUpdates(
  organisationId: string | null | undefined,
  onUpdate: (settings: ReceiptSettings) => void
): () => void {
  if (!organisationId) return () => undefined;

  const handler = (event: Event) => {
    const custom = event as CustomEvent<{
      organisationId?: string;
      settings?: ReceiptSettings;
    }>;
    if (custom.detail?.organisationId === organisationId && custom.detail.settings) {
      onUpdate(normalizeReceiptSettings(custom.detail.settings));
    }
  };

  window.addEventListener(RECEIPT_SETTINGS_UPDATED_EVENT, handler);
  return () => {
    window.removeEventListener(RECEIPT_SETTINGS_UPDATED_EVENT, handler);
  };
}

function serializeReceiptSettingsForDatabase(
  settings: ReceiptSettings
): Record<string, unknown> {
  return {
    paperSize: settings.paperSize,
    customWidthMm: settings.customWidthMm,
    showLogo: settings.showLogo,
    logoUrl: settings.logoUrl,
    logoStoragePath: settings.logoStoragePath,
    showAddress: settings.showAddress,
    businessAddress: settings.businessAddress,
    showPhone: settings.showPhone,
    showEmail: settings.showEmail,
    showCashier: settings.showCashier,
    showCustomer: settings.showCustomer,
    showPaymentMethod: settings.showPaymentMethod,
    showPaymentReference: settings.showPaymentReference,
    showSubtotal: settings.showSubtotal,
    showDiscounts: settings.showDiscounts,
    showAmountPaid: settings.showAmountPaid,
    showOutstandingBalance: settings.showOutstandingBalance,
    footerText: settings.footerText,
    updatedAt: settings.updatedAt,
  };
}

export async function saveOrganizationReceiptSettings(
  organisation: Organisation,
  draft: ReceiptSettings,
  role: OrganisationRole | null,
  previousSavedLogoStoragePath?: string | null
): Promise<{
  settings: ReceiptSettings | null;
  error: string | null;
}> {
  if (role !== 'owner' && role !== 'admin') {
    return {
      settings: null,
      error: 'Only Organization Owners and Admins can update receipt settings.',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      settings: null,
      error: 'Supabase client is not configured. Unable to save receipt settings.',
    };
  }

  const orgId = organisation.id;
  if (!orgId || !orgId.trim()) {
    return {
      settings: null,
      error: 'Active organization ID is required to save receipt settings.',
    };
  }

  const nextSettings: ReceiptSettings = {
    ...normalizeReceiptSettings(draft),
    updatedAt: new Date().toISOString(),
  };

  // Update ONLY receipt_settings so unrelated organization columns remain untouched.
  // Use .select('id, receipt_settings').single() so RLS denial or missing rows fail loudly.
  const { data, error } = await supabase
    .from('organizations')
    .update({
      receipt_settings: serializeReceiptSettingsForDatabase(nextSettings),
    })
    .eq('id', orgId)
    .select('id, receipt_settings')
    .single();

  if (error) {
    const rawMsg = error.message || 'Unable to save receipt settings to Supabase.';
    const lower = rawMsg.toLowerCase();
    if (
      error.code === '42501' ||
      lower.includes('row-level security') ||
      lower.includes('policy') ||
      lower.includes('permission denied')
    ) {
      return {
        settings: null,
        error:
          'Permission denied by database security policy. Only Organization Owners and Admins can update receipt settings.',
      };
    }
    if (error.code === 'PGRST116') {
      return {
        settings: null,
        error:
          'Organization record could not be updated. Verify you have Owner or Admin permissions for this workspace.',
      };
    }
    return {
      settings: null,
      error: `Failed to save receipt settings: ${rawMsg}`,
    };
  }

  const persistedSettings = normalizeReceiptSettings(data?.receipt_settings ?? nextSettings);

  // Best-effort cleanup of replaced or removed logo file in Supabase Storage after DB save succeeds
  if (
    previousSavedLogoStoragePath &&
    previousSavedLogoStoragePath !== persistedSettings.logoStoragePath &&
    previousSavedLogoStoragePath.startsWith(`${orgId}/`)
  ) {
    try {
      await supabase.storage
        .from(RECEIPT_STORAGE_BUCKET)
        .remove([previousSavedLogoStoragePath]);
    } catch {
      // Non-fatal storage cleanup
    }
  }

  notifyReceiptSettingsUpdated(orgId, persistedSettings);

  return {
    settings: persistedSettings,
    error: null,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function optimizeReceiptLogoToPng(
  sourceDataUrl: string
): Promise<{ dataUrl: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 360;
      const maxH = 140;
      const naturalW = img.naturalWidth || maxW;
      const naturalH = img.naturalHeight || maxH;
      const scale = Math.min(1, maxW / naturalW, maxH / naturalH);
      const targetW = Math.max(1, Math.round(naturalW * scale));
      const targetH = Math.max(1, Math.round(naturalH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas rendering is unavailable in this browser.'));
        return;
      }

      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const dataUrl = canvas.toDataURL('image/png');
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Unable to encode optimized logo PNG.'));
            return;
          }
          resolve({ dataUrl, blob });
        },
        'image/png',
        0.92
      );
    };
    img.onerror = () => reject(new Error('Selected file could not be decoded as an image.'));
    img.src = sourceDataUrl;
  });
}

const ALLOWED_LOGO_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

export async function processAndStoreReceiptLogo(
  organisationId: string,
  file: File,
  role: OrganisationRole | null
): Promise<{
  logoUrl: string | null;
  logoStoragePath: string | null;
  error: string | null;
}> {
  if (role !== 'owner' && role !== 'admin') {
    return {
      logoUrl: null,
      logoStoragePath: null,
      error: 'Only Organization Owners and Admins can upload a business logo.',
    };
  }

  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      error: 'Please upload a PNG, JPG, WebP, or SVG image file.',
    };
  }

  if (file.size > 2 * 1024 * 1024) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      error: 'Logo file size must be 2 MB or smaller.',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      error: 'Supabase client is not configured. Unable to upload receipt logo.',
    };
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    const { dataUrl, blob } = await optimizeReceiptLogoToPng(rawDataUrl);

    const storagePath = `${organisationId}/settings/receipt-logo-${Date.now()}.png`;
    const { error: uploadErr } = await supabase.storage
      .from(RECEIPT_STORAGE_BUCKET)
      .upload(storagePath, blob, {
        upsert: false,
        contentType: 'image/png',
        cacheControl: '3600',
      });

    if (uploadErr) {
      return {
        logoUrl: null,
        logoStoragePath: null,
        error: `Failed to upload receipt logo to Supabase Storage: ${uploadErr.message}`,
      };
    }

    return {
      logoUrl: dataUrl,
      logoStoragePath: storagePath,
      error: null,
    };
  } catch (err: unknown) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      error: err instanceof Error ? err.message : 'Unable to process receipt logo image.',
    };
  }
}

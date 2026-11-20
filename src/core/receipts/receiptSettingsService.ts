import { getSupabaseClient } from '../supabase/client';
import type { Organisation, OrganisationRole } from '../types/domain';
import {
  DEFAULT_RECEIPT_SETTINGS,
  normalizeReceiptSettings,
  type ReceiptSettings,
} from './receiptSettingsTypes';

const RECEIPT_STORAGE_BUCKET = 'organisation-files';
const LOCAL_STORAGE_PREFIX = 'veyora_receipt_settings:';
const RECEIPT_SETTINGS_UPDATED_EVENT = 'veyora:receipt-settings-updated';

export type ReceiptSettingsStorageSource =
  | 'database'
  | 'storage'
  | 'local_cache'
  | 'default';

function getLocalStorageKey(organisationId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${organisationId}`;
}

function readLocalReceiptSettings(organisationId: string): ReceiptSettings | null {
  try {
    const raw = window.localStorage.getItem(getLocalStorageKey(organisationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeReceiptSettings(parsed);
  } catch {
    return null;
  }
}

function writeLocalReceiptSettings(organisationId: string, settings: ReceiptSettings): void {
  try {
    window.localStorage.setItem(getLocalStorageKey(organisationId), JSON.stringify(settings));
  } catch {
    // Ignore quota or storage restriction errors
  }
}

function getSettingsStoragePath(organisationId: string): string {
  return `${organisationId}/settings/receipt-settings.json`;
}

export function getDefaultReceiptSettings(): ReceiptSettings {
  return { ...DEFAULT_RECEIPT_SETTINGS };
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

export async function loadOrganizationReceiptSettings(
  organisation: Organisation | null
): Promise<{
  settings: ReceiptSettings;
  source: ReceiptSettingsStorageSource;
  warning: string | null;
}> {
  if (!organisation?.id) {
    return {
      settings: getDefaultReceiptSettings(),
      source: 'default',
      warning: null,
    };
  }

  const orgId = organisation.id;

  // 1. Prefer organizations.receipt_settings column if present in schema & populated
  if (organisation.has_receipt_settings_column && organisation.receipt_settings) {
    const normalized = normalizeReceiptSettings(organisation.receipt_settings);
    writeLocalReceiptSettings(orgId, normalized);
    return {
      settings: normalized,
      source: 'database',
      warning: null,
    };
  }

  // 2. Try existing Supabase Storage bucket (organisation-files/<orgId>/settings/receipt-settings.json)
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.storage
        .from(RECEIPT_STORAGE_BUCKET)
        .download(getSettingsStoragePath(orgId));

      if (!error && data) {
        const text = await data.text();
        const parsed = JSON.parse(text) as unknown;
        const normalized = normalizeReceiptSettings(parsed);
        writeLocalReceiptSettings(orgId, normalized);
        return {
          settings: normalized,
          source: 'storage',
          warning: null,
        };
      }
    } catch {
      // Fall through cleanly to local cache or defaults if Storage file doesn't exist yet
    }
  }

  // 3. Fallback to per-organisation local cache
  const local = readLocalReceiptSettings(orgId);
  if (local) {
    return {
      settings: local,
      source: 'local_cache',
      warning: null,
    };
  }

  // 4. Default receipt settings
  return {
    settings: getDefaultReceiptSettings(),
    source: 'default',
    warning: null,
  };
}

export async function saveOrganizationReceiptSettings(
  organisation: Organisation,
  draft: ReceiptSettings,
  role: OrganisationRole | null
): Promise<{
  settings: ReceiptSettings;
  source: ReceiptSettingsStorageSource;
  error: string | null;
  warning: string | null;
}> {
  if (role !== 'owner' && role !== 'admin') {
    return {
      settings: draft,
      source: 'default',
      error: 'Only Organization Owners and Admins can modify receipt settings.',
      warning: null,
    };
  }

  const orgId = organisation.id;
  const nextSettings: ReceiptSettings = {
    ...normalizeReceiptSettings(draft),
    updatedAt: new Date().toISOString(),
  };

  // Always save per-organisation local cache so reloads retain preferences immediately
  writeLocalReceiptSettings(orgId, nextSettings);
  notifyReceiptSettingsUpdated(orgId, nextSettings);

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      settings: nextSettings,
      source: 'local_cache',
      error: null,
      warning:
        'Supabase is not configured. Receipt settings were saved locally in this browser for this organization.',
    };
  }

  // 1. If organizations.receipt_settings column exists in live schema, persist directly on public.organizations
  if (organisation.has_receipt_settings_column) {
    const { error } = await supabase
      .from('organizations')
      .update({
        receipt_settings: nextSettings as unknown as Record<string, unknown>,
      })
      .eq('id', orgId);

    if (!error) {
      return {
        settings: nextSettings,
        source: 'database',
        error: null,
        warning: null,
      };
    }
    return {
      settings: nextSettings,
      source: 'local_cache',
      error: error.message || 'Unable to save receipt settings to the organization record.',
      warning: null,
    };
  }

  // 2. Otherwise use existing organisation-files private Storage bucket (<orgId>/settings/receipt-settings.json)
  // Note: Storage RLS provides DELETE (owner/admin) + INSERT (org member), so remove before upload instead of upsert.
  const path = getSettingsStoragePath(orgId);
  try {
    await supabase.storage.from(RECEIPT_STORAGE_BUCKET).remove([path]);
    const payloadBlob = new Blob([JSON.stringify(nextSettings)], {
      type: 'application/json',
    });
    const { error: uploadError } = await supabase.storage
      .from(RECEIPT_STORAGE_BUCKET)
      .upload(path, payloadBlob, {
        upsert: false,
        contentType: 'application/json',
        cacheControl: '0',
      });

    if (!uploadError) {
      return {
        settings: nextSettings,
        source: 'storage',
        error: null,
        warning: null,
      };
    }

    return {
      settings: nextSettings,
      source: 'local_cache',
      error: null,
      warning: `Settings saved in this browser for ${organisation.name}. Cloud sync via Storage (${RECEIPT_STORAGE_BUCKET}) was unavailable (${uploadError.message}); apply the receipt_settings SQL migration for database persistence.`,
    };
  } catch (err: unknown) {
    return {
      settings: nextSettings,
      source: 'local_cache',
      error: null,
      warning: `Settings saved in this browser for ${organisation.name}. Cloud sync failed (${
        err instanceof Error ? err.message : 'network error'
      }).`,
    };
  }
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

function optimizeReceiptLogoToPng(sourceDataUrl: string): Promise<{ dataUrl: string; blob: Blob }> {
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
  previousStoragePath: string | null,
  role: OrganisationRole | null
): Promise<{
  logoUrl: string | null;
  logoStoragePath: string | null;
  warning: string | null;
  error: string | null;
}> {
  if (role !== 'owner' && role !== 'admin') {
    return {
      logoUrl: null,
      logoStoragePath: null,
      warning: null,
      error: 'Only Organization Owners and Admins can upload a business logo.',
    };
  }

  if (!ALLOWED_LOGO_TYPES.has(file.type)) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      warning: null,
      error: 'Please upload a PNG, JPG, WebP, or SVG image file.',
    };
  }

  if (file.size > 2 * 1024 * 1024) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      warning: null,
      error: 'Logo file size must be 2 MB or smaller.',
    };
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    const { dataUrl, blob } = await optimizeReceiptLogoToPng(rawDataUrl);

    let nextStoragePath: string | null = null;
    let warning: string | null = null;

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        if (previousStoragePath && previousStoragePath.startsWith(`${organisationId}/`)) {
          await supabase.storage.from(RECEIPT_STORAGE_BUCKET).remove([previousStoragePath]);
        }
        const storagePath = `${organisationId}/settings/receipt-logo-${Date.now()}.png`;
        const { error: uploadErr } = await supabase.storage
          .from(RECEIPT_STORAGE_BUCKET)
          .upload(storagePath, blob, {
            upsert: false,
            contentType: 'image/png',
            cacheControl: '3600',
          });
        if (!uploadErr) {
          nextStoragePath = storagePath;
        } else {
          warning = `Logo optimized for receipt printing, but Storage upload failed (${uploadErr.message}). Click Save Settings to persist the receipt configuration.`;
        }
      } catch {
        warning =
          'Logo optimized for receipt printing. Click Save Settings to persist the receipt configuration.';
      }
    }

    return {
      logoUrl: dataUrl,
      logoStoragePath: nextStoragePath,
      warning,
      error: null,
    };
  } catch (err: unknown) {
    return {
      logoUrl: null,
      logoStoragePath: null,
      warning: null,
      error: err instanceof Error ? err.message : 'Unable to process logo image.',
    };
  }
}

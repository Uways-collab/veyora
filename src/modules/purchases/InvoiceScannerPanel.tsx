import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileImage, FileText, Loader2, Plus, RefreshCw, ScanLine, Trash2, Upload, X } from 'lucide-react';
import { getSupabaseClient } from '../../core/supabase/client';
import { fetchPurchaseReferenceData, formatPurchaseMoney } from './purchasesService';
import type { PurchaseCatalogVariant, PurchaseReferenceData } from './purchasesTypes';
import type { SupplierRecord } from './suppliersTypes';

type InvoiceLine = {
  rowKey: string;
  productName: string;
  description: string;
  sku: string;
  barcode: string;
  brand: string;
  size: string;
  variant: string;
  quantity: string;
  unit: string;
  unitCost: string;
  discount: number | null;
  tax: number | null;
  lineTotal: number | null;
  confidence: string;
  variantId: string;
  newSku: string;
  newBarcode: string;
  newVariant: string;
  newUnit: string;
  newSellingPrice: string;
  edited: boolean;
};

type ExtractedInvoice = {
  supplier?: { name?: string | null; contact_person?: string | null; email?: string | null; phone?: string | null; address?: string | null; tax_number?: string | null };
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  purchase_order_reference?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  discount_amount?: number | null;
  tax_amount?: number | null;
  delivery_charges?: number | null;
  grand_total?: number | null;
  line_items?: Array<Record<string, unknown>>;
  warnings?: string[];
};

type ScanRow = { id: string; file_path: string; status: string; extracted_data: ExtractedInvoice; error_message: string | null };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
function normalizeCurrencyCode(value: string, fallback: string): string {
  const raw = value.trim().toUpperCase();
  if (!raw) return fallback.toUpperCase();
  if (raw === '₦' || raw === 'NGN' || raw === 'NAIRA' || raw === 'N') return 'NGN';
  if (raw === '
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function numericText(value: unknown, fallback = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function bestVariantMatch(line: Record<string, unknown>, variants: PurchaseCatalogVariant[]): PurchaseCatalogVariant | null {
  const sku = cleanText(line.sku).toLowerCase();
  const name = normalize(cleanText(line.product_name));
  const barcode = cleanText(line.barcode);
  const variant = normalize(cleanText(line.variant));
  const brand = normalize(cleanText(line.brand));
  const size = normalize(cleanText(line.size));
  if (barcode) {
    const exactBarcode = variants.find((item) => (item.barcode ?? '').trim() === barcode);
    if (exactBarcode) return exactBarcode;
  }
  if (sku) {
    const exactSku = variants.find((item) => item.sku.trim().toLowerCase() === sku);
    if (exactSku) return exactSku;
  }
  const exact = variants.find((item) => {
    const attributes = normalize(Object.values(item.attributes ?? {}).join(' '));
    return normalize(item.productName) === name &&
      (!variant || normalize(item.variantName) === variant) &&
      (!brand || attributes.includes(brand)) &&
      (!size || attributes.includes(size) || normalize(item.variantName).includes(size));
  });
  return exact ?? null;
}
function suggestedPrice(cost: number, method: 'markup' | 'margin', percent: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(percent) || percent < 0) return null;
  if (method === 'markup') return cost * (1 + percent / 100);
  if (percent >= 100) return null;
  return cost / (1 - percent / 100);
}

export function InvoiceScannerPanel({
  organisationId,
  currencyCode,
  canManage,
}: {
  organisationId: string | null;
  currencyCode: string;
  canManage: boolean;
}) {
  const [referenceData, setReferenceData] = useState<PurchaseReferenceData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'extracting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [invoiceCurrency, setInvoiceCurrency] = useState(currencyCode);
  const [subtotal, setSubtotal] = useState('');
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [grandTotal, setGrandTotal] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [pricingMethod, setPricingMethod] = useState<'markup' | 'margin'>('markup');
  const [pricingPercent, setPricingPercent] = useState('20');
  const [createdPurchaseId, setCreatedPurchaseId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ purchase_number: string; status: string } | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);
  const [editedFields, setEditedFields] = useState<string[]>([]);
  const markEdited = (field: string) => setEditedFields((current) => current.includes(field) ? current : [...current, field]);

  useEffect(() => {
    let active = true;
    if (!organisationId || !canManage) {
      setReferenceData(null);
      return;
    }
    void fetchPurchaseReferenceData(organisationId).then((data) => {
      if (active) setReferenceData(data);
    });
    return () => { active = false; };
  }, [organisationId, canManage]);

  const suppliers = referenceData?.activeSuppliers ?? [];
  const variants = referenceData?.catalogVariants ?? [];
  const lineSubtotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const cost = Number(line.unitCost);
    return sum + (Number.isFinite(quantity) && Number.isFinite(cost) ? quantity * cost : 0);
  }, 0), [lines]);
  const calculatedTotal = lineSubtotal - Math.max(0, Number(discount) || 0) + Math.max(0, Number(tax) || 0);
  const totalDifference = grandTotal.trim() ? Math.abs((Number(grandTotal) || 0) - calculatedTotal) : 0;
  const currencyMismatch = Boolean(invoiceCurrency.trim()) &&
    invoiceCurrency.trim().toUpperCase() !== currencyCode.trim().toUpperCase();

  const resetScan = () => {
    if (scan && scan.status !== 'linked') {
      const supabase = getSupabaseClient();
      if (supabase) {
        void supabase.from('invoice_scans').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', scan.id);
        void supabase.storage.from('invoice-documents').remove([scan.file_path]);
      }
    }
    setFile(null); setScan(null); setPreviewUrl(''); setError(null); setStage('idle');
    setSupplierId(''); setInvoiceNumber(''); setInvoiceDate(''); setDueDate('');
    setInvoiceCurrency(currencyCode); setSubtotal(''); setDiscount('0'); setTax('0');
    setDelivery(''); setGrandTotal(''); setLines([]); setCreatedPurchaseId(null);
    setDuplicate(null); setEditedFields([]);
  };

  const applyExtraction = (data: ExtractedInvoice) => {
    setInvoiceNumber(cleanText(data.invoice_number));
    setInvoiceDate(cleanText(data.invoice_date));
    setDueDate(cleanText(data.due_date));
    setInvoiceCurrency(cleanText(data.currency) ? normalizeCurrencyCode(cleanText(data.currency), currencyCode) : '');
    setSubtotal(numericText(data.subtotal));
    setDiscount(numericText(data.discount_amount));
    setTax(numericText(data.tax_amount));
    setDelivery(numericText(data.delivery_charges));
    setGrandTotal(numericText(data.grand_total));
    const supplierName = cleanText(data.supplier?.name);
    const supplierMatch = supplierName ? (suppliers.find((supplier) => normalize(supplier.name) === normalize(supplierName))
      ?? suppliers.find((supplier) => normalize(supplier.name).includes(normalize(supplierName)) || normalize(supplierName).includes(normalize(supplier.name)))) : undefined;
    setSupplierId(supplierMatch?.id ?? '');
    setEditedFields([]);
    setLines((data.line_items ?? []).map((raw, index) => {
      const match = bestVariantMatch(raw, variants);
      return {
        rowKey: `invoice-line-${index}-${Date.now()}`,
        productName: cleanText(raw.product_name) || 'Unclear product name',
        description: cleanText(raw.description),
        sku: cleanText(raw.sku),
        barcode: cleanText(raw.barcode),
        brand: cleanText(raw.brand),
        size: cleanText(raw.size),
        variant: cleanText(raw.variant),
        quantity: numericText(raw.quantity),
        unit: cleanText(raw.unit_of_measure),
        unitCost: numericText(raw.unit_cost),
        discount: typeof raw.discount === 'number' ? raw.discount : null,
        tax: typeof raw.tax === 'number' ? raw.tax : null,
        lineTotal: typeof raw.line_total === 'number' ? raw.line_total : null,
        confidence: cleanText(raw.confidence) || 'low',
        variantId: match?.variantId ?? '',
        newSku: cleanText(raw.sku),
        newBarcode: cleanText(raw.barcode),
        newVariant: cleanText(raw.variant) || 'Default',
        newUnit: cleanText(raw.unit_of_measure),
        newSellingPrice: '',
        edited: false,
      };
    }));
  };

  const processExistingScan = async (scanId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Veyora is not connected to the database.');
    setStage('extracting');
    const { data, error: invokeError } = await supabase.functions.invoke('scan-supplier-invoice', {
      body: { scan_id: scanId },
    });
    if (invokeError) throw new Error(invokeError.message || 'Invoice extraction failed.');
    if (data?.error) throw new Error(String(data.error));
    const extracted = data?.extracted_data as ExtractedInvoice | undefined;
    if (!extracted || !Array.isArray(extracted.line_items)) throw new Error('The scan did not return readable invoice line items.');
    const { data: saved, error: readError } = await supabase.from('invoice_scans')
      .select('id,file_path,status,extracted_data,error_message').eq('id', scanId).single();
    if (readError || !saved) throw new Error(readError?.message || 'Could not load the saved invoice scan.');
    setScan(saved as ScanRow);
    applyExtraction(extracted);
    const { data: signed, error: signedError } = await supabase.storage.from('invoice-documents')
      .createSignedUrl(saved.file_path, 60 * 30);
    if (!signedError && signed?.signedUrl) setPreviewUrl(signed.signedUrl);
    setStage('idle');
  };

  const handleUploadAndScan = async () => {
    if (!organisationId || !file || !canManage) return;
    if (!ACCEPTED_MIME.has(file.type)) { setError('Choose a JPG, PNG, WebP image or PDF invoice.'); return; }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) { setError('The invoice must be smaller than 10 MB.'); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setError('Veyora is not connected to the database.'); return; }
    setBusy(true); setError(null); setCreatedPurchaseId(null);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) { setBusy(false); setError('Sign in again before scanning an invoice.'); return; }
    const scanId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'supplier-invoice';
    const filePath = `${organisationId}/invoices/${scanId}/${safeName}`;
    try {
      setStage('uploading');
      const { error: uploadError } = await supabase.storage.from('invoice-documents').upload(filePath, file, {
        contentType: file.type, upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { error: insertError } = await supabase.from('invoice_scans').insert({
        id: scanId, organization_id: organisationId, uploaded_by: userData.user.id,
        file_path: filePath, file_name: file.name, mime_type: file.type, file_size: file.size,
      });
      if (insertError) {
        await supabase.storage.from('invoice-documents').remove([filePath]);
        throw new Error(insertError.message);
      }
      setScan({ id: scanId, file_path: filePath, status: 'uploaded', extracted_data: {}, error_message: null });
      await processExistingScan(scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invoice scanning failed. Try again.');
      setStage('idle');
      const { data: row } = await supabase.from('invoice_scans')
        .select('id,file_path,status,extracted_data,error_message').eq('id', scanId).maybeSingle();
      if (row) setScan(row as ScanRow);
    } finally {
      setBusy(false); setStage('idle');
    }
  };

  const retryScan = async () => {
    if (!scan || !organisationId) return;
    setBusy(true); setError(null);
    try { await processExistingScan(scan.id); }
    catch (err) { setError(err instanceof Error ? err.message : 'Retry failed.'); }
    finally { setBusy(false); setStage('idle'); }
  };

  const updateLine = (rowKey: string, patch: Partial<InvoiceLine>) => {
    setLines((current) => current.map((line) => line.rowKey === rowKey ? { ...line, ...patch, edited: true } : line));
  };

  const createNewProduct = async (line: InvoiceLine) => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId) return;
    const cost = Number(line.unitCost);
    if (!line.productName.trim() || !line.newVariant.trim() || !line.newUnit.trim() || !line.newSku.trim() || !Number.isFinite(cost) || cost < 0) {
      setError('Complete the new product name, variant, SKU, unit and purchase cost first.');
      return;
    }
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('invoice_scanner_create_product_variant', {
      p_organization_id: organisationId,
      p_product_name: line.productName,
      p_description: line.description || null,
      p_variant_name: line.newVariant,
      p_sku: line.newSku || null,
      p_barcode: line.newBarcode || null,
      p_unit_of_measure: line.newUnit,
      p_cost_price: cost,
      p_selling_price: Math.max(0, Number(line.newSellingPrice) || 0),
      p_attributes: { brand: line.brand, size: line.size },
    });
    if (rpcError || !data) {
      setError(rpcError?.message || 'The new product could not be created.');
    } else {
      updateLine(line.rowKey, { variantId: String(data) });
      const refreshed = await fetchPurchaseReferenceData(organisationId);
      setReferenceData(refreshed);
    }
    setBusy(false);
  };

  const applySellingPrice = async (line: InvoiceLine, price: number) => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !line.variantId || !Number.isFinite(price) || price < 0) return;
    setBusy(true); setError(null);
    const { error: updateError } = await supabase.from('product_variants')
      .update({ selling_price: price })
      .eq('organization_id', organisationId).eq('id', line.variantId);
    if (updateError) setError(updateError.message);
    else setError(null);
    setBusy(false);
  };

  const checkDuplicate = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !supplierId || !invoiceNumber.trim()) { setDuplicate(null); return; }
    setDuplicateChecking(true);
    const { data } = await supabase.from('purchases')
      .select('purchase_number,status')
      .eq('organization_id', organisationId)
      .eq('supplier_id', supplierId)
      .eq('supplier_invoice_number', invoiceNumber.trim())
      .neq('status', 'cancelled')
      .limit(1).maybeSingle();
    setDuplicate(data ?? null);
    setDuplicateChecking(false);
  };

  const createPurchaseDraft = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !scan) return;
    if (!supplierId) { setError('Select the supplier before creating a purchase draft.'); return; }
    if (!invoiceCurrency.trim()) { setError('Invoice currency is missing. Confirm the currency before creating the purchase.'); return; }
    if (currencyMismatch) { setError('The invoice currency differs from the organisation currency. Resolve this before creating the purchase.'); return; }
    if (!discount.trim() || !tax.trim()) { setError('Confirm the invoice discount and tax values. Enter 0 when the invoice shows none.'); return; }
    if (lines.length === 0 || lines.some((line) => !line.variantId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !line.unitCost.trim() || !Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0)) {
      setError('Match or create every product and enter a valid quantity and purchase cost before continuing.');
      return;
    }
    if (duplicate) { setError('A possible duplicate purchase exists. Review it in Purchases before continuing.'); return; }
    setBusy(true); setError(null); setStage('saving');
    const notes = [
      'Created from reviewed AI invoice scan.',
      scan.extracted_data.purchase_order_reference ? `Supplier PO reference: ${scan.extracted_data.purchase_order_reference}` : '',
      Number(delivery) > 0 ? `Invoice delivery/additional charges: ${invoiceCurrency} ${delivery} (retained from invoice; not added to stock cost).` : '',
      'The original supplier invoice is attached in the Invoice Scanner record.',
      lines.some((line) => line.discount !== null || line.tax !== null) ? 'Line-level discounts and taxes are preserved in the invoice scan details; purchase items use the Veyora purchase workflow unit-cost fields.' : '',
      scan.extracted_data.warnings?.length ? `Invoice review warnings: ${scan.extracted_data.warnings.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    const { data, error: rpcError } = await supabase.rpc('invoice_scanner_create_purchase_draft', {
      p_organization_id: organisationId,
      p_scan_id: scan.id,
      p_supplier_id: supplierId,
      p_items: lines.map((line) => ({ variant_id: line.variantId, quantity: Number(line.quantity), unit_cost: Number(line.unitCost) })),
      p_discount_amount: Math.max(0, Number(discount) || 0),
      p_tax_amount: Math.max(0, Number(tax) || 0),
      p_supplier_invoice_number: invoiceNumber.trim() || null,
      p_expected_delivery_date: null,
      p_due_date: dueDate || null,
      p_invoice_date: invoiceDate || null,
      p_currency: invoiceCurrency.trim().toUpperCase(),
      p_notes: notes,
    });
    if (rpcError || !data) setError(rpcError?.message || 'The purchase draft could not be created.');
    else setCreatedPurchaseId(String(data));
    setBusy(false); setStage('idle');
  };

  const addManualLine = () => setLines((current) => [...current, {
    rowKey: `manual-${Date.now()}`, productName: '', description: '', sku: '', barcode: '', brand: '', size: '', variant: '',
    quantity: '1', unit: 'piece', unitCost: '', discount: null, tax: null, lineTotal: null,
    confidence: 'manual', variantId: '', newSku: '', newBarcode: '', newVariant: 'Default', newUnit: '', newSellingPrice: '', edited: true,
  }]);

  if (!canManage) return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Invoice scanning is available to Owners, Admins and Managers.</div>;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ScanLine className="h-4 w-4 text-blue-700" /> AI Invoice Scanner</div>
            <p className="mt-1 text-xs text-slate-500 max-w-2xl">Upload or photograph a supplier invoice. Veyora extracts the details and prepares a purchase draft for your review. Scanning never adds stock or records a payment.</p>
          </div>
          {scan && !createdPurchaseId && <button type="button" disabled={busy} onClick={resetScan} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"><X className="h-3.5 w-3.5" /> Cancel scan</button>}
        </div>
        {!scan && (
          <div className="rounded-md border-2 border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
            <Upload className="mx-auto h-6 w-6 text-slate-400" />
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800">
              <FileImage className="h-4 w-4" /> Choose invoice / use camera
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">JPG, PNG, WebP or multi-page PDF · Up to 10 MB</p>
            {file && <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-700"><FileText className="h-4 w-4" />{file.name}<span className="text-slate-400">({(file.size / 1024 / 1024).toFixed(2)} MB)</span></div>}
            <button type="button" disabled={!file || busy || !organisationId || !referenceData} onClick={() => void handleUploadAndScan()} className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />} Scan invoice
            </button>
          </div>
        )}
        {busy && <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{stage === 'uploading' ? 'Uploading securely…' : stage === 'extracting' ? 'Reading invoice pages and extracting details…' : 'Preparing the purchase draft…'}</div>}
        {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
        {scan && scan.status !== 'ready' && scan.status !== 'linked' && scan.status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void retryScan()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"><RefreshCw className="h-3.5 w-3.5" /> Retry extraction</button>}
      </section>

      {scan && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5">
          <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800">Original invoice</div>
            {previewUrl ? (file?.type === 'application/pdf' || scan.file_path.toLowerCase().endsWith('.pdf') ? <iframe title="Original supplier invoice" src={previewUrl} className="h-[520px] w-full" /> : <img src={previewUrl} alt="Original supplier invoice" className="max-h-[520px] w-full object-contain bg-slate-50" />) : <div className="p-6 text-xs text-slate-500">Secure preview is not available.</div>}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">Review invoice details</h2><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">AI extracted · editable</span><span className="text-[10px] text-slate-500">Fields marked “Edited by you” were changed manually.</span></div>
            {scan.extracted_data.warnings?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Review needed</strong><ul className="mt-1 list-disc pl-4">{scan.extracted_data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div> : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1"><span className="text-slate-500">Supplier <span className="text-rose-600">*</span> {editedFields.includes('supplier') ? '· Edited by you' : '· AI match / review'}</span><select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setDuplicate(null); markEdited('supplier'); }} className="w-full rounded-md border border-slate-200 p-2"><option value="">Select existing supplier</option>{suppliers.map((supplier: SupplierRecord) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label className="space-y-1"><span className="text-slate-500">Supplier invoice number (if present)</span><input value={invoiceNumber} onChange={(e) => { setInvoiceNumber(e.target.value); markEdited('invoice number'); }} onBlur={() => void checkDuplicate()} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice date</span><input type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); markEdited('invoice date'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Due date</span><input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); markEdited('due date'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice currency</span><input value={invoiceCurrency} onChange={(e) => { setInvoiceCurrency(e.target.value.toUpperCase()); markEdited('currency'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice subtotal</span><input type="number" min="0" value={subtotal} onChange={(e) => { setSubtotal(e.target.value); markEdited('subtotal'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Discount</span><input type="number" min="0" value={discount} onChange={(e) => { setDiscount(e.target.value); markEdited('discount'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Tax</span><input type="number" min="0" value={tax} onChange={(e) => { setTax(e.target.value); markEdited('tax'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Delivery / extra charges</span><input type="number" min="0" value={delivery} onChange={(e) => { setDelivery(e.target.value); markEdited('delivery'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice grand total</span><input type="number" min="0" value={grandTotal} onChange={(e) => { setGrandTotal(e.target.value); markEdited('grand total'); }} className="w-full rounded-md border border-slate-200 p-2" /></label>
            </div>
            {duplicateChecking && <p className="text-[11px] text-slate-500">Checking for duplicate invoice…</p>}{!invoiceNumber.trim() && <p className="text-[11px] text-amber-700">No invoice number is recorded. Duplicate detection will be less reliable; do not invent a reference.</p>}
            {duplicate && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><strong>Possible duplicate:</strong> {duplicate.purchase_number} ({duplicate.status}). Review the existing purchase before creating another.</div>}
            {currencyMismatch && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Invoice currency differs from this workspace ({currencyCode}). The purchase cannot be created until the currency issue is resolved.</div>}
            {grandTotal.trim() && totalDifference > 0.01 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Invoice total differs from the current line calculation by {formatPurchaseMoney(totalDifference, invoiceCurrency)}. Veyora will not silently adjust the values.</div>}
          </section>
        </div>
      )}

      {scan && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Invoice line items</h2><p className="mt-1 text-xs text-slate-500">Choose the exact variant for each line. Similar names are not treated as confirmed matches.</p></div><button type="button" onClick={addManualLine} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700"><Plus className="h-3.5 w-3.5" /> Add missing item</button></div>
          {lines.map((line) => {
            const match = variants.find((variant) => variant.variantId === line.variantId);
            const possibleMatches = !match ? variants.filter((variant) => normalize(variant.productName).includes(normalize(line.productName)) || normalize(line.productName).includes(normalize(variant.productName))).slice(0, 3) : [];
            const cost = Number(line.unitCost);
            const suggested = suggestedPrice(cost, pricingMethod, Number(pricingPercent));
            const existingPrice = match?.defaultSellingPrice ?? 0;
            return <div key={line.rowKey} className="rounded-md border border-slate-200 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs font-semibold text-slate-900">{line.productName || 'New line item'}</div><div className="mt-1 text-[10px] text-slate-500">{line.sku ? `SKU ${line.sku} · ` : ''}{line.edited ? 'Edited by you' : line.confidence === 'high' ? 'AI extracted · high confidence' : line.confidence === 'medium' ? 'AI extracted · review details' : 'AI extracted · needs manual review'}</div>{match ? <div className="mt-1 text-[10px] text-emerald-700">Existing product match selected · confirm the variant</div> : possibleMatches.length > 0 ? <div className="mt-1 text-[10px] text-amber-700">Possible match · choose the correct product/variant below</div> : <div className="mt-1 text-[10px] text-slate-500">No existing match found · create a new product if required</div>}</div><button type="button" onClick={() => setLines((current) => current.filter((item) => item.rowKey !== line.rowKey))} aria-label="Remove invoice line" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <label className="space-y-1 sm:col-span-2"><span className="text-slate-500">Match existing product / variant</span><select value={line.variantId} onChange={(e) => updateLine(line.rowKey, { variantId: e.target.value })} className="w-full rounded-md border border-slate-200 p-2"><option value="">No match — create new product below</option>{variants.map((variant) => <option key={variant.variantId} value={variant.variantId}>{variant.productName} · {variant.variantName}{variant.sku ? ` · ${variant.sku}` : ''}</option>)}</select></label>
                <label className="space-y-1"><span className="text-slate-500">Quantity</span><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(e) => updateLine(line.rowKey, { quantity: e.target.value })} className="w-full rounded-md border border-slate-200 p-2" /></label>
                <label className="space-y-1"><span className="text-slate-500">Unit purchase cost</span><input type="number" min="0" step="0.0001" value={line.unitCost} onChange={(e) => updateLine(line.rowKey, { unitCost: e.target.value })} className="w-full rounded-md border border-slate-200 p-2" /></label>
              </div>
              {!line.variantId && <div className="rounded-md bg-slate-50 p-3 space-y-2"><div className="text-xs font-medium text-slate-800">Create new product after review</div>{suggested !== null && <div className="text-[11px] text-slate-600">Suggested selling price ({pricingMethod === 'markup' ? 'markup' : 'gross margin'}): <strong>{formatPurchaseMoney(suggested, invoiceCurrency)}</strong> · You must enter or approve a price separately.</div>}<div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><label className="text-[11px] text-slate-500">Product name<input value={line.productName} onChange={(e) => updateLine(line.rowKey, { productName: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Variant name<input value={line.newVariant} onChange={(e) => updateLine(line.rowKey, { newVariant: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">SKU *<input value={line.newSku} onChange={(e) => updateLine(line.rowKey, { newSku: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Barcode<input value={line.newBarcode} onChange={(e) => updateLine(line.rowKey, { newBarcode: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Unit of measure<input value={line.newUnit} onChange={(e) => updateLine(line.rowKey, { newUnit: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Selling price (optional)<input type="number" min="0" step="0.01" value={line.newSellingPrice} onChange={(e) => updateLine(line.rowKey, { newSellingPrice: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" />{suggested !== null && <button type="button" onClick={() => updateLine(line.rowKey, { newSellingPrice: suggested.toFixed(2) })} className="mt-1 text-blue-700 underline">Use suggested price</button>}</label></div><button type="button" disabled={busy || !line.newSku.trim()} onClick={() => void createNewProduct(line)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40">Approve and create product</button><p className="text-[10px] text-slate-500">This saves the new product and variant now; it does not add stock.</p></div>}
              {line.variantId && <div className="rounded-md bg-slate-50 p-3 space-y-2"><div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]"><span className="text-slate-600">Purchase cost: <strong className="text-slate-900">{formatPurchaseMoney(Number.isFinite(cost) ? cost : 0, invoiceCurrency)}</strong></span><span className="text-slate-600">Existing selling price: <strong className="text-slate-900">{formatPurchaseMoney(existingPrice, invoiceCurrency)}</strong></span><span className="text-slate-600">Suggested price: <strong className="text-slate-900">{suggested === null ? 'Not available' : formatPurchaseMoney(suggested, invoiceCurrency)}</strong></span>{suggested !== null && <span className="text-slate-600">Expected profit: <strong className="text-slate-900">{formatPurchaseMoney(suggested - cost, invoiceCurrency)} ({suggested > 0 ? (((suggested - cost) / suggested) * 100).toFixed(1) : '0.0'}% margin)</strong></span>}</div><div className="flex flex-wrap items-end gap-2"><label className="text-[11px] text-slate-500">Custom selling price<input type="number" min="0" step="0.01" value={line.newSellingPrice || (suggested === null ? '' : suggested.toFixed(2))} onChange={(e) => updateLine(line.rowKey, { newSellingPrice: e.target.value })} className="mt-1 block w-36 rounded border border-slate-200 bg-white p-2 text-xs" /></label><button type="button" disabled={busy || !line.newSellingPrice.trim()} onClick={() => void applySellingPrice(line, Number(line.newSellingPrice || suggested))} className="rounded-md bg-white border border-slate-300 px-3 py-2 text-[11px] font-medium text-slate-700 disabled:opacity-40">Apply price (explicit)</button></div><p className="text-[10px] text-slate-500">No selling price changes unless you press Apply price. Leaving it untouched preserves the current price.</p></div>}
            </div>;
          })}
          <div className="flex flex-wrap items-center gap-3 text-xs"><label className="space-y-1"><span className="text-slate-500">Pricing method</span><select value={pricingMethod} onChange={(e) => setPricingMethod(e.target.value as 'markup' | 'margin')} className="block rounded-md border border-slate-200 p-2"><option value="markup">Markup on cost</option><option value="margin">Gross margin</option></select></label><label className="space-y-1"><span className="text-slate-500">{pricingMethod === 'markup' ? 'Markup %' : 'Gross margin %'}</span><input type="number" min="0" max={pricingMethod === 'margin' ? 99.99 : 1000} step="0.5" value={pricingPercent} onChange={(e) => setPricingPercent(e.target.value)} className="block w-28 rounded-md border border-slate-200 p-2" /></label><span className="text-[11px] text-slate-500 self-end pb-2">{pricingMethod === 'markup' ? 'Cost × (1 + markup)' : 'Cost ÷ (1 − margin)'}</span></div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4 text-xs"><div className="space-y-1 text-slate-600"><div>Calculated line subtotal: <strong>{formatPurchaseMoney(lineSubtotal, invoiceCurrency)}</strong></div><div>Purchase total before delivery: <strong>{formatPurchaseMoney(calculatedTotal, invoiceCurrency)}</strong></div>{Number(delivery) > 0 && <div className="text-amber-700">Delivery charges are retained in invoice notes; the current purchase model does not store them as a separate cost field.</div>}</div><button type="button" disabled={busy || !scan || scan.status !== 'ready' || Boolean(duplicate) || currencyMismatch || lines.length === 0} onClick={() => void createPurchaseDraft()} className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" /> Create purchase draft</button></div>
          {createdPurchaseId && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><strong>Purchase draft created.</strong> The invoice is attached. No stock or payment was recorded. Open Purchases to confirm the order, then use Receive Goods to record only the quantities actually accepted. <span className="font-mono">{createdPurchaseId}</span><button type="button" onClick={() => { window.location.hash = '#/purchases'; }} className="ml-2 underline font-semibold">Open Purchases</button></div>}
        </section>
      )}
    </div>
  );
}
 || raw === 'US
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function numericText(value: unknown, fallback = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function bestVariantMatch(line: Record<string, unknown>, variants: PurchaseCatalogVariant[]): PurchaseCatalogVariant | null {
  const sku = cleanText(line.sku).toLowerCase();
  const name = normalize(cleanText(line.product_name));
  const barcode = cleanText(line.barcode);
  const variant = normalize(cleanText(line.variant));
  if (barcode) {
    const exactBarcode = variants.find((item) => (item.barcode ?? '').trim() === barcode);
    if (exactBarcode) return exactBarcode;
  }
  if (sku) {
    const exactSku = variants.find((item) => item.sku.trim().toLowerCase() === sku);
    if (exactSku) return exactSku;
  }
  const exact = variants.find((item) =>
    normalize(item.productName) === name &&
    (!variant || normalize(item.variantName) === variant)
  );
  return exact ?? null;
}
function suggestedPrice(cost: number, method: 'markup' | 'margin', percent: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(percent) || percent < 0) return null;
  if (method === 'markup') return cost * (1 + percent / 100);
  if (percent >= 100) return null;
  return cost / (1 - percent / 100);
}

export function InvoiceScannerPanel({
  organisationId,
  currencyCode,
  canManage,
}: {
  organisationId: string | null;
  currencyCode: string;
  canManage: boolean;
}) {
  const [referenceData, setReferenceData] = useState<PurchaseReferenceData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'extracting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [invoiceCurrency, setInvoiceCurrency] = useState(currencyCode);
  const [subtotal, setSubtotal] = useState('');
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [grandTotal, setGrandTotal] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [pricingMethod, setPricingMethod] = useState<'markup' | 'margin'>('markup');
  const [pricingPercent, setPricingPercent] = useState('20');
  const [createdPurchaseId, setCreatedPurchaseId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ purchase_number: string; status: string } | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);

  useEffect(() => {
    let active = true;
    if (!organisationId || !canManage) {
      setReferenceData(null);
      return;
    }
    void fetchPurchaseReferenceData(organisationId).then((data) => {
      if (active) setReferenceData(data);
    });
    return () => { active = false; };
  }, [organisationId, canManage]);

  const suppliers = referenceData?.activeSuppliers ?? [];
  const variants = referenceData?.catalogVariants ?? [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const lineSubtotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const cost = Number(line.unitCost);
    return sum + (Number.isFinite(quantity) && Number.isFinite(cost) ? quantity * cost : 0);
  }, 0), [lines]);
  const calculatedTotal = lineSubtotal - Math.max(0, Number(discount) || 0) + Math.max(0, Number(tax) || 0);
  const totalDifference = grandTotal.trim() ? Math.abs((Number(grandTotal) || 0) - calculatedTotal) : 0;
  const currencyMismatch = Boolean(invoiceCurrency.trim()) &&
    invoiceCurrency.trim().toUpperCase() !== currencyCode.trim().toUpperCase();

  const resetScan = () => {
    setFile(null); setScan(null); setPreviewUrl(''); setError(null); setStage('idle');
    setSupplierId(''); setInvoiceNumber(''); setInvoiceDate(''); setDueDate('');
    setInvoiceCurrency(currencyCode); setSubtotal(''); setDiscount('0'); setTax('0');
    setDelivery('0'); setGrandTotal(''); setLines([]); setCreatedPurchaseId(null);
    setDuplicate(null);
  };

  const applyExtraction = (data: ExtractedInvoice) => {
    setInvoiceNumber(cleanText(data.invoice_number));
    setInvoiceDate(cleanText(data.invoice_date));
    setDueDate(cleanText(data.due_date));
    setInvoiceCurrency(cleanText(data.currency) || currencyCode);
    setSubtotal(numericText(data.subtotal));
    setDiscount(numericText(data.discount_amount, '0'));
    setTax(numericText(data.tax_amount, '0'));
    setDelivery(numericText(data.delivery_charges, '0'));
    setGrandTotal(numericText(data.grand_total));
    const supplierName = cleanText(data.supplier?.name);
    const supplierMatch = suppliers.find((supplier) => normalize(supplier.name) === normalize(supplierName))
      ?? suppliers.find((supplier) => normalize(supplier.name).includes(normalize(supplierName)) || normalize(supplierName).includes(normalize(supplier.name)));
    setSupplierId(supplierMatch?.id ?? '');
    setLines((data.line_items ?? []).map((raw, index) => {
      const match = bestVariantMatch(raw, variants);
      return {
        rowKey: `invoice-line-${index}-${Date.now()}`,
        productName: cleanText(raw.product_name) || 'Unclear product name',
        description: cleanText(raw.description),
        sku: cleanText(raw.sku),
        variant: cleanText(raw.variant),
        quantity: numericText(raw.quantity, '1'),
        unit: cleanText(raw.unit_of_measure) || 'piece',
        unitCost: numericText(raw.unit_cost),
        discount: typeof raw.discount === 'number' ? raw.discount : null,
        tax: typeof raw.tax === 'number' ? raw.tax : null,
        lineTotal: typeof raw.line_total === 'number' ? raw.line_total : null,
        confidence: cleanText(raw.confidence) || 'low',
        variantId: match?.variantId ?? '',
        newSku: cleanText(raw.sku),
        newVariant: cleanText(raw.variant) || 'Default',
        newUnit: cleanText(raw.unit_of_measure) || 'piece',
        newSellingPrice: '',
      };
    }));
  };

  const processExistingScan = async (scanId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Veyora is not connected to the database.');
    setStage('extracting');
    const { data, error: invokeError } = await supabase.functions.invoke('scan-supplier-invoice', {
      body: { scan_id: scanId },
    });
    if (invokeError) throw new Error(invokeError.message || 'Invoice extraction failed.');
    if (data?.error) throw new Error(String(data.error));
    const extracted = data?.extracted_data as ExtractedInvoice | undefined;
    if (!extracted || !Array.isArray(extracted.line_items)) throw new Error('The scan did not return readable invoice line items.');
    const { data: saved, error: readError } = await supabase.from('invoice_scans')
      .select('id,file_path,status,extracted_data,error_message').eq('id', scanId).single();
    if (readError || !saved) throw new Error(readError?.message || 'Could not load the saved invoice scan.');
    setScan(saved as ScanRow);
    applyExtraction(extracted);
    const { data: signed, error: signedError } = await supabase.storage.from('invoice-documents')
      .createSignedUrl(saved.file_path, 60 * 30);
    if (!signedError && signed?.signedUrl) setPreviewUrl(signed.signedUrl);
    setStage('idle');
  };

  const handleUploadAndScan = async () => {
    if (!organisationId || !file || !canManage) return;
    if (!ACCEPTED_MIME.has(file.type)) { setError('Choose a JPG, PNG, WebP image or PDF invoice.'); return; }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) { setError('The invoice must be smaller than 15 MB.'); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setError('Veyora is not connected to the database.'); return; }
    setBusy(true); setError(null); setCreatedPurchaseId(null);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) { setBusy(false); setError('Sign in again before scanning an invoice.'); return; }
    const scanId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'supplier-invoice';
    const filePath = `${organisationId}/invoices/${scanId}/${safeName}`;
    try {
      setStage('uploading');
      const { error: uploadError } = await supabase.storage.from('invoice-documents').upload(filePath, file, {
        contentType: file.type, upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { error: insertError } = await supabase.from('invoice_scans').insert({
        id: scanId, organization_id: organisationId, uploaded_by: userData.user.id,
        file_path: filePath, file_name: file.name, mime_type: file.type, file_size: file.size,
      });
      if (insertError) {
        await supabase.storage.from('invoice-documents').remove([filePath]);
        throw new Error(insertError.message);
      }
      setScan({ id: scanId, file_path: filePath, status: 'uploaded', extracted_data: {}, error_message: null });
      await processExistingScan(scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invoice scanning failed. Try again.');
      setStage('idle');
      const { data: row } = await supabase.from('invoice_scans')
        .select('id,file_path,status,extracted_data,error_message').eq('id', scanId).maybeSingle();
      if (row) setScan(row as ScanRow);
    } finally {
      setBusy(false); setStage('idle');
    }
  };

  const retryScan = async () => {
    if (!scan || !organisationId) return;
    setBusy(true); setError(null);
    try { await processExistingScan(scan.id); }
    catch (err) { setError(err instanceof Error ? err.message : 'Retry failed.'); }
    finally { setBusy(false); setStage('idle'); }
  };

  const updateLine = (rowKey: string, patch: Partial<InvoiceLine>) => {
    setLines((current) => current.map((line) => line.rowKey === rowKey ? { ...line, ...patch } : line));
  };

  const createNewProduct = async (line: InvoiceLine) => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId) return;
    const cost = Number(line.unitCost);
    if (!line.productName.trim() || !line.newVariant.trim() || !line.newUnit.trim() || !Number.isFinite(cost) || cost < 0) {
      setError('Complete the new product name, variant, unit and purchase cost first.');
      return;
    }
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('invoice_scanner_create_product_variant', {
      p_organization_id: organisationId,
      p_product_name: line.productName,
      p_description: line.description || null,
      p_variant_name: line.newVariant,
      p_sku: line.newSku || null,
      p_barcode: null,
      p_unit_of_measure: line.newUnit,
      p_cost_price: cost,
      p_selling_price: Math.max(0, Number(line.newSellingPrice) || 0),
      p_attributes: {},
    });
    if (rpcError || !data) {
      setError(rpcError?.message || 'The new product could not be created.');
    } else {
      updateLine(line.rowKey, { variantId: String(data) });
      const refreshed = await fetchPurchaseReferenceData(organisationId);
      setReferenceData(refreshed);
    }
    setBusy(false);
  };

  const applySellingPrice = async (line: InvoiceLine, price: number) => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !line.variantId || !Number.isFinite(price) || price < 0) return;
    setBusy(true); setError(null);
    const { error: updateError } = await supabase.from('product_variants')
      .update({ selling_price: price })
      .eq('organization_id', organisationId).eq('id', line.variantId);
    if (updateError) setError(updateError.message);
    else setError(null);
    setBusy(false);
  };

  const checkDuplicate = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !supplierId || !invoiceNumber.trim()) { setDuplicate(null); return; }
    setDuplicateChecking(true);
    const { data } = await supabase.from('purchases')
      .select('purchase_number,status')
      .eq('organization_id', organisationId)
      .eq('supplier_id', supplierId)
      .eq('supplier_invoice_number', invoiceNumber.trim())
      .neq('status', 'cancelled')
      .limit(1).maybeSingle();
    setDuplicate(data ?? null);
    setDuplicateChecking(false);
  };

  const createPurchaseDraft = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !scan) return;
    if (!supplierId) { setError('Select the supplier before creating a purchase draft.'); return; }
    if (!invoiceNumber.trim()) { setError('Enter the supplier invoice number or confirm that it is missing.'); return; }
    if (currencyMismatch) { setError('The invoice currency differs from the organisation currency. Resolve this before creating the purchase.'); return; }
    if (lines.length === 0 || lines.some((line) => !line.variantId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !line.unitCost.trim() || !Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0)) {
      setError('Match or create every product and enter a valid quantity and purchase cost before continuing.');
      return;
    }
    if (duplicate) { setError('A possible duplicate purchase exists. Review it in Purchases before continuing.'); return; }
    setBusy(true); setError(null); setStage('saving');
    const notes = [
      'Created from reviewed AI invoice scan.',
      scan.extracted_data.purchase_order_reference ? `Supplier PO reference: ${scan.extracted_data.purchase_order_reference}` : '',
      Number(delivery) > 0 ? `Invoice delivery/additional charges: ${invoiceCurrency} ${delivery} (retained from invoice; not added to stock cost).` : '',
      'The original supplier invoice is attached in the Invoice Scanner record.',
      lines.some((line) => line.discount !== null || line.tax !== null) ? 'Line-level discounts and taxes are preserved in the invoice scan details; purchase items use the Veyora purchase workflow unit-cost fields.' : '',
      scan.extracted_data.warnings?.length ? `Invoice review warnings: ${scan.extracted_data.warnings.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    const { data, error: rpcError } = await supabase.rpc('invoice_scanner_create_purchase_draft', {
      p_organization_id: organisationId,
      p_scan_id: scan.id,
      p_supplier_id: supplierId,
      p_items: lines.map((line) => ({ variant_id: line.variantId, quantity: Number(line.quantity), unit_cost: Number(line.unitCost) })),
      p_discount_amount: Math.max(0, Number(discount) || 0),
      p_tax_amount: Math.max(0, Number(tax) || 0),
      p_supplier_invoice_number: invoiceNumber.trim(),
      p_expected_delivery_date: null,
      p_due_date: dueDate || null,
      p_invoice_date: invoiceDate || null,
      p_currency: invoiceCurrency.trim().toUpperCase(),
      p_notes: notes,
    });
    if (rpcError || !data) setError(rpcError?.message || 'The purchase draft could not be created.');
    else setCreatedPurchaseId(String(data));
    setBusy(false); setStage('idle');
  };

  const addManualLine = () => setLines((current) => [...current, {
    rowKey: `manual-${Date.now()}`, productName: '', description: '', sku: '', variant: '',
    quantity: '1', unit: 'piece', unitCost: '', discount: null, tax: null, lineTotal: null,
    confidence: 'manual', variantId: '', newSku: '', newVariant: 'Default', newUnit: 'piece', newSellingPrice: '0',
  }]);

  if (!canManage) return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Invoice scanning is available to Owners, Admins and Managers.</div>;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ScanLine className="h-4 w-4 text-blue-700" /> AI Invoice Scanner</div>
            <p className="mt-1 text-xs text-slate-500 max-w-2xl">Upload or photograph a supplier invoice. Veyora extracts the details and prepares a purchase draft for your review. Scanning never adds stock or records a payment.</p>
          </div>
          {scan && !createdPurchaseId && <button type="button" onClick={resetScan} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Cancel scan</button>}
        </div>
        {!scan && (
          <div className="rounded-md border-2 border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
            <Upload className="mx-auto h-6 w-6 text-slate-400" />
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800">
              <FileImage className="h-4 w-4" /> Choose invoice / use camera
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">JPG, PNG, WebP or multi-page PDF · Up to 15 MB</p>
            {file && <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-700"><FileText className="h-4 w-4" />{file.name}<span className="text-slate-400">({(file.size / 1024 / 1024).toFixed(2)} MB)</span></div>}
            <button type="button" disabled={!file || busy || !organisationId || !referenceData} onClick={() => void handleUploadAndScan()} className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />} Scan invoice
            </button>
          </div>
        )}
        {busy && <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{stage === 'uploading' ? 'Uploading securely…' : stage === 'extracting' ? 'Reading invoice pages and extracting details…' : 'Preparing the purchase draft…'}</div>}
        {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
        {scan && scan.status !== 'ready' && scan.status !== 'linked' && scan.status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void retryScan()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"><RefreshCw className="h-3.5 w-3.5" /> Retry extraction</button>}
      </section>

      {scan && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5">
          <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800">Original invoice</div>
            {previewUrl ? (file?.type === 'application/pdf' || scan.file_path.toLowerCase().endsWith('.pdf') ? <iframe title="Original supplier invoice" src={previewUrl} className="h-[520px] w-full" /> : <img src={previewUrl} alt="Original supplier invoice" className="max-h-[520px] w-full object-contain bg-slate-50" />) : <div className="p-6 text-xs text-slate-500">Secure preview is not available.</div>}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">Review invoice details</h2><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">AI extracted · editable</span></div>
            {scan.extracted_data.warnings?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Review needed</strong><ul className="mt-1 list-disc pl-4">{scan.extracted_data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div> : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1"><span className="text-slate-500">Supplier <span className="text-rose-600">*</span></span><select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setDuplicate(null); }} className="w-full rounded-md border border-slate-200 p-2"><option value="">Select existing supplier</option>{suppliers.map((supplier: SupplierRecord) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label className="space-y-1"><span className="text-slate-500">Supplier invoice number</span><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} onBlur={() => void checkDuplicate()} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice date</span><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice currency</span><input value={invoiceCurrency} onChange={(e) => setInvoiceCurrency(e.target.value.toUpperCase())} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice subtotal</span><input type="number" min="0" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Discount</span><input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Tax</span><input type="number" min="0" value={tax} onChange={(e) => setTax(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Delivery / extra charges</span><input type="number" min="0" value={delivery} onChange={(e) => setDelivery(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice grand total</span><input type="number" min="0" value={grandTotal} onChange={(e) => setGrandTotal(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
            </div>
            {duplicateChecking && <p className="text-[11px] text-slate-500">Checking for duplicate invoice…</p>}
            {duplicate && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><strong>Possible duplicate:</strong> {duplicate.purchase_number} ({duplicate.status}). Review the existing purchase before creating another.</div>}
            {currencyMismatch && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Invoice currency differs from this workspace ({currencyCode}). The purchase cannot be created until the currency issue is resolved.</div>}
            {grandTotal.trim() && totalDifference > 0.01 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Invoice total differs from the current line calculation by {formatPurchaseMoney(totalDifference, invoiceCurrency)}. Veyora will not silently adjust the values.</div>}
          </section>
        </div>
      )}

      {scan && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Invoice line items</h2><p className="mt-1 text-xs text-slate-500">Choose the exact variant for each line. Similar names are not treated as confirmed matches.</p></div><button type="button" onClick={addManualLine} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700"><Plus className="h-3.5 w-3.5" /> Add missing item</button></div>
          {lines.map((line) => {
            const match = variants.find((variant) => variant.variantId === line.variantId);
            const cost = Number(line.unitCost);
            const suggested = suggestedPrice(cost, pricingMethod, Number(pricingPercent));
            const existingPrice = match?.defaultSellingPrice ?? 0;
            return <div key={line.rowKey} className="rounded-md border border-slate-200 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs font-semibold text-slate-900">{line.productName || 'New line item'}</div><div className="mt-1 text-[10px] text-slate-500">{line.sku ? `SKU ${line.sku} · ` : ''}{line.confidence === 'high' ? 'High extraction confidence' : line.confidence === 'medium' ? 'Check extracted details' : 'Needs manual review'}</div></div><button type="button" onClick={() => setLines((current) => current.filter((item) => item.rowKey !== line.rowKey))} aria-label="Remove invoice line" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <label className="space-y-1 sm:col-span-2"><span className="text-slate-500">Match existing product / variant</span><select value={line.variantId} onChange={(e) => updateLine(line.rowKey, { variantId: e.target.value })} className="w-full rounded-md border border-slate-200 p-2"><option value="">No match — create new product below</option>{variants.map((variant) => <option key={variant.variantId} value={variant.variantId}>{variant.productName} · {variant.variantName}{variant.sku ? ` · ${variant.sku}` : ''}</option>)}</select></label>
                <label className="space-y-1"><span className="text-slate-500">Quantity</span><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(e) => updateLine(line.rowKey, { quantity: e.target.value })} className="w-full rounded-md border border-slate-200 p-2" /></label>
                <label className="space-y-1"><span className="text-slate-500">Unit purchase cost</span><input type="number" min="0" step="0.0001" value={line.unitCost} onChange={(e) => updateLine(line.rowKey, { unitCost: e.target.value })} className="w-full rounded-md border border-slate-200 p-2" /></label>
              </div>
              {!line.variantId && <div className="rounded-md bg-slate-50 p-3 space-y-2"><div className="text-xs font-medium text-slate-800">Create new product after review</div><div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><label className="text-[11px] text-slate-500">Product name<input value={line.productName} onChange={(e) => updateLine(line.rowKey, { productName: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Variant name<input value={line.newVariant} onChange={(e) => updateLine(line.rowKey, { newVariant: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">SKU<input value={line.newSku} onChange={(e) => updateLine(line.rowKey, { newSku: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Unit of measure<input value={line.newUnit} onChange={(e) => updateLine(line.rowKey, { newUnit: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Selling price (optional)<input type="number" min="0" step="0.01" value={line.newSellingPrice} onChange={(e) => updateLine(line.rowKey, { newSellingPrice: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label></div><button type="button" disabled={busy} onClick={() => void createNewProduct(line)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40">Approve and create product</button><p className="text-[10px] text-slate-500">This saves the new product and variant now; it does not add stock.</p></div>}
              {line.variantId && <div className="rounded-md bg-slate-50 p-3 space-y-2"><div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]"><span className="text-slate-600">Purchase cost: <strong className="text-slate-900">{formatPurchaseMoney(Number.isFinite(cost) ? cost : 0, invoiceCurrency)}</strong></span><span className="text-slate-600">Existing selling price: <strong className="text-slate-900">{formatPurchaseMoney(existingPrice, invoiceCurrency)}</strong></span><span className="text-slate-600">Suggested price: <strong className="text-slate-900">{suggested === null ? 'Not available' : formatPurchaseMoney(suggested, invoiceCurrency)}</strong></span>{suggested !== null && <span className="text-slate-600">Expected profit: <strong className="text-slate-900">{formatPurchaseMoney(suggested - cost, invoiceCurrency)} ({suggested > 0 ? (((suggested - cost) / suggested) * 100).toFixed(1) : '0.0'}% margin)</strong></span>}</div><div className="flex flex-wrap items-end gap-2"><label className="text-[11px] text-slate-500">Custom selling price<input type="number" min="0" step="0.01" value={line.newSellingPrice || (suggested === null ? '' : suggested.toFixed(2))} onChange={(e) => updateLine(line.rowKey, { newSellingPrice: e.target.value })} className="mt-1 block w-36 rounded border border-slate-200 bg-white p-2 text-xs" /></label><button type="button" disabled={busy || !line.newSellingPrice.trim()} onClick={() => void applySellingPrice(line, Number(line.newSellingPrice || suggested))} className="rounded-md bg-white border border-slate-300 px-3 py-2 text-[11px] font-medium text-slate-700 disabled:opacity-40">Apply price (explicit)</button></div><p className="text-[10px] text-slate-500">No selling price changes unless you press Apply price. Leaving it untouched preserves the current price.</p></div>}
            </div>;
          })}
          <div className="flex flex-wrap items-center gap-3 text-xs"><label className="space-y-1"><span className="text-slate-500">Pricing method</span><select value={pricingMethod} onChange={(e) => setPricingMethod(e.target.value as 'markup' | 'margin')} className="block rounded-md border border-slate-200 p-2"><option value="markup">Markup on cost</option><option value="margin">Gross margin</option></select></label><label className="space-y-1"><span className="text-slate-500">{pricingMethod === 'markup' ? 'Markup %' : 'Gross margin %'}</span><input type="number" min="0" max={pricingMethod === 'margin' ? 99.99 : 1000} step="0.5" value={pricingPercent} onChange={(e) => setPricingPercent(e.target.value)} className="block w-28 rounded-md border border-slate-200 p-2" /></label><span className="text-[11px] text-slate-500 self-end pb-2">{pricingMethod === 'markup' ? 'Cost × (1 + markup)' : 'Cost ÷ (1 − margin)'}</span></div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4 text-xs"><div className="space-y-1 text-slate-600"><div>Calculated line subtotal: <strong>{formatPurchaseMoney(lineSubtotal, invoiceCurrency)}</strong></div><div>Purchase total before delivery: <strong>{formatPurchaseMoney(calculatedTotal, invoiceCurrency)}</strong></div>{Number(delivery) > 0 && <div className="text-amber-700">Delivery charges are retained in invoice notes; the current purchase model does not store them as a separate cost field.</div>}</div><button type="button" disabled={busy || !scan || scan.status !== 'ready' || Boolean(duplicate) || currencyMismatch || lines.length === 0} onClick={() => void createPurchaseDraft()} className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" /> Create purchase draft</button></div>
          {createdPurchaseId && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><strong>Purchase draft created.</strong> The invoice is attached. No stock or payment was recorded. Open Purchases to confirm the order, then use Receive Goods to record only the quantities actually accepted. <span className="font-mono">{createdPurchaseId}</span><button type="button" onClick={() => { window.location.hash = '#/purchases'; }} className="ml-2 underline font-semibold">Open Purchases</button></div>}
        </section>
      )}
    </div>
  );
}
) return fallback.toUpperCase() === 'USD' ? 'USD' : raw;
  if (raw === '£') return 'GBP';
  if (raw === '€') return 'EUR';
  return raw;
}
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function numericText(value: unknown, fallback = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;
}
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function bestVariantMatch(line: Record<string, unknown>, variants: PurchaseCatalogVariant[]): PurchaseCatalogVariant | null {
  const sku = cleanText(line.sku).toLowerCase();
  const name = normalize(cleanText(line.product_name));
  const barcode = cleanText(line.barcode);
  const variant = normalize(cleanText(line.variant));
  if (barcode) {
    const exactBarcode = variants.find((item) => (item.barcode ?? '').trim() === barcode);
    if (exactBarcode) return exactBarcode;
  }
  if (sku) {
    const exactSku = variants.find((item) => item.sku.trim().toLowerCase() === sku);
    if (exactSku) return exactSku;
  }
  const exact = variants.find((item) =>
    normalize(item.productName) === name &&
    (!variant || normalize(item.variantName) === variant)
  );
  return exact ?? null;
}
function suggestedPrice(cost: number, method: 'markup' | 'margin', percent: number): number | null {
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(percent) || percent < 0) return null;
  if (method === 'markup') return cost * (1 + percent / 100);
  if (percent >= 100) return null;
  return cost / (1 - percent / 100);
}

export function InvoiceScannerPanel({
  organisationId,
  currencyCode,
  canManage,
}: {
  organisationId: string | null;
  currencyCode: string;
  canManage: boolean;
}) {
  const [referenceData, setReferenceData] = useState<PurchaseReferenceData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'extracting' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [invoiceCurrency, setInvoiceCurrency] = useState(currencyCode);
  const [subtotal, setSubtotal] = useState('');
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [delivery, setDelivery] = useState('0');
  const [grandTotal, setGrandTotal] = useState('');
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [pricingMethod, setPricingMethod] = useState<'markup' | 'margin'>('markup');
  const [pricingPercent, setPricingPercent] = useState('20');
  const [createdPurchaseId, setCreatedPurchaseId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ purchase_number: string; status: string } | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);

  useEffect(() => {
    let active = true;
    if (!organisationId || !canManage) {
      setReferenceData(null);
      return;
    }
    void fetchPurchaseReferenceData(organisationId).then((data) => {
      if (active) setReferenceData(data);
    });
    return () => { active = false; };
  }, [organisationId, canManage]);

  const suppliers = referenceData?.activeSuppliers ?? [];
  const variants = referenceData?.catalogVariants ?? [];
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const lineSubtotal = useMemo(() => lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const cost = Number(line.unitCost);
    return sum + (Number.isFinite(quantity) && Number.isFinite(cost) ? quantity * cost : 0);
  }, 0), [lines]);
  const calculatedTotal = lineSubtotal - Math.max(0, Number(discount) || 0) + Math.max(0, Number(tax) || 0);
  const totalDifference = grandTotal.trim() ? Math.abs((Number(grandTotal) || 0) - calculatedTotal) : 0;
  const currencyMismatch = Boolean(invoiceCurrency.trim()) &&
    invoiceCurrency.trim().toUpperCase() !== currencyCode.trim().toUpperCase();

  const resetScan = () => {
    setFile(null); setScan(null); setPreviewUrl(''); setError(null); setStage('idle');
    setSupplierId(''); setInvoiceNumber(''); setInvoiceDate(''); setDueDate('');
    setInvoiceCurrency(currencyCode); setSubtotal(''); setDiscount('0'); setTax('0');
    setDelivery('0'); setGrandTotal(''); setLines([]); setCreatedPurchaseId(null);
    setDuplicate(null);
  };

  const applyExtraction = (data: ExtractedInvoice) => {
    setInvoiceNumber(cleanText(data.invoice_number));
    setInvoiceDate(cleanText(data.invoice_date));
    setDueDate(cleanText(data.due_date));
    setInvoiceCurrency(cleanText(data.currency) || currencyCode);
    setSubtotal(numericText(data.subtotal));
    setDiscount(numericText(data.discount_amount, '0'));
    setTax(numericText(data.tax_amount, '0'));
    setDelivery(numericText(data.delivery_charges, '0'));
    setGrandTotal(numericText(data.grand_total));
    const supplierName = cleanText(data.supplier?.name);
    const supplierMatch = suppliers.find((supplier) => normalize(supplier.name) === normalize(supplierName))
      ?? suppliers.find((supplier) => normalize(supplier.name).includes(normalize(supplierName)) || normalize(supplierName).includes(normalize(supplier.name)));
    setSupplierId(supplierMatch?.id ?? '');
    setLines((data.line_items ?? []).map((raw, index) => {
      const match = bestVariantMatch(raw, variants);
      return {
        rowKey: `invoice-line-${index}-${Date.now()}`,
        productName: cleanText(raw.product_name) || 'Unclear product name',
        description: cleanText(raw.description),
        sku: cleanText(raw.sku),
        variant: cleanText(raw.variant),
        quantity: numericText(raw.quantity, '1'),
        unit: cleanText(raw.unit_of_measure) || 'piece',
        unitCost: numericText(raw.unit_cost),
        discount: typeof raw.discount === 'number' ? raw.discount : null,
        tax: typeof raw.tax === 'number' ? raw.tax : null,
        lineTotal: typeof raw.line_total === 'number' ? raw.line_total : null,
        confidence: cleanText(raw.confidence) || 'low',
        variantId: match?.variantId ?? '',
        newSku: cleanText(raw.sku),
        newVariant: cleanText(raw.variant) || 'Default',
        newUnit: cleanText(raw.unit_of_measure) || 'piece',
        newSellingPrice: '',
      };
    }));
  };

  const processExistingScan = async (scanId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Veyora is not connected to the database.');
    setStage('extracting');
    const { data, error: invokeError } = await supabase.functions.invoke('scan-supplier-invoice', {
      body: { scan_id: scanId },
    });
    if (invokeError) throw new Error(invokeError.message || 'Invoice extraction failed.');
    if (data?.error) throw new Error(String(data.error));
    const extracted = data?.extracted_data as ExtractedInvoice | undefined;
    if (!extracted || !Array.isArray(extracted.line_items)) throw new Error('The scan did not return readable invoice line items.');
    const { data: saved, error: readError } = await supabase.from('invoice_scans')
      .select('id,file_path,status,extracted_data,error_message').eq('id', scanId).single();
    if (readError || !saved) throw new Error(readError?.message || 'Could not load the saved invoice scan.');
    setScan(saved as ScanRow);
    applyExtraction(extracted);
    const { data: signed, error: signedError } = await supabase.storage.from('invoice-documents')
      .createSignedUrl(saved.file_path, 60 * 30);
    if (!signedError && signed?.signedUrl) setPreviewUrl(signed.signedUrl);
    setStage('idle');
  };

  const handleUploadAndScan = async () => {
    if (!organisationId || !file || !canManage) return;
    if (!ACCEPTED_MIME.has(file.type)) { setError('Choose a JPG, PNG, WebP image or PDF invoice.'); return; }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) { setError('The invoice must be smaller than 15 MB.'); return; }
    const supabase = getSupabaseClient();
    if (!supabase) { setError('Veyora is not connected to the database.'); return; }
    setBusy(true); setError(null); setCreatedPurchaseId(null);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) { setBusy(false); setError('Sign in again before scanning an invoice.'); return; }
    const scanId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'supplier-invoice';
    const filePath = `${organisationId}/invoices/${scanId}/${safeName}`;
    try {
      setStage('uploading');
      const { error: uploadError } = await supabase.storage.from('invoice-documents').upload(filePath, file, {
        contentType: file.type, upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { error: insertError } = await supabase.from('invoice_scans').insert({
        id: scanId, organization_id: organisationId, uploaded_by: userData.user.id,
        file_path: filePath, file_name: file.name, mime_type: file.type, file_size: file.size,
      });
      if (insertError) {
        await supabase.storage.from('invoice-documents').remove([filePath]);
        throw new Error(insertError.message);
      }
      setScan({ id: scanId, file_path: filePath, status: 'uploaded', extracted_data: {}, error_message: null });
      await processExistingScan(scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invoice scanning failed. Try again.');
      setStage('idle');
      const { data: row } = await supabase.from('invoice_scans')
        .select('id,file_path,status,extracted_data,error_message').eq('id', scanId).maybeSingle();
      if (row) setScan(row as ScanRow);
    } finally {
      setBusy(false); setStage('idle');
    }
  };

  const retryScan = async () => {
    if (!scan || !organisationId) return;
    setBusy(true); setError(null);
    try { await processExistingScan(scan.id); }
    catch (err) { setError(err instanceof Error ? err.message : 'Retry failed.'); }
    finally { setBusy(false); setStage('idle'); }
  };

  const updateLine = (rowKey: string, patch: Partial<InvoiceLine>) => {
    setLines((current) => current.map((line) => line.rowKey === rowKey ? { ...line, ...patch } : line));
  };

  const createNewProduct = async (line: InvoiceLine) => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId) return;
    const cost = Number(line.unitCost);
    if (!line.productName.trim() || !line.newVariant.trim() || !line.newUnit.trim() || !Number.isFinite(cost) || cost < 0) {
      setError('Complete the new product name, variant, unit and purchase cost first.');
      return;
    }
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('invoice_scanner_create_product_variant', {
      p_organization_id: organisationId,
      p_product_name: line.productName,
      p_description: line.description || null,
      p_variant_name: line.newVariant,
      p_sku: line.newSku || null,
      p_barcode: null,
      p_unit_of_measure: line.newUnit,
      p_cost_price: cost,
      p_selling_price: Math.max(0, Number(line.newSellingPrice) || 0),
      p_attributes: {},
    });
    if (rpcError || !data) {
      setError(rpcError?.message || 'The new product could not be created.');
    } else {
      updateLine(line.rowKey, { variantId: String(data) });
      const refreshed = await fetchPurchaseReferenceData(organisationId);
      setReferenceData(refreshed);
    }
    setBusy(false);
  };

  const applySellingPrice = async (line: InvoiceLine, price: number) => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !line.variantId || !Number.isFinite(price) || price < 0) return;
    setBusy(true); setError(null);
    const { error: updateError } = await supabase.from('product_variants')
      .update({ selling_price: price })
      .eq('organization_id', organisationId).eq('id', line.variantId);
    if (updateError) setError(updateError.message);
    else setError(null);
    setBusy(false);
  };

  const checkDuplicate = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !supplierId || !invoiceNumber.trim()) { setDuplicate(null); return; }
    setDuplicateChecking(true);
    const { data } = await supabase.from('purchases')
      .select('purchase_number,status')
      .eq('organization_id', organisationId)
      .eq('supplier_id', supplierId)
      .eq('supplier_invoice_number', invoiceNumber.trim())
      .neq('status', 'cancelled')
      .limit(1).maybeSingle();
    setDuplicate(data ?? null);
    setDuplicateChecking(false);
  };

  const createPurchaseDraft = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !organisationId || !scan) return;
    if (!supplierId) { setError('Select the supplier before creating a purchase draft.'); return; }
    if (!invoiceNumber.trim()) { setError('Enter the supplier invoice number or confirm that it is missing.'); return; }
    if (currencyMismatch) { setError('The invoice currency differs from the organisation currency. Resolve this before creating the purchase.'); return; }
    if (lines.length === 0 || lines.some((line) => !line.variantId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !line.unitCost.trim() || !Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0)) {
      setError('Match or create every product and enter a valid quantity and purchase cost before continuing.');
      return;
    }
    if (duplicate) { setError('A possible duplicate purchase exists. Review it in Purchases before continuing.'); return; }
    setBusy(true); setError(null); setStage('saving');
    const notes = [
      'Created from reviewed AI invoice scan.',
      scan.extracted_data.purchase_order_reference ? `Supplier PO reference: ${scan.extracted_data.purchase_order_reference}` : '',
      Number(delivery) > 0 ? `Invoice delivery/additional charges: ${invoiceCurrency} ${delivery} (retained from invoice; not added to stock cost).` : '',
      'The original supplier invoice is attached in the Invoice Scanner record.',
      lines.some((line) => line.discount !== null || line.tax !== null) ? 'Line-level discounts and taxes are preserved in the invoice scan details; purchase items use the Veyora purchase workflow unit-cost fields.' : '',
      scan.extracted_data.warnings?.length ? `Invoice review warnings: ${scan.extracted_data.warnings.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    const { data, error: rpcError } = await supabase.rpc('invoice_scanner_create_purchase_draft', {
      p_organization_id: organisationId,
      p_scan_id: scan.id,
      p_supplier_id: supplierId,
      p_items: lines.map((line) => ({ variant_id: line.variantId, quantity: Number(line.quantity), unit_cost: Number(line.unitCost) })),
      p_discount_amount: Math.max(0, Number(discount) || 0),
      p_tax_amount: Math.max(0, Number(tax) || 0),
      p_supplier_invoice_number: invoiceNumber.trim(),
      p_expected_delivery_date: null,
      p_due_date: dueDate || null,
      p_invoice_date: invoiceDate || null,
      p_currency: invoiceCurrency.trim().toUpperCase(),
      p_notes: notes,
    });
    if (rpcError || !data) setError(rpcError?.message || 'The purchase draft could not be created.');
    else setCreatedPurchaseId(String(data));
    setBusy(false); setStage('idle');
  };

  const addManualLine = () => setLines((current) => [...current, {
    rowKey: `manual-${Date.now()}`, productName: '', description: '', sku: '', variant: '',
    quantity: '1', unit: 'piece', unitCost: '', discount: null, tax: null, lineTotal: null,
    confidence: 'manual', variantId: '', newSku: '', newVariant: 'Default', newUnit: 'piece', newSellingPrice: '0',
  }]);

  if (!canManage) return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Invoice scanning is available to Owners, Admins and Managers.</div>;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ScanLine className="h-4 w-4 text-blue-700" /> AI Invoice Scanner</div>
            <p className="mt-1 text-xs text-slate-500 max-w-2xl">Upload or photograph a supplier invoice. Veyora extracts the details and prepares a purchase draft for your review. Scanning never adds stock or records a payment.</p>
          </div>
          {scan && !createdPurchaseId && <button type="button" onClick={resetScan} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"><X className="h-3.5 w-3.5" /> Cancel scan</button>}
        </div>
        {!scan && (
          <div className="rounded-md border-2 border-dashed border-slate-200 bg-slate-50/70 p-5 text-center">
            <Upload className="mx-auto h-6 w-6 text-slate-400" />
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800">
              <FileImage className="h-4 w-4" /> Choose invoice / use camera
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <p className="mt-2 text-[11px] text-slate-500">JPG, PNG, WebP or multi-page PDF · Up to 15 MB</p>
            {file && <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-700"><FileText className="h-4 w-4" />{file.name}<span className="text-slate-400">({(file.size / 1024 / 1024).toFixed(2)} MB)</span></div>}
            <button type="button" disabled={!file || busy || !organisationId || !referenceData} onClick={() => void handleUploadAndScan()} className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />} Scan invoice
            </button>
          </div>
        )}
        {busy && <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{stage === 'uploading' ? 'Uploading securely…' : stage === 'extracting' ? 'Reading invoice pages and extracting details…' : 'Preparing the purchase draft…'}</div>}
        {error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
        {scan && scan.status !== 'ready' && scan.status !== 'linked' && scan.status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void retryScan()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700"><RefreshCw className="h-3.5 w-3.5" /> Retry extraction</button>}
      </section>

      {scan && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5">
          <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800">Original invoice</div>
            {previewUrl ? (file?.type === 'application/pdf' || scan.file_path.toLowerCase().endsWith('.pdf') ? <iframe title="Original supplier invoice" src={previewUrl} className="h-[520px] w-full" /> : <img src={previewUrl} alt="Original supplier invoice" className="max-h-[520px] w-full object-contain bg-slate-50" />) : <div className="p-6 text-xs text-slate-500">Secure preview is not available.</div>}
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">Review invoice details</h2><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">AI extracted · editable</span></div>
            {scan.extracted_data.warnings?.length ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Review needed</strong><ul className="mt-1 list-disc pl-4">{scan.extracted_data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div> : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1"><span className="text-slate-500">Supplier <span className="text-rose-600">*</span></span><select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setDuplicate(null); }} className="w-full rounded-md border border-slate-200 p-2"><option value="">Select existing supplier</option>{suppliers.map((supplier: SupplierRecord) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label className="space-y-1"><span className="text-slate-500">Supplier invoice number</span><input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} onBlur={() => void checkDuplicate()} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice date</span><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice currency</span><input value={invoiceCurrency} onChange={(e) => setInvoiceCurrency(e.target.value.toUpperCase())} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice subtotal</span><input type="number" min="0" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Discount</span><input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Tax</span><input type="number" min="0" value={tax} onChange={(e) => setTax(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Delivery / extra charges</span><input type="number" min="0" value={delivery} onChange={(e) => setDelivery(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
              <label className="space-y-1"><span className="text-slate-500">Invoice grand total</span><input type="number" min="0" value={grandTotal} onChange={(e) => setGrandTotal(e.target.value)} className="w-full rounded-md border border-slate-200 p-2" /></label>
            </div>
            {duplicateChecking && <p className="text-[11px] text-slate-500">Checking for duplicate invoice…</p>}
            {duplicate && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"><strong>Possible duplicate:</strong> {duplicate.purchase_number} ({duplicate.status}). Review the existing purchase before creating another.</div>}
            {currencyMismatch && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Invoice currency differs from this workspace ({currencyCode}). The purchase cannot be created until the currency issue is resolved.</div>}
            {grandTotal.trim() && totalDifference > 0.01 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Invoice total differs from the current line calculation by {formatPurchaseMoney(totalDifference, invoiceCurrency)}. Veyora will not silently adjust the values.</div>}
          </section>
        </div>
      )}

      {scan && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Invoice line items</h2><p className="mt-1 text-xs text-slate-500">Choose the exact variant for each line. Similar names are not treated as confirmed matches.</p></div><button type="button" onClick={addManualLine} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700"><Plus className="h-3.5 w-3.5" /> Add missing item</button></div>
          {lines.map((line) => {
            const match = variants.find((variant) => variant.variantId === line.variantId);
            const cost = Number(line.unitCost);
            const suggested = suggestedPrice(cost, pricingMethod, Number(pricingPercent));
            const existingPrice = match?.defaultSellingPrice ?? 0;
            return <div key={line.rowKey} className="rounded-md border border-slate-200 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-xs font-semibold text-slate-900">{line.productName || 'New line item'}</div><div className="mt-1 text-[10px] text-slate-500">{line.sku ? `SKU ${line.sku} · ` : ''}{line.confidence === 'high' ? 'High extraction confidence' : line.confidence === 'medium' ? 'Check extracted details' : 'Needs manual review'}</div></div><button type="button" onClick={() => setLines((current) => current.filter((item) => item.rowKey !== line.rowKey))} aria-label="Remove invoice line" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                <label className="space-y-1 sm:col-span-2"><span className="text-slate-500">Match existing product / variant</span><select value={line.variantId} onChange={(e) => updateLine(line.rowKey, { variantId: e.target.value })} className="w-full rounded-md border border-slate-200 p-2"><option value="">No match — create new product below</option>{variants.map((variant) => <option key={variant.variantId} value={variant.variantId}>{variant.productName} · {variant.variantName}{variant.sku ? ` · ${variant.sku}` : ''}</option>)}</select></label>
                <label className="space-y-1"><span className="text-slate-500">Quantity</span><input type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(e) => updateLine(line.rowKey, { quantity: e.target.value })} className="w-full rounded-md border border-slate-200 p-2" /></label>
                <label className="space-y-1"><span className="text-slate-500">Unit purchase cost</span><input type="number" min="0" step="0.0001" value={line.unitCost} onChange={(e) => updateLine(line.rowKey, { unitCost: e.target.value })} className="w-full rounded-md border border-slate-200 p-2" /></label>
              </div>
              {!line.variantId && <div className="rounded-md bg-slate-50 p-3 space-y-2"><div className="text-xs font-medium text-slate-800">Create new product after review</div><div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><label className="text-[11px] text-slate-500">Product name<input value={line.productName} onChange={(e) => updateLine(line.rowKey, { productName: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Variant name<input value={line.newVariant} onChange={(e) => updateLine(line.rowKey, { newVariant: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">SKU<input value={line.newSku} onChange={(e) => updateLine(line.rowKey, { newSku: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Unit of measure<input value={line.newUnit} onChange={(e) => updateLine(line.rowKey, { newUnit: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label><label className="text-[11px] text-slate-500">Selling price (optional)<input type="number" min="0" step="0.01" value={line.newSellingPrice} onChange={(e) => updateLine(line.rowKey, { newSellingPrice: e.target.value })} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs" /></label></div><button type="button" disabled={busy} onClick={() => void createNewProduct(line)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40">Approve and create product</button><p className="text-[10px] text-slate-500">This saves the new product and variant now; it does not add stock.</p></div>}
              {line.variantId && <div className="rounded-md bg-slate-50 p-3 space-y-2"><div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]"><span className="text-slate-600">Purchase cost: <strong className="text-slate-900">{formatPurchaseMoney(Number.isFinite(cost) ? cost : 0, invoiceCurrency)}</strong></span><span className="text-slate-600">Existing selling price: <strong className="text-slate-900">{formatPurchaseMoney(existingPrice, invoiceCurrency)}</strong></span><span className="text-slate-600">Suggested price: <strong className="text-slate-900">{suggested === null ? 'Not available' : formatPurchaseMoney(suggested, invoiceCurrency)}</strong></span>{suggested !== null && <span className="text-slate-600">Expected profit: <strong className="text-slate-900">{formatPurchaseMoney(suggested - cost, invoiceCurrency)} ({suggested > 0 ? (((suggested - cost) / suggested) * 100).toFixed(1) : '0.0'}% margin)</strong></span>}</div><div className="flex flex-wrap items-end gap-2"><label className="text-[11px] text-slate-500">Custom selling price<input type="number" min="0" step="0.01" value={line.newSellingPrice || (suggested === null ? '' : suggested.toFixed(2))} onChange={(e) => updateLine(line.rowKey, { newSellingPrice: e.target.value })} className="mt-1 block w-36 rounded border border-slate-200 bg-white p-2 text-xs" /></label><button type="button" disabled={busy || !line.newSellingPrice.trim()} onClick={() => void applySellingPrice(line, Number(line.newSellingPrice || suggested))} className="rounded-md bg-white border border-slate-300 px-3 py-2 text-[11px] font-medium text-slate-700 disabled:opacity-40">Apply price (explicit)</button></div><p className="text-[10px] text-slate-500">No selling price changes unless you press Apply price. Leaving it untouched preserves the current price.</p></div>}
            </div>;
          })}
          <div className="flex flex-wrap items-center gap-3 text-xs"><label className="space-y-1"><span className="text-slate-500">Pricing method</span><select value={pricingMethod} onChange={(e) => setPricingMethod(e.target.value as 'markup' | 'margin')} className="block rounded-md border border-slate-200 p-2"><option value="markup">Markup on cost</option><option value="margin">Gross margin</option></select></label><label className="space-y-1"><span className="text-slate-500">{pricingMethod === 'markup' ? 'Markup %' : 'Gross margin %'}</span><input type="number" min="0" max={pricingMethod === 'margin' ? 99.99 : 1000} step="0.5" value={pricingPercent} onChange={(e) => setPricingPercent(e.target.value)} className="block w-28 rounded-md border border-slate-200 p-2" /></label><span className="text-[11px] text-slate-500 self-end pb-2">{pricingMethod === 'markup' ? 'Cost × (1 + markup)' : 'Cost ÷ (1 − margin)'}</span></div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4 text-xs"><div className="space-y-1 text-slate-600"><div>Calculated line subtotal: <strong>{formatPurchaseMoney(lineSubtotal, invoiceCurrency)}</strong></div><div>Purchase total before delivery: <strong>{formatPurchaseMoney(calculatedTotal, invoiceCurrency)}</strong></div>{Number(delivery) > 0 && <div className="text-amber-700">Delivery charges are retained in invoice notes; the current purchase model does not store them as a separate cost field.</div>}</div><button type="button" disabled={busy || !scan || scan.status !== 'ready' || Boolean(duplicate) || currencyMismatch || lines.length === 0} onClick={() => void createPurchaseDraft()} className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:opacity-40"><CheckCircle2 className="h-4 w-4" /> Create purchase draft</button></div>
          {createdPurchaseId && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><strong>Purchase draft created.</strong> The invoice is attached. No stock or payment was recorded. Open Purchases to confirm the order, then use Receive Goods to record only the quantities actually accepted. <span className="font-mono">{createdPurchaseId}</span><button type="button" onClick={() => { window.location.hash = '#/purchases'; }} className="ml-2 underline font-semibold">Open Purchases</button></div>}
        </section>
      )}
    </div>
  );
}

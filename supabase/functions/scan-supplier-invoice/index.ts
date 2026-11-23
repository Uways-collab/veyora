import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MODEL = 'gemini-2.5-flash';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

function matchesFileSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'application/pdf') return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mimeType === 'image/webp') return bytes.length >= 12 &&
    new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  return false;
}

function invoicePrompt() {
  return `Read this supplier invoice carefully. Extract only information visibly present.
Do not guess missing values. Use null for missing or unreadable fields. Keep all amounts numeric
without currency symbols. Return one JSON object with this exact structure:
{
 "supplier":{"name":string|null,"contact_person":string|null,"email":string|null,"phone":string|null,"address":string|null,"tax_number":string|null},
 "invoice_number":string|null,"invoice_date":"YYYY-MM-DD"|null,"due_date":"YYYY-MM-DD"|null,
 "purchase_order_reference":string|null,"currency":string|null,"subtotal":number|null,
 "discount_amount":number|null,"tax_amount":number|null,"delivery_charges":number|null,
 "grand_total":number|null,
 "line_items":[{"product_name":string|null,"description":string|null,"sku":string|null,
 "barcode":string|null,"brand":string|null,"variant":string|null,"size":string|null,
 "quantity":number|null,"unit_of_measure":string|null,"unit_cost":number|null,
 "discount":number|null,"tax":number|null,"line_total":number|null,
 "confidence":"high"|"medium"|"low","warnings":string[]}],
 "warnings":string[]
}
Use the invoice's printed currency code or symbol when unambiguous. Do not calculate missing totals.
Preserve the supplier's own unit costs; do not infer selling prices. Include every visible line item.
For multi-page documents, combine all pages and do not duplicate repeated headers or totals.
If text is unclear, set that field to null and add a short warning.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: {
    'Access-Control-Allow-Origin': req.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }});
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Sign in before scanning an invoice' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'Supabase function configuration is incomplete' }, 500);
  if (!geminiKey) return json({ error: 'AI scanning is not configured yet. Add GEMINI_API_KEY to the Edge Function secrets.' }, 503);

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'Your session is invalid or expired' }, 401);

  let body: { scan_id?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Request body must be valid JSON' }, 400); }
  const scanId = typeof body.scan_id === 'string' ? body.scan_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
    return json({ error: 'A valid invoice scan is required' }, 400);
  }

  const { data: scan, error: scanError } = await supabase
    .from('invoice_scans')
    .select('id,organization_id,file_path,file_name,mime_type,file_size,status')
    .eq('id', scanId).maybeSingle();
  if (scanError || !scan) return json({ error: 'Invoice scan not found in the active organisation' }, 404);
  if (!MIME_TYPES.has(scan.mime_type) || scan.file_size > MAX_BYTES) return json({ error: 'This file type or size is not supported' }, 400);
  if (!scan.file_path.startsWith(`${scan.organization_id}/invoices/`)) return json({ error: 'Invoice file path is invalid' }, 400);
  if (scan.status === 'linked' || scan.status === 'cancelled') return json({ error: 'This invoice scan can no longer be processed' }, 409);

  await supabase.from('invoice_scans').update({ status: 'processing', error_message: null, updated_at: new Date().toISOString() }).eq('id', scanId);

  try {
    const { data: file, error: downloadError } = await supabase.storage.from('invoice-documents').download(scan.file_path);
    if (downloadError || !file) throw new Error('The private invoice file could not be opened');
    if (file.size > MAX_BYTES) throw new Error('Invoice file exceeds the 10 MB limit');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesFileSignature(bytes, scan.mime_type)) throw new Error('The file content does not match its declared invoice file type');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const base64 = btoa(binary);

    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: invoicePrompt() },
          { inline_data: { mime_type: scan.mime_type, data: base64 } },
        ] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    if (!aiResponse.ok) {
      const providerError = await aiResponse.text();
      throw new Error(`Invoice extraction provider returned ${aiResponse.status}: ${providerError.slice(0, 500)}`);
    }
    const aiPayload = await aiResponse.json();
    const text = aiPayload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('');
    if (typeof text !== 'string' || !text.trim()) throw new Error('The AI returned an empty extraction');
    const extracted = JSON.parse(text);
    if (!extracted || typeof extracted !== 'object' || !Array.isArray(extracted.line_items)) {
      throw new Error('The AI response did not contain a valid invoice line-item list');
    }
    const { error: saveError } = await supabase.from('invoice_scans').update({
      status: 'ready',
      extracted_data: extracted,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq('id', scanId);
    if (saveError) throw new Error('Invoice was read but the extracted details could not be saved');
    return json({ scan_id: scanId, status: 'ready', extracted_data: extracted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invoice processing failed';
    await supabase.from('invoice_scans').update({
      status: 'failed', error_message: message.slice(0, 1000), updated_at: new Date().toISOString(),
    }).eq('id', scanId);
    return json({ error: message }, 422);
  }
});

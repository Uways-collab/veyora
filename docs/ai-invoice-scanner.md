# AI Invoice Scanner

## Components

- The Purchases workspace provides the invoice upload and review interface.
- Original files are stored in the private `invoice-documents` Storage bucket under `<organisation-id>/invoices/<scan-id>/...`.
- `public.invoice_scans` stores extraction state and the structured AI result, isolated by organisation RLS.
- `scan-supplier-invoice` downloads the private file with the caller's authenticated session and calls Gemini from the Supabase Edge Function. The browser never receives the Gemini key.
- `invoice_scanner_create_purchase_draft` checks the active organisation, currency, scan state and duplicate supplier invoice number in a transaction, then calls the existing `purchases_v1_create_draft` RPC. It links the invoice path to the resulting purchase.
- `invoice_scanner_create_product_variant` creates a new product and variant atomically only after the user explicitly approves it.
- Goods receiving remains the existing `purchases_v2_receive_goods` workflow. It records received, accepted and damaged quantities and adds stock only for accepted quantities. Finance continues to receive the existing purchase-receipt source event. Invoice scanning never creates a payment.

## Required configuration

Create a Gemini API key in Google AI Studio using a paid billing project, then set it in **Supabase Dashboard → Edge Functions → Secrets** as `GEMINI_API_KEY`. Do not paste the key into ChatGPT, Vite environment variables, browser code, Git, SQL, or client-side configuration. Supabase loads new Edge Function secrets without requiring a redeploy.

The `scan-supplier-invoice` Edge Function is deployed and JWT verification is enabled. The database migrations are applied. If `GEMINI_API_KEY` is not already present, add it before attempting a live extraction.

If the secret is missing, the scanner returns a configuration error and does not create a purchase. A failed extraction can be retried from the review screen.

## Model and costs

- Provider: Google Gemini Developer API
- Model: `gemini-2.5-flash`
- Standard paid-tier list price checked on 23 November 2026: US$0.30 per 1 million input tokens (text/image/video) and US$2.50 per 1 million output tokens.
- Example only: 10,000 input tokens plus 1,000 output tokens is about US$0.0055. A multi-page invoice can use more tokens; actual cost is shown by Gemini usage billing.
- Image and PDF input is billed by token usage, so invoice cost varies with page count, resolution and extraction response size. There is no fixed per-invoice price. Uploads are capped at 10 MB to stay within the inline request-size budget.
- Use a paid-tier API project for supplier documents. Do not use the free tier for confidential business invoices.
- No search grounding is used. No AI-generated selling price is written automatically.

Pricing reference: https://ai.google.dev/gemini-api/docs/pricing

Data-use terms: https://ai.google.dev/gemini-api/terms. Paid Gemini API prompts, uploaded invoice files and responses are not used to improve Google's products, but Google may retain them for a limited period for abuse prevention and legal/regulatory requirements. Unpaid API use may be used to improve Google products and may involve human review; it is prohibited for confidential invoices in this design.

## Safety rules

- The full uploaded invoice document is sent to the Google Gemini paid API for extraction; supplier contact details printed on the invoice are therefore visible to that provider. No customer records, product catalogue or unrelated organisation data are sent.
- The model extracts fields only. It cannot create products, purchases, stock movements, supplier payments or journal entries.
- Unknown or unreadable fields are returned as null and must be reviewed.
- Exact SKU, barcode and name/variant matches can be preselected; uncertain items remain unmatched for manual selection.
- A new product requires a separate user approval.
- Existing selling prices are read for comparison only. A user must explicitly apply a suggested/custom price.
- A purchase draft requires an existing supplier and valid product variants. Invoice currency must match the organisation currency because the existing purchase schema does not support foreign-currency conversion.
- Purchase creation is protected by an organisation/supplier/invoice-number lock and a unique invoice-number claim. A purchase-table trigger enforces the claim for all new purchase creation paths. Existing historical purchase rows are not rewritten. Possible duplicates with the same supplier, invoice date and total require an explicit user override after review.
- The original file remains private and is linked to the purchase through `purchases.invoice_document_path`.

## Current schema limitations

The current purchase item model stores ordered quantity, unit cost and line total; it does not have dedicated per-line discount, tax or delivery-charge fields. The full extraction (including per-line values and delivery charges) remains attached to the invoice scan, and delivery charges are noted on the purchase. Header discount and tax use the existing purchase fields. The existing Finance receipt posting values accepted physical quantities at purchase-item unit cost and prorates the header discount; delivery charges are not capitalised. Non-zero purchase tax remains pending in Finance until the existing tax treatment is configured. Do not treat the current purchase total as a complete allocation of line-level discounts or delivery charges.

Supplier contact details extracted from the invoice are review information; the scanner does not silently create or update supplier master records. If the supplier is new, create/review the supplier in the existing Suppliers workspace first.

The scanner prepares a purchase draft only. The user must confirm the purchase and separately record the actual goods received. The existing deferred receipt trigger sends the receipt to the existing Finance source-event workflow; accepted quantities are used, and missing tax/account configuration remains pending with the existing Finance error reason. A scan alone never changes stock, posts a journal or creates a payment.

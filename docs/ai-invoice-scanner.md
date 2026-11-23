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

Set `GEMINI_API_KEY` as a Supabase Edge Function secret. Do not add it to Vite environment variables, browser code, Git, SQL, or client-side configuration.

Deploy the `scan-supplier-invoice` Edge Function with JWT verification enabled. Apply the accompanying database migration before enabling the scanner in a live environment.

If the secret is missing, the scanner returns a configuration error and does not create a purchase. A failed extraction can be retried from the review screen.

## Model and costs

- Provider: Google Gemini Developer API
- Model: `gemini-2.5-flash`
- Standard paid-tier list price at the time of implementation: US$0.30 per 1 million input tokens (text/image/video) and US$2.50 per 1 million output tokens.
- Image and PDF input is billed by token usage, so invoice cost varies with page count, resolution and extraction response size. There is no fixed per-invoice price.
- Use a paid-tier API project for supplier documents. Do not use the free tier for confidential business invoices.
- No search grounding is used. No AI-generated selling price is written automatically.

Pricing reference: https://ai.google.dev/gemini-api/docs/pricing

## Safety rules

- The model extracts fields only. It cannot create products, purchases, stock movements, supplier payments or journal entries.
- Unknown or unreadable fields are returned as null and must be reviewed.
- Exact SKU, barcode and name/variant matches can be preselected; uncertain items remain unmatched for manual selection.
- A new product requires a separate user approval.
- Existing selling prices are read for comparison only. A user must explicitly apply a suggested/custom price.
- A purchase draft requires an existing supplier and valid product variants. Invoice currency must match the organisation currency because the existing purchase schema does not support foreign-currency conversion.
- Purchase creation is protected by an organisation/supplier/invoice-number lock and a unique invoice-number claim. Existing historical purchase rows are not rewritten.
- The original file remains private and is linked to the purchase through `purchases.invoice_document_path`.

## Current schema limitations

The current purchase item model stores ordered quantity, unit cost and line total; it does not have dedicated per-line discount, tax or delivery-charge fields. The full extraction (including per-line values and delivery charges) remains attached to the invoice scan, and delivery charges are noted on the purchase. Header discount and tax use the existing purchase fields. Do not treat the current purchase total as a complete allocation of line-level discounts or delivery charges.

Supplier contact details extracted from the invoice are review information; the scanner does not silently create or update supplier master records. If the supplier is new, create/review the supplier in the existing Suppliers workspace first.

The scanner prepares a purchase draft only. The user must confirm the purchase and separately record the actual goods received. A scan alone never changes stock or Finance.

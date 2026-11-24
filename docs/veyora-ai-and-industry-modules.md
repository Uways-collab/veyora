# Veyora AI and industry modules

## AI assistant — first release

The first assistant release is read-only. It answers operational questions using a small, organisation-scoped summary assembled by the `veyora-ai-assistant` Edge Function.

### Context supplied to the model
- Organisation name and primary business model.
- Two consecutive 30-day sales comparisons (gross recorded sales, order count, refunds and returns shown separately), plus product/variant demand comparisons from up to 5,000 sale lines.
- Active product and customer counts.
- Low-stock balance count and up to 20 low-stock product/variant names, SKUs, on-hand quantities and reorder levels where the query is available.

The function may send product/variant names and SKUs for low-stock recommendations. It does not send customer names, phone numbers, emails, supplier contacts, payment credentials, invoice images, or individual transaction records to the model.

### Security boundaries
- The Edge Function requires a valid Supabase user session.
- It verifies the user's active membership in the requested organisation.
- Operational queries use the caller's JWT and therefore retain Supabase RLS.
- Gemini credentials and the Supabase secret/service key remain server-side.
- Usage token counts are written to `ai_usage_records`.
- The assistant cannot call business mutation RPCs or post financial entries.
- AI answers are advisory; users must verify figures in the source module.

### Required server configuration
- `GEMINI_API_KEY` as a Supabase Edge Function secret.
- A Supabase server-side secret key available to the Edge Function for usage metering.
- The Veyora commercial foundation migration applied so `ai_usage_records` exists.

Do not put provider or Supabase secret keys in Vite environment variables, browser code, GitHub source, or chat messages.

## Industry workflows

Veyora supports multiple business categories within one organisation. The first onboarding catalogue covers:

| Category | Specialist workflows |
|---|---|
| Retail & e-commerce | POS, product catalogue, stock, returns and online orders |
| Wholesale | Trade customers, tiered pricing, bulk orders and credit terms |
| Distribution | Warehouses, stock allocation, supplier procurement and replenishment |
| Professional services | Clients, service jobs, time/cost capture and invoicing |
| Hotels & hospitality | Rooms, reservations, guests, check-in/out and housekeeping |
| Car dealerships | Vehicle stock, leads, deal pipeline, deposits and service records |
| Real estate | Properties, units, tenants, leases, rent and maintenance |
| Restaurants | Menus, tables, orders, kitchen tickets and ingredient stock |
| Logistics & fleet | Vehicles, dispatch, deliveries, routes and proof of delivery |
| Manufacturing | Bills of materials, production orders, material consumption and finished goods |

The categories are selections, not automatic claims that every specialist workflow is already live. Each vertical must receive its own schema, role-aware UI, audit trail, reports and tests before its availability changes from planned to available.

## Planned AI capabilities

1. AI invoice and receipt extraction — invoice scanner already exists for supplier invoices.
2. Business assistant — first read-only release in this PR.
3. Inventory intelligence — demand patterns, low-stock explanations and reorder suggestions.
4. Sales intelligence — trend summaries, product performance and anomaly explanations.
5. Finance assistance — plain-language explanations of ledger reports and cash-flow trends, without autonomous posting.
6. Industry copilots — guest/housekeeping summaries, vehicle deal summaries, property/lease summaries, restaurant prep insights, delivery exception summaries and production variance explanations.

Forecasts and recommendations must show their date range, source coverage and uncertainty. No AI feature may silently change stock, prices, payments, accounting entries, reservations, leases or production records.

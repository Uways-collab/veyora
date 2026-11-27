# Paystack billing and seven-day free trial

## Trial experience

- Every newly created business workspace starts with a seven-day free trial automatically.
- The trial does not require a credit card, card verification, a refundable charge, or payment details.
- The trial uses the Premium feature entitlement so customers can evaluate the complete Veyora workspace.
- Existing workspaces without a subscription can start the same trial from Subscription & Billing. A workspace with an existing trial or subscription record cannot restart the trial.
- Trial expiry is enforced in the application and at the Supabase database boundary. Once `trial_ends_at` is reached, business reads and writes are blocked by the existing subscription RLS policies and write guards.
- Only the workspace Owner can manage billing. After expiry, the Owner can choose a paid plan; other members remain locked until Paystack confirms payment.

The database migration creates the trial subscription in the same transaction as workspace creation. It also removes the former card-verification requirement from the subscription access helpers. The browser never decides whether a payment succeeded.

## Paid subscription checkout

- The Owner chooses a monthly or annual plan and pays the full plan amount through Paystack Checkout.
- Checkout is initialized by the JWT-protected `paystack-billing` Edge Function.
- The `paystack-webhook` Edge Function verifies the signed webhook and then verifies the transaction directly with Paystack, including amount, currency, workspace and plan metadata.
- Workspace access is restored only after the signed webhook confirms a successful payment and the subscription record is activated.
- When Paystack returns a reusable authorization and the corresponding Paystack plan is synced, Veyora schedules recurring renewal for the end of the paid period. If recurring setup is unavailable after a successful charge, the paid period remains active and the Owner can renew manually.

## Safety defaults

Live billing remains disabled unless `PAYSTACK_ENABLE_LIVE_BILLING=true` is deliberately configured after test-mode checkout and webhook verification.

## Supabase Edge Function secrets

Set these in Supabase Dashboard → Edge Functions → Secrets. Never place secret keys in Vite/browser variables, GitHub source, or chat messages.

| Secret | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack API calls; use `sk_test_...` during testing |
| `PAYSTACK_WEBHOOK_SECRET` | Modern Paystack webhook signature secret (`whsec_...`) |
| `APP_BASE_URL` | HTTPS Veyora app URL used for checkout return |
| `PAYSTACK_ENABLE_LIVE_BILLING` | Must remain unset/false until production billing is explicitly approved |

The Supabase server-side secret/service-role key is read only by Edge Functions for trusted billing records. It is never returned to the browser.

## Paystack Dashboard

Register this URL in Paystack Dashboard → Developers → API configuration:

`https://xxeqgrrlainmwdcnpqvs.supabase.co/functions/v1/paystack-webhook`

Use the test-mode webhook signing secret first. The handler verifies Paystack's modern timestamped `Paystack-Signature` header and retains compatibility with the legacy signature header.

## Required test sequence before live mode

1. Configure Paystack test credentials and the webhook signing secret.
2. Apply the no-card seven-day trial migration to a non-production test database.
3. Create a test business workspace and confirm the Premium trial subscription is created with a start time and an end time exactly seven days later.
4. Confirm that no card-verification checkout or charge is initiated during signup or trial activation.
5. Test access before expiry and confirm business RLS reads and writes are allowed.
6. Test at and after expiry and confirm business data access is denied while the Owner can still reach Subscription & Billing.
7. Sync Paystack plans, complete a paid monthly checkout, and confirm the workspace is restored only after the signed webhook and server-side transaction verification.
8. Test annual checkout, duplicate webhook delivery, invalid signatures, failed payments, subscription renewal and cancellation.
9. Only after all tests pass should the Owner explicitly enable live billing.

## Important

A successful browser callback is not proof of payment. Veyora uses signed Paystack webhooks and server-side transaction verification as the source of truth. No card details or authorization codes are stored in Veyora's database.

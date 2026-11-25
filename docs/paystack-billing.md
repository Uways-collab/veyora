# Paystack billing integration

## What the billing release provides

- Owner-only plan synchronization to Paystack's plan API.
- 14-day trial checkout with card verification.
- A server-side webhook that verifies Paystack's modern `Paystack-Signature` header (timestamped HMAC-SHA512 using the `whsec_` signing secret), with compatibility for the deprecated `x-paystack-signature` header while Paystack still sends it.
- Server-side transaction verification before creating a recurring subscription.
- A subscription is created with its first debit date 14 days after card verification.
- The card-verification amount is refunded automatically. Veyora does not mark the trial active until the refund is confirmed by Paystack's `refund.processed` webhook.
- Idempotent webhook event storage, retry handling and subscription lifecycle updates.
- Billing transaction history and a Paystack-hosted subscription management link.

## Safety defaults

No Paystack charge can start until all of the following are explicitly configured:
- `PAYSTACK_SECRET_KEY` with a Paystack test key for testing.
- `PAYSTACK_WEBHOOK_SECRET` (the modern `whsec_` signing secret) or, temporarily, the legacy signature header verified with the Paystack secret key.
- `APP_BASE_URL` set to the HTTPS Veyora application origin.
- `PAYSTACK_CARD_VERIFICATION_AMOUNT_MINOR_UNITS` set to the approved amount in kobo. The code has no default verification charge.
- `PAYSTACK_CARD_VERIFICATION_DISCLOSURE` set to the exact customer-facing explanation of the temporary charge and refund.
- A successful Paystack plan sync.

The NGN transaction minimum documented by Paystack is ₦50 (5,000 kobo). Veyora refuses a lower configured verification amount. The Owner must still explicitly approve the amount and disclosure; no amount is preselected in code.

Live keys are additionally blocked unless `PAYSTACK_ENABLE_LIVE_BILLING=true` is deliberately configured after test-mode checkout, refund and webhook verification. Do not enable live billing before those tests pass.

## Supabase Edge Function secrets

Set these in Supabase Dashboard → Edge Functions → Secrets. Never place secret keys in Vite/browser variables, GitHub source, or chat messages.

| Secret | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack API calls; use `sk_test_...` during testing |
| `PAYSTACK_WEBHOOK_SECRET` | Modern Paystack webhook signature secret (`whsec_...`) |
| `APP_BASE_URL` | HTTPS Veyora app URL used for checkout return |
| `PAYSTACK_CARD_VERIFICATION_AMOUNT_MINOR_UNITS` | Explicitly approved verification amount in kobo |
| `PAYSTACK_CARD_VERIFICATION_DISCLOSURE` | Exact text displayed before checkout |
| `PAYSTACK_ENABLE_LIVE_BILLING` | Must remain unset/false until production is explicitly approved |

The Supabase server-side secret/service-role key is read only by Edge Functions for trusted billing records. It is never returned to the browser.

## Paystack Dashboard

After deploying `paystack-webhook`, register this URL in Paystack Dashboard → Developers → API configuration:

`https://xxeqgrrlainmwdcnpqvs.supabase.co/functions/v1/paystack-webhook`

Use the test-mode webhook signing secret first. Confirm that Paystack sends `Paystack-Signature`; until then, the handler also supports `x-paystack-signature`.

## Required test sequence before live mode

1. Set test-mode Paystack credentials and a test webhook signing secret.
2. Configure the approved test card-verification amount and disclosure.
3. Sync the six Starter/Standard/Premium monthly/yearly plans.
4. Start one trial in a dedicated test workspace.
5. Confirm the verification charge succeeds, the reusable authorization is returned, the recurring subscription has a first debit date 14 days ahead, and the verification charge is refunded.
6. Confirm the trial remains pending until `refund.processed`, then changes to `trialing`.
7. Test invalid signatures, duplicate webhook delivery, failed charges, failed refunds, subscription cancellation and invoice payment failure.
8. Only after all tests pass should the Owner explicitly enable live billing.

## Important

A successful browser callback is not proof of payment. Veyora verifies the transaction server-side and uses signed Paystack webhooks as the source of truth. No card authorization code is stored in Veyora's database. A failed reusable-card check or subscription setup triggers a refund attempt instead of activating a trial.

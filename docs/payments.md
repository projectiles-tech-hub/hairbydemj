# Payments

Naira payments go through **Paystack**; dollars, pounds and euros through
**Stripe**. Both are called directly over their REST APIs; no SDK and no
package was added. The code is in `server/payments/`.

## Settings (all from the server's environment, never committed)

| Name | Secret? | Where to find it |
| --- | --- | --- |
| `PAYSTACK_SECRET_KEY` | **Yes** | Paystack dashboard, Settings, API Keys and Webhooks. `sk_test_...` while testing, `sk_live_...` at launch. Also checks Paystack's webhooks. |
| `PAYSTACK_PUBLIC_KEY` | No | Same page, `pk_test_...` or `pk_live_...`. Used by the payment form. |
| `STRIPE_SECRET_KEY` | **Yes** | Stripe dashboard, Developers, API keys. `sk_test_...` or `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | No | Same page, `pk_test_...` or `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | **Yes** | Stripe dashboard, Developers, Webhooks, after adding the endpoint below. `whsec_...` |

Test keys and live keys are kept apart simply by which keys are set. The
admin shows each provider as "test" or "live" from its key. Switching to live
keys is a launch step (module 21).

## Webhooks to set up in each dashboard

| Provider | Address | Events |
| --- | --- | --- |
| Paystack | `https://api.hairbydemj.com/webhooks/paystack` | Paystack sends all events; we act on `charge.success`, `refund.processed` and `refund.failed` |
| Stripe | `https://api.hairbydemj.com/webhooks/stripe` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.updated`, `charge.refund.updated`, `refund.failed` |

## How a payment goes

1. Checkout (module 9) makes an order that is **waiting for payment**, with
   its stock held for a while.
2. The website or app asks `POST /orders/:number/pay`. The server picks the
   provider from the order's currency, asks it to start a payment for the
   amount still due (the order total less any gift cards) and answers with
   what the payment form needs:
   - **Paystack**: a payment page address and an access code. Card, bank
     transfer and USSD are offered.
   - **Stripe**: a client secret for Stripe's payment form on the website or
     in the app, which offers cards, Apple Pay and Google Pay.
   Pressing pay again within 20 minutes gives the same payment, not a second one.
3. The customer pays on the provider's form. Their card details never touch
   our server.
4. **The order is marked paid only when the provider's webhook says so.**
   The webhook's signature is checked with our secret; for Stripe, the
   payment is also read back from Stripe as a second check. The amount and
   currency must match exactly, or the payment is not accepted and staff are
   told on the order.
5. Meanwhile the return page asks `GET /orders/:number/payment` until the
   status changes. A failed payment says why ("Your card was declined.") and
   the customer can try again.

## Webhooks that come twice, late or out of order

- Every webhook is recorded once (Stripe's event id; for Paystack, which has
  no event id, a fingerprint of the exact message). A repeat is answered and
  ignored.
- A payment that is already confirmed is never confirmed again, and a
  failure notice that arrives after a success changes nothing.
- If handling a webhook fails half-way (the database or the provider has a
  moment), we answer with an error, so the provider sends it again, and the
  retry is handled normally.
- A webhook about a payment we never started is recorded and ignored.
- **Paid after the checkout expired:** if the order was cancelled because
  payment took too long, the stock is taken again and the order goes ahead.
  If an item sold out meanwhile, the payment is refunded in full,
  automatically, and the order says so.

## Refunds

- From the admin: `POST /api/payments/:id/refund` with the amount and a
  reason. The money goes back through the provider that took it. Several
  partial refunds are allowed, never more than was paid in total.
- Stripe usually confirms at once; Paystack confirms later by webhook. Until
  then the refund shows as pending.
- The order becomes "partly refunded" or "refunded" when the refunds are
  confirmed. Every refund is in the activity log and on the order's timeline.
- Refunds tied to returns, with items and shipping, are module 9.

## Addresses

| Who | Address | What it does |
| --- | --- | --- |
| Customer (website `/api`, app `/v1`) | `POST /orders/:number/pay` | Start paying |
| | `GET /orders/:number/payment` | Paid yet? |
| Provider | `POST /webhooks/paystack`, `POST /webhooks/stripe` | Webhooks, on `api.hairbydemj.com` |
| Staff | `GET /api/payments/providers` | Set up? Test or live? (settings view) |
| | `GET /api/payments/payouts` | Latest payouts to the bank (reports view) |
| | `GET /api/orders/:id/payments` | Payments and refunds of an order (orders view) |
| | `POST /api/payments/:id/refund` | `{ amountMinor, reason }` (orders change) |

A customer can only pay for or see their own order: a signed-in customer's
orders, or a guest holding the order's token (sent as `X-Order-Token`, or
`?token=` on the status check). Anyone else's order looks like one that
does not exist.

## Tested how

Against stand-ins for Paystack and Stripe that check every request (keys,
amounts, currencies, idempotency keys) and send correctly signed webhooks.
Testing against the real test modes needs the owner's test keys; that is a
step in module 20.

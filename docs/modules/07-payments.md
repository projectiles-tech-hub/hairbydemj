# Module 7 — Payments

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Paystack for NGN and Stripe for USD, GBP and EUR, called directly through their
REST APIs.

## Steps

- [x] Paystack: start a payment, verify it, handle its webhook
- [x] Stripe: start a payment, verify it, handle its webhook
- [x] Route each checkout to the right provider by currency
- [x] Webhook signature checks
- [x] Handle webhooks that arrive twice, late or out of order without duplicate orders
- [x] Refunds through the original provider
- [ ] Tests in each provider's test mode

## Done when

Payments in all four currencies succeed, fail and refund correctly in test mode.

## Notes

- Guide: [`../payments.md`](../payments.md). No package added.
- Migration `0014_payments.sql`. New settings: `PAYSTACK_SECRET_KEY`,
  `PAYSTACK_PUBLIC_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`.
- "Tests in each provider's test mode" is **not ticked**: everything is
  tested against stand-ins that check every request and send signed
  webhooks. Running the same flows in Paystack's and Stripe's own test
  modes needs the owner's test keys; it is listed in module 20.

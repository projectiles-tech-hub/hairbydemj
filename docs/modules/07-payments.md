# Module 7 — Payments

**Status:** Not started

## Goal

Paystack for NGN and Stripe for USD, GBP and EUR, called directly through their
REST APIs.

## Steps

- [ ] Paystack: start a payment, verify it, handle its webhook
- [ ] Stripe: start a payment, verify it, handle its webhook
- [ ] Route each checkout to the right provider by currency
- [ ] Webhook signature checks
- [ ] Handle webhooks that arrive twice, late or out of order without duplicate orders
- [ ] Refunds through the original provider
- [ ] Tests in each provider's test mode

## Done when

Payments in all four currencies succeed, fail and refund correctly in test mode.

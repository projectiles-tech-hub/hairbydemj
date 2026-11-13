# Module 8 — Shipping

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Live shipping rates, labels and tracking from DHL, UPS and FedEx, plus local
Nigerian delivery rates.

## Steps

- [x] Package weight and size from cart contents
- [x] DHL API: rates, labels, tracking
- [x] UPS API: rates, labels, tracking
- [x] FedEx API: rates, labels, tracking
- [ ] FedEx label certification (needs the owner's FedEx test keys; launch step, see docs/shipping.md)
- [ ] Test run against each carrier's test address (needs the owner's carrier API keys; module 20)
- [x] Local delivery rates set by staff in the admin
- [x] Duties and taxes handling: paid by the receiver (owner's decision 2026-10-29); notice on every international quote
- [x] Tests

## Done when

Checkout shows live options with prices and delivery estimates, and labels and
tracking are created after payment.

## Notes

- Guide: [`../shipping.md`](../shipping.md). Code: `server/shipping/`.
  Migration `0015_shipping`.
- Labels are bought by a queued job after payment; the worker that runs it
  comes in module 10, as does the 2-hourly tracking check.

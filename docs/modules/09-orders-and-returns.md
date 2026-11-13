# Module 9 — Orders and returns

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

The full order flow from payment to delivery, plus returns and refunds.

## Steps

- [x] Order creation after confirmed payment
- [x] Order statuses (paid, processing, shipped, delivered, cancelled)
- [x] Guest order tracking by order number and email
- [x] Return requests, approval, receipt and refunds (full and partial)
- [x] Invoices
- [x] Staff notes and activity log entries
- [x] Tests

## Done when

Orders move through every status correctly, and returns and refunds work end to end.

## Notes

- Guide: [`../orders.md`](../orders.md). Code: `server/orders/`. Migration
  `0016_orders_and_returns`.
- The order is written at checkout as waiting for payment (with stock held)
  and becomes paid when the payment is confirmed, as module 7 requires.
- Return window and store credit bonus use the sample figures (14 days,
  10%) until the owner sets them in the admin.
- Expiring unpaid orders is run by the worker (module 10); emails are sent
  by module 11.

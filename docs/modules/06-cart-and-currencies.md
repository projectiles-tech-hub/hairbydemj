# Module 6 — Cart and currencies

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

A cart that works in NGN, USD, GBP and EUR, with discounts and gift cards.

## Steps

- [x] Prices per variant per currency
- [x] Currency chosen from the customer's location, switchable by hand
- [x] Cart for guests and signed-in customers (synced across web and app)
- [x] Stock reserved correctly so the last item cannot be sold twice
- [x] Discount codes and automatic deals, including combinations
- [x] Gift card redemption
- [x] Correct currency rounding
- [x] Tests

## Done when

Carts total correctly in all four currencies with discounts and gift cards
applied, and stock is never oversold.

## Notes

- Guide: [`../cart.md`](../cart.md).
- No package added. Migration `0013_cart.sql`. New setting `RATES_URL`.
- "Stock reserved correctly": the hold, release, ship and restock functions
  are built and tested here (twenty checkouts at once for the last item, one
  wins); checkout and orders (modules 7 and 9) call them.
- Daily exchange rates come from a free service with no key; the daily run
  is scheduled in module 10, and staff can run it from the admin.
- Fixed in passing (module 4): editing only the naira price with automatic
  conversion could overwrite a price staff had typed. It no longer can.

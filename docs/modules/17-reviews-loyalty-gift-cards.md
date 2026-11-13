# Module 17 — Reviews, loyalty and gift cards

**Status:** In review (pull request open; the owner's merge is the approval) · **Depends on:** 13, 14, 15

## Goal

Customer-facing and admin parts of reviews, loyalty, referrals and gift cards.

## Steps

- [x] Reviews with photos from verified buyers; admin moderation
- [x] Loyalty points: earning, spending, history; admin rules
- [x] Referral links and rewards
- [x] Buying gift cards and checking balances; admin management
- [x] Tests

## Done when

All four features work on the website, app and admin.

## Notes (2026-11-13)

- Built on branch `feature/loyalty`, on top of modules 2 to 16. Guide:
  [`../loyalty.md`](../loyalty.md). Migration 0020.
- Points and referrals are worked out by the worker; the rules are sample
  figures for the owner to confirm in the admin.
- A bought gift card is an order with one gift card item and no delivery;
  its code is made when the payment is confirmed.
- The website's sign-up page said passwords need 10 characters; the server
  asks for 8, so the page now says 8.

# Module 14 — Admin dashboard

**Status:** In review (pull request open; the owner's merge is the approval) · **Depends on:** D5 approved, backend modules 1–12

## Goal

Every admin page, built in plain HTML, CSS and TypeScript from the approved
designs, at admin.hairbydemj.com.

## Steps

- [x] Staff sign-in with two-step verification
- [x] Dashboard
- [x] Products, product editor, categories, inventory
- [x] Orders, order detail, returns
- [x] Customers, discounts (gift cards, loyalty and reviews pages come with module 17)
- [x] Homepage, content pages
- [x] Shipping, payments and currency settings
- [x] Reports, staff and roles, activity log, store settings
- [x] Tests

## Done when

Staff can run the whole store from the admin, and every page matches its
approved design.

## Design preview (added 2026-11-11)

By the owner's instruction the admin page code was started early so the
designs can be seen online ([`../decisions/0005-design-preview-before-backend.md`](../decisions/0005-design-preview-before-backend.md)).
It is in `server/admin/`, with sample data only, not connected to the
server's routes, sign-in or real data. The steps above stay unticked until
the pages run on the real backend (they now do; see the notes below). See [`../preview.md`](../preview.md).

## Notes (2026-11-13)

- Built on branch `feature/admin`, on top of modules 2 to 13. The live pages
  are in `server/admin/live/`; the design preview files are unchanged.
- New addresses for customers, the activity log, content pages, homepage
  sections, store settings and the sales report: `server/admin/api.ts`.
- Also added: an Emails page (subjects and opening words of every email), a
  System page (scheduled tasks and background jobs) and the shop's home page
  now follows the Homepage settings.
- Guide: [`../admin.md`](../admin.md). 255 tests pass; walked through in
  Chromium from accepting an invitation to editing the shop's banner.

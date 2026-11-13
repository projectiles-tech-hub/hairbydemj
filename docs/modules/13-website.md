# Module 13 — Website

**Status:** In review (pull request open; the owner's merge is the approval) · **Depends on:** D3 approved, backend modules 1–12

## Goal

Every customer website page, built in plain HTML, CSS and TypeScript from the
approved designs.

## Steps

- [x] Shared layout: header, footer, mini-cart, currency selector, cookie notice
- [x] Shopping pages
- [x] Checkout
- [x] Account pages
- [x] Information and system pages
- [x] Search-engine basics (titles, descriptions, sitemap, structured data)
- [x] Mobile-browser and accessibility checks
- [x] Tests

## Done when

Every website page matches its approved design and works on desktop and mobile
browsers.

## Design preview (added 2026-11-11)

By the owner's decision ([`../decisions/0005-design-preview-before-backend.md`](../decisions/0005-design-preview-before-backend.md))
the page code was started early so the designs can be approved online. In
`server/site/`, with sample data only, not connected to the server's routes
or to real data. The steps above stay unticked until the designs are
approved and the pages run on the real backend. See [`../preview.md`](../preview.md).

## Notes (2026-11-12)

- Guide: [`../website.md`](../website.md). Code: `server/site/store/`,
  `browser/store.ts`, additions to `public/css/site.css`, and the customer
  account addresses in `server/accounts/profile.ts`.
- The preview files stay as they were for the online preview.
- Gift card buying, the try-on, loyalty and reviews pages come with
  modules 16 and 17.

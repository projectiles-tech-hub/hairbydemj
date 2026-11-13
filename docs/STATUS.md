# Status

**Last updated:** 2026-11-11

## Where we are

- Module 0 (Repo setup) is complete and approved.
- Module 1 (Server foundation) is complete: pull request #1 approved by the
  owner, merged by the owner. All 26 tests pass.
- Owner decided on 2026-10-29 to finish the design modules D1 to D5 before
  continuing with the backend modules (Module 2 onward).
- Module D1 (Brand and design system) is complete: pull request #2 merged by
  the owner on 2026-11-10.
- Module D2 (Journeys and wireframes) is complete: 20 journeys and 178
  wireframe frames in Figma, built from a component kit, website drawn at
  phone, tablet and desktop widths. Pull request #4 merged by the owner on
  2026-11-11.
- Modules D3 (website pages), D4 (app screens) and D5 (admin pages) are
  complete: built in Figma, pull requests #6, #7 and #8 merged by the owner
  on 2026-11-11.
- Owner decided on 2026-11-11 to put the designs online before the backend,
  so the person the store is for can look at them
  (`decisions/0005-design-preview-before-backend.md`).
- Design preview is live at https://hairbydemj.vercel.app/ : 37 website
  pages as coded pages (pull request #9 merged), 52 app screens as pictures.
- Admin preview: 23 admin pages, 3 dialogs and 3 list states as coded pages
  under `/admin/` (pull request #10 merged).
- Owner instructed on 2026-11-11 to start the backend.
- Module 2 (Database) is built; pull request #11 is open.
- Module 3 (Accounts and sign-in) is built; pull request #12 is open.
- Owner decided on 2026-11-11: customers stay on `hairbydemj.com`; one Owner
  super user at `admin.hairbydemj.com`
  (`decisions/0006-sign-in-addresses-and-owner.md`).
- The Vercel preview was for viewing only. The real site runs from our own
  server; the page code written for the preview is kept as the starting
  point for modules 13 and 14.

## Current module

[`modules/04-catalog.md`](modules/04-catalog.md): built and **in review** on
branch `feature/catalogue`, on top of modules 2 and 3. Products, variants,
prices in four currencies, stock, categories, collections with rules,
shop-the-look sets; shop lists with filters and endless scrolling.
121 tests pass against PostgreSQL 16.

## Exact next step

1. Owner merges, in this order: pull request #11 (Database), #12 (Accounts),
   then the Module 4 pull request.
2. Then **Module 5. Media** ([`modules/05-media.md`](modules/05-media.md)),
   confirmed with the owner before starting.

## Modules left after Module 4

5 Media · 6 Cart and currencies · 7 Payments · 8 Shipping · 9 Orders and
returns · 10 Background jobs · 11 Notifications · 12 Search · 13 Website ·
14 Admin dashboard · 15 Phone app · 16 AR try-on · 17 Reviews, loyalty, gift
cards · 18 Live chat · 19 Deployment, backups, monitoring · 20 Testing and
security review · 21 Launch.

## Waiting on the owner

- Photographs, and real figures for the placeholders listed under "Sample
  values to confirm" in
  [`design/journeys-and-wireframes.md`](design/journeys-and-wireframes.md).
- See also the "Blocked / waiting on owner" section of [`TASKS.md`](TASKS.md).

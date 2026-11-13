# Status

**Last updated:** 2026-11-13

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
- Module 4 (Catalogue) is built; pull request #13 is open. By the owner's
  decision the shop shows the exact number in stock.
- Module 5 (Media) is built; pull request #14 is open.
- Owner instructed on 2026-11-11 ("finish all of them properly"): build every
  remaining module, each with its own pull request, tests and records.
- Module 6 (Cart and currencies) is built; pull request #15 is open.
- Owner decided on 2026-11-11: customers stay on `hairbydemj.com`; one Owner
  super user at `admin.hairbydemj.com`
  (`decisions/0006-sign-in-addresses-and-owner.md`).
- Module 7 (Payments) is built; pull request #16 is open.
- Module 8 (Shipping) is built; pull request #17 is open.
- Module 9 (Orders and returns) is built; pull request #18 is open.
- Module 10 (Background jobs) is built; pull request #19 is open.
- Module 11 (Notifications) is built; pull request #20 is open.
- Module 12 (Search) is built; pull request #21 is open.
- Module 13 (Website) is built; pull request #22 is open.
- Module 14 (Admin) is built; pull request #23 is open.
- Module 15 (Phone app) is built; pull request #24 is open.
- Module 16 (Try-on) is built; pull request #25 is open.
- Module 17 (Reviews, loyalty, gift cards) is built; pull request #26 is open.
- Module 18 (Live chat) is built; pull request #27 is open.
- Module 19 (Deployment, backups, monitoring) is built; pull request #28 is open.
- Module 20 (Testing and security review) is built; pull request #29 is open.
- Module 21 (Launch) is prepared; its pull request is open. All 21 modules are built.
- The Vercel preview was for viewing only. The real site runs from our own
  server; the page code written for the preview is kept as the starting
  point for modules 13 and 14.

## Current module

[`modules/21-launch.md`](modules/21-launch.md): prepared and **in review**
on branch `feature/launch`, on top of modules 2 to 20. Every module is now
built. What is left is the owner's: the accounts, keys and signing files,
the store reviews, and the launch itself, all written up in `launch.md`.

## Exact next step

1. Owner merges, in order: #11 to #29, then Module 21's.
2. The owner follows `operations.md` ("First-time set-up") and then
   `launch.md` from the timeline's first row.

## Modules left

None. The launch steps in `launch.md` remain.

## Waiting on the owner

- Photographs, and real figures for the placeholders listed under "Sample
  values to confirm" in
  [`design/journeys-and-wireframes.md`](design/journeys-and-wireframes.md).
- Paystack and Stripe test keys (needed for module 20; live keys at launch).
- DHL, UPS and FedEx API keys (test first), the sender address for labels,
  the boxes used and the local delivery zones (see `shipping.md`).
- Apple push key and Firebase service account (for app push); the From address for emails.
- The return window and store credit bonus (sample figures in use: 14 days, 10%).
- Loyalty: confirm the sample figures (`loyalty.md`).
- Try-on: wig pictures drawn to the template (`try-on.md`).
- For the app: Apple Developer and Google Play accounts, a Firebase project, Google and Apple sign-in set-up, and real phones to test on (`app.md`).
- For going live: the Namecheap Quasar VPS, a free Cloudflare account, a Google account for backups, and following `operations.md` ("First-time set-up").
- See also the "Blocked / waiting on owner" section of [`TASKS.md`](TASKS.md).

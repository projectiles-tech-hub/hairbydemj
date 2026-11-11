# Changelog

All notable changes to this repository, newest first.

## 2026-11-11

- Module 7, Payments (`server/payments/`): Paystack for naira and Stripe for
  dollars, pounds and euros over their REST APIs; the order is marked paid
  only by a signed webhook with the exact amount; repeats, late and
  out-of-order webhooks handled; a payment after an expired checkout either
  revives the order or is refunded automatically; partial and full refunds
  through the original provider. Migration 0014. Guide: `docs/payments.md`.
- Module 6, Cart and currencies (`server/cart/`): guest and customer carts
  shared across website and app, merged on sign-in, priced fresh on every
  read; currency from the visitor's country, switchable; exchange rates
  typed or fetched daily with re-conversion of worked-out prices; discount
  codes and automatic deals with combinations and the best deal chosen;
  gift card redemption with guessing limits; stock held all-or-nothing so
  the last item cannot be sold twice. Migration 0013. Guide: `docs/cart.md`.
- Fixed: editing only the naira price with automatic conversion no longer
  overwrites prices staff typed.
- Module 5, Media (`server/media/`): staff upload product photos and
  videos; photos are resized into five widths as WebP and JPEG with libvips;
  videos are compressed to MP4 with a poster picture by ffmpeg; hidden
  details such as GPS location are removed; files are served under `/media/`
  with a year-long cache and partial requests; photos link to variants by
  colour. New setting `MEDIA_DIR`. Migration 0012. Guide: `docs/media.md`.
- Catalogue: the shop now shows the exact number in stock (owner's decision).
- Module 4, Catalogue (`server/catalog/`): products with hair attributes,
  variants with generated SKUs, a price per currency with conversion from
  naira, stock with reasons and a low-stock level, a category tree,
  hand-picked and rule-based collections, shop-the-look sets. Shop
  addresses with filters, sorting and endless scrolling; staff addresses
  guarded by role. Migration 0011. Guide: `docs/catalogue.md`.
- Module 3, Accounts and sign-in (`server/accounts/`): customer sign-up
  with emailed 6-digit code, sign-in and sign-out, forgot and reset
  password, Google and Apple sign-in linked to one customer; staff invites,
  two-step verification, roles and permissions, an Owner super user;
  protection against password guessing and cross-site request forgery.
  Migration 0010. New settings `AUTH_SECRET`, `GOOGLE_CLIENT_IDS`,
  `APPLE_CLIENT_IDS`, `TRUST_PROXY`. Commands `staff:invite-owner` and
  `staff:reset-access`. Guide: `docs/accounts.md`. Decision 0006.
- Noted for later in `docs/TASKS.md`: the "DemJ woman" customer gallery.
- Module 2, Database: PostgreSQL schema in 9 numbered migrations (63
  tables) covering the whole data model; our own migration runner with
  checksums and a lock (`server/db/`); `npm run db:migrate`, `db:status`,
  `db:seed`; sample data for development; tests against PostgreSQL 16, also
  in GitHub Actions. New setting `DATABASE_URL`. Guide: `docs/database.md`.
- Admin preview: the 23 admin pages as coded pages under `/admin/`
  (`server/admin/`, `browser/admin.ts`, `public/css/admin.css`), with the
  refund, adjust stock and invite staff dialogs, and the empty, loading and
  error states of Orders. Sidebar folds into a menu on phones and tablets.
- Design preview (decision 0005): the 37 website pages as coded pages in
  `server/site/`, galleries of the app and admin designs, static build for
  Vercel (`vercel.json`, `docs/preview.md`). Live at
  https://hairbydemj.vercel.app/.
- Modules D3, D4 and D5 approved by the owner (pull requests #6, #7 and #8
  merged); design modules complete.
- Module D2, Journeys and wireframes, approved by the owner (pull request #4
  merged); module D2 complete.
- D2 in Figma: 20 journeys; 178 wireframe frames on a 16-part component kit;
  endless scrolling; website at phone, tablet and desktop widths; field
  error states; design review with fixes.
- Page inventory: added Payment methods (website and app), and Profile and
  security and Verify account (app).
- Status, tasks and module records updated; D3 is the current module.

## 2026-11-10

- Module D1, Brand and design system, approved by the owner (pull request #2
  merged); module D1 complete.
- Status, tasks and module records updated for the design-first order
  (D1 to D5 before backend Module 2).

## 2026-11-02

- Design system recorded in `docs/design/design-system.md`: logo versions,
  colour palette sampled from the owner's logo with a coral error colour,
  contrast ratios, typography (Source Sans 3 and Cormorant Garamond),
  spacing, grid, corners, motion tokens, Phosphor Light icons, components.
- Figma file "hairbydemj Design System" built: Foundations, Icons,
  Components and Logo pages, all values as variables and text styles.

## 2026-10-29 (session 2)

- Recorded owner approvals: documentation, Namecheap Quasar VPS, carrier
  accounts, design timing, duties paid by the receiver.
- Module 1 — Server foundation: plain Node.js server with hostname routing
  for the website, admin and API; configuration, logging, error handling,
  static files, health check; 26 tests; GitHub Actions check.
- Module 1 approved by the owner (pull request #1); module 1 complete.

## 2026-10-29

- Created the repository documentation: CLAUDE.md, README, status, tasks,
  build specification, module plans, design inventory, decision records and
  the first session log.
- Added the build plan document (`docs/build-plan.docx`).

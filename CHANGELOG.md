# Changelog

All notable changes to this repository, newest first.

## 2026-11-13

- Module 14, Admin (`server/admin/live/`, `server/admin/api.ts`,
  `browser/staff.ts`): every staff page made on the server with real data at
  admin.hairbydemj.com: sign-in with the authenticator code, accepting an
  invitation, dashboard, orders and order actions, returns, customers,
  products and the product editor with variants, prices and photos,
  categories and collections, inventory adjustments, discounts, homepage,
  content pages, emails, shipping, payments and currencies, reports with a
  spreadsheet download, staff and roles, activity log, store settings and
  system. Pages and buttons follow each role. The shop's home page now
  follows the Homepage settings. Guide: `docs/admin.md`.

## 2026-11-12

- Module 13, Website (`server/site/store/`, `browser/store.ts`): every
  customer page made on the server with real data: home, categories with
  filters, search, product pages with variant choice and exact stock, shop
  the look, the bag, checkout with live delivery options and Paystack or
  Stripe payment, the after-payment page, sign-in and sign-up pages,
  account pages (orders with tracking, returns, invoices, addresses,
  details, password, preferences, wishlist, closing the account), guest
  order tracking, information pages, sitemap and robots.txt, structured
  data, a content security policy. New customer addresses for profile,
  password, addresses, wishlist and closing an account. Guide:
  `docs/website.md`.
- Module 12, Search (`server/search/`): PostgreSQL-only product search with
  typing mistakes corrected against the words the shop knows, the last
  word finished as it is typed, lengths such as "22 inch" understood,
  matching on names, details, descriptions, categories, tags and colours,
  "any word" when no product has all, ranking by fit; shares all filters,
  sorts and pages of the category pages; as-you-type suggestions; a staff
  report of top searches and searches that find nothing. Migration 0018.
  Guide: `docs/search.md`.
- Module 11, Notifications (`server/notifications/`): emails built and
  signed with DKIM by our own code and handed to Postfix on the server; all
  store emails written with a branded layout, editable by staff; order
  progress sent by email, Apple and Google push (called directly) and the
  in-app list; customer preferences, newsletter sign-up, signed
  unsubscribe links with one-click support; the worker now sends queued
  emails. Guide with Postfix and DNS steps: `docs/notifications.md`.
- Module 10, Background jobs (`server/worker/`): a separate worker process
  run by systemd; jobs claimed safely one at a time, tried again with longer
  waits, given up after the last try or at once when they can never work,
  and put back if a worker dies; scheduled tasks for expiring unpaid
  orders, tracking, daily exchange rates, back-in-stock and low-stock
  alerts, bag reminders (only with marketing consent) and daily cleanup;
  staff can see failed jobs and try them again. `npm run worker`.
  Migration 0017. Guide: `docs/worker.md`.
- Module 9, Orders and returns (`server/orders/`): checkout turns the bag
  into an order waiting for payment in one step (fresh prices, delivery
  only from a saved quote, stock held, gift cards spent, order token for
  guests, confirmation email); unpaid orders expire and let everything go,
  and a late payment takes it back; customers see and cancel their orders,
  guests look orders up by number and email with guessing limits;
  invoices; staff list, notes, address corrections and cancellation with
  refunds; stock leaves the shelf at dispatch; returns from request to
  refund, with money back to the card and gift card, or store credit with
  a bonus. Migration 0016. Guide: `docs/orders.md`.
- Module 8, Shipping (`server/shipping/`): the bag is packed into the
  store's boxes; zones and prices inside Nigeria set by staff; live DHL
  Express, UPS and FedEx prices for addresses abroad, converted to the
  customer's currency with the carrier's markup; prices saved as a
  30-minute quote that checkout must use; free-delivery discounts; the
  duties-paid-by-receiver notice on every international quote; labels
  bought after payment (queued) or by staff, kept in a private folder;
  tracking read from all three carriers moves the order to shipped and
  delivered; local courier dispatch and delivery. Migration 0015. Guide:
  `docs/shipping.md`.

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

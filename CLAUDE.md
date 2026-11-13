# CLAUDE.md — read this first, every session

This file is the entry point for every development session on **hairbydemj**.
It points to everything else. Keep it up to date whenever the project's
structure, rules or workflow change.

## The project in brief

hairbydemj.com is a global online store for hair and hair accessories:
a website, a staff admin dashboard, and an iOS/Android app, all running on one
backend we build ourselves. The full plan is in `docs/build-plan.docx`; the
same content, split by topic, is in `docs/spec/`.

## Fixed rules (do not change without the owner's explicit instruction)

1. **Confirm before acting.** Before starting any work, and before any step or
   action taken in the course of a task, confirm it with the owner.
2. **Do only what is asked.** Never do anything the owner has not asked for.
   When asked to add to something, add; do not replace or change what exists.
3. **Keep answers focused on the point.**
4. **No frameworks**, except **Flutter** for the mobile app. The website, admin
   and API are plain TypeScript on Node.js. See `docs/decisions/0001-no-frameworks.md`.
5. **No paid services** beyond the unavoidable costs in
   `docs/decisions/0004-no-paid-services.md`.
6. **Hosting is a Namecheap Quasar VPS.** See `docs/decisions/0003-namecheap-vps.md`.
7. **Build in modules, one at a time, in the order in `docs/modules/`.**
   Frontend modules are built only from designs the owner has approved.
8. **Never commit secrets** (keys, passwords, tokens). They live in server
   environment settings only.

## Start-of-session routine

1. Read `docs/STATUS.md` — where the project is and the exact next step.
2. Read the current module file in `docs/modules/` named in STATUS.md.
3. Read the latest log in `docs/sessions/`.
4. Check `docs/TASKS.md` for open and blocked tasks.
5. Confirm the next step with the owner before starting.

## End-of-session routine

1. Tick off completed steps in the current module file and update its status.
2. Update `docs/TASKS.md` (move done tasks, add new ones).
3. Update `docs/STATUS.md` with where things stand and the exact next step.
4. Write a session log in `docs/sessions/` named `YYYY-MM-DD-NN.md`
   (what was done, decisions made, what is next).
5. Add an entry to `CHANGELOG.md`.
6. Commit with a clear message and push.

## Map of the repository

| Path | What it holds |
| --- | --- |
| `CLAUDE.md` | This file: rules, routines, map |
| `README.md` | Short overview for humans |
| `CHANGELOG.md` | What changed, by date |
| `docs/STATUS.md` | Current state and the exact next step |
| `docs/TASKS.md` | Open, blocked and completed tasks |
| `docs/spec/` | Build specification, split by topic |
| `docs/modules/` | One file per module, built in order |
| `docs/design/` | Design system and page/screen inventory with approval status |
| `docs/decisions/` | Why each major choice was made |
| `docs/sessions/` | One log per session |
| `docs/build-plan.docx` | The owner's build plan document |
| `docs/database.md` | The database: settings, set-up steps, commands, tables and rules |
| `db/migrations/`, `db/seeds/` | Numbered SQL migrations; sample data for development |
| `server/db/` | Database connection, migration runner and its command line |
| `docs/accounts.md` | Accounts and sign-in: addresses, settings, rules, commands |
| `server/accounts/` | Customer and staff accounts, sessions, two-step verification |
| `docs/catalogue.md` | Catalogue: products, variants, prices, stock, collections; addresses and rules |
| `server/catalog/` | Catalogue code: what the shop reads and what staff manage |
| `docs/media.md` | Product photos and videos: tools needed, sizes, addresses, rules |
| `server/media/` | Uploads, resizing with libvips, video compression with ffmpeg |
| `docs/cart.md` | Cart, currencies and rates, discounts, gift cards, holding stock |
| `server/cart/` | Cart, currency, discount, gift card and stock-holding code |
| `docs/payments.md` | Payments: Paystack and Stripe keys, webhooks, refunds |
| `server/payments/` | Payment start, webhook handling, refunds |
| `docs/shipping.md` | Shipping: carrier keys, boxes, local zones, quotes, labels, tracking, duties |
| `server/shipping/` | Packing, local zones, DHL, UPS and FedEx clients, labels and tracking |
| `docs/orders.md` | Checkout, order statuses, customer and staff order addresses, returns and refunds |
| `server/orders/` | Checkout, order views, cancelling, invoices, returns |
| `docs/worker.md` | Background worker: running it, jobs, retries, scheduled tasks |
| `server/worker/` | Job queue, scheduled tasks, worker loop and entry point |
| `deploy/` | Server files: systemd service for the worker |
| `docs/notifications.md` | Email (Postfix, DKIM, SPF, DMARC), push (Apple, Google), preferences, unsubscribe |
| `server/notifications/` | Email building and signing, SMTP, push, templates, preferences |
| `docs/search.md` | Product search: how it works, addresses, staff report |
| `server/search/` | Search: parsing, typo correction, ranking, suggestions, report |
| `docs/website.md` | The live website: pages, paying, search engines, safety, customer account addresses |
| `server/site/store/` | Live website pages (real data); `browser/store.ts` is their script |
| `docs/preview.md` | The online design preview: what it is, how to build and publish it |
| `server/site/`, `browser/`, `public/` | Website page code, browser script, styles, fonts and logo |
| `server/admin/` | Admin page code |
| `preview/` | Builds the design preview; pictures of the app and admin designs |

### Specification files (`docs/spec/`)

`overview.md` · `architecture.md` · `tech-stack.md` · `data-model.md` ·
`payments.md` · `shipping.md` · `security.md` · `hosting.md` · `conventions.md`

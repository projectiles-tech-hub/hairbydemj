# Tasks

Update this file at the end of every session.

## Open

- [ ] Make the changes the owner and reviewer ask for after seeing the preview
- [ ] Check the 20 icons added in Figma during D3 against the Phosphor originals
- [ ] Customer account: change of email address (password change, profile and closing the account were added in module 13)

## Noted for later (not to be built until the owner says)

- **"DemJ woman" customer gallery** (owner, 2026-11-11). A way to celebrate
  customers: a customer uploads a picture of herself wearing hair bought
  from us; we place it in a picture frame stamped "DemJ woman" with our
  logo; and we post it on our gallery and on the reviews page, with her
  name. Fits with module 17 (reviews) and module 5 (media).

## Blocked / waiting on owner

- [ ] Launch (docs/launch.md): Apple Developer and Google Play accounts and signing secrets; Paystack and Stripe business verification and live keys; carrier live accounts; store listings and screenshots; send the apps for review; final content check; launch day
- [ ] Testing with the real accounts: run `provider-check.js` with the Paystack and Stripe test keys and the carriers' test addresses, then pay one staging order per currency with the test cards (docs/testing.md)
- [ ] Beta testers on real iPhones and Android phones through TestFlight and Google Play internal testing (docs/testing.md)
- [ ] An independent security review of sign-in, checkout and payments (docs/security-review.md)
- [ ] Server: the Namecheap Quasar VPS, a free Cloudflare account and a Google account for backups; then the set-up in docs/operations.md ("First-time set-up"), the GitHub environments and secrets, and the UPTIME_URLS variable
- [ ] Confirm the loyalty figures (points per ₦1,000, worth of a point, minimum, share of an order, review, birthday and referral points) and the tiers; see docs/loyalty.md
- [ ] Try-on: see-through wig pictures drawn to the template in docs/try-on.md, one per colour; then tuning on real phones and browsers
- [ ] Phone app: test on real iPhones and Android phones with the owner (module 15's last step); Apple Developer and Google Play accounts; a free Firebase project for push; Google and Apple sign-in set-up (see docs/app.md)
- [ ] Review and merge the Module 2 (Database) pull request (#11), then Module 3 (Accounts, #12), then Module 4 (Catalogue, #13), then Module 5 (Media, #14), then Module 6 (#15), then Module 7 (Payments, #16), then Module 8 (Shipping, #17), then Module 9 (Orders and returns, #18), then Module 10 (Background jobs, #19), then Module 11 (Notifications, #20), then Module 12 (Search, #21), then Module 13 (Website, #22), then Module 14 (Admin, #23), then Module 15 (Phone app, #24), then Module 16 (Try-on, #25), then Module 17 (Reviews, loyalty, gift cards, #26), then Module 18 (Live chat, #27), then Module 19 (Deployment, backups, monitoring, #28), then Module 20 (Testing and security review, #29), then the Module 21 (Launch) pull request
- [ ] Paystack: create the account, send the test keys (secret and public); set the webhook address in docs/payments.md
- [ ] Stripe: create the account, send the test keys (secret and publishable) and the webhook secret after adding the webhook address
- [ ] DHL Express: ask the DHL account manager for MyDHL API access and send the API key, secret and account number (test keys first); see docs/shipping.md
- [ ] UPS: create an app on developer.ups.com and send the client ID, client secret and shipper number
- [ ] FedEx: create a project on developer.fedex.com and send the API key, secret key and account number; FedEx label certification follows
- [ ] Confirm or change the return window (sample: 14 days) and the store credit bonus (sample: 10%)
- [ ] Give the store address to print on labels as the sender, and where the hair is made (for customs forms)
- [ ] List the boxes you pack in (inside size and empty weight) and the local delivery zones, couriers and prices inside Nigeria
- [ ] Apple push key (.p8, Key ID, Team ID) once the Apple Developer account exists; Firebase project and service account key for Android push
- [ ] Decide the email address customers see (MAIL_FROM, suggested hello@hairbydemj.com) and where replies go
- [ ] Google sign-in: create the client IDs in Google Cloud Console (free) for the website and the apps
- [ ] Apple sign-in: Services ID and bundle ID (needs the Apple Developer account)
- [ ] Confirm or change the choices listed at the end of docs/database.md
- [ ] Look through the preview with the reviewer and list any changes
- [ ] Supply product photographs
- [ ] Decide whether the repository should be private (it is currently public)
- [ ] Paystack business account
- [ ] Stripe business account (needs a business registered in a supported country, e.g. a UK or US company or Stripe Atlas)
- [ ] Apple Developer account ($99/year) and Google Play Console account ($25 one-time)
- [ ] WhatsApp Business number for customer support
- [ ] Google account for backups and a free Cloudflare account
- [ ] Buy the Namecheap Quasar VPS (needed by module 19)
- [ ] Give real figures for the sample values in docs/design/journeys-and-wireframes.md (return window, store credit bonus, loyalty points and tiers, delivery times, ship-from address, business hours)

## Completed

- [x] Module 21 (Launch): release workflow, privacy manifest, launch check and guide; pull request open (2026-11-13)
- [x] Module 20 (Testing and security review): browser journeys, speed budget, security tests and review, fixes; pull request open (2026-11-13)
- [x] Module 19 (Deployment, backups, monitoring): built and tested; pull request open (2026-11-13)
- [x] Module 18 (Live chat): built, tests and browser walkthrough; pull request open (2026-11-13)
- [x] Module 17 (Reviews, loyalty, gift cards): built with tests; pull request open (2026-11-13)
- [x] Module 16 (Try-on): built; server tests, website walkthrough and app builds; pull request open (2026-11-13)
- [x] Module 15 (Phone app): built, checks pass in GitHub Actions; pull request #24 open (2026-11-13)
- [x] Module 14 (Admin): built, tests and walkthrough done; pull request open (2026-11-13)

- [x] 2026-10-29 — Build plan written and approved for documentation
- [x] 2026-10-29 — Repository documentation created (CLAUDE.md, spec, modules, design inventory, decisions)
- [x] 2026-10-29 — Owner reviewed and approved the documentation (module 0 complete)
- [x] 2026-10-29 — Owner approved the build plan and the Namecheap Quasar VPS
- [x] 2026-10-29 — Owner created business accounts with UPS, FedEx and DHL
- [x] 2026-10-29 — Owner approved Claude proposing a design, but only when the design phase is reached
- [x] 2026-10-29 — Decided: international duties and taxes are paid by the receiver on delivery
- [x] 2026-10-29 — Module 1 built: plain Node.js server, router, configuration, logging, error handling, static files, health check, tests and GitHub Actions check
- [x] 2026-10-29 — Owner approved pull request #1 (Module 1 — Server foundation); module 1 complete
- [x] 2026-10-29 — Owner decided to complete design modules D1 to D5 before continuing with backend Module 2
- [x] 2026-10-30 — Owner supplied the logo artwork
- [x] 2026-11-02 — Owner adopted the colour palette sampled from the logo artwork
- [x] 2026-11-02 — Fonts chosen: Source Sans 3 and Cormorant Garamond
- [x] 2026-11-02 — Design system built in Figma: foundations, icons, components, logo vectors
- [x] 2026-11-10 — Owner approved pull request #2 (Module D1, Brand and design system); module D1 complete
- [x] 2026-11-10 — Journeys and first wireframes built in Figma (module D2)
- [x] 2026-11-11 — Wireframes rebuilt on a component kit; endless scrolling designed; design review run and fixes applied
- [x] 2026-11-11 — Missing journeys added (verify account, update profile, add a card and others); every page in the inventory wireframed; website drawn at phone, tablet and desktop widths
- [x] 2026-11-11 — Owner approved pull request #4 (Module D2, Journeys and wireframes); module D2 complete
- [x] 2026-11-11 — Owner instructed to go ahead with D3, D4 and D5
- [x] 2026-11-11 — D3, D4 and D5 built in Figma: 112 website frames, 43 app screens, 23 admin pages; six supporting colour tokens and shared components added
- [x] 2026-11-11 — Owner merged pull requests #6, #7 and #8: modules D3, D4 and D5 complete
- [x] 2026-11-11 — Owner decided to preview the designs online before the backend (decision 0005)
- [x] 2026-11-11 — Website preview built: 37 coded pages, app and admin picture galleries (pull request #9 merged)
- [x] 2026-11-11 — Owner put the preview on Vercel: https://hairbydemj.vercel.app/
- [x] 2026-11-11 — Admin preview built: 23 coded admin pages, 3 dialogs, 3 list states
- [x] 2026-11-11 — Owner merged the admin preview (pull request #10)
- [x] 2026-11-11 — Module 2 (Database) built: 9 migrations, 63 tables, migration runner, sample data, tests
- [x] 2026-11-11 — Owner decided the sign-in addresses and the Owner super user (decision 0006)
- [x] 2026-11-11 — Module 3 (Accounts and sign-in) built: customers, staff, Google and Apple, two-step verification, roles, tests
- [x] 2026-11-11 — Module 4 (Catalogue) built: products, variants, prices, stock, categories, collections, looks, shop lists with filters
- [x] 2026-11-11 — Owner decided the shop shows the exact number in stock
- [x] 2026-11-11 — Module 5 (Media) built: photo and video uploads, sizes, compression, serving, tests
- [x] 2026-11-11 — Module 6 (Cart and currencies) built: carts for guests and customers, currencies and daily rates, discounts, gift card redemption, stock holding
- [x] 2026-11-11 — Module 7 (Payments) built: Paystack and Stripe, signed webhooks, repeats and late payments handled, refunds
- [x] 2026-11-12 — Module 8 built: packing, local zones, DHL, UPS and FedEx prices, labels and tracking, duties notice, tests
- [x] 2026-11-12 — Module 9 built: checkout, order statuses, guest look-up, invoices, staff notes and cancellation, returns with refunds and store credit, tests
- [x] 2026-11-12 — Module 10 built: worker process, retries, scheduled tasks, alerts, reminders, cleanup, systemd service, tests
- [x] 2026-11-12 — Module 11 built: own email sending with DKIM, templates, push to Apple and Google, in-app list, preferences, unsubscribe, tests
- [x] 2026-11-12 — Module 12 built: search with typo correction, suggestions, shared filters, ranking, staff report, tests
- [x] 2026-11-12 — Module 13 built: every website page on real data, checkout and payment, account pages, search-engine basics, browser walk-through, tests

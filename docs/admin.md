# Admin

The staff admin on `admin.hairbydemj.com`, built from the approved designs in
plain HTML, CSS and TypeScript. Pages are made on the server with real data;
`browser/staff.ts` (served as `/js/staff.js`) sends their forms and buttons
to the same `/api` addresses the app and the tests use, and shows errors
next to the right field. The code is in `server/admin/live/` (pages) and
`server/admin/api.ts` (the addresses added for this module).

The design preview (`server/admin/pages.ts`, `layout.ts`, sample data) is
kept as it was, for the online preview; the live pages are separate.

## Signing in

| Address | What it does |
| --- | --- |
| `/sign-in/` | Email and password, then the six-digit code from the authenticator app. Any page asked for while signed out comes here and goes back after signing in |
| `/invite/?token=` (emailed) and `/accept-invite/?token=` (printed by `npm run staff:invite-owner`) | A new staff member chooses a password, adds the key to an authenticator app, and enters its code |

The first Owner is made on the server with
`npm run staff:invite-owner -- "Full Name" email` (see `accounts.md`). The
Owner then invites everyone else from **Staff and roles**.

## Pages

| Address | Page | Who sees it |
| --- | --- | --- |
| `/` | Dashboard: sales today, orders to fulfil, returns waiting, items running low, failed background jobs, naira sales for 14 days, latest orders | Everyone |
| `/orders/`, `/orders/<id>/` | Orders with tabs and filters; one order with its items, payment, delivery, history, notes, address correction, buying a label or recording a local dispatch, cancelling and refunds | Orders |
| `/returns/`, `/returns/<id>/` | Return requests: approve or decline, mark received (choosing what goes back into stock), refund | Returns |
| `/customers/`, `/customers/<id>/` | Customers, their orders and addresses, a note only staff see, switching an account off | Customers |
| `/products/`, `/products/new/`, `/products/<id>/` | Products with filters; the editor with details, variants and prices per currency, making variants for every combination, photos and videos | Products |
| `/categories/` | Categories (with the menu order) and collections | Products |
| `/inventory/` | Stock for every variant, the "Running low" tab, and adjusting stock with a reason | Products |
| `/discounts/`, `/discounts/new/`, `/discounts/<id>/` | Discounts: codes and automatic ones, amounts per currency, limits, dates | Discounts |
| `/homepage/` | Order of the homepage sections, which show, and the banner's words and button | Settings |
| `/content/`, `/content/new/`, `/content/<id>/` | Information pages (shipping, returns, privacy, terms and others) that replace the shop's starting text when published | Settings |
| `/emails/` | Every email the shop sends: subject and opening words, preview, "Send me a test" | Settings |
| `/shipping/` | The sender address, delivery zones in Nigeria, carriers abroad (on or off, mark-up) and boxes | Settings |
| `/payments/` | Whether Paystack and Stripe are set up, and the currencies (rates, mark-up, rounding, "Fetch today's rates now") | Settings |
| `/reports/` | Sales by day and currency for any dates, top products, and the spreadsheet download | Reports |
| `/staff/` | Staff (invite, change role, reset access, switch off) and roles with what each may see and change | The Owner only |
| `/activity/` | Who changed what, and when | Settings |
| `/settings/` | Store name, help email, WhatsApp number, and the return rules | Settings |
| `/system/` | Scheduled tasks (when each last ran, and any problem) and background jobs, with "Try again" for failed ones | Settings |

A page outside someone's role shows "Your role does not include this page"
and the menu leaves it out. Buttons that change things only appear for
roles that may change that area. Any other address gets the admin's own
"not found" page.

Gift cards, loyalty and reviews come with module 17 and live chat with
module 18; their admin pages are added then.

## Addresses added for this module

All are on `admin.hairbydemj.com`, need a staff session, and check the role.

| Address | What it does |
| --- | --- |
| `GET /api/customers?q=&page=`, `GET /api/customers/:id` | Customers and one customer with orders and addresses |
| `POST /api/customers/:id` | `{ internalNote?, status? }` (status `active` or `disabled`; switching off signs them out) |
| `GET /api/activity?area=&staff=&page=` | The activity log |
| `GET /api/content`, `POST /api/content`, `POST /api/content/:id`, `POST /api/content/:id/delete` | Information pages: `{ slug, title, kind, body, searchDescription, status }` |
| `GET /api/homepage`, `POST /api/homepage/:id` | Homepage sections: `{ position?, isShown?, settings? }`; the banner's settings are `headline`, `sentence`, `buttonLabel`, `buttonLink` (a page on the shop), others take `title` |
| `GET /api/settings/store`, `POST /api/settings/store` | `{ name, supportEmail, whatsapp }` |
| `GET /api/reports/sales?from=&to=`, `GET /api/reports/sales.csv?from=&to=` | Paid sales by day (Lagos time); the spreadsheet is safe to open (no cell can start a formula) |

## How the pages work

- **Forms** carry `data-json-form="<address>"`; each field has `data-key`
  (dots make nested values, so `prices.NGN` sends `{ prices: { NGN: … } }`)
  and `data-type` for numbers, money (typed in naira or dollars, sent in
  kobo or cents), comma lists and tick boxes. Empty number and money fields
  are left out so the server keeps what it has.
- **Buttons** that do one thing carry `data-post` (and `data-confirm` for a
  question first).
- The script keeps nothing between visits except a "Saved." message carried
  across a reload. Without the script the pages still show everything; the
  changes need it.
- Pages are sent with `Cache-Control: private, no-store`, `noindex`, and a
  strict content security policy (scripts and styles from our own address
  only, no framing).

## Checks

- `server/admin/live/admin.test.ts`: signing in and coming back, the "not
  found" page, every page opening for the Owner with real data, the order
  page, roles seeing only their pages and buttons, escaping names, customer
  notes, homepage settings changing the shop's home page, content pages
  replacing the starting text, store and return settings, the activity log,
  the sales report and spreadsheet, the invitation page.
- Walked through in Chromium: accepting an invitation with the
  authenticator code, signing in, every page, saving settings, a field
  error, adjusting stock, editing the homepage banner and seeing it in the
  shop, and the menu at phone width.

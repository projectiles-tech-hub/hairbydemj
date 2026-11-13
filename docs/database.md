# Database

The store's data lives in PostgreSQL 16. The tables are created by numbered
SQL files in `db/migrations/`, applied by our own migration runner. There is
no ORM (a library that writes SQL for you): every query is plain SQL.

## Settings

| Name | Where | What it is |
| --- | --- | --- |
| `DATABASE_URL` | `.env` on your computer; the server's environment settings | Address of the database with its user and password. **Secret.** Form: `postgres://USER:PASSWORD@HOST:PORT/DATABASE`. Required in production. |
| `TEST_DATABASE_URL` | `.env` on your computer; set in GitHub Actions | A PostgreSQL address whose user may create databases. Only for tests. Leave empty to skip the database tests. |

Neither is ever committed. `.env.example` shows the names with placeholder values.

## Set up on your computer

1. Install PostgreSQL 16 (it comes with the `pg_trgm` and `citext`
   extensions the store uses).
2. Create a user and a database. In `psql` as the PostgreSQL administrator:

   ```
   create user hairbydemj with password 'choose-a-password' createdb;
   create database hairbydemj owner hairbydemj;
   ```

   `createdb` lets the tests make their throwaway databases. Leave it out on
   the live server.
3. Copy `.env.example` to `.env` and put your password into `DATABASE_URL`.
   For the tests, set
   `TEST_DATABASE_URL=postgres://hairbydemj:your-password@127.0.0.1:5432/postgres`.
4. Build the tables and load the sample data:

   ```
   npm install
   npm run db:migrate
   npm run db:seed
   ```

## Commands

| Command | What it does |
| --- | --- |
| `npm run db:status` | Lists the migrations that are applied and those waiting |
| `npm run db:migrate` | Applies the waiting migrations, oldest first |
| `npm run db:seed` | Loads sample data from `db/seeds/dev.sql`. Refuses in production and on a database that already has products |
| `npm test` | Runs all tests. The database tests run when `TEST_DATABASE_URL` is set; each run makes its own throwaway database and drops it |

The commands read `.env` if it is there. They need Node.js 22.9 or newer.

## On the live server (module 19)

The same two steps, with no sample data: set `DATABASE_URL` in the server's
environment settings, then run `npm run db:migrate` on every release before
the server restarts. The database user needs to own the database; it does
not need `createdb`.

## How migrations work

- Files are named four digits, an underscore, lower-case words, `.sql`
  (`0003_catalogue.sql`). Numbers run with no gaps.
- Each migration runs inside one transaction. If any statement fails, the
  whole file is undone and the run stops; earlier files stay applied.
- The `schema_migrations` table records each applied file with a checksum
  (a fingerprint of its text).
- **An applied migration is never edited or deleted.** The runner compares
  checksums and refuses to continue if one changed. To change the database,
  add a new file with the next number.
- Two runs at the same time are safe: the second waits for the first.

## The tables

| Migration | Tables |
| --- | --- |
| `0001_base` | `currencies` (NGN, USD, GBP, EUR and how each is converted and rounded) |
| `0002_staff` | `roles`, `role_permissions`, `staff`, `staff_invites`, `staff_sessions`, `activity_log` |
| `0003_catalogue` | `package_sizes`, `categories`, `collections`, `collection_products`, `products`, `product_media`, `variants`, `prices`, `inventory`, `stock_movements` |
| `0004_customers` | `customers`, `customer_identities`, `customer_sessions`, `customer_tokens`, `addresses`, `payment_methods`, `wishlist_items`, `push_devices`, `notification_preferences`, `notifications`, `back_in_stock_requests`, `newsletter_subscribers` |
| `0005_discounts_and_gift_cards` | `discounts`, `discount_amounts`, `gift_cards` |
| `0006_orders` | `carts`, `cart_items`, `orders`, `order_items`, `order_discounts`, `order_events`, `gift_card_transactions`, `payments`, `payment_events`, `shipments`, `shipment_events`, `returns`, `return_items`, `return_media`, `refunds`, `refund_items` |
| `0007_loyalty_and_reviews` | `loyalty_tiers`, `loyalty_transactions`, `referrals`, `reviews`, `review_media` |
| `0008_content_settings_and_chat` | `store_settings`, `carriers`, `local_shipping_rates`, `message_templates`, `content_pages`, `homepage_sections`, `chat_conversations`, `chat_messages`, `saved_replies` |
| `0009_jobs` | `jobs` (work waiting for the background worker) |
| `0011_shop_the_look` | No new table: adds the look marker to `collections` and the chosen variant to `collection_products` |
| `0012_media_processing` | No new table: adds status, sizes and the original's location to `product_media` |
| `0013_cart` | `cart_gift_cards`; rate source on `currencies`; gift card codes added to the guessing limits |
| `0014_payments` | Order access token for guests; payment form details on `payments` |
| `0015_shipping` | Saved delivery quotes (`shipping_quotes`); carrier id, parcels, label format and courier on `shipments` |
| `0016_orders_and_returns` | When an order's stock left the shelf; store credit card on a return; guest order look-up limits |
| `0017_worker` | When each scheduled task last ran (`scheduled_runs`); bag reminders and low-stock alerts sent once |
| `0018_search` | Words the shop knows (`search_words`, rebuilt by the database), search records (`search_queries`) |
| `0019_try_on` | Try-on pictures (`try_on_images`): a see-through wig picture per product and colour, with where the temples sit |
| `0010_sign_in_protection` | `sign_in_attempts` (used to slow down password guessing) |

65 tables in all, counting `schema_migrations`.

## Rules the database itself enforces

- **Money** is whole minor units (kobo, cents, pence) in `bigint` columns
  ending in `_minor`, next to a currency code. Negative prices are refused.
- **One price** per variant per currency.
- **Stock** cannot go below zero, and reserved stock cannot exceed stock on
  hand. Every change is written to `stock_movements`.
- **Order totals must add up**: total = subtotal − discount − points + shipping.
- **A payment counts as succeeded only with a webhook confirmation time.**
- **Orders keep their own copy** of product names, prices and the address,
  so later edits never change past orders.
- **Emails, SKUs and discount codes** ignore letter case when compared.
- **Secrets are stored as hashes**: session tokens, one-time codes, invite
  links and gift card codes. Passwords use scrypt (module 3).
- **Card numbers are never stored**; only the provider's reference and the
  last four digits.
- **Carrier and payment keys are not in the database**; they stay in the
  server's environment settings.
- **Staff cannot be active** without a password and two-step verification.
- **Search**: products have a full-text search column kept up to date by the
  database, and a trigram index on the name so typing mistakes still match.

## Choices made here, to confirm

These were needed to build the tables and were not fixed by the plan. Each
can be changed with a new migration.

| Choice | Why |
| --- | --- |
| Staff permission areas are the seven in the admin design: orders, returns, products, customers, discounts, settings, reports | Inventory, categories and reviews fall under products; gift cards and loyalty under discounts; shipping, payments, content, staff and store settings under settings |
| Only the Owner role is created by the migrations; Manager, Fulfilment and Support are in the sample data | Their exact permissions are the owner's to set in the admin |
| Order statuses: on hold, to fulfil, shipped, delivered, returned, cancelled. Payment status is separate: awaiting, paid, failed, partly refunded, refunded | Matches the tabs and columns of the admin Orders page |
| Order numbers start at HBD-10001; return numbers at RET-201 | Matches the format in the designs |
| Lace type and cap size are on the variant, as in the build plan; texture, origin and grade are on the product | The admin product editor shows lace type next to texture; a product's variants can share one value |
| Loyalty rules, return window and similar single values are in `store_settings`, not in their own tables | They are a handful of numbers the owner has not yet fixed |
| NGN converted prices round to the nearest ₦500; other currencies to a whole unit | From the admin Payments and currencies design |

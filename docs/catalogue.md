# Catalogue

Products, variants, prices, stock, categories, collections and
shop-the-look sets. The code is in `server/catalog/`. No package was added.

## Who uses what

| Who | Address | What they can do |
| --- | --- | --- |
| Website | `hairbydemj.com/api/catalog/...` | Read only, no sign-in |
| Phone app | `api.hairbydemj.com/v1/catalog/...` | Read only, no sign-in |
| Staff | `admin.hairbydemj.com/api/...` | Read with the "products" view permission; change with the "products" change permission |

Every change staff make is written to the activity log.

## How the catalogue is put together

- **Product**: the thing with a name and a page. It carries the hair
  attributes shared by all its variants: origin, texture and grade; also
  description, care guide, category, tags, package size, customs details and
  search (SEO) text.
- **Variant**: what is actually bought. Length, density, colour, lace type,
  cap size, SKU, weight and package dimensions. One product has many.
- **Price**: one per variant per currency, in whole minor units (kobo,
  cents, pence). Staff type the naira price; the other three are either
  typed by staff or worked out from the naira price (rate, plus the markup,
  rounded as the currency settings say). A typed price is never overwritten
  by conversion.
- **Stock**: per variant: on hand, reserved for orders, and a low-stock
  alert level (3 unless changed). Every change is kept with its reason.
- **Category**: a tree (Wigs, with Lace front wigs inside it). A product is
  in one category. Listing a category includes its sub-categories.
- **Collection**: a group that cuts across categories. Either hand-picked,
  or filled by rules.
- **Shop-the-look set**: a hand-picked collection marked as a look. Each
  piece names the exact variant that goes in the bag, so the whole look can
  be added in one tap. (Migration `0011_shop_the_look.sql`.)

## What customers can and cannot see

- Only products that are **published**, or scheduled and past their time.
- Only variants that are **switched on** and have a **price in the
  currency asked for**. A product with no such variant is not offered in
  that currency.
- Stock is shown as "available" up to **10**, never the exact number, with
  a low-stock flag.
- Draft collections are not shown.

## Product lists (endless scrolling)

`GET /products` returns one page and a `nextCursor`. Sending the cursor back
returns the next page, exactly from where the last one stopped, so nothing
is repeated or skipped even if products are added meanwhile. `nextCursor` is
empty at the end of the list. The total number of matches comes with the
first page only. A page holds 24 products unless `limit` (at most 48) says
otherwise.

| Parameter | Meaning |
| --- | --- |
| `currency` | NGN, USD, GBP or EUR. Naira if left out. |
| `category`, `collection` | Their web names (slugs), for example `wigs` |
| `texture`, `origin`, `lace_type`, `colour` | One or more values, separated by commas |
| `length`, `density` | One or more whole numbers, separated by commas |
| `min_price`, `max_price` | In minor units of the chosen currency |
| `in_stock=1` | Only what can be bought now |
| `sort` | `newest` (default), `best_selling`, `price_low`, `price_high`, `name` |
| `cursor`, `limit` | Paging, as above |

Filters on a variant (length, colour, lace type, density, price, in stock)
must all be true of the **same** variant. Asking for 26 inches in stock only
lists products whose 26-inch variant is in stock.

Other shop addresses: `GET /categories` (the menu tree with product counts),
`GET /collections` (add `?looks=1` for shop-the-look sets),
`GET /filters` (the choices to offer in the filter panel),
`GET /products/:slug` (the product page) and `GET /looks/:slug`.

## Collection rules

| Rule | Example |
| --- | --- |
| Added in the last N days | New arrivals: 30 days |
| Top N by sales | Best-sellers: top 20. Counts paid orders only. |
| Category is | `wigs` (includes sub-categories) |
| Tag is, texture is, origin is | `bundles`, `Body wave`, `Vietnamese` |

A collection needs every one of its rules to hold. A rule-based collection
fills itself; products cannot be added to it by hand.

## Staff addresses

All on the admin address. Changes are `POST` with a JSON body.

| Address | What it does |
| --- | --- |
| `GET /api/products` | List with search (name or SKU) and filters: `status`, `category_id`, `stock` (in, low, out), `texture`, `origin`, `page`, `per_page` |
| `POST /api/products` | Create a product (starts as a draft) |
| `GET /api/products/:id`, `POST /api/products/:id` | Read; edit (including `status` and `collectionIds`) |
| `POST /api/products/:id/delete` | Delete, or unpublish if it has orders |
| `POST /api/products/:id/variants` | Add one variant |
| `POST /api/products/:id/variants/generate` | Make a variant for every combination of the lengths, densities and colours given. Existing combinations are skipped. SKUs are made from a prefix, for example `WIG-22-180-NB`. |
| `POST /api/variants/:id`, `POST /api/variants/:id/delete` | Edit (including `prices` and `autoConvert`); delete, or switch off if it has orders |
| `GET /api/inventory` | Stock list: `low=1`, `category_id`, `q`, paging |
| `POST /api/inventory/:id/adjust` | `mode` add, remove or set; `quantity`; `reason` received, damaged, correction or supplier_return; optional `note` |
| `GET /api/categories`, `POST /api/categories`, `POST /api/categories/:id`, `POST /api/categories/:id/delete` | Categories. One that still has products or sub-categories cannot be deleted. |
| `GET /api/collections`, `POST /api/collections`, `GET /api/collections/:id`, `POST /api/collections/:id`, `POST /api/collections/:id/delete` | Collections and looks. `kind` manual or rules; `rules`; `isLook`; `items` (a list of `productId` and optional `variantId`). |

## Rules worth knowing

- Stock cannot be taken below zero, or below what is held for orders.
- Two stock changes at the same moment are both counted.
- A product or variant that has ever been ordered is never deleted, so
  order history stays whole. It is unpublished or switched off instead.
- Two products can share a name; the second gets a web name ending in `-2`.
- Converting prices needs the exchange rates, which are set under Payments
  and currencies (module 6). Until a rate is set, staff type that price.

## Not in this module

Photos and video for products are module 5 (Media). Typing-mistake
tolerant search of the shop is module 12 (Search); the database is already
prepared for it. Reserving stock for orders is module 9.

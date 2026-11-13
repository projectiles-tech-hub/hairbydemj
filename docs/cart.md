# Cart, currencies, discounts and gift cards

The code is in `server/cart/`. No package was added.

## Currencies

- The shop sells in **NGN, USD, GBP and EUR**. Naira is the base: other
  prices can be worked out from it.
- **Which currency a visitor sees first:** their own earlier choice (kept on
  their cart, and on their account when signed in), otherwise their
  country's: Nigeria NGN, United Kingdom GBP, euro countries EUR, everywhere
  else USD. The country comes from Cloudflare's `CF-IPCountry` header, which
  is only believed when `TRUST_PROXY` is true.
- **Switching** currency re-prices the whole cart at once.
- **Rates:** each currency has a rate (how much one naira buys), a markup
  and a rounding step. The rate is either fetched each day ("daily") or
  typed by staff ("manual"; typing a rate sets this). When a rate, markup or
  rounding changes, every price that was **worked out** from the naira price
  is worked out again. Prices staff **typed** are never changed.
- **Daily rates** come from a free service that needs no key
  (`https://open.er-api.com/v6/latest/NGN`, set by `RATES_URL`). A rate that
  moves more than 20% in one go is not applied; the activity log says so,
  and staff can set it by hand. The daily run is scheduled in module 10;
  staff can also run it from the admin.
- **Rounding:** money is always whole minor units. Converted prices are
  rounded to the currency's step (₦500, or a whole dollar, pound or euro, by
  default). Percentage discounts are rounded down, never up.

## The cart

- A **guest** cart is found by a random token: a cookie on the website
  (`hbd_cart`, 60 days, scripts cannot read it), or the `X-Cart-Token`
  header from the phone app, which receives the token once as `cartToken`.
  The token is stored only as a hash.
- A **signed-in customer** has one cart, shared by the website and the app.
  When someone signs in with a guest cart, it is merged into their cart (the
  same item in both keeps the larger quantity) and the guest cart is removed.
- The cart stores only items and quantities. **Prices, stock, discounts and
  gift cards are worked out fresh every time it is read**, so the customer
  always sees today's price and today's stock.
- Adding more than is in stock is refused, with how many are left. Up to 20
  of one item, and 50 different items, per cart.
- If an item later sells out, runs short, loses its price in the chosen
  currency or leaves the shop, it stays in the bag with a `problem`
  (`sold_out`, `not_enough_stock`, `no_price`, `unavailable`), is left out of
  the totals, and checkout waits until it is fixed.
- Website requests that change the cart must come from our own pages.

## Holding stock (so the last one cannot be sold twice)

The cart itself does not hold stock. At checkout (modules 7 and 9) the order
holds it with `holdStock`: one database statement per item that only
succeeds when enough is free at that instant, all items or none. Twenty
customers pressing "pay" for the last wig at the same moment: one gets it,
nineteen are told it has just sold out. Held stock is let go when an order
is not paid (`releaseStock`), taken off the shelf when shipped
(`shipStock`, recorded as a sale) and put back when returned (`restock`).

## Discounts

| Kind | What it does |
| --- | --- |
| Percentage | Takes a percentage off the items it covers |
| Fixed amount | Takes an amount off, set per currency. Not offered in a currency with no amount. |
| Free shipping | Delivery is free (applied at checkout, module 8) |
| Buy X get Y | In every group of X + Y covered items, the Y cheapest are free |

Each discount can be:

- a **code** the customer types, or **automatic** (no code: it applies by itself);
- limited to **categories** (with their sub-categories), **collections**
  (hand-picked or rule-based) or **products**;
- for **everyone**, **first orders only**, or **Gold and Platinum** members;
- limited in **total uses**, **uses per customer**, a **minimum order** per
  currency, and **start and end** times;
- **combinable** or not.

**Choosing the discounts:** combinable discounts are used together; one that
is not combinable is used alone. Of the possible combinations, the one that
saves the customer most is chosen (free delivery breaks ties). If a code the
customer typed loses to a better deal, the cart says so:
"A better deal is already applied, and this code cannot be combined with it."
Every refusal comes with a plain reason (below the minimum, first orders
only, used up, not for this currency, nothing in the bag it covers, and so on).

"Uses per customer" and "first orders only" are checked against paid orders,
by account and by email. For a guest they are checked again at checkout,
once the email is known.

## Gift cards

- A code looks like `ACDE-FGHJ-KMNP-QRTU` (letters and digits that cannot be
  confused). Spaces, dashes and letter case do not matter when typed. Codes
  are stored only as hashes; the last four characters are kept for display.
- A card can only be used in its own currency. Up to 5 cards per order.
  Each covers what is left after discounts and the cards before it.
- Wrong codes count as failed tries: 5 per cart and 30 per visitor address in
  15 minutes, then even a right code waits. This stops codes being guessed.
- The balance is taken off when the order is paid (module 9). Buying gift
  cards is module 17.

## Addresses

Website under `/api`, phone app under `/v1`:

| Address | What it does |
| --- | --- |
| `GET /currency` | Currencies on offer, the one to show now, and the country's suggestion |
| `GET /cart` | The cart, fully priced |
| `POST /cart/items` | `{ variantId, quantity }` add |
| `POST /cart/items/:id` | `{ quantity }` change; 0 removes |
| `POST /cart/items/:id/delete` | Remove |
| `POST /cart/currency` | `{ currency }` |
| `POST /cart/discount`, `POST /cart/discount/delete` | `{ code }` apply; remove |
| `POST /cart/gift-cards`, `POST /cart/gift-cards/:id/delete` | `{ code }` apply; remove |

Admin (needs "settings" for currencies, "discounts" for discounts):

| Address | What it does |
| --- | --- |
| `GET /api/currencies` | Rates and settings |
| `POST /api/currencies/:code` | `rateFromBase`, `rateSource` (daily or manual), `markupBps` (100 = 1%), `roundingMinor`, `enabled` |
| `POST /api/currencies/refresh` | Fetch the daily rates now |
| `GET /api/discounts`, `POST /api/discounts`, `GET /api/discounts/:id`, `POST /api/discounts/:id` | List, create, read, edit. Fields: `name`, `code`, `kind`, `percentBps` (1000 = 10%), `buyQuantity`, `getQuantity`, `appliesTo`, `targetIds`, `customerGroup`, `totalUsesLimit`, `perCustomerLimit`, `combinable`, `startsAt`, `endsAt`, `status` (draft, active, disabled), `amounts` (per currency: `amountMinor`, `minOrderMinor`) |
| `POST /api/discounts/:id/delete` | Delete; a discount that has been used is switched off instead |

Every change is in the activity log.

## Settings

| Name | Secret? | What it is |
| --- | --- | --- |
| `RATES_URL` | No | Where daily rates are fetched. Default `https://open.er-api.com/v6/latest/NGN` (free, no key). |

# Website

The customer website on `hairbydemj.com`, built from the approved designs
in plain HTML, CSS and TypeScript. Pages are made on the server with real
data, so every page works and can be found by search engines without the
browser script; `browser/store.ts` (served as `/js/store.js`) makes the bag,
checkout, search and forms quicker. The code is in `server/site/store/`.

The design preview (`server/site/pages.ts`, `layout.ts`, `pages/`, sample data)
is kept as it was, for the online preview; the live pages are separate.

## Pages

| Address | Page |
| --- | --- |
| `/` | Home: categories, best-sellers, new arrivals, looks |
| `/c/<category>/` | A category with filters (texture, length, density, lace, colour, origin, price, in stock) and sorting; "Show more" loads the next products |
| `/search/?q=` | Search results with the same filters (see `search.md`); suggestions appear while typing in the header |
| `/products/<slug>/` | Product: photos, choosing length, density, lace and colour, price and exact stock for that choice, add to bag, wishlist |
| `/looks/`, `/looks/<slug>/` | Shop the look, with "Add the set to bag" |
| `/cart/` | The bag: quantities, discount code, gift cards, summary |
| `/checkout/` | Contact, address (saved addresses for signed-in customers), delivery options with prices and times, review, then pay |
| `/checkout/complete/?order=` | Where Paystack and Stripe send the customer back; shows confirmed, failed (with "Try again") or still checking |
| `/sign-in/`, `/create-account/`, `/verify-email/`, `/forgot-password/`, `/reset-password/?token=` | Signing in and up |
| `/account/`, `/account/orders/`, `/account/orders/<number>/` | Overview, orders, one order with tracking, returns, invoice, pay or cancel |
| `/account/addresses/`, `/account/profile/`, `/account/preferences/`, `/account/wishlist/` | Addresses, details and password (and closing the account), email and app choices, wishlist |
| `/track-order/` | A guest's order, by the private link in the order email or by order number and email |
| `/about/`, `/contact/`, `/faq/`, `/guides/`, `/guides/length-and-density/`, `/shipping/`, `/returns/`, `/privacy/`, `/terms/`, `/cookies/` | Information pages: what staff publish in the admin, or the starting text until then |
| `/sitemap.xml`, `/robots.txt` | For search engines |

Any other address gets the shop's own "not found" page.

Gift card buying (`/gift-cards/`), the AR try-on (`/try-on/`), loyalty and
reviews come with modules 16 and 17. Saved cards are not offered.

## Paying

- **Naira (Paystack):** after the order is placed, the customer goes to
  Paystack's payment page (card, bank transfer, USSD) and comes back to
  `/checkout/complete/`.
- **Dollars, pounds, euros (Stripe):** Stripe's own card form (with Apple Pay
  and Google Pay) appears on the checkout page. It is the only script
  loaded from outside, and only on pages where it is needed.
- The complete page asks our server every 2 seconds whether the payment has
  been confirmed by the provider's webhook. A guest's order key is kept in
  the browser tab for this.
- If paying cannot start (for example the provider is unavailable), the
  order is kept with its stock for 30 minutes and the customer is given the
  link to their order, which has a "Pay now" button.

## Search engines

Every page has its own title and description; product, category and
information pages have a canonical address; filtered and private pages are
marked not to be indexed; the home page carries the organisation and site
search, product pages carry product details with price and stock, and lists
carry breadcrumbs (schema.org JSON-LD). The sitemap lists categories,
published products, looks and information pages.

## Safety

Every page is sent with a content security policy (only our own scripts, plus
Stripe's form and Google's sign-in button where used), no framing, no
sniffing, and a strict referrer policy. Forms change things only through
the JSON addresses, which check the request comes from our own site. Cookies:
`hbd_cart`, `hbd_session`, `hbd_currency` (the chosen currency) and
`hbd_cookies` (the cookie notice was seen); nothing for advertising.

## New customer addresses (for the website and the app)

Added in this module (website `/api`, app `/v1`):

| Address | What it does |
| --- | --- |
| `GET`, `POST /account/profile` | Name, phone, birthday |
| `POST /account/password` | Change the password; other devices are signed out |
| `POST /account/delete` | Close the account; orders are kept without the person's details |
| `GET`, `POST /account/addresses`, `POST /account/addresses/:id`, `.../:id/delete` | Saved addresses; the first is the default |
| `GET`, `POST /wishlist`, `POST /wishlist/:productId/delete` | The wishlist |

The website also uses two of its own: `GET /api/site/mini-cart` and
`GET /api/site/products` (the next products of a list), which answer with
ready-made HTML.

## Google sign-in on the website

When `GOOGLE_CLIENT_IDS` is set, the sign-in page shows Google's
"Continue with Google" button (Google's own script). In the Google Cloud
console, add `https://hairbydemj.com` as an authorised JavaScript origin of
the web client ID.

## Checks

- `server/site/store/store.test.ts`: every page with real data, filters,
  currencies, the bag and checkout pages, sign-in protection, someone
  else's order, guest order links and look-up, customer details, addresses,
  wishlist, password change, closing an account, information pages, the
  sitemap and robots.txt.
- Walked through in a real browser (Chromium) at desktop and phone widths:
  home, category, product, choosing a variant, adding to the bag, the
  mini-bag, checkout to delivery options and review, and placing the order.

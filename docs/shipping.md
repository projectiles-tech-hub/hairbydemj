# Shipping

Delivery inside Nigeria uses the zones and prices staff set. Delivery abroad
uses live prices from **DHL Express**, **UPS** and **FedEx**, called directly
over their REST APIs (no SDK, no middleman, no package added). After payment
the carrier label is bought, and tracking is read back from the carrier. The
code is in `server/shipping/`.

## Settings (all from the server's environment, never committed)

Each carrier is optional. A carrier whose settings are empty is simply left
out of checkout, and the admin shows it as "not set up".

| Name | Secret? | Where to find it |
| --- | --- | --- |
| `DHL_API_KEY` | **Yes** | DHL developer portal (developer.dhl.com), your app for "DHL Express - MyDHL API" |
| `DHL_API_SECRET` | **Yes** | Same app |
| `DHL_ACCOUNT_NUMBER` | No | Your DHL Express account number (9 digits), from your DHL account manager |
| `DHL_API_URL` | No | Leave empty for live. For testing: `https://express.api.dhl.com/mydhlapi/test` |
| `UPS_CLIENT_ID` | **Yes** | UPS developer portal (developer.ups.com), your app's Client ID |
| `UPS_CLIENT_SECRET` | **Yes** | Same app, Client Secret |
| `UPS_ACCOUNT_NUMBER` | No | Your 6-character UPS shipper number |
| `UPS_API_URL` | No | Leave empty for live. For testing: `https://wwwcie.ups.com` |
| `FEDEX_API_KEY` | **Yes** | FedEx developer portal (developer.fedex.com), your project's API key |
| `FEDEX_SECRET_KEY` | **Yes** | Same project, secret key |
| `FEDEX_ACCOUNT_NUMBER` | No | Your 9-digit FedEx account number |
| `FEDEX_API_URL` | No | Leave empty for live. For testing: `https://apis-sandbox.fedex.com` |

When a test address is set, the admin shows that carrier as "test".

### Getting each carrier ready

1. **DHL Express**: open a DHL Express business account in Nigeria, then ask
   your DHL account manager for MyDHL API access. Create an app on
   developer.dhl.com for the MyDHL API to get the key and secret.
2. **UPS**: open a UPS account, create an app on developer.ups.com with the
   Rating, Shipping, Tracking and OAuth products, and link your shipper number.
3. **FedEx**: open a FedEx account, create a project on developer.fedex.com
   with the Rate, Ship and Track APIs.
   **FedEx label certification:** before FedEx allows real shipments, it
   checks sample labels printed from our system. With the test settings in
   place, buy one label for each service we offer (from an order in test
   mode), print them, and send them to FedEx as their portal describes.
   FedEx then turns on the live key. This is a launch step (module 21).

## Set up in the admin (Settings area)

1. **Store address** (`POST /api/shipping/origin`): the address, name and
   phone printed on labels as the sender, and the country where the hair is
   made (for customs forms; defaults to the store's country). International
   prices are not fetched until this is set.
2. **Boxes** (`/api/shipping/package-sizes`): the boxes you pack in, with
   inside size in millimetres and empty weight in grams. Choose a box on each
   product (its "package size") if it always goes in a particular box, such
   as a wig box.
3. **Carriers** (`/api/shipping/carriers/:code`): switch each carrier on,
   set its markup (hundredths of a percent: 500 = 5%), and optionally limit
   it to the services you want, each with the name to show customers, for
   example `[{"code": "65", "name": "UPS Saver"}]`. With no list, every
   service the carrier offers is shown. A carrier can only be switched on
   once its settings are on the server.
4. **Local zones** (`/api/shipping/local-rates`): for delivery inside
   Nigeria, a zone is a name, the states it covers, the courier, the price
   in kobo and the delivery time in words ("1 to 2 working days"). A state
   can be in one zone only. A zone with no states covers everywhere not in
   another zone.

## How delivery is priced at checkout

1. The customer gives their address and the website or app asks
   `POST /shipping/quote` (on `/api` for the website, `/v1` for the app).
2. The bag is packed into boxes: the smallest box that fits the items, with
   a little spare room, under 30 kg; more boxes if needed. Items with no size
   count as a small bundle. With no boxes set up, a standard 35 x 25 x 12 cm
   box is assumed.
3. **Inside Nigeria:** the zone for the customer's state is offered, or the
   "everywhere else" zone. Prices are in naira and converted at today's rate
   if the customer pays in another currency.
4. **Abroad:** every carrier that is on is asked at once. Each price is in
   the carrier's billing currency; it is turned into the customer's currency
   at today's rate, the carrier's markup is added, and it is rounded up to
   the currency's rounding (whole dollars, pounds, euros; ₦500). A carrier
   that fails is skipped and noted in the server log; the others still show.
5. Options are sorted cheapest first, each with its estimate ("3 working
   days"). A free-delivery discount makes the cheapest option free.
6. The answer is saved as a **quote for 30 minutes**, with a random id.
   Checkout (module 9) sends the quote id and the chosen option; the server
   checks the quote belongs to the same bag, the same currency and the same
   address and is still fresh, so the price charged is always the price shown.
   What the label costs us is stored with the quote but never sent to customers.

## Duties and taxes

International parcels are sent **duties paid by the receiver** (DAP), the
owner's decision of 2026-10-29. Each carrier is told so (DHL `incoterm: DAP`,
UPS bills only transport to our account, FedEx `dutiesPayment: RECIPIENT`).
Every quote for an address outside Nigeria carries this notice, which the
website and app must show beside the delivery options:

> Delivery prices do not include import duties or taxes. If your country
> charges them, the carrier will ask you to pay them when your parcel arrives.

Checkout records on the order that the notice was shown (`duties_notice_shown`).

## After payment: labels

- When a payment is confirmed, an order going by DHL, UPS or FedEx gets a
  `buy_label` job queued (the worker in module 10 runs it). Staff can also
  press "Buy label" (`POST /api/orders/:id/label`, needs orders change).
- The label is bought for the service the customer chose, with customs
  details for international parcels: each item's customs description and
  HS code from the product, its price, weight and country of making.
- Label files are saved in `MEDIA_DIR/private/labels/`, which is **never
  served to the public**. Staff print them from
  `GET /api/shipments/:id/label` (`?parcel=2` for the second box). DHL and
  FedEx give PDF labels (4 x 6 inches); UPS gives a GIF image.
- Buying twice gives back the same label; the carrier is not asked again. A
  failed attempt leaves nothing half-made and a note on the order saying
  what went wrong, so it can be tried again or the label bought on the
  carrier's own site.

## Local courier orders

Staff hand the parcel to the courier and record it:
`POST /api/orders/:id/dispatch` with `courier`, and optionally
`trackingNumber` and `trackingUrl`. The order becomes "shipped". When the
courier delivers, staff press "Delivered"
(`POST /api/shipments/:id/delivered`).

## Tracking

- Carrier parcels still on the way are checked every 2 hours by the worker
  (module 10), or at once by staff (`POST /api/shipments/:id/track`).
- New scans are saved once each. The order moves to **shipped** at the first
  movement and to **delivered** when every parcel has arrived. A late scan
  never undoes a delivery. The customer sees "on its way", "out for delivery",
  "delayed" and "delivered" on their order's timeline.
- Customers see their parcels with `GET /orders/:number/tracking` (their own
  order, or a guest with the order's token).

## Addresses

| Who | Address | What it does |
| --- | --- | --- |
| Customer | `POST /api/shipping/quote`, `POST /v1/shipping/quote` | Delivery options for the bag |
| Customer | `GET /api/orders/:number/tracking`, `GET /v1/orders/:number/tracking` | Where the parcels are |
| Staff | `GET`, `POST /api/shipping/origin` | Store address on labels (settings) |
| Staff | `GET /api/shipping/carriers`, `POST /api/shipping/carriers/:code` | Carriers on or off, markup, services (settings) |
| Staff | `/api/shipping/local-rates`, `.../:id`, `.../:id/delete` | Zones inside Nigeria (settings) |
| Staff | `/api/shipping/package-sizes`, `.../:id`, `.../:id/delete` | Boxes (settings) |
| Staff | `GET /api/orders/:id/shipments` | An order's parcels and scans (orders view) |
| Staff | `POST /api/orders/:id/label` | Buy the label (orders change) |
| Staff | `POST /api/orders/:id/dispatch` | Record a local courier dispatch (orders change) |
| Staff | `GET /api/shipments/:id/label` | Print a label (orders view) |
| Staff | `POST /api/shipments/:id/track` | Ask the carrier now (orders view) |
| Staff | `POST /api/shipments/:id/delivered` | A local delivery arrived (orders change) |

## Tests

`server/shipping/shipping.test.ts` runs against stand-in DHL, UPS and FedEx
servers built from each carrier's published API description: prices,
currency conversion and markup, failed carriers, free delivery, quotes that
cannot be tampered with, labels for all three, private label files,
tracking for all three, and local courier orders.

**Still to do with real accounts (module 20):** one test run against each
carrier's test address, to confirm their live answers match what the
stand-ins send. Any difference in field names is fixed then.

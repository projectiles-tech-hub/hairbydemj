# Orders and returns

Checkout, what happens to an order after it is placed, and returns. The code
is in `server/orders/`. No new settings are needed on the server.

## Checkout

The website (`POST /api/checkout`) and the app (`POST /v1/checkout`) send:

| Field | What it is |
| --- | --- |
| `email` | Needed for guests. Signed-in customers use their account email unless they give another. |
| `address` | `name`, `phone`, `line1`, `line2`, `city`, `region` (the state, for Nigeria), `postalCode`, `country` |
| `quoteId`, `shippingOption` | From `POST /shipping/quote` (see `shipping.md`) |
| `note` | Optional, up to 500 characters |
| `saveAddress` | Signed-in customers: keep the address in their account (the first becomes the default) |

In one go, all or nothing:

1. The bag is priced again from today's prices, stock and discounts. If
   anything in it has a problem, checkout stops and the bag shows why.
2. The delivery price comes only from the saved quote: same bag, same
   currency, same address, under 30 minutes old. If the free-delivery
   situation changed since, the customer is asked to choose again.
3. The stock is held. If another customer took the last one a moment
   earlier, nothing is written and the customer is told.
4. The order is written with its own copy of names, prices, discounts and
   the address, so later changes to products never alter it.
5. Gift cards in the bag are spent against the full total, delivery
   included. If they cover everything, the order is paid at once.
6. The bag is emptied, and an order confirmation email is queued with the
   order's private link for guests.

The answer carries the order and, once only, the **order token**: the guest's
key to the order (it goes in the `X-Order-Token` header or `?token=`). It is
stored only as a fingerprint. The customer then pays (`payments.md`).

## Order statuses

| Status | Meaning | How it gets there |
| --- | --- | --- |
| `on_hold` | Placed, waiting for payment; stock held 30 minutes | Checkout |
| `to_fulfil` | Paid; to pack and send | The payment webhook, or gift cards covering it all |
| `shipped` | Left us | The first carrier scan, or staff recording a local courier dispatch |
| `delivered` | Every parcel arrived | Carrier tracking, or staff for local couriers |
| `returned` | Every item came back and was refunded | A return refunded |
| `cancelled` | Not going ahead | Not paid in time, the customer gave up before paying, or staff |

Payment has its own status beside it: `awaiting`, `paid`, `failed`,
`partly_refunded`, `refunded`. Money put back on gift cards counts as refunded.

**Stock:** checkout holds it; dispatch takes it off what is on hand (once per
order, recorded as a sale); cancelling before dispatch lets it go; a return
puts back only the items staff say are fit to sell.

**Unpaid orders:** after 30 minutes the worker (module 10) cancels them and
lets the stock and any gift card money go. If the payment still arrives
later, the order comes back if the stock and gift card money are still
there; otherwise the payment is refunded in full automatically.

## Customers

| Address | What it does |
| --- | --- |
| `GET /orders` | A signed-in customer's orders, 20 a page (`?page=2`) |
| `POST /orders/lookup` | A guest gives the order number and email and sees the order. Five wrong tries in 15 minutes lock that order number for a while. |
| `GET /orders/:number` | One order: items, totals, address, delivery, the timeline the customer may see, parcels, returns, and what they may do now (`canPay`, `canCancel`, `canReturn`) |
| `POST /orders/:number/cancel` | Give up on an unpaid order |
| `GET /orders/:number/invoice` | A printable invoice page once paid |
| `POST /orders/:number/returns` | Ask for a return (below) |
| `POST /orders/:number/returns/:id/cancel` | Withdraw a return that has not been decided |

All are under `/api` on the website and `/v1` in the app. Someone else's
order looks exactly like an order that does not exist.

## Returns

The return window and the store credit bonus are store settings staff can
change (`GET`/`POST /api/settings/returns`, settings area). Until changed,
the sample figures from the designs apply: **14 days after delivery** and a
**10% bonus** for store credit. The owner should confirm or change them.

1. **Asked.** The customer picks items, how many, and a reason for each
   (`wrong_item`, `wrong_length`, `damaged`, `not_as_described`,
   `changed_mind`, `other`), and money back (`refund`) or store credit
   (`store_credit`). Only delivered orders, inside the window, and not more
   than was bought less what is already in a return. A final-sale item can
   only come back for a fault (wrong, wrong length, damaged, not as
   described).
2. **Approved or declined** by staff, with a note the customer sees (a note
   is required to decline) and optionally the tracking number of the return
   parcel.
3. **Received.** Staff note the condition and tick the items that go back on
   sale; the rest are written off.
4. **Refunded.** Each item's refund is its price less its share of the
   order's discounts. Staff can add the delivery charge back (for our
   mistakes); it is given back once at most. Money goes first to the card or
   bank payment it came from, then back to any gift card used. With store
   credit, a new gift card for the amount plus the bonus is emailed to the
   customer instead. When every item of an order has come back, the order
   becomes `returned`.

The customer gets an email at each step (sent by module 11).

## Staff

| Address | What it does | Needs |
| --- | --- | --- |
| `GET /api/orders` | List, 50 a page; filters `status`, `payment`, `q` (number, email, name, phone), `from`, `to` (YYYY-MM-DD); counts per status | orders view |
| `GET /api/orders/:id` | Everything, including staff notes and who did what, and the customer's account | orders view |
| `GET /api/orders/:id/invoice` | Printable invoice | orders view |
| `POST /api/orders/:id/notes` | `{ note }`, seen by staff only | orders change |
| `POST /api/orders/:id/address` | Correct the address before a label is bought or the parcel sent; same country only | orders change |
| `POST /api/orders/:id/cancel` | `{ reason }` before dispatch: stock and gift cards go back and every payment is refunded in full; the customer is emailed | orders change |
| `GET /api/returns`, `GET /api/returns/:id` | Returns, filter `status` | returns view |
| `POST /api/returns/:id/decide` | `{ decision: approve or reject, note, trackingNumber }` | returns change |
| `POST /api/returns/:id/receive` | `{ conditionNote, restock: [order item ids] }` | returns change |
| `POST /api/returns/:id/refund` | `{ includesShipping }` | returns change |

Every staff change is written to the activity log and, where it matters to
the customer, to the order's timeline.

## Tests

`server/orders/orders.test.ts`: guest and signed-in checkout on the website
and app, refused details and tampered prices, the last item, gift cards
paying in full and in part, unpaid orders expiring and late payments, guest
look-up limits, staff notes, address changes, invoices, cancelling with
refunds, stock at dispatch, and returns end to end with money back, gift
card refunds, store credit, final-sale rules, declined and withdrawn
returns, and the window closing.

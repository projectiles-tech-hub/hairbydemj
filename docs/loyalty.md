# Loyalty, referrals, reviews and gift cards

Module 17. On the website, in the app and in the admin.

## Loyalty points

| Earned for | When | Sample rule |
| --- | --- | --- |
| Orders | Once the order is delivered; taken back in part when goods are refunded | 1 point for each ₦1,000 of goods (other currencies are converted at today's rate) |
| Reviews | When staff publish the review, once | 50 points, or 100 with photos |
| Birthday | On the day, once a year (the customer adds the date in their details) | 200 points |
| Referrals | When the invited friend's first order is delivered | 500 points to each |

Spending: at checkout a signed-in customer types how many points to use.
Each point is worth ₦10 (converted for other currencies); at least 500 at
a time, for up to 50% of the items (not delivery). The points come off when
the order is placed and come back if it is cancelled or runs out of time
unpaid.

Tiers come from the points earned in the last 12 months (Bronze from 0;
the sample data adds Gold at 1,000 and Platinum at 5,000). A tier's
benefit is words shown to the customer; any discount for a tier is set up
as a discount for "Gold and Platinum members" (`cart.md`).

**All figures above are samples for the owner to confirm.** They are changed
in the admin under **Loyalty and referrals**, saved in `store_settings`
(`loyalty`).

The worker works out order and referral points every 30 minutes and
birthday points once a day (`worker.md`). Every change is a row in
`loyalty_transactions`.

## Referrals

Each customer has a code (DEMJ and six letters), made the first time they
open **Points and referrals**, and a link
`https://hairbydemj.com/create-account/?ref=CODE`. A friend who signs up
with the code (website or app) is linked to them; the reward is given when
the friend's first order is delivered.

## Reviews

- Only items delivered to the customer can be reviewed, once per product.
  The review shows their first name and initial and "Verified buyer".
- Up to 4 photos (resized, with camera details and location removed).
- Every review waits until staff publish it (**Reviews** in the admin). Staff
  can hide it again and reply; the customer is emailed the first reply.
- Product pages show the average, the reviews and (for search engines) the
  rating in the page's structured data.

## Gift cards

- **Buying:** on `/gift-cards/` or in the app, for any amount between
  ₦5,000 and ₦2,000,000 (or 10 to 1,500 USD, 10 to 1,200 GBP, 10 to 1,400
  EUR), to an email address, with a message and an optional day to send
  it. It is paid like any order. When the payment is confirmed the card gets
  its code and is emailed to the person on that day. Cards last 2 years and
  cannot be returned.
- **Checking a balance:** by code, on the same page or in the app. Wrong codes
  count against the visitor, like typing codes at checkout.
- **Using one:** at checkout, as before (`cart.md`).
- **Staff:** **Gift cards** in the admin lists every card (bought, issued,
  store credit), issues a card with a reason (emailed to the person; staff
  never see the code), and switches cards off and on. If a bought card's
  order is refunded, switch the card off there.

## Addresses

See the list at the top of `server/loyalty/routes.ts`. Shop addresses are
under `/api` on the website and `/v1` for the app; staff addresses are on
the admin address.

## Emails

Two new emails, changeable under **Emails** in the admin: the gift card (to
the person receiving it) and the reply to a review.

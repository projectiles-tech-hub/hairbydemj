# User journeys and wireframes

**Status:** Built in Figma (module D2), awaiting the owner's review.

Figma file: [hairbydemj Design System](https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N),
pages **Journeys** and **Wireframes**.

## Journeys (Figma page "Journeys")

Flow diagrams, one row per journey. Legend: gold = start, white = page or
screen the customer sees, blush pill = decision, dashed = automatic (email,
notification, status change), espresso = admin screen used by staff,
noir = end.

| Group | Journeys |
| --- | --- |
| Customer | Browse to purchase (home, category or search, product, optional AR try-on, cart, checkout in five steps, order confirmation; branches: guest or sign in, payment failed with retry) · Order tracking (signed in or guest, order detail, live carrier tracking, shipped notification, delivered) · Returns (request, staff review, approved or rejected, instructions, customer ships, received and inspected, refund issued) |
| Account | Sign-up (email with 6-digit verification, or Google and Apple) · Sign-in and password reset (emailed link valid 1 hour) · Wishlist (heart, sign-in prompt if signed out, synced web and app, back-in-stock alert) · Loyalty and referrals (points on delivery, redeem at checkout, referral link, both get points) |
| Staff | Add a product (sign-in with two-step verification, details and hair attributes, variants and prices per currency, stock, media, SEO and category, publish or save as draft) · Fulfil an order (orders to fulfil, payment check, pick and pack, buy shipping label, mark shipped, customer notified; on hold when unpaid) · Process a return (review, approve or reject, instructions, receive, inspect, refund, closed) · Manage discounts (code or automatic, rules, save and activate, applied at checkout, deactivate, usage in reports) |

## Wireframes (Figma page "Wireframes")

Low-fidelity greyscale layouts. Each frame carries a yellow note with the
behaviour that the layout alone does not show. Real colours, fonts and
components come in D3, D4 and D5.

| Section | Frames |
| --- | --- |
| Website, desktop 1280, customer journey | Home · Category / collection (also search results) · Product · Cart · Checkout (shipping step shown) · Order confirmation · Payment failed · Order detail and tracking (also guest tracking) · Returns |
| Website, desktop 1280, account journeys | Sign in · Create account · Verify email · Forgot and reset password · Account overview · Wishlist · Loyalty and referrals |
| App, phone 390, customer and account journeys | Splash and onboarding · Region and currency · Home · Categories · Product list · Filters · Search · Product · AR try-on · Cart · Checkout (shipping step shown) · Order confirmation · Sign in and sign up · Account · Order detail and tracking · Returns · Wishlist · Loyalty and referrals · Notifications · Help and chat · Settings and system screens |
| Admin, desktop 1440, staff journeys | Staff sign-in · Dashboard · Products · Product editor · Orders · Order detail · Returns · Discounts · Inventory |

### Decisions shown in the wireframes

- Checkout is one page in five steps: contact, address, shipping option,
  payment, review. Shipping options are live carrier rates (DHL, UPS, FedEx)
  plus local rates for Nigeria. Payment is Paystack for NGN and Stripe for
  USD, GBP and EUR.
- Import duties and taxes are stated as paid by the customer on delivery, on
  the shipping step, the confirmation page and the app checkout.
- A failed payment holds the order for 30 minutes so stock is kept.
- Guest checkout is allowed; guests track orders with order number and email
  and are offered an account after confirmation.
- The app uses five tabs: Home, Shop, Try on, Bag, Account.
- Product prices are entered per currency in the admin, with an option to
  convert from NGN automatically.
- Admin sidebar lists the 23 admin pages in six groups.

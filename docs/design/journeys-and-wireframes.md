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

### Wireframe kit (components)

Every repeated part is a Figma component in the "Wireframe kit" section at
the top of the page. The frames use instances, so a change to a component
updates every frame. 467 instances; no loose copies remain.

| Component | Variants | Becomes in D3 to D5 |
| --- | --- | --- |
| WF/Button | Primary, Secondary | Design system Button |
| WF/Field | One | Design system Form field |
| WF/Chip | One | Design system Tag, and option pickers |
| WF/Product card | Large, Medium, Small | Design system Product card |
| WF/Image | One, resizable | Real photos, video, charts |
| WF/List loader | Loading, End, Error | Endless scrolling states |
| WF/Web header, WF/Web footer | One each | Website header and footer |
| WF/App status bar, WF/App tab bar | Tab bar: one per active tab | App shell |
| WF/Admin sidebar, WF/Admin top bar | One each | Admin shell |
| WF/Note | One | Not shipped; design notes only |

The greyscale kit is separate from the D1 components on purpose: wireframes
stay colourless so layout is judged on its own. The table above is the
one-to-one swap for the visual design modules.

### Endless scrolling

Frames: "Web / Endless scrolling states", "App / Product list: loading more",
"App / Product list: end of list". The category page no longer has a
"Load more" button.

- Website: category, collection and search results. App: product list,
  search results, orders, wishlist, notifications, points history.
- The next 24 items load on their own when the shopper is about two screens
  from the end. Grey placeholders hold the space so the page does not jump.
- End of list: "You have seen all 48 products" and a "Back to top" button,
  then the footer.
- Load failure: the items already shown stay, with a "Try again" button.
- The address updates as pages load (for example `?page=3`), so going back
  from a product returns to the same place.
- Without JavaScript, and for search engines, the same list is served as
  numbered pages. Built with the browser's own IntersectionObserver; no
  framework.
- The footer links stay reachable through the "Help" item in the sticky
  header. A "Back to top" button appears after two screens.
- Screen readers hear "24 more products loaded" and keyboard focus does not
  move. With reduced motion on, placeholders do not shimmer.
- Admin tables keep numbered pages, so staff can jump to and refer to a page.

| Section | Frames |
| --- | --- |
| Website, desktop 1280, customer journey | Home · Category / collection (also search results) · Product · Cart · Checkout (shipping step shown) · Order confirmation · Payment failed · Order detail and tracking (also guest tracking) · Returns · Endless scrolling states |
| Website, desktop 1280, account journeys | Sign in · Create account · Verify email · Forgot and reset password · Account overview · Wishlist · Loyalty and referrals |
| App, phone 390, customer and account journeys | Splash and onboarding · Region and currency · Home · Categories · Product list · Filters · Search · Product · AR try-on · Cart · Checkout (shipping step shown) · Order confirmation · Sign in and sign up · Account · Order detail and tracking · Returns · Wishlist · Loyalty and referrals · Notifications · Help and chat · Settings and system screens · Product list: loading more · Product list: end of list |
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

## Design review (2026-11-11)

Checked with the design critique, accessibility (WCAG 2.1 AA), design system
and interface copy reviews.

### Fixed

| Finding | Fix |
| --- | --- |
| Repeated parts were loose copies | Rebuilt as kit components with instances |
| "Load more" button instead of endless scrolling | Endless scrolling designed with loading, end and error states |
| Secondary text was 3.9:1 on white | Darkened to 6.2:1 on white, 5.2:1 on grey panels |
| Field and chip borders were 2.0:1 | Darkened to 3.4:1 (3:1 required for controls) |
| Buttons and fields under 48 px high | All 48 px; chips 40 px with 8 px gaps |
| App tab labels at 11 px | Raised to 12 px in the wireframe; final sizes follow the type scale |
| "Submit return request" | "Send return request" (says what happens) |
| "Notify me when back" | "Notify me when in stock" |
| Star ratings had no number in words | "4.8 out of 5 (120 reviews)" |
| Variants table cramped in the product editor | Moved to full width |
| Footer links unreachable on endless pages | "Help" item added to the sticky header |

### Open, for the owner to decide

- There are no phone-width wireframes of the website. The website is
  responsive, and many shoppers will use it on a phone browser.
- Form error states are drawn only for a failed payment. Field-level errors
  (wrong password, invalid email, missing address line) are not yet drawn.

### Carried into D3 to D5

- Wireframes use 12 and 13 px for secondary text. The design system minimum
  is 14 px and applies in the visual designs.
- Icons are text stand-ins in the wireframes. The Phosphor Light set from D1
  applies in the visual designs, with a text label for every icon-only button.

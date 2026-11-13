# Testing

How the shop is tested (module 20): the automatic checks, the browser
journeys, the speed budget, checking the real payment and carrier accounts in
test mode, and testing with real people before launch.

## The automatic checks

Every pull request runs these in GitHub Actions (`.github/workflows/ci.yml`
and `app.yml`):

| Check | What it covers | Command on a computer |
| --- | --- | --- |
| Type check and server tests | Every module's rules against a real PostgreSQL database, including the security checks below and the server scripts | `npm run typecheck`, `npm test` |
| Browser journeys and speed | The real website and admin in Chromium (below) | `npm run test:e2e` |
| Server files | shellcheck, systemd and Caddy settings | (GitHub only) |
| App | Flutter analysis, tests, Android and iPhone builds | `flutter analyze`, `flutter test` in `mobile/` |

On a computer, the database tests need a throwaway PostgreSQL database:
`TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres` (each test
makes its own database and removes it afterwards). The browser tests also
need Chromium for Playwright, once: `npx playwright install chromium`.

## Browser journeys

`server/e2e/journeys.e2e.ts` runs the whole shop (sample data, website,
admin and API) and drives Chromium through:

1. A guest searches, opens a wig, adds it to the bag, checks out to Benin
   City, chooses delivery, places the order and pays in naira. A stand-in
   for Paystack (in `server/e2e/harness.ts`) plays Paystack's part: its
   payment page, the signed webhook and the payment check. The order ends
   paid and ready to send.
2. A customer creates an account and confirms it with the emailed code.
3. The owner accepts the admin invitation, sets up two-step sign-in, and
   signs in with a code.
4. Staff record the paid order as sent.
5. Staff add a product as a draft, and the shop does not show it.
6. A visitor and staff chat, and each sees the other's message without
   reloading.
7. No page had a script error.

Paying in dollars, pounds and euros uses Stripe's own card form, which only
loads from Stripe; that path is covered by the server tests with a stand-in
for Stripe's API and its signed webhooks, and by hand with Stripe's test
cards (below).

With `E2E_SHOTS=<folder>`, a picture of every page is saved after each
journey, which helps when one fails.

## Speed on a slow connection

`server/e2e/performance.e2e.ts` opens the main pages at phone size over the
"slow 4G" connection Google's Lighthouse uses (150 ms round trips,
1.6 Mbit/s down), with an empty cache. Each page must stay within:
350 KB downloaded, 30 requests, largest paint by 3 seconds, loaded by
4 seconds.

Latest results (2026-11-13, sample data, without compression; on the live
server Caddy compresses text, so the real figures are smaller):

| Page | Downloaded (KB) | Requests | Largest paint (ms) | Loaded (ms) |
| --- | --- | --- | --- | --- |
| / | 283 | 11 | 920 | 1667 |
| /c/wigs/ | 255 | 10 | 912 | 1564 |
| /products/bone-straight-wig/ | 256 | 10 | 900 | 1547 |
| /search/?q=wig | 255 | 10 | 904 | 1570 |
| /cart/ | 249 | 10 | 912 | 1561 |
| /checkout/ | 249 | 10 | 920 | 1569 |
| /sign-in/ | 250 | 10 | 920 | 1565 |

Most of each page is the fonts (about 150 KB, downloaded once and then kept
by the browser) and the shared script and styles. The sample products have
no photos; real photos are sent at the size each screen needs (`media.md`),
and only the first ones on a page load straight away.

## Checking the real accounts in test mode

When the owner has the **test** keys for Paystack and Stripe, and the test
addresses for the carriers (`payments.md`, `shipping.md`), on staging or a
computer with those settings:

```
npm run build
node --env-file=.env dist/server/ops/provider-check.js
```

It refuses live keys. It starts a small payment in naira (Paystack) and in
dollars, pounds and euros (Stripe), reads each one back, checks the Stripe
webhook secret is set, and asks each carrier for quotes from Benin City to
London and to Accra. Nobody is charged and no label is bought.

Then, on staging, place one real order in each currency and pay with the
providers' test cards:

| Provider | Card | Notes |
| --- | --- | --- |
| Paystack (naira) | 4084 0840 8408 4081 | Any future expiry, CVV 408, PIN 0000, OTP 123456 |
| Stripe (dollars, pounds, euros) | 4242 4242 4242 4242 | Any future expiry and CVV |
| Stripe, with a bank check | 4000 0025 0000 3155 | Shows the 3D Secure step |
| Stripe, declined | 4000 0000 0000 0002 | The order stays unpaid and can be paid again |

For each order check: the order shows as paid in the admin, the customer got
the confirmation email, a refund from the admin reaches the provider's
dashboard, and a label can be bought with the carrier's test account.

## Testing with real people (beta testers)

Before launch, a few customers try the shop and the app on their own phones:

1. **Who:** 5 to 10 people: some in Nigeria and some abroad (UK, US, Ghana),
   on both iPhone and Android, including at least one older or low-cost
   Android phone.
2. **The app:** iPhone testers through **TestFlight** (needs the Apple
   Developer account; up to 100 people by email, no review for internal
   testers); Android testers through **Google Play internal testing** (needs
   the Play Console; testers join with a link).
3. **The website:** staging.hairbydemj.com, with payments in test mode.
4. **What they do:** find and buy something in their own currency (with the
   test cards), create an account, track the order, ask for a return, write
   a review, use the chat and the camera try-on.
5. **What they report:** anything confusing, slow or broken, with a
   screenshot and the phone model. Collect it in one place (a GitHub issue
   per problem, labelled "beta").
6. Fix what they find, then repeat the journeys above before launch.

## The security review

See `security-review.md`.

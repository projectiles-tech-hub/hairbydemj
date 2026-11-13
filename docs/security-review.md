# Security review

Module 20. What was checked in the sign-in, checkout and payment code, what
was found and fixed, and what an independent reviewer should look at before
launch.

This review was done by the team that built the shop, on 2026-11-13. The
build plan also asks for an **independent** review of sign-in, checkout and
payments by someone who did not write the code; that is an owner item
(below), and this document is the starting point for it.

## How it was checked

- **Automatic tests that try to break in** (`server/security.test.ts`, run
  on every pull request):
  - every admin address is tried without signing in, and as a staff member
    whose role allows nothing; each must refuse (sign-in and invitations
    excepted);
  - every app address that is not public by design is tried without signing
    in;
  - one customer tries to read, cancel, pay for, change and delete another
    customer's orders, addresses and chats; a wrong order token and no
    token are tried too;
  - admin changes are sent from another site, and with no sign of where they
    came from;
  - the safety headers on website and admin pages.
- **Reading the code** for the points in the checklist below.
- **Dependencies:** `npm audit` finds no known problems (the server uses
  two packages: `pg` and MediaPipe's face tracking).

## Checklist and findings

| Area | What is in place | Finding |
| --- | --- | --- |
| Passwords | scrypt with OWASP's setting, salted; rehashed when the setting changes | Fine |
| Sessions | Random tokens, only their hash stored; cookies HttpOnly, Secure (live), SameSite Lax (customers) and Strict (staff); staff sessions end when idle | Fine |
| Staff sign-in | Password and an authenticator code, every time; a code never works twice | Fine |
| Too many tries | Customer and staff sign-in, two-step codes, email codes, sign-up, gift card and order look-ups are limited per person and address | Fine |
| Account enumeration | Sign-in and password reset answer the same whether or not the email exists | Fine |
| Requests from other sites | Every change checks the request came from our own page (Origin or Sec-Fetch-Site); HTML forms carry a token | Fine (tested) |
| Who may do what in the admin | Each admin address checks the staff member's role | **Fixed:** the list of saved chat replies could be read by any signed-in staff member, whatever their role. It now needs access to customers. |
| Customers' own things | Orders need the owner's sign-in or the order's private token; another person's order looks the same as one that does not exist | Fine (tested) |
| Prices | Checkout takes no prices from the browser; totals are worked out on the server from the bag | Fine |
| Payments | Webhooks are checked against the provider's signature (Stripe's with a 5-minute limit) and recorded once; a payment for the wrong amount or currency is not accepted and is flagged for staff; refunds cannot exceed what was paid | Fine |
| Card details | Never touch our server: Paystack's page and Stripe's form | Fine |
| Uploads | Size limits; photos and videos are re-made by libvips and ffmpeg, so a disguised file does not survive; files get new names | Fine |
| Showing text people typed | Pages escape it; browser scripts add text as text | Fine |
| Content Security Policy | Website, admin, invoices and emails each have one; pages cannot be framed by other sites | Fine |
| HTTPS only | Cookies are Secure on the live shop | **Fixed:** browsers are now told to use only HTTPS for the shop (Strict-Transport-Security, set by Caddy), and every answer says not to guess file types |
| Logs | Errors are logged without secrets | **Fixed:** the request log and Caddy's log recorded full addresses, including the private tokens in order links, invitations and unsubscribe links. Those values are now hidden in both logs. |
| Secrets | Only in the server's settings file and GitHub's secret store; never in the repository | Fine |
| Server | Firewall (SSH, HTTP, HTTPS only), no password SSH logins, automatic security updates, services run as their own user with a read-only system | Fine (module 19) |
| Database | Every query uses parameters; nothing is built from text people typed | Fine |

## For the independent reviewer

Most worth a second pair of eyes:

1. `server/accounts/` (sessions, staff two-step sign-in, invitations,
   password reset, Google and Apple sign-in).
2. `server/orders/checkout.ts`, `server/cart/` (totals, discounts, gift
   cards, loyalty points, holding stock).
3. `server/payments/` (starting payments, webhooks, refunds, late payments).
4. `deploy/` (server set-up, Caddy, the deployment key's limits).

Running the shop on a computer is in `README.md`; staging is the best place
for testing from outside. Please report findings privately to the owner, not
in public issues.

## Owner items

- Arrange the independent review (a freelance security tester or a
  friend in the trade) of the four areas above, on staging.
- After it: fix what it finds, and note it here.

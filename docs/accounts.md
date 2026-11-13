# Accounts and sign-in

How customers and staff sign up, sign in, recover access and sign out. All of
it is our own code on Node's built-in crypto module; no sign-in library or
paid service is used. The code is in `server/accounts/`.

## Where people sign in

| Who | Address | How the session is kept |
| --- | --- | --- |
| Customers on the website | `hairbydemj.com`, under `/api/auth/` | A cookie locked to that one address |
| Customers in the phone app | `api.hairbydemj.com`, under `/v1/auth/` | A token the app stores and sends with each request |
| Staff and the Owner | `admin.hairbydemj.com`, under `/api/auth/` | A stricter cookie locked to the admin address |

Why customers stay on `hairbydemj.com` and the Owner uses the admin address:
[`decisions/0006-sign-in-addresses-and-owner.md`](decisions/0006-sign-in-addresses-and-owner.md).

## Settings

| Name | Secret? | What it is |
| --- | --- | --- |
| `AUTH_SECRET` | **Yes** | A long random value (at least 32 characters). Signs short-lived tokens and encrypts staff two-step secrets. Required in production. Make one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. **If it is lost or changed, every staff member must set up two-step verification again** (use `npm run staff:reset-access`). |
| `GOOGLE_CLIENT_IDS` | No | The client IDs from Google for the website and the apps, separated by commas. Empty turns Google sign-in off. |
| `APPLE_CLIENT_IDS` | No | The Services ID (website) and bundle ID (iOS app) from Apple, separated by commas. Empty turns Apple sign-in off. |
| `TRUST_PROXY` | No | `true` when the server is behind our Caddy proxy (the default in production), so the visitor's address is read from what Caddy passes on. |

No Google or Apple secret key is needed: their sign-in tokens are checked
against the public keys they publish.

Still to get from the owner before launch: the Google client IDs (free, from
Google Cloud Console) and the Apple IDs (needs the Apple Developer account).

## Commands on the server

| Command | What it does |
| --- | --- |
| `npm run staff:invite-owner -- "Full Name" email` | Creates an Owner and prints a one-time link (48 hours) where they set a password and two-step verification. This is how the first Owner is made. |
| `npm run staff:reset-access -- email` | For a locked-out staff member or Owner: wipes their password and two-step setup, signs them out everywhere and prints a new one-time link. |

The link opens `/accept-invite/` on the admin address. That page is built
with the admin (module 14); until then the two steps can be done through the
addresses listed below.

## Customers

| Step | Rule |
| --- | --- |
| Sign-up | Email and a password of at least 8 characters. The password is stored only as an scrypt hash. |
| Verify email | A 6-digit code, valid 10 minutes, 5 tries. A new code can be asked for after 60 seconds. An expired code sends a new one. |
| Sign-in | Email and password. Wrong password and unknown email get the same answer. An unverified account is sent a code instead of being signed in. |
| Session | Website: 30 days from last use. Phone app: 90 days from last use. |
| Forgot password | An emailed link, valid 1 hour, works once. Setting the new password signs out every device. The answer is the same whether or not the email has an account. |
| Google and Apple | A person seen before is signed in. A new person whose confirmed email matches an account is linked to that account. Otherwise a new, already verified account is made. A signed-in customer can also add Google or Apple from their account. |

One customer can therefore have a password, Google and Apple, all leading to
the same account.

## Staff and the Owner

- **Owner**: a built-in role that can see and change everything. It cannot be
  edited or removed, and the store can never be left without an active Owner.
- **Only an Owner** can invite staff, create roles, change what a role may
  do, change someone's role, disable someone or reset their sign-in.
- **Roles** grant "view" and "change" for seven areas: orders, returns,
  products, customers, discounts, settings, reports. A change to a role
  applies at once.
- **Invite**: the person gets an emailed link (48 hours, works once), sets a
  password, adds the account to an authenticator app (Google Authenticator,
  Authy and the like) and confirms with a code. Nobody is active without both.
- **Sign-in**: email and password, then within 5 minutes a 6-digit code from
  the authenticator app. A code never works twice.
- **Session**: ends after 2 hours unused, and always after 12 hours. The
  cookie goes when the browser closes.
- **Lost phone or password**: an Owner resets the person from the admin; a
  locked-out Owner uses the server command above.
- **Activity log**: invites, sign-ins, role changes, disabling and resets are
  recorded with who did them.

## Protections

- **Password guessing**: after 5 wrong tries for one account in 15 minutes,
  that account is refused for the rest of the 15 minutes, even with the right
  password. The same limit covers 6-digit codes and staff two-step codes.
  One visitor's address is limited to 30 failed tries or sign-ups in 15 minutes.
- **Cross-site request forgery** (another site making a signed-in browser
  send a request): cookies are `SameSite`, and every request that changes
  something must come from our own page on the same address, or it is
  refused. A per-session token for HTML forms is also provided for modules
  13 and 14.
- **Stolen database**: sessions, codes, links and invites are stored as
  hashes; passwords as scrypt hashes; two-step secrets encrypted with a key
  that is not in the database.
- **Forged Google or Apple tokens**: the signature, issuer, intended app,
  expiry and age are all checked; only the RS256 signature type is accepted.
- **Account made by a stranger with your email**: if you later sign in with
  Google or Apple, the stranger's password and sessions are removed.

## Addresses

Requests and replies are JSON. Errors look like
`{"error": {"status": 422, "code": "invalid", "message": "...", "fields": {"email": "..."}}}`.

Customers (`/api/auth` on the website, `/v1/auth` for the app):

| Address | Sends | Gets |
| --- | --- | --- |
| `POST /sign-up` | email, password, firstName, lastName, marketingConsent | the email; a code is emailed |
| `POST /verify-email` | email, code | the customer, signed in |
| `POST /resend-code` | email | ok |
| `POST /sign-in` | email, password | the customer, signed in |
| `POST /sign-out` | | ok |
| `GET /me` | | the signed-in customer |
| `POST /forgot-password` | email | ok |
| `POST /reset-password` | token, password | ok |
| `POST /google`, `POST /apple` | idToken, optional nonce, optional name | the customer, signed in |
| `POST /link/google`, `POST /link/apple` | idToken | the customer |

Staff (on the admin address):

| Address | Sends | Gets |
| --- | --- | --- |
| `POST /api/auth/sign-in` | email, password | a short-lived `pending` value |
| `POST /api/auth/two-step` | pending, code | the staff member, signed in |
| `POST /api/auth/sign-out`, `GET /api/auth/me` | | |
| `POST /api/auth/invite/start` | token, password | the secret and address for the authenticator app |
| `POST /api/auth/invite/confirm` | token, code | ok; the account is active |
| `GET /api/staff`, `POST /api/staff/invite` | name, email, roleId | |
| `POST /api/staff/:id/role`, `/disable`, `/reset` | roleId for `/role` | |
| `GET /api/roles`, `POST /api/roles`, `POST /api/roles/:id/permissions` | name, permissions | |

## Emails

Sending email is module 11. Until then each email (verification code, reset
link, password changed, staff invite) is placed in the `jobs` table for the
worker. In development it is also written to the server log, so codes and
links can be read without an inbox. A code or link sits readable in its job
until the email is sent; module 11 removes sent jobs.

## Not in this module

Change email, change password while signed in, delete account, and editing
profile details are in the designs but not in the Module 3 steps. The
database is ready for them. The sign-in pages themselves come with modules
13 (website), 14 (admin) and 15 (app).

## To settle at deployment (module 19)

When Cloudflare sits in front of Caddy, Caddy must be set to pass on the
visitor's real address, or the per-address limits will count Cloudflare's
addresses instead.

# Notifications

Emails sent from our own server, app push notifications sent straight to
Apple and Google, an in-app list, and the customer's choices about what they
receive. No paid service is used (decision 0004). The code is in
`server/notifications/`; the worker (module 10) does the sending.

## Settings (all from the server's environment, never committed)

| Name | Secret? | What it is |
| --- | --- | --- |
| `MAIL_TRANSPORT` | No | `smtp` to send (the default on the live server) or `log` to only write emails to the log (the default on your computer) |
| `SMTP_HOST`, `SMTP_PORT` | No | The mail server to hand emails to. Leave as `127.0.0.1` and `25`: Postfix on the same machine |
| `SMTP_USER`, `SMTP_PASSWORD` | **Password: yes** | Only if handing mail to another server that needs a login. Leave empty for our own Postfix |
| `MAIL_FROM` | No | Who emails come from, for example `hairbydemj <hello@hairbydemj.com>` |
| `MAIL_REPLY_TO` | No | Where replies go, if not the From address |
| `MAIL_HELO_NAME` | No | The name the server gives itself; defaults to `hairbydemj.com` |
| `DKIM_DOMAIN`, `DKIM_SELECTOR` | No | `hairbydemj.com` and `mail` |
| `DKIM_PRIVATE_KEY` | **Yes** | The private key that signs every email (made below). Paste it on one line with `\n` for each line break |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | No | From the Apple Developer account, Keys page, and the membership page |
| `APNS_PRIVATE_KEY` | **Yes** | The `.p8` key file's contents, one line with `\n` |
| `APNS_BUNDLE_ID` | No | The app's bundle ID, `com.hairbydemj.app` unless module 15 changes it |
| `APNS_URL` | No | `https://api.push.apple.com` (App Store and TestFlight builds); `https://api.sandbox.push.apple.com` for builds run from Xcode |
| `FCM_PROJECT_ID` | No | The Firebase project's ID |
| `FCM_CLIENT_EMAIL` | No | From the Firebase service account key file (`client_email`) |
| `FCM_PRIVATE_KEY` | **Yes** | From the same file (`private_key`), one line with `\n` |

## Email: setting up the server (done in module 19, written here so it is not lost)

Emails go: our code builds and signs the email, hands it to **Postfix** on
the same machine, and Postfix delivers it to the customer's mail provider,
trying again if the provider is busy.

1. **Postfix, send-only, listening only on the machine itself:**
   `sudo apt install postfix` (choose "Internet Site", system mail name
   `hairbydemj.com`), then in `/etc/postfix/main.cf` set
   `inet_interfaces = loopback-only`, `myhostname = mail.hairbydemj.com`,
   `mydestination =` (empty) and
   `smtp_tls_security_level = may`, then `sudo systemctl restart postfix`.
   Nothing outside the server can use it to send mail.
2. **Port 25 out:** check the VPS may send on port 25 (`nc -vz gmail-smtp-in.l.google.com 25`).
   If it is blocked, ask Namecheap support to open it for this server.
3. **Reverse DNS (PTR):** ask Namecheap to set the server's IP address to
   point back to `mail.hairbydemj.com`. Big providers check this.
4. **DKIM key:** on the server,
   `openssl genrsa -out dkim.pem 2048` and
   `openssl rsa -in dkim.pem -pubout -outform der | base64 -w0` (the public
   half, for DNS). Put the private key in `DKIM_PRIVATE_KEY`, then delete
   `dkim.pem`.
5. **DNS records** (Cloudflare, "DNS only", not proxied):

| Type | Name | Value |
| --- | --- | --- |
| A | `mail` | The server's IP address |
| TXT | `@` | `v=spf1 ip4:<server IP> -all` (if Google Workspace or another service also sends for the domain, add its include before `-all`) |
| TXT | `mail._domainkey` | `v=DKIM1; k=rsa; p=<the public half from step 4>` |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:<owner's email>; adkim=s; aspf=s` (start with `p=none` for the first two weeks and read the reports) |

6. Send a test from the admin (Settings, Emails, "Send a test") to a Gmail
   address, open it, choose "Show original", and check SPF, DKIM and DMARC
   all say PASS.

A new server's emails can land in spam for the first weeks until providers
trust it (noted in decision 0004). Sending only what customers expect helps.

## Which emails go, and to whom

| Kind | Emails | Can be turned off by |
| --- | --- | --- |
| Sign-in and security | Verify email code, reset password, password changed | Nobody: always sent |
| Staff | Invitation, low-stock alert | Nobody |
| About an order placed | Order received, order cancelled, return progress, store credit | Nobody |
| Order progress | Payment received, on its way, out for delivery, delayed, delivered, refund sent | The customer (`ordersEmail`) |
| Asked for | Back in stock | The customer (`backInStockEmail`) |
| Offers and reminders | Bag reminder, newsletter welcome | Sent only with marketing consent (or a newsletter sign-up) and never after unsubscribing |

Staff can change the subject and opening paragraph of any email, and switch
off any that is not a sign-in or staff email (admin, Settings). Clearing the
text puts the original wording back.

Every offers email carries an unsubscribe link and the headers mail apps use
for their own unsubscribe button (`List-Unsubscribe`, one-click). The link
is signed for that address and never runs out. Unsubscribing turns off the
newsletter and the account's offers choice together.

## App push

Order progress (the same events as the emails above) goes to the customer's
phones when `ordersPush` is on, and always into the in-app list.

- **Apple:** in the Apple Developer account, Keys, create a key with "Apple
  Push Notifications service (APNs)"; download the `.p8` file once; note the
  Key ID and your Team ID. One key works for test and live apps.
- **Google:** in the Firebase console, add the Android app, then Project
  settings, Service accounts, "Generate new private key". Take
  `project_id`, `client_email` and `private_key` from the file into the
  settings above, then delete the file.
- The app registers each phone after sign-in (`POST /v1/push/devices`) and
  removes it on sign-out. A phone that no longer has the app is forgotten
  the first time Apple or Google says so.

## Addresses

| Who | Address | What it does |
| --- | --- | --- |
| Customer | `GET`, `POST /api/account/notifications` (and `/v1/...`) | Their choices: `ordersEmail`, `ordersPush`, `offersEmail`, `offersPush`, `backInStockEmail`, `backInStockPush` |
| Customer | `GET /api/notifications`, `POST /api/notifications/read` | The in-app list and marking read (`{ ids }` or `{ all: true }`) |
| Anyone | `POST /api/newsletter` (and `/v1`) | `{ email }` join the newsletter; one welcome email per address |
| App | `POST /v1/push/devices`, `POST /v1/push/devices/delete` | `{ platform, token }` |
| Anyone with the link | `GET /unsubscribe?t=`, `POST /unsubscribe?t=` | The page with one button, and the one-click address mail apps call |
| Staff | `GET /api/messages`, `POST /api/messages/:key` | Every email; change `subject`, `intro`, `emailEnabled` (settings) |
| Staff | `GET /api/messages/:key/preview`, `POST /api/messages/:key/test` | See it with sample details; send it to yourself |

Links inside emails point to these website pages, which module 13 builds:
`/track-order/?order=&token=`, `/reset-password/?token=`, `/forgot-password/`,
`/products/<slug>/`, `/cart/`, `/account/preferences/`; and on the admin,
`/invite/?token=` and `/products/`.

## Tests

`server/notifications/notifications.test.ts`: header encoding, DKIM signing
checked by an independent verifier written from the standard, escaping of
customer details, signed unsubscribe links, the SMTP client against a
stand-in mail server (dots, refusals, busy servers), Apple and Google push
against stand-ins (signed tokens, phones without the app), and with the
database: queued emails through the worker, preferences, unsubscribing,
the newsletter, order updates to the list, phone and inbox, and staff
changing wording.

**Still to do on the live server (module 19):** Postfix, reverse DNS and the
DNS records above, then the Gmail check in step 6. Push needs the Apple and
Google keys and the app (module 15).

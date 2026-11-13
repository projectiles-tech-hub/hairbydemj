# Launch

How hairbydemj.com and both apps go live on the same day (module 21): what
the owner needs, the store listings, signing the apps, switching to live
payments, the launch check, the day itself, and the first days after.

## What the owner needs

| Account | Cost | For |
| --- | --- | --- |
| Apple Developer Program | $99 a year | The App Store and TestFlight |
| Google Play Console | $25 once | Google Play |
| Paystack (business, verified) | Per payment | Naira payments, live keys |
| Stripe (business, verified) | Per payment | Dollar, pound and euro payments, live keys |
| Carriers (DHL, UPS, FedEx; any of them) | Per label | Labels and live quotes abroad |

Paystack and Stripe need the business verified (CAC documents, bank account)
before live keys work; start that early, as it can take a week or more.

## Timeline

| When | What |
| --- | --- |
| 3 weeks before | Paystack and Stripe business verification; carrier accounts; store accounts. Server set up and staging working (`operations.md`). |
| 2 weeks before | Beta testers on staging and through TestFlight and Play internal testing (`testing.md`). Real products, photos, prices and stock entered in the admin. |
| 1 week before | Send both apps for review (below); they stay unreleased until launch day. Final content check with the owner. |
| 2 days before | Live keys and live carrier addresses on the live server (below). The launch check shows no problems. One real order paid and refunded in each currency. |
| Launch day | Release in this order: website, Android, iPhone (below). |
| First 2 weeks | Watch closely (below). |

## Store listings

Drafts for the owner to change as he likes. Both stores need the privacy
policy at https://hairbydemj.com/privacy/ and support at
https://hairbydemj.com/contact/.

- **Name:** hairbydemj
- **Subtitle (Apple, 30 characters):** Human hair wigs and bundles
- **Short description (Google, 80 characters):** Human hair wigs, bundles and closures, sent from Benin City to you worldwide.
- **Description:**

  > Shop human hair wigs, bundles, closures and frontals from hairbydemj,
  > sent from Benin City to your door anywhere in the world.
  >
  > - Pay in naira, dollars, pounds or euros
  > - See exactly what is in stock, in every length, density and colour
  > - Try wigs on with your camera before you buy
  > - Track your order from our shop to your door
  > - Earn points on every order and for reviews and referrals
  > - Chat with us from the app
  >
  > Delivery in Nigeria by local courier, and worldwide by DHL, UPS or FedEx.

- **Category:** Shopping. **Age rating:** 4+ (Apple), Everyone (Google).
- **Keywords (Apple, 100 characters):** wigs,human hair,bundles,lace front,closure,frontal,hair extensions,Nigeria
- **Screenshots:** iPhone 6.9" and 6.5", Android phone; from the approved app
  designs (`design/app-designs.md`), taken from the app running on staging.

### Privacy answers (App Store "App Privacy" and Google Play "Data safety")

These match the app's privacy manifest (`mobile/ios/Runner/PrivacyInfo.xcprivacy`):

| Data | Collected | Linked to the person | Used for tracking | Why |
| --- | --- | --- | --- | --- |
| Name, email, phone, delivery address | Yes | Yes | No | Orders and delivery |
| Purchase history | Yes | Yes | No | Orders, returns, loyalty points |
| Customer support (chat messages) | Yes | Yes | No | Answering questions |
| Photos (review photos) | Yes, when the customer adds them | Yes | No | Reviews |
| Device ID (push notification token) | Yes, when allowed | Yes | No | Order updates |
| Payment details | No: typed into Paystack's or Stripe's own page | | | |
| Camera (try-on) | No: the picture stays on the phone unless the customer saves it themselves | | | |

Data is sent encrypted (HTTPS). Customers can delete their account in the app
(Account, Delete account), which Google asks about.

### Notes for Apple's reviewers

Apple asks for a way to try everything. Give them:

- A customer account on the live shop made for them (for example
  `review@hairbydemj.com`), with a password, so they can sign in. Browsing and
  buying work without an account too.
- "Sign in with Apple" is offered alongside Google sign-in, as Apple requires.
- Payments: the app opens Paystack's or Stripe's own page; no digital goods are
  sold, so Apple's in-app purchase does not apply (physical goods).
- The camera is used only for the wig try-on.

## Signing the apps (once)

The release workflow (`.github/workflows/app-release.yml`, run from the
Actions tab) builds and uploads both apps once these are in the repository's
Settings > Secrets and variables > Actions. None of them is ever committed.

**Android (Google Play):**

1. Make the upload key on your computer (keep the file and both passwords in
   your password manager; Google can reset a lost upload key, but it takes days):
   `keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
2. Secrets: `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 upload.jks`),
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`.
3. In the Play Console, create the app (`com.hairbydemj.hairbydemj`), turn on
   Play App Signing, and upload the first bundle by hand (Google requires the
   first one by hand; the workflow keeps each bundle as a download on its run page).
4. For automatic uploads after that: in Google Cloud, create a service
   account, download its JSON key, and invite its email in the Play Console
   (Users and permissions) with release rights. Secret: `PLAY_SERVICE_ACCOUNT_JSON`.

**iPhone (App Store):**

1. In the Apple Developer site: the app identifier `com.hairbydemj.hairbydemj`
   with Push Notifications and Sign in with Apple; an **Apple Distribution**
   certificate (export it from Keychain as a .p12 with a password); an **App
   Store** provisioning profile for the identifier.
2. In App Store Connect: create the app; under Users and Access > Integrations,
   an API key with the App Manager role (download the .p8 once).
3. Secrets: `IOS_CERTIFICATE_P12_BASE64` (`base64 -i cert.p12`),
   `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`,
   `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
   `APP_STORE_CONNECT_KEY_P8` (the .p8 file's text). Variable: `APPLE_TEAM_ID`.

**The app's settings** (variables, not secrets; `app.md` explains each):
`APP_API_BASE`, `APP_SITE_BASE`, `APP_WHATSAPP`, `APP_GOOGLE_SERVER_CLIENT_ID`,
`APP_GOOGLE_IOS_CLIENT_ID`, `APP_APPLE_SIGN_IN`, `APP_FIREBASE_API_KEY`,
`APP_FIREBASE_PROJECT_ID`, `APP_FIREBASE_SENDER_ID`,
`APP_FIREBASE_ANDROID_APP_ID`, `APP_FIREBASE_IOS_APP_ID`.

## Sending the apps for review (about a week before)

1. Actions > App release > Run workflow, track **production**. The Android
   bundle goes to Google Play's production track as a **draft**; the iPhone
   build goes to App Store Connect.
2. Play Console: complete the listing, content rating, data safety and target
   audience; send the draft for review; choose **managed publishing** so it
   does not go live by itself when approved.
3. App Store Connect: choose the build, complete the listing, privacy answers
   and review notes; under Version Release choose **Manually release this
   version**; send for review.
4. If a reviewer asks for changes, fix them in a pull request, run the
   workflow again, and resend.

## Switching to live payments and carriers (2 days before)

On the live server, edit `/srv/hairbydemj/shared/.env` (staging keeps the test keys):

1. **Paystack:** live secret and public keys (Settings > API Keys and
   Webhooks), and set the live webhook URL there to
   `https://api.hairbydemj.com/webhooks/paystack`.
2. **Stripe:** live secret and publishable keys; add the live webhook
   endpoint `https://api.hairbydemj.com/webhooks/stripe` with the events in
   `payments.md`, and put **its** signing secret in `STRIPE_WEBHOOK_SECRET`
   (the test endpoint's secret is different).
3. **Carriers:** live keys, and remove the `*_API_URL` test addresses.
4. **Push:** `APNS_URL=https://api.push.apple.com` for App Store builds.
5. Restart: `sudo systemctl restart hairbydemj-web hairbydemj-worker`.
6. Run the launch check (below), then place one real order in naira and
   one in another currency with your own card, and refund both from the admin.

## The launch check

On the live server, as the hairbydemj user:

```
cd /srv/hairbydemj/current
node --env-file=../shared/.env dist/server/ops/launch-check.js
```

It changes nothing. It lists each item as `ok`, `PROBLEM` (must be fixed
before taking real orders) or `check` (worth a look): production mode, the
addresses, live Paystack and Stripe keys and the webhook secret, email
sending and signing, carriers on their live addresses, push and sign-in
set-up, alerts, all migrations applied, an owner with two-step sign-in, no
sample data left, every published product buyable (variants, naira price,
stock, photos), the information pages, fresh exchange rates, and the
worker running.

## Final content check with the owner

Walk through the live site and the apps together:

- Every product: name, photos, lengths, densities, colours, prices in each
  currency, stock.
- The homepage sections and their order, the top banner's pictures (desktop and phone), any promotional banners with their dates and countries; category pictures; categories, collections and look banners.
- Information pages: about, shipping, returns, privacy, terms, FAQ; the
  shop's contact details and WhatsApp number (admin: Store settings).
- Emails: send each one to yourself from the admin (Emails) and read it.
- Delivery prices for each Nigerian zone, the boxes, and the sender address.
- Loyalty figures, return rules and saved chat replies.

## Launch day

1. **Website:** merge `develop` into `main`; the live server updates by
   itself (`operations.md`). Run the launch check again. Turn on the uptime
   check (`UPTIME_URLS`) if it is not on.
2. **Android:** Play Console > Publishing overview > **Publish changes**.
   Google usually shows it within hours.
3. **iPhone:** App Store Connect > the approved version > **Release this
   version**. Apple usually shows it within a day.
4. Announce once both store links work.

## The first days

| How often | Look at |
| --- | --- |
| Several times a day | Admin dashboard (orders to send, returns, low stock, failed jobs); the chat inbox |
| Daily | Orders against Paystack's and Stripe's dashboards (any "payment for the wrong amount" note on an order means look at it in the provider's dashboard); refunds; the System page for failed jobs and emails |
| Daily | Alert emails and any GitHub "downtime" issue |
| Daily | The stores' crash reports (App Store Connect > TestFlight and Crashes; Play Console > Android vitals) and reviews |
| After the first week | The search report (what people looked for and did not find); the speed of the busiest pages |

If something goes wrong with the website: go back a version
(`operations.md`, "Going back a version"). If an app has a serious fault:
in the Play Console, halt the release; in App Store Connect, remove the
version from sale or send a fixed build for expedited review.

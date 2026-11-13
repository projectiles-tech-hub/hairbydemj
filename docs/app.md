# Phone app

The hairbydemj app for iPhone and Android, built with Flutter
(decision 0002) from the approved app designs (module D4). It is in
`mobile/` and talks to the same server as the website, at
`api.hairbydemj.com/v1`.

## What is in it

| Area | Screens |
| --- | --- |
| Opening | Splash, three onboarding slides (once), the five tabs: Home, Shop, Try on, Bag, Account |
| Shopping | Home (banner, categories, best-sellers, new arrivals, looks, in the order staff set in the admin), Shop (categories), product lists that load more as you scroll with filters and sorting, search with suggestions, product (photos, length, density, lace and colour, exact stock, add to bag, wishlist, copy link) |
| Bag and checkout | Bag (quantities, discount and gift card codes, totals), checkout (contact, saved or new address, delivery options and prices, duties notice, note, summary), paying, the after-payment screen that updates by itself |
| Account | Sign in, create account, the emailed code, forgotten password, Google and Apple sign-in (when set up), orders, one order with tracking, paying, cancelling, returns, the invoice, addresses, wishlist, notifications and their settings, profile, password, deleting the account, currency, help |

The Try on tab says the camera try-on is coming (module 16). Reviews,
loyalty and gift cards come with module 17 and live chat with module 18.
Saved cards are not offered (as on the website), so there is no payment
methods screen. Changing the email address is done by contacting the shop
(the server does not offer it yet).

## How paying works in the app

- **Naira (Paystack):** after the order is placed, the app opens Paystack's
  payment page in the phone's browser. When the customer comes back to the
  app, the after-payment screen checks with the server and shows the result.
- **Dollars, pounds and euros (Stripe):** the app opens the order's page on
  the website, where Stripe's card form is, using the order's private link.
  The app does not hold card details at any point.
- The order stays reserved for 30 minutes while unpaid (`orders.md`).

## Settings it is built with

None of these is a secret. They are given when building, for example
`flutter build apk --release --dart-define=API_BASE=https://api.hairbydemj.com`.

| Setting | What it is | Default |
| --- | --- | --- |
| `API_BASE` | The server's API address | `https://api.hairbydemj.com` |
| `API_HOST` | Only for a development server that serves every address on one port, for example `api.localhost` | empty |
| `SITE_BASE` | The website, for paying by card, invoices and information pages | `https://hairbydemj.com` |
| `WHATSAPP` | The shop's WhatsApp number with the country code, for Help | empty (no WhatsApp row) |
| `GOOGLE_SERVER_CLIENT_ID` | Google sign-in: the web client ID the server checks (`GOOGLE_CLIENT_IDS` in `accounts.md`) | empty (no Google button) |
| `GOOGLE_IOS_CLIENT_ID` | Google sign-in on iPhone: the iOS client ID | empty |
| `APPLE_SIGN_IN` | `true` to show Sign in with Apple on iPhone | false |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_IOS_APP_ID` | Push notifications, from the Firebase project's settings | empty (push off) |

## Running it on a computer

1. Install Flutter (stable) and Android Studio or Xcode.
2. Start the server (`README.md`), then in `mobile/`:
   `flutter pub get`, then
   `flutter run --dart-define=API_BASE=http://10.0.2.2:3000 --dart-define=API_HOST=api.localhost`
   for the Android emulator, or `http://localhost:3000` for the iPhone simulator.
3. Checks: `flutter analyze` and `flutter test`.

## Builds

GitHub Actions (`.github/workflows/app.yml`) analyses, tests and builds a
debug Android app, then an unsigned iPhone build, whenever `mobile/`
changes. The Android build is kept for 7 days as a download on the run's
page.

`android/` and `ios/` are the standard Flutter project files, with our
changes: the app's name, internet access on Android, and the iPhone's
permission wording.

## For the stores (module 21)

Needs the owner's accounts, which are the unavoidable costs in decision 0004:

- **Apple Developer Program** ($99 a year): the app's identifier
  `com.hairbydemj.hairbydemj`, a distribution certificate and profile, and
  the App Store listing.
- **Google Play Console** ($25 once): the listing, and an upload key. The key
  file and its passwords are kept off the repository (they are listed in
  `mobile/.gitignore`) and given to the build as secrets.

## Push notifications: what the owner sets up

1. Create a free Firebase project and add an Android app
   (`com.hairbydemj.hairbydemj`) and an iOS app (same identifier).
2. Give the five `FIREBASE_*` values above to the app build.
3. For the server: the Firebase service account (`FCM_*`) and the Apple push
   key (`APNS_*`), as in `notifications.md`. iPhones are sent to directly
   through Apple, so the APNs key goes on our server, not in Firebase.
4. On iPhone, turn on the Push Notifications capability for the app identifier.

The app asks once, after the customer first signs in, whether to send
notifications, then registers the phone with `POST /v1/push/devices`.

## Google and Apple sign-in: what the owner sets up

- **Google:** in Google Cloud, OAuth client IDs for Web (its ID goes in
  `GOOGLE_SERVER_CLIENT_ID` and the server's `GOOGLE_CLIENT_IDS`), Android
  (with the signing key's SHA-1) and iOS (`GOOGLE_IOS_CLIENT_ID`; its
  reversed ID is added as a URL scheme in `ios/Runner/Info.plist`).
- **Apple:** turn on Sign in with Apple for the app identifier, add the
  capability in Xcode, and set the server's `APPLE_CLIENT_IDS` to the app
  identifier.

## Server addresses the app uses

All under `/v1`: `auth/*`, `catalog/*` (including `catalog/home`, added in
this module: the homepage sections staff chose), `cart*`, `currency`,
`shipping/quote`, `checkout`, `orders*`, `account/*`, `wishlist*`,
`notifications*`, `push/devices*`. The sign-in token is sent as
`Authorization: Bearer`, the guest bag as `X-Cart-Token`, and a guest order's
private token as `?token=`.

## Still to do on real phones

Testing on real iPhones and Android phones (the last step of the module)
needs the phones and, for iPhone, the Apple account; it is done with the
owner before launch.

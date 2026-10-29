# Overview

hairbydemj.com is a global online store for hair and hair accessories.
A website and an iOS/Android app launch on the same day, with every feature
included at launch. Both run on a backend we build ourselves, so hairbydemj
owns all of its code and customer data.

## Key decisions

- Global market; prices in NGN, USD, GBP and EUR.
- Paystack and Stripe for payments.
- Live carrier shipping rates.
- Website and app launched together, with all features.
- Everything custom-built: no commerce platforms and no frameworks except Flutter for the app.
- No paid third-party services beyond the unavoidable costs (see `hosting.md`).
- Domain: hairbydemj.com.
- Code in github.com/projectiles-tech-hub/hairbydemj.

## Features (all at launch)

| Area | What customers and staff get |
| --- | --- |
| Catalog | Categories for bundles, wigs, closures, frontals and accessories; filters by texture, length, lace type, colour, origin and price; shop-the-look sets and "complete the set" suggestions |
| Product page | Photo gallery and video, variant picker (length, density, colour, cap size), stock status, care guide, customer photo reviews, length visualiser |
| AR try-on | Virtual wig try-on with the phone camera in the app and the webcam on the website |
| Search | Instant, typo-tolerant search with suggestions |
| Accounts | Email sign-up, Google and Apple sign-in, saved addresses, order history, wishlist shared between web and app |
| Currencies | NGN, USD, GBP and EUR, set automatically from the customer's location and switchable by hand |
| Checkout | Guest checkout, live shipping rates, discount codes, gift cards, Paystack and Stripe |
| Orders | Email and push notification updates, live courier tracking, returns portal |
| Loyalty and marketing | Loyalty points, referral codes, abandoned-cart reminders, newsletter, app-only deals |
| Mobile app | Full store on iOS and Android, push notifications for orders and promotions |
| Admin dashboard | Staff create and edit products, variants, prices per currency, stock, orders, customers, discounts and gift cards; staff roles and permissions; low-stock alerts; wholesale price lists; sales reports |
| Support | WhatsApp button and live chat on every page |

The full list of pages and screens is in `docs/design/pages.md`.

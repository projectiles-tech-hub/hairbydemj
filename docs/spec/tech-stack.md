# Tech stack

The website, admin and API are written by hand in plain TypeScript, with no
web, database or authentication frameworks. The app uses Flutter, the one
framework kept, so iOS and Android share a single codebase.

| Layer | Built with | How it works |
| --- | --- | --- |
| Website | Plain HTML, CSS and TypeScript | Pages rendered as HTML on our server for speed and search engines; small scripts add interactivity in the browser |
| Admin dashboard | Plain HTML, CSS and TypeScript | Same approach, served at admin.hairbydemj.com |
| Backend API | Node.js 24 built-in `http` module, our own router | Products, carts, orders, payments, shipping and accounts at api.hairbydemj.com |
| Mobile app (iOS and Android) | Flutter (Dart), latest stable release | One codebase for both apps; phone features without ready-made Flutter support are written in Swift and Kotlin and connected through platform channels |
| Database | PostgreSQL with hand-written SQL | Plain SQL queries and numbered SQL migration files; no ORM |
| Accounts and sign-in | Our own code with Node's built-in crypto | Password hashing (scrypt), secure session cookies, email verification codes, Google and Apple sign-in via their OpenID Connect endpoints, staff roles |
| Background jobs | Our own worker process | Jobs stored in a PostgreSQL table and processed one by one (emails, labels, reminders, stock alerts) |
| Caching | In-memory cache in the Node.js process | Popular pages and product data kept in memory |
| Search | PostgreSQL full-text search with the trigram extension | Typo-tolerant search and filters without a separate search engine |
| Real-time updates | Server-Sent Events from the built-in `http` module | Live chat and order-status updates |
| Payments | Paystack and Stripe REST APIs, called directly | No provider SDKs; requests and webhook signature checks in our own code |
| Shipping | DHL, UPS and FedEx APIs, called directly | Live rates, labels and tracking; local Nigerian delivery uses rates set in the admin |
| Images and video | Stored on our server; libvips and ffmpeg | Each upload resized and compressed into several sizes |
| Notifications | Our own email sending (SPF, DKIM, DMARC), APNs and Firebase Cloud Messaging | Email and free app push notifications; no paid SMS |
| Customer support | WhatsApp click-to-chat link and our own live chat | |
| AR try-on | ARKit (iOS) and ARCore Augmented Faces (Android) via platform channels; MediaPipe Face Landmarker on the web (model hosted on our server) | Runs on the customer's device |
| Server | Namecheap Quasar VPS, Ubuntu LTS, Caddy, systemd, Cloudflare free plan | Free HTTPS; systemd keeps the server and worker running |
| Backups and monitoring | Our own scripts, Google Drive, GitHub Actions | Daily encrypted backups; scheduled uptime checks |
| Code and builds | GitHub, GitHub Actions, TypeScript compiler, Xcode and Gradle | |

## What remains, and why

- **Flutter:** the one framework kept (free, BSD licence, no paid upsell).
- **Node.js, TypeScript compiler, Xcode, Gradle:** runtime and build tools.
- **Apple iOS SDK and Google Android SDK:** required for any phone app.
- **PostgreSQL driver (pg):** Node.js has no built-in PostgreSQL client.
- **MediaPipe Face Landmarker:** free, open-source face tracking for web AR, hosted on our server.
- **libvips and ffmpeg:** free command-line tools for images and video.

**Trade-off:** Flutter has no free official over-the-air updates, so every app
update goes through App Store and Google Play review.

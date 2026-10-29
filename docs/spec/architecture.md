# Architecture

The website, admin and app never talk to the database directly. Every price,
stock count and order goes through the API, so the web and the app always show
the same information.

| Component | Role |
| --- | --- |
| hairbydemj.com | Customer website, served by our Node.js server |
| admin.hairbydemj.com | Staff dashboard, served by the same Node.js server |
| api.hairbydemj.com | Backend API on the same server, called by the website, admin and app |
| Mobile app (Flutter) | One codebase, distributed through the App Store and Google Play |
| On the VPS | Node.js server, background worker, PostgreSQL, Caddy |
| External services (all free to use) | Paystack and Stripe (fee per sale only), DHL, UPS and FedEx APIs, Apple and Google push, Cloudflare free plan, Google Drive for backups |

## Code layout

| Folder | Contents |
| --- | --- |
| `server/` | Website, admin and API routes, written in TypeScript |
| `worker/` | Background jobs |
| `public/` | CSS, browser scripts, icons |
| `db/migrations/` | SQL migration files |
| `shared/` | Types shared across server and browser code |
| `mobile/` | Flutter app, with its iOS and Android project folders inside |

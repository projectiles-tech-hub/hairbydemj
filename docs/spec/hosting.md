# Hosting and running costs

## Decision

Namecheap shared hosting cannot fully support this app. The host is a
**Namecheap Quasar VPS** (4 vCPU, 6 GB RAM, 120 GB SSD, 3,000 GB bandwidth).
It replaces the shared hosting plan rather than adding to it.
Reasons: `docs/decisions/0003-namecheap-vps.md`.

| Plan | vCPU | RAM | SSD | Bandwidth | Price per month |
| --- | --- | --- | --- | --- | --- |
| Pulsar | 2 | 2 GB | 40 GB | 1,000 GB | $6.88 yearly / $11.88 monthly |
| **Quasar (chosen)** | 4 | 6 GB | 120 GB | 3,000 GB | $12.88 yearly / $18.88 monthly |
| Magnetar (future upgrade) | 8 | 12 GB | 240 GB | 6,000 GB | $24.88 yearly / $32.88 monthly |

Prices from Namecheap's VPS page as of 29 October 2026.

## Running costs (the only unavoidable ones)

| Cost | Amount |
| --- | --- |
| Namecheap Quasar VPS | $12.88/month billed yearly ($18.88 monthly) |
| Apple Developer Program | $99 per year |
| Google Play Console | $25 one-time |
| Paystack and Stripe | A fee on each sale, taken from the sale |
| hairbydemj.com | Yearly domain renewal with Namecheap |

Shipping charges are paid by the customer at checkout.

## Deployment

- Branches: `main` (live store), `develop` (staging.hairbydemj.com), one feature branch per piece of work, merged through pull requests.
- Every pull request runs type checks, tests and builds.
- GitHub Actions compiles the TypeScript, copies the server files to the VPS over SSH, runs new SQL migrations, and restarts the Node.js server and worker.
- GitHub Actions builds the Flutter app for iOS (macOS runner) and Android (Linux runner) and uploads to TestFlight and the Google Play testing track.

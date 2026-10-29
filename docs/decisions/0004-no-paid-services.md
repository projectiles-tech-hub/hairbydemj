# 0004 — No paid services

**Date:** 2026-10-29 · **Status:** Accepted (owner's decision)

## Decision

No paid third-party services. Paid services in earlier drafts were replaced:

| Was | Replaced with |
| --- | --- |
| Cloudinary (images, video) | Stored on our server; libvips and ffmpeg |
| Resend (email) | Our own email sending with SPF, DKIM and DMARC |
| Termii / Twilio (SMS, WhatsApp) | Dropped; email, free app push, WhatsApp click-to-chat |
| EasyPost / Shippo (shipping) | DHL, UPS and FedEx APIs called directly |
| Hosted MediaPipe | Same open-source model hosted on our server |
| Separate CDN / security service | Cloudflare free plan |

## Unavoidable costs

- Namecheap Quasar VPS
- Apple Developer Program ($99/year) and Google Play Console ($25 one-time)
- Paystack and Stripe per-sale fees
- Domain renewal for hairbydemj.com

## Consequences

- Our own email may land in spam at first until the server's reputation builds.
- Each carrier API is integrated separately.

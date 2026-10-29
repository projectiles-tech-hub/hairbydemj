# 0003 — Namecheap Quasar VPS instead of shared hosting

**Date:** 2026-10-29 · **Status:** Accepted (approved by owner 2026-10-29)

## Decision

Host on a Namecheap Quasar VPS (4 vCPU, 6 GB RAM, 120 GB SSD), replacing the
Namecheap shared hosting plan.

## Why shared hosting falls short

| Requirement | Shared hosting | Quasar VPS |
| --- | --- | --- |
| Memory | 1 GB (Stellar) or 2 GB (Stellar Plus/Business) for the whole account, including the database | 6 GB dedicated |
| CPU | 50% of one core (100% on Stellar Business) | 4 dedicated vCPU |
| Simultaneous visitors | Capped at 20–40 entry processes | No fixed cap |
| Database | MySQL/MariaDB, no control over extensions | PostgreSQL with full control (trigram search) |
| Background worker | No always-on processes; cron only | Always-on worker |
| Live chat / real-time | Long-lived connections not reliable | Supported |
| Server access | Restricted cPanel, jailed SSH | Full root |
| Growth | Must migrate | Upgrade in place to Magnetar |

Sources: Namecheap resource limits (LVE) and VPS plan pages, as of 2026-10-29.

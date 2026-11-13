# Module 19 — Deployment, backups and monitoring

**Status:** In review (pull request open; the owner's merge is the approval) · **Needs from owner:** Namecheap Quasar VPS, Google account for backups, Cloudflare account

## Goal

A secure, automatically deployed server with backups and uptime monitoring.

## Steps

- [x] VPS setup: Ubuntu LTS, automatic security updates, firewall (`deploy/setup-server.sh`; run by the owner on the VPS)
- [x] PostgreSQL, Node.js LTS, Caddy, systemd services
- [x] Cloudflare free plan for DNS, caching and attack protection (settings written down; the owner sets up the account)
- [x] Staging site at staging.hairbydemj.com
- [x] GitHub Actions deployment over SSH, with migrations and restarts
- [x] Daily encrypted backups to Google Drive; monthly restore test
- [x] Uptime checks through GitHub Actions with email alerts
- [x] Plain-English operations guide in the repo

## Done when

Merging to `main` deploys automatically, backups run daily and restore
correctly, and downtime triggers an alert.

## Notes (2026-11-13)

- Built on branch `feature/deploy`, on top of modules 2 to 18. Guide:
  [`../operations.md`](../operations.md).
- Staging uses `staging-admin` and `staging-api` (one level below the
  domain) so Cloudflare's free certificate covers them.
- Caddy uses Cloudflare's free origin certificate, and trusts visitors'
  addresses only from Cloudflare.
- Alerts are emailed through the shop's own mail (signed), and the outside
  uptime check opens a GitHub issue, which GitHub emails to watchers.
- The scripts are tested for real with bash in the server tests (release,
  roll back, backup, restore test, server check); shellcheck, systemd and
  Caddy checks run in GitHub Actions.
- Still to do when the owner's accounts exist: run the set-up on the VPS,
  first deployment, connect Google Drive, turn on the uptime check, and see
  the first backup and restore test arrive.

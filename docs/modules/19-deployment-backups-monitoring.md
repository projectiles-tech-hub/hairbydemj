# Module 19 — Deployment, backups and monitoring

**Status:** Not started · **Needs from owner:** Namecheap Quasar VPS, Google account for backups, Cloudflare account

## Goal

A secure, automatically deployed server with backups and uptime monitoring.

## Steps

- [ ] VPS setup: Ubuntu LTS, automatic security updates, firewall
- [ ] PostgreSQL, Node.js LTS, Caddy, systemd services
- [ ] Cloudflare free plan for DNS, caching and attack protection
- [ ] Staging site at staging.hairbydemj.com
- [ ] GitHub Actions deployment over SSH, with migrations and restarts
- [ ] Daily encrypted backups to Google Drive; monthly restore test
- [ ] Uptime checks through GitHub Actions with email alerts
- [ ] Plain-English operations guide in the repo

## Done when

Merging to `main` deploys automatically, backups run daily and restore
correctly, and downtime triggers an alert.

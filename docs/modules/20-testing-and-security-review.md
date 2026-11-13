# Module 20 — Testing and security review

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Confidence that the store works end to end and is secure before launch.

## Steps

- [x] End-to-end tests of every customer and staff journey (browser journeys, plus the server tests for every module)
- [ ] Payments in Paystack and Stripe test modes, all four currencies (the check command and steps are ready; needs the owner's test keys)
- [ ] Shipping labels in carrier test environments (the check command and steps are ready; needs the carriers' test accounts)
- [ ] Beta testers on real iPhones and Android phones (plan written; needs TestFlight, Play internal testing and the testers)
- [x] Performance checks on slow mobile connections
- [ ] Independent security review of sign-in, checkout and payments (recommended) (our own review is done; the independent one is for the owner to arrange)
- [x] Fix everything found (so far: three findings, all fixed)

## Done when

All tests pass, beta feedback is addressed, and security findings are fixed.

## Notes (2026-11-13)

- Built on branch `feature/security-review`, on top of modules 2 to 19.
  Guides: [`../testing.md`](../testing.md) and
  [`../security-review.md`](../security-review.md).
- Browser journeys and the speed budget run in GitHub Actions on every pull
  request (`npm run test:e2e`), with Playwright as a development tool only.
- Security tests try every admin and app address without permission, and
  one customer against another's orders, addresses and chats.
- Findings fixed: saved chat replies readable by any staff member; private
  tokens recorded in the request and Caddy logs; no HTTPS-only header.
- `dist/server/ops/provider-check.js` checks the real accounts in test mode
  once the owner has the keys.

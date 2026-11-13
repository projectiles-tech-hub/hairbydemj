# Module 21 — Launch

**Status:** In review (pull request open; the owner's merge is the approval). The launch itself waits on the owner's accounts · **Needs from owner:** Apple Developer and Google Play accounts, live Paystack and Stripe keys

## Goal

The website and both apps released together on the same day.

## Steps

- [ ] Submit the apps to Apple and Google about one week before launch (ready: signed builds and uploads in `app-release.yml`, store listings, privacy answers and review notes in `launch.md`)
- [ ] Switch payments to live keys (ready: steps in `launch.md`; the launch check confirms it)
- [ ] Final content and product check with the owner (ready: checklist in `launch.md`; the launch check lists products that cannot be bought and sample data left)
- [ ] Release the website and both apps together (ready: launch-day steps in `launch.md`, with both apps held for a manual release)
- [ ] Watch orders, payments and errors closely in the first days (ready: watch list in `launch.md`; alerts and uptime checks from module 19)

## Done when

hairbydemj.com and both apps are live and taking real orders.

## Notes (2026-11-13)

- Built on branch `feature/launch`, on top of modules 2 to 20. Guide:
  [`../launch.md`](../launch.md).
- Everything that can be prepared without the owner's accounts is done: the
  release workflow for both stores, Apple's privacy manifest, the store
  listings and privacy answers, the launch check command, and the steps for
  live keys, launch day and the first days.
- What remains needs the owner: the Apple, Google, Paystack, Stripe and
  carrier accounts, their keys and signing files, the store reviews, and
  the release itself.

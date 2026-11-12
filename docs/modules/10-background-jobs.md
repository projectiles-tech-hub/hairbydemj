# Module 10 — Background jobs

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Our own worker process that runs jobs stored in a PostgreSQL table.

## Steps

- [x] Jobs table and safe one-at-a-time processing
- [x] Retries with delays for failed jobs
- [x] Scheduled jobs (abandoned-cart reminders, stock alerts, cleanups)
- [x] systemd service that keeps the worker running
- [x] Tests

## Done when

Jobs run reliably, failed jobs retry, and scheduled jobs run on time.

## Notes

- Guide: [`../worker.md`](../worker.md). Code: `server/worker/`. Service
  file: `deploy/systemd/hairbydemj-worker.service` (installed in module 19).
  Migration `0017_worker`.
- Emails wait in the queue until module 11 adds the sender.

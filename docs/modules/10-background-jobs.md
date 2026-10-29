# Module 10 — Background jobs

**Status:** Not started

## Goal

Our own worker process that runs jobs stored in a PostgreSQL table.

## Steps

- [ ] Jobs table and safe one-at-a-time processing
- [ ] Retries with delays for failed jobs
- [ ] Scheduled jobs (abandoned-cart reminders, stock alerts, cleanups)
- [ ] systemd service that keeps the worker running
- [ ] Tests

## Done when

Jobs run reliably, failed jobs retry, and scheduled jobs run on time.

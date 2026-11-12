# Background worker

A separate process from the web server that does the work nobody should
wait for: buying labels, sending emails (module 11), reminders, alerts and
regular tidying. The code is in `server/worker/`. No new settings: it reads
the same settings file as the server.

## Running it

| Where | How |
| --- | --- |
| Your computer | `npm run build`, then `npm run worker` (reads `.env`). Stop with Ctrl+C. |
| The server | systemd keeps it running: `deploy/systemd/hairbydemj-worker.service`. Install steps are at the top of that file; module 19 sets it up with the web server. Logs: `journalctl -u hairbydemj-worker -f`. |

It needs `DATABASE_URL`. Stopping it (Ctrl+C, or `systemctl stop`) lets the
job in hand finish first.

## Jobs

The website puts jobs in the `jobs` table; the worker takes the oldest ready
one, runs it, and looks again (every 2 seconds when there is nothing to do).

- **One at a time, never twice.** A job is claimed in one database step
  (`FOR UPDATE SKIP LOCKED`), so two workers can run side by side safely.
- **Tries again, waiting longer each time:** 30 seconds, 2 minutes,
  8 minutes, 32 minutes, then up to 6 hours, five tries in all by default.
  After the last try the job is marked failed.
- **Gives up at once** on a job that can never work (for example a label for
  an order that goes by local courier).
- **A worker that dies mid-job:** the job goes back in the queue after
  15 minutes.
- **Same job once:** a job with a `unique_key` (such as `buy_label:<order>`)
  can only be queued once.
- Finished jobs are removed after 30 days; failed ones stay until staff deal
  with them.

| Job | Queued by | What it does |
| --- | --- | --- |
| `buy_label` | A confirmed payment for a DHL, UPS or FedEx order | Buys the carrier label (see `shipping.md`) |
| `email.send` | Accounts, orders, returns, reminders, alerts | Stays in the queue until module 11 adds the sender |

## Scheduled tasks

Each runs when due, counted from when it last started. A task is claimed in
one database step, so only one worker runs it; a task still marked running
after 30 minutes is taken to have died and can run again.

| Task | How often | What it does |
| --- | --- | --- |
| `expire_unpaid_orders` | 5 minutes | Cancels orders not paid within 30 minutes and lets their stock and gift card money go |
| `refresh_tracking` | 30 minutes | Asks the carriers about parcels still on the way (each parcel at most every 2 hours) |
| `daily_exchange_rates` | Daily | Fetches today's rates and re-works converted prices (see `cart.md`) |
| `back_in_stock_alerts` | 15 minutes | Emails customers who asked to hear when a sold-out item is back; once each |
| `low_stock_alerts` | Hourly | One email to the Owner and staff who can change products, listing items at or below their low-stock line; an item is listed again only after its stock went back above the line |
| `abandoned_cart_reminders` | Hourly | One reminder to signed-in customers who **agreed to marketing emails** and verified their email, when items have sat in their bag for a day (not after a week, not if they have ordered since) |
| `daily_cleanup` | Daily | Removes old sign-in records, delivery quotes, ended sessions and codes, guest bags untouched for 60 days, finished jobs older than 30 days; marks gift cards past their end date as expired |

Video compression is not a worker task: the web server does it straight
after an upload and picks up unfinished ones when it starts (`media.md`).

## For staff (admin, settings area)

| Address | What it does | Needs |
| --- | --- | --- |
| `GET /api/system/jobs?status=failed` | Recent jobs and how many of each status. What a job carries is not shown, as it can hold codes sent by email. | settings view |
| `POST /api/system/jobs/:id/retry` | Try a failed job again with a fresh set of tries | settings change |
| `GET /api/system/schedule` | Each task: when it last ran and its last problem | settings view |

## Tests

`server/worker/worker.test.ts`: unique jobs, order of jobs, two workers
racing for one job, retries and giving up, permanent failures, stuck jobs,
scheduled tasks running once across two workers, every store task on an
empty shop, alerts, reminders, cleanup, the label job, and the loop
starting and stopping cleanly.

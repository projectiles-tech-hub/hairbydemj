-- 0017 Background worker: when each scheduled task last ran, so it runs on
-- time and never twice at once; and what reminders and alerts were sent.

create table scheduled_runs (
  name             text primary key check (name ~ '^[a-z][a-z0-9_]*$'),
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_error       text,
  -- Who is running it now, and since when; a crashed worker's claim expires.
  running_by       text,
  running_since    timestamptz
);

-- A cart reminder is sent once per bag (until the bag changes again).
alter table carts add column reminded_at timestamptz;

-- A low-stock alert is sent once until the stock goes back above the line.
alter table inventory add column low_stock_alerted_at timestamptz;

-- The worker picks the oldest ready job of the kinds it knows.
create index jobs_ready_kind on jobs (kind, run_at) where status = 'queued';

-- 0009 Background jobs: emails, labels, reminders and stock alerts wait here
-- until the worker process picks them up, one at a time.

create table jobs (
  id           bigint generated always as identity primary key,
  kind         text not null,
  payload      jsonb not null default '{}',
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at       timestamptz not null default now(),
  attempts     integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  -- Stops the same job being queued twice, for example one email per order.
  unique_key   text unique,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index jobs_ready on jobs (run_at) where status = 'queued';
create index jobs_running on jobs (locked_at) where status = 'running';
create index jobs_kind on jobs (kind, created_at desc);

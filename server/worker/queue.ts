// The job queue: work the website hands to the worker (labels, emails,
// alerts), kept in the jobs table so nothing is lost if a process restarts.
//
// A job is claimed with FOR UPDATE SKIP LOCKED, so two workers never take the
// same job. A job that fails waits longer before each try; after its last try
// it is marked failed and shown to staff, who can try it again.

import type { Db, DbClient } from '../db/pool.js';

type Q = { query: DbClient['query'] } | Db;

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export const QUEUE = {
  /** A job running longer than this is taken to belong to a worker that died, and is put back. */
  stuckMinutes: 15,
  /** Finished jobs are kept this long, then removed. */
  keepDoneDays: 30,
};

/** Seconds to wait before the next try: 30 s, 2 min, 8 min, 32 min, then up to 6 hours. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 4 ** Math.max(0, attempt - 1), 6 * 3600);
}

/** Add a job. With a uniqueKey, adding the same job twice keeps only the first. Returns its id, or null if it was already there. */
export async function enqueue(db: Q, kind: string, payload: Record<string, unknown>, options: { runAt?: Date; uniqueKey?: string; maxAttempts?: number } = {}): Promise<number | null> {
  const made = await db.query(
    'insert into jobs (kind, payload, run_at, unique_key, max_attempts) values ($1, $2, coalesce($3, now()), $4, $5) on conflict (unique_key) do nothing returning id',
    [kind, JSON.stringify(payload), options.runAt ?? null, options.uniqueKey ?? null, options.maxAttempts ?? 5],
  );
  return made.rows[0] ? Number(made.rows[0].id) : null;
}

/** Take the oldest ready job of these kinds, or null when there is none. */
export async function claimJob(db: Q, kinds: string[], workerId: string, now: Date): Promise<Job | null> {
  if (kinds.length === 0) return null;
  const claimed = await db.query(
    `update jobs set status = 'running', locked_at = $3, locked_by = $2, attempts = attempts + 1
     where id = (select id from jobs where status = 'queued' and run_at <= $3 and kind = any($1::text[]) order by run_at, id for update skip locked limit 1)
     returning id, kind, payload, attempts, max_attempts`,
    [kinds, workerId, now],
  );
  const r = claimed.rows[0];
  return r ? { id: Number(r.id), kind: String(r.kind), payload: (r.payload ?? {}) as Record<string, unknown>, attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts) } : null;
}

export async function finishJob(db: Q, id: number, now: Date): Promise<void> {
  await db.query("update jobs set status = 'done', finished_at = $2, locked_at = null, locked_by = null, last_error = null where id = $1", [id, now]);
}

/** A try failed. Try again later, or give up after the last try. `retry: false` gives up at once (a job that can never work). */
export async function failJob(db: Q, job: Job, error: string, now: Date, retry = true): Promise<{ retryAt: Date | null }> {
  const giveUp = !retry || job.attempts >= job.maxAttempts;
  const retryAt = giveUp ? null : new Date(now.getTime() + retryDelaySeconds(job.attempts) * 1000);
  await db.query(
    "update jobs set status = $2, run_at = coalesce($3, run_at), last_error = $4, locked_at = null, locked_by = null, finished_at = case when $2 = 'failed' then $5::timestamptz else null end where id = $1",
    [job.id, giveUp ? 'failed' : 'queued', retryAt, error.slice(0, 1000), now],
  );
  return { retryAt };
}

/** Jobs left "running" by a worker that stopped mid-way go back in the queue. */
export async function recoverStuckJobs(db: Q, now: Date): Promise<number> {
  const back = await db.query(
    "update jobs set status = 'queued', locked_at = null, locked_by = null, last_error = coalesce(last_error, 'The worker stopped while running this job') where status = 'running' and locked_at < $1::timestamptz - make_interval(mins => $2)",
    [now, QUEUE.stuckMinutes],
  );
  return back.rowCount ?? 0;
}

/** For the admin: recent jobs, newest first, optionally only one status. */
export async function listJobs(db: Q, status: string | null): Promise<{ jobs: Array<Record<string, unknown>>; counts: Record<string, number> }> {
  const valid = ['queued', 'running', 'done', 'failed'];
  const filter = status && valid.includes(status) ? status : null;
  const found = await db.query(
    `select id, kind, status, attempts, max_attempts, run_at, last_error, created_at, finished_at from jobs ${filter ? 'where status = $1' : ''} order by id desc limit 200`,
    filter ? [filter] : [],
  );
  const counts = await db.query('select status, count(*)::int as n from jobs group by status');
  return {
    // Payloads are left out: they can hold codes sent by email.
    jobs: found.rows.map((r) => ({ id: Number(r.id), kind: r.kind, status: r.status, attempts: r.attempts, maxAttempts: r.max_attempts, runAt: (r.run_at as Date).toISOString(), lastError: r.last_error, createdAt: (r.created_at as Date).toISOString(), finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null })),
    counts: Object.fromEntries(counts.rows.map((r) => [String(r.status), Number(r.n)])),
  };
}

/** Staff try a failed job again, with a fresh set of tries. */
export async function retryJob(db: Q, id: number, now: Date): Promise<boolean> {
  const changed = await db.query("update jobs set status = 'queued', attempts = 0, run_at = $2, finished_at = null where id = $1 and status = 'failed'", [id, now]);
  return (changed.rowCount ?? 0) > 0;
}

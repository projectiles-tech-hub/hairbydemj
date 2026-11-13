// The worker's loop: run ready jobs one at a time, and start each scheduled
// task when it is due. Several workers may run at once safely: a job is
// claimed by one, and a scheduled task is claimed by one.

import { hostname } from 'node:os';
import type { Db } from '../db/pool.js';
import { claimJob, failJob, finishJob, recoverStuckJobs, type Job } from './queue.js';
import { HANDLERS, PermanentFailure, SCHEDULE, type JobHandler, type ScheduledTask, type WorkerDeps } from './tasks.js';

export const WORKER = {
  /** Wait between looks at the queue when there is nothing to do. */
  idleMs: 2000,
  /** A scheduled task still marked running after this long is taken to have died with its worker. */
  taskTimeoutMinutes: 30,
};

export function workerId(): string {
  return `${hostname()}:${process.pid}`;
}

/** Run one job. Returns false when there was no job to run. */
export async function runOneJob(deps: WorkerDeps, id: string, handlers: Record<string, JobHandler> = HANDLERS): Promise<boolean> {
  const job = await claimJob(deps.db, Object.keys(handlers), id, deps.now());
  if (!job) return false;
  const handler = handlers[job.kind] as JobHandler;
  const started = Date.now();
  try {
    await handler(deps, job);
    await finishJob(deps.db, job.id, deps.now());
    deps.logger.info('job done', { jobId: job.id, kind: job.kind, attempt: job.attempts, ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = error instanceof PermanentFailure;
    const { retryAt } = await failJob(deps.db, job, message, deps.now(), !permanent);
    const log = retryAt ? deps.logger.warn.bind(deps.logger) : deps.logger.error.bind(deps.logger);
    log(retryAt ? 'job failed, will try again' : 'job failed for good', { jobId: job.id, kind: job.kind, attempt: job.attempts, retryAt: retryAt?.toISOString() ?? null, error: message });
  }
  return true;
}

/**
 * Claim a scheduled task if it is due and nobody else is running it.
 * One SQL statement, so two workers cannot both claim it.
 */
async function claimTask(db: Db, task: ScheduledTask, id: string, now: Date): Promise<boolean> {
  await db.query('insert into scheduled_runs (name) values ($1) on conflict (name) do nothing', [task.name]);
  const claimed = await db.query(
    `update scheduled_runs set running_by = $2, running_since = $3, last_started_at = $3
     where name = $1
       and (last_started_at is null or last_started_at <= $3::timestamptz - make_interval(mins => $4))
       and (running_by is null or running_since < $3::timestamptz - make_interval(mins => $5))
     returning name`,
    [task.name, id, now, task.everyMinutes, WORKER.taskTimeoutMinutes],
  );
  return (claimed.rowCount ?? 0) > 0;
}

/** Start every task that is due. Returns the names of those that ran. */
export async function runDueTasks(deps: WorkerDeps, id: string, schedule: ScheduledTask[] = SCHEDULE): Promise<string[]> {
  const ran: string[] = [];
  for (const task of schedule) {
    if (!(await claimTask(deps.db, task, id, deps.now()))) continue;
    try {
      const result = await task.run(deps);
      await deps.db.query('update scheduled_runs set last_finished_at = $2, last_error = null, running_by = null, running_since = null where name = $1', [task.name, deps.now()]);
      deps.logger.info('scheduled task done', { task: task.name, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.db.query('update scheduled_runs set last_finished_at = $2, last_error = $3, running_by = null, running_since = null where name = $1', [task.name, deps.now(), message.slice(0, 1000)]);
      deps.logger.error('scheduled task failed', { task: task.name, error: message });
    }
    ran.push(task.name);
  }
  return ran;
}

export interface Worker {
  /** Runs until stop() is called; resolves when the current job has finished. */
  run(): Promise<void>;
  stop(): void;
}

export function createWorker(deps: WorkerDeps, id = workerId()): Worker {
  let stopping = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  return {
    async run() {
      deps.logger.info('worker started', { worker: id, jobs: Object.keys(HANDLERS), tasks: SCHEDULE.map((t) => t.name) });
      let lastSchedule = 0;
      while (!stopping) {
        try {
          if (Date.now() - lastSchedule > 30_000) {
            lastSchedule = Date.now();
            const back = await recoverStuckJobs(deps.db, deps.now());
            if (back) deps.logger.warn('jobs put back after a worker stopped', { count: back });
            await runDueTasks(deps, id);
          }
          const worked = await runOneJob(deps, id);
          if (!worked && !stopping) await sleep(WORKER.idleMs);
        } catch (error) {
          // The database may be restarting; wait a little and carry on.
          deps.logger.error('worker loop error', { error });
          if (!stopping) await sleep(5000);
        }
      }
      deps.logger.info('worker stopped', { worker: id });
    },
    stop() {
      stopping = true;
      wake?.();
    },
  };
}

export type { Job };

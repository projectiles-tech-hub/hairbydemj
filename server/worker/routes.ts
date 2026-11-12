// Staff addresses for the worker (admin, settings area):
//   GET  /api/system/jobs?status=failed   recent jobs and how many of each status
//   POST /api/system/jobs/:id/retry       try a failed job again
//   GET  /api/system/schedule             each scheduled task: last run, last problem

import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { ApiError, clientIp, sendJson } from '../http.js';
import type { Router } from '../router.js';
import { listJobs, retryJob } from './queue.js';
import { SCHEDULE } from './tasks.js';

export function adminWorkerRoutes(router: Router, accounts: AccountDeps): Router {
  return router
    .get('/api/system/jobs', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'view');
      sendJson(ctx.res, 200, await listJobs(accounts.db, ctx.query.get('status')));
    })
    .post('/api/system/jobs/:id/retry', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'change');
      const id = Number(ctx.params.id);
      if (!Number.isInteger(id) || id < 1 || !(await retryJob(accounts.db, id, accounts.now()))) throw new ApiError(404, 'not_found', 'There is no failed job with that number.');
      await logActivity(accounts.db, staff, 'Settings', `Tried job ${id} again`, { type: 'job', id }, clientIp(ctx.req, accounts.config.trustProxy));
      sendJson(ctx.res, 200, { retried: true });
    })
    .get('/api/system/schedule', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'view');
      const runs = await accounts.db.query('select name, last_started_at, last_finished_at, last_error, running_since from scheduled_runs');
      const byName = new Map(runs.rows.map((r) => [String(r.name), r]));
      const iso = (v: unknown): string | null => (v ? (v as Date).toISOString() : null);
      sendJson(ctx.res, 200, {
        tasks: SCHEDULE.map((t) => {
          const r = byName.get(t.name);
          return { name: t.name, everyMinutes: t.everyMinutes, lastStartedAt: iso(r?.last_started_at), lastFinishedAt: iso(r?.last_finished_at), lastError: (r?.last_error as string | null) ?? null, running: Boolean(r?.running_since) };
        }),
      });
    });
}

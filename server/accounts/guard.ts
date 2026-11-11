// Slows down password and code guessing. Every sign-in attempt is recorded;
// too many failures for one account or from one address in a short time are
// refused until the window passes.

import type { Db } from '../db/pool.js';
import { ApiError } from '../http.js';

export type AttemptKind = 'customer' | 'staff' | 'staff_two_step' | 'code' | 'sign_up';

export const GUARD = {
  windowMinutes: 15,
  /** Failed tries allowed for one account in the window. */
  perSubject: 5,
  /** Failed tries allowed from one address in the window, across all accounts. */
  perIp: 30,
};

/** Throws a 429 error if this account or address has failed too often recently. */
export async function checkAttempts(db: Db, kind: AttemptKind, subject: string, ip: string | null): Promise<void> {
  const result = await db.query(
    `select
       (select count(*)::int from sign_in_attempts where kind = $1 and subject = $2 and not succeeded and created_at > now() - make_interval(mins => $4)
          and created_at > coalesce((select max(created_at) from sign_in_attempts where kind = $1 and subject = $2 and succeeded), '-infinity')) as by_subject,
       (select count(*)::int from sign_in_attempts where ip = $3::inet and not succeeded and created_at > now() - make_interval(mins => $4)) as by_ip`,
    [kind, subject, ip, GUARD.windowMinutes],
  );
  const row = result.rows[0] as { by_subject: number; by_ip: number };
  if (row.by_subject >= GUARD.perSubject || row.by_ip >= GUARD.perIp) {
    throw new ApiError(429, 'too_many_attempts', `Too many tries. Wait ${GUARD.windowMinutes} minutes and try again.`, {}, { 'Retry-After': String(GUARD.windowMinutes * 60) });
  }
}

export async function recordAttempt(db: Db, kind: AttemptKind, subject: string, ip: string | null, succeeded: boolean): Promise<void> {
  await db.query('insert into sign_in_attempts (kind, subject, ip, succeeded) values ($1, $2, $3::inet, $4)', [kind, subject, ip, succeeded]);
}

/** Old records are of no use; the worker calls this from time to time. */
export async function pruneAttempts(db: Db): Promise<number> {
  const result = await db.query("delete from sign_in_attempts where created_at < now() - interval '30 days'");
  return result.rowCount ?? 0;
}

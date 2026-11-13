// What the worker does: the jobs it knows how to run, and the tasks it runs
// on a schedule.

import { pruneAttempts } from '../accounts/guard.js';
import type { Mailer } from '../accounts/mailer.js';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { Logger } from '../logger.js';
import { refreshDailyRates, type RatesFetcher } from '../cart/rates.js';
import { VISIBLE_SQL } from '../catalog/rules.js';
import { expireUnpaidOrders, type OrderDeps } from '../orders/checkout.js';
import { buyLabel, pruneQuotes, refreshAllTracking, type ShippingDeps } from '../shipping/shipping.js';
import { deliverEmail, deliverOrderUpdate, Undeliverable, type NotifyDeps } from '../notifications/notify.js';
import { enqueue, QUEUE, type Job } from './queue.js';
import { birthdayPoints, settleOrderPoints, settleReferrals } from '../loyalty/loyalty.js';

export interface WorkerDeps {
  db: Db;
  now: () => Date;
  logger: Logger;
  config: Config;
  mail: Mailer;
  shipping: ShippingDeps;
  orders: OrderDeps;
  fetchRates: RatesFetcher;
  notify: NotifyDeps;
}

/** Thrown by a job that can never succeed, so it is not tried again. */
export class PermanentFailure extends Error {
  override name = 'PermanentFailure';
}

export type JobHandler = (deps: WorkerDeps, job: Job) => Promise<void>;

/**
 * The jobs this worker runs, by kind. Kinds without a handler stay in the
 * queue untouched until a module adds one (emails are sent from module 11).
 */
export const HANDLERS: Record<string, JobHandler> = {
  async 'email.send'(deps, job) {
    try {
      const outcome = await deliverEmail(deps.notify, job.payload);
      if (outcome === 'skipped') deps.logger.info('email not sent: the person has turned this kind off', { jobId: job.id, template: job.payload.template });
    } catch (error) {
      if (error instanceof Undeliverable) throw new PermanentFailure(error.message);
      throw error;
    }
  },
  async order_update(deps, job) {
    try {
      await deliverOrderUpdate(deps.notify, job.payload, async (to, data) => {
        await enqueue(deps.db, 'email.send', { to, template: 'order_update', data }, { uniqueKey: `order_update_email:${job.id}` });
      });
    } catch (error) {
      if (error instanceof Undeliverable) throw new PermanentFailure(error.message);
      throw error;
    }
  },
  async buy_label(deps, job) {
    const orderId = Number(job.payload.orderId);
    if (!Number.isInteger(orderId) || orderId < 1) throw new PermanentFailure('The job has no order');
    try {
      const result = await buyLabel(deps.shipping, orderId, null);
      deps.logger.info('label bought', { orderId, trackingNumber: result.trackingNumber, created: result.created });
    } catch (error) {
      // Some answers mean the label should not be bought at all; trying again would not help.
      if (error instanceof ApiError && ['local_delivery', 'not_paid', 'order_closed', 'no_service', 'nothing_to_ship', 'not_found'].includes(error.code)) {
        throw new PermanentFailure(error.message);
      }
      throw error;
    }
  },
};

export interface ScheduledTask {
  name: string;
  /** How often, in minutes, counted from when it last started. */
  everyMinutes: number;
  run: (deps: WorkerDeps) => Promise<Record<string, unknown>>;
}

export const SCHEDULE: ScheduledTask[] = [
  {
    name: 'expire_unpaid_orders',
    everyMinutes: 5,
    run: async (deps) => ({ cancelled: await expireUnpaidOrders(deps.orders) }),
  },
  {
    name: 'loyalty_points',
    everyMinutes: 30,
    run: async (deps) => ({ orders: await settleOrderPoints(deps.db, deps.now()), referrals: await settleReferrals(deps.db, deps.now()) }),
  },
  {
    name: 'birthday_points',
    everyMinutes: 24 * 60,
    run: async (deps) => ({ customers: await birthdayPoints(deps.db, deps.now()) }),
  },
  {
    name: 'refresh_tracking',
    everyMinutes: 30,
    run: async (deps) => refreshAllTracking(deps.shipping),
  },
  {
    name: 'daily_exchange_rates',
    everyMinutes: 24 * 60,
    run: async (deps) => refreshDailyRates(deps.db, deps.config.ratesUrl, deps.fetchRates, deps.now()),
  },
  {
    name: 'back_in_stock_alerts',
    everyMinutes: 15,
    run: async (deps) => ({ sent: await backInStockAlerts(deps) }),
  },
  {
    name: 'low_stock_alerts',
    everyMinutes: 60,
    run: async (deps) => lowStockAlerts(deps),
  },
  {
    name: 'abandoned_cart_reminders',
    everyMinutes: 60,
    run: async (deps) => ({ sent: await abandonedCartReminders(deps) }),
  },
  {
    name: 'daily_cleanup',
    everyMinutes: 24 * 60,
    run: async (deps) => dailyCleanup(deps),
  },
];

/** Customers who asked to hear when a sold-out item is back. Each is told once. */
export async function backInStockAlerts(deps: WorkerDeps, limit = 200): Promise<number> {
  const found = await deps.db.query(
    `select r.id, r.email, p.name, p.slug, v.length_inches, v.colour
     from back_in_stock_requests r
     join variants v on v.id = r.variant_id and v.is_active
     join products p on p.id = v.product_id and ${VISIBLE_SQL('p', '$1')}
     join inventory i on i.variant_id = v.id and i.on_hand - i.reserved > 0
     where r.notified_at is null order by r.created_at limit $2`,
    [deps.now(), limit],
  );
  for (const r of found.rows) {
    await deps.mail.send({ to: String(r.email), template: 'back_in_stock', data: { productName: String(r.name), slug: String(r.slug), variant: [r.length_inches ? `${Number(r.length_inches)}"` : '', r.colour ?? ''].filter(Boolean).join(' ') } });
    await deps.db.query('update back_in_stock_requests set notified_at = $2 where id = $1', [r.id, deps.now()]);
  }
  return found.rows.length;
}

/**
 * One email to the staff who look after products, listing items that have
 * fallen to their low-stock line. An item is listed once, until its stock
 * goes back above the line.
 */
export async function lowStockAlerts(deps: WorkerDeps): Promise<{ items: number; recipients: number }> {
  await deps.db.query('update inventory set low_stock_alerted_at = null where low_stock_alerted_at is not null and on_hand - reserved > low_stock_threshold');
  const low = await deps.db.query(
    `select i.variant_id, v.sku, p.name, greatest(i.on_hand - i.reserved, 0)::int as available
     from inventory i join variants v on v.id = i.variant_id and v.is_active join products p on p.id = v.product_id and p.status <> 'unpublished'
     where i.low_stock_alerted_at is null and i.on_hand - i.reserved <= i.low_stock_threshold order by available, p.name limit 200`,
  );
  if (low.rows.length === 0) return { items: 0, recipients: 0 };
  const staff = await deps.db.query(
    `select s.email from staff s join roles r on r.id = s.role_id
     where s.status = 'active' and (r.is_owner or exists (select 1 from role_permissions rp where rp.role_id = r.id and rp.area = 'products' and rp.can_change))`,
  );
  const list = low.rows.map((r) => `${String(r.name)} (${String(r.sku)}): ${Number(r.available)} left`).join('\n');
  for (const s of staff.rows) await deps.mail.send({ to: String(s.email), template: 'low_stock', data: { count: String(low.rows.length), items: list } });
  await deps.db.query('update inventory set low_stock_alerted_at = $2 where variant_id = any($1::bigint[])', [low.rows.map((r) => r.variant_id), deps.now()]);
  return { items: low.rows.length, recipients: staff.rows.length };
}

/**
 * A gentle reminder to signed-in customers who agreed to hear from us and
 * left items in their bag for a day. Once per bag: adding something new
 * makes a later reminder possible again. Nothing after a week.
 */
export async function abandonedCartReminders(deps: WorkerDeps, limit = 200): Promise<number> {
  const found = await deps.db.query(
    `select c.id, cu.email, cu.first_name, (select count(*)::int from cart_items where cart_id = c.id) as items, (select max(added_at) from cart_items where cart_id = c.id) as last_added
     from carts c join customers cu on cu.id = c.customer_id
     where cu.marketing_consent and cu.email_verified_at is not null
       and exists (select 1 from cart_items where cart_id = c.id)
       and (select max(added_at) from cart_items where cart_id = c.id) between $1::timestamptz - interval '7 days' and $1::timestamptz - interval '24 hours'
       and (c.reminded_at is null or c.reminded_at < (select max(added_at) from cart_items where cart_id = c.id))
       and not exists (select 1 from orders o where o.customer_id = cu.id and o.placed_at > (select max(added_at) from cart_items where cart_id = c.id))
     order by c.id limit $2`,
    [deps.now(), limit],
  );
  for (const r of found.rows) {
    await deps.mail.send({ to: String(r.email), template: 'abandoned_cart', data: { firstName: String(r.first_name ?? ''), itemCount: String(r.items) } });
    await deps.db.query('update carts set reminded_at = $2 where id = $1', [r.id, deps.now()]);
  }
  return found.rows.length;
}

/** Tidying that keeps the database small: old records nobody needs any more. */
export async function dailyCleanup(deps: WorkerDeps): Promise<Record<string, number>> {
  const now = deps.now();
  const count = async (sql: string, values: unknown[] = []): Promise<number> => (await deps.db.query(sql, values)).rowCount ?? 0;
  return {
    signInAttempts: await pruneAttempts(deps.db),
    shippingQuotes: await pruneQuotes(deps.db, now),
    customerSessions: await count("delete from customer_sessions where coalesce(revoked_at, expires_at) < $1::timestamptz - interval '7 days'", [now]),
    staffSessions: await count("delete from staff_sessions where expires_at < $1::timestamptz - interval '7 days'", [now]),
    customerTokens: await count("delete from customer_tokens where expires_at < $1::timestamptz - interval '7 days'", [now]),
    // Guest bags nobody has touched for 60 days (the cookie has run out by then).
    guestCarts: await count("delete from carts where customer_id is null and updated_at < $1::timestamptz - interval '60 days'", [now]),
    finishedJobs: await count("delete from jobs where status = 'done' and finished_at < $1::timestamptz - make_interval(days => $2)", [now, QUEUE.keepDoneDays]),
    searchRecords: await count("delete from search_queries where created_at < $1::timestamptz - interval '180 days'", [now]),
    expiredGiftCards: await count("update gift_cards set status = 'expired' where status in ('active', 'pending') and expires_at is not null and expires_at < $1", [now]),
  };
}

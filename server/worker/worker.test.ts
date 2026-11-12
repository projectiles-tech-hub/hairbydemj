import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { accountDeps, type AccountDeps } from '../accounts/deps.js';
import { memoryMailer } from '../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../accounts/oidc.js';
import { signedInStaff } from '../accounts/testing.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { orderDeps } from '../orders/routes.js';
import { shippingDeps } from '../shipping/routes.js';
import { apns, fcm } from '../notifications/push.js';
import { claimJob, enqueue, recoverStuckJobs, retryDelaySeconds } from './queue.js';
import { abandonedCartReminders, backInStockAlerts, dailyCleanup, HANDLERS, lowStockAlerts, PermanentFailure, SCHEDULE, type WorkerDeps } from './tasks.js';
import { createWorker, runDueTasks, runOneJob } from './worker.js';

test('each retry waits longer, up to six hours', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(retryDelaySeconds), [30, 120, 480, 1920, 7680, 21600, 21600]);
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

describe('the background worker', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let worker: WorkerDeps;
  let server: Server;
  let port: number;
  let owner = '';
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const mail = memoryMailer();
  const quiet = createLogger('error', () => undefined);
  const job = async (id: number): Promise<Record<string, any>> => (await db.query('select status, attempts, run_at, last_error, finished_at from jobs where id = $1', [id])).rows[0] as Record<string, any>;

  function admin(method: string, path: string): Promise<{ status: number; body: Record<string, any> }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: 'admin.localhost', Origin: 'http://admin.localhost', Cookie: owner } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, any> }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 10 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({});
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    worker = { db, now: () => clock, logger: quiet, config, mail, shipping: shippingDeps(deps, quiet), orders: orderDeps(deps, quiet), fetchRates: async () => ({ USD: 0.000625, GBP: 0.0005, EUR: 0.00058 }),
      notify: { db, now: () => clock, logger: quiet, config, push: { ios: apns({ keyId: '', teamId: '', privateKey: '', bundleId: 'x', url: 'https://x' }), android: fcm({ projectId: '', clientEmail: '', privateKey: '', apiUrl: 'https://x', tokenUrl: 'https://x' }) } } };
    server = createServer(createApp(config, quiet, { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('jobs: the same unique job once, oldest first, only kinds the worker knows, none from the future', async () => {
    const a = await enqueue(db, 'test_a', { n: 1 }, { uniqueKey: 'test:1', runAt: new Date('2026-06-01T08:00:00Z') });
    assert.ok(a);
    assert.equal(await enqueue(db, 'test_a', { n: 2 }, { uniqueKey: 'test:1' }), null);
    const b = await enqueue(db, 'test_a', { n: 3 }, { runAt: new Date('2026-06-01T07:00:00Z') });
    await enqueue(db, 'test_a', { n: 4 }, { runAt: new Date('2026-06-02T00:00:00Z') });
    await enqueue(db, 'test_unknown', {}, { runAt: new Date('2026-06-01T06:00:00Z') });
    const first = await claimJob(db, ['test_a'], 'w1', clock);
    const second = await claimJob(db, ['test_a'], 'w1', clock);
    assert.deepEqual([first?.id, second?.id, first?.attempts], [b, a, 1]);
    assert.equal(await claimJob(db, ['test_a'], 'w1', clock), null, 'the third is not due yet');
    await db.query("update jobs set status = 'done' where kind in ('test_a', 'test_unknown')");
  });

  test('two workers never take the same job', async () => {
    const id = await enqueue(db, 'test_race', {}, { runAt: clock });
    const claims = await Promise.all(Array.from({ length: 6 }, (_, k) => claimJob(db, ['test_race'], `w${k}`, clock)));
    assert.deepEqual(claims.filter(Boolean).map((j) => j?.id), [id]);
  });

  test('a failing job is tried again later, then given up; a permanent failure is given up at once', async () => {
    let calls = 0;
    const handlers = {
      test_flaky: async () => {
        calls += 1;
        throw new Error('carrier is down');
      },
      test_never: async () => {
        throw new PermanentFailure('no such order');
      },
      test_fine: async () => undefined,
    };
    const flaky = Number(await enqueue(db, 'test_flaky', {}, { maxAttempts: 3, runAt: clock }));
    assert.equal(await runOneJob(worker, 'w1', handlers), true);
    let row = await job(flaky);
    assert.deepEqual([row.status, row.attempts, row.last_error, (row.run_at as Date).getTime() - clock.getTime()], ['queued', 1, 'carrier is down', 30_000]);
    assert.equal(await runOneJob(worker, 'w1', handlers), false, 'not before its time');
    tick(31);
    await runOneJob(worker, 'w1', handlers);
    row = await job(flaky);
    assert.deepEqual([row.status, row.attempts, (row.run_at as Date).getTime() - clock.getTime()], ['queued', 2, 120_000]);
    tick(121);
    await runOneJob(worker, 'w1', handlers);
    row = await job(flaky);
    assert.deepEqual([row.status, row.attempts, calls], ['failed', 3, 3]);
    assert.ok(row.finished_at);

    const never = Number(await enqueue(db, 'test_never', {}, { runAt: clock }));
    await runOneJob(worker, 'w1', handlers);
    assert.deepEqual([(await job(never)).status, (await job(never)).attempts], ['failed', 1]);
    const fine = Number(await enqueue(db, 'test_fine', {}, { runAt: clock }));
    await runOneJob(worker, 'w1', handlers);
    assert.equal((await job(fine)).status, 'done');

    // Staff see the failures and can try one again.
    const failed = await admin('GET', '/api/system/jobs?status=failed');
    assert.deepEqual(failed.body.jobs.map((j: any) => j.kind).sort(), ['test_flaky', 'test_never']);
    assert.ok(!('payload' in failed.body.jobs[0]), 'payloads (which can hold codes) are not shown');
    assert.equal((await admin('POST', `/api/system/jobs/${flaky}/retry`)).status, 200);
    assert.deepEqual([(await job(flaky)).status, (await job(flaky)).attempts], ['queued', 0]);
    assert.equal((await admin('POST', `/api/system/jobs/${fine}/retry`)).status, 404, 'only failed jobs');
    await db.query('update jobs set status = $2 where id = $1', [flaky, 'done']);
  });

  test('a job left running by a worker that died goes back in the queue', async () => {
    const id = Number(await enqueue(db, 'test_stuck', {}, { runAt: new Date(clock.getTime() - 30 * 60_000) }));
    await claimJob(db, ['test_stuck'], 'dead-worker', new Date(clock.getTime() - 20 * 60_000));
    assert.equal(await recoverStuckJobs(db, clock), 1);
    assert.equal((await job(id)).status, 'queued');
    await db.query("update jobs set status = 'done' where id = $1", [id]);
  });

  test('scheduled tasks run when due, once, and a failure is recorded', async () => {
    let runs = 0;
    const schedule = [
      { name: 'test_every_hour', everyMinutes: 60, run: async () => ({ runs: ++runs }) },
      { name: 'test_broken', everyMinutes: 60, run: async () => { throw new Error('rates service down'); } },
    ];
    assert.deepEqual(await runDueTasks(worker, 'w1', schedule), ['test_every_hour', 'test_broken']);
    assert.deepEqual(await runDueTasks(worker, 'w1', schedule), []);
    tick(30 * 60);
    assert.deepEqual(await runDueTasks(worker, 'w1', schedule), []);
    tick(31 * 60);
    // Two workers looking at once: one runs it.
    const both = await Promise.all([runDueTasks(worker, 'w1', schedule.slice(0, 1)), runDueTasks(worker, 'w2', schedule.slice(0, 1))]);
    assert.equal(both.flat().length, 1);
    assert.equal(runs, 2);
    const broken = (await db.query("select last_error, running_by from scheduled_runs where name = 'test_broken'")).rows[0];
    assert.deepEqual([broken?.last_error, broken?.running_by], ['rates service down', null]);
  });

  test('every scheduled task of the store runs cleanly on an empty shop', async () => {
    const ran = await runDueTasks(worker, 'w1');
    assert.deepEqual(ran, SCHEDULE.map((t) => t.name));
    const errors = await db.query("select name, last_error from scheduled_runs where name not like 'test_%' and last_error is not null");
    assert.deepEqual(errors.rows, []);
    assert.equal((await db.query("select rate_from_base from currencies where code = 'USD'")).rows[0]?.rate_from_base, '0.00062500', 'daily rates were fetched');
    const listed = await admin('GET', '/api/system/schedule');
    assert.ok(listed.body.tasks.every((t: any) => t.lastStartedAt && !t.running));
  });

  test('back-in-stock and low-stock alerts are sent once', async () => {
    const product = await db.query("insert into products (name, slug, status) values ('Kinky curly wig', 'kinky-curly-wig', 'published') returning id");
    const variant = Number((await db.query("insert into variants (product_id, sku, weight_grams, length_inches, colour) values ($1, 'KC-1', 300, 20, 'Natural black') returning id", [product.rows[0]?.id])).rows[0]?.id);
    await db.query('insert into inventory (variant_id, on_hand, low_stock_threshold) values ($1, 0, 3)', [variant]);
    await db.query("insert into back_in_stock_requests (variant_id, email) values ($1, 'wants@example.com')", [variant]);
    assert.equal(await backInStockAlerts(worker), 0, 'still sold out');
    const low = await lowStockAlerts(worker);
    assert.deepEqual(low, { items: 1, recipients: 1 });
    assert.equal(mail.last('low_stock', 'owner@hairbydemj.test').data.items, 'Kinky curly wig (KC-1): 0 left');
    assert.deepEqual(await lowStockAlerts(worker), { items: 0, recipients: 0 }, 'not again');

    await db.query('update inventory set on_hand = 10 where variant_id = $1', [variant]);
    assert.equal(await backInStockAlerts(worker), 1);
    assert.deepEqual(mail.last('back_in_stock', 'wants@example.com').data, { productName: 'Kinky curly wig', slug: 'kinky-curly-wig', variant: '20" Natural black' });
    assert.equal(await backInStockAlerts(worker), 0);
    // Back above the line and down again: one new alert.
    await lowStockAlerts(worker);
    await db.query('update inventory set on_hand = 2 where variant_id = $1', [variant]);
    assert.equal((await lowStockAlerts(worker)).items, 1);
  });

  test('bag reminders go only to customers who agreed, once per bag, after a day', async () => {
    const product = await db.query("insert into products (name, slug, status) values ('Bob wig', 'bob-wig', 'published') returning id");
    const variant = Number((await db.query("insert into variants (product_id, sku, weight_grams) values ($1, 'BOB-1', 300) returning id", [product.rows[0]?.id])).rows[0]?.id);
    const customer = async (email: string, consent: boolean): Promise<number> => {
      const c = await db.query("insert into customers (email, first_name, email_verified_at, marketing_consent) values ($1, 'Ada', now(), $2) returning id", [email, consent]);
      const id = Number(c.rows[0]?.id);
      const cart = await db.query("insert into carts (customer_id, currency) values ($1, 'NGN') returning id", [id]);
      await db.query('insert into cart_items (cart_id, variant_id, quantity, added_at) values ($1, $2, 1, $3)', [cart.rows[0]?.id, variant, new Date(clock.getTime() - 25 * 3600_000)]);
      return Number(cart.rows[0]?.id);
    };
    const yes = await customer('yes@example.com', true);
    await customer('no@example.com', false);
    assert.equal(await abandonedCartReminders(worker), 1);
    assert.equal(mail.last('abandoned_cart', 'yes@example.com').data.itemCount, '1');
    assert.equal(await abandonedCartReminders(worker), 0, 'once per bag');
    // Something new in the bag, a day later: one more reminder.
    const other = await db.query("insert into products (name, slug, status) values ('Frontal', 'frontal', 'published') returning id");
    const v2 = Number((await db.query("insert into variants (product_id, sku, weight_grams) values ($1, 'FR-1', 100) returning id", [other.rows[0]?.id])).rows[0]?.id);
    tick(60);
    await db.query('insert into cart_items (cart_id, variant_id, quantity, added_at) values ($1, $2, 1, $3)', [yes, v2, clock]);
    assert.equal(await abandonedCartReminders(worker), 0, 'not before a day has passed');
    tick(25 * 3600);
    assert.equal(await abandonedCartReminders(worker), 1);
  });

  test('daily cleanup removes what nobody needs and expires old gift cards', async () => {
    await db.query("insert into carts (token_hash, currency, updated_at) values ('\\x01', 'NGN', $1::timestamptz - interval '61 days')", [clock]);
    await db.query("insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, recipient_email, status, expires_at) values ('\\x02', 'ABCD', 'NGN', 100, 100, 'x@example.com', 'active', $1::timestamptz - interval '1 day')", [clock]);
    const id = Number(await enqueue(db, 'test_old', {}));
    await db.query("update jobs set status = 'done', finished_at = $2::timestamptz - interval '31 days' where id = $1", [id, clock]);
    const result = await dailyCleanup(worker);
    assert.ok((result.guestCarts ?? 0) >= 1 && result.expiredGiftCards === 1 && (result.finishedJobs ?? 0) >= 1, JSON.stringify(result));
    assert.equal((await db.query("select status from gift_cards where code_last4 = 'ABCD'")).rows[0]?.status, 'expired');
  });

  test('a label job for an order that goes by local courier is not tried again', async () => {
    const order = await db.query("insert into orders (email, currency, subtotal_minor, total_minor, payment_status, status, shipping_carrier) values ('a@example.com', 'NGN', 100, 100, 'paid', 'to_fulfil', 'local') returning id");
    const id = Number(await enqueue(db, 'buy_label', { orderId: Number(order.rows[0]?.id) }, { runAt: clock }));
    await runOneJob(worker, 'w1', { buy_label: HANDLERS.buy_label! });
    const row = await job(id);
    assert.deepEqual([row.status, row.attempts], ['failed', 1]);
    assert.match(String(row.last_error), /local courier/);
  });

  test('the worker loop runs jobs as they arrive and stops cleanly', async () => {
    const done: number[] = [];
    HANDLERS.test_loop = async (_deps, j) => {
      done.push(Number(j.payload.n));
    };
    try {
      const loop = createWorker({ ...worker, now: () => new Date(clock) }, 'loop-test');
      const running = loop.run();
      await enqueue(db, 'test_loop', { n: 1 }, { runAt: clock });
      await enqueue(db, 'test_loop', { n: 2 }, { runAt: clock });
      for (let i = 0; i < 100 && done.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      loop.stop();
      await running;
      assert.deepEqual(done, [1, 2]);
    } finally {
      delete HANDLERS.test_loop;
    }
  });
});

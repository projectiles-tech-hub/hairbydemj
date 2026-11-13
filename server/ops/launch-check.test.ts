// The launch check finds test keys, sample data and missing set-up, and
// says "Ready" once they are dealt with.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { checkDatabase, checkSettings, launchReport } from './launch-check.js';

const LIVE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x@127.0.0.1/x',
  AUTH_SECRET: 'a'.repeat(48),
  TRUST_PROXY: 'true',
  SITE_HOST: 'hairbydemj.com',
  ADMIN_HOST: 'admin.hairbydemj.com',
  API_HOST: 'api.hairbydemj.com',
  PAYSTACK_SECRET_KEY: 'sk_live_a',
  PAYSTACK_PUBLIC_KEY: 'pk_live_a',
  STRIPE_SECRET_KEY: 'sk_live_b',
  STRIPE_PUBLISHABLE_KEY: 'pk_live_b',
  STRIPE_WEBHOOK_SECRET: 'whsec_c',
  MAIL_TRANSPORT: 'smtp',
  MAIL_FROM: 'hairbydemj <hello@hairbydemj.com>',
  DKIM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
  DHL_API_KEY: 'k',
  DHL_API_SECRET: 's',
  DHL_ACCOUNT_NUMBER: '1',
  ALERT_EMAIL: 'owner@hairbydemj.com',
};

describe('launch check: settings', () => {
  test('test keys, log-only email and a test carrier are problems', () => {
    const env = { ...LIVE, PAYSTACK_SECRET_KEY: 'sk_test_a', MAIL_TRANSPORT: 'log', DHL_API_URL: 'https://express.api.dhl.com/mydhlapi/test', ALERT_EMAIL: '' };
    let lines;
    try {
      lines = checkSettings(loadConfig(env), env);
    } catch (error) {
      assert.fail(String(error));
    }
    const text = launchReport(lines);
    assert.match(text, /PROBLEM {2}Paystack: test keys/);
    assert.match(text, /PROBLEM {2}Email: MAIL_TRANSPORT is "log"/);
    assert.match(text, /PROBLEM {2}DHL: still pointed at the test address/);
    assert.match(text, /PROBLEM {2}Alerts/);
    assert.match(text, /must be fixed before taking real orders/);
  });

  test('live settings pass', () => {
    const lines = checkSettings(loadConfig(LIVE), LIVE);
    assert.deepEqual(lines.filter((l) => l.level === 'problem'), []);
  });
});

describe('launch check: database', { skip: TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set' }, () => {
  let testDb: TestDatabase;
  let db: Db;
  const now = new Date();

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url);
    await migrate(db, 'db/migrations');
    await db.query(readFileSync('db/seeds/dev.sql', 'utf8'));
  });

  after(async () => {
    await db.end();
    await testDb.drop();
  });

  test('the sample data, no owner and no worker are found', async () => {
    const text = launchReport(await checkDatabase(db, now));
    assert.match(text, /ok {5}  Database: \d+ migrations applied/);
    assert.match(text, /PROBLEM {2}Owner account/);
    assert.match(text, /PROBLEM {2}Sample data: 1 staff/);
    assert.match(text, /PROBLEM {2}Sample data: \d+ information pages/);
    assert.match(text, /PROBLEM {2}Worker/);
    assert.match(text, /check {2}  Product: Bone straight wig: no photos/);
  });

  test('once cleaned up and running, nothing must be fixed', async () => {
    await db.query("delete from staff where email like '%.test'");
    await db.query("insert into staff (name, email, role_id, password_hash, totp_secret_enc, totp_enabled_at, status) select 'Owner', 'owner@hairbydemj.com', id, 'scrypt$x', '\\x00', now(), 'active' from roles where is_owner");
    await db.query("delete from customers where email like '%@example.com'");
    await db.query("update content_pages set body = 'Our own words.'");
    await db.query("update saved_replies set body = 'Our own reply.'");
    await db.query("update store_settings set value = jsonb_set(value, '{support_email}', '\"hello@hairbydemj.com\"') where key = 'store'");
    await db.query('update currencies set rate_updated_at = now() where not is_base');
    await db.query("insert into scheduled_runs (name, last_started_at, last_finished_at) values ('daily_rates', now(), now()) on conflict (name) do update set last_finished_at = now()");
    const lines = await checkDatabase(db, now);
    assert.deepEqual(lines.filter((l) => l.level === 'problem'), []);
    assert.match(launchReport([...checkSettings(loadConfig(LIVE), LIVE), ...lines]), /Ready: nothing must be fixed/);
  });
});

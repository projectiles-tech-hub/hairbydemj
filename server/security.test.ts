// Security checks across the whole server (module 20): every admin address
// refuses visitors who are not signed in and staff whose role does not
// allow it; customer addresses refuse visitors who are not signed in; one
// customer cannot see or change another's orders, addresses or chats;
// requests from other sites are refused.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { accountDeps, type AccountDeps } from './accounts/deps.js';
import { verifyEmail } from './accounts/customers.js';
import { hashToken, randomToken } from './accounts/crypto.js';
import { memoryMailer } from './accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from './accounts/oidc.js';
import { signedInStaff } from './accounts/testing.js';
import { createApp, safePath } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool, type Db } from './db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from './db/test-database.js';
import { createLogger } from './logger.js';
import type { MediaDeps } from './media/media.js';
import { orderDeps } from './orders/routes.js';
import { paymentDeps } from './payments/routes.js';
import { adminRoutes } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';
import { siteRoutes } from './routes/site.js';
import type { Router } from './router.js';
import { shippingDeps } from './shipping/routes.js';

test('the request log hides tokens and codes in addresses', () => {
  assert.equal(safePath('/track-order/?order=HBD-1&token=abc123'), '/track-order/?order=HBD-1&token=[hidden]');
  assert.equal(safePath('/invite/?inviteToken=x&x=1'), '/invite/?inviteToken=[hidden]&x=1');
  assert.equal(safePath('/c/wigs/?sort=new'), '/c/wigs/?sort=new');
  assert.equal(safePath('/'), '/');
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  text: string;
  headers: IncomingMessage['headers'];
}

/** Fills ":name" segments with a value that exists in no table. */
const fill = (pattern: string): string => pattern.replace(/:[A-Za-z]+/g, '999999');

describe('security', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  const mail = memoryMailer();
  let server: Server;
  let port: number;
  let mediaDir: string;
  let routers: { site: Router; admin: Router; api: Router };
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (s: number): void => {
    clock = new Date(clock.getTime() + s * 1000);
  };

  function call(host: string, method: string, path: string, o: { cookie?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, ...(o.headers ?? {}) };
    if (o.cookie) headers.Cookie = o.cookie;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      });
      req.on('error', reject);
      if (o.body !== undefined) req.write(o.body);
      req.end();
    });
  }

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    mediaDir = mkdtempSync(join(tmpdir(), 'hbd-security-'));
    const config = loadConfig({ MEDIA_DIR: mediaDir });
    const logger = createLogger('error', () => undefined);
    deps = accountDeps({
      db,
      config,
      mail,
      identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
      now: () => clock,
    });
    const media: MediaDeps = { db, now: () => clock, logger, mediaDir };
    const payments = paymentDeps(deps, logger);
    const shipping = shippingDeps(deps, logger);
    const orders = orderDeps(deps, logger);
    routers = {
      site: siteRoutes(deps, payments, shipping, orders, media),
      admin: adminRoutes(deps, media, payments, shipping, orders),
      api: apiRoutes(deps, payments, shipping, orders, media),
    };
    server = createServer(createApp(config, logger, { version: 'test', accounts: deps, media, routers }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.close();
    await db.end();
    await testDb.drop();
    rmSync(mediaDir, { recursive: true, force: true });
  });

  // Addresses anyone may use without signing in (sign-in itself, invitations).
  const ADMIN_PUBLIC = new Set(['POST /api/auth/sign-in', 'POST /api/auth/two-step', 'POST /api/auth/sign-out', 'POST /api/auth/invite/start', 'POST /api/auth/invite/confirm', 'GET /sign-in', 'GET /invite', 'GET /accept-invite']);
  // Addresses every signed-in staff member may use, whatever their role.
  const ADMIN_ANY_STAFF = new Set([...ADMIN_PUBLIC, 'GET /api/auth/me', 'GET /']);
  const REFUSED = new Set([302, 303, 401, 403, 404, 405]);

  test('every admin address refuses visitors who are not signed in', async () => {
    const leaks: string[] = [];
    for (const r of routers.admin.list()) {
      const key = `${r.method} ${r.pattern}`;
      if (ADMIN_PUBLIC.has(key)) continue;
      const reply = await call('admin.localhost', r.method, fill(r.pattern), { headers: { Origin: 'http://admin.localhost' }, body: r.method === 'POST' ? '{}' : undefined });
      if (!REFUSED.has(reply.status)) leaks.push(`${reply.status} ${key}`);
    }
    assert.deepEqual(leaks, []);
  });

  test('every admin address refuses staff whose role does not allow it', async () => {
    const role = await db.query("insert into roles (name) values ('Nobody') returning id");
    const { cookie } = await signedInStaff(deps, tick, { name: 'No Access', email: 'none@example.com', roleId: Number(role.rows[0]?.id) });
    const leaks: string[] = [];
    for (const r of routers.admin.list()) {
      const key = `${r.method} ${r.pattern}`;
      if (ADMIN_ANY_STAFF.has(key)) continue;
      const reply = await call('admin.localhost', r.method, fill(r.pattern), { cookie, headers: { Origin: 'http://admin.localhost' }, body: r.method === 'POST' ? '{}' : undefined });
      if (!REFUSED.has(reply.status)) leaks.push(`${reply.status} ${key}`);
    }
    assert.deepEqual(leaks, []);
    // The dashboard shows such a person no sales figures.
    const home = await call('admin.localhost', 'GET', '/', { cookie });
    assert.equal(home.status, 200);
    assert.doesNotMatch(home.text, /Sales by day/i);
  });

  test('admin changes from another site are refused', async () => {
    const { cookie } = await signedInStaff(deps, tick, { name: 'Owner', email: 'owner@example.com' });
    const reply = await call('admin.localhost', 'POST', '/api/roles', { cookie, headers: { Origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Sneaky' }) });
    assert.equal(reply.status, 403);
    const none = await call('admin.localhost', 'POST', '/api/roles', { cookie, body: JSON.stringify({ name: 'Sneaky' }) });
    assert.equal(none.status, 403, 'no Origin and no Sec-Fetch-Site: refused');
    assert.equal((await db.query("select count(*)::int as n from roles where name = 'Sneaky'")).rows[0]?.n, 0);
  });

  // App addresses that are public by design: the shop, the bag, checkout,
  // sign-in, guest chat. Everything else needs a signed-in customer.
  const API_PUBLIC = /^\/v1($|\/auth\/|\/catalog\/|\/currency$|\/cart|\/shipping\/quote$|\/checkout$|\/orders\/lookup$|\/newsletter$|\/gift-cards\/(buy|balance)$|\/chat(\/messages|\/read)?$)/;

  test('customer app addresses refuse visitors who are not signed in', async () => {
    const leaks: string[] = [];
    for (const r of routers.api.list()) {
      if (API_PUBLIC.test(r.pattern) || r.pattern.startsWith('/webhooks/')) continue;
      const reply = await call('api.localhost', r.method, fill(r.pattern), { body: r.method === 'POST' ? '{}' : undefined });
      if (!REFUSED.has(reply.status)) leaks.push(`${reply.status} ${r.method} ${r.pattern}`);
    }
    assert.deepEqual(leaks, []);
  });

  describe('one customer cannot reach another customer\'s things', () => {
    let a: string;
    let b: string;
    let aId: number;
    const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

    before(async () => {
      for (const email of ['a@example.com', 'b@example.com']) {
        const up = await call('api.localhost', 'POST', '/v1/auth/sign-up', { body: JSON.stringify({ email, password: 'longenough', firstName: 'Ada', lastName: 'Obi' }) });
        assert.equal(up.status, 201, up.text);
        const signed = await verifyEmail(deps, { email, code: mail.last('verify_email', email).data.code ?? '' }, { ip: null });
        if (email.startsWith('a')) {
          a = signed.token;
          aId = signed.customer.id;
        } else b = signed.token;
      }
    });

    test('orders', async () => {
      const token = randomToken();
      const made = await db.query(
        "insert into orders (customer_id, email, currency, subtotal_minor, total_minor, gift_card_minor, access_token_hash, stock_held_until) values ($1, 'a@example.com', 'NGN', 1000, 1000, 0, $2, $3) returning number",
        [aId, hashToken(token), new Date(clock.getTime() + 30 * 60_000)],
      );
      const number = String(made.rows[0]?.number);
      assert.equal((await call('api.localhost', 'GET', `/v1/orders/${number}`, { headers: bearer(a) })).status, 200);
      for (const path of [`/v1/orders/${number}`, `/v1/orders/${number}/invoice`, `/v1/orders/${number}/tracking`, `/v1/orders/${number}/payment`]) {
        assert.equal((await call('api.localhost', 'GET', path, { headers: bearer(b) })).status, 404, `${path} as another customer`);
        assert.equal((await call('api.localhost', 'GET', path)).status, 404, `${path} without signing in`);
        assert.equal((await call('api.localhost', 'GET', `${path}?token=${'x'.repeat(43)}`)).status, 404, `${path} with a wrong token`);
      }
      assert.equal((await call('api.localhost', 'POST', `/v1/orders/${number}/cancel`, { headers: bearer(b), body: '{}' })).status, 404);
      assert.equal((await call('api.localhost', 'GET', `/v1/orders/${number}?token=${token}`)).status, 200, 'the private link works');
    });

    test('addresses', async () => {
      const made = await call('api.localhost', 'POST', '/v1/account/addresses', { headers: bearer(a), body: JSON.stringify({ name: 'Ada Obi', fullName: 'Ada Obi', phone: '+2348000000000', line1: '1 Road', city: 'Benin City', region: 'Edo', country: 'NG' }) });
      assert.ok(made.status === 200 || made.status === 201, made.text);
      const id = Number((await db.query('select id from addresses where customer_id = $1', [aId])).rows[0]?.id);
      const change = await call('api.localhost', 'POST', `/v1/account/addresses/${id}`, { headers: bearer(b), body: JSON.stringify({ name: 'Changed', fullName: 'Changed', phone: '+2348000000000', line1: '2 Road', city: 'Lagos', region: 'Lagos', country: 'NG' }) });
      assert.equal(change.status, 404);
      assert.equal((await call('api.localhost', 'POST', `/v1/account/addresses/${id}/delete`, { headers: bearer(b), body: '{}' })).status, 404);
      const list = await call('api.localhost', 'GET', '/v1/account/addresses', { headers: bearer(b) });
      assert.doesNotMatch(list.text, /Ada Obi/);
      assert.equal((await db.query('select full_name from addresses where id = $1', [id])).rows[0]?.full_name, 'Ada Obi');
    });

    test('chats', async () => {
      assert.equal((await call('api.localhost', 'POST', '/v1/chat/messages', { headers: bearer(a), body: JSON.stringify({ body: 'my private question' }) })).status, 201);
      const other = await call('api.localhost', 'GET', '/v1/chat', { headers: bearer(b) });
      assert.doesNotMatch(other.text, /my private question/);
      const guest = await call('api.localhost', 'GET', '/v1/chat', { headers: { 'X-Chat-Token': 'made-up-token' } });
      assert.doesNotMatch(guest.text, /my private question/);
    });
  });

  test('pages carry the safety headers', async () => {
    const page = await call('localhost', 'GET', '/');
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    const adminPage = await call('admin.localhost', 'GET', '/sign-in/');
    assert.match(String(adminPage.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(adminPage.headers['x-robots-tag'], 'noindex, nofollow');
  });
});

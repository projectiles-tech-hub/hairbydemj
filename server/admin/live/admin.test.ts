import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { accountDeps, type AccountDeps } from '../../accounts/deps.js';
import { memoryMailer } from '../../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../../accounts/oidc.js';
import { signedInStaff } from '../../accounts/testing.js';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { migrate } from '../../db/migrate.js';
import { createPool, type Db } from '../../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../db/test-database.js';
import { createLogger } from '../../logger.js';
import { salesCsv, type SalesReport } from '../api.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  text: string;
  body: Record<string, any>;
  headers: IncomingMessage['headers'];
}

test('the sales spreadsheet cannot start a formula in a cell', () => {
  const report: SalesReport = { from: '2026-06-01', to: '2026-06-02', byDay: [{ day: '=HYPERLINK("x")', currency: 'NGN', orders: 1, salesMinor: 100 }], totals: [], topProducts: [], statusCounts: {} };
  const csv = salesCsv(report);
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv), csv);
});

describe('the live admin', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const mail = memoryMailer();
  let owner = '';
  let support = '';
  let wigId = 0;
  let wigVariant = 0;
  let orderId = 0;
  let orderNumber = '';
  const lagos = { name: 'Ada Obi', phone: '+234 803 000 0000', line1: '5 Allen Avenue', city: 'Ikeja', region: 'Lagos', country: 'NG' };

  function call(host: string, method: string, path: string, body?: unknown, cookie?: string): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: `http://${host}` };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(text) as Record<string, any>;
          } catch {
            // HTML
          }
          resolve({ status: res.statusCode ?? 0, text, body: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const admin = (path: string, cookie = owner): Promise<Reply> => call('admin.localhost', 'GET', path, undefined, cookie);
  const adminPost = (path: string, body: unknown, cookie = owner): Promise<Reply> => call('admin.localhost', 'POST', path, body, cookie);
  const ok = (r: Reply, status = 200): Reply => {
    assert.equal(r.status, status, r.text.slice(0, 600));
    return r;
  };

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({});
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    const wigs = Number((await db.query("insert into categories (name, slug) values ('Wigs', 'wigs') returning id")).rows[0]?.id);
    wigId = Number((await db.query("insert into products (name, slug, status, category_id) values ('Bone straight wig', 'bone-straight-wig', 'published', $1) returning id", [wigs])).rows[0]?.id);
    wigVariant = Number((await db.query("insert into variants (product_id, sku, weight_grams, length_inches) values ($1, 'BSW-22', 300, 22) returning id", [wigId])).rows[0]?.id);
    await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', 28500000)", [wigVariant]);
    await db.query('insert into inventory (variant_id, on_hand) values ($1, 6)', [wigVariant]);
    await db.query("insert into products (name, slug, status) values ('<script>alert(1)</script> wig', 'odd-wig', 'draft')");
    await db.query("insert into local_shipping_rates (zone_name, states, courier, price_minor, delivery_time) values ('Lagos', '{Lagos}', 'GIG Logistics', 350000, '1 to 2 working days')");

    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const roleId = Number((await db.query("insert into roles (name) values ('Support') returning id")).rows[0]?.id);
    await db.query("insert into role_permissions (role_id, area, can_view, can_change) values ($1, 'customers', true, true), ($1, 'orders', true, false)", [roleId]);
    support = (await signedInStaff(deps, tick, { name: 'Sade', email: 'support@hairbydemj.test', roleId })).cookie;

    // A guest order, placed through the shop.
    const added = await call('localhost', 'POST', '/api/cart/items', { variantId: wigVariant, quantity: 1 });
    ok(added, 201);
    const cart = String(added.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const quote = ok(await call('localhost', 'POST', '/api/shipping/quote', { address: lagos }, cart)).body.quote;
    const placed = ok(await call('localhost', 'POST', '/api/checkout', { email: 'ada@example.com', address: lagos, quoteId: quote.id, shippingOption: quote.options[0].id }, cart), 201).body;
    orderId = Number(placed.order.id);
    orderNumber = String(placed.order.number);
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('signed-out visitors are sent to sign in, and come back to where they were going', async () => {
    const r = await admin('/orders/?status=on_hold', '');
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/sign-in/?next=%2Forders%2F%3Fstatus%3Don_hold');
    const s = ok(await admin('/sign-in/', ''));
    assert.match(s.text, /data-sign-in/);
    assert.match(s.text, /data-two-step hidden/);
    assert.match(String(s.headers['content-security-policy']), /script-src 'self'/);
    assert.match(String(s.headers['x-robots-tag']), /noindex/);
    assert.equal(s.headers['cache-control'], 'private, no-store');
    assert.match(s.text, /<script src="\/js\/staff.js" type="module">/);
    // Signed in already: straight on, but never to another site.
    const back = await admin('/sign-in/?next=//evil.example/', owner);
    assert.equal(back.status, 302);
    assert.equal(back.headers.location, '/');
  });

  test('an unknown admin address gets the admin\'s own "not found" page', async () => {
    const r = await admin('/no-such-page/', '');
    assert.equal(r.status, 404);
    assert.match(r.text, /Page not found/);
    assert.match(r.text, /hairbydemj admin/);
  });

  test('the owner can open every page, and each shows real data', async () => {
    for (const path of ['/', '/orders/', '/returns/', '/customers/', '/products/', '/products/new/', '/categories/', '/inventory/', '/discounts/', '/discounts/new/', '/homepage/', '/content/', '/content/new/', '/emails/', '/shipping/', '/payments/', '/reports/', '/staff/', '/activity/', '/settings/', '/system/']) {
      const r = await admin(path);
      assert.equal(r.status, 200, `${path}: ${r.text.slice(0, 300)}`);
      assert.match(r.text, /<main id="main"/, path);
    }
    const dash = ok(await admin('/'));
    assert.match(dash.text, /href="\/staff\/"/);
    const list = ok(await admin('/orders/'));
    assert.match(list.text, new RegExp(orderNumber));
    const inventory = ok(await admin('/inventory/'));
    assert.match(inventory.text, /BSW-22/);
    assert.match(inventory.text, /data-adjust="\d+"/);
    const shipping = ok(await admin('/shipping/'));
    assert.match(shipping.text, /GIG Logistics/);
    assert.match(shipping.text, /Not set yet: labels cannot be bought/);
  });

  test('the order page shows the order and the actions staff may take', async () => {
    const r = ok(await admin(`/orders/${orderId}/`));
    assert.match(r.text, new RegExp(`Order ${orderNumber}`));
    assert.match(r.text, /Bone straight wig/);
    assert.match(r.text, /ada@example\.com/);
    assert.match(r.text, /data-json-form="\/api\/orders\/\d+\/notes"/);
    assert.equal((await admin('/orders/999999/')).status, 404);
    assert.equal((await admin('/orders/abc/')).status, 404);
  });

  test('a role only sees and opens what it is allowed', async () => {
    const dash = ok(await admin('/', support));
    assert.match(dash.text, /href="\/customers\/"/);
    assert.ok(!dash.text.includes('href="/products/"'));
    assert.ok(!dash.text.includes('href="/staff/"'));
    assert.equal((await admin('/products/', support)).status, 403);
    assert.equal((await admin('/staff/', support)).status, 403);
    assert.equal((await admin('/settings/', support)).status, 403);
    // Orders can be seen but not changed: no note form, no cancel button.
    const order = ok(await admin(`/orders/${orderId}/`, support));
    assert.ok(!order.text.includes('/notes"'));
  });

  test('the product editor shows variants and prices, and names are escaped', async () => {
    const r = ok(await admin(`/products/${wigId}/`));
    assert.match(r.text, /BSW-22/);
    assert.match(r.text, /₦285,000/);
    assert.match(r.text, /data-upload="\/api\/products\/\d+\/media"/);
    const list = ok(await admin('/products/?status=draft'));
    assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; wig/);
    assert.ok(!list.text.includes('<script>alert(1)</script>'));
    assert.equal((await admin('/products/999999/')).status, 404);
  });

  test('customers: a list, a page, and a private note staff can keep', async () => {
    const list = ok(await call('admin.localhost', 'GET', '/api/customers?q=ada', undefined, support));
    assert.equal(list.body.customers.length, 0); // a guest order makes no account
    await call('localhost', 'POST', '/api/auth/sign-up', { email: 'bola@example.com', password: 'longenough', firstName: 'Bola' });
    const found = ok(await call('admin.localhost', 'GET', '/api/customers?q=bola', undefined, support)).body.customers;
    assert.equal(found.length, 1);
    ok(await adminPost(`/api/customers/${found[0].id}`, { internalNote: 'Prefers WhatsApp.' }, support));
    const page = ok(await admin(`/customers/${found[0].id}/`, support));
    assert.match(page.text, /Prefers WhatsApp\./);
  });

  test('the homepage settings change the shop\'s home page', async () => {
    const sections = ok(await call('admin.localhost', 'GET', '/api/homepage', undefined, owner)).body.sections as Array<{ id: number; kind: string }>;
    const hero = sections.find((s) => s.kind === 'hero')!;
    const best = sections.find((s) => s.kind === 'best_sellers')!;
    ok(await adminPost(`/api/homepage/${hero.id}`, { settings: { headline: 'New season <wigs>', buttonLink: '/c/wigs/' } }));
    ok(await adminPost(`/api/homepage/${best.id}`, { isShown: false }));
    const bad = await adminPost(`/api/homepage/${hero.id}`, { settings: { buttonLink: 'https://evil.example/' } });
    assert.equal(bad.status, 422);
    const home = await call('localhost', 'GET', '/');
    assert.match(home.text, /New season &lt;wigs&gt;/);
    assert.match(home.text, /href="\/c\/wigs\/"/);
    assert.ok(!home.text.includes('aria-label="Best-sellers"'));
    assert.match(home.text, /aria-label="New arrivals"/);
    ok(await adminPost(`/api/homepage/${hero.id}`, { isShown: false }));
    const noHero = await call('localhost', 'GET', '/');
    assert.match(noHero.text, /<h1 class="visually-hidden">hairbydemj<\/h1>/);
  });

  test('content pages written in the admin replace the shop\'s starting text', async () => {
    const made = ok(await adminPost('/api/content', { slug: 'shipping', title: 'Delivery', body: '## How long\nTwo days in Lagos.', status: 'published' }), 201).body;
    assert.ok(made.id);
    const page = await call('localhost', 'GET', '/shipping/');
    assert.match(page.text, /Two days in Lagos\./);
    const editor = ok(await admin(`/content/${made.id}/`));
    assert.match(editor.text, /Two days in Lagos\./);
    const clash = await adminPost('/api/content', { slug: 'shipping', title: 'Again' });
    assert.equal(clash.status, 422);
    assert.equal((await adminPost('/api/content', { slug: 'Not OK', title: 'x' })).status, 422);
    assert.equal((await adminPost('/api/content', { slug: 'x', title: 'x' }, support)).status, 403);
  });

  test('store details and return rules are saved and shown', async () => {
    ok(await adminPost('/api/settings/store', { name: 'hairbydemj', supportEmail: 'help@hairbydemj.com', whatsapp: '+234 800 000 0000' }));
    assert.equal((await adminPost('/api/settings/store', { supportEmail: 'not-an-email' })).status, 422);
    ok(await adminPost('/api/settings/returns', { windowDays: 21, storeCreditBonusBps: 500 }));
    const r = ok(await admin('/settings/'));
    assert.match(r.text, /help@hairbydemj\.com/);
    assert.match(r.text, /value="\+2348000000000"/);
    assert.match(r.text, /value="21"/);
  });

  test('the activity log records what staff changed', async () => {
    const r = ok(await admin('/activity/'));
    assert.match(r.text, /Activity log/);
    const api = ok(await call('admin.localhost', 'GET', '/api/activity', undefined, owner)).body;
    assert.ok(api.entries.length > 0);
    assert.equal((await call('admin.localhost', 'GET', '/api/activity', undefined, support)).status, 403);
  });

  test('the sales report counts paid orders by day and downloads as a spreadsheet', async () => {
    await db.query("insert into payments (order_id, provider, reference, amount_minor, currency, status, webhook_confirmed_at) select id, 'paystack', number || '-ref', total_minor, 'NGN', 'succeeded', now() from orders where id = $1", [orderId]);
    await db.query("update orders set payment_status = 'paid', status = 'to_fulfil', paid_at = $2 where id = $1", [orderId, clock]);
    const report = ok(await call('admin.localhost', 'GET', '/api/reports/sales?from=2026-05-01&to=2026-06-30', undefined, owner)).body;
    assert.equal(report.totals[0].orders, 1);
    const csv = ok(await call('admin.localhost', 'GET', '/api/reports/sales.csv?from=2026-05-01&to=2026-06-30', undefined, owner));
    assert.match(String(csv.headers['content-type']), /text\/csv/);
    assert.match(String(csv.headers['content-disposition']), /attachment/);
    const page = ok(await admin('/reports/?from=2026-05-01&to=2026-06-30'));
    assert.match(page.text, /Bone straight wig|₦/);
  });

  test('an invitation link opens the set-up page; a broken one says so', async () => {
    const good = ok(await admin('/accept-invite/?token=abcdefghijklmnopqrstuvwxyz', ''));
    assert.match(good.text, /data-invite="abcdefghijklmnopqrstuvwxyz"/);
    const bad = ok(await admin('/accept-invite/?token=x"><script>', ''));
    assert.match(bad.text, /This link is not complete/);
    assert.ok(!bad.text.includes('x"><script>'));
  });
});

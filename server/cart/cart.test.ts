import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { signUp, verifyEmail } from '../accounts/customers.js';
import { accountDeps, type AccountDeps } from '../accounts/deps.js';
import { memoryMailer } from '../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../accounts/oidc.js';
import { signedInStaff } from '../accounts/testing.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, withTransaction, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { amountOff, type Discount } from './discounts.js';
import { giftCardHash, giftCardLast4, newGiftCardCode, normaliseGiftCardCode } from './gift-cards.js';
import { currencyForCountry, formatMoney } from './money.js';
import { holdStock, releaseStock, restock, shipStock } from './stock.js';

test('the currency shown first follows the country', () => {
  assert.equal(currencyForCountry('NG'), 'NGN');
  assert.equal(currencyForCountry('gb'), 'GBP');
  assert.equal(currencyForCountry('JE'), 'GBP');
  assert.equal(currencyForCountry('DE'), 'EUR');
  assert.equal(currencyForCountry('IE'), 'EUR');
  assert.equal(currencyForCountry('US'), 'USD');
  assert.equal(currencyForCountry('GH'), 'USD');
  assert.equal(currencyForCountry('XX'), null);
  assert.equal(currencyForCountry('T1'), null);
  assert.equal(currencyForCountry(''), null);
  assert.equal(currencyForCountry(undefined), null);
});

test('money is written the way people read it', () => {
  assert.equal(formatMoney(28_500_000, { code: 'NGN', symbol: '₦' }), '₦285,000');
  assert.equal(formatMoney(18_525, { code: 'USD', symbol: '$' }), '$185.25');
  assert.equal(formatMoney(-1_850, { code: 'GBP', symbol: '£' }), '−£18.50');
});

test('gift card codes are easy to read and type, and stored only as a hash', () => {
  const code = newGiftCardCode();
  assert.match(code, /^[ACDEFGHJKMNPQRTUVWXYZ2345679]{4}(-[ACDEFGHJKMNPQRTUVWXYZ2345679]{4}){3}$/);
  assert.notEqual(newGiftCardCode(), code);
  assert.equal(normaliseGiftCardCode(' abcd-efgh ijkl mnpq '), 'ABCDEFGHIJKLMNPQ');
  assert.ok(giftCardHash('abcd-efgh-ijkl-mnpq').equals(giftCardHash('ABCDEFGHIJKLMNPQ')));
  assert.equal(giftCardLast4('abcd-efgh-ijkl-mnpq'), 'MNPQ');
});

test('discount amounts are rounded down and buy-X-get-Y frees the cheapest of each group', () => {
  const base: Discount = { id: 1, name: 'x', code: null, kind: 'percentage', percentBps: 1000, buyQuantity: null, getQuantity: null, appliesTo: 'all', targetIds: [], customerGroup: 'everyone', totalUsesLimit: null, perCustomerLimit: null, timesUsed: 0, combinable: false, startsAt: new Date(0), endsAt: null, status: 'active', amounts: {} };
  const line = (unitMinor: number, quantity: number, productId = 1): { lineId: number; productId: number; unitMinor: number; quantity: number } => ({ lineId: productId, productId, unitMinor, quantity });
  assert.equal(amountOff({ ...base, percentBps: 1250 }, [line(999, 1)], 'NGN'), 124, '12.5% of 9.99 is 1.24875, rounded down');
  assert.equal(amountOff({ ...base, kind: 'fixed', percentBps: null, amounts: { NGN: { amountMinor: 5000, minOrderMinor: null } } }, [line(3000, 1)], 'NGN'), 3000, 'never more than the items');
  assert.equal(amountOff({ ...base, kind: 'fixed', percentBps: null, amounts: { NGN: { amountMinor: 5000, minOrderMinor: null } } }, [line(3000, 1)], 'USD'), 0);
  const bxgy = { ...base, kind: 'buy_x_get_y' as const, percentBps: null, buyQuantity: 2, getQuantity: 1 };
  assert.equal(amountOff(bxgy, [line(100, 2)], 'NGN'), 0, 'two items: not enough for the deal');
  assert.equal(amountOff(bxgy, [line(500, 1, 1), line(300, 1, 2), line(100, 1, 3)], 'NGN'), 100, 'pay for 500 and 300, get the 100 free');
  assert.equal(amountOff(bxgy, [line(500, 3, 1), line(100, 3, 2)], 'NGN'), 600, 'groups 500,500,500 (one free) and 100,100,100 (one free)');
  assert.equal(amountOff({ ...base, kind: 'free_shipping', percentBps: null }, [line(100, 1)], 'NGN'), 0);
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  body: Record<string, any>;
  cookies: string[];
}

describe('the cart over HTTP', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let ratesServer: Server;
  let port: number;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const mail = memoryMailer();
  const SITE = 'localhost';
  const ADMIN = 'admin.localhost';
  const API = 'api.localhost';
  let owner = '';
  let support = '';
  let rateAnswers: Record<string, number> = {};
  const v = { wig: 0, wig1: 0, bundle: 0, last: 0, none: 0 };
  const p = { wig: 0, bundle: 0, last: 0, none: 0 };
  type Key = keyof typeof p;
  let wigsCategory = 0;

  function call(host: string, method: string, path: string, body?: unknown, options: { cookie?: string; headers?: Record<string, string>; origin?: string | null } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, ...(options.headers ?? {}) };
    if (options.origin !== null && host !== API) headers.Origin = options.origin ?? `http://${host}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(raw) as Record<string, any>;
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, cookies: (res.headers['set-cookie'] ?? []).map(String) });
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const ok = (r: Reply, status = 200): Reply => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r;
  };
  const admin = (method: string, path: string, body?: unknown, cookie = owner): Promise<Reply> => call(ADMIN, method, path, method === 'POST' ? (body ?? {}) : undefined, { cookie });
  /** A website visitor: keeps the cart cookie (and the sign-in cookie, if any) between requests. */
  const visitor = (signIn = ''): { cookie: () => string; send: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Reply> } => {
    let cartCookie = '';
    const cookie = (): string => [cartCookie, signIn].filter(Boolean).join('; ');
    return {
      cookie,
      async send(method, path, body, headers) {
        const reply = await call(SITE, method, `/api${path}`, method === 'POST' ? (body ?? {}) : undefined, { cookie: cookie(), headers });
        const set = reply.cookies.find((c) => c.startsWith('hbd_cart='));
        if (set) cartCookie = set.split(';')[0] ?? '';
        return reply;
      },
    };
  };
  const lineFor = (cart: Record<string, any>, variantId: number): Record<string, any> => cart.lines.find((l: Record<string, any>) => l.variantId === variantId);

  async function makeGiftCard(code: string, currency: string, balance: number, options: { status?: string; expiresAt?: Date } = {}): Promise<number> {
    const made = await db.query(
      "insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, recipient_email, status, expires_at) values ($1, $2, $3, greatest($4::bigint, 100), $4, 'friend@example.com', $5, $6) returning id",
      [giftCardHash(code), giftCardLast4(code), currency, balance, options.status ?? 'active', options.expiresAt ?? null],
    );
    return Number(made.rows[0]?.id);
  }
  async function customer(email: string): Promise<{ id: number; token: string }> {
    await signUp(deps, { email, password: 'longenough', firstName: 'Test' }, { ip: null });
    const signed = await verifyEmail(deps, { email, code: mail.last('verify_email', email).data.code }, { ip: null });
    return { id: signed.customer.id, token: signed.token };
  }

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    await db.query("update currencies set rate_from_base = case code when 'USD' then 0.00065 when 'GBP' then 0.00051 when 'EUR' then 0.0006 end where not is_base");
    // A stand-in for the free daily rates service, answering with whatever the test sets.
    ratesServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'success', base_code: 'NGN', rates: rateAnswers }));
    });
    await new Promise<void>((resolve) => ratesServer.listen(0, '127.0.0.1', resolve));
    const ratesUrl = `http://127.0.0.1:${(ratesServer.address() as AddressInfo).port}/v6/latest/NGN`;
    const config = loadConfig({ TRUST_PROXY: 'true', RATES_URL: ratesUrl });
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const role = Number((await db.query("insert into roles (name) values ('Support') returning id")).rows[0]?.id);
    await db.query("insert into role_permissions (role_id, area, can_view, can_change) values ($1, 'customers', true, true), ($1, 'discounts', true, false)", [role]);
    support = (await signedInStaff(deps, tick, { name: 'Support', email: 'support@hairbydemj.test', roleId: role })).cookie;

    wigsCategory = ok(await admin('POST', '/api/categories', { name: 'Wigs' }), 201).body.id;
    const bundles = ok(await admin('POST', '/api/categories', { name: 'Bundles' }), 201).body.id;
    const make = async (key: Key, name: string, categoryId: number, ngn: number, stock: number, colours = ['Natural black']): Promise<void> => {
      const product = ok(await admin('POST', '/api/products', { name, categoryId }), 201).body.product;
      const made = ok(await admin('POST', `/api/products/${product.id}/variants/generate`, { lengths: [22], colours, weightGrams: 300, prices: { NGN: ngn }, autoConvert: true }), 201).body.product;
      p[key] = product.id;
      made.variants.forEach((variant: Record<string, any>, i: number) => {
        v[(i === 0 ? key : `${key}${i}`) as keyof typeof v] = variant.id;
      });
      for (const variant of made.variants) if (stock) ok(await admin('POST', `/api/inventory/${variant.id}/adjust`, { mode: 'add', quantity: stock, reason: 'received' }));
      ok(await admin('POST', `/api/products/${product.id}`, { status: 'published' }));
    };
    await make('wig', 'Bone straight wig', wigsCategory, 28_500_000, 5, ['Natural black', '613']);
    await make('bundle', 'Body wave bundles', bundles, 12_000_000, 10);
    await make('last', 'Last one wig', wigsCategory, 20_000_000, 1);
    await make('none', 'Sold out wig', wigsCategory, 20_000_000, 0);
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => ratesServer.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('a guest cart is kept by a cookie and priced fresh on every read', async () => {
    const guest = visitor();
    const empty = ok(await guest.send('GET', '/cart'));
    assert.deepEqual([empty.body.cart.id, empty.body.cart.lines.length, empty.body.cart.currency], [null, 0, 'NGN']);
    assert.equal(empty.cookies.length, 0, 'nothing is stored until something is added');
    const added = ok(await guest.send('POST', '/cart/items', { variantId: v.wig, quantity: 2 }), 201);
    assert.match(added.cookies[0] ?? '', /^hbd_cart=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=5184000$/);
    const cart = added.body.cart;
    assert.deepEqual([cart.itemCount, cart.subtotalMinor, cart.totalMinor, cart.canCheckout, cart.weightGrams], [2, 57_000_000, 57_000_000, true, 600]);
    const line = lineFor(cart, v.wig);
    assert.deepEqual([line.name, line.description, line.unitMinor, line.lineMinor, line.available, line.problem], ['Bone straight wig', '22" · Natural black', 28_500_000, 57_000_000, 5, null]);
    ok(await guest.send('POST', '/cart/items', { variantId: v.wig }), 201);
    assert.equal(lineFor(ok(await guest.send('GET', '/cart')).body.cart, v.wig).quantity, 3, 'adding again adds to the same line');
    // A price change shows the next time the cart is read.
    ok(await admin('POST', `/api/variants/${v.wig}`, { prices: { NGN: 30_000_000 }, autoConvert: true }));
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.subtotalMinor, 90_000_000);
    ok(await admin('POST', `/api/variants/${v.wig}`, { prices: { NGN: 28_500_000 }, autoConvert: true }));
    // Another visitor without the cookie has their own empty cart.
    assert.equal(ok(await visitor().send('GET', '/cart')).body.cart.lines.length, 0);
  });

  test('more than is in stock cannot be added; lowering is always allowed', async () => {
    const guest = visitor();
    const tooMany = await guest.send('POST', '/cart/items', { variantId: v.bundle, quantity: 11 });
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.body.error.message, 'Sorry, only 10 are left.');
    const line = lineFor(ok(await guest.send('POST', '/cart/items', { variantId: v.bundle, quantity: 8 }), 201).body.cart, v.bundle);
    assert.equal((await guest.send('POST', '/cart/items', { variantId: v.bundle, quantity: 3 })).body.error.message, 'Sorry, only 10 are left, and some are already in your bag.');
    assert.equal((await guest.send('POST', `/cart/items/${line.id}`, { quantity: 11 })).status, 409);
    assert.equal(lineFor(ok(await guest.send('POST', `/cart/items/${line.id}`, { quantity: 10 })).body.cart, v.bundle).quantity, 10);
    assert.equal((await guest.send('POST', '/cart/items', { variantId: v.none })).body.error.message, 'Sorry, that item is sold out.');
    assert.equal((await guest.send('POST', '/cart/items', { variantId: v.bundle, quantity: 0 })).status, 422);
    assert.equal((await guest.send('POST', '/cart/items', { variantId: v.bundle, quantity: 2.5 })).status, 422);
    assert.equal((await guest.send('POST', '/cart/items', { variantId: 999_999 })).status, 404);
    // Stock then drops below what is in the bag: the line is flagged and checkout waits.
    ok(await admin('POST', `/api/inventory/${v.bundle}/adjust`, { mode: 'set', quantity: 4, reason: 'correction' }));
    const short = ok(await guest.send('GET', '/cart')).body.cart;
    assert.deepEqual([lineFor(short, v.bundle).problem, lineFor(short, v.bundle).available, short.canCheckout, short.subtotalMinor], ['not_enough_stock', 4, false, 0]);
    const fixed = ok(await guest.send('POST', `/cart/items/${line.id}`, { quantity: 4 })).body.cart;
    assert.deepEqual([fixed.canCheckout, fixed.subtotalMinor], [true, 48_000_000]);
    ok(await guest.send('POST', `/cart/items/${line.id}/delete`));
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.lines.length, 0);
    assert.equal((await guest.send('POST', `/cart/items/${line.id}/delete`)).status, 404);
    ok(await admin('POST', `/api/inventory/${v.bundle}/adjust`, { mode: 'set', quantity: 10, reason: 'correction' }));
  });

  test('a product that leaves the shop stays in the bag but cannot be bought', async () => {
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.last }), 201);
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    ok(await admin('POST', `/api/products/${p.last}`, { status: 'unpublished' }));
    const cart = ok(await guest.send('GET', '/cart')).body.cart;
    assert.deepEqual([lineFor(cart, v.last).problem, cart.subtotalMinor, cart.canCheckout], ['unavailable', 12_000_000, false]);
    ok(await admin('POST', `/api/products/${p.last}`, { status: 'published' }));
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.canCheckout, true);
  });

  test('currency: suggested from the country, switchable, and every price follows', async () => {
    const fromUK = await call(SITE, 'GET', '/api/currency', undefined, { headers: { 'CF-IPCountry': 'GB' } });
    assert.deepEqual([fromUK.body.current, fromUK.body.suggested], ['GBP', 'GBP']);
    assert.deepEqual(fromUK.body.currencies.map((c: Record<string, any>) => c.code), ['NGN', 'EUR', 'GBP', 'USD']);
    assert.equal((await call(SITE, 'GET', '/api/currency', undefined, { headers: { 'CF-IPCountry': 'NG' } })).body.current, 'NGN');
    assert.equal((await call(SITE, 'GET', '/api/currency?currency=EUR', undefined, { headers: { 'CF-IPCountry': 'GB' } })).body.current, 'EUR', 'a choice beats the country');

    const guest = visitor();
    const first = ok(await guest.send('POST', '/cart/items', { variantId: v.wig }, { 'CF-IPCountry': 'US' }), 201).body.cart;
    assert.deepEqual([first.currency, first.subtotalMinor], ['USD', 18_500]);
    const pounds = ok(await guest.send('POST', '/cart/currency', { currency: 'gbp' })).body.cart;
    assert.deepEqual([pounds.currency, pounds.subtotalMinor], ['GBP', 14_500]);
    assert.equal(ok(await guest.send('GET', '/cart', undefined, { 'CF-IPCountry': 'US' })).body.cart.currency, 'GBP', 'the cart keeps the chosen currency');
    assert.equal((await guest.send('POST', '/cart/currency', { currency: 'JPY' })).status, 422);
    // A currency staff switch off is no longer offered.
    ok(await admin('POST', '/api/currencies/EUR', { enabled: false }));
    assert.deepEqual((await call(SITE, 'GET', '/api/currency')).body.currencies.map((c: Record<string, any>) => c.code), ['NGN', 'GBP', 'USD']);
    assert.equal((await call(SITE, 'GET', '/api/currency', undefined, { headers: { 'CF-IPCountry': 'FR' } })).body.current, 'NGN');
    ok(await admin('POST', '/api/currencies/EUR', { enabled: true }));
  });

  test('the phone app keeps a guest cart with a token header', async () => {
    const added = ok(await call(API, 'POST', '/v1/cart/items', { variantId: v.bundle, quantity: 2 }), 201);
    assert.equal(added.cookies.length, 0);
    const token = added.body.cartToken as string;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const read = ok(await call(API, 'GET', '/v1/cart', undefined, { headers: { 'X-Cart-Token': token } }));
    assert.equal(read.body.cart.itemCount, 2);
    assert.equal(read.body.cartToken, undefined, 'the token is only handed out once');
    assert.equal(ok(await call(API, 'GET', '/v1/cart', undefined, { headers: { 'X-Cart-Token': 'x'.repeat(43) } })).body.cart.itemCount, 0);
    const stored = await db.query("select count(*)::int as n from carts where encode(token_hash, 'base64') like $1", [`%${token.slice(0, 16)}%`]);
    assert.equal(stored.rows[0]?.n, 0, 'cart tokens are stored only as hashes');
  });

  test('a signed-in customer has one cart on every device; a guest cart is merged in on sign-in', async () => {
    const ada = await customer('ada@example.com');
    // On the website, as a guest, Ada adds a wig.
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.wig, quantity: 1 }), 201);
    // On the phone, signed in, she already has bundles in her cart.
    const signedApp = await call(API, 'POST', '/v1/cart/items', { variantId: v.bundle, quantity: 3 }, { headers: { Authorization: `Bearer ${ada.token}` } });
    assert.equal(signedApp.status, 201);
    assert.equal(signedApp.body.cartToken, undefined, 'a signed-in cart needs no token');
    // She signs in on the website: the guest wig joins her account's cart.
    const web = visitor(`hbd_session=${ada.token}`);
    const merged = ok(await call(SITE, 'GET', '/api/cart', undefined, { cookie: `${guest.cookie()}; hbd_session=${ada.token}` })).body.cart;
    assert.deepEqual(merged.lines.map((l: Record<string, any>) => [l.variantId, l.quantity]).sort(), [[v.bundle, 3], [v.wig, 1]].sort());
    // The phone sees the same cart; the guest cookie no longer finds anything.
    assert.equal(ok(await call(API, 'GET', '/v1/cart', undefined, { headers: { Authorization: `Bearer ${ada.token}` } })).body.cart.itemCount, 4);
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.itemCount, 0);
    assert.equal(ok(await web.send('GET', '/cart')).body.cart.itemCount, 4);
    // Her currency choice is remembered on her account.
    ok(await web.send('POST', '/cart/currency', { currency: 'USD' }));
    assert.equal((await db.query('select preferred_currency from customers where id = $1', [ada.id])).rows[0]?.preferred_currency, 'USD');
    assert.equal(ok(await call(API, 'GET', '/v1/cart', undefined, { headers: { Authorization: `Bearer ${ada.token}` } })).body.cart.currency, 'USD');
    // The same item in both carts is not doubled: the larger quantity is kept.
    const again = visitor();
    ok(await again.send('POST', '/cart/items', { variantId: v.bundle, quantity: 2 }), 201);
    const remerged = ok(await call(SITE, 'GET', '/api/cart', undefined, { cookie: `${again.cookie()}; hbd_session=${ada.token}` })).body.cart;
    assert.equal(lineFor(remerged, v.bundle).quantity, 3);
  });

  test('requests from another site cannot change a website cart', async () => {
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    const evil = await call(SITE, 'POST', '/api/cart/items', { variantId: v.bundle, quantity: 5 }, { cookie: guest.cookie(), origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.itemCount, 1);
  });

  test('discount codes: applied, refused with a reason, and removed', async () => {
    ok(await admin('POST', '/api/discounts', { name: 'Welcome 10%', code: 'welcome10', kind: 'percentage', percentBps: 1000, status: 'active', amounts: { NGN: { minOrderMinor: 30_000_000 } } }), 201);
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    const below = ok(await guest.send('POST', '/cart/discount', { code: 'WELCOME10' })).body.cart;
    assert.deepEqual([below.code.applied, below.code.message, below.discountMinor], [false, 'Your order is below the minimum for this code.', 0]);
    const cart = ok(await guest.send('POST', '/cart/items', { variantId: v.wig }), 201).body.cart;
    assert.deepEqual([cart.code.applied, cart.code.code, cart.discountMinor, cart.totalMinor], [true, 'WELCOME10', 4_050_000, 36_450_000]);
    assert.deepEqual(cart.discounts, [{ id: cart.discounts[0].id, name: 'Welcome 10%', code: 'WELCOME10', amountMinor: 4_050_000, freeShipping: false }]);
    const wrong = ok(await guest.send('POST', '/cart/discount', { code: 'NOPE' })).body.cart;
    assert.deepEqual([wrong.code.applied, wrong.code.message, wrong.discountMinor], [false, 'This code does not exist or has ended.', 0]);
    ok(await guest.send('POST', '/cart/discount', { code: 'welcome10' }));
    // In US dollars there is no minimum set, so the code applies there too.
    assert.equal(ok(await guest.send('POST', '/cart/currency', { currency: 'USD' })).body.cart.code.applied, true);
    const removed = ok(await guest.send('POST', '/cart/discount/delete')).body.cart;
    assert.deepEqual([removed.code, removed.discountMinor], [null, 0]);
    assert.equal((await guest.send('POST', '/cart/discount', { code: ' ' })).status, 422);
  });

  test('automatic deals, combinations, and the best deal for the customer', async () => {
    const free = ok(await admin('POST', '/api/discounts', { name: 'Free delivery', kind: 'free_shipping', combinable: true, status: 'active' }), 201).body.discount;
    const wigs = ok(await admin('POST', '/api/discounts', { name: 'Wigs 5% off', kind: 'percentage', percentBps: 500, combinable: true, appliesTo: 'categories', targetIds: [wigsCategory], status: 'active' }), 201).body.discount;
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    const onlyBundles = ok(await guest.send('GET', '/cart')).body.cart;
    assert.deepEqual([onlyBundles.freeShipping, onlyBundles.discountMinor, onlyBundles.discounts.map((d: Record<string, any>) => d.name)], [true, 0, ['Free delivery']], 'the wig deal does not cover bundles');
    const both = ok(await guest.send('POST', '/cart/items', { variantId: v.wig }), 201).body.cart;
    assert.deepEqual(both.discounts.map((d: Record<string, any>) => [d.name, d.amountMinor]), [['Wigs 5% off', 1_425_000], ['Free delivery', 0]], 'combinable deals stack');
    // WELCOME10 cannot be combined; on its own it saves more than 5% of the wig, so it wins, and free delivery goes.
    const code = ok(await guest.send('POST', '/cart/discount', { code: 'WELCOME10' })).body.cart;
    assert.deepEqual([code.discounts.map((d: Record<string, any>) => d.name), code.discountMinor, code.freeShipping, code.code.applied], [['Welcome 10%'], 4_050_000, false, true]);
    // A deal that is better than the code: the code is not used, and the customer is told why.
    const big = ok(await admin('POST', '/api/discounts', { name: 'Flash sale 20%', kind: 'percentage', percentBps: 2000, status: 'active' }), 201).body.discount;
    const better = ok(await guest.send('GET', '/cart')).body.cart;
    assert.deepEqual([better.discounts.map((d: Record<string, any>) => d.name), better.discountMinor, better.code.applied, better.code.message], [['Flash sale 20%'], 8_100_000, false, 'A better deal is already applied, and this code cannot be combined with it.']);
    // Deals that have not started, have ended, or are drafts do nothing.
    ok(await admin('POST', `/api/discounts/${big.id}`, { startsAt: new Date(clock.getTime() + 86_400_000).toISOString() }));
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.discounts[0].name, 'Welcome 10%');
    ok(await admin('POST', `/api/discounts/${big.id}`, { startsAt: new Date(clock.getTime() - 86_400_000).toISOString(), endsAt: new Date(clock.getTime() + 60_000).toISOString() }));
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.discounts[0].name, 'Flash sale 20%');
    tick(61);
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.discounts[0].name, 'Welcome 10%', 'the sale ended');
    ok(await admin('POST', `/api/discounts/${free.id}`, { status: 'disabled' }));
    ok(await admin('POST', `/api/discounts/${wigs.id}`, { status: 'disabled' }));
  });

  test('fixed amounts per currency, buy X get Y, and collections', async () => {
    const fixed = ok(await admin('POST', '/api/discounts', { name: 'Naira 5,000 off', code: 'TAKE5K', kind: 'fixed', status: 'active', amounts: { NGN: { amountMinor: 500_000 } } }), 201).body.discount;
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    assert.equal(ok(await guest.send('POST', '/cart/discount', { code: 'take5k' })).body.cart.discountMinor, 500_000);
    const usd = ok(await guest.send('POST', '/cart/currency', { currency: 'USD' })).body.cart;
    assert.deepEqual([usd.code.applied, usd.code.message], [false, 'This code cannot be used when paying in USD.']);
    ok(await guest.send('POST', '/cart/currency', { currency: 'NGN' }));
    ok(await guest.send('POST', '/cart/discount/delete'));
    ok(await admin('POST', `/api/discounts/${fixed.id}`, { status: 'disabled' }));

    const collection = ok(await admin('POST', '/api/collections', { name: 'Bundle deals', status: 'live', items: [{ productId: p.bundle }] }), 201).body.collection;
    ok(await admin('POST', '/api/discounts', { name: 'Buy 2 bundles, get 1 free', code: 'B2G1', kind: 'buy_x_get_y', buyQuantity: 2, getQuantity: 1, appliesTo: 'collections', targetIds: [collection.id], status: 'active' }), 201);
    const two = ok(await guest.send('POST', '/cart/discount', { code: 'B2G1' })).body.cart;
    assert.deepEqual([two.code.applied, two.code.message], [false, 'Add 3 qualifying items to use this code.']);
    const line = lineFor(two, v.bundle);
    ok(await guest.send('POST', '/cart/items', { variantId: v.wig }), 201);
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.code.applied, false, 'the wig is not in the collection, so it does not count');
    const three = ok(await guest.send('POST', `/cart/items/${line.id}`, { quantity: 3 })).body.cart;
    assert.deepEqual([three.code.applied, three.discountMinor], [true, 12_000_000], 'one bundle free');
    assert.equal((await admin('POST', '/api/discounts', { name: 'Bad', kind: 'fixed', status: 'active' })).body.error.fields.amounts, 'Enter the amount off for at least one currency.');
    assert.equal((await admin('POST', '/api/discounts', { name: 'Bad', code: 'B2G1', kind: 'free_shipping' })).body.error.fields.code, 'Another discount already uses this code.');
    assert.equal((await admin('POST', '/api/discounts', { name: 'Bad', kind: 'percentage', percentBps: 0 })).status, 422);
    assert.equal((await admin('POST', '/api/discounts', { name: 'Bad', kind: 'percentage', percentBps: 100, appliesTo: 'products', targetIds: [999_999] })).body.error.fields.targetIds, 'One of the choices no longer exists.');
  });

  test('who may use a code: first orders, once each, Gold members, and a total limit', async () => {
    const ada = await customer('first@example.com');
    const web = visitor(`hbd_session=${ada.token}`);
    ok(await web.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    const firstOnly = ok(await admin('POST', '/api/discounts', { name: 'First order 15%', code: 'FIRST15', kind: 'percentage', percentBps: 1500, customerGroup: 'new_customers', perCustomerLimit: 1, status: 'active' }), 201).body.discount;
    assert.equal(ok(await web.send('POST', '/cart/discount', { code: 'FIRST15' })).body.cart.code.applied, true);
    // Once she has a paid order with the code, she cannot use it again.
    const order = await db.query("insert into orders (customer_id, email, currency, subtotal_minor, total_minor, payment_status) values ($1, 'first@example.com', 'NGN', 100, 100, 'paid') returning id", [ada.id]);
    await db.query("insert into order_discounts (order_id, discount_id, code, description, amount_minor) values ($1, $2, 'FIRST15', 'First order 15%', 15)", [order.rows[0]?.id, firstOnly.id]);
    assert.equal(ok(await web.send('GET', '/cart')).body.cart.code.message, 'This code is for first orders only.');

    ok(await admin('POST', '/api/discounts', { name: 'Gold 10%', code: 'GOLD10', kind: 'percentage', percentBps: 1000, customerGroup: 'gold_and_platinum', status: 'active' }), 201);
    assert.equal(ok(await web.send('POST', '/cart/discount', { code: 'GOLD10' })).body.cart.code.message, 'This code is for Gold and Platinum members.');
    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    assert.equal(ok(await guest.send('POST', '/cart/discount', { code: 'GOLD10' })).body.cart.code.message, 'Sign in to use this code: it is for Gold and Platinum members.');
    await db.query("insert into loyalty_tiers (code, name, min_points, position) values ('gold', 'Gold', 1000, 1)");
    await db.query("update customers set loyalty_tier = 'gold' where id = $1", [ada.id]);
    assert.equal(ok(await web.send('GET', '/cart')).body.cart.code.applied, true);

    const limited = ok(await admin('POST', '/api/discounts', { name: 'First 100', code: 'FIRST100', kind: 'percentage', percentBps: 500, totalUsesLimit: 100, status: 'active' }), 201).body.discount;
    await db.query('update discounts set times_used = 100 where id = $1', [limited.id]);
    assert.equal(ok(await web.send('POST', '/cart/discount', { code: 'FIRST100' })).body.cart.code.message, 'This code has been used up.');
  });

  test('gift cards: applied up to the total, in their own currency only, and not guessable', async () => {
    const big = 'GIFT-AAAA-BBBB-CCCC';
    await makeGiftCard(big, 'NGN', 10_000_000);
    const small = 'GIFT-DDDD-EEEE-FFFF';
    await makeGiftCard(small, 'NGN', 5_000_000);
    await makeGiftCard('GIFT-GGGG-HHHH-JJJJ', 'GBP', 5_000);
    await makeGiftCard('GIFT-KKKK-MMMM-NNNN', 'NGN', 5_000, { expiresAt: new Date(clock.getTime() - 1000) });
    await makeGiftCard('GIFT-PPPP-QQQQ-RRRR', 'NGN', 0, { status: 'used_up' });

    const guest = visitor();
    ok(await guest.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    const one = ok(await guest.send('POST', '/cart/gift-cards', { code: 'gift aaaa bbbb cccc' })).body.cart;
    assert.deepEqual(one.giftCards.map((g: Record<string, any>) => [g.last4, g.balanceMinor, g.appliedMinor]), [['CCCC', 10_000_000, 10_000_000]]);
    assert.deepEqual([one.giftCardMinor, one.totalMinor], [10_000_000, 2_000_000]);
    const two = ok(await guest.send('POST', '/cart/gift-cards', { code: small })).body.cart;
    assert.deepEqual(two.giftCards.map((g: Record<string, any>) => g.appliedMinor), [10_000_000, 2_000_000], 'the second card only covers what is left');
    assert.equal(two.totalMinor, 0);
    ok(await guest.send('POST', '/cart/gift-cards', { code: small }), 200);
    assert.equal(ok(await guest.send('GET', '/cart')).body.cart.giftCards.length, 2, 'the same card twice counts once');

    assert.equal((await guest.send('POST', '/cart/gift-cards', { code: 'GIFT-GGGG-HHHH-JJJJ' })).body.error.message, 'This gift card is in GBP. Pay in GBP to use it.');
    assert.equal((await guest.send('POST', '/cart/gift-cards', { code: 'GIFT-KKKK-MMMM-NNNN' })).body.error.message, 'This gift card has expired.');
    assert.equal((await guest.send('POST', '/cart/gift-cards', { code: 'GIFT-PPPP-QQQQ-RRRR' })).body.error.message, 'This gift card has no balance left.');
    // Switching currency: the naira cards stay on the cart but cannot be used in dollars.
    const usd = ok(await guest.send('POST', '/cart/currency', { currency: 'USD' })).body.cart;
    assert.deepEqual([usd.giftCardMinor, usd.giftCards[0].problem], [0, 'This gift card is in NGN. Pay in NGN to use it.']);
    ok(await guest.send('POST', '/cart/currency', { currency: 'NGN' }));
    const removed = ok(await guest.send('POST', `/cart/gift-cards/${two.giftCards[1].id}/delete`)).body.cart;
    assert.equal(removed.giftCards.length, 1);

    // Guessing: after 5 wrong codes on one cart, even a right code is refused for a while.
    const guesser = visitor();
    ok(await guesser.send('POST', '/cart/items', { variantId: v.bundle }), 201);
    for (let i = 0; i < 5; i++) assert.equal((await guesser.send('POST', '/cart/gift-cards', { code: `WRONG-CODE-${i}AAA-BBBB` })).body.error.message, 'That gift card code is not right. Check it and try again.');
    assert.equal((await guesser.send('POST', '/cart/gift-cards', { code: big })).status, 429);
  });

  test('stock is held all-or-nothing, and the last item can only be held once', async () => {
    // Twenty checkouts at the same moment for the last one.
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => withTransaction(db, (c) => holdStock(c, [{ variantId: v.last, quantity: 1 }]))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(refused.reason.message, 'Sorry, one of your items has just sold out.');
    assert.deepEqual((await db.query('select on_hand, reserved from inventory where variant_id = $1', [v.last])).rows[0], { on_hand: 1, reserved: 1 });
    // The shop now shows it as gone, and it cannot be added to a bag.
    assert.equal((await visitor().send('POST', '/cart/items', { variantId: v.last })).body.error.message, 'Sorry, that item is sold out.');

    // All or nothing: the bundles are not held when the wig cannot be.
    await assert.rejects(withTransaction(db, (c) => holdStock(c, [{ variantId: v.bundle, quantity: 2 }, { variantId: v.wig, quantity: 6 }])), /only 5 of one of your items are left/);
    assert.equal((await db.query('select reserved from inventory where variant_id = $1', [v.bundle])).rows[0]?.reserved, 0);

    // Released (unpaid order), then held again and shipped.
    await withTransaction(db, (c) => releaseStock(c, [{ variantId: v.last, quantity: 1 }]));
    assert.equal((await db.query('select reserved from inventory where variant_id = $1', [v.last])).rows[0]?.reserved, 0);
    await withTransaction(db, (c) => holdStock(c, [{ variantId: v.last, quantity: 1 }]));
    const order = Number((await db.query("insert into orders (email, currency, subtotal_minor, total_minor) values ('a@example.com', 'NGN', 1, 1) returning id")).rows[0]?.id);
    await withTransaction(db, (c) => shipStock(c, [{ variantId: v.last, quantity: 1 }], order));
    assert.deepEqual((await db.query('select on_hand, reserved from inventory where variant_id = $1', [v.last])).rows[0], { on_hand: 0, reserved: 0 });
    await withTransaction(db, (c) => restock(c, [{ variantId: v.last, quantity: 1 }], order, 'return', null));
    const moves = await db.query('select change, on_hand_after, reason, order_id from stock_movements where variant_id = $1 order by id', [v.last]);
    assert.deepEqual(moves.rows.slice(-2), [{ change: -1, on_hand_after: 0, reason: 'sale', order_id: order }, { change: 1, on_hand_after: 1, reason: 'return', order_id: order }]);
  });

  test('exchange rates: changing one updates converted prices, never typed ones', async () => {
    const before = (await db.query("select currency, amount_minor, is_converted from prices where variant_id = $1 order by currency", [v.wig1])).rows;
    assert.deepEqual(before.map((r) => [r.currency, r.amount_minor]), [['EUR', 17_100], ['GBP', 14_500], ['NGN', 28_500_000], ['USD', 18_500]]);
    ok(await admin('POST', `/api/variants/${v.wig1}`, { prices: { USD: 19_900 } }));
    const result = ok(await admin('POST', '/api/currencies/USD', { rateFromBase: 0.0007 })).body;
    assert.deepEqual([result.currency.rateFromBase, result.currency.rateSource], [0.0007, 'manual'], 'a typed rate stays until changed');
    assert.ok(result.pricesChanged > 0);
    const after = new Map((await db.query("select variant_id, amount_minor from prices where currency = 'USD'")).rows.map((r) => [Number(r.variant_id), Number(r.amount_minor)]));
    assert.equal(after.get(v.wig), 20_000, '₦285,000 × 0.0007 = $199.50, rounded to $200');
    assert.equal(after.get(v.wig1), 19_900, 'the typed price was left alone');
    ok(await admin('POST', '/api/currencies/USD', { markupBps: 500 }));
    assert.equal(Number((await db.query("select amount_minor from prices where currency = 'USD' and variant_id = $1", [v.wig])).rows[0]?.amount_minor), 20_900, 'plus 5%, rounded');
    // A later edit of only the naira price with conversion on keeps the typed dollar price too.
    ok(await admin('POST', `/api/variants/${v.wig1}`, { prices: { NGN: 29_000_000 }, autoConvert: true }));
    assert.equal(Number((await db.query("select amount_minor from prices where currency = 'USD' and variant_id = $1", [v.wig1])).rows[0]?.amount_minor), 19_900);

    assert.equal((await admin('POST', '/api/currencies/NGN', { rateFromBase: 2 })).body.error.code, 'base_currency');
    assert.equal((await admin('POST', '/api/currencies/USD', { rateFromBase: -1 })).status, 422);
    assert.equal((await admin('POST', '/api/currencies/JPY', { rateFromBase: 1 })).status, 404);
    ok(await admin('POST', '/api/currencies/USD', { markupBps: 0, rateSource: 'daily' }));
  });

  test('daily rates: fetched, applied, and a suspicious jump is held back', async () => {
    rateAnswers = { NGN: 1, USD: 0.00066, GBP: 0.00052, EUR: 0.0009 };
    const refreshed = ok(await admin('POST', '/api/currencies/refresh')).body;
    assert.deepEqual(refreshed, { updated: ['GBP', 'USD'], skipped: ['EUR'] }, 'EUR moved by 50%, so it waits for a person');
    const rates = new Map((await db.query('select code, rate_from_base from currencies')).rows.map((r) => [String(r.code), Number(r.rate_from_base)]));
    assert.deepEqual([rates.get('USD'), rates.get('GBP'), rates.get('EUR')], [0.00066, 0.00052, 0.0006]);
    const log = await db.query("select summary from activity_log where staff_name = 'Daily rates' order by id");
    assert.ok(log.rows.some((r) => String(r.summary).startsWith('EUR: the new rate 0.0009 is more than 20% away')));
    // A currency set to manual is not touched by the daily refresh.
    ok(await admin('POST', '/api/currencies/GBP', { rateFromBase: 0.0005 }));
    rateAnswers = { USD: 0.00067, GBP: 0.00053 };
    assert.deepEqual(ok(await admin('POST', '/api/currencies/refresh')).body.updated, ['USD']);
    rateAnswers = {};
    assert.deepEqual(ok(await admin('POST', '/api/currencies/refresh')).body.skipped, ['EUR', 'USD']);
  });

  test('only staff whose role allows it see or change currencies and discounts', async () => {
    assert.equal((await admin('GET', '/api/currencies', undefined, support)).status, 403);
    assert.equal((await admin('POST', '/api/currencies/USD', { rateFromBase: 1 }, support)).status, 403);
    assert.equal((await admin('POST', '/api/currencies/refresh', {}, support)).status, 403);
    assert.equal(ok(await admin('GET', '/api/discounts', undefined, support)).body.discounts.length > 0, true, '"view" can read discounts');
    assert.equal((await admin('POST', '/api/discounts', { name: 'X', kind: 'free_shipping' }, support)).status, 403);
    assert.equal((await call(ADMIN, 'GET', '/api/discounts')).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/discounts', { name: 'X', kind: 'free_shipping' }, { cookie: owner, origin: 'https://evil.example' })).status, 403);
    // Deleting: a used discount is switched off instead.
    const used = (await db.query("select id from discounts where code = 'FIRST15'")).rows[0]?.id;
    assert.deepEqual(ok(await admin('POST', `/api/discounts/${used}/delete`)).body, { deleted: false });
    assert.equal(ok(await admin('GET', `/api/discounts/${used}`)).body.discount.status, 'disabled');
    const unused = ok(await admin('POST', '/api/discounts', { name: 'Never used', kind: 'free_shipping' }), 201).body.discount;
    assert.deepEqual(ok(await admin('POST', `/api/discounts/${unused.id}/delete`)).body, { deleted: true });
    const lines = (await db.query("select summary from activity_log where area in ('Discounts', 'Payments and currencies') order by id")).rows.map((r) => String(r.summary));
    for (const expected of ['Created the discount WELCOME10', 'Switched off the discount FIRST15 (it has been used, so it was not deleted)', 'Deleted the discount Never used']) assert.ok(lines.includes(expected), expected);
    assert.ok(lines.some((l) => l.startsWith('USD: rate 0.00065 to 0.0007')));
  });
});

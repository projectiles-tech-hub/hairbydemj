import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import { signUp, verifyEmail } from '../accounts/customers.js';
import { accountDeps, type AccountDeps } from '../accounts/deps.js';
import { memoryMailer } from '../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../accounts/oidc.js';
import { signedInStaff } from '../accounts/testing.js';
import { createApp } from '../app.js';
import { findGiftCard, giftCardHash, giftCardLast4 } from '../cart/gift-cards.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, withTransaction, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { markOrderPaid } from '../payments/order-paid.js';
import { expireUnpaidOrders } from './checkout.js';
import { orderDeps } from './routes.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';
const PAYSTACK_SECRET = 'sk_test_paystack_secret_for_tests';

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: IncomingMessage['headers'];
  text: string;
}

describe('checkout, orders and returns over HTTP', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let fake: Server;
  let port: number;
  let mediaDir = '';
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const mail = memoryMailer();
  const refundsAsked: Array<{ transaction: string; amount: number }> = [];
  let owner = '';
  let support = '';
  let wig = 0;
  let bundle = 0;
  let finalSale = 0;
  const lagos = { name: 'Ada Obi', phone: '+234 803 000 0000', line1: '5 Allen Avenue', city: 'Ikeja', region: 'Lagos', country: 'NG' };

  function call(host: string, method: string, path: string, body?: unknown, options: { cookie?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, ...(options.headers ?? {}) };
    if (host === 'localhost' || host === 'admin.localhost') headers.Origin = `http://${host}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
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
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers, text });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const ok = (r: Reply, status = 200): Reply => {
    assert.equal(r.status, status, r.text.slice(0, 400));
    return r;
  };
  const admin = (method: string, path: string, body?: unknown, cookie = owner): Promise<Reply> => call('admin.localhost', method, path, body, { cookie });
  const stock = async (variantId: number): Promise<{ on_hand: number; reserved: number }> => (await db.query('select on_hand, reserved from inventory where variant_id = $1', [variantId])).rows[0] as { on_hand: number; reserved: number };

  /** A guest's bag with these items; returns the cart cookie. */
  async function bag(items: Array<[number, number]>, cookie?: string): Promise<string> {
    let jar = cookie ?? '';
    for (const [variantId, quantity] of items) {
      const r = await call('localhost', 'POST', '/api/cart/items', { variantId, quantity }, { cookie: jar });
      assert.ok(r.status === 201 || r.status === 200, r.text);
      if (!jar) jar = String(r.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    }
    return jar;
  }
  async function quote(cookie: string, address: Record<string, unknown> = lagos): Promise<{ id: string; option: string; price: number }> {
    const q = ok(await call('localhost', 'POST', '/api/shipping/quote', { address }, { cookie })).body.quote;
    return { id: q.id, option: q.options[0].id, price: q.options[0].priceMinor };
  }
  async function checkout(cookie: string, extra: Record<string, unknown> = {}): Promise<Reply> {
    const q = await quote(cookie);
    return call('localhost', 'POST', '/api/checkout', { email: 'ada@example.com', address: lagos, quoteId: q.id, shippingOption: q.option, ...extra }, { cookie });
  }
  /** A gift card with this balance, for codes typed at the bag. */
  async function giftCard(balance: number, code: string): Promise<number> {
    const made = await db.query("insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, recipient_email, status) values ($1, $2, 'NGN', $3, $3, 'gift@example.com', 'active') returning id", [giftCardHash(code), giftCardLast4(code), balance]);
    return Number(made.rows[0]?.id);
  }
  /** Mark an order paid as if Paystack's webhook had confirmed it. */
  async function pay(orderId: number): Promise<void> {
    const o = (await db.query('select number, total_minor - gift_card_minor as due from orders where id = $1', [orderId])).rows[0];
    await withTransaction(db, async (c) => {
      await c.query("insert into payments (order_id, provider, reference, amount_minor, currency, status, webhook_confirmed_at) values ($1, 'paystack', $2, $3, 'NGN', 'succeeded', now())", [orderId, `${String(o?.number)}-ref`, o?.due]);
      await markOrderPaid(c, orderId, clock);
    });
  }
  const orderStatus = async (id: number): Promise<{ status: string; payment_status: string }> => (await db.query('select status, payment_status from orders where id = $1', [id])).rows[0] as { status: string; payment_status: string };

  /** A placed, paid order sent by local courier and delivered, ready for a return. */
  async function deliveredOrder(items: Array<[number, number]>, giftCode?: string): Promise<{ id: number; number: string; token: string; items: Array<{ id: number; name: string }> }> {
    const cookie = await bag(items);
    if (giftCode) ok(await call('localhost', 'POST', '/api/cart/gift-cards', { code: giftCode }, { cookie }));
    const placed = ok(await checkout(cookie), 201).body;
    const id = placed.order.id as number;
    if (placed.amountDueMinor > 0) await pay(id);
    const sent = ok(await admin('POST', `/api/orders/${id}/dispatch`, { courier: 'GIG Logistics' }), 201).body;
    ok(await admin('POST', `/api/shipments/${sent.shipmentId}/delivered`, {}));
    return { id, number: placed.order.number, token: placed.orderToken, items: placed.order.items.map((i: any) => ({ id: i.id, name: i.name })) };
  }

  before(async () => {
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (req.url === '/ps/refund' && req.headers.authorization === `Bearer ${PAYSTACK_SECRET}`) {
          const input = JSON.parse(body);
          refundsAsked.push(input);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: true, data: { id: 7000 + refundsAsked.length, status: 'processed' } }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    mediaDir = join(tmpdir(), `hbd-orders-${process.pid}-${Date.now()}`);

    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 10 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({ MEDIA_DIR: mediaDir, PAYSTACK_SECRET_KEY: PAYSTACK_SECRET, PAYSTACK_PUBLIC_KEY: 'pk_test', PAYSTACK_API_URL: `${fakeUrl}/ps` });
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const role = Number((await db.query("insert into roles (name) values ('Support') returning id")).rows[0]?.id);
    await db.query("insert into role_permissions (role_id, area, can_view, can_change) values ($1, 'orders', true, false)", [role]);
    support = (await signedInStaff(deps, tick, { name: 'Support', email: 'support@hairbydemj.test', roleId: role })).cookie;

    const make = async (name: string, slug: string, sku: string, price: number, onHand: number, isFinal = false): Promise<number> => {
      const p = await db.query("insert into products (name, slug, status, is_final_sale) values ($1, $2, 'published', $3) returning id", [name, slug, isFinal]);
      const v = Number((await db.query('insert into variants (product_id, sku, weight_grams) values ($1, $2, 300) returning id', [p.rows[0]?.id, sku])).rows[0]?.id);
      await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', $2)", [v, price]);
      await db.query('insert into inventory (variant_id, on_hand) values ($1, $2)', [v, onHand]);
      return v;
    };
    wig = await make('Bone straight wig', 'bone-straight-wig', 'WIG-1', 28_500_000, 20);
    bundle = await make('Body wave bundle', 'body-wave-bundle', 'BUN-1', 9_000_000, 20);
    finalSale = await make('Sample closure', 'sample-closure', 'CLO-1', 2_000_000, 20, true);
    await db.query("insert into local_shipping_rates (zone_name, states, courier, price_minor, delivery_time) values ('Lagos', '{Lagos}', 'GIG Logistics', 350000, '1 to 2 working days')");
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fake.close(resolve));
    await db.end();
    await testDb.drop();
    await rm(mediaDir, { recursive: true, force: true });
  });

  test('a guest checks out: the order waits for payment, stock is held, the bag is emptied', async () => {
    const cookie = await bag([[wig, 2]]);
    const placed = ok(await checkout(cookie, { note: 'Please call before delivery' }), 201).body;
    const o = placed.order;
    assert.match(o.number, /^HBD-\d+$/);
    assert.deepEqual([o.status, o.paymentStatus, o.subtotalMinor, o.shippingMinor, o.totalMinor, placed.amountDueMinor], ['on_hold', 'awaiting', 57_000_000, 350_000, 57_350_000, 57_350_000]);
    assert.deepEqual([o.delivery.carrier, o.delivery.service, o.delivery.estimate, o.note], ['local', 'GIG Logistics: Lagos', '1 to 2 working days', 'Please call before delivery']);
    assert.deepEqual([o.canPay, o.canCancel, o.canReturn], [true, true, false]);
    assert.equal(o.holdUntil, new Date(clock.getTime() + 30 * 60_000).toISOString());
    assert.deepEqual(o.items.map((i: any) => [i.name, i.quantity, i.unitMinor, i.totalMinor]), [['Bone straight wig', 2, 28_500_000, 57_000_000]]);
    assert.deepEqual(await stock(wig), { on_hand: 20, reserved: 2 });
    assert.equal(ok(await call('localhost', 'GET', '/api/cart', undefined, { cookie })).body.cart.lines.length, 0);
    // The confirmation email carries the guest's key to the order.
    const email = mail.last('order_confirmation', 'ada@example.com');
    assert.deepEqual([email.data.orderNumber, email.data.orderToken], [o.number, placed.orderToken]);
    // With the key the guest sees it; without, it looks like no such order.
    assert.equal(ok(await call('localhost', 'GET', `/api/orders/${o.number}`, undefined, { headers: { 'X-Order-Token': placed.orderToken } })).body.order.number, o.number);
    assert.equal((await call('localhost', 'GET', `/api/orders/${o.number}`)).status, 404);
    // The same bag cannot be checked out twice.
    assert.equal((await call('localhost', 'POST', '/api/checkout', { email: 'ada@example.com', address: lagos, quoteId: 'x'.repeat(32), shippingOption: 'local:1' }, { cookie })).body.error.code, 'cart_not_ready');
    // Pay is offered by the payments module; the customer may also give up.
    ok(await call('localhost', 'POST', `/api/orders/${o.number}/cancel`, {}, { headers: { 'X-Order-Token': placed.orderToken } }));
    assert.deepEqual(await orderStatus(o.id), { status: 'cancelled', payment_status: 'awaiting' });
    assert.deepEqual(await stock(wig), { on_hand: 20, reserved: 0 });
  });

  test('checkout refuses missing details, a stale or foreign delivery price, and sold-out stock', async () => {
    const cookie = await bag([[bundle, 1]]);
    const q = await quote(cookie);
    const missing = await call('localhost', 'POST', '/api/checkout', { email: 'not-an-email', address: { ...lagos, phone: '' }, quoteId: q.id, shippingOption: q.option }, { cookie });
    assert.equal(missing.status, 422);
    const bad = await call('localhost', 'POST', '/api/checkout', { email: 'ada@example.com', address: { ...lagos, phone: '' }, quoteId: q.id, shippingOption: q.option }, { cookie });
    assert.equal(bad.body.error.fields.phone, 'Enter a phone number the courier can call.');
    // A price worked out for another address, or another bag, is not accepted.
    const moved = await call('localhost', 'POST', '/api/checkout', { email: 'ada@example.com', address: { ...lagos, line1: '1 Other Road' }, quoteId: q.id, shippingOption: q.option }, { cookie });
    assert.equal(moved.body.error.code, 'quote_expired');
    const other = await bag([[bundle, 1]]);
    const stolen = await call('localhost', 'POST', '/api/checkout', { email: 'ada@example.com', address: lagos, quoteId: q.id, shippingOption: q.option }, { cookie: other });
    assert.equal(stolen.body.error.code, 'quote_expired');

    // Two bags want the last two wigs; the second checkout finds them gone and nothing is written for it.
    await db.query('update inventory set on_hand = reserved + 2 where variant_id = $1', [wig]);
    const first = await bag([[wig, 2]]);
    const second = await bag([[wig, 2]]);
    const q2 = await quote(second);
    ok(await checkout(first), 201);
    const orders = Number((await db.query('select count(*)::int as n from orders')).rows[0]?.n);
    const late = await call('localhost', 'POST', '/api/checkout', { email: 'eve@example.com', address: lagos, quoteId: q2.id, shippingOption: q2.option }, { cookie: second });
    assert.equal(late.status, 422, 'the bag itself now shows the wig as sold out');
    assert.equal(Number((await db.query('select count(*)::int as n from orders')).rows[0]?.n), orders);
    await db.query('update inventory set on_hand = 20 where variant_id = $1', [wig]);
  });

  test('gift cards pay first, delivery included; a fully covered order is paid at once', async () => {
    const card = await giftCard(30_000_000, 'GIFT-AAAA-BBBB-CCCC');
    const cookie = await bag([[wig, 1]]);
    ok(await call('localhost', 'POST', '/api/cart/gift-cards', { code: 'GIFT-AAAA-BBBB-CCCC' }, { cookie }));
    const placed = ok(await checkout(cookie), 201).body;
    assert.deepEqual([placed.order.totalMinor, placed.order.giftCardMinor, placed.amountDueMinor, placed.order.paymentStatus, placed.order.status], [28_850_000, 28_850_000, 0, 'paid', 'to_fulfil']);
    assert.equal((await db.query('select balance_minor from gift_cards where id = $1', [card])).rows[0]?.balance_minor, 1_150_000);
    const tx = await db.query("select kind, amount_minor from gift_card_transactions where gift_card_id = $1", [card]);
    assert.deepEqual(tx.rows.map((r) => [r.kind, Number(r.amount_minor)]), [['redeem', -28_850_000]]);

    // The rest of the card covers part of the next order; the remainder is paid by card.
    const next = await bag([[bundle, 1]]);
    ok(await call('localhost', 'POST', '/api/cart/gift-cards', { code: 'GIFT-AAAA-BBBB-CCCC' }, { cookie: next }));
    const part = ok(await checkout(next), 201).body;
    assert.deepEqual([part.order.giftCardMinor, part.amountDueMinor, part.order.paymentStatus], [1_150_000, 9_350_000 - 1_150_000, 'awaiting']);
    assert.equal((await db.query("select status from gift_cards where id = $1", [card])).rows[0]?.status, 'used_up');
  });

  test('an unpaid order runs out of time: stock and gift card money go back; a late payment takes them again', async () => {
    await giftCard(1_000_000, 'LATE-AAAA-BBBB-CCCC');
    const cookie = await bag([[bundle, 1]]);
    ok(await call('localhost', 'POST', '/api/cart/gift-cards', { code: 'LATE-AAAA-BBBB-CCCC' }, { cookie }));
    const placed = ok(await checkout(cookie), 201).body;
    const id = placed.order.id;
    const before = await stock(bundle);
    const card = await findGiftCard(db, 'LATE-AAAA-BBBB-CCCC');
    assert.equal(card?.balanceMinor, 0);

    await db.query("update orders set stock_held_until = $2::timestamptz - interval '1 minute' where id = $1", [id, clock]);
    const orders = orderDeps(deps, createLogger('error', () => undefined));
    assert.equal(await expireUnpaidOrders(orders), 1);
    assert.deepEqual(await orderStatus(id), { status: 'cancelled', payment_status: 'awaiting' });
    assert.equal((await stock(bundle)).reserved, before.reserved - 1);
    assert.equal((await findGiftCard(db, 'LATE-AAAA-BBBB-CCCC'))?.balanceMinor, 1_000_000);
    assert.equal(await expireUnpaidOrders(orders), 0, 'nothing twice');

    await pay(id);
    assert.deepEqual(await orderStatus(id), { status: 'to_fulfil', payment_status: 'paid' });
    assert.equal((await stock(bundle)).reserved, before.reserved);
    assert.equal((await findGiftCard(db, 'LATE-AAAA-BBBB-CCCC'))?.balanceMinor, 0, 'the gift card is taken again');

    // The same, but the card was spent elsewhere meanwhile: the payment must be refunded.
    await giftCard(1_000_000, 'GONE-AAAA-BBBB-CCCC');
    const c2 = await bag([[bundle, 1]]);
    ok(await call('localhost', 'POST', '/api/cart/gift-cards', { code: 'GONE-AAAA-BBBB-CCCC' }, { cookie: c2 }));
    const p2 = ok(await checkout(c2), 201).body;
    await db.query("update orders set stock_held_until = $2::timestamptz - interval '1 minute' where id = $1", [p2.order.id, clock]);
    await expireUnpaidOrders(orders);
    await db.query("update gift_cards set balance_minor = 0, status = 'used_up' where code_last4 = 'CCCC' and id = (select id from gift_cards where code_hash = $1)", [giftCardHash('GONE-AAAA-BBBB-CCCC')]);
    const outcome = await withTransaction(db, (c) => markOrderPaid(c, p2.order.id, clock));
    assert.equal(outcome.refundNeeded, true);
  });

  test('signed-in customers: their orders list, saved address, and the app works the same', async () => {
    await signUp(deps, { email: 'nkem@example.com', password: 'longenough' }, { ip: null });
    const nkem = await verifyEmail(deps, { email: 'nkem@example.com', code: mail.last('verify_email', 'nkem@example.com').data.code }, { ip: null });
    const auth = { Authorization: `Bearer ${nkem.token}` };
    ok(await call('api.localhost', 'POST', '/v1/cart/items', { variantId: bundle, quantity: 1 }, { headers: auth }), 201);
    const q = ok(await call('api.localhost', 'POST', '/v1/shipping/quote', { address: lagos }, { headers: auth })).body.quote;
    const placed = ok(await call('api.localhost', 'POST', '/v1/checkout', { address: lagos, quoteId: q.id, shippingOption: q.options[0].id, saveAddress: true }, { headers: auth }), 201).body;
    assert.equal(placed.order.email, 'nkem@example.com', 'the account email is used');
    assert.equal((await db.query('select source from orders where id = $1', [placed.order.id])).rows[0]?.source, 'app');
    const saved = await db.query('select full_name, is_default from addresses where customer_id = $1', [nkem.customer.id]);
    assert.deepEqual(saved.rows, [{ full_name: 'Ada Obi', is_default: true }]);
    const list = ok(await call('api.localhost', 'GET', '/v1/orders', undefined, { headers: auth })).body;
    assert.deepEqual(list.orders.map((o: any) => [o.number, o.itemCount, o.firstItem]), [[placed.order.number, 1, 'Body wave bundle']]);
    assert.equal(ok(await call('api.localhost', 'GET', `/v1/orders/${placed.order.number}`, undefined, { headers: auth })).body.order.id, placed.order.id);
    assert.equal((await call('api.localhost', 'GET', '/v1/orders')).status, 401);
  });

  test('a guest finds an order by number and email; guessing is limited', async () => {
    const cookie = await bag([[bundle, 1]]);
    const placed = ok(await checkout(cookie), 201).body;
    const number = placed.order.number as string;
    assert.equal(ok(await call('localhost', 'POST', '/api/orders/lookup', { number: number.replace('HBD-', '#'), email: 'ADA@example.com' })).body.order.number, number);
    assert.equal((await call('localhost', 'POST', '/api/orders/lookup', { number, email: 'eve@example.com' })).status, 404);
    for (let i = 0; i < 4; i++) await call('localhost', 'POST', '/api/orders/lookup', { number, email: `x${i}@example.com` });
    assert.equal((await call('localhost', 'POST', '/api/orders/lookup', { number, email: 'ada@example.com' })).status, 429);
  });

  test('staff: list, details, notes, address, invoice; support staff only look', async () => {
    const cookie = await bag([[bundle, 2]]);
    const placed = ok(await checkout(cookie), 201).body;
    const id = placed.order.id as number;
    const list = ok(await admin('GET', `/api/orders?q=${encodeURIComponent(placed.order.number)}`)).body;
    assert.deepEqual([list.total, list.orders[0].number, list.orders[0].customer], [1, placed.order.number, 'Ada Obi']);
    assert.ok(ok(await admin('GET', '/api/orders?status=on_hold&payment=awaiting')).body.total >= 1);
    assert.equal(ok(await admin('GET', '/api/orders?status=delivered&q=nobody')).body.total, 0);

    ok(await admin('POST', `/api/orders/${id}/notes`, { note: 'Customer asked for discreet packaging' }), 201);
    assert.equal((await admin('POST', `/api/orders/${id}/notes`, { note: 'x' }, support)).status, 403);
    const detail = ok(await admin('GET', `/api/orders/${id}`, undefined, support)).body.order;
    const note = detail.timeline.find((e: any) => e.kind === 'note');
    assert.deepEqual([note.summary, note.staff, note.visibleToCustomer], ['Customer asked for discreet packaging', 'Emmanuel', false]);
    const customerView = ok(await call('localhost', 'GET', `/api/orders/${placed.order.number}?token=${placed.orderToken}`)).body.order;
    assert.ok(!customerView.timeline.some((e: any) => e.kind === 'note'), 'customers never see staff notes');

    ok(await admin('POST', `/api/orders/${id}/address`, { ...lagos, line1: '7 Allen Avenue' }));
    assert.equal((await db.query('select ship_line1 from orders where id = $1', [id])).rows[0]?.ship_line1, '7 Allen Avenue');
    assert.equal((await admin('POST', `/api/orders/${id}/address`, { ...lagos, country: 'GH', region: 'Accra' })).body.error.fields.country, 'The country cannot change.');

    assert.equal((await admin('GET', `/api/orders/${id}/invoice`)).body.error.code, 'not_paid');
    await pay(id);
    const invoice = ok(await admin('GET', `/api/orders/${id}/invoice`));
    assert.match(String(invoice.headers['content-type']), /^text\/html/);
    assert.match(invoice.text, new RegExp(`Invoice ${placed.order.number}`));
    assert.match(invoice.text, /₦180,000/);
    assert.match(invoice.text, /₦183,500/);
    assert.equal(ok(await call('localhost', 'GET', `/api/orders/${placed.order.number}/invoice?token=${placed.orderToken}`)).text, invoice.text);
  });

  test('staff cancel a paid order before it is sent: everything goes back, payments are refunded', async () => {
    const card = await giftCard(1_000_000, 'CNCL-AAAA-BBBB-CCCC');
    const cookie = await bag([[bundle, 1]]);
    ok(await call('localhost', 'POST', '/api/cart/gift-cards', { code: 'CNCL-AAAA-BBBB-CCCC' }, { cookie }));
    const placed = ok(await checkout(cookie), 201).body;
    const id = placed.order.id as number;
    await pay(id);
    const reservedBefore = (await stock(bundle)).reserved;
    assert.equal((await admin('POST', `/api/orders/${id}/cancel`, { reason: 'x' }, support)).status, 403);
    assert.equal((await admin('POST', `/api/orders/${id}/cancel`, {})).body.error.fields.reason, 'Give a reason for cancelling.');
    const cancelled = ok(await admin('POST', `/api/orders/${id}/cancel`, { reason: 'Customer asked' })).body;
    assert.deepEqual(cancelled.refunds.map((r: any) => r.status), ['succeeded']);
    assert.deepEqual(refundsAsked[refundsAsked.length - 1], { transaction: `${placed.order.number}-ref`, amount: 9_350_000 - 1_000_000 });
    assert.deepEqual(await orderStatus(id), { status: 'cancelled', payment_status: 'refunded' });
    assert.equal((await stock(bundle)).reserved, reservedBefore - 1);
    assert.equal((await db.query('select balance_minor from gift_cards where id = $1', [card])).rows[0]?.balance_minor, 1_000_000);
    assert.equal(mail.last('order_cancelled', 'ada@example.com').data.reason, 'Customer asked');
  });

  test('dispatch takes the items off the shelf once; a sent order cannot be cancelled', async () => {
    const cookie = await bag([[bundle, 3]]);
    const placed = ok(await checkout(cookie), 201).body;
    const id = placed.order.id as number;
    await pay(id);
    const before = await stock(bundle);
    const sent = ok(await admin('POST', `/api/orders/${id}/dispatch`, { courier: 'GIG Logistics', trackingNumber: 'GIG-1' }), 201).body;
    assert.deepEqual(await stock(bundle), { on_hand: before.on_hand - 3, reserved: before.reserved - 3 });
    const movement = await db.query("select change, reason from stock_movements where order_id = $1", [id]);
    assert.deepEqual(movement.rows, [{ change: -3, reason: 'sale' }]);
    assert.equal((await admin('POST', `/api/orders/${id}/cancel`, { reason: 'Too late' })).body.error.code, 'already_sent');
    ok(await admin('POST', `/api/shipments/${sent.shipmentId}/delivered`, {}));
    assert.deepEqual(await stock(bundle), { on_hand: before.on_hand - 3, reserved: before.reserved - 3 }, 'delivery does not move stock again');
  });

  test('a return, start to finish: request, approval, receipt with restock, refund to card and gift card', async () => {
    await giftCard(5_000_000, 'RTRN-AAAA-BBBB-CCCC');
    const o = await deliveredOrder([[wig, 1], [bundle, 2]], 'RTRN-AAAA-BBBB-CCCC');
    const token = { 'X-Order-Token': o.token };
    const view = ok(await call('localhost', 'GET', `/api/orders/${o.number}`, undefined, { headers: token })).body.order;
    assert.equal(view.status, 'delivered');
    assert.equal(view.canReturn, true);
    const [wigItem, bundleItem] = o.items;

    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: bundleItem?.id, quantity: 3, reason: 'changed_mind' }] }, { headers: token })).body.error.fields.items, 'You can send back at most 2 of Body wave bundle.');
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: 999999, reason: 'damaged' }] }, { headers: token })).status, 422);
    const asked = ok(await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: wigItem?.id, quantity: 1, reason: 'wrong_length' }, { orderItemId: bundleItem?.id, quantity: 2, reason: 'changed_mind' }], note: 'Ordered 22 inches, got 18' }, { headers: token }), 201).body.return;
    assert.deepEqual([asked.status, asked.refundMinor, asked.items.length], ['requested', 28_500_000 + 18_000_000, 2]);
    assert.equal(mail.last('return_update', 'ada@example.com').data.status, 'requested');
    // The same items cannot be asked back twice.
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: wigItem?.id, reason: 'damaged' }] }, { headers: token })).body.error.fields.items, 'Bone straight wig is already in a return.');

    assert.equal((await admin('POST', `/api/returns/${asked.id}/receive`, { conditionNote: 'x' })).body.error.code, 'wrong_step');
    assert.equal((await admin('POST', `/api/returns/${asked.id}/decide`, { decision: 'approve' }, support)).status, 403);
    ok(await admin('POST', `/api/returns/${asked.id}/decide`, { decision: 'approve', note: 'Send it back with the code inside.' }));
    const onHand = await stock(wig);
    ok(await admin('POST', `/api/returns/${asked.id}/receive`, { conditionNote: 'Wig unworn, bundles opened', restock: [wigItem?.id] }));
    assert.equal((await stock(wig)).on_hand, onHand.on_hand + 1, 'only the wig goes back on sale');
    const refunded = ok(await admin('POST', `/api/returns/${asked.id}/refund`, { includesShipping: true })).body;
    // ₦465,000 of items plus ₦3,500 delivery: ₦50,000 back on the gift card, the rest to the card payment.
    assert.deepEqual([refunded.amountMinor, refunded.resolution, refunded.return.status], [46_850_000, 'refund', 'refunded']);
    assert.equal(refundsAsked[refundsAsked.length - 1]?.amount, 46_850_000 - 5_000_000);
    assert.equal((await findGiftCard(db, 'RTRN-AAAA-BBBB-CCCC'))?.balanceMinor, 5_000_000);
    assert.deepEqual(await orderStatus(o.id), { status: 'returned', payment_status: 'refunded' });
    assert.equal((await db.query('select return_id from refunds where order_id = $1', [o.id])).rows[0]?.return_id, asked.id);
    const activity = await db.query("select summary from activity_log where area = 'Returns' order by id desc limit 1");
    assert.match(String(activity.rows[0]?.summary), /^Refunded return RET-\d+ \(money back, 46850000\)$/);
  });

  test('store credit with a bonus, final-sale rules, declined and withdrawn returns, and the window closing', async () => {
    ok(await admin('POST', '/api/settings/returns', { windowDays: 14, storeCreditBonusBps: 1000 }));
    assert.equal((await admin('POST', '/api/settings/returns', { windowDays: 400, storeCreditBonusBps: 0 })).status, 422);
    const o = await deliveredOrder([[bundle, 1], [finalSale, 1]]);
    const token = { 'X-Order-Token': o.token };
    const [bundleItem, closure] = o.items;
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: closure?.id, reason: 'changed_mind' }] }, { headers: token })).body.error.fields.items, 'Sample closure was a final sale, so it can only come back if it was wrong or damaged.');

    const credit = ok(await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: bundleItem?.id, reason: 'changed_mind' }], resolution: 'store_credit' }, { headers: token }), 201).body.return;
    ok(await admin('POST', `/api/returns/${credit.id}/decide`, { decision: 'approve' }));
    ok(await admin('POST', `/api/returns/${credit.id}/receive`, { conditionNote: 'As new', restock: [bundleItem?.id] }));
    const asked = refundsAsked.length;
    const done = ok(await admin('POST', `/api/returns/${credit.id}/refund`, {})).body;
    assert.deepEqual([done.resolution, done.amountMinor], ['store_credit', 9_900_000], '₦90,000 plus 10%');
    assert.equal(refundsAsked.length, asked, 'no money goes back to the card');
    const email = mail.last('store_credit', 'ada@example.com');
    const card = await findGiftCard(db, email.data.code ?? '');
    assert.deepEqual([card?.balanceMinor, card?.status, done.storeCreditLast4], [9_900_000, 'active', card?.last4]);

    const damaged = ok(await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: closure?.id, reason: 'damaged' }] }, { headers: token }), 201).body.return;
    assert.equal((await admin('POST', `/api/returns/${damaged.id}/decide`, { decision: 'reject' })).body.error.fields.note, 'Tell the customer why.');
    ok(await admin('POST', `/api/returns/${damaged.id}/decide`, { decision: 'reject', note: 'The photo shows normal wear.' }));
    assert.equal(ok(await admin('GET', `/api/returns/${damaged.id}`)).body.return.status, 'rejected');
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/returns/${damaged.id}/cancel`, {}, { headers: token })).body.error.code, 'wrong_step');

    const again = ok(await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: closure?.id, reason: 'damaged' }] }, { headers: token }), 201).body.return;
    assert.equal(ok(await call('localhost', 'POST', `/api/orders/${o.number}/returns/${again.id}/cancel`, {}, { headers: token })).body.return.status, 'cancelled');
    assert.ok(ok(await admin('GET', '/api/returns?status=cancelled')).body.returns.some((r: any) => r.id === again.id));

    // Fifteen days after delivery the window has closed.
    await db.query("update shipments set delivered_at = delivered_at - interval '15 days' where order_id = $1", [o.id]);
    const late = await call('localhost', 'POST', `/api/orders/${o.number}/returns`, { items: [{ orderItemId: closure?.id, reason: 'damaged' }] }, { headers: token });
    assert.equal(late.body.error.code, 'window_closed');
    assert.equal(ok(await call('localhost', 'GET', `/api/orders/${o.number}`, undefined, { headers: token })).body.order.canReturn, false);
  });
});

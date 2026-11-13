import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { verifyEmail } from '../accounts/customers.js';
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
import { toolsInstalled } from '../media/tools.js';
import { markOrderPaid } from '../payments/order-paid.js';
import { expireUnpaidOrders } from '../orders/checkout.js';
import { birthdayPoints, settleOrderPoints, settleReferrals } from './loyalty.js';

const tools = await toolsInstalled();
const skip = !TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not set' : !tools.vips ? 'libvips is not installed' : false;

interface Reply {
  status: number;
  text: string;
  body: Record<string, any>;
  headers: IncomingMessage['headers'];
}

describe('loyalty points, reviews and gift cards', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  let dir = '';
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (s: number): void => {
    clock = new Date(clock.getTime() + s * 1000);
  };
  const mail = memoryMailer();
  let owner = '';
  let wig = 0;
  let wigProduct = 0;
  const lagos = { name: 'Ada Obi', phone: '+234 803 000 0000', line1: '5 Allen Avenue', city: 'Ikeja', region: 'Lagos', country: 'NG' };

  function call(host: string, method: string, path: string, body?: object | Buffer, o: { cookie?: string; bearer?: string; type?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: `http://${host}` };
    let payload: string | Buffer | undefined;
    if (Buffer.isBuffer(body)) {
      payload = body;
      headers['Content-Type'] = o.type ?? 'image/jpeg';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (o.cookie) headers.Cookie = o.cookie;
    if (o.bearer) headers.Authorization = `Bearer ${o.bearer}`;
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
  const ok = (r: Reply, status = 200): Reply => {
    assert.equal(r.status, status, r.text.slice(0, 500));
    return r;
  };
  const site = (method: string, path: string, body?: object | Buffer, cookie?: string): Promise<Reply> => call('localhost', method, path, body, { cookie });
  const admin = (method: string, path: string, body?: object): Promise<Reply> => call('admin.localhost', method, path, body, { cookie: owner });

  /** A signed-up, verified customer; returns the website cookie and id. */
  async function customer(email: string, extra: Record<string, unknown> = {}): Promise<{ cookie: string; id: number }> {
    ok(await site('POST', '/api/auth/sign-up', { email, password: 'longenough', firstName: 'Ada', lastName: 'Obi', ...extra }), 201);
    const signed = await verifyEmail(deps, { email, code: mail.last('verify_email', email).data.code ?? '' }, { ip: null });
    return { cookie: `hbd_session=${signed.token}`, id: signed.customer.id };
  }

  /** Places, pays and delivers an order of `quantity` wigs for a customer. */
  async function deliveredOrder(cookie: string, quantity = 1, extra: Record<string, unknown> = {}): Promise<{ id: number; number: string }> {
    ok(await site('POST', '/api/cart/items', { variantId: wig, quantity }, cookie), 201);
    const q = ok(await site('POST', '/api/shipping/quote', { address: lagos }, cookie)).body.quote;
    const placed = ok(await site('POST', '/api/checkout', { address: lagos, quoteId: q.id, shippingOption: q.options[0].id, ...extra }, cookie), 201).body;
    const id = Number(placed.order.id);
    await withTransaction(db, async (c) => {
      await c.query("insert into payments (order_id, provider, reference, amount_minor, currency, status, webhook_confirmed_at) select id, 'paystack', number || '-ref', total_minor, 'NGN', 'succeeded', now() from orders where id = $1", [id]);
      await markOrderPaid(c, id, clock);
    });
    await db.query("update orders set status = 'delivered' where id = $1", [id]);
    return { id, number: String(placed.order.number) };
  }
  const points = async (id: number): Promise<number> => Number((await db.query('select loyalty_points from customers where id = $1', [id])).rows[0]?.loyalty_points);

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    dir = mkdtempSync(join(tmpdir(), 'hbd-loyalty-'));
    const config = loadConfig({ MEDIA_DIR: dir });
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    const media = { db, now: () => clock, logger: createLogger('error', () => undefined), mediaDir: dir };
    server = createServer(createApp(config, media.logger, { version: 'test', accounts: deps, media }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    wigProduct = Number((await db.query("insert into products (name, slug, status) values ('Bone straight wig', 'bone-straight-wig', 'published') returning id")).rows[0]?.id);
    wig = Number((await db.query("insert into variants (product_id, sku, weight_grams, length_inches) values ($1, 'WIG-1', 300, 22) returning id", [wigProduct])).rows[0]?.id);
    await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', 28500000)", [wig]);
    await db.query('insert into inventory (variant_id, on_hand) values ($1, 50)', [wig]);
    await db.query("insert into local_shipping_rates (zone_name, states, courier, price_minor, delivery_time) values ('Lagos', '{Lagos}', 'GIG Logistics', 350000, '1 to 2 working days')");
    await db.query("insert into loyalty_tiers (code, name, min_points, benefit, position) values ('gold', 'Gold', 500, 'Early access', 1)");
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a delivered order earns points (1 per ₦1,000 of goods), moves the tier, and a refund takes some back', async () => {
    const ada = await customer('ada@example.com');
    const order = await deliveredOrder(ada.cookie, 2);
    assert.equal(await settleOrderPoints(db, clock), 1);
    assert.equal(await points(ada.id), 570);
    assert.equal((await db.query('select loyalty_tier from customers where id = $1', [ada.id])).rows[0]?.loyalty_tier, 'gold');
    // Nothing changes on the next run.
    assert.equal(await settleOrderPoints(db, clock), 0);
    tick(3600);
    await db.query("insert into refunds (order_id, amount_minor, status, reason, completed_at) values ($1, 28500000, 'succeeded', 'Returned one wig', $2)", [order.id, clock]);
    assert.equal(await settleOrderPoints(db, clock), 1);
    assert.equal(await points(ada.id), 285);
    const page = ok(await site('GET', '/api/account/loyalty', undefined, ada.cookie)).body.loyalty;
    assert.equal(page.points, 285);
    assert.equal(page.worthMinor, 285_000);
    assert.match(page.referralCode, /^DEMJ[A-Z0-9]{6}$/);
    assert.deepEqual(page.history.map((h: any) => [h.kind, h.points]), [['refund', -285], ['order', 570]]);
  });

  test('points pay for part of an order, and come back if it is cancelled', async () => {
    const bola = await customer('bola@example.com');
    await db.query("update customers set loyalty_points = 2000 where id = $1", [bola.id]);
    ok(await site('POST', '/api/cart/items', { variantId: wig, quantity: 1 }, bola.cookie), 201);
    const q = ok(await site('POST', '/api/shipping/quote', { address: lagos }, bola.cookie)).body.quote;
    const tooFew = await site('POST', '/api/checkout', { address: lagos, quoteId: q.id, shippingOption: q.options[0].id, usePoints: 100 }, bola.cookie);
    assert.equal(tooFew.body.error.fields.usePoints, 'Use at least 500 points at a time.');
    const tooMany = await site('POST', '/api/checkout', { address: lagos, quoteId: q.id, shippingOption: q.options[0].id, usePoints: 5000 }, bola.cookie);
    assert.equal(tooMany.body.error.fields.usePoints, 'You have 2000 points.');
    const placed = ok(await site('POST', '/api/checkout', { address: lagos, quoteId: q.id, shippingOption: q.options[0].id, usePoints: 1500 }, bola.cookie), 201).body;
    // 1,500 points × ₦10 = ₦15,000 off the ₦285,000 wig; delivery ₦3,500.
    assert.equal(placed.order.totalMinor, 28_500_000 - 1_500_000 + 350_000);
    assert.equal(placed.amountDueMinor, 27_350_000);
    assert.equal(await points(bola.id), 500);
    tick(31 * 60);
    assert.equal(await expireUnpaidOrders({ db, now: () => clock, mail, logger: createLogger('error', () => undefined) } as never), 1);
    assert.equal(await points(bola.id), 2000);
  });

  test('a friend who joins with a referral code: both get points when the friend\'s first order arrives', async () => {
    const ada = (await db.query("select id, referral_code from customers where email = 'ada@example.com'")).rows[0]!;
    const before = await points(Number(ada.id));
    const chidi = await customer('chidi@example.com', { referralCode: String(ada.referral_code).toLowerCase() });
    assert.equal((await db.query('select status from referrals where referred_customer_id = $1', [chidi.id])).rows[0]?.status, 'pending');
    assert.equal(await settleReferrals(db, clock), 0);
    await deliveredOrder(chidi.cookie);
    assert.equal(await settleReferrals(db, clock), 1);
    assert.equal(await settleReferrals(db, clock), 0);
    assert.equal(await points(Number(ada.id)), before + 500);
    assert.equal(await points(chidi.id), 500);
    const signup = await site('GET', `/create-account/?ref=${String(ada.referral_code)}`);
    assert.match(signup.text, new RegExp(`value="${String(ada.referral_code)}"`));
  });

  test('birthday points are given once a year', async () => {
    const dami = await customer('dami@example.com');
    await db.query("update customers set birthday = '1995-06-01' where id = $1", [dami.id]);
    assert.equal(await birthdayPoints(db, clock), 1);
    assert.equal(await birthdayPoints(db, clock), 0);
    assert.equal(await points(dami.id), 200);
  });

  test('reviews: only delivered items, photos while waiting, staff publish (points once), hide and reply', async () => {
    const ada = (await db.query("select id from customers where email = 'ada@example.com'")).rows[0]!;
    const signed = await call('localhost', 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'longenough' });
    const cookie = String(signed.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const mine = ok(await site('GET', '/api/account/reviews', undefined, cookie)).body;
    assert.equal(mine.toReview.length, 1);
    const item = mine.toReview[0].orderItemId;
    assert.equal((await site('POST', '/api/reviews', { orderItemId: item, rating: 6, body: 'Lovely hair, very soft.' }, cookie)).body.error.fields.rating, 'Choose from 1 to 5 stars.');
    assert.equal((await site('POST', '/api/reviews', { orderItemId: item, rating: 5, body: 'ok' }, cookie)).status, 422);
    const review = ok(await site('POST', '/api/reviews', { orderItemId: item, rating: 5, body: 'Lovely hair, very soft and full.' }, cookie), 201).body.review;
    assert.equal(review.status, 'waiting');
    assert.equal(review.author, 'Ada O.');
    assert.equal((await site('POST', '/api/reviews', { orderItemId: item, rating: 4, body: 'Second try at a review.' }, cookie)).status, 422);
    const photo = join(dir, 'photo.jpg');
    execFileSync('vips', ['black', photo, '800', '800']);
    const withPhoto = ok(await site('POST', `/api/reviews/${review.id}/photos`, readFileSync(photo), cookie), 201).body.review;
    assert.equal(withPhoto.photos.length, 1);
    // Not shown until staff publish it.
    assert.equal(ok(await site('GET', '/api/catalog/products/bone-straight-wig/reviews')).body.count, 0);
    const before = await points(Number(ada.id));
    ok(await admin('POST', `/api/reviews/${review.id}`, { status: 'published' }));
    ok(await admin('POST', `/api/reviews/${review.id}`, { status: 'published' }));
    assert.equal(await points(Number(ada.id)), before + 100);
    ok(await admin('POST', `/api/reviews/${review.id}`, { reply: 'Thank you, Ada!' }));
    assert.equal(mail.last('review_reply', 'ada@example.com').data.reply, 'Thank you, Ada!');
    const shown = ok(await site('GET', '/api/catalog/products/bone-straight-wig/reviews')).body;
    assert.deepEqual([shown.count, shown.average, shown.stars['5'], shown.reviews[0].reply], [1, 5, 1, 'Thank you, Ada!']);
    const page = await site('GET', '/products/bone-straight-wig/');
    assert.match(page.text, /5 out of 5 \(1 review\)/);
    assert.match(page.text, /"aggregateRating":\{"@type":"AggregateRating","ratingValue":5,"reviewCount":1\}/);
    assert.equal((await site('POST', `/api/reviews/${review.id}/photos`, readFileSync(photo), cookie)).status, 404);
    ok(await admin('POST', `/api/reviews/${review.id}`, { status: 'hidden' }));
    assert.equal(ok(await site('GET', '/api/catalog/products/bone-straight-wig/reviews')).body.count, 0);
    assert.match(ok(await site('GET', '/account/reviews/', undefined, cookie)).text, /Not shown/);
  });

  test('buying a gift card: paid, the code is emailed on the chosen day, the balance can be checked', async () => {
    const tooSmall = await site('POST', '/api/gift-cards/buy', { amountMinor: 100_00, currency: 'NGN', recipientEmail: 'friend@example.com', fromName: 'Ada', email: 'buyer@example.com' });
    assert.match(tooSmall.body.error.fields.amountMinor, /^Choose an amount from 5,000/);
    const placed = ok(await site('POST', '/api/gift-cards/buy', { amountMinor: 50_000_00, currency: 'NGN', recipientEmail: 'friend@example.com', recipientName: 'Ngozi', fromName: 'Ada', message: 'Happy birthday!', deliverOn: '2026-06-10', email: 'buyer@example.com' }), 201).body;
    assert.equal(placed.amountDueMinor, 50_000_00);
    const view = ok(await site('GET', `/api/orders/${placed.number}?token=${placed.orderToken}`)).body.order;
    assert.deepEqual([view.items[0].name, view.items[0].returnableQuantity, view.shippingMinor, view.status], ['Gift card', 0, 0, 'on_hold']);
    await withTransaction(db, (c) => markOrderPaid(c, Number(placed.orderId), clock));
    const card = (await db.query("select g.status, g.code_last4, g.delivered_at from gift_cards g join order_items oi on oi.gift_card_id = g.id where oi.order_id = $1", [placed.orderId])).rows[0]!;
    assert.equal(card.status, 'active');
    assert.equal((card.delivered_at as Date).toISOString(), '2026-06-10T07:00:00.000Z');
    assert.equal((await db.query('select status from orders where id = $1', [placed.orderId])).rows[0]?.status, 'delivered');
    const job = (await db.query("select payload, run_at from jobs where kind = 'email.send' and payload->>'template' = 'gift_card' order by id desc limit 1")).rows[0]!;
    assert.equal((job.run_at as Date).toISOString(), '2026-06-10T07:00:00.000Z');
    const code = String((job.payload as any).data.code);
    assert.equal((job.payload as any).data.message, 'Happy birthday!');
    const balance = ok(await site('POST', '/api/gift-cards/balance', { code: code.toLowerCase() })).body.card;
    assert.deepEqual([balance.balanceMinor, balance.status, balance.last4], [50_000_00, 'active', String(card.code_last4)]);
    assert.equal((await site('POST', '/api/gift-cards/balance', { code: 'AAAA-AAAA-AAAA-AAAA' })).status, 422);
  });

  test('an unpaid gift card order that runs out of time never makes a usable card', async () => {
    const placed = ok(await site('POST', '/api/gift-cards/buy', { amountMinor: 10_000_00, currency: 'NGN', recipientEmail: 'x@example.com', fromName: 'Ada', email: 'buyer@example.com' }), 201).body;
    tick(31 * 60);
    await expireUnpaidOrders({ db, now: () => clock, mail, logger: createLogger('error', () => undefined) } as never);
    assert.equal((await db.query('select g.status from gift_cards g join order_items oi on oi.gift_card_id = g.id where oi.order_id = $1', [placed.orderId])).rows[0]?.status, 'disabled');
  });

  test('staff issue gift cards with a reason, switch them off, and see the admin pages', async () => {
    assert.equal((await admin('POST', '/api/gift-cards', { amountMinor: 20_000_00, currency: 'NGN', recipientEmail: 'vip@example.com' })).body.error.fields.reason, 'Say why the card is given, for the record.');
    const issued = ok(await admin('POST', '/api/gift-cards', { amountMinor: 20_000_00, currency: 'NGN', recipientEmail: 'vip@example.com', reason: 'Sorry for the late delivery' }), 201).body.card;
    const code = mail.last('gift_card', 'vip@example.com').data.code ?? '';
    assert.equal(code.replace(/-/g, '').slice(-4), issued.last4);
    ok(await admin('POST', `/api/gift-cards/${issued.id}/disable`, {}));
    assert.equal(ok(await site('POST', '/api/gift-cards/balance', { code })).body.card.status, 'disabled');
    const list = ok(await admin('GET', '/api/gift-cards?q=vip')).body;
    assert.equal(list.cards[0].source, 'Issued by Emmanuel: Sorry for the late delivery');
    for (const path of ['/gift-cards/', '/loyalty/', '/reviews/?status=hidden']) assert.equal((await admin('GET', path)).status, 200, path);
    ok(await admin('POST', '/api/settings/loyalty', { nairaPerPoint: 5, minimumToRedeem: 200 }));
    assert.equal(ok(await admin('GET', '/api/settings/loyalty')).body.rules.nairaPerPoint, 5);
    assert.equal((await admin('POST', '/api/settings/loyalty', { maxPercentOfOrder: 150 })).status, 422);
    const ada = (await db.query("select id from customers where email = 'ada@example.com'")).rows[0]!;
    assert.equal((await admin('POST', `/api/customers/${ada.id}/points`, { points: 50 })).body.error.fields.note, 'Say why, for the record.');
    ok(await admin('POST', `/api/customers/${ada.id}/points`, { points: -1_000_000, note: 'Correction' }));
    assert.equal(await points(Number(ada.id)), 0);
  });

  test('the website pages for points, reviews and gift cards', async () => {
    const signed = await call('localhost', 'POST', '/api/auth/sign-in', { email: 'chidi@example.com', password: 'longenough' });
    const cookie = String(signed.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const loyalty = ok(await site('GET', '/account/loyalty/', undefined, cookie));
    assert.match(loyalty.text, /Points and referrals/);
    assert.match(loyalty.text, /create-account\/\?ref=DEMJ/);
    assert.match(ok(await site('GET', '/account/reviews/', undefined, cookie)).text, /Write a review/);
    assert.equal((await site('GET', '/account/reviews/new/?item=999999', undefined, cookie)).status, 404);
    const gift = ok(await site('GET', '/gift-cards/'));
    assert.match(gift.text, /data-gift-buy/);
    assert.match(gift.text, /data-gift-balance/);
  });
});

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { hashToken, randomToken } from '../accounts/crypto.js';
import { signUp, verifyEmail } from '../accounts/customers.js';
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
import { startPayment } from './payments.js';
import { paystack, stripe } from './providers.js';

const PAYSTACK_SECRET = 'sk_test_paystack_secret_for_tests';
const STRIPE_SECRET = 'sk_test_stripe_secret_for_tests';
const STRIPE_WEBHOOK = 'whsec_test_webhook_secret';

test('webhook signatures: right ones pass, anything else fails', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const body = Buffer.from('{"event":"charge.success"}');
  const ps = paystack({ secretKey: PAYSTACK_SECRET, apiUrl: 'http://x' });
  const good = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
  assert.equal(ps.verifyWebhook(body, { 'x-paystack-signature': good }, now), true);
  assert.equal(ps.verifyWebhook(Buffer.from('{"event":"charge.success "}'), { 'x-paystack-signature': good }, now), false, 'a changed body fails');
  assert.equal(ps.verifyWebhook(body, { 'x-paystack-signature': createHmac('sha512', 'other').update(body).digest('hex') }, now), false);
  assert.equal(ps.verifyWebhook(body, {}, now), false);
  assert.equal(ps.verifyWebhook(body, { 'x-paystack-signature': 'zz' }, now), false);

  const st = stripe({ secretKey: STRIPE_SECRET, webhookSecret: STRIPE_WEBHOOK, apiUrl: 'http://x' });
  const t = Math.floor(now.getTime() / 1000);
  const sign = (time: number, secret = STRIPE_WEBHOOK): string => `t=${time},v1=${createHmac('sha256', secret).update(`${time}.${body.toString()}`).digest('hex')}`;
  assert.equal(st.verifyWebhook(body, { 'stripe-signature': sign(t) }, now), true);
  assert.equal(st.verifyWebhook(body, { 'stripe-signature': `${sign(t)},v1=${'0'.repeat(64)}` }, now), true, 'one good signature among several is enough');
  assert.equal(st.verifyWebhook(body, { 'stripe-signature': sign(t - 301) }, now), false, 'older than 5 minutes');
  assert.equal(st.verifyWebhook(body, { 'stripe-signature': sign(t, 'whsec_other') }, now), false);
  assert.equal(st.verifyWebhook(body, { 'stripe-signature': `t=${t}` }, now), false);
  assert.equal(stripe({ secretKey: STRIPE_SECRET, webhookSecret: '', apiUrl: 'http://x' }).verifyWebhook(body, { 'stripe-signature': sign(t) }, now), false, 'no webhook secret: nothing is trusted');
  assert.equal(paystack({ secretKey: '', apiUrl: 'http://x' }).configured, false);
  assert.equal(paystack({ secretKey: 'sk_live_x', apiUrl: 'http://x' }).mode, 'live');
  assert.equal(st.mode, 'test');
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  body: Record<string, any>;
}
interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('payments over HTTP, against stand-in Paystack and Stripe', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let fake: Server;
  let port: number;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const mail = memoryMailer();
  const seen: Seen[] = [];
  const intents = new Map<string, Record<string, any>>();
  const idempotency = new Map<string, string>();
  let paystackRefundStatus = 'pending';
  let failNextRetrieve = false;
  let owner = '';
  let support = '';
  let variantId = 0;

  /** A stand-in for both providers' APIs, checking what our server sends. */
  function fakeProviders(req: IncomingMessage, body: string): { status: number; json: unknown } {
    const url = new URL(req.url ?? '/', 'http://x');
    const auth = req.headers.authorization;
    if (url.pathname.startsWith('/ps/')) {
      if (auth !== `Bearer ${PAYSTACK_SECRET}`) return { status: 401, json: { status: false, message: 'Invalid key' } };
      const path = url.pathname.slice(3);
      if (path === '/transaction/initialize') {
        const input = JSON.parse(body);
        return { status: 200, json: { status: true, data: { authorization_url: `https://checkout.paystack.test/${input.reference}`, access_code: `ac_${input.reference}`, reference: input.reference } } };
      }
      if (path === '/refund') return { status: 200, json: { status: true, data: { id: 9000 + seen.length, status: paystackRefundStatus, transaction: { reference: JSON.parse(body).transaction } } } };
      if (path === '/settlement') return { status: 200, json: { status: true, data: [{ total_amount: 425_000_000, currency: 'NGN', status: 'success', settlement_date: '2026-11-09' }] } };
    }
    if (url.pathname.startsWith('/st/')) {
      if (auth !== `Bearer ${STRIPE_SECRET}`) return { status: 401, json: { error: { message: 'Invalid API Key' } } };
      const path = url.pathname.slice(3);
      if (path === '/v1/payment_intents' && req.method === 'POST') {
        const key = String(req.headers['idempotency-key'] ?? '');
        const existing = idempotency.get(key);
        if (existing) return { status: 200, json: intents.get(existing) };
        const form = new URLSearchParams(body);
        const id = `pi_${intents.size + 1}`;
        const intent = { id, object: 'payment_intent', client_secret: `${id}_secret_abc`, amount: Number(form.get('amount')), currency: form.get('currency'), status: 'requires_payment_method', form: Object.fromEntries(form) };
        intents.set(id, intent);
        idempotency.set(key, id);
        return { status: 200, json: intent };
      }
      const intentMatch = /^\/v1\/payment_intents\/(pi_\d+)$/.exec(path);
      if (intentMatch && req.method === 'GET') {
        if (failNextRetrieve) {
          failNextRetrieve = false;
          return { status: 500, json: { error: { message: 'Stripe is having a moment' } } };
        }
        const intent = intents.get(intentMatch[1] ?? '');
        return intent ? { status: 200, json: { ...intent, amount_received: intent.status === 'succeeded' ? intent.amount : 0, latest_charge: { payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } } } } : { status: 404, json: { error: { message: 'No such payment_intent' } } };
      }
      if (path === '/v1/refunds') return { status: 200, json: { id: `re_${seen.length}`, object: 'refund', status: 'succeeded', amount: Number(new URLSearchParams(body).get('amount')) } };
      if (path === '/v1/payouts') return { status: 200, json: { data: [{ amount: 310_000, currency: 'usd', status: 'paid', arrival_date: 1_794_000_000 }] } };
    }
    return { status: 404, json: { message: 'not found' } };
  }

  function call(host: string, method: string, path: string, body?: unknown, options: { cookie?: string; headers?: Record<string, string>; raw?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, ...(options.headers ?? {}) };
    if (host === 'localhost' || host === 'admin.localhost') headers.Origin = `http://${host}`;
    const payload = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
          } catch {
            // empty
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const ok = (r: Reply, status = 200): Reply => {
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r;
  };
  const paystackHook = (event: Record<string, unknown>, secret = PAYSTACK_SECRET): Promise<Reply> => {
    const raw = JSON.stringify(event);
    return call('api.localhost', 'POST', '/webhooks/paystack', undefined, { raw, headers: { 'x-paystack-signature': createHmac('sha512', secret).update(raw).digest('hex') } });
  };
  const stripeHook = (event: Record<string, unknown>, age = 0): Promise<Reply> => {
    const raw = JSON.stringify(event);
    const t = Math.floor(clock.getTime() / 1000) - age;
    return call('api.localhost', 'POST', '/webhooks/stripe', undefined, { raw, headers: { 'stripe-signature': `t=${t},v1=${createHmac('sha256', STRIPE_WEBHOOK).update(`${t}.${raw}`).digest('hex')}` } });
  };
  const order = async (input: { currency?: string; total?: number; giftCard?: number; customerId?: number | null; quantity?: number; holdMinutes?: number } = {}): Promise<{ id: number; number: string; token: string }> => {
    const token = randomToken();
    const total = input.total ?? 28_500_000;
    const quantity = input.quantity ?? 1;
    const made = await db.query(
      "insert into orders (customer_id, email, currency, subtotal_minor, total_minor, gift_card_minor, access_token_hash, stock_held_until) values ($1, 'buyer@example.com', $2, $3, $3, $4, $5, $6) returning id, number",
      [input.customerId ?? null, input.currency ?? 'NGN', total, input.giftCard ?? 0, hashToken(token), new Date(clock.getTime() + (input.holdMinutes ?? 30) * 60_000)],
    );
    const id = Number(made.rows[0]?.id);
    await db.query("insert into order_items (order_id, variant_id, product_name, quantity, unit_price_minor, total_minor) values ($1, $2, 'Bone straight wig', $3::int, $4::bigint, $4::bigint * $3::int)", [id, variantId, quantity, Math.floor(total / quantity)]);
    await db.query('update inventory set reserved = reserved + $2 where variant_id = $1', [variantId, quantity]);
    return { id, number: String(made.rows[0]?.number), token };
  };
  const status = async (id: number): Promise<{ status: string; payment_status: string }> => (await db.query('select status, payment_status from orders where id = $1', [id])).rows[0] as { status: string; payment_status: string };

  before(async () => {
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
        const answer = fakeProviders(req, body);
        res.writeHead(answer.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer.json));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({
      PAYSTACK_SECRET_KEY: PAYSTACK_SECRET, PAYSTACK_PUBLIC_KEY: 'pk_test_paystack', STRIPE_SECRET_KEY: STRIPE_SECRET, STRIPE_PUBLISHABLE_KEY: 'pk_test_stripe', STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK,
      PAYSTACK_API_URL: `${fakeUrl}/ps`, STRIPE_API_URL: `${fakeUrl}/st`,
    });
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const role = Number((await db.query("insert into roles (name) values ('Support') returning id")).rows[0]?.id);
    await db.query("insert into role_permissions (role_id, area, can_view, can_change) values ($1, 'orders', true, false)", [role]);
    support = (await signedInStaff(deps, tick, { name: 'Support', email: 'support@hairbydemj.test', roleId: role })).cookie;
    const product = await db.query("insert into products (name, slug, status) values ('Bone straight wig', 'bone-straight-wig', 'published') returning id");
    variantId = Number((await db.query("insert into variants (product_id, sku, weight_grams) values ($1, 'WIG-1', 300) returning id", [product.rows[0]?.id])).rows[0]?.id);
    await db.query('insert into inventory (variant_id, on_hand) values ($1, 10)', [variantId]);
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fake.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('naira: Paystack opens, the webhook confirms, the order is paid once', async () => {
    const discount = Number((await db.query("insert into discounts (name, code, kind, percent_bps, status) values ('Welcome', 'WELCOME10', 'percentage', 1000, 'active') returning id")).rows[0]?.id);
    const o = await order({ total: 28_500_000, giftCard: 2_000_000 });
    await db.query("insert into order_discounts (order_id, discount_id, code, description, amount_minor) values ($1, $2, 'WELCOME10', 'Welcome', 100)", [o.id, discount]);
    const started = ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment;
    assert.deepEqual([started.provider, started.amountMinor, started.currency, started.publicKey], ['paystack', 26_500_000, 'NGN', 'pk_test_paystack'], 'the gift card part is not charged');
    assert.match(started.reference, new RegExp(`^${o.number}-[0-9a-f]{10}$`));
    assert.equal(started.authorizationUrl, `https://checkout.paystack.test/${started.reference}`);
    const init = seen.find((s) => s.path === '/ps/transaction/initialize');
    const sent = JSON.parse(init?.body ?? '{}');
    assert.deepEqual([sent.amount, sent.currency, sent.email, sent.metadata.order_number], [26_500_000, 'NGN', 'buyer@example.com', o.number]);
    assert.deepEqual(sent.channels, ['card', 'bank_transfer', 'ussd', 'bank']);
    assert.equal(sent.callback_url, `http://localhost:3000/checkout/complete/?order=${o.number}`);
    // Pressing pay again gives the same form; Paystack is not asked twice.
    const before = seen.length;
    assert.equal(ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment.reference, started.reference);
    assert.equal(seen.length, before);
    assert.deepEqual(ok(await call('localhost', 'GET', `/api/orders/${o.number}/payment?token=${o.token}`)).body, { orderNumber: o.number, orderStatus: 'on_hold', paymentStatus: 'awaiting', amountDueMinor: 26_500_000, currency: 'NGN', lastFailure: null });

    const event = { event: 'charge.success', data: { id: 123, status: 'success', reference: started.reference, amount: 26_500_000, currency: 'NGN', channel: 'card', authorization: { brand: 'visa', last4: '4081' } } };
    assert.deepEqual(ok(await paystackHook(event)).body, { result: 'processed' });
    assert.deepEqual(await status(o.id), { status: 'to_fulfil', payment_status: 'paid' });
    const payment = (await db.query('select status, card_brand, card_last4, method, webhook_confirmed_at, client_secret from payments where reference = $1', [started.reference])).rows[0];
    assert.deepEqual([payment?.status, payment?.card_brand, payment?.card_last4, payment?.method, payment?.client_secret], ['succeeded', 'visa', '4081', 'card', null]);
    assert.ok(payment?.webhook_confirmed_at);
    assert.equal((await db.query('select times_used from discounts where id = $1', [discount])).rows[0]?.times_used, 1);
    // The same webhook again: recorded once, nothing happens twice.
    assert.deepEqual(ok(await paystackHook(event)).body, { result: 'duplicate' });
    assert.equal((await db.query('select times_used from discounts where id = $1', [discount])).rows[0]?.times_used, 1);
    assert.equal((await db.query("select count(*)::int as n from order_events where order_id = $1 and kind = 'paid'", [o.id])).rows[0]?.n, 1);
    assert.equal(ok(await call('localhost', 'GET', `/api/orders/${o.number}/payment`, undefined, { headers: { 'X-Order-Token': o.token } })).body.paymentStatus, 'paid');
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.error.code, 'already_paid');
  });

  test('a webhook that is not signed by the provider changes nothing', async () => {
    const o = await order();
    const started = ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment;
    const event = { event: 'charge.success', data: { status: 'success', reference: started.reference, amount: 28_500_000, currency: 'NGN' } };
    assert.equal((await paystackHook(event, 'sk_test_guessed')).status, 401);
    assert.equal((await call('api.localhost', 'POST', '/webhooks/paystack', undefined, { raw: JSON.stringify(event) })).status, 401);
    assert.equal((await call('api.localhost', 'POST', '/webhooks/stripe', undefined, { raw: JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }) })).status, 401);
    assert.deepEqual(await status(o.id), { status: 'on_hold', payment_status: 'awaiting' });
    // The wrong amount, even correctly signed, is not accepted.
    assert.deepEqual(ok(await paystackHook({ ...event, data: { ...event.data, amount: 100 } })).body, { result: 'processed' });
    assert.deepEqual(await status(o.id), { status: 'on_hold', payment_status: 'awaiting' });
    assert.match(String((await db.query("select summary from order_events where order_id = $1 and kind = 'payment_mismatch'", [o.id])).rows[0]?.summary), /wrong amount \(NGN 100 instead of NGN 28500000\)/);
    // A reference we never made is recorded and ignored.
    assert.deepEqual(ok(await paystackHook({ event: 'charge.success', data: { status: 'success', reference: 'HBD-00000-unknown', amount: 1, currency: 'NGN' } })).body, { result: 'ignored' });
    assert.deepEqual(ok(await paystackHook({ event: 'subscription.create', data: {} })).body, { result: 'ignored' });
  });

  test('dollars: Stripe, a failed card, a retry, and a late failure that changes nothing', async () => {
    await signUp(deps, { email: 'ada@example.com', password: 'longenough' }, { ip: null });
    const ada = await verifyEmail(deps, { email: 'ada@example.com', code: mail.last('verify_email').data.code }, { ip: null });
    const o = await order({ currency: 'USD', total: 18_500, customerId: ada.customer.id });
    const first = ok(await call('api.localhost', 'POST', `/v1/orders/${o.number}/pay`, {}, { headers: { Authorization: `Bearer ${ada.token}` } })).body.payment;
    assert.deepEqual([first.provider, first.reference, first.clientSecret, first.publicKey, first.authorizationUrl], ['stripe', 'pi_1', 'pi_1_secret_abc', 'pk_test_stripe', null]);
    const sent = seen.find((s) => s.path === '/st/v1/payment_intents');
    assert.deepEqual([intents.get('pi_1')?.form.amount, intents.get('pi_1')?.form.currency, intents.get('pi_1')?.form['automatic_payment_methods[enabled]'], intents.get('pi_1')?.form['metadata[order_number]']], ['18500', 'usd', 'true', o.number]);
    assert.match(String(sent?.headers['idempotency-key']), new RegExp(`^start-${o.number}-`));

    assert.deepEqual(ok(await stripeHook({ id: 'evt_fail_1', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_1', last_payment_error: { message: 'Your card was declined.' } } } })).body, { result: 'processed' });
    assert.deepEqual(await status(o.id), { status: 'on_hold', payment_status: 'failed' });
    assert.equal(ok(await call('api.localhost', 'GET', `/v1/orders/${o.number}/payment`, undefined, { headers: { Authorization: `Bearer ${ada.token}` } })).body.lastFailure, 'Your card was declined.');

    const second = ok(await call('api.localhost', 'POST', `/v1/orders/${o.number}/pay`, {}, { headers: { Authorization: `Bearer ${ada.token}` } })).body.payment;
    assert.equal(second.reference, 'pi_2', 'a new attempt after a failure');
    intents.set('pi_2', { ...intents.get('pi_2'), status: 'succeeded' });
    assert.deepEqual(ok(await stripeHook({ id: 'evt_ok_2', type: 'payment_intent.succeeded', data: { object: { id: 'pi_2' } } })).body, { result: 'processed' });
    assert.deepEqual(await status(o.id), { status: 'to_fulfil', payment_status: 'paid' });
    assert.deepEqual((await db.query("select card_brand, card_last4 from payments where reference = 'pi_2'")).rows[0], { card_brand: 'visa', card_last4: '4242' }, 'card details read back from Stripe');
    // A failure notice for the same payment that arrives late changes nothing.
    ok(await stripeHook({ id: 'evt_fail_late', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_2', last_payment_error: { message: 'late' } } } }));
    assert.deepEqual(await status(o.id), { status: 'to_fulfil', payment_status: 'paid' });
    assert.equal((await db.query("select status from payments where reference = 'pi_2'")).rows[0]?.status, 'succeeded');
    // A Stripe webhook older than 5 minutes is refused.
    assert.equal((await stripeHook({ id: 'evt_old', type: 'payment_intent.succeeded', data: { object: { id: 'pi_2' } } }, 400)).status, 401);
  });

  test('a webhook that fails half-way is answered with an error, so the provider sends it again', async () => {
    const o = await order({ currency: 'GBP', total: 14_500 });
    const started = ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment;
    intents.set(started.reference, { ...intents.get(started.reference), status: 'succeeded' });
    failNextRetrieve = true;
    const event = { id: 'evt_retry', type: 'payment_intent.succeeded', data: { object: { id: started.reference } } };
    assert.equal((await stripeHook(event)).status, 500);
    assert.deepEqual(await status(o.id), { status: 'on_hold', payment_status: 'awaiting' });
    assert.match(String((await db.query("select error from payment_events where event_id = 'evt_retry'")).rows[0]?.error), /refused the request/);
    assert.deepEqual(ok(await stripeHook(event)).body, { result: 'processed' }, 'the retry goes through');
    assert.deepEqual(await status(o.id), { status: 'to_fulfil', payment_status: 'paid' });
  });

  test('only the buyer can pay or see an order; expired checkouts cannot be paid', async () => {
    const o = await order({ customerId: null });
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {})).status, 404);
    assert.equal((await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': randomToken() } })).status, 404);
    assert.equal((await call('localhost', 'GET', `/api/orders/${o.number}/payment`)).status, 404);
    assert.equal((await call('localhost', 'GET', '/api/orders/HBD-99999/payment?token=x')).status, 404);
    await signUp(deps, { email: 'eve@example.com', password: 'longenough' }, { ip: null });
    const eve = await verifyEmail(deps, { email: 'eve@example.com', code: mail.last('verify_email', 'eve@example.com').data.code }, { ip: null });
    const theirs = await order({ customerId: (await db.query("select id from customers where email = 'ada@example.com'")).rows[0]?.id });
    assert.equal((await call('api.localhost', 'POST', `/v1/orders/${theirs.number}/pay`, {}, { headers: { Authorization: `Bearer ${eve.token}` } })).status, 404, "another customer's order looks like it does not exist");
    const old = await order({ holdMinutes: 1 });
    tick(61);
    assert.equal((await call('localhost', 'POST', `/api/orders/${old.number}/pay`, {}, { headers: { 'X-Order-Token': old.token } })).body.error.code, 'checkout_expired');
    const covered = await order({ total: 5_000, giftCard: 5_000 });
    assert.equal((await call('localhost', 'POST', `/api/orders/${covered.number}/pay`, {}, { headers: { 'X-Order-Token': covered.token } })).body.error.code, 'nothing_to_pay');
  });

  test('a payment that arrives after the checkout expired: the order goes ahead if the stock is still there', async () => {
    const o = await order();
    const started = ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment;
    // The checkout expires: the order is cancelled and its stock let go (module 9 does this on a schedule).
    await db.query("update orders set status = 'cancelled', cancelled_at = now() where id = $1", [o.id]);
    await db.query('update inventory set reserved = reserved - 1 where variant_id = $1', [variantId]);
    const reservedBefore = Number((await db.query('select reserved from inventory where variant_id = $1', [variantId])).rows[0]?.reserved);
    ok(await paystackHook({ event: 'charge.success', data: { status: 'success', reference: started.reference, amount: 28_500_000, currency: 'NGN' } }));
    assert.deepEqual(await status(o.id), { status: 'to_fulfil', payment_status: 'paid' });
    assert.equal(Number((await db.query('select reserved from inventory where variant_id = $1', [variantId])).rows[0]?.reserved), reservedBefore + 1, 'the stock was taken again');
  });

  test('... and is refunded in full if the item sold out meanwhile', async () => {
    const o = await order();
    const started = ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment;
    await db.query("update orders set status = 'cancelled', cancelled_at = now() where id = $1", [o.id]);
    await db.query('update inventory set reserved = on_hand where variant_id = $1', [variantId]);
    paystackRefundStatus = 'pending';
    ok(await paystackHook({ event: 'charge.success', data: { status: 'success', reference: started.reference, amount: 28_500_000, currency: 'NGN' } }));
    assert.deepEqual(await status(o.id), { status: 'cancelled', payment_status: 'paid' });
    const refund = (await db.query('select amount_minor, status, reason from refunds where order_id = $1', [o.id])).rows[0];
    assert.deepEqual([refund?.amount_minor, refund?.status, refund?.reason], [28_500_000, 'pending', 'Paid after the order was cancelled, and an item had sold out']);
    const asked = seen.filter((s) => s.path === '/ps/refund').at(-1);
    assert.deepEqual(JSON.parse(asked?.body ?? '{}'), { transaction: started.reference, amount: 28_500_000 });
    // Paystack later confirms the refund.
    ok(await paystackHook({ event: 'refund.processed', data: { status: 'processed', transaction_reference: started.reference, amount: '28500000', currency: 'NGN' } }));
    assert.deepEqual(await status(o.id), { status: 'cancelled', payment_status: 'refunded' });
    await db.query('update inventory set reserved = 0 where variant_id = $1', [variantId]);
  });

  test('refunds from the admin: partial, then the rest, never more than was paid', async () => {
    const o = await order({ currency: 'NGN', total: 20_000_000 });
    const started = ok(await call('localhost', 'POST', `/api/orders/${o.number}/pay`, {}, { headers: { 'X-Order-Token': o.token } })).body.payment;
    ok(await paystackHook({ event: 'charge.success', data: { status: 'success', reference: started.reference, amount: 20_000_000, currency: 'NGN' } }));
    const paymentId = Number((await db.query('select id from payments where reference = $1', [started.reference])).rows[0]?.id);
    const admin = (path: string, body: unknown, cookie = owner): Promise<Reply> => call('admin.localhost', 'POST', path, body, { cookie });
    assert.equal((await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 5_000_000, reason: 'Returned' }, support)).status, 403);
    paystackRefundStatus = 'pending';
    const partial = ok(await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 5_000_000, reason: 'Returned by customer' })).body.refund;
    assert.equal(partial.status, 'pending');
    assert.equal((await status(o.id)).payment_status, 'paid', 'not refunded until Paystack confirms');
    assert.equal((await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 15_000_001, reason: 'x' })).body.error.fields.amountMinor, 'At most 15000000 can still be refunded.');
    assert.equal((await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 0, reason: 'x' })).status, 422);
    assert.equal((await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 100, reason: ' ' })).status, 422);
    ok(await paystackHook({ event: 'refund.processed', data: { status: 'processed', transaction_reference: started.reference, amount: '5000000', currency: 'NGN' } }));
    assert.equal((await status(o.id)).payment_status, 'partly_refunded');
    paystackRefundStatus = 'processed';
    assert.equal(ok(await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 15_000_000, reason: 'Goodwill' })).body.refund.status, 'succeeded');
    assert.equal((await status(o.id)).payment_status, 'refunded');
    assert.equal((await admin(`/api/payments/${paymentId}/refund`, { amountMinor: 1, reason: 'x' })).status, 422);

    const list = ok(await call('admin.localhost', 'GET', `/api/orders/${o.id}/payments`, undefined, { cookie: support })).body;
    assert.deepEqual(list.refunds.map((r: Record<string, any>) => [r.amount_minor, r.status]), [[5_000_000, 'succeeded'], [15_000_000, 'succeeded']]);
    const log = (await db.query("select summary from activity_log where area = 'Orders' order by id")).rows.map((r) => String(r.summary));
    assert.ok(log.includes(`Refunded 5000000 on ${o.number} (pending)`));
  });

  test('a Stripe refund is confirmed at once', async () => {
    const pi = [...intents.values()].find((i) => i.status === 'succeeded' && i.currency === 'usd');
    const paymentId = Number((await db.query('select id from payments where reference = $1', [pi?.id])).rows[0]?.id);
    const refund = ok(await call('admin.localhost', 'POST', `/api/payments/${paymentId}/refund`, { amountMinor: 18_500, reason: 'Changed mind' }, { cookie: owner })).body.refund;
    assert.equal(refund.status, 'succeeded');
    const asked = seen.filter((s) => s.path === '/st/v1/refunds').at(-1);
    assert.equal(new URLSearchParams(asked?.body).get('payment_intent'), pi?.id);
    assert.equal(asked?.headers['idempotency-key'], `refund-${refund.refundId}`);
  });

  test('staff see whether each provider is set up, and the latest payouts', async () => {
    const providers = ok(await call('admin.localhost', 'GET', '/api/payments/providers', undefined, { cookie: owner })).body.providers;
    assert.deepEqual(providers.map((p: Record<string, any>) => [p.name, p.configured, p.mode]), [['paystack', true, 'test'], ['stripe', true, 'test']]);
    assert.equal(providers[1].webhookSecretSet, true);
    assert.ok(!JSON.stringify(providers).includes(STRIPE_SECRET) && !JSON.stringify(providers).includes(PAYSTACK_SECRET), 'secret keys are never sent');
    const payouts = ok(await call('admin.localhost', 'GET', '/api/payments/payouts', undefined, { cookie: owner })).body;
    assert.deepEqual(payouts.payouts.map((p: Record<string, any>) => [p.provider, p.amountMinor, p.currency]), [['paystack', 425_000_000, 'NGN'], ['stripe', 310_000, 'USD']]);
    assert.equal((await call('admin.localhost', 'GET', '/api/payments/providers', undefined, { cookie: support })).status, 403);
  });

  test('with no keys set, paying says so plainly', async () => {
    const o = await order();
    const unset = { db, now: () => clock, logger: createLogger('error', () => undefined), providers: { paystack: paystack({ secretKey: '', apiUrl: 'http://x' }), stripe: stripe({ secretKey: '', webhookSecret: '', apiUrl: 'http://x' }) }, publicKeys: { paystack: '', stripe: '' }, returnUrl: 'http://x' };
    await assert.rejects(startPayment(unset, o.id), (e: Error & { code?: string }) => e.code === 'payments_unavailable');
  });
});

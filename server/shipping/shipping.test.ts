import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { hashToken, randomToken } from '../accounts/crypto.js';
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
import { markOrderPaid } from '../payments/order-paid.js';
import { DEFAULT_BOX, MAX_PARCEL_GRAMS, packItems, type PackageSize } from './parcel.js';
import { carrierPriceIn, chosenOption, nigerianState, refreshAllTracking } from './shipping.js';
import { shippingDeps } from './routes.js';

// ----- packing and money, no database needed -----

const boxes: PackageSize[] = [
  { id: 1, name: 'Small mailer', lengthMm: 250, widthMm: 200, heightMm: 60, emptyWeightGrams: 120 },
  { id: 2, name: 'Wig box', lengthMm: 350, widthMm: 300, heightMm: 150, emptyWeightGrams: 400 },
  { id: 3, name: 'Large box', lengthMm: 600, widthMm: 400, heightMm: 400, emptyWeightGrams: 900 },
];
const bundle = (quantity: number, packageSizeId: number | null = null) => ({ quantity, weightGrams: 120, lengthMm: 200, widthMm: 150, heightMm: 30, packageSizeId });

test('packing: the smallest box that holds the items, and its own weight is added', () => {
  assert.deepEqual(packItems([], boxes), []);
  const one = packItems([bundle(1)], boxes);
  assert.deepEqual(one, [{ packageSizeId: 1, name: 'Small mailer', weightGrams: 240, lengthMm: 250, widthMm: 200, heightMm: 60 }]);
  // Four bundles no longer fit the mailer.
  assert.equal(packItems([bundle(4)], boxes)[0]?.name, 'Wig box');
  // A wig that ships in its own wig box never goes in a mailer.
  const wig = { quantity: 1, weightGrams: 350, lengthMm: null, widthMm: null, heightMm: null, packageSizeId: 2 };
  assert.equal(packItems([wig], boxes)[0]?.name, 'Wig box');
  assert.equal(packItems([wig, bundle(2)], boxes).length, 1);
});

test('packing: too heavy for one box means more boxes; no boxes set up means the standard box', () => {
  const heavy = { quantity: 40, weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100, packageSizeId: null };
  const parcels = packItems([heavy], boxes);
  assert.ok(parcels.length >= 2);
  assert.ok(parcels.every((p) => p.weightGrams <= MAX_PARCEL_GRAMS));
  assert.equal(parcels.reduce((s, p) => s + p.weightGrams, 0) - parcels.reduce((s, p) => s + (boxes.find((b) => b.id === p.packageSizeId)?.emptyWeightGrams ?? 0), 0), 40_000);
  const fallback = packItems([{ quantity: 1, weightGrams: 200, lengthMm: null, widthMm: null, heightMm: null, packageSizeId: null }], []);
  assert.deepEqual(fallback, [{ packageSizeId: null, name: DEFAULT_BOX.name, weightGrams: 450, lengthMm: 350, widthMm: 250, heightMm: 120 }]);
});

test('carrier prices become the customer currency, with markup, rounded up', () => {
  const currencies = new Map([
    ['NGN', { code: 'NGN', rate: 1, minorUnits: 2, rounding: 50_000 }],
    ['USD', { code: 'USD', rate: 0.000625, minorUnits: 2, rounding: 100 }],
    ['EUR', { code: 'EUR', rate: null, minorUnits: 2, rounding: 100 }],
  ]);
  const usd = currencies.get('USD')!;
  const ngn = currencies.get('NGN')!;
  // ₦80,000 is $50; plus 10% is $55.
  assert.equal(carrierPriceIn(80_000, 'NGN', usd, currencies, 1000), 5_500);
  // $40.10 is ₦64,160, rounded up to the next ₦500.
  assert.equal(carrierPriceIn(40.1, 'USD', ngn, currencies, 0), 6_450_000);
  assert.equal(carrierPriceIn(10, 'EUR', ngn, currencies, 0), null, 'no rate for euros yet');
  assert.equal(carrierPriceIn(10, 'JPY', ngn, currencies, 0), null, 'a currency we do not have');
});

test('Nigerian states are matched however they are typed', () => {
  assert.equal(nigerianState('lagos'), 'Lagos');
  assert.equal(nigerianState('Edo State'), 'Edo');
  assert.equal(nigerianState('Abuja'), 'FCT');
  assert.equal(nigerianState('F.C.T.'), 'FCT');
  assert.equal(nigerianState('Akwa  Ibom'), 'Akwa Ibom');
  assert.equal(nigerianState('Atlantis'), null);
});

// ----- over HTTP, against stand-in carriers -----

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: IncomingMessage['headers'];
  raw: Buffer;
}
interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const LABEL_PDF = Buffer.from('%PDF-1.4 stand-in label').toString('base64');

describe('shipping over HTTP, against stand-in DHL, UPS and FedEx', { skip }, () => {
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
  const seen: Seen[] = [];
  let owner = '';
  let support = '';
  let variantId = 0;
  let upsDown = false;
  let fedexTokens = 0;
  let labelsMade = 0;
  const tracking: Record<string, Record<string, any>> = {};

  /** Stand-ins for the three carriers, checking the logins our server sends. */
  function fakeCarriers(req: IncomingMessage, body: string): { status: number; json: unknown } {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    const auth = req.headers.authorization ?? '';
    if (p.startsWith('/dhl/')) {
      if (auth !== `Basic ${Buffer.from('dhl-key:dhl-secret').toString('base64')}`) return { status: 401, json: { detail: 'Invalid credentials' } };
      if (p === '/dhl/rates') {
        return { status: 200, json: { products: [
          { productName: 'EXPRESS WORLDWIDE', productCode: 'P', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'NGN', price: 96_000 }, { currencyType: 'PULCL', priceCurrency: 'USD', price: 60 }], deliveryCapabilities: { estimatedDeliveryDateAndTime: '2026-06-04T23:59:00', totalTransitDays: '3' } },
          { productName: 'EXPRESS 12:00', productCode: 'Y', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'NGN', price: 140_000 }], deliveryCapabilities: { totalTransitDays: '2' } },
        ] } };
      }
      if (p === '/dhl/shipments' && req.method === 'POST') {
        const n = String(1_234_567_890 + labelsMade++);
        return { status: 201, json: { shipmentTrackingNumber: n, trackingUrl: `https://dhl.test/track/${n}`, packages: [{ trackingNumber: 'JD0001' }], documents: [{ imageFormat: 'PDF', content: LABEL_PDF, typeCode: 'label' }], shipmentCharges: [{ currencyType: 'BILLC', priceCurrency: 'NGN', price: 95_500.5 }] } };
      }
      const t = /^\/dhl\/shipments\/(\w+)\/tracking$/.exec(p);
      if (t) return { status: 200, json: tracking[t[1] ?? ''] ?? { shipments: [] } };
    }
    if (p === '/ups/security/v1/oauth/token') {
      if (auth !== `Basic ${Buffer.from('ups-id:ups-secret').toString('base64')}` || body !== 'grant_type=client_credentials') return { status: 401, json: { response: { errors: [{ message: 'Invalid client' }] } } };
      return { status: 200, json: { access_token: 'ups-token', expires_in: '14399' } };
    }
    if (p.startsWith('/ups/')) {
      if (auth !== 'Bearer ups-token') return { status: 401, json: { response: { errors: [{ message: 'Invalid token' }] } } };
      if (p === '/ups/api/rating/v2409/Shoptimeintransit') {
        if (upsDown) return { status: 503, json: { response: { errors: [{ message: 'Service unavailable' }] } } };
        return { status: 200, json: { RateResponse: { RatedShipment: [
          { Service: { Code: '65' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '70.00' }, NegotiatedRateCharges: { TotalCharge: { CurrencyCode: 'USD', MonetaryValue: '52.00' } }, TimeInTransit: { ServiceSummary: { EstimatedArrival: { BusinessDaysInTransit: '4', Arrival: { Date: '20260605' } } } } },
          { Service: { Code: '07' }, TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '95.00' } },
        ] } } };
      }
      if (p === '/ups/api/shipments/v2409/ship') return { status: 200, json: { ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: '1ZSHIP', ShipmentCharges: { TotalCharges: { CurrencyCode: 'USD', MonetaryValue: '51.75' } }, PackageResults: { TrackingNumber: `1Z999AA1012345${String(6784 + labelsMade++)}`, ShippingLabel: { ImageFormat: { Code: 'GIF' }, GraphicImage: Buffer.from('GIF89a').toString('base64') } } } } } };
      const t = /^\/ups\/api\/track\/v1\/details\/(\w+)$/.exec(p);
      if (t) return { status: 200, json: tracking[t[1] ?? ''] ?? { trackResponse: { shipment: [] } } };
    }
    if (p === '/fedex/oauth/token') {
      const form = new URLSearchParams(body);
      if (form.get('client_id') !== 'fedex-key' || form.get('client_secret') !== 'fedex-secret') return { status: 401, json: { errors: [{ message: 'Bad key' }] } };
      fedexTokens += 1;
      return { status: 200, json: { access_token: 'fedex-token', expires_in: 3599 } };
    }
    if (p.startsWith('/fedex/')) {
      if (auth !== 'Bearer fedex-token') return { status: 401, json: { errors: [{ message: 'Bad token' }] } };
      if (p === '/fedex/rate/v1/rates/quotes') return { status: 200, json: { output: { rateReplyDetails: [{ serviceType: 'INTERNATIONAL_PRIORITY', serviceName: 'FedEx International Priority®', ratedShipmentDetails: [{ rateType: 'LIST', totalNetCharge: 150_000, currency: 'NGN' }, { rateType: 'ACCOUNT', totalNetCharge: 112_000, currency: 'NGN' }], operationalDetail: { transitTime: 'TWO_DAYS' } }] } } };
      if (p === '/fedex/ship/v1/shipments') return { status: 200, json: { output: { transactionShipments: [{ masterTrackingNumber: String(794_699_999_999 + labelsMade), pieceResponses: [{ trackingNumber: String(794_699_999_999 + labelsMade++), packageDocuments: [{ docType: 'PDF', encodedLabel: LABEL_PDF }] }], completedShipmentDetail: { shipmentRating: { shipmentRateDetails: [{ totalNetCharge: 111_000, currency: 'NGN' }] } } }] } } };
      if (p === '/fedex/track/v1/trackingnumbers') {
        const n = JSON.parse(body).trackingInfo?.[0]?.trackingNumberInfo?.trackingNumber;
        return { status: 200, json: tracking[n] ?? { output: { completeTrackResults: [] } } };
      }
    }
    return { status: 404, json: { message: 'not found' } };
  }

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
          const raw = Buffer.concat(chunks);
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(raw.toString('utf8')) as Record<string, any>;
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers, raw });
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
  const admin = (method: string, path: string, body?: unknown, cookie = owner): Promise<Reply> => call('admin.localhost', method, path, body, { cookie });

  /** A guest with a bag holding `quantity` of the wig, in `currency`. Returns the cart cookie. */
  async function guestWithBag(quantity = 1, currency = 'NGN'): Promise<string> {
    const added = ok(await call('localhost', 'POST', '/api/cart/items', { variantId, quantity }), 201);
    const cookie = String(added.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    if (currency !== 'NGN') ok(await call('localhost', 'POST', '/api/cart/currency', { currency }, { cookie }));
    return cookie;
  }
  const quote = (cookie: string, address: Record<string, unknown>): Promise<Reply> => call('localhost', 'POST', '/api/shipping/quote', { address }, { cookie });
  const london = { country: 'GB', city: 'London', line1: '10 Downing Street', postalCode: 'SW1A 2AA', region: 'Greater London' };

  /** A paid order to London (or wherever), sent with the given carrier and service. */
  async function paidOrder(carrier: string, service: string, address: Record<string, string> = { ship_country: 'GB', ship_city: 'London', ship_line1: '10 Downing Street', ship_postal_code: 'SW1A 2AA' }): Promise<{ id: number; number: string; token: string }> {
    const token = randomToken();
    const made = await db.query(
      `insert into orders (email, currency, subtotal_minor, shipping_minor, total_minor, payment_status, status, paid_at, access_token_hash, ship_full_name, ship_phone, ship_line1, ship_city, ship_postal_code, ship_country, ship_region, shipping_carrier, shipping_service_code, shipping_service_name)
       values ('buyer@example.com', 'USD', 18000, 6000, 24000, 'paid', 'to_fulfil', now(), $1, 'Ada Obi', '+44 20 7946 0000', $2, $3, $4, $5, $6, $7, $8, 'Express') returning id, number`,
      [hashToken(token), address.ship_line1, address.ship_city, address.ship_postal_code ?? null, address.ship_country, address.ship_region ?? null, carrier, service],
    );
    const id = Number(made.rows[0]?.id);
    await db.query("insert into order_items (order_id, variant_id, product_name, quantity, unit_price_minor, total_minor, weight_grams) values ($1, $2, 'Bone straight wig', 1, 18000, 18000, 350)", [id, variantId]);
    return { id, number: String(made.rows[0]?.number), token };
  }

  before(async () => {
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
        const answer = fakeCarriers(req, body);
        res.writeHead(answer.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer.json));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    mediaDir = join(tmpdir(), `hbd-shipping-${process.pid}-${Date.now()}`);

    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({
      MEDIA_DIR: mediaDir,
      DHL_API_KEY: 'dhl-key', DHL_API_SECRET: 'dhl-secret', DHL_ACCOUNT_NUMBER: '950000000', DHL_API_URL: `${fakeUrl}/dhl`,
      UPS_CLIENT_ID: 'ups-id', UPS_CLIENT_SECRET: 'ups-secret', UPS_ACCOUNT_NUMBER: 'A1B2C3', UPS_API_URL: `${fakeUrl}/ups`,
      FEDEX_API_KEY: 'fedex-key', FEDEX_SECRET_KEY: 'fedex-secret', FEDEX_ACCOUNT_NUMBER: '740561073', FEDEX_API_URL: `${fakeUrl}/fedex`,
    });
    deps = accountDeps({ db, config, mail: memoryMailer(), now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const role = Number((await db.query("insert into roles (name) values ('Support') returning id")).rows[0]?.id);
    await db.query("insert into role_permissions (role_id, area, can_view, can_change) values ($1, 'orders', true, false)", [role]);
    support = (await signedInStaff(deps, tick, { name: 'Support', email: 'support@hairbydemj.test', roleId: role })).cookie;

    await db.query("update currencies set rate_from_base = 0.000625 where code = 'USD'");
    const product = await db.query("insert into products (name, slug, status, customs_description, hs_code) values ('Bone straight wig', 'bone-straight-wig', 'published', 'Human hair wig', '670420') returning id");
    variantId = Number((await db.query("insert into variants (product_id, sku, weight_grams) values ($1, 'WIG-1', 350) returning id", [product.rows[0]?.id])).rows[0]?.id);
    await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', 28500000), ($1, 'USD', 18000)", [variantId]);
    await db.query('insert into inventory (variant_id, on_hand) values ($1, 50)', [variantId]);
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fake.close(resolve));
    await db.end();
    await testDb.drop();
    await rm(mediaDir, { recursive: true, force: true });
  });

  test('staff set the store address, boxes, carriers and zones; support staff cannot', async () => {
    assert.equal(ok(await admin('GET', '/api/shipping/origin')).body.origin, null);
    const bad = await admin('POST', '/api/shipping/origin', { country: 'NG', city: 'Benin City', line1: '' });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['line1', 'name', 'phone', 'region']);
    const origin = ok(await admin('POST', '/api/shipping/origin', { name: 'hairbydemj', company: 'hairbydemj', phone: '+234 810 000 0000', email: 'orders@hairbydemj.com', line1: '39 Ohonre Street', city: 'Benin City', region: 'edo state', postalCode: '300283', country: 'ng' })).body.origin;
    assert.deepEqual([origin.region, origin.country, origin.originCountry], ['Edo', 'NG', 'NG']);
    assert.equal((await admin('POST', '/api/shipping/origin', { country: 'NG' }, support)).status, 403);

    ok(await admin('POST', '/api/shipping/package-sizes', { name: 'Small mailer', lengthMm: 250, widthMm: 200, heightMm: 60, emptyWeightGrams: 120 }), 201);
    ok(await admin('POST', '/api/shipping/package-sizes', { name: 'Wig box', lengthMm: 350, widthMm: 300, heightMm: 150, emptyWeightGrams: 400 }), 201);
    assert.equal((await admin('POST', '/api/shipping/package-sizes', { name: 'Wig box', lengthMm: 1, widthMm: 300, heightMm: 150, emptyWeightGrams: 400 })).body.error.fields.lengthMm, 'Enter the length in millimetres from 10 to 2000.');
    assert.equal((await admin('POST', '/api/shipping/package-sizes', { name: 'Wig box', lengthMm: 300, widthMm: 300, heightMm: 150, emptyWeightGrams: 400 })).body.error.fields.name, 'There is already a box with this name.');
    assert.equal(ok(await admin('GET', '/api/shipping/package-sizes')).body.packageSizes.length, 2);
    await db.query("update products set package_size_id = (select id from package_sizes where name = 'Wig box')");

    const carriers = ok(await admin('GET', '/api/shipping/carriers')).body.carriers;
    assert.deepEqual(carriers.map((c: any) => [c.code, c.enabled, c.configured, c.mode]), [['dhl', false, true, 'live'], ['fedex', false, true, 'live'], ['ups', false, true, 'live']]);
    for (const code of ['dhl', 'ups', 'fedex']) ok(await admin('POST', `/api/shipping/carriers/${code}`, { enabled: true, markupBps: 500 }));
    // Staff can limit a carrier to the services they want, with their own names.
    ok(await admin('POST', '/api/shipping/carriers/ups', { services: [{ code: '65', name: 'UPS Saver' }] }));
    assert.equal((await admin('POST', '/api/shipping/carriers/royalmail', { enabled: true })).status, 404);
    assert.equal((await admin('POST', '/api/shipping/carriers/dhl', { markupBps: 20000 })).status, 422);

    const lagos = ok(await admin('POST', '/api/shipping/local-rates', { zoneName: 'Lagos', states: ['Lagos'], courier: 'GIG Logistics', priceMinor: 350_000, deliveryTime: '1 to 2 working days' }), 201).body;
    assert.equal(lagos.states.length, 37);
    ok(await admin('POST', '/api/shipping/local-rates', { zoneName: 'South South', states: ['Edo', 'delta', 'Rivers'], courier: 'GIG Logistics', priceMinor: 250_000, deliveryTime: 'Next working day' }), 201);
    ok(await admin('POST', '/api/shipping/local-rates', { zoneName: 'Rest of Nigeria', states: [], courier: 'GIG Logistics', priceMinor: 500_000, deliveryTime: '3 to 5 working days' }), 201);
    const clash = await admin('POST', '/api/shipping/local-rates', { zoneName: 'Lagos express', states: ['lagos'], courier: 'Kwik', priceMinor: 600_000, deliveryTime: 'Same day' });
    assert.equal(clash.body.error.fields.states, 'Lagos is already in the zone "Lagos".');
    assert.equal((await admin('POST', '/api/shipping/local-rates', { zoneName: 'Nowhere', states: ['Atlantis'], courier: 'X', priceMinor: 1, deliveryTime: 'x' })).body.error.fields.states, 'Choose states from the list.');
    const activity = await db.query("select summary from activity_log where area = 'Shipping' order by id");
    assert.ok(activity.rows.some((r) => r.summary === 'Added the delivery zone "Lagos"'));
  });

  test('inside Nigeria: the zone for the state, else the zone for everywhere else', async () => {
    const cookie = await guestWithBag();
    const lagos = ok(await quote(cookie, { country: 'NG', city: 'Ikeja', line1: '5 Allen Avenue', region: 'Lagos' })).body.quote;
    assert.deepEqual(lagos.options.map((o: any) => [o.carrier, o.carrierName, o.serviceName, o.priceMinor, o.estimate]), [['local', 'GIG Logistics', 'Lagos', 350_000, '1 to 2 working days']]);
    assert.equal(lagos.dutiesNotice, null);
    assert.equal(lagos.currency, 'NGN');
    assert.match(lagos.id, /^[A-Za-z0-9_-]{32}$/);
    const kano = ok(await quote(cookie, { country: 'NG', city: 'Kano', line1: '1 Bompai Road', region: 'kano' })).body.quote;
    assert.deepEqual(kano.options.map((o: any) => o.serviceName), ['Rest of Nigeria']);
    assert.equal((await quote(cookie, { country: 'NG', city: 'X', line1: 'Y', region: 'Atlantis' })).body.error.fields.region, 'Choose a state.');
    assert.equal(ok(await quote(cookie, { country: 'NG', city: 'Benin City', line1: '1 Airport Road', region: 'Edo' })).body.quote.options[0].priceMinor, 250_000);
  });

  test('abroad: live prices from all three carriers in the customer currency, with the duties notice', async () => {
    const cookie = await guestWithBag(1, 'USD');
    const before = seen.length;
    const q = ok(await quote(cookie, london)).body.quote;
    assert.equal(q.currency, 'USD');
    assert.equal(q.dutiesNotice, 'Delivery prices do not include import duties or taxes. If your country charges them, the carrier will ask you to pay them when your parcel arrives.');
    // DHL ₦96,000 = $60, FedEx ₦112,000 = $70 (account rate, not list), UPS $52 negotiated; each plus 5%,
    // rounded up to whole dollars as the dollar's rounding is set. UPS's other service is not allowed.
    assert.deepEqual(q.options.map((o: any) => [o.id, o.serviceName, o.priceMinor, o.estimate]), [
      ['ups:65', 'UPS Saver', 5_500, '4 working days'],
      ['dhl:P', 'EXPRESS WORLDWIDE', 6_300, '3 working days'],
      ['fedex:INTERNATIONAL_PRIORITY', 'FedEx International Priority®', 7_400, '2 working days'],
      ['dhl:Y', 'EXPRESS 12:00', 9_200, '2 working days'],
    ]);
    assert.ok(q.options.every((o: any) => !('cost' in o)), 'what the label costs us is never sent to customers');
    assert.deepEqual(q.parcels, [{ packageSizeId: 2, name: 'Wig box', weightGrams: 750, lengthMm: 350, widthMm: 300, heightMm: 150 }]);

    const calls = seen.slice(before);
    const dhlRates = JSON.parse(calls.find((s) => s.path === '/dhl/rates')?.body ?? '{}');
    assert.deepEqual([dhlRates.accounts[0].number, dhlRates.customerDetails.receiverDetails.countryCode, dhlRates.isCustomsDeclarable, dhlRates.packages[0].weight, dhlRates.packages[0].dimensions], ['950000000', 'GB', true, 0.8, { length: 35, width: 30, height: 15 }]);
    const upsRates = JSON.parse(calls.find((s) => s.path.endsWith('/Shoptimeintransit'))?.body ?? '{}');
    assert.equal(upsRates.RateRequest.Shipment.Shipper.ShipperNumber, 'A1B2C3');
    assert.equal(upsRates.RateRequest.Shipment.ShipTo.Address.PostalCode, 'SW1A 2AA');
    const fedexRates = JSON.parse(calls.find((s) => s.path === '/fedex/rate/v1/rates/quotes')?.body ?? '{}');
    assert.equal(fedexRates.requestedShipment.customsClearanceDetail.dutiesPayment.paymentType, 'RECIPIENT');
    assert.equal(fedexRates.requestedShipment.customsClearanceDetail.commodities[0].harmonizedCode, '670420');

    // The UPS token is reused, not fetched for every request.
    ok(await quote(cookie, london));
    assert.equal(seen.filter((s) => s.path === '/ups/security/v1/oauth/token').length, 1);
    assert.equal(fedexTokens, 1);
  });

  test('one carrier failing leaves the others; none at all says so; a postcode is needed where one exists', async () => {
    const cookie = await guestWithBag(1, 'USD');
    upsDown = true;
    const q = ok(await quote(cookie, london)).body.quote;
    upsDown = false;
    assert.deepEqual(q.options.map((o: any) => o.carrier), ['dhl', 'fedex', 'dhl']);
    assert.equal((await quote(cookie, { ...london, postalCode: '' })).body.error.fields.postalCode, 'Enter the postcode.');
    await db.query('update carriers set enabled = false');
    const none = ok(await quote(cookie, london)).body.quote;
    assert.deepEqual([none.options, none.message], [[], 'We could not get delivery prices for this address. Check the address, or try again in a few minutes.']);
    await db.query('update carriers set enabled = true');
  });

  test('a free-delivery code makes the cheapest option free', async () => {
    await db.query("insert into discounts (name, code, kind, status, combinable, starts_at) values ('Free delivery', 'SHIPFREE', 'free_shipping', 'active', true, '2026-01-01')");
    const cookie = await guestWithBag();
    const applied = ok(await call('localhost', 'POST', '/api/cart/discount', { code: 'SHIPFREE' }, { cookie })).body.cart;
    assert.equal(applied.freeShipping, true, JSON.stringify(applied.code));
    const q = ok(await quote(cookie, { country: 'NG', city: 'Ikeja', line1: '5 Allen Avenue', region: 'Lagos' })).body.quote;
    assert.deepEqual([q.options[0].priceMinor, q.options[0].originalPriceMinor], [0, 350_000]);
  });

  test('checkout takes only an option from a fresh quote for the same bag and address', async () => {
    const cookie = await guestWithBag();
    const q = ok(await quote(cookie, { country: 'NG', city: 'Ikeja', line1: '5 Allen Avenue', region: 'Lagos' })).body.quote;
    const cartId = Number((await db.query('select cart_id from shipping_quotes where id = $1', [q.id])).rows[0]?.cart_id);
    const address = { name: 'Ada', phone: '+2348000000000', line1: '5 Allen Avenue', city: 'Ikeja', region: 'Lagos', country: 'NG' };
    const chosen = await chosenOption(db, { quoteId: q.id, optionId: q.options[0].id, cartId, currency: 'NGN', address }, clock);
    assert.equal(chosen.option.priceMinor, 350_000);
    assert.equal(chosen.dutiesNotice, false);
    await assert.rejects(chosenOption(db, { quoteId: q.id, optionId: q.options[0].id, cartId, currency: 'NGN', address: { ...address, region: 'Edo' } }, clock), { code: 'quote_expired' });
    await assert.rejects(chosenOption(db, { quoteId: q.id, optionId: q.options[0].id, cartId: cartId + 1, currency: 'NGN', address }, clock), { code: 'quote_expired' });
    await assert.rejects(chosenOption(db, { quoteId: q.id, optionId: 'local:999', cartId, currency: 'NGN', address }, clock), { code: 'invalid' });
    await assert.rejects(chosenOption(db, { quoteId: q.id, optionId: q.options[0].id, cartId, currency: 'NGN', address }, new Date(clock.getTime() + 31 * 60_000)), { code: 'quote_expired' });
    await assert.rejects(chosenOption(db, { quoteId: 'x', optionId: q.options[0].id, cartId, currency: 'NGN', address }, clock), { code: 'quote_expired' });
  });

  test('after payment: a DHL label is bought once, saved privately, and can be printed', async () => {
    const o = await paidOrder('dhl', 'P');
    assert.equal((await admin('POST', `/api/orders/${o.id}/label`, {}, support)).status, 403, 'viewing orders is not enough');
    const bought = ok(await admin('POST', `/api/orders/${o.id}/label`, {}), 201).body;
    assert.equal(bought.created, true);
    assert.match(bought.trackingNumber, /^\d{10}$/);
    assert.deepEqual(bought.shipments.map((s: any) => [s.carrierName, s.status, s.trackingUrl]), [['DHL Express', 'label_bought', `https://dhl.test/track/${bought.trackingNumber}`]]);
    const sent = JSON.parse(seen.filter((s) => s.path === '/dhl/shipments').pop()?.body ?? '{}');
    assert.deepEqual([sent.productCode, sent.content.incoterm, sent.content.declaredValueCurrency, sent.content.declaredValue, sent.customerReferences[0].value], ['P', 'DAP', 'USD', 180, o.number]);
    assert.deepEqual([sent.customerDetails.receiverDetails.contactInformation.fullName, sent.customerDetails.shipperDetails.postalAddress.cityName], ['Ada Obi', 'Benin City']);
    assert.equal(sent.content.exportDeclaration.lineItems[0].commodityCodes[0].value, '670420');

    const row = (await db.query('select label_path, label_format, label_cost_minor, label_cost_currency, packages from shipments where order_id = $1', [o.id])).rows[0];
    assert.deepEqual([row?.label_format, Number(row?.label_cost_minor), row?.label_cost_currency], ['pdf', 9_550_050, 'NGN']);
    assert.equal((await readFile(join(mediaDir, 'private', 'labels', String(row?.label_path)))).toString(), '%PDF-1.4 stand-in label');
    // Asking again gives the same label; DHL is not asked twice.
    const before = seen.length;
    const again = ok(await admin('POST', `/api/orders/${o.id}/label`, {})).body;
    assert.deepEqual([again.trackingNumber, again.created, seen.length], [bought.trackingNumber, false, before]);

    const shipmentId = bought.shipmentId;
    const file = ok(await admin('GET', `/api/shipments/${shipmentId}/label`));
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.equal(file.raw.toString(), '%PDF-1.4 stand-in label');
    assert.equal(ok(await admin('GET', `/api/shipments/${shipmentId}/label`, undefined, support)).raw.length, file.raw.length, 'support staff can print');
    assert.equal((await admin('GET', `/api/shipments/${shipmentId}/label?parcel=2`)).status, 404);
    // Labels are never public files.
    assert.equal((await call('localhost', 'GET', `/media/private/labels/${String(row?.label_path)}`)).status, 404);
  });

  test('UPS and FedEx labels, and what cannot be labelled', async () => {
    const u = await paidOrder('ups', '65');
    const ub = ok(await admin('POST', `/api/orders/${u.id}/label`, {}), 201).body;
    assert.match(ub.trackingNumber, /^1Z999AA1012345\d{4}$/);
    const upsSent = JSON.parse(seen.filter((s) => s.path === '/ups/api/shipments/v2409/ship').pop()?.body ?? '{}');
    assert.deepEqual([upsSent.ShipmentRequest.Shipment.Service.Code, upsSent.ShipmentRequest.Shipment.PaymentInformation.ShipmentCharge.length, upsSent.ShipmentRequest.Shipment.ShipmentServiceOptions.InternationalForms.TermsOfShipment], ['65', 1, 'DAP']);
    assert.equal(ok(await admin('GET', `/api/shipments/${ub.shipmentId}/label`)).headers['content-type'], 'image/gif');

    const f = await paidOrder('fedex', 'INTERNATIONAL_PRIORITY');
    const fb = ok(await admin('POST', `/api/orders/${f.id}/label`, {}), 201).body;
    assert.match(fb.trackingNumber, /^7947\d{8}$/);
    const fedexSent = JSON.parse(seen.filter((s) => s.path === '/fedex/ship/v1/shipments').pop()?.body ?? '{}');
    assert.deepEqual([fedexSent.requestedShipment.serviceType, fedexSent.requestedShipment.customsClearanceDetail.dutiesPayment.paymentType, fedexSent.requestedShipment.labelSpecification.imageType], ['INTERNATIONAL_PRIORITY', 'RECIPIENT', 'PDF']);

    const unpaid = await paidOrder('dhl', 'P');
    await db.query("update orders set payment_status = 'awaiting' where id = $1", [unpaid.id]);
    assert.equal((await admin('POST', `/api/orders/${unpaid.id}/label`, {})).body.error.code, 'not_paid');
    const local = await paidOrder('local', '1', { ship_country: 'NG', ship_city: 'Ikeja', ship_line1: '5 Allen Avenue', ship_region: 'Lagos' });
    assert.equal((await admin('POST', `/api/orders/${local.id}/label`, {})).body.error.code, 'local_delivery');
    // A carrier refusing leaves nothing half-made, and staff are told what to do.
    const broken = await paidOrder('dhl', 'P');
    await db.query("update orders set ship_full_name = '' where id = $1", [broken.id]);
    assert.equal((await admin('POST', `/api/orders/${broken.id}/label`, {})).status, 422);
    assert.equal((await db.query('select count(*)::int as n from shipments where order_id = $1', [broken.id])).rows[0]?.n, 0);
    assert.equal((await db.query("select count(*)::int as n from order_events where order_id = $1 and kind = 'label_failed'", [broken.id])).rows[0]?.n, 1);
  });

  test('tracking: new scans are saved once, the order moves to shipped then delivered, and the customer can see it', async () => {
    const o = await paidOrder('dhl', 'P');
    const { shipmentId } = ok(await admin('POST', `/api/orders/${o.id}/label`, {}), 201).body;
    await db.query("update shipments set tracking_number = 'TRK1' where id = $1", [shipmentId]);
    tracking.TRK1 = { shipments: [{ status: 'transit', events: [
      { date: '2026-06-01', time: '15:00:00', GMTOffset: '+01:00', typeCode: 'PU', description: 'Shipment picked up', serviceArea: [{ description: 'Benin City-NG' }] },
      { date: '2026-06-02', time: '08:10:00', GMTOffset: '+01:00', typeCode: 'PL', description: 'Processed at LAGOS - NIGERIA', serviceArea: [{ description: 'Lagos-NG' }] },
    ] }] };
    assert.deepEqual(ok(await admin('POST', `/api/shipments/${shipmentId}/track`, {}, support)).body, { status: 'in_transit', newEvents: 2 });
    assert.equal((await db.query('select status from orders where id = $1', [o.id])).rows[0]?.status, 'shipped');
    assert.deepEqual(ok(await admin('POST', `/api/shipments/${shipmentId}/track`, {})).body, { status: 'in_transit', newEvents: 0 }, 'the same scans again add nothing');

    tracking.TRK1.shipments[0].status = 'delivered';
    tracking.TRK1.shipments[0].events.push({ date: '2026-06-04', time: '11:30:00', GMTOffset: '+01:00', typeCode: 'OK', description: 'Delivered', serviceArea: [{ description: 'London-GB' }] });
    // Three hours later the worker looks again at every parcel still on the way.
    await db.query("update shipments set last_tracked_at = last_tracked_at - interval '3 hours'");
    const sweep = await refreshAllTracking(shippingDeps(deps, createLogger('error', () => undefined)));
    assert.ok(sweep.checked >= 1 && sweep.failed === 0, JSON.stringify(sweep));
    assert.equal((await db.query('select status from orders where id = $1', [o.id])).rows[0]?.status, 'delivered');
    const shipment = (await db.query('select status, shipped_at, delivered_at from shipments where id = $1', [shipmentId])).rows[0];
    assert.equal(shipment?.status, 'delivered');
    assert.equal((shipment?.delivered_at as Date).toISOString(), '2026-06-04T10:30:00.000Z');
    // A late scan does not undo a delivery.
    tracking.TRK1.shipments[0].status = 'transit';
    tracking.TRK1.shipments[0].events.push({ date: '2026-06-04', time: '12:00:00', GMTOffset: '+01:00', typeCode: 'PL', description: 'Processed' });
    assert.equal(ok(await admin('POST', `/api/shipments/${shipmentId}/track`, {})).body.status, 'delivered');

    const seenByCustomer = ok(await call('localhost', 'GET', `/api/orders/${o.number}/tracking?token=${o.token}`)).body.shipments;
    assert.deepEqual(seenByCustomer.map((s: any) => [s.carrierName, s.status, s.events.length]), [['DHL Express', 'delivered', 4]]);
    assert.equal(seenByCustomer[0].events[seenByCustomer[0].events.length - 1].location, 'Benin City-NG');
    assert.equal((await call('localhost', 'GET', `/api/orders/${o.number}/tracking?token=wrong`)).status, 404);
    const visible = await db.query('select kind from order_events where order_id = $1 and visible_to_customer order by id', [o.id]);
    assert.deepEqual(visible.rows.map((r) => r.kind), ['shipment_in_transit', 'delivered']);
  });

  test('UPS and FedEx tracking are read the same way', async () => {
    const u = await paidOrder('ups', '65');
    const { shipmentId: upsShipment } = ok(await admin('POST', `/api/orders/${u.id}/label`, {}), 201).body;
    await db.query("update shipments set tracking_number = 'UPSTRK' where id = $1", [upsShipment]);
    tracking.UPSTRK = { trackResponse: { shipment: [{ package: [{ activity: [
      { date: '20260603', time: '091500', status: { type: 'I', description: 'Out For Delivery Today' }, location: { address: { city: 'London', countryCode: 'GB' } } },
      { date: '20260602', time: '101500', status: { type: 'I', description: 'Arrived at Facility' }, location: { address: { city: 'Stansted', countryCode: 'GB' } } },
    ] }] }] } };
    assert.deepEqual(ok(await admin('POST', `/api/shipments/${upsShipment}/track`, {})).body, { status: 'out_for_delivery', newEvents: 2 });

    const f = await paidOrder('fedex', 'INTERNATIONAL_PRIORITY');
    const { shipmentId: fedexShipment } = ok(await admin('POST', `/api/orders/${f.id}/label`, {}), 201).body;
    await db.query("update shipments set tracking_number = 'FDXTRK' where id = $1", [fedexShipment]);
    tracking.FDXTRK = { output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: 'DE', description: 'Delivery exception' }, scanEvents: [{ date: '2026-06-03T10:00:00+01:00', eventType: 'DE', derivedStatusCode: 'DE', eventDescription: 'Customer not available', scanLocation: { city: 'London', countryCode: 'GB' } }] }] }] } };
    assert.deepEqual(ok(await admin('POST', `/api/shipments/${fedexShipment}/track`, {})).body, { status: 'exception', newEvents: 1 });
    assert.equal((await db.query("select summary from order_events where order_id = $1 and kind = 'shipment_exception'", [f.id])).rows[0]?.summary, 'There is a delay with your delivery. The carrier is working on it; we will keep watching.');
  });

  test('local courier: staff record the dispatch and the arrival', async () => {
    const o = await paidOrder('local', '1', { ship_country: 'NG', ship_city: 'Ikeja', ship_line1: '5 Allen Avenue', ship_region: 'Lagos' });
    assert.equal((await admin('POST', `/api/orders/${o.id}/dispatch`, { courier: '' })).body.error.fields.courier, 'Enter the courier.');
    assert.equal((await admin('POST', `/api/orders/${o.id}/dispatch`, { courier: 'GIG', trackingUrl: 'javascript:alert(1)' })).status, 422);
    const sent = ok(await admin('POST', `/api/orders/${o.id}/dispatch`, { courier: 'GIG Logistics', trackingNumber: 'GIG-55' }), 201).body;
    assert.deepEqual(sent.shipments.map((s: any) => [s.carrierName, s.trackingNumber, s.status]), [['GIG Logistics', 'GIG-55', 'in_transit']]);
    assert.equal((await db.query('select status from orders where id = $1', [o.id])).rows[0]?.status, 'shipped');
    assert.equal((await admin('POST', `/api/shipments/${sent.shipmentId}/delivered`, {}, support)).status, 403);
    ok(await admin('POST', `/api/shipments/${sent.shipmentId}/delivered`, {}));
    assert.equal((await db.query('select status from orders where id = $1', [o.id])).rows[0]?.status, 'delivered');
  });

  test('payment confirmed: a carrier order is queued for its label, a local one is not', async () => {
    const carrierOrder = await paidOrder('dhl', 'P');
    const localOrder = await paidOrder('local', '1', { ship_country: 'NG', ship_city: 'Ikeja', ship_line1: '5 Allen Avenue', ship_region: 'Lagos' });
    await db.query("update orders set payment_status = 'awaiting', status = 'on_hold' where id = any($1::bigint[])", [[carrierOrder.id, localOrder.id]]);
    await markOrderPaid(db, carrierOrder.id, clock);
    await markOrderPaid(db, localOrder.id, clock);
    const jobs = await db.query("select payload, unique_key from jobs where kind = 'buy_label' order by id");
    assert.deepEqual(jobs.rows.map((r) => [r.payload.orderId, r.unique_key]), [[carrierOrder.id, `buy_label:${carrierOrder.id}`]]);
  });
});

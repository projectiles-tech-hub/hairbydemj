import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { hashToken, randomToken } from '../../accounts/crypto.js';
import { signUp, verifyEmail } from '../../accounts/customers.js';
import { accountDeps, type AccountDeps } from '../../accounts/deps.js';
import { memoryMailer } from '../../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../../accounts/oidc.js';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { migrate } from '../../db/migrate.js';
import { createPool, type Db } from '../../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../db/test-database.js';
import { createLogger } from '../../logger.js';
import { textToHtml } from './info.js';

test('page text becomes safe HTML: headings, questions, paragraphs', () => {
  const html = textToHtml('## Delivery\nWe send <fast>.\n\nQ: Do I pay duties?\nA: Yes, on delivery.');
  assert.equal(html, '<section class="stack stack--sm"><h2 class="h3">Delivery</h2><p class="muted">We send &lt;fast&gt;.</p></section><details class="acc"><summary>Do I pay duties?</summary><div class="acc__body"><p>Yes, on delivery.</p></div></details>');
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  text: string;
  body: Record<string, any>;
  headers: IncomingMessage['headers'];
}

describe('the live website', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  const clock = new Date('2026-06-01T09:00:00Z');
  const mail = memoryMailer();
  let ada = '';
  let adaId = 0;
  let wigVariant = 0;
  let wigId = 0;

  function call(method: string, path: string, body?: unknown, options: { cookie?: string; headers?: Record<string, string>; form?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: 'localhost', Origin: 'http://localhost', ...(options.headers ?? {}) };
    let payload: string | undefined;
    if (options.form !== undefined) {
      payload = options.form;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
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
            // HTML
          }
          resolve({ status: res.statusCode ?? 0, text, body: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const page = async (path: string, cookie?: string): Promise<Reply> => {
    const r = await call('GET', path, undefined, { cookie });
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

    await db.query("update currencies set rate_from_base = 0.000625 where code = 'USD'");
    const wigs = Number((await db.query("insert into categories (name, slug, description) values ('Wigs', 'wigs', 'Ready-to-wear human hair wigs.') returning id")).rows[0]?.id);
    await db.query("insert into categories (name, slug) values ('Bundles', 'bundles')");
    wigId = Number((await db.query("insert into products (name, slug, status, category_id, texture, description) values ('Bone straight wig', 'bone-straight-wig', 'published', $1, 'Straight', 'Silky from root to tip.') returning id", [wigs])).rows[0]?.id);
    for (const [sku, len, price, usd] of [['BSW-22', 22, 28_500_000, 18_000], ['BSW-12', 12, 18_500_000, 12_000]] as const) {
      const v = Number((await db.query('insert into variants (product_id, sku, weight_grams, length_inches, colour) values ($1, $2, 300, $3, $4) returning id', [wigId, sku, len, 'Natural black'])).rows[0]?.id);
      if (len === 22) wigVariant = v;
      await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', $2), ($1, 'USD', $3)", [v, price, usd]);
      await db.query('insert into inventory (variant_id, on_hand) values ($1, 6)', [v]);
    }
    const curly = Number((await db.query("insert into products (name, slug, status, category_id, texture) values ('Kinky curly wig', 'kinky-curly-wig', 'published', $1, 'Kinky curly') returning id", [wigs])).rows[0]?.id);
    const cv = Number((await db.query("insert into variants (product_id, sku, weight_grams, length_inches) values ($1, 'KC-16', 300, 16) returning id", [curly])).rows[0]?.id);
    await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', 30000000)", [cv]);
    await db.query('insert into inventory (variant_id, on_hand) values ($1, 2)', [cv]);
    await db.query("insert into products (name, slug, status, category_id) values ('Hidden draft', 'hidden-draft', 'draft', $1)", [wigs]);
    await db.query("insert into local_shipping_rates (zone_name, states, courier, price_minor, delivery_time) values ('Lagos', '{Lagos}', 'GIG Logistics', 350000, '1 to 2 working days')");

    await signUp(deps, { email: 'ada@example.com', password: 'longenough', firstName: 'Ada' }, { ip: null });
    const signed = await verifyEmail(deps, { email: 'ada@example.com', code: mail.last('verify_email', 'ada@example.com').data.code }, { ip: null });
    ada = `hbd_session=${signed.token}`;
    adaId = signed.customer.id;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('the home page shows real products, the menu from the categories, and safe headers', async () => {
    const r = await page('/');
    assert.equal(r.status, 200);
    assert.match(r.text, /Bone straight wig/);
    assert.match(r.text, /href="\/c\/wigs\/"/);
    assert.match(r.text, /From ₦185,000/);
    assert.match(String(r.headers['content-security-policy']), /default-src 'self'/);
    assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.match(r.text, /"@type":"Organization"/);
    assert.match(r.text, /<script type="module" src="\/js\/store.js">/);
    assert.ok(!r.text.includes('Hidden draft'));
  });

  test('a category lists its products, filters narrow it, and an unknown one is the shop\'s 404 page', async () => {
    const r = await page('/c/wigs/');
    assert.equal(r.status, 200);
    assert.match(r.text, /<h1 class="h1">Wigs<\/h1>/);
    assert.match(r.text, /Ready-to-wear human hair wigs\./);
    assert.match(r.text, /2 products/);
    assert.match(r.text, /<link rel="canonical" href="http:\/\/localhost:3000\/c\/wigs\/">/);
    const filtered = await page('/c/wigs/?texture=Straight');
    assert.match(filtered.text, /Bone straight wig/);
    assert.ok(!filtered.text.includes('Kinky curly wig</a>'));
    assert.match(filtered.text, /<meta name="robots" content="noindex">/, 'filtered lists are not indexed');
    const missing = await page('/c/nothing/');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /We could not find that page/);
    const unknown = await page('/no-such-page');
    assert.equal(unknown.status, 404);
    assert.match(unknown.text, /We could not find that page/);
  });

  test('more products load as HTML for the "Show more" button', async () => {
    const first = await page('/c/wigs/?sort=name');
    assert.ok(!first.text.includes('data-more='), 'two products fit on one page');
    const fragment = await call('GET', '/api/site/products?category=wigs&sort=name&limit=1');
    assert.equal(fragment.status, 200);
    assert.match(fragment.body.html, /product-card/);
  });

  test('a product page: variants, price, stock, structured data; drafts are not found', async () => {
    const r = await page('/products/bone-straight-wig/');
    assert.equal(r.status, 200);
    assert.match(r.text, /<h1 class="h1">Bone straight wig<\/h1>/);
    assert.match(r.text, /From ₦185,000/);
    assert.match(r.text, /name="lengthInches" value="22"/);
    const variants = JSON.parse(/<script type="application\/json" id="variants">([\s\S]*?)<\/script>/.exec(r.text)?.[1] ?? '[]');
    assert.deepEqual(variants.map((v: any) => [v.lengthInches, v.price, v.available]), [[22, '₦285,000', 6], [12, '₦185,000', 6]]);
    const ld = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1] ?? '{}'));
    const product = ld.find((x) => x['@type'] === 'Product');
    assert.deepEqual([product.offers.lowPrice, product.offers.highPrice, product.offers.priceCurrency, product.offers.availability], ['185000.00', '285000.00', 'NGN', 'https://schema.org/InStock']);
    assert.equal((await page('/products/hidden-draft/')).status, 404);
  });

  test('prices follow the chosen currency', async () => {
    const r = await page('/products/bone-straight-wig/', 'hbd_currency=USD');
    assert.match(r.text, /From \$120/);
    assert.match(r.text, /data-currency="USD"/);
  });

  test('search finds products, says what it corrected, and has a page for nothing found', async () => {
    const r = await page('/search/?q=bone+strait');
    assert.match(r.text, /1 result for &quot;bone straight&quot;/);
    assert.match(r.text, /Showing results for <strong>bone straight<\/strong>/);
    const none = await page('/search/?q=xyzzy');
    assert.match(none.text, /No results for &quot;xyzzy&quot;/);
    assert.match((await page('/search/')).text, /What are you looking for\?/);
  });

  test('the bag, the mini-bag and checkout use the visitor\'s real bag', async () => {
    const empty = await page('/cart/');
    assert.match(empty.text, /Your bag is empty/);
    const added = await call('POST', '/api/cart/items', { variantId: wigVariant, quantity: 2 });
    const cookie = String(added.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    const cart = await page('/cart/', cookie);
    assert.match(cart.text, /Your bag \(2\)/);
    assert.match(cart.text, /₦570,000/);
    assert.match(cart.text, /data-bag-count>2</);
    const mini = await call('GET', '/api/site/mini-cart', undefined, { cookie });
    assert.equal(mini.body.count, 2);
    assert.match(mini.body.html, /Bone straight wig/);
    const checkout = await page('/checkout/', cookie);
    assert.match(checkout.text, /data-checkout data-currency="NGN" data-provider="paystack"/);
    assert.match(checkout.text, /<option>Lagos<\/option>/);
    assert.ok(!checkout.text.includes('js.stripe.com/v3'), 'no Stripe for naira');
    await call('POST', '/api/cart/currency', { currency: 'USD' }, { cookie });
    const usd = await page('/checkout/', cookie);
    assert.match(usd.text, /<script src="https:\/\/js.stripe.com\/v3\/"><\/script>/);
    assert.match((await page('/checkout/complete/?order=HBD-10001')).text, /data-complete="HBD-10001"/);
  });

  test('account pages need signing in; a signed-in customer sees their own orders only', async () => {
    const redirect = await page('/account/orders/');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/sign-in/?next=%2Faccount%2Forders%2F');
    const overview = await page('/account/', ada);
    assert.match(overview.text, /Hello, Ada/);
    assert.match(overview.text, /No orders yet/);
    const token = randomToken();
    const mine = await db.query("insert into orders (customer_id, email, currency, subtotal_minor, shipping_minor, total_minor, payment_status, status, access_token_hash, ship_full_name, ship_line1, ship_city, ship_country) values ($1, 'ada@example.com', 'NGN', 100000, 0, 100000, 'paid', 'to_fulfil', $2, 'Ada Obi', '5 Allen Avenue', 'Ikeja', 'NG') returning number", [adaId, hashToken(token)]);
    const number = String(mine.rows[0]?.number);
    const theirs = await db.query("insert into orders (email, currency, subtotal_minor, total_minor) values ('eve@example.com', 'NGN', 100, 100) returning number");
    const list = await page('/account/orders/', ada);
    assert.match(list.text, new RegExp(number));
    const detail = await page(`/account/orders/${number.toLowerCase()}/`, ada);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /Being prepared/);
    assert.match(detail.text, /Invoice/);
    assert.equal((await page(`/account/orders/${String(theirs.rows[0]?.number).toLowerCase()}/`, ada)).status, 404);
    // A guest with the private link sees it too; a wrong link gets the form.
    const linked = await page(`/track-order/?order=${number}&token=${token}`);
    assert.match(linked.text, new RegExp(`<h1 class="h1">Order ${number}</h1>`));
    assert.match((await page(`/track-order/?order=${number}&token=wrong`)).text, /That link is not complete/);
    // And with the number and email.
    const found = await call('POST', '/track-order/', undefined, { form: `number=${number}&email=ada%40example.com` });
    assert.match(found.text, /Being prepared/);
    const wrong = await call('POST', '/track-order/', undefined, { form: `number=${number}&email=x%40example.com` });
    assert.match(wrong.text, /We could not find an order with that number and email/);
  });

  test('customers keep their details, addresses and wishlist; changing the password signs out other devices', async () => {
    const profile = await call('POST', '/api/account/profile', { firstName: 'Adaeze', lastName: 'Obi', phone: '+234 803 000 0000', birthday: '1995-04-12' }, { cookie: ada });
    assert.deepEqual([profile.body.profile.firstName, profile.body.profile.birthday], ['Adaeze', '1995-04-12']);
    assert.equal((await call('POST', '/api/account/profile', { firstName: '', birthday: '2030-01-01' }, { cookie: ada })).status, 422);

    const first = await call('POST', '/api/account/addresses', { name: 'Ada Obi', phone: '+2348030000000', line1: '5 Allen Avenue', city: 'Ikeja', region: 'lagos', country: 'NG' }, { cookie: ada });
    assert.deepEqual(first.body.addresses.map((a: any) => [a.region, a.isDefault]), [['Lagos', true]], 'the first address is the default');
    const second = await call('POST', '/api/account/addresses', { name: 'Ada Obi', phone: '+447700900000', line1: '10 Downing Street', city: 'London', postalCode: 'SW1A 2AA', country: 'GB', isDefault: true }, { cookie: ada });
    assert.deepEqual(second.body.addresses.map((a: any) => [a.city, a.isDefault]), [['London', true], ['Ikeja', false]]);
    const removed = await call('POST', `/api/account/addresses/${second.body.addresses[0].id}/delete`, {}, { cookie: ada });
    assert.deepEqual(removed.body.addresses.map((a: any) => [a.city, a.isDefault]), [['Ikeja', true]], 'removing the default makes another one the default');
    assert.match((await page('/account/addresses/', ada)).text, /5 Allen Avenue/);

    assert.equal((await call('POST', '/api/wishlist', { productId: wigId }, { cookie: ada })).status, 200);
    const wished = await call('GET', '/api/wishlist', undefined, { cookie: ada });
    assert.deepEqual(wished.body.items.map((i: any) => [i.name, i.priceFromMinor, i.inStock]), [['Bone straight wig', 18_500_000, true]]);
    assert.match((await page('/account/wishlist/', ada)).text, /Bone straight wig/);
    await call('POST', `/api/wishlist/${wigId}/delete`, {}, { cookie: ada });
    assert.equal((await call('GET', '/api/wishlist', undefined, { cookie: ada })).body.items.length, 0);

    // A second device, then a password change from the first.
    const other = await call('POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'longenough' });
    const otherCookie = String(other.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'wrong-one', newPassword: 'evenlongerpassword' }, { cookie: ada })).body.error.fields.currentPassword, 'That is not your current password.');
    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'longenough', newPassword: 'evenlongerpassword' }, { cookie: ada })).status, 200);
    assert.equal((await call('GET', '/api/account/profile', undefined, { cookie: otherCookie })).status, 401, 'the other device is signed out');
    assert.equal((await call('GET', '/api/account/profile', undefined, { cookie: ada })).status, 200, 'this device stays signed in');
    assert.equal(mail.last('password_changed', 'ada@example.com').to, 'ada@example.com');
  });

  test('closing an account removes the person and keeps their orders without them', async () => {
    await signUp(deps, { email: 'tobi@example.com', password: 'longenough' }, { ip: null });
    const tobi = await verifyEmail(deps, { email: 'tobi@example.com', code: mail.last('verify_email', 'tobi@example.com').data.code }, { ip: null });
    const cookie = `hbd_session=${tobi.token}`;
    await db.query("insert into orders (customer_id, email, currency, subtotal_minor, total_minor) values ($1, 'tobi@example.com', 'NGN', 100, 100)", [tobi.customer.id]);
    assert.equal((await call('POST', '/api/account/delete', { password: 'nope' }, { cookie })).status, 422);
    assert.equal((await call('POST', '/api/account/delete', { password: 'longenough' }, { cookie })).status, 200);
    const row = (await db.query('select status, email, first_name from customers where id = $1', [tobi.customer.id])).rows[0];
    assert.equal(row?.status, 'deleted');
    assert.match(String(row?.email), /^deleted-\d+@deleted\.invalid$/);
    assert.equal((await db.query("select count(*)::int as n from orders where email = 'tobi@example.com' and customer_id is null")).rows[0]?.n, 1);
    assert.equal((await call('GET', '/api/account/profile', undefined, { cookie })).status, 401);
    // The address can be used for a new account.
    assert.equal((await call('POST', '/api/auth/sign-up', { email: 'tobi@example.com', password: 'longenough' })).status < 300, true);
  });

  test('information pages show starting text until staff publish their own', async () => {
    const faq = await page('/faq/');
    assert.match(faq.text, /within 14 days of delivery/);
    assert.match(faq.text, /<details class="acc">/);
    await db.query("insert into content_pages (slug, title, body, status, published_at) values ('about', 'About hairbydemj', '## Who we are\nDemj and the team.', 'published', now())");
    const about = await page('/about/');
    assert.match(about.text, /<h1 class="h1">About hairbydemj<\/h1>/);
    assert.match(about.text, /Demj and the team\./);
    assert.match((await page('/guides/length-and-density/')).text, /Length and density guide/);
    for (const p of ['/contact/', '/shipping/', '/returns/', '/privacy/', '/terms/', '/cookies/', '/looks/', '/sign-in/', '/create-account/', '/forgot-password/', '/reset-password/?token=x', '/verify-email/?email=a%40b.c', '/track-order/']) {
      assert.equal((await page(p)).status, 200, p);
    }
  });

  test('the sitemap lists published products and pages; robots.txt points to it', async () => {
    const map = await page('/sitemap.xml');
    assert.match(String(map.headers['content-type']), /application\/xml/);
    assert.match(map.text, /<loc>http:\/\/localhost:3000\/products\/bone-straight-wig\/<\/loc><lastmod>/);
    assert.match(map.text, /<loc>http:\/\/localhost:3000\/c\/wigs\/<\/loc>/);
    assert.ok(!map.text.includes('hidden-draft'));
    const robots = await page('/robots.txt');
    assert.match(robots.text, /Sitemap: http:\/\/localhost:3000\/sitemap.xml/);
    assert.match(robots.text, /Disallow: \/checkout\//);
  });
});

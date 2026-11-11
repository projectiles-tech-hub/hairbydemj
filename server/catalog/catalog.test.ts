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
import { colourCode, convertPrice, slugify } from './manage.js';
import { describeRules, parseRules } from './rules.js';

test('names become tidy web addresses', () => {
  assert.equal(slugify('  Bone Straight Wig — 22" (HD)  '), 'bone-straight-wig-22-hd');
  assert.equal(slugify('Crème de la Crème'), 'creme-de-la-creme');
  assert.equal(slugify('!!!'), '');
});

test('colours become short SKU codes', () => {
  assert.equal(colourCode('Natural black'), 'NB');
  assert.equal(colourCode('1B/27'), '1B27');
  assert.equal(colourCode('613'), '613');
  assert.equal(colourCode('Burgundy'), 'BURGUNDY');
});

test('prices convert from naira with the rate, the markup and the rounding', () => {
  const usd = { code: 'USD', rate: 0.00065, markupBps: 0, rounding: 100 };
  assert.equal(convertPrice(28_500_000, usd), 18_500, '₦285,000 is $185.25, rounded to $185');
  assert.equal(convertPrice(28_500_000, { ...usd, markupBps: 500 }), 19_500, 'with 5% added');
  assert.equal(convertPrice(100, usd), 100, 'never rounds down to nothing');
  assert.throws(() => convertPrice(100, { ...usd, rate: null }), /no exchange rate for USD/);
});

test('collection rules are checked and described in plain words', () => {
  const rules = parseRules([{ field: 'date_added', condition: 'in_the_last_days', value: 30 }, { field: 'sales', condition: 'top', value: '20' }, { field: 'tag', condition: 'is', value: ' wig ' }]);
  assert.deepEqual(rules[2], { field: 'tag', condition: 'is', value: 'wig' });
  assert.equal(describeRules(rules), 'Rules: added in last 30 days, top 20 by sales, tag is wig');
  assert.throws(() => parseRules([{ field: 'price', condition: 'is', value: 1 }]), /Check the rules/);
  assert.throws(() => parseRules([{ field: 'sales', condition: 'top', value: 0 }]));
  assert.throws(() => parseRules('all'));
  assert.throws(() => parseRules([{ field: 'tag', condition: 'is', value: "x'; drop table products; --".repeat(5) }]), /Check the rules/);
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  body: Record<string, any>;
}

describe('the catalogue over HTTP', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const SITE = 'localhost';
  const ADMIN = 'admin.localhost';
  const API = 'api.localhost';
  let owner = '';
  let viewer = '';
  let support = '';

  function call(host: string, method: string, path: string, body?: unknown, options: { cookie?: string; origin?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: options.origin ?? `http://${host}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: Record<string, any>;
          try {
            parsed = JSON.parse(raw) as Record<string, any>;
          } catch {
            parsed = { raw };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const admin = (method: string, path: string, body?: unknown, cookie = owner): Promise<Reply> => call(ADMIN, method, path, method === 'POST' ? (body ?? {}) : undefined, { cookie });
  const shop = (path: string): Promise<Reply> => call(SITE, 'GET', `/api/catalog${path}`);
  const ok = (reply: Reply, status = 200): Reply => {
    assert.equal(reply.status, status, JSON.stringify(reply.body));
    return reply;
  };

  /** Make a published product with variants priced in naira and converted to the other currencies. */
  async function makeProduct(input: Record<string, unknown>, variants: { lengths: number[]; ngn: number; stock?: number; colours?: string[] }): Promise<Record<string, any>> {
    const created = ok(await admin('POST', '/api/products', input), 201).body.product;
    const generated = ok(
      await admin('POST', `/api/products/${created.id}/variants/generate`, { lengths: variants.lengths, densities: [180], colours: variants.colours ?? ['Natural black'], skuPrefix: String(input.name).slice(0, 4), weightGrams: 300, prices: { NGN: variants.ngn }, autoConvert: true }),
      201,
    ).body.product;
    if (variants.stock) for (const v of generated.variants) ok(await admin('POST', `/api/inventory/${v.id}/adjust`, { mode: 'add', quantity: variants.stock, reason: 'received' }));
    tick(60); // so "newest first" has a clear order
    return ok(await admin('POST', `/api/products/${created.id}`, { status: 'published' })).body.product;
  }

  const ids: Record<string, number> = {};
  const products: Record<string, Record<string, any>> = {};

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 5 });
    await migrate(db, 'db/migrations');
    await db.query("update currencies set rate_from_base = case code when 'USD' then 0.00065 when 'GBP' then 0.00051 when 'EUR' then 0.0006 end where not is_base");
    const config = loadConfig({});
    deps = accountDeps({
      db,
      config,
      mail: memoryMailer(),
      now: () => clock,
      passwordParams: { N: 1024, r: 8, p: 1 },
      identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
    });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const role = async (name: string, areas: Record<string, [boolean, boolean]>): Promise<number> => {
      const id = Number((await db.query('insert into roles (name) values ($1) returning id', [name])).rows[0]?.id);
      for (const [area, [view, change]] of Object.entries(areas)) await db.query('insert into role_permissions (role_id, area, can_view, can_change) values ($1, $2, $3, $4)', [id, area, view, change]);
      return id;
    };
    viewer = (await signedInStaff(deps, tick, { name: 'Viewer', email: 'viewer@hairbydemj.test', roleId: await role('Fulfilment', { orders: [true, true], products: [true, false] }) })).cookie;
    support = (await signedInStaff(deps, tick, { name: 'Support', email: 'support@hairbydemj.test', roleId: await role('Support', { customers: [true, true] }) })).cookie;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('staff build the categories', async () => {
    ids.wigs = ok(await admin('POST', '/api/categories', { name: 'Wigs', position: 0 }), 201).body.id;
    ids.laceFront = ok(await admin('POST', '/api/categories', { name: 'Lace front wigs', parentId: ids.wigs }), 201).body.id;
    ids.bundles = ok(await admin('POST', '/api/categories', { name: 'Bundles', position: 1 }), 201).body.id;
    ids.hidden = ok(await admin('POST', '/api/categories', { name: 'Staff picks', showInMenu: false }), 201).body.id;
    const again = ok(await admin('POST', '/api/categories', { name: 'Wigs', parentId: ids.bundles }), 201).body.id;
    const list = ok(await admin('GET', '/api/categories')).body.categories as Array<Record<string, any>>;
    assert.equal(list.find((c) => c.id === again)?.slug, 'wigs-2', 'a second "Wigs" gets its own address');
    // A category cannot be put inside itself or its own sub-category.
    assert.equal((await admin('POST', `/api/categories/${ids.wigs}`, { parentId: ids.laceFront })).body.error.fields.parentId, 'A category cannot be placed inside itself.');
    assert.equal((await admin('POST', `/api/categories/${ids.wigs}`, { parentId: ids.wigs })).status, 422);
    assert.equal((await admin('POST', '/api/categories', { name: '' })).body.error.fields.name, 'Enter the category name.');
    ok(await admin('POST', `/api/categories/${again}/delete`));
  });

  test('a product is a draft until published, and its variants are generated with prices in every currency', async () => {
    const created = ok(await admin('POST', '/api/products', { name: 'Bone Straight Wig', categoryId: ids.laceFront, origin: 'Vietnamese', texture: 'Straight', grade: 'Double drawn', tags: 'Wig, straight, wig', description: 'Sleek and pin-straight.' }), 201).body.product;
    assert.equal(created.slug, 'bone-straight-wig');
    assert.equal(created.status, 'draft');
    assert.deepEqual(created.tags, ['wig', 'straight']);
    assert.equal((await shop('/products/bone-straight-wig')).status, 404, 'a draft is not in the shop');

    const generated = ok(
      await admin('POST', `/api/products/${created.id}/variants/generate`, { lengths: '18, 22"', densities: '180%', colours: ['Natural black', '613'], skuPrefix: 'wig-bs', laceType: 'HD lace', weightGrams: 320, prices: { NGN: 28_500_000 }, autoConvert: true }),
      201,
    ).body;
    assert.equal(generated.created, 4);
    assert.deepEqual(generated.product.variants.map((v: Record<string, any>) => v.sku), ['WIGBS-18-180-NB', 'WIGBS-18-180-613', 'WIGBS-22-180-NB', 'WIGBS-22-180-613']);
    const first = generated.product.variants[0];
    assert.deepEqual(first.prices, { NGN: { amountMinor: 28_500_000, isConverted: false }, USD: { amountMinor: 18_500, isConverted: true }, GBP: { amountMinor: 14_500, isConverted: true }, EUR: { amountMinor: 17_100, isConverted: true } });
    // Generating again makes nothing new.
    const repeat = ok(await admin('POST', `/api/products/${created.id}/variants/generate`, { lengths: [18, 22, 26], densities: [180], colours: ['Natural black', '613'], skuPrefix: 'WIGBS', laceType: 'HD lace', weightGrams: 320, prices: { NGN: 31_000_000 }, autoConvert: true }), 201).body;
    assert.deepEqual([repeat.created, repeat.skipped], [2, 4]);

    // Staff type the dollar price for one variant; it is kept, not overwritten by conversion.
    const edited = ok(await admin('POST', `/api/variants/${first.id}`, { prices: { NGN: 30_000_000, USD: 19_900 }, autoConvert: true })).body.product.variants[0];
    assert.deepEqual(edited.prices.USD, { amountMinor: 19_900, isConverted: false });
    assert.deepEqual(edited.prices.GBP, { amountMinor: 15_300, isConverted: true });

    assert.equal((await admin('POST', `/api/products/${created.id}/variants`, { sku: 'wigbs-18-180-nb', weightGrams: 300, lengthInches: 30 })).body.error.fields.sku, 'Another variant already uses this SKU.');
    assert.equal((await admin('POST', `/api/products/${created.id}/variants`, { sku: 'NEW-1', weightGrams: 300, lengthInches: 18, densityPercent: 180, colour: '613', laceType: 'HD lace' })).body.error.code, 'duplicate_variant');
    assert.equal((await admin('POST', `/api/products/${created.id}/variants`, { sku: 'NEW-1', lengthInches: 30 })).body.error.fields.weightGrams, 'Weight in grams must be a whole number from 1 to 50000.');
    assert.equal((await admin('POST', `/api/variants/${first.id}`, { prices: { NGN: 10.5 } })).status, 422, 'money is whole minor units');
    assert.equal((await admin('POST', `/api/variants/${first.id}`, { prices: { JPY: 100 } })).body.error.fields.prices, 'JPY is not a currency we sell in.');

    ok(await admin('POST', `/api/inventory/${first.id}/adjust`, { mode: 'add', quantity: 12, reason: 'received' }));
    products.bone = ok(await admin('POST', `/api/products/${created.id}`, { status: 'published' })).body.product;
    const page = ok(await shop('/products/bone-straight-wig?currency=USD')).body.product;
    assert.equal(page.variants.length, 6);
    assert.equal(page.variants[0].priceMinor, 19_900);
    assert.deepEqual([page.origin, page.texture, page.grade, page.category.slug], ['Vietnamese', 'Straight', 'Double drawn', 'lace-front-wigs']);
    assert.equal(page.variants[0].available, 10, 'the shop never shows more than 10 in stock');
    assert.equal(page.variants[0].onHand, undefined, 'exact stock is for staff only');
    ids.boneFirstVariant = first.id;
    tick(60);
  });

  test('more products for the shop', async () => {
    products.deep = await makeProduct({ name: 'Deep wave frontal wig', categoryId: ids.laceFront, origin: 'Cambodian', texture: 'Deep wave', tags: ['wig'] }, { lengths: [18, 26], ngn: 32_000_000, stock: 2 });
    products.body = await makeProduct({ name: 'Body wave bundles', categoryId: ids.bundles, origin: 'Vietnamese', texture: 'Body wave', tags: ['bundles'] }, { lengths: [14, 18], ngn: 12_000_000, stock: 5 });
    products.kinky = await makeProduct({ name: 'Kinky curly bundles', categoryId: ids.bundles, origin: 'Peruvian', texture: 'Kinky curly', tags: ['bundles'] }, { lengths: [22], ngn: 15_000_000 });
    products.bonnet = await makeProduct({ name: 'Silk bonnet', categoryId: ids.hidden, tags: ['accessory'] }, { lengths: [], colours: ['Black'], ngn: 1_850_000, stock: 40 });
    const list = ok(await admin('GET', '/api/products?per_page=2')).body;
    assert.deepEqual([list.total, list.products.length, list.page], [5, 2, 1]);
    assert.equal(list.products[0].name, 'Silk bonnet');
    assert.deepEqual([list.products[0].stock, list.products[0].variants, list.products[0].priceFromMinor], [40, 1, 1_850_000]);
    assert.equal(ok(await admin('GET', '/api/products?q=wigbs-22')).body.total, 1, 'found by SKU');
    assert.equal(ok(await admin('GET', '/api/products?stock=out')).body.products[0].name, 'Kinky curly bundles');
    assert.equal(ok(await admin('GET', `/api/products?category_id=${ids.bundles}&texture=body%20wave`)).body.total, 1);
  });

  test('the shop lists products with prices in the chosen currency', async () => {
    const all = ok(await shop('/products')).body;
    assert.equal(all.total, 5);
    assert.deepEqual(all.products.map((p: Record<string, any>) => p.name), ['Silk bonnet', 'Kinky curly bundles', 'Body wave bundles', 'Deep wave frontal wig', 'Bone Straight Wig'], 'newest first');
    const bone = all.products[4];
    assert.deepEqual([bone.currency, bone.priceFromMinor, bone.priceToMinor], ['NGN', 28_500_000, 31_000_000]);
    assert.deepEqual(bone.lengths, [18, 22, 26]);
    assert.deepEqual([bone.inStock, all.products[1].inStock], [true, false]);
    const gbp = ok(await shop('/products?currency=gbp&sort=price_low')).body.products;
    assert.deepEqual(gbp.map((p: Record<string, any>) => p.priceFromMinor), [900, 6_100, 7_700, 14_500, 16_300]);
    assert.equal((await shop('/products?currency=JPY')).body.error.fields.currency, 'Choose a currency we sell in.');
    // The phone app reads the same list from its own address.
    assert.equal(ok(await call(API, 'GET', '/v1/catalog/products')).body.total, 5);
  });

  test('filters narrow the list, and filters on a variant must all hold for the same variant', async () => {
    const names = async (query: string): Promise<string[]> => ok(await shop(`/products?sort=name&${query}`)).body.products.map((p: Record<string, any>) => p.name);
    assert.deepEqual(await names('category=wigs'), ['Bone Straight Wig', 'Deep wave frontal wig'], 'a category includes its sub-categories');
    assert.deepEqual(await names('category=bundles&texture=Kinky%20curly'), ['Kinky curly bundles']);
    assert.deepEqual(await names('origin=vietnamese,Peruvian'), ['Body wave bundles', 'Bone Straight Wig', 'Kinky curly bundles']);
    assert.deepEqual(await names('length=26'), ['Bone Straight Wig', 'Deep wave frontal wig']);
    assert.deepEqual(await names('length=14&colour=613'), [], 'no single variant is both 14 inches and 613');
    assert.deepEqual(await names('colour=613'), ['Bone Straight Wig']);
    assert.deepEqual(await names('max_price=12000000'), ['Body wave bundles', 'Silk bonnet']);
    assert.deepEqual(await names('currency=USD&min_price=10000&max_price=20000'), ['Bone Straight Wig']);
    assert.deepEqual(await names('in_stock=1'), ['Body wave bundles', 'Bone Straight Wig', 'Deep wave frontal wig', 'Silk bonnet']);
    assert.deepEqual(await names('in_stock=1&length=26'), ['Deep wave frontal wig'], 'the 26-inch Bone Straight has no stock');
    assert.equal((await shop('/products?length=abc')).status, 422);
    assert.equal((await shop('/products?sort=random')).status, 422);
    assert.equal((await shop("/products?category=x'%20or%201=1--")).body.total, 0, 'odd input is just a category that does not exist');

    const filters = ok(await shop('/filters?category=wigs')).body;
    assert.deepEqual(filters.textures, ['Deep wave', 'Straight']);
    assert.deepEqual(filters.lengths, [18, 22, 26]);
    assert.deepEqual(filters.colours, ['613', 'Natural black']);
    assert.deepEqual([filters.minPriceMinor, filters.maxPriceMinor], [28_500_000, 32_000_000]);
  });

  test('endless scrolling: each page continues exactly where the last one stopped', async () => {
    for (const sort of ['newest', 'price_low', 'price_high', 'name', 'best_selling']) {
      const seen: string[] = [];
      let cursor: string | null = '';
      let pages = 0;
      while (cursor !== null) {
        const page: Record<string, any> = ok(await shop(`/products?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`)).body;
        assert.equal(page.total === undefined, pages > 0, 'the total comes with the first page only');
        seen.push(...page.products.map((p: Record<string, any>) => p.slug));
        cursor = page.nextCursor;
        pages++;
        assert.ok(pages < 10);
      }
      assert.equal(pages, 3, sort);
      assert.equal(new Set(seen).size, 5, `${sort}: every product once, none twice`);
    }
    assert.equal((await shop('/products?cursor=nonsense')).status, 422);
    assert.equal((await shop('/products?limit=500')).status, 422);
  });

  test('a new product added while someone scrolls does not shuffle their list', async () => {
    const first = ok(await shop('/products?limit=3')).body;
    products.late = await makeProduct({ name: 'Late arrival', categoryId: ids.bundles }, { lengths: [10], ngn: 5_000_000 });
    const second = ok(await shop(`/products?limit=3&cursor=${first.nextCursor}`)).body;
    const slugs = [...first.products, ...second.products].map((p: Record<string, any>) => p.slug);
    assert.equal(new Set(slugs).size, 5);
    assert.ok(!slugs.includes('late-arrival'));
    ok(await admin('POST', `/api/products/${products.late?.id}/delete`));
  });

  test('the category menu is a tree with counts; hidden categories are left out', async () => {
    const tree = ok(await shop('/categories')).body.categories;
    assert.deepEqual(tree.map((c: Record<string, any>) => [c.slug, c.productCount, c.children.map((k: Record<string, any>) => [k.slug, k.productCount])]), [
      ['wigs', 2, [['lace-front-wigs', 2]]],
      ['bundles', 2, []],
    ]);
  });

  test('scheduled products appear at their time; unpublished ones leave the shop', async () => {
    const draft = ok(await admin('POST', '/api/products', { name: 'Coming soon wig', categoryId: ids.wigs }), 201).body.product;
    ok(await admin('POST', `/api/products/${draft.id}/variants`, { sku: 'SOON-1', weightGrams: 300, prices: { NGN: 20_000_000 }, autoConvert: true }), 201);
    assert.equal((await admin('POST', `/api/products/${draft.id}`, { status: 'scheduled' })).body.error.fields.publishAt, 'Choose the date and time to publish.');
    ok(await admin('POST', `/api/products/${draft.id}`, { status: 'scheduled', publishAt: new Date(clock.getTime() + 3_600_000).toISOString() }));
    assert.equal((await shop('/products/coming-soon-wig')).status, 404);
    tick(3_601);
    assert.equal(ok(await shop('/products/coming-soon-wig')).body.product.name, 'Coming soon wig');
    ok(await admin('POST', `/api/products/${draft.id}`, { status: 'unpublished' }));
    assert.equal((await shop('/products/coming-soon-wig')).status, 404);
    assert.equal(ok(await shop('/products')).body.total, 5);
    // A product with no price in a currency is not offered in that currency.
    ok(await admin('POST', `/api/products/${draft.id}`, { status: 'published' }));
    const v = ok(await admin('GET', `/api/products/${draft.id}`)).body.product.variants[0];
    ok(await admin('POST', `/api/variants/${v.id}`, { prices: { EUR: null } }));
    assert.equal((await shop('/products/coming-soon-wig?currency=EUR')).status, 404);
    assert.equal(ok(await shop('/products?currency=EUR')).body.total, 5);
    assert.equal(ok(await shop('/products?currency=USD')).body.total, 6);
    // A switched-off variant is not sold.
    ok(await admin('POST', `/api/variants/${v.id}`, { isActive: false }));
    assert.equal((await shop('/products/coming-soon-wig')).status, 404);
    ok(await admin('POST', `/api/products/${draft.id}/delete`));
  });

  test('stock: add, remove and set, each with a reason and a record', async () => {
    const variant = ids.boneFirstVariant;
    assert.deepEqual(ok(await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'remove', quantity: 2, reason: 'damaged', note: 'Torn lace' })).body, { onHand: 10, reserved: 0, available: 10 });
    assert.deepEqual(ok(await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'set', quantity: 3, reason: 'correction' })).body, { onHand: 3, reserved: 0, available: 3 });
    assert.equal((await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'remove', quantity: 4, reason: 'damaged' })).body.error.fields.quantity, 'There are only 3 on hand.');
    assert.equal((await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'set', quantity: 3, reason: 'correction' })).body.error.fields.quantity, 'Stock is already 3.');
    assert.equal((await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'add', quantity: 1 })).body.error.fields.reason, 'Choose a reason.');
    assert.equal((await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'add', quantity: 1.5, reason: 'received' })).status, 422);
    // Stock held for orders cannot be removed.
    await db.query('update inventory set reserved = 2 where variant_id = $1', [variant]);
    assert.equal((await admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'set', quantity: 1, reason: 'correction' })).body.error.fields.quantity, '2 are held for orders, so stock cannot go below that.');
    const moves = await db.query('select change, on_hand_after, reason, note from stock_movements where variant_id = $1 order by id', [variant]);
    assert.deepEqual(moves.rows, [
      { change: 12, on_hand_after: 12, reason: 'received', note: null },
      { change: -2, on_hand_after: 10, reason: 'damaged', note: 'Torn lace' },
      { change: -7, on_hand_after: 3, reason: 'correction', note: null },
    ]);
    const page = ok(await shop('/products/bone-straight-wig')).body.product.variants[0];
    assert.deepEqual([page.available, page.lowStock], [1, true], '3 on hand, 2 held: 1 to sell, and that is low');

    const low = ok(await admin('GET', '/api/inventory?low=1&per_page=100')).body;
    const row = low.rows.find((r: Record<string, any>) => r.variantId === variant);
    assert.deepEqual([row.product, row.variant, row.sku, row.onHand, row.reserved, row.available, row.isLow, row.lastChange.reason], ['Bone Straight Wig', '18" · 180% · Natural black', 'WIGBS-18-180-NB', 3, 2, 1, true, 'correction']);
    assert.ok(!low.rows.some((r: Record<string, any>) => r.product === 'Silk bonnet'), 'well-stocked variants are not in the low list');
    assert.equal(ok(await admin('GET', '/api/inventory?q=bonnet')).body.total, 1);
    await db.query('update inventory set reserved = 0 where variant_id = $1', [variant]);
  });

  test('two stock changes at the same moment are both counted', async () => {
    const variant = products.bonnet?.variants[0].id;
    await Promise.all(Array.from({ length: 8 }, () => admin('POST', `/api/inventory/${variant}/adjust`, { mode: 'add', quantity: 5, reason: 'received' })));
    assert.equal((await db.query('select on_hand from inventory where variant_id = $1', [variant])).rows[0]?.on_hand, 80);
  });

  test('collections: hand-picked, and filled by rules', async () => {
    const manual = ok(await admin('POST', '/api/collections', { name: 'Editor picks', status: 'live', items: [{ productId: products.kinky?.id }, { productId: products.bone?.id }] }), 201).body.collection;
    assert.deepEqual([manual.type, manual.products, manual.slug], ['Hand-picked', 2, 'editor-picks']);
    assert.deepEqual(ok(await shop('/products?collection=editor-picks&sort=name')).body.products.map((p: Record<string, any>) => p.name), ['Bone Straight Wig', 'Kinky curly bundles']);

    const fresh = ok(await admin('POST', '/api/collections', { name: 'New arrivals', kind: 'rules', status: 'live', rules: [{ field: 'date_added', condition: 'in_the_last_days', value: 30 }, { field: 'tag', condition: 'is', value: 'bundles' }] }), 201).body.collection;
    assert.deepEqual([fresh.type, fresh.products], ['Rules: added in last 30 days, tag is bundles', 2]);
    assert.equal(ok(await shop('/products?collection=new-arrivals')).body.total, 2);
    await db.query("update products set created_at = created_at - interval '31 days'");
    assert.equal(ok(await shop('/products?collection=new-arrivals')).body.total, 0, 'after 30 days they are no longer new');
    assert.equal(ok(await shop('/products')).body.products[0].isNew, false);

    // Best-sellers counts what was sold in paid orders.
    const order = async (productId: number, quantity: number, paid: boolean): Promise<void> => {
      const o = await db.query("insert into orders (email, currency, subtotal_minor, total_minor, payment_status) values ('a@example.com', 'NGN', 1000, 1000, $1) returning id", [paid ? 'paid' : 'awaiting']);
      await db.query("insert into order_items (order_id, product_id, variant_id, product_name, quantity, unit_price_minor, total_minor) values ($1, $2, (select id from variants where product_id = $2 limit 1), 'x', $3, 10, $3 * 10)", [o.rows[0]?.id, productId, quantity]);
    };
    await order(products.body?.id, 5, true);
    await order(products.deep?.id, 3, true);
    await order(products.kinky?.id, 50, false);
    const best = ok(await admin('POST', '/api/collections', { name: 'Best-sellers', kind: 'rules', status: 'live', rules: [{ field: 'sales', condition: 'top', value: 2 }] }), 201).body.collection;
    assert.equal(best.type, 'Rules: top 2 by sales');
    assert.deepEqual(ok(await shop('/products?collection=best-sellers&sort=best_selling')).body.products.map((p: Record<string, any>) => p.name), ['Body wave bundles', 'Deep wave frontal wig'], 'unpaid orders do not count');

    assert.equal((await admin('POST', '/api/collections', { name: 'Bad', kind: 'rules', rules: [{ field: 'nope' }] })).body.error.fields.rules, 'Rule 1 is not one we know.');
    assert.equal((await admin('POST', `/api/collections/${best.id}`, { items: [{ productId: products.bone?.id }] })).body.error.fields.items, 'A rule-based collection fills itself; products cannot be added by hand.');
    assert.equal((await admin('POST', `/api/products/${products.bone?.id}`, { collectionIds: [best.id] })).status, 422);
    ok(await admin('POST', '/api/collections', { name: 'Not ready', items: [{ productId: products.bone?.id }] }), 201);
    assert.equal((await shop('/products?collection=not-ready')).status, 404, 'a draft collection is not in the shop');
    assert.deepEqual(ok(await shop('/collections')).body.collections.map((c: Record<string, any>) => c.slug), ['best-sellers', 'editor-picks', 'new-arrivals']);
    // From the product editor: put a product in a hand-picked collection.
    const withCollection = ok(await admin('POST', `/api/products/${products.body?.id}`, { collectionIds: [manual.id] })).body.product;
    assert.deepEqual(withCollection.collectionIds, [manual.id]);
    assert.equal(ok(await admin('GET', `/api/collections/${manual.id}`)).body.collection.items.length, 3);
    ids.manual = manual.id;
  });

  test('a shop-the-look set names the exact pieces, their total, and whether all can be bought', async () => {
    const bone22 = products.bone?.variants.find((v: Record<string, any>) => v.sku === 'WIGBS-22-180-NB');
    const look = ok(
      await admin('POST', '/api/collections', { name: 'Soft glam', isLook: true, status: 'live', description: 'Sleek and simple.', items: [{ productId: products.bone?.id, variantId: bone22.id }, { productId: products.bonnet?.id }] }),
      201,
    ).body.collection;
    assert.deepEqual([look.isLook, look.kind, look.products], [true, 'manual', 2]);
    assert.equal((await admin('POST', '/api/collections', { name: 'Bad look', isLook: true, kind: 'rules' })).body.error.fields.kind, 'A shop-the-look set is always hand-picked.');
    assert.equal((await admin('POST', '/api/collections', { name: 'Bad look', isLook: true, items: [{ productId: products.bonnet?.id, variantId: bone22.id }] })).body.error.fields.items, 'A chosen variant does not belong to its product.');

    assert.deepEqual(ok(await shop('/collections?looks=1')).body.collections.map((c: Record<string, any>) => c.slug), ['soft-glam']);
    const shown = ok(await shop('/looks/soft-glam?currency=USD')).body.look;
    assert.deepEqual(shown.items.map((i: Record<string, any>) => [i.product.name, i.variantId, i.description, i.priceMinor, i.available]), [
      ['Bone Straight Wig', bone22.id, '22" · 180% · Natural black', 18_500, false],
      ['Silk bonnet', products.bonnet?.variants[0].id, '180% · Black', 1_200, true],
    ]);
    assert.deepEqual([shown.totalMinor, shown.allAvailable], [19_700, false]);
    ok(await admin('POST', `/api/inventory/${bone22.id}/adjust`, { mode: 'add', quantity: 4, reason: 'received' }));
    assert.equal(ok(await shop('/looks/soft-glam')).body.look.allAvailable, true);
    assert.equal((await shop('/looks/editor-picks')).status, 404, 'an ordinary collection is not a look');
  });

  test('deleting: never-ordered things go; ordered ones are kept for the order history', async () => {
    // Kinky curly has an (unpaid) order, Body wave a paid one: both stay, unpublished.
    assert.deepEqual(ok(await admin('POST', `/api/products/${products.kinky?.id}/delete`)).body, { deleted: false });
    assert.equal(ok(await admin('GET', `/api/products/${products.kinky?.id}`)).body.product.status, 'unpublished');
    assert.equal((await shop('/products/kinky-curly-bundles')).status, 404);
    const orderedVariant = Number((await db.query('select variant_id from order_items where product_id = $1', [products.body?.id])).rows[0]?.variant_id);
    assert.deepEqual(ok(await admin('POST', `/api/variants/${orderedVariant}/delete`)).body, { deleted: false });
    assert.equal(ok(await admin('GET', `/api/products/${products.body?.id}`)).body.product.variants.find((v: Record<string, any>) => v.id === orderedVariant).isActive, false);
    const spare = products.bone?.variants.find((v: Record<string, any>) => v.sku === 'WIGBS-26-180-613');
    assert.deepEqual(ok(await admin('POST', `/api/variants/${spare.id}/delete`)).body, { deleted: true });
    assert.equal((await admin('POST', `/api/variants/${spare.id}/delete`)).status, 404);
    assert.equal((await admin('POST', `/api/categories/${ids.bundles}/delete`)).body.error.code, 'in_use');
    ok(await admin('POST', `/api/collections/${ids.manual}/delete`));
    assert.equal((await shop('/products?collection=editor-picks')).status, 404);
    assert.equal((await admin('GET', '/api/products/999999')).status, 404);
  });

  test('only staff whose role allows it can read or change the catalogue', async () => {
    assert.equal(ok(await admin('GET', '/api/products', undefined, viewer)).body.total, 5, '"view" can read');
    assert.equal(ok(await admin('GET', '/api/inventory', undefined, viewer)).status, 200);
    for (const [path, body] of [
      ['/api/products', { name: 'X' }],
      [`/api/products/${products.bone?.id}`, { name: 'Renamed' }],
      [`/api/products/${products.bone?.id}/delete`, {}],
      [`/api/products/${products.bone?.id}/variants/generate`, { lengths: [30], weightGrams: 1 }],
      [`/api/variants/${ids.boneFirstVariant}`, { prices: { NGN: 1 } }],
      [`/api/inventory/${ids.boneFirstVariant}/adjust`, { mode: 'add', quantity: 100, reason: 'received' }],
      ['/api/categories', { name: 'X' }],
      ['/api/collections', { name: 'X' }],
    ] as Array<[string, unknown]>) {
      assert.equal((await admin('POST', path, body, viewer)).status, 403, `"view" cannot change ${path}`);
      assert.equal((await admin('POST', path, body, support)).status, 403);
      assert.equal((await call(ADMIN, 'POST', path, body)).status, 401, `signed out: ${path}`);
      assert.equal((await call(ADMIN, 'POST', path, body, { cookie: owner, origin: 'https://evil.example' })).status, 403, `from another site: ${path}`);
    }
    for (const path of ['/api/products', `/api/products/${products.bone?.id}`, '/api/inventory', '/api/categories', '/api/collections']) {
      assert.equal((await admin('GET', path, undefined, support)).status, 403, `no "products" permission: ${path}`);
      assert.equal((await call(ADMIN, 'GET', path)).status, 401);
    }
    assert.equal(ok(await admin('GET', `/api/products/${products.bone?.id}`)).body.product.name, 'Bone Straight Wig', 'nothing was changed');
    // The shop addresses cannot change anything, and the admin ones do not exist on the shop's address.
    assert.equal((await call(SITE, 'POST', '/api/catalog/products', { name: 'X' })).status, 405);
    assert.equal((await call(SITE, 'POST', '/api/products', { name: 'X' }, { cookie: owner })).status, 404);
  });

  test('what staff changed is in the activity log', async () => {
    const log = await db.query("select staff_name || ': ' || summary as line, area from activity_log where area in ('Products', 'Inventory', 'Categories and collections') order by id");
    const lines = log.rows.map((r) => String(r.line));
    for (const expected of [
      'Emmanuel: Created the category Wigs',
      'Emmanuel: Created the product "Bone Straight Wig"',
      'Emmanuel: Generated 4 variants for "Bone Straight Wig"',
      'Emmanuel: Price of "Bone Straight Wig" WIGBS-18-180-NB changed: EUR 171.00 to 180.00; GBP 145.00 to 153.00; NGN 285,000.00 to 300,000.00; USD 185.00 to 199.00',
      'Emmanuel: Changed "Bone Straight Wig" from draft to published',
      'Emmanuel: Stock of "Bone Straight Wig" WIGBS-18-180-NB changed from 12 to 10: damaged',
      'Emmanuel: Created the collection New arrivals',
      'Emmanuel: Created the look Soft glam',
      'Emmanuel: Unpublished "Kinky curly bundles" (it has orders, so it was not deleted)',
      'Emmanuel: Deleted the variant WIGBS-26-180-613 of "Bone Straight Wig"',
    ]) {
      assert.ok(lines.includes(expected), `activity log has: ${expected}\n${lines.join('\n')}`);
    }
    assert.ok(!lines.some((l) => l.startsWith('Viewer') || l.startsWith('Support')), 'refused requests changed nothing');
  });
});

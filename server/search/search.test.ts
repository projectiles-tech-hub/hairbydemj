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
import { parseSearch } from './search.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

describe('product search', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  let owner = '';
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };

  function get(path: string, host = 'localhost', cookie?: string): Promise<{ status: number; body: Record<string, any> }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, any> }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  const names = async (q: string, extra = ''): Promise<string[]> => {
    const r = await get(`/api/catalog/products?q=${encodeURIComponent(q)}${extra}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.products.map((p: any) => p.name);
  };
  const search = async (q: string): Promise<Record<string, any>> => (await get(`/api/catalog/products?q=${encodeURIComponent(q)}`)).body;

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 6 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({});
    deps = accountDeps({ db, config, mail: memoryMailer(), now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;

    const wigs = Number((await db.query("insert into categories (name, slug) values ('Wigs', 'wigs') returning id")).rows[0]?.id);
    const bundles = Number((await db.query("insert into categories (name, slug) values ('Bundles', 'bundles') returning id")).rows[0]?.id);
    const product = async (name: string, slug: string, category: number, texture: string, extra: { tags?: string[]; status?: string; description?: string } = {}, variants: Array<{ sku: string; length: number; colour: string; price: number }> = []): Promise<number> => {
      const p = Number((await db.query('insert into products (name, slug, status, category_id, texture, hair_origin, description, tags) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [name, slug, extra.status ?? 'published', category, texture, 'Vietnamese', extra.description ?? '', extra.tags ?? []])).rows[0]?.id);
      for (const v of variants) {
        const id = Number((await db.query('insert into variants (product_id, sku, weight_grams, length_inches, colour) values ($1, $2, 300, $3, $4) returning id', [p, v.sku, v.length, v.colour])).rows[0]?.id);
        await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', $2)", [id, v.price]);
        await db.query('insert into inventory (variant_id, on_hand) values ($1, 5)', [id]);
      }
      return p;
    };
    await product('Bone straight wig', 'bone-straight-wig', wigs, 'Straight', { description: 'Silky and full from root to tip.' }, [{ sku: 'BSW-22-NB', length: 22, colour: 'Natural black', price: 28_500_000 }, { sku: 'BSW-12-NB', length: 12, colour: 'Natural black', price: 18_500_000 }]);
    await product('Body wave bundle', 'body-wave-bundle', bundles, 'Body wave', {}, [{ sku: 'BWB-18-NB', length: 18, colour: 'Natural black', price: 9_000_000 }, { sku: 'BWB-22-NB', length: 22, colour: 'Natural black', price: 11_000_000 }]);
    await product('Kinky curly frontal wig', 'kinky-curly-frontal-wig', wigs, 'Kinky curly', { tags: ['party'] }, [{ sku: 'KCF-16-HB', length: 16, colour: 'Honey blonde', price: 32_000_000 }]);
    await product('Pixie cut wig', 'pixie-cut-wig', wigs, 'Straight', {}, [{ sku: 'PIX-8-NB', length: 8, colour: 'Natural black', price: 12_000_000 }]);
    await product('Secret deep wave wig', 'secret-deep-wave-wig', wigs, 'Deep wave', { status: 'draft' }, [{ sku: 'SDW-20-NB', length: 20, colour: 'Natural black', price: 30_000_000 }]);
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('the words the shop knows are kept up to date from products, categories and variants', async () => {
    const words = (await db.query('select word from search_words order by word')).rows.map((r) => r.word);
    for (const w of ['bone', 'straight', 'body', 'wave', 'kinky', 'curly', 'frontal', 'wigs', 'bundles', 'honey', 'blonde', 'natural', 'party', 'vietnamese']) assert.ok(words.includes(w), w);
    assert.ok(!words.includes('secret'), 'draft products do not teach the shop words');
    await db.query("update products set status = 'published' where slug = 'secret-deep-wave-wig'");
    assert.equal((await db.query("select count(*)::int as n from search_words where word = 'secret'")).rows[0]?.n, 1);
    await db.query("update products set status = 'draft' where slug = 'secret-deep-wave-wig'");
  });

  test('typing mistakes are corrected; small everyday words are left alone; lengths are understood', async () => {
    const p = await parseSearch(db, '  Bone  STRAIT wigg for 22 inch ');
    assert.deepEqual([p.normalised, p.words, p.lengths, p.corrected], ['bone strait wigg for 22 inch', ['bone', 'straight', 'wig'], [22], 'bone straight wig 22 inch']);
    assert.equal(p.tsquery, 'bone & straight & wig:*');
    const prefix = await parseSearch(db, 'kinky cur');
    assert.deepEqual([prefix.words, prefix.corrected, prefix.tsquery], [['kinky', 'cur'], null, 'kinky & cur:*'], 'a word being typed is finished, not corrected');
    assert.deepEqual((await parseSearch(db, 'bob 12')).lengths, [12]);
    assert.deepEqual((await parseSearch(db, '14" pixie')).lengths, [14]);
    assert.equal((await parseSearch(db, '')).tsquery, null);
  });

  test('the right products come first, with typing mistakes, half-typed words, categories, colours and tags', async () => {
    assert.equal((await names('bone straight'))[0], 'Bone straight wig');
    const typo = await search('boddy wave');
    assert.equal(typo.products[0].name, 'Body wave bundle');
    assert.equal(typo.search.corrected, 'body wave');
    assert.deepEqual(await names('bon'), ['Bone straight wig']);
    assert.deepEqual((await names('wigs')).sort(), ['Bone straight wig', 'Kinky curly frontal wig', 'Pixie cut wig']);
    assert.deepEqual(await names('honey blonde'), ['Kinky curly frontal wig']);
    assert.deepEqual(await names('party wig'), ['Kinky curly frontal wig']);
    assert.deepEqual(await names('kinki curli'), ['Kinky curly frontal wig']);
    assert.deepEqual(await names('BWB-18-NB'), ['Body wave bundle'], 'a SKU finds its product');
    assert.ok(!(await names('secret deep wave wig')).includes('Secret deep wave wig'), 'drafts are never found');
  });

  test('a length in the search narrows to products sold in that length', async () => {
    assert.deepEqual((await names('22 inch')).sort(), ['Body wave bundle', 'Bone straight wig']);
    assert.deepEqual(await names('22" body wave'), ['Body wave bundle']);
    assert.deepEqual(await names('8in wig'), ['Pixie cut wig']);
  });

  test('when nothing has every word, products with any of them are shown, and the page says so', async () => {
    const r = await search('bone curly');
    assert.equal(r.search.broadened, true);
    assert.deepEqual(r.products.map((p: any) => p.name).sort(), ['Bone straight wig', 'Kinky curly frontal wig']);
    assert.equal((await search('bone straight')).search.broadened, false);
  });

  test('search uses the same filters, sorting and pages as category pages', async () => {
    assert.deepEqual(await names('wig', '&texture=Straight&sort=price_low'), ['Pixie cut wig', 'Bone straight wig']);
    assert.deepEqual((await names('wig', '&category=wigs&max_price=20000000')).sort(), ['Bone straight wig', 'Pixie cut wig']);
    const first = (await get('/api/catalog/products?q=wig&limit=1')).body;
    assert.equal(first.total, 3);
    const second = (await get(`/api/catalog/products?q=wig&limit=1&cursor=${first.nextCursor}`)).body;
    const third = (await get(`/api/catalog/products?q=wig&limit=1&cursor=${second.nextCursor}`)).body;
    const all = [first, second, third].map((p) => p.products[0].name);
    assert.equal(new Set(all).size, 3, 'each page brings new products');
    assert.equal(third.nextCursor, null);
  });

  test('suggestions while typing: words to finish, categories and products', async () => {
    const s = (await get('/api/catalog/search/suggest?q=bo')).body;
    assert.deepEqual(s.terms, ['body', 'bone']);
    assert.deepEqual(s.products.map((p: any) => p.name).sort(), ['Body wave bundle', 'Bone straight wig']);
    const w = (await get('/api/catalog/search/suggest?q=wig')).body;
    assert.deepEqual(w.categories, [{ slug: 'wigs', name: 'Wigs' }]);
    assert.equal(w.products[0].currency, 'NGN');
    assert.ok(w.products.every((p: any) => typeof p.priceFromMinor === 'number'));
    assert.deepEqual((await get('/api/catalog/search/suggest?q=b')).body.products, [], 'one letter is too little');
  });

  test('staff see what customers search for most and what finds nothing', async () => {
    await names('xyzzy');
    await names('xyzzy');
    await names('frontal');
    const report = (await get('/api/search/report?days=30', 'admin.localhost', owner)).body;
    assert.ok(report.total >= 3);
    assert.deepEqual(report.noResults.find((r: any) => r.query === 'xyzzy'), { query: 'xyzzy', count: 2 });
    assert.ok(report.top.some((r: any) => r.query === 'frontal' && r.results === 1));
    // Later pages of the same search are not counted again.
    const before = (await db.query('select count(*)::int as n from search_queries')).rows[0]?.n;
    const first = (await get('/api/catalog/products?q=wig&limit=1')).body;
    await get(`/api/catalog/products?q=wig&limit=1&cursor=${first.nextCursor}`);
    assert.equal((await db.query('select count(*)::int as n from search_queries')).rows[0]?.n, before + 1);
  });
});

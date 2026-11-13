import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { toolsInstalled } from '../media/tools.js';

const tools = await toolsInstalled();
const skip = !TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not set' : !tools.vips || !tools.ffmpeg ? 'libvips or ffmpeg is not installed' : false;

interface Reply {
  status: number;
  text: string;
  body: Record<string, any>;
  headers: Record<string, string | string[] | undefined>;
}

describe('try-on pictures', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let accounts: AccountDeps;
  let server: Server;
  let port: number;
  let dir = '';
  let fixtures = '';
  let owner = '';
  let wigId = 0;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (s: number): void => {
    clock = new Date(clock.getTime() + s * 1000);
  };

  function call(host: string, method: string, path: string, body?: Buffer | object, options: { cookie?: string; type?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: `http://${host}` };
    let payload: Buffer | string | undefined;
    if (Buffer.isBuffer(body)) {
      payload = body;
      headers['Content-Type'] = options.type ?? 'image/png';
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
  const upload = (file: string, query = ''): Promise<Reply> => call('admin.localhost', 'POST', `/api/products/${wigId}/try-on${query}`, readFileSync(join(fixtures, file)), { cookie: owner });

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 5 });
    await migrate(db, 'db/migrations');
    dir = mkdtempSync(join(tmpdir(), 'hbd-tryon-'));
    fixtures = mkdtempSync(join(tmpdir(), 'hbd-tryon-fixtures-'));
    const ffmpeg = (args: string[]): void => void execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=1000x1200,format=rgba', '-frames:v', '1', join(fixtures, 'wig.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=1600x1920,format=rgba', '-frames:v', '1', join(fixtures, 'big.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=200x240,format=rgba', '-frames:v', '1', join(fixtures, 'tiny.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=1000x1200', '-frames:v', '1', join(fixtures, 'photo.jpg')]);
    const config = loadConfig({ MEDIA_DIR: dir });
    accounts = accountDeps({ db, config, mail: memoryMailer(), now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    const media = { db, now: () => clock, logger: createLogger('error', () => undefined), mediaDir: dir };
    server = createServer(createApp(config, media.logger, { version: 'test', accounts, media }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(accounts, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    wigId = Number((await db.query("insert into products (name, slug, status) values ('Body wave wig', 'body-wave-wig', 'published') returning id")).rows[0]?.id);
    for (const [sku, colour] of [['BW-1', 'Natural black'], ['BW-2', 'Honey blonde']]) {
      const v = Number((await db.query('insert into variants (product_id, sku, weight_grams, length_inches, colour) values ($1, $2, 300, 20, $3) returning id', [wigId, sku, colour])).rows[0]?.id);
      await db.query("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', 25000000)", [v]);
      await db.query('insert into inventory (variant_id, on_hand) values ($1, 3)', [v]);
    }
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fixtures, { recursive: true, force: true });
  });

  test('a product without try-on pictures has no try-on button and an empty list', async () => {
    const page = await call('localhost', 'GET', '/products/body-wave-wig/');
    assert.ok(!page.text.includes('Try it on'));
    assert.deepEqual((await call('api.localhost', 'GET', '/v1/catalog/try-on')).body.products, []);
    const tryOnPage = await call('localhost', 'GET', '/try-on/');
    assert.match(tryOnPage.text, /No wigs can be tried on yet/);
  });

  test('staff upload see-through PNGs per colour; other files and sizes are refused', async () => {
    const first = await upload('wig.png', '?colour=Natural%20black');
    assert.equal(first.status, 201, first.text);
    assert.equal(first.body.tryOn.colour, 'Natural black');
    assert.deepEqual(first.body.tryOn.temples, { leftX: 0.3, leftY: 0.42, rightX: 0.7, rightY: 0.42 });
    assert.ok(existsSync(join(dir, 'public', first.body.tryOn.path, '1200.png')));
    assert.ok(existsSync(join(dir, 'public', first.body.tryOn.path, '1200.webp')));

    const big = await upload('big.png', '?colour=Honey%20blonde&leftX=0.25&leftY=0.4&rightX=0.75&rightY=0.4');
    assert.equal(big.status, 201, big.text);
    assert.equal(big.body.tryOn.width, 1200);
    assert.equal(big.body.tryOn.height, 1440);
    assert.equal(big.body.tryOn.temples.leftX, 0.25);

    assert.equal((await upload('wig.png', '?colour=natural%20BLACK')).body.error.fields.colour.startsWith('There is already'), true);
    assert.equal((await upload('photo.jpg')).body.error.fields.file, 'Upload a PNG with a see-through background.');
    assert.match((await upload('tiny.png')).body.error.fields.file, /at least 400 pixels wide/);
    assert.equal((await upload('wig.png', '?leftX=0.8&rightX=0.2')).status, 422);
    assert.equal((await upload('wig.png', '?leftX=2')).body.error.fields.leftX, 'Give a number from 0 to 1.');
    // Nothing is left behind from refused uploads.
    assert.deepEqual(execFileSync('ls', [join(dir, 'tmp')]).toString().trim(), '');
  });

  test('the shop and the app see the pictures; the product page offers "Try it on"', async () => {
    const product = (await call('api.localhost', 'GET', '/v1/catalog/products/body-wave-wig')).body.product;
    assert.equal(product.tryOn.length, 2);
    assert.equal(product.tryOn[1].colour, 'Honey blonde');
    const list = (await call('api.localhost', 'GET', '/v1/catalog/try-on?currency=NGN')).body.products;
    assert.equal(list.length, 1);
    assert.equal(list[0].priceFromMinor, 25000000);
    const png = await call('localhost', 'GET', `/media/${list[0].images[0].path}/1200.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');

    const page = await call('localhost', 'GET', '/products/body-wave-wig/');
    assert.match(page.text, /href="\/try-on\/\?product=body-wave-wig"/);
    const tryOn = await call('localhost', 'GET', '/try-on/?product=body-wave-wig');
    assert.equal(tryOn.status, 200);
    assert.match(tryOn.text, /data-tryon-styles/);
    assert.match(tryOn.text, /<script type="module" src="\/js\/try-on.js">/);
    assert.match(String(tryOn.headers['content-security-policy']), /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(String(tryOn.headers['content-security-policy']), /media-src 'self' blob:/);
    // Other pages keep the stricter policy.
    assert.ok(!String(page.headers['content-security-policy']).includes('wasm-unsafe-eval'));
    assert.match(String(page.headers['permissions-policy']), /camera=\(self\)/);
  });

  test('a draft product cannot be tried on, and removing a picture deletes its files', async () => {
    await db.query("update products set status = 'draft' where id = $1", [wigId]);
    assert.equal((await call('api.localhost', 'GET', '/v1/catalog/try-on')).body.products.length, 0);
    await db.query("update products set status = 'published' where id = $1", [wigId]);
    const listed = (await call('admin.localhost', 'GET', `/api/products/${wigId}/try-on`, undefined, { cookie: owner })).body.tryOn;
    const removed = await call('admin.localhost', 'POST', `/api/try-on/${listed[0].id}/delete`, {}, { cookie: owner });
    assert.equal(removed.status, 200);
    assert.ok(!existsSync(join(dir, 'public', listed[0].path)));
    assert.equal((await call('admin.localhost', 'POST', `/api/try-on/${listed[0].id}/delete`, {}, { cookie: owner })).status, 404);
    const editor = await call('admin.localhost', 'GET', `/products/${wigId}/`, undefined, { cookie: owner });
    assert.match(editor.text, /Try-on pictures/);
    assert.match(editor.text, /data-upload="\/api\/products\/\d+\/try-on"/);
  });

  test('only staff who may change products can upload', async () => {
    assert.equal((await call('admin.localhost', 'POST', `/api/products/${wigId}/try-on`, readFileSync(join(fixtures, 'wig.png')))).status, 401);
  });
});

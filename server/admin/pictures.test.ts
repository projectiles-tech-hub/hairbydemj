// Homepage banners, promotional banners, category pictures and collection
// banners (added after module 21): uploading, sizes, dates and countries, and
// what the website and the app show.

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
import { sectionShowsNow } from '../catalog/public.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { sizesFor, SITE_PICTURES, type MediaDeps } from '../media/media.js';
import { toolsInstalled } from '../media/tools.js';

const tools = await toolsInstalled();
const skip = !TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not set' : !tools.vips || !tools.ffmpeg ? 'libvips or ffmpeg is not installed' : false;

test('banner sizes go up to 2560 pixels and never past the original', () => {
  assert.deepEqual(sizesFor(4000, SITE_PICTURES.banner.widths), [640, 960, 1280, 1920, 2560]);
  assert.deepEqual(sizesFor(1500, SITE_PICTURES.banner.widths), [640, 960, 1280, 1500]);
  assert.deepEqual(sizesFor(1000, SITE_PICTURES.card.widths), [320, 640, 960]);
});

test('when and where a section shows', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const base = { isShown: true, showFrom: null, showUntil: null, countries: [] as string[] };
  assert.equal(sectionShowsNow(base, now, null), true);
  assert.equal(sectionShowsNow({ ...base, isShown: false }, now, null), false);
  assert.equal(sectionShowsNow({ ...base, showFrom: '2026-12-02T00:00:00Z' }, now, null), false);
  assert.equal(sectionShowsNow({ ...base, showUntil: '2026-12-01T12:00:00Z' }, now, null), false);
  assert.equal(sectionShowsNow({ ...base, countries: ['GB', 'US'] }, now, 'gb'), true);
  assert.equal(sectionShowsNow({ ...base, countries: ['GB', 'US'] }, now, 'NG'), false);
  assert.equal(sectionShowsNow({ ...base, countries: ['GB'] }, now, null), false, 'unknown country: only banners for everyone');
});

interface Reply {
  status: number;
  body: Record<string, any>;
  text: string;
}

describe('shop pictures over HTTP', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let accounts: AccountDeps;
  let server: Server;
  let port: number;
  let dir: string;
  let fixtures: string;
  let owner = '';
  let clerk = '';
  let clock = new Date('2026-12-01T09:00:00Z');
  const tick = (s: number): void => {
    clock = new Date(clock.getTime() + s * 1000);
  };

  function call(host: string, method: string, path: string, body?: Buffer | Record<string, unknown>, o: { cookie?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: `http://${host}`, ...(o.headers ?? {}) };
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    if (payload) {
      headers['Content-Type'] = Buffer.isBuffer(body) ? 'image/jpeg' : 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    if (o.cookie) headers.Cookie = o.cookie;
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
            // a page
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, text });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const admin = (method: string, path: string, body?: Buffer | Record<string, unknown>, cookie = owner): Promise<Reply> => call('admin.localhost', method, path, body, { cookie });
  const photo = (name: string): Buffer => readFileSync(join(fixtures, name));
  const sectionId = async (kind: string): Promise<number> => Number((await db.query('select id from homepage_sections where kind = $1 order by id desc limit 1', [kind])).rows[0]?.id);

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 5 });
    await migrate(db, 'db/migrations');
    await db.query(readFileSync('db/seeds/dev.sql', 'utf8'));
    dir = mkdtempSync(join(tmpdir(), 'hbd-pictures-'));
    fixtures = mkdtempSync(join(tmpdir(), 'hbd-pictures-fx-'));
    const make = (size: string, name: string): void => {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}`, '-frames:v', '1', join(fixtures, name)]);
    };
    make('3000x1300', 'wide.jpg');
    make('1200x1500', 'tall.jpg');
    make('1000x1000', 'square.jpg');
    make('400x400', 'small.jpg');
    const config = loadConfig({ MEDIA_DIR: dir, TRUST_PROXY: 'true' });
    accounts = accountDeps({
      db,
      config,
      mail: memoryMailer(),
      identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
      now: () => clock,
    });
    const logger = createLogger('error', () => undefined);
    const media: MediaDeps = { db, now: () => clock, logger, mediaDir: dir };
    server = createServer(createApp(config, logger, { version: 'test', accounts, media }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(accounts, tick, { name: 'Owner', email: 'owner@example.com' })).cookie;
    const support = Number((await db.query("select id from roles where name = 'Support'")).rows[0]?.id);
    clerk = (await signedInStaff(accounts, tick, { name: 'Clerk', email: 'clerk@example.com', roleId: support })).cookie;
    await admin('GET', '/api/homepage'); // makes a row for every section
  });

  after(async () => {
    server.close();
    await db.end();
    await testDb.drop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fixtures, { recursive: true, force: true });
  });

  test('the top banner takes a desktop and a phone picture, made in banner sizes', async () => {
    const hero = await sectionId('hero');
    const desk = await admin('POST', `/api/homepage/${hero}/picture?slot=desktop`, photo('wide.jpg'));
    assert.equal(desk.status, 200, desk.text);
    const saved = desk.body.sections.find((s: { kind: string }) => s.kind === 'hero').settings;
    assert.deepEqual(saved.picture.widths, [640, 960, 1280, 1920, 2560]);
    assert.ok(existsSync(join(dir, 'public', saved.picture.path, '2560.webp')));
    assert.ok(existsSync(join(dir, 'public', saved.picture.path, '640.jpg')));
    const phone = await admin('POST', `/api/homepage/${hero}/picture?slot=phone`, photo('tall.jpg'));
    assert.equal(phone.status, 200);
    await admin('POST', `/api/homepage/${hero}`, { settings: { alt: 'A model in a bone straight wig' } });

    const home = await call('localhost', 'GET', '/');
    assert.match(home.text, /<source media="\(max-width: 599px\)" type="image\/webp" srcset="\/media\/s\/home\/\d+\/[0-9a-f]{16}\/640\.webp 640w/);
    assert.match(home.text, /alt="A model in a bone straight wig" loading="eager" fetchpriority="high"/);

    // Replacing a picture removes the old files.
    const again = await admin('POST', `/api/homepage/${hero}/picture?slot=desktop`, photo('wide.jpg'));
    const newer = again.body.sections.find((s: { kind: string }) => s.kind === 'hero').settings.picture;
    assert.notEqual(newer.path, saved.picture.path);
    assert.equal(existsSync(join(dir, 'public', saved.picture.path)), false);
  });

  test('pictures that are too small, not photos, or from staff without permission are refused', async () => {
    const hero = await sectionId('hero');
    assert.equal((await admin('POST', `/api/homepage/${hero}/picture`, photo('small.jpg'))).status, 422);
    assert.equal((await admin('POST', `/api/homepage/${hero}/picture`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).status, 422);
    assert.equal((await admin('POST', `/api/homepage/${hero}/picture`, photo('wide.jpg'), clerk)).status, 403);
    const best = await sectionId('best_sellers');
    assert.equal((await admin('POST', `/api/homepage/${best}/picture`, photo('wide.jpg'))).status, 409);
  });

  test('promotional banners: added hidden, then shown within their dates and countries', async () => {
    const added = await admin('POST', '/api/homepage/promos', {});
    assert.equal(added.status, 201);
    const promo = await sectionId('promo');
    await admin('POST', `/api/homepage/${promo}/picture`, photo('wide.jpg'));
    const saved = await admin('POST', `/api/homepage/${promo}`, {
      isShown: true,
      position: 1,
      settings: { headline: 'Black Friday: 20% off wigs', buttonLabel: 'Shop wigs', buttonLink: '/c/wigs/' },
      showFrom: '2026-11-27T00:00',
      showUntil: '2026-11-30T23:59',
      countries: ['ng', 'GH'],
    });
    assert.equal(saved.status, 200, saved.text);
    const row = saved.body.sections.find((s: { id: number }) => s.id === promo);
    assert.equal(row.showFrom, '2026-11-26T23:00:00.000Z', 'form times are Lagos time');
    assert.deepEqual(row.countries, ['NG', 'GH']);

    const page = (country: string): Promise<Reply> => call('localhost', 'GET', '/', undefined, { headers: { 'CF-IPCountry': country } });
    clock = new Date('2026-11-26T12:00:00Z');
    assert.doesNotMatch((await page('NG')).text, /Black Friday/, 'not before its start');
    clock = new Date('2026-11-28T12:00:00Z');
    assert.match((await page('NG')).text, /<h2 class="h1" id="promo-\d+">Black Friday: 20% off wigs<\/h2>/);
    assert.doesNotMatch((await page('GB')).text, /Black Friday/, 'not in other countries');
    const app = await call('api.localhost', 'GET', '/v1/catalog/home', undefined, { headers: { 'CF-IPCountry': 'GH' } });
    assert.ok(app.body.sections.some((s: { kind: string; settings: { headline?: string } }) => s.kind === 'promo' && s.settings.headline === 'Black Friday: 20% off wigs'));
    const appGb = await call('api.localhost', 'GET', '/v1/catalog/home', undefined, { headers: { 'CF-IPCountry': 'GB' } });
    assert.ok(!appGb.body.sections.some((s: { kind: string }) => s.kind === 'promo'));
    clock = new Date('2026-12-01T09:00:00Z');
    assert.doesNotMatch((await page('NG')).text, /Black Friday/, 'not after its end');

    assert.equal((await admin('POST', `/api/homepage/${promo}`, { showFrom: '2026-12-05T00:00', showUntil: '2026-12-04T00:00' })).status, 422);
    assert.equal((await admin('POST', `/api/homepage/${promo}`, { countries: 'Nigeria' })).status, 422);

    // Removing it removes its pictures; the fixed sections cannot be removed.
    const pic = row.settings.picture.path as string;
    assert.equal((await admin('POST', `/api/homepage/${promo}/delete`, {})).status, 200);
    assert.equal(existsSync(join(dir, 'public', pic)), false);
    assert.equal((await admin('POST', `/api/homepage/${await sectionId('hero')}/delete`, {})).status, 409);
  });

  test('category pictures show on the category cards, collection banners on looks', async () => {
    const wigs = Number((await db.query("select id from categories where slug = 'wigs'")).rows[0]?.id);
    const up = await admin('POST', `/api/categories/${wigs}/picture`, photo('square.jpg'));
    assert.equal(up.status, 200, up.text);
    assert.deepEqual(up.body.picture.widths, [320, 640, 960]);
    const cats = await call('api.localhost', 'GET', '/v1/catalog/categories');
    const node = cats.body.categories.find((c: { slug: string }) => c.slug === 'wigs');
    assert.equal(node.image.path, up.body.picture.path);
    assert.match((await call('localhost', 'GET', '/')).text, new RegExp(`/media/${up.body.picture.path}/320.webp 320w`));

    const look = Number((await db.query('select id from collections where is_look order by id limit 1')).rows[0]?.id);
    const slug = String((await db.query('select slug from collections where id = $1', [look])).rows[0]?.slug);
    await db.query("update collections set status = 'live' where id = $1", [look]);
    const banner = await admin('POST', `/api/collections/${look}/picture`, photo('wide.jpg'));
    assert.equal(banner.status, 200, banner.text);
    assert.match((await call('localhost', 'GET', `/looks/${slug}/`)).text, new RegExp(`/media/${banner.body.picture.path}/2560.webp 2560w`));
    assert.equal((await admin('POST', `/api/collections/${look}/picture/delete`, {})).status, 200);
    assert.equal(existsSync(join(dir, 'public', banner.body.picture.path)), false);
    assert.equal((await admin('POST', `/api/categories/${wigs}/picture`, photo('square.jpg'), clerk)).status, 403);
  });

  test('the admin homepage page offers the uploads, the schedule and new banners', async () => {
    const page = await admin('GET', '/homepage/');
    assert.equal(page.status, 200);
    assert.match(page.text, /data-upload="\/api\/homepage\/\d+\/picture"/);
    assert.match(page.text, /Picture for phones \(optional\)/);
    assert.match(page.text, /Show from \(Lagos time\)/);
    assert.match(page.text, /Add a promotional banner/);
  });
});

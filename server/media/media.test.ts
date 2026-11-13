import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { MEDIA, processPending, widthsFor, type MediaDeps } from './media.js';
import { imageSize, sniff, toolsInstalled, videoInfo } from './tools.js';

test('the sizes made for a picture never exceed the original', () => {
  assert.deepEqual(widthsFor(3000), [320, 640, 960, 1280, 1920]);
  assert.deepEqual(widthsFor(1920), [320, 640, 960, 1280, 1920]);
  assert.deepEqual(widthsFor(800), [320, 640, 800]);
  assert.deepEqual(widthsFor(640), [320, 640]);
  assert.deepEqual(widthsFor(300), [300]);
});

test('a file is recognised by its first bytes, not its name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hbd-sniff-'));
  const kindOf = async (bytes: number[] | string): Promise<string | null> => {
    const file = join(dir, 'photo.jpg'); // always named like a photo
    writeFileSync(file, typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes));
    return sniff(file);
  };
  const pad = '\0'.repeat(16);
  assert.equal(await kindOf([0xff, 0xd8, 0xff, 0xe0, ...Array(12).fill(0)]), 'jpeg');
  assert.equal(await kindOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(8).fill(0)]), 'png');
  assert.equal(await kindOf('RIFF\0\0\0\0WEBPVP8 '), 'webp');
  assert.equal(await kindOf('\0\0\0\x18ftypheic' + pad), 'heic');
  assert.equal(await kindOf('\0\0\0\x18ftypisom' + pad), 'mp4');
  assert.equal(await kindOf('\0\0\0\x14ftypqt  ' + pad), 'mov');
  assert.equal(await kindOf([0x1a, 0x45, 0xdf, 0xa3, ...Array(12).fill(0)]), 'webm');
  assert.equal(await kindOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), null);
  assert.equal(await kindOf('<!doctype html><script>alert(1)</script>'), null);
  assert.equal(await kindOf('#!/bin/sh\nrm -rf /\n' + pad), null);
  assert.equal(await kindOf('MZ' + pad), null);
  assert.equal(await kindOf('abc'), null);
  rmSync(dir, { recursive: true });
});

const tools = await toolsInstalled();
const skip = !TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not set' : !tools.vips || !tools.ffmpeg ? 'libvips or ffmpeg is not installed' : false;

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: Record<string, string | string[] | undefined>;
  raw: Buffer;
}

describe('product photos and videos over HTTP', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let accounts: AccountDeps;
  let media: MediaDeps;
  let server: Server;
  let port: number;
  let dir: string;
  let fixtures: string;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const SITE = 'localhost';
  const ADMIN = 'admin.localhost';
  let owner = '';
  let viewer = '';
  let productId = 0;
  const MARK = 'SECRET-GPS-6.3350N-5.6037E';

  function call(host: string, method: string, path: string, body?: Buffer | Record<string, unknown>, options: { cookie?: string; origin?: string; type?: string; range?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: options.origin ?? `http://${host}` };
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    if (payload) {
      headers['Content-Type'] = options.type ?? (Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json');
      headers['Content-Length'] = String(payload.length);
    }
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.range) headers.Range = options.range;
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
            // not JSON: a file
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: res.headers, raw });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const upload = (file: Buffer, query = '', cookie = owner, product = productId): Promise<Reply> => call(ADMIN, 'POST', `/api/products/${product}/media${query}`, file, { cookie });
  const ffmpeg = (args: string[]): void => {
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  };
  const fixture = (name: string): Buffer => readFileSync(join(fixtures, name));
  /** A JPEG with a comment block added, standing in for the hidden details a phone camera writes. */
  const withHiddenText = (jpeg: Buffer, text: string): Buffer => {
    const comment = Buffer.from(text, 'latin1');
    const segment = Buffer.concat([Buffer.from([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff]), comment]);
    return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
  };
  const publicFiles = (path: string): string[] => readdirSync(join(dir, 'public', path)).sort();

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 5 });
    await migrate(db, 'db/migrations');
    dir = mkdtempSync(join(tmpdir(), 'hbd-media-'));
    fixtures = mkdtempSync(join(tmpdir(), 'hbd-fixtures-'));
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=2000x3000', '-frames:v', '1', join(fixtures, 'tall.jpg')]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=800x600', '-frames:v', '1', join(fixtures, 'small.png')]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=1000x1000', '-frames:v', '1', '-c:v', 'libwebp', join(fixtures, 'square.webp')]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=200x200', '-frames:v', '1', join(fixtures, 'tiny.jpg')]);
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=2:size=1920x1080:rate=24', '-f', 'lavfi', '-i', 'sine=duration=2', '-metadata', `location=${MARK}`, '-c:v', 'mpeg4', '-q:v', '5', join(fixtures, 'clip.mov')]);

    const config = loadConfig({ MEDIA_DIR: dir });
    accounts = accountDeps({
      db,
      config,
      mail: memoryMailer(),
      now: () => clock,
      passwordParams: { N: 1024, r: 8, p: 1 },
      identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
    });
    media = { db, now: () => clock, logger: createLogger('error', () => undefined), mediaDir: dir };
    server = createServer(createApp(config, media.logger, { version: 'test', accounts, media }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    owner = (await signedInStaff(accounts, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
    const role = Number((await db.query("insert into roles (name) values ('Viewer') returning id")).rows[0]?.id);
    await db.query("insert into role_permissions (role_id, area, can_view, can_change) values ($1, 'products', true, false)", [role]);
    viewer = (await signedInStaff(accounts, tick, { name: 'Viewer', email: 'viewer@hairbydemj.test', roleId: role })).cookie;

    const product = await call(ADMIN, 'POST', '/api/products', { name: 'Bone straight wig' }, { cookie: owner });
    productId = product.body.product.id;
    await call(ADMIN, 'POST', `/api/products/${productId}/variants/generate`, { lengths: [22], colours: ['Natural black', '613'], weightGrams: 300, prices: { NGN: 28_500_000 } }, { cookie: owner });
    await call(ADMIN, 'POST', `/api/products/${productId}`, { status: 'published' }, { cookie: owner });
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fixtures, { recursive: true, force: true });
  });

  test('a photo is stored, resized into every size, and served with a year-long cache', async () => {
    const reply = await upload(withHiddenText(fixture('tall.jpg'), MARK), '?alt=Front%20view&name=IMG_0001.JPG');
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    const item = reply.body.media;
    assert.deepEqual([item.kind, item.status, item.alt, item.width, item.height, item.position], ['image', 'ready', 'Front view', 2000, 3000, 0]);
    assert.deepEqual(item.widths, [320, 640, 960, 1280, 1920]);
    assert.match(item.path, new RegExp(`^p/${productId}/[0-9a-f]{16}$`));
    assert.deepEqual(publicFiles(item.path), ['1280.jpg', '1280.webp', '1920.jpg', '1920.webp', '320.jpg', '320.webp', '640.jpg', '640.webp', '960.jpg', '960.webp']);
    assert.deepEqual(await imageSize(join(dir, 'public', item.path, '640.webp')), { width: 640, height: 960 });
    assert.deepEqual(await imageSize(join(dir, 'public', item.path, '1920.jpg')), { width: 1920, height: 2880 });

    for (const host of [SITE, ADMIN, 'api.localhost']) {
      const served = await call(host, 'GET', `/media/${item.path}/640.webp`);
      assert.equal(served.status, 200);
      assert.equal(served.headers['content-type'], 'image/webp');
      assert.equal(served.headers['cache-control'], 'public, max-age=31536000, immutable');
    }
    assert.equal((await call(SITE, 'GET', `/media/${item.path}/640.jpg`)).headers['content-type'], 'image/jpeg');
    const small = (await call(SITE, 'GET', `/media/${item.path}/320.webp`)).raw.length;
    const large = (await call(SITE, 'GET', `/media/${item.path}/1920.webp`)).raw.length;
    assert.ok(small < large && large < fixture('tall.jpg').length, 'smaller sizes are smaller files, and all are lighter than the original');
    assert.equal((await call(SITE, 'GET', `/media/${item.path}/9999.webp`)).status, 404);
  });

  test('hidden details in a photo (camera, date, location) are removed from what visitors get', async () => {
    const row = await db.query('select path, original_path from product_media order by id limit 1');
    const original = readFileSync(join(dir, String(row.rows[0]?.original_path)));
    assert.ok(original.includes(MARK), 'the untouched upload still has them');
    for (const file of publicFiles(String(row.rows[0]?.path))) {
      assert.ok(!readFileSync(join(dir, 'public', String(row.rows[0]?.path), file)).includes(MARK), `${file} is clean`);
    }
  });

  test('the untouched upload is kept but can never be fetched', async () => {
    const row = await db.query('select original_path from product_media order by id limit 1');
    const original = String(row.rows[0]?.original_path);
    assert.ok(existsSync(join(dir, original)));
    for (const path of [`/media/../${original}`, `/media/%2e%2e/${original}`, `/media/..%2f${original}`, `/${original}`, `/media/${original}`, '/media/%2e%2e/%2e%2e/etc/passwd', '/media/p/../../originals']) {
      const reply = await call(SITE, 'GET', path);
      assert.equal(reply.status, 404, path);
      assert.ok(!reply.raw.includes(MARK));
    }
  });

  test('PNG and WebP photos work; a small photo is never enlarged', async () => {
    const png = await upload(fixture('small.png'), '?colour=613');
    assert.equal(png.status, 201, JSON.stringify(png.body));
    assert.deepEqual(png.body.media.widths, [320, 640, 800]);
    assert.equal(png.body.media.colour, '613');
    assert.deepEqual(await imageSize(join(dir, 'public', png.body.media.path, '800.jpg')), { width: 800, height: 600 });
    const webp = await upload(fixture('square.webp'));
    assert.deepEqual(webp.body.media.widths, [320, 640, 960, 1000]);
    assert.deepEqual([png.body.media.position, webp.body.media.position], [1, 2]);
  });

  test('files that are not photos or videos are refused, whatever they are called', async () => {
    const before = (await db.query('select count(*)::int as n from product_media')).rows[0]?.n;
    const refused = async (file: Buffer, pattern: RegExp, type = 'image/jpeg'): Promise<void> => {
      const reply = await call(ADMIN, 'POST', `/api/products/${productId}/media?name=photo.jpg`, file, { cookie: owner, type });
      assert.equal(reply.status, 422, JSON.stringify(reply.body));
      assert.match(reply.body.error.fields.file, pattern);
    };
    await refused(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /Upload a JPEG/);
    await refused(Buffer.from('<!doctype html><html><script>alert(1)</script></html>'), /Upload a JPEG/);
    await refused(Buffer.from('#!/bin/sh\necho hacked > /tmp/x\n'), /Upload a JPEG/);
    await refused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('this only pretends to be a JPEG'.repeat(20))]), /could not be read/);
    await refused(fixture('tiny.jpg'), /too small/);
    const empty = await call(ADMIN, 'POST', `/api/products/${productId}/media`, Buffer.alloc(0), { cookie: owner });
    assert.equal(empty.status, 422);
    assert.equal((await db.query('select count(*)::int as n from product_media')).rows[0]?.n, before, 'nothing was recorded');
    assert.deepEqual(readdirSync(join(dir, 'tmp')), [], 'and nothing was left behind');
    assert.equal(readdirSync(join(dir, 'originals', 'p', String(productId))).length, before);
    assert.equal((await upload(fixture('tall.jpg'), '', owner, 999_999)).status, 404);
  });

  test('uploads over the size limit are stopped', async () => {
    const limit = MEDIA.maxVideoBytes;
    MEDIA.maxVideoBytes = 50_000;
    try {
      const reply = await upload(fixture('tall.jpg'));
      assert.equal(reply.status, 413);
      assert.match(reply.body.error.message, /too large/);
      assert.deepEqual(readdirSync(join(dir, 'tmp')), []);
    } finally {
      MEDIA.maxVideoBytes = limit;
    }
    const imageLimit = MEDIA.maxImageBytes;
    MEDIA.maxImageBytes = 50_000;
    try {
      assert.equal((await upload(fixture('tall.jpg'))).status, 413);
    } finally {
      MEDIA.maxImageBytes = imageLimit;
    }
  });

  test('a video is compressed to MP4 with a poster picture, and plays from any point', async () => {
    const reply = await upload(fixture('clip.mov'), '?alt=On%20the%20model');
    assert.equal(reply.status, 202, JSON.stringify(reply.body));
    assert.deepEqual([reply.body.media.kind, reply.body.media.status], ['video', 'processing']);
    const path = reply.body.media.path;
    // Not shown in the shop until it is ready.
    assert.ok(!(await call(SITE, 'GET', '/api/catalog/products/bone-straight-wig')).body.product.media.some((m: Record<string, any>) => m.kind === 'video'));

    let item: Record<string, any> = {};
    for (let i = 0; i < 300; i++) {
      await processPending(media);
      item = (await call(ADMIN, 'GET', `/api/products/${productId}/media`, undefined, { cookie: owner })).body.media.find((m: Record<string, any>) => m.kind === 'video');
      if (item.status !== 'processing') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(item.status, 'ready', JSON.stringify(item));
    assert.deepEqual([item.width, item.height], [1280, 720], 'scaled down from 1920 by 1080');
    assert.ok(Math.abs(item.durationMs - 2000) < 200);
    assert.deepEqual(item.widths, [320, 640, 960, 1280]);
    assert.ok(publicFiles(path).includes('video.mp4') && publicFiles(path).includes('640.webp'));
    const made = await videoInfo(join(dir, 'public', path, 'video.mp4'));
    assert.deepEqual([made.width, made.height], [1280, 720]);
    const codec = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', join(dir, 'public', path, 'video.mp4')]).toString().trim().split('\n');
    assert.deepEqual(codec, ['h264', 'aac']);
    assert.ok(fixture('clip.mov').includes(MARK));
    assert.ok(!readFileSync(join(dir, 'public', path, 'video.mp4')).includes(MARK), 'the location was removed');

    const whole = await call(SITE, 'GET', `/media/${path}/video.mp4`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers['content-type'], 'video/mp4');
    assert.equal(whole.headers['accept-ranges'], 'bytes');
    const part = await call(SITE, 'GET', `/media/${path}/video.mp4`, undefined, { range: 'bytes=100-199' });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 100-199/${whole.raw.length}`);
    assert.ok(part.raw.equals(whole.raw.subarray(100, 200)));
    const tail = await call(SITE, 'GET', `/media/${path}/video.mp4`, undefined, { range: 'bytes=-50' });
    assert.ok(tail.raw.equals(whole.raw.subarray(whole.raw.length - 50)));
    assert.equal((await call(SITE, 'GET', `/media/${path}/video.mp4`, undefined, { range: `bytes=${whole.raw.length + 5}-` })).status, 416);

    const second = await upload(fixture('clip.mov'));
    assert.equal(second.status, 409);
    assert.equal(second.body.error.message, 'A product can have 1 video. Remove it first.');
  });

  test('a broken video is marked as failed, with the reason, and never shown', async () => {
    const other = (await call(ADMIN, 'POST', '/api/products', { name: 'Other product' }, { cookie: owner })).body.product.id;
    const fake = Buffer.concat([Buffer.from('\0\0\0\x18ftypisom', 'latin1'), Buffer.alloc(4000, 7)]);
    const reply = await upload(fake, '', owner, other);
    assert.equal(reply.status, 202);
    await processPending(media);
    let item: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      await processPending(media);
      item = (await call(ADMIN, 'GET', `/api/products/${other}/media`, undefined, { cookie: owner })).body.media[0];
      if (item.status !== 'processing') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(item.status, 'failed');
    assert.match(item.error, /could not be read|ffprobe failed/);
    assert.ok(!existsSync(join(dir, 'public', item.path)));
    // Deleting the product removes its files too.
    assert.equal(readdirSync(join(dir, 'originals', 'p', String(other))).length, 1);
    assert.deepEqual((await call(ADMIN, 'POST', `/api/products/${other}/delete`, {}, { cookie: owner })).body, { deleted: true });
    assert.ok(!existsSync(join(dir, 'originals', 'p', String(other))));
  });

  test('the shop gets the photos in order, with their sizes; the first is the cover', async () => {
    const page = (await call(SITE, 'GET', '/api/catalog/products/bone-straight-wig')).body.product;
    assert.deepEqual(page.media.map((m: Record<string, any>) => [m.kind, m.alt, m.colour, m.widths.length]), [['image', 'Front view', null, 5], ['image', '', '613', 3], ['image', '', null, 4], ['video', 'On the model', null, 4]]);
    assert.equal(page.media[3].durationMs > 0, true);
    const card = (await call(SITE, 'GET', '/api/catalog/products')).body.products[0];
    assert.deepEqual([card.image.alt, card.image.widths], ['Front view', [320, 640, 960, 1280, 1920]]);
    assert.equal((await call(SITE, 'GET', `/media/${card.image.path}/640.webp`)).status, 200);

    // Staff put the 613 photo first: it becomes the cover.
    const list = (await call(ADMIN, 'GET', `/api/products/${productId}/media`, undefined, { cookie: owner })).body.media;
    const ids = list.map((m: Record<string, any>) => m.id);
    const reordered = await call(ADMIN, 'POST', `/api/products/${productId}/media/order`, { ids: [ids[1], ids[0], ids[2], ids[3]] }, { cookie: owner });
    assert.deepEqual(reordered.body.media.map((m: Record<string, any>) => m.id), [ids[1], ids[0], ids[2], ids[3]]);
    assert.equal((await call(SITE, 'GET', '/api/catalog/products')).body.products[0].image.path, list[1].path);
    assert.equal((await call(ADMIN, 'GET', '/api/products', undefined, { cookie: owner })).body.products.find((p: Record<string, any>) => p.id === productId).image, list[1].path);
    for (const bad of [[ids[0]], [ids[0], ids[0], ids[1], ids[2]], [...ids, 999_999], 'x']) {
      assert.equal((await call(ADMIN, 'POST', `/api/products/${productId}/media/order`, { ids: bad }, { cookie: owner })).status, 422);
    }
  });

  test('a photo is linked to variants by colour, which must be one the product is sold in', async () => {
    const list = (await call(ADMIN, 'GET', `/api/products/${productId}/media`, undefined, { cookie: owner })).body.media;
    const edited = await call(ADMIN, 'POST', `/api/media/${list[1].id}`, { alt: '  Natural black, side view ', colour: 'natural BLACK' }, { cookie: owner });
    assert.deepEqual([edited.body.media.alt, edited.body.media.colour], ['Natural black, side view', 'Natural black']);
    assert.equal((await call(ADMIN, 'POST', `/api/media/${list[1].id}`, { colour: 'Burgundy' }, { cookie: owner })).body.error.fields.colour, 'Choose one of the colours this product is sold in.');
    assert.equal((await call(ADMIN, 'POST', `/api/media/${list[1].id}`, { colour: '' }, { cookie: owner })).body.media.colour, null);
    assert.equal((await call(ADMIN, 'POST', '/api/media/999999', { alt: 'x' }, { cookie: owner })).status, 404);
  });

  test('a product holds at most 10 photos', async () => {
    const limit = MEDIA.maxImages;
    MEDIA.maxImages = 3;
    try {
      const reply = await upload(fixture('small.png'));
      assert.equal(reply.status, 409);
      assert.equal(reply.body.error.message, 'A product can have up to 3 photos. Remove one first.');
    } finally {
      MEDIA.maxImages = limit;
    }
    assert.equal(limit, 10);
  });

  test('removing a photo removes its files', async () => {
    const list = (await call(ADMIN, 'GET', `/api/products/${productId}/media`, undefined, { cookie: owner })).body.media;
    const target = list[2];
    const original = String((await db.query('select original_path from product_media where id = $1', [target.id])).rows[0]?.original_path);
    assert.equal((await call(ADMIN, 'POST', `/api/media/${target.id}/delete`, {}, { cookie: owner })).status, 200);
    assert.ok(!existsSync(join(dir, 'public', target.path)));
    assert.ok(!existsSync(join(dir, original)));
    assert.equal((await call(SITE, 'GET', `/media/${target.path}/320.webp`)).status, 404);
    assert.equal((await call(ADMIN, 'POST', `/api/media/${target.id}/delete`, {}, { cookie: owner })).status, 404);
    assert.equal((await call(SITE, 'GET', '/api/catalog/products/bone-straight-wig')).body.product.media.length, 3);
  });

  test('only staff who may change products can upload, edit or remove', async () => {
    const list = (await call(ADMIN, 'GET', `/api/products/${productId}/media`, undefined, { cookie: viewer })).body.media;
    assert.equal(list.length, 3, '"view" can see the list');
    const count = async (): Promise<number> => Number((await db.query('select count(*)::int as n from product_media')).rows[0]?.n);
    const before = await count();
    assert.equal((await upload(fixture('small.png'), '', viewer)).status, 403);
    assert.equal((await upload(fixture('small.png'), '', '')).status, 401);
    assert.equal((await call(ADMIN, 'POST', `/api/products/${productId}/media`, fixture('small.png'), { cookie: owner, origin: 'https://evil.example' })).status, 403);
    assert.equal((await call(SITE, 'POST', `/api/products/${productId}/media`, fixture('small.png'), { cookie: owner })).status, 404, 'there is no upload address on the shop');
    assert.equal((await call(ADMIN, 'POST', `/api/media/${list[0].id}`, { alt: 'x' }, { cookie: viewer })).status, 403);
    assert.equal((await call(ADMIN, 'POST', `/api/media/${list[0].id}/delete`, {}, { cookie: viewer })).status, 403);
    assert.equal((await call(ADMIN, 'POST', `/api/products/${productId}/media/order`, { ids: [] }, { cookie: viewer })).status, 403);
    assert.equal(await count(), before);
    assert.deepEqual(readdirSync(join(dir, 'tmp')), [], 'refused uploads were not even saved');
    const log = await db.query("select summary from activity_log where summary like '%photo%' or summary like '%video%' order by id");
    const lines = log.rows.map((r) => String(r.summary));
    for (const expected of ['Added a photo to "Bone straight wig"', 'Added a video to "Bone straight wig"', 'Reordered the photos of "Bone straight wig"', 'Edited a photo of "Bone straight wig"', 'Removed a photo from "Bone straight wig"']) assert.ok(lines.includes(expected), expected);
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, hostnameOf } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createLogger } from './logger.js';
import { HttpError } from './http.js';
import { Router } from './router.js';
import { siteRoutes } from './routes/site.js';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function startApp(config: Config, routers?: Parameters<typeof createApp>[2]['routers']): Promise<{ server: Server; port: number; logs: string[] }> {
  const logs: string[] = [];
  const logger = createLogger('debug', (_level, line) => logs.push(line));
  const server = createServer(createApp(config, logger, { version: '9.9.9', routers }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, logs });
    });
  });
}

function send(port: number, host: string, path: string, method = 'GET', headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('hostnameOf', () => {
  test('strips ports and lower-cases', () => {
    assert.equal(hostnameOf('Admin.Localhost:3000'), 'admin.localhost');
    assert.equal(hostnameOf('hairbydemj.com'), 'hairbydemj.com');
    assert.equal(hostnameOf('[::1]:3000'), '[::1]');
    assert.equal(hostnameOf(undefined), '');
  });
});

describe('server', () => {
  let publicDir: string;
  let port: number;
  let server: Server;
  let logs: string[];

  before(async () => {
    publicDir = mkdtempSync(join(tmpdir(), 'hbd-public-'));
    writeFileSync(join(publicDir, 'style.css'), 'body{margin:0}');
    writeFileSync(join(publicDir, '.env'), 'SECRET=1');

    const site = siteRoutes()
      .get('/boom', () => {
        throw new Error('kaboom');
      })
      .get('/teapot', () => {
        throw new HttpError(418, 'I am a teapot');
      });
    const config = loadConfig({ PUBLIC_DIR: publicDir });
    ({ server, port, logs } = await startApp(config, { site }));
  });

  after(() => {
    server.close();
    rmSync(publicDir, { recursive: true, force: true });
  });

  test('serves the website, admin and API on their own hostnames', async () => {
    const site = await send(port, 'localhost:3000', '/');
    assert.equal(site.status, 200);
    assert.match(String(site.headers['content-type']), /text\/html/);
    assert.match(site.body, /<h1>hairbydemj<\/h1>/);

    const admin = await send(port, 'admin.localhost', '/');
    assert.equal(admin.status, 200);
    assert.match(admin.body, /hairbydemj admin/);

    const api = await send(port, 'api.localhost', '/v1');
    assert.equal(api.status, 200);
    assert.deepEqual(JSON.parse(api.body), { name: 'hairbydemj API', version: 1 });
  });

  test('answers the health check on every hostname', async () => {
    for (const host of ['localhost', 'admin.localhost', 'api.localhost']) {
      const reply = await send(port, host, '/health');
      assert.equal(reply.status, 200);
      const body = JSON.parse(reply.body) as { status: string; version: string; uptimeSeconds: number };
      assert.equal(body.status, 'ok');
      assert.equal(body.version, '9.9.9');
      assert.equal(typeof body.uptimeSeconds, 'number');
    }
    const post = await send(port, 'api.localhost', '/health', 'POST');
    assert.equal(post.status, 405);
  });

  test('refuses unknown hostnames', async () => {
    const reply = await send(port, 'evil.example', '/');
    assert.equal(reply.status, 404);
    assert.deepEqual(JSON.parse(reply.body), { error: { status: 404, message: 'Unknown host' } });
  });

  test('returns HTML errors on the website and JSON errors on the API', async () => {
    const site = await send(port, 'localhost', '/missing');
    assert.equal(site.status, 404);
    assert.match(String(site.headers['content-type']), /text\/html/);

    const api = await send(port, 'api.localhost', '/missing');
    assert.equal(api.status, 404);
    assert.deepEqual(JSON.parse(api.body), { error: { status: 404, message: 'Page not found' } });
  });

  test('returns 405 with the allowed methods', async () => {
    const reply = await send(port, 'api.localhost', '/v1', 'DELETE');
    assert.equal(reply.status, 405);
    assert.equal(reply.headers['allow'], 'GET, HEAD');
  });

  test('answers HEAD requests without a body', async () => {
    const reply = await send(port, 'localhost', '/', 'HEAD');
    assert.equal(reply.status, 200);
    assert.equal(reply.body, '');
  });

  test('serves static files with caching headers', async () => {
    const reply = await send(port, 'localhost', '/style.css');
    assert.equal(reply.status, 200);
    assert.match(String(reply.headers['content-type']), /text\/css/);
    assert.equal(reply.body, 'body{margin:0}');
    const etag = String(reply.headers['etag']);
    const again = await send(port, 'localhost', '/style.css', 'GET', { 'If-None-Match': etag });
    assert.equal(again.status, 304);
  });

  test('does not serve hidden files or files outside the public folder', async () => {
    assert.equal((await send(port, 'localhost', '/.env')).status, 404);
    assert.equal((await send(port, 'localhost', '/../package.json')).status, 404);
    assert.equal((await send(port, 'localhost', '/%2e%2e/package.json')).status, 404);
    assert.equal((await send(port, 'localhost', '/%2e%2e%2fpackage.json')).status, 404);
  });

  test('does not serve static files on the API hostname', async () => {
    assert.equal((await send(port, 'api.localhost', '/style.css')).status, 404);
  });

  test('turns errors into clean responses and logs them', async () => {
    const teapot = await send(port, 'localhost', '/teapot');
    assert.equal(teapot.status, 418);

    const boom = await send(port, 'localhost', '/boom');
    assert.equal(boom.status, 500);
    assert.match(boom.body, /kaboom/); // detail shown in development only
    assert.ok(logs.some((line) => line.includes('"unhandled error"') && line.includes('kaboom')));
  });

  test('tags every response with a request id and logs the request', async () => {
    const reply = await send(port, 'localhost', '/');
    const id = String(reply.headers['x-request-id']);
    assert.match(id, /^[0-9a-f-]{36}$/);
    await new Promise((r) => setTimeout(r, 10));
    const entry = logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((e) => e['requestId'] === id && e['message'] === 'request');
    assert.ok(entry);
    assert.equal(entry['status'], 200);
    assert.equal(entry['area'], 'site');
  });
});

describe('production errors', () => {
  test('hide internal error details', async () => {
    const site = new Router().get('/boom', () => {
      throw new Error('database password is wrong');
    });
    const { server, port } = await startApp(loadConfig({ NODE_ENV: 'production' }), { site });
    try {
      const reply = await send(port, 'hairbydemj.com', '/boom');
      assert.equal(reply.status, 500);
      assert.doesNotMatch(reply.body, /password/);
      assert.match(reply.body, /Something went wrong/);
    } finally {
      server.close();
    }
  });
});

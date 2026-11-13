// Runs the whole shop for the browser journeys (module 20): a fresh test
// database with the sample data, the real website, admin and API on one
// port, and a stand-in for Paystack that "pays" when the browser visits its
// payment page. Emails are kept in memory so tests can read codes.

import { createHmac } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountDeps, type AccountDeps } from '../accounts/deps.js';
import { memoryMailer } from '../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../accounts/oidc.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';

export const PAYSTACK_SECRET = 'sk_test_e2e';

export interface Shop {
  db: Db;
  deps: AccountDeps;
  mail: ReturnType<typeof memoryMailer>;
  site: string;
  admin: string;
  /** Paystack payments the stand-in has seen, by reference. */
  paystack: Map<string, { amount: number; currency: string; callback: string; paid: boolean }>;
  stop(): Promise<void>;
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

export async function startShop(): Promise<Shop> {
  const paystack: Shop['paystack'] = new Map();

  // The stand-in for Paystack's API and its payment page.
  const fake = createServer(async (req, res) => {
    const text = await body(req);
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, value: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    };
    const pay = /^\/pay\/(.+)$/.exec(url.pathname);
    if (pay) {
      const found = paystack.get(decodeURIComponent(pay[1] ?? ''));
      if (!found) return void res.writeHead(404).end('no such payment');
      found.paid = true;
      // Like Paystack, tell the shop by a signed webhook, then send the customer back.
      const event = JSON.stringify({ event: 'charge.success', data: { reference: decodeURIComponent(pay[1] ?? ''), status: 'success', amount: found.amount, currency: found.currency, channel: 'card', authorization: { card_type: 'visa', last4: '4081' } } });
      await new Promise<void>((resolve) => {
        const hook = request({ host: '127.0.0.1', port, path: '/webhooks/paystack', method: 'POST', headers: { Host: 'api.localhost', 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', PAYSTACK_SECRET).update(event).digest('hex') } }, (r) => {
          const parts: Buffer[] = [];
          r.on('data', (c: Buffer) => parts.push(c));
          r.on('end', () => {
            if (process.env.E2E_SHOTS) console.log(`  webhook ${r.statusCode} ${Buffer.concat(parts).toString('utf8').slice(0, 300)}`);
            resolve();
          });
        });
        hook.on('error', () => resolve());
        hook.end(event);
      });
      return void res.writeHead(302, { Location: found.callback }).end();
    }
    if (req.headers.authorization !== `Bearer ${PAYSTACK_SECRET}`) return json(401, { status: false, message: 'Invalid key' });
    if (url.pathname === '/transaction/initialize') {
      const input = JSON.parse(text) as { reference: string; amount: number; currency: string; callback_url: string };
      paystack.set(input.reference, { amount: Number(input.amount), currency: input.currency, callback: input.callback_url, paid: false });
      return json(200, { status: true, data: { authorization_url: `http://127.0.0.1:${fakePort}/pay/${encodeURIComponent(input.reference)}`, access_code: `ac_${input.reference}`, reference: input.reference } });
    }
    const verify = /^\/transaction\/verify\/(.+)$/.exec(url.pathname);
    if (verify) {
      const reference = decodeURIComponent(verify[1] ?? '');
      const found = paystack.get(reference);
      if (!found) return json(404, { status: false, message: 'Transaction reference not found' });
      return json(200, { status: true, data: { reference, status: found.paid ? 'success' : 'ongoing', amount: found.amount, currency: found.currency, channel: 'card', authorization: { card_type: 'visa', last4: '4081' } } });
    }
    return json(404, { status: false, message: 'not found' });
  });
  const fakePort = await listen(fake);

  const testDb: TestDatabase = await createTestDatabase();
  const db = createPool(testDb.url, { max: 10 });
  await migrate(db, 'db/migrations');
  await db.query(readFileSync('db/seeds/dev.sql', 'utf8'));

  // Links the server builds (such as Paystack's return address) carry the
  // port, so pick a free one first and give it to the settings.
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));

  const mediaDir = mkdtempSync(join(tmpdir(), 'hbd-e2e-'));
  const config = loadConfig({
    PORT: String(port),
    MEDIA_DIR: mediaDir,
    PUBLIC_DIR: 'public',
    PAYSTACK_SECRET_KEY: PAYSTACK_SECRET,
    PAYSTACK_PUBLIC_KEY: 'pk_test_e2e',
    PAYSTACK_API_URL: `http://127.0.0.1:${fakePort}`,
  });
  const mail = memoryMailer();
  const deps = accountDeps({
    db,
    config,
    mail,
    identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
  });
  const logger = createLogger('error', () => undefined);
  const server = createServer(createApp(config, logger, { version: 'e2e', accounts: deps, media: { db, now: () => new Date(), logger, mediaDir } }));
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));

  return {
    db,
    deps,
    mail,
    site: `http://localhost:${port}`,
    admin: `http://admin.localhost:${port}`,
    paystack,
    async stop() {
      server.closeAllConnections();
      server.close();
      fake.close();
      await db.end();
      await testDb.drop();
      rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}

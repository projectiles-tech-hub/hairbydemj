import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import { createServer as createH2Server, type Http2Server } from 'node:http2';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { signUp, verifyEmail } from '../accounts/customers.js';
import { accountDeps, type AccountDeps } from '../accounts/deps.js';
import { memoryMailer } from '../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../accounts/oidc.js';
import { signedInStaff } from '../accounts/testing.js';
import { createApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { orderEvent } from '../payments/order-paid.js';
import { HANDLERS } from '../worker/tasks.js';
import { runOneJob } from '../worker/worker.js';
import { buildMessage, dkimSign, encodeAddress, encodeHeader, relaxedBody, relaxedHeader } from './mime.js';
import { deliverEmail, readUnsubscribeToken, unsubscribeToken, type NotifyDeps } from './notify.js';
import { apns, fcm } from './push.js';
import { sendSmtp } from './smtp.js';
import { fill, layoutHtml } from './templates.js';

const dkimKeys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const appleKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const googleKeys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

/** An independent DKIM check, written from RFC 6376, as a receiving inbox would do it. */
function checkDkim(message: string, publicKey: string): { bodyOk: boolean; signatureOk: boolean } {
  const split = message.indexOf('\r\n\r\n');
  const head = message.slice(0, split);
  const body = message.slice(split + 4);
  const fields = head.split(/\r\n(?![ \t])/).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)] as [string, string]);
  const sigField = fields.find(([n]) => n.toLowerCase() === 'dkim-signature') as [string, string];
  const tags = Object.fromEntries(sigField[1].replace(/\r\n[ \t]/g, '').split(';').map((t) => t.trim()).filter(Boolean).map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1).replace(/\s+/g, '')])) as Record<string, string>;
  const bodyHash = createHash('sha256').update(relaxedBody(body)).digest('base64');
  const signed = (tags.h ?? '').split(':').map((name) => {
    const f = [...fields].reverse().find(([n]) => n.toLowerCase() === name) as [string, string];
    return relaxedHeader(f[0], f[1]);
  });
  const emptied = sigField[1].replace(/b=[^;]*$/, 'b=');
  signed.push(relaxedHeader(sigField[0], emptied));
  return { bodyOk: bodyHash === tags.bh, signatureOk: verify('sha256', Buffer.from(signed.join('\r\n')), createPublicKey(publicKey), Buffer.from(tags.b ?? '', 'base64')) };
}

test('headers with naira signs and accents are encoded; plain ones are left alone', () => {
  assert.equal(encodeHeader('Order HBD-10001 received'), 'Order HBD-10001 received');
  const encoded = encodeHeader('Your ₦99,000 store credit');
  assert.match(encoded, /^=\?UTF-8\?B\?/);
  const decoded = encoded.split('\r\n ').map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
  assert.equal(decoded, 'Your ₦99,000 store credit');
  assert.equal(encodeAddress('hairbydemj <hello@hairbydemj.com>'), '"hairbydemj" <hello@hairbydemj.com>');
  assert.equal(encodeAddress('ada@example.com'), 'ada@example.com');
});

test('relaxed canonicalisation follows RFC 6376 section 3.4.5', () => {
  assert.equal(relaxedHeader('Subject', ' A  b\r\n\tc '), 'subject:A b c');
  assert.equal(relaxedBody(' C \r\nD \t E\r\n\r\n\r\n'), ' C\r\nD E\r\n');
  assert.equal(relaxedBody('\r\n\r\n'), '');
});

test('a signed email passes a DKIM check, and fails it once changed', () => {
  const message = buildMessage({ from: 'hairbydemj <hello@hairbydemj.com>', to: 'ada@example.com', subject: 'Order HBD-10001 received', text: 'Thank you.\n.\nA line with a dot', html: '<p>Thank you</p>', headers: { 'List-Unsubscribe': '<https://hairbydemj.com/unsubscribe?t=x>' }, date: new Date('2026-06-01T09:00:00Z'), domain: 'hairbydemj.com' });
  const signed = dkimSign(message, { domain: 'hairbydemj.com', selector: 'mail', privateKey: dkimKeys.privateKey, now: new Date('2026-06-01T09:00:00Z') });
  assert.match(signed, /^DKIM-Signature: v=1;\r\n\ta=rsa-sha256;\r\n\tc=relaxed\/relaxed;\r\n\td=hairbydemj.com;\r\n\ts=mail;/);
  assert.match(signed, /h=from:to:subject:date:message-id:mime-version:content-type:list-unsubscribe;/);
  assert.deepEqual(checkDkim(signed, dkimKeys.publicKey), { bodyOk: true, signatureOk: true });
  assert.deepEqual(checkDkim(signed.replace('Order HBD-10001 received', 'Order HBD-99999 received'), dkimKeys.publicKey), { bodyOk: true, signatureOk: false });
  const tamperedBody = signed.replace(/(\r\n\r\n[\s\S]*?base64\r\n\r\n)(.)/, (_m, a: string, b: string) => `${a}${b === 'A' ? 'B' : 'A'}`);
  assert.equal(checkDkim(tamperedBody, dkimKeys.publicKey).bodyOk, false);
});

test('customer details are escaped in emails; unknown words are left empty', () => {
  assert.equal(fill('Hi {{firstName}}, {{nothing}}done', { firstName: 'Ada' }), 'Hi Ada, done');
  const html = layoutHtml({ subject: 's', heading: 'Hi <b>', paragraphs: ['<script>alert(1)</script>'], button: { label: 'Go', url: 'https://x/?a=1&b="2"' } }, { address: 'hairbydemj', unsubscribeUrl: null, preferencesUrl: 'https://x' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('href="https://x/?a=1&amp;b=&quot;2&quot;"'));
});

test('unsubscribe links are signed for one address and cannot be changed', () => {
  const config = loadConfig({});
  const token = unsubscribeToken(config, 'Ada@Example.com');
  assert.equal(readUnsubscribeToken(config, token), 'ada@example.com');
  const other = `${Buffer.from('eve@example.com').toString('base64url')}.${token.split('.')[1]}`;
  assert.equal(readUnsubscribeToken(config, other), null);
  assert.equal(readUnsubscribeToken(config, 'nonsense'), null);
});

// ----- a stand-in mail server -----

interface Received {
  lines: string[];
  from: string;
  to: string;
  data: string;
}

function fakeSmtp(answers: { rcpt?: string } = {}): Promise<{ server: TcpServer; port: number; received: Received[]; setRcpt(reply: string | undefined): void }> {
  const received: Received[] = [];
  let rcptReply = answers.rcpt;
  const server = createTcpServer((socket: Socket) => {
    const mail: Received = { lines: [], from: '', to: '', data: '' };
    let inData = false;
    let buffer = '';
    socket.write('220 fake.mail ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(mail);
            socket.write('250 2.0.0 queued as ABC123\r\n');
          } else mail.data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          continue;
        }
        mail.lines.push(line);
        if (/^EHLO /i.test(line)) socket.write('250-fake.mail\r\n250-PIPELINING\r\n250 8BITMIME\r\n');
        else if (/^MAIL FROM:/i.test(line)) {
          mail.from = line.slice(10).replace(/[<>]/g, '');
          socket.write('250 OK\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          mail.to = line.slice(8).replace(/[<>]/g, '');
          socket.write(rcptReply ? `${rcptReply}\r\n` : '250 OK\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('502 not here\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received, setRcpt: (r) => (rcptReply = r) })));
}

test('the SMTP client hands over an email exactly, with dots kept, and reports refusals', async () => {
  const smtp = await fakeSmtp();
  try {
    const message = 'Subject: hi\r\n\r\nline one\r\n.starts with a dot\r\n..two dots\r\nend';
    const sent = await sendSmtp({ host: '127.0.0.1', port: smtp.port, heloName: 'hairbydemj.com' }, { from: 'hello@hairbydemj.com', to: 'ada@example.com' }, message);
    assert.equal(sent.reply, '2.0.0 queued as ABC123');
    const got = smtp.received[0] as Received;
    assert.deepEqual([got.lines[0], got.from, got.to], ['EHLO hairbydemj.com', 'hello@hairbydemj.com', 'ada@example.com']);
    assert.equal(got.data, `${message}\r\n`);
    smtp.setRcpt('550 5.1.1 no such user');
    await assert.rejects(sendSmtp({ host: '127.0.0.1', port: smtp.port, heloName: 'x' }, { from: 'a@b.c', to: 'nobody@example.com' }, 'Subject: x\r\n\r\ny'), (e: { code: number; permanent: boolean }) => e.code === 550 && e.permanent);
    smtp.setRcpt('451 4.3.0 try later');
    await assert.rejects(sendSmtp({ host: '127.0.0.1', port: smtp.port, heloName: 'x' }, { from: 'a@b.c', to: 'later@example.com' }, 'Subject: x\r\n\r\ny'), (e: { permanent: boolean }) => !e.permanent);
    await assert.rejects(sendSmtp({ host: '127.0.0.1', port: 1, heloName: 'x', timeoutMs: 2000 }, { from: 'a@b.c', to: 'd@e.f' }, 'x'), /Could not reach/);
  } finally {
    smtp.server.close();
  }
});

// ----- stand-in Apple and Google push services -----

test('Apple push: a signed request per phone; a phone without the app is reported', async () => {
  const seen: Array<{ path: string; headers: Record<string, unknown>; body: string }> = [];
  const h2: Http2Server = createH2Server();
  h2.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (c: string) => (body += c));
    stream.on('end', () => {
      seen.push({ path: String(headers[':path']), headers, body });
      const token = String(headers[':path']).split('/').pop();
      if (token === 'dead'.repeat(16)) {
        stream.respond({ ':status': 410 });
        stream.end(JSON.stringify({ reason: 'Unregistered' }));
      } else {
        stream.respond({ ':status': 200 });
        stream.end();
      }
    });
  });
  await new Promise<void>((resolve) => h2.listen(0, '127.0.0.1', resolve));
  const sender = apns({ keyId: 'ABC123DEFG', teamId: 'TEAM123456', privateKey: appleKeys.privateKey, bundleId: 'com.hairbydemj.app', url: `http://127.0.0.1:${(h2.address() as AddressInfo).port}` });
  try {
    assert.deepEqual(await sender.send('ab'.repeat(32), { title: 'On its way: HBD-10001', body: 'Your order is on its way.', link: '/orders/HBD-10001' }), { result: 'sent' });
    assert.equal((await sender.send('dead'.repeat(16), { title: 't', body: 'b' })).result, 'invalid_token');
    assert.equal((await sender.send('not-hex', { title: 't', body: 'b' })).result, 'invalid_token');
    const first = seen[0]!;
    assert.equal(first.path, `/3/device/${'ab'.repeat(32)}`);
    assert.deepEqual([first.headers['apns-topic'], first.headers['apns-push-type']], ['com.hairbydemj.app', 'alert']);
    assert.deepEqual(JSON.parse(first.body), { aps: { alert: { title: 'On its way: HBD-10001', body: 'Your order is on its way.' }, sound: 'default' }, link: '/orders/HBD-10001' });
    // The token is a JWT signed with our key (ES256), naming our key and team.
    const [h, c, s] = String(first.headers.authorization).replace('bearer ', '').split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
    assert.equal(JSON.parse(Buffer.from(c!, 'base64url').toString()).iss, 'TEAM123456');
    assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: createPublicKey(appleKeys.publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url')));
    assert.equal(seen[1]?.headers.authorization, first.headers.authorization, 'the token is reused');
  } finally {
    sender.close();
    h2.close();
  }
});

test('Google push: logs in with the service account, sends, and reports a phone without the app', async () => {
  let logins = 0;
  const sent: Array<Record<string, any>> = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') {
        const assertion = new URLSearchParams(body).get('assertion') ?? '';
        const [h, c, s] = assertion.split('.');
        const ok = verify('sha256', Buffer.from(`${h}.${c}`), createPublicKey(googleKeys.publicKey), Buffer.from(s ?? '', 'base64url'));
        const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString());
        if (!ok || claims.iss !== 'push@hairbydemj.iam.gserviceaccount.com' || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging') {
          res.statusCode = 401;
          return res.end('{}');
        }
        logins += 1;
        return res.end(JSON.stringify({ access_token: 'google-token', expires_in: 3599 }));
      }
      if (req.url === '/v1/projects/hairbydemj/messages:send' && req.headers.authorization === 'Bearer google-token') {
        const message = JSON.parse(body).message;
        sent.push(message);
        if (message.token === 'gone-token-000000000000') {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }));
        }
        return res.end(JSON.stringify({ name: 'projects/hairbydemj/messages/1' }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sender = fcm({ projectId: 'hairbydemj', clientEmail: 'push@hairbydemj.iam.gserviceaccount.com', privateKey: googleKeys.privateKey, apiUrl: base, tokenUrl: `${base}/token` });
  try {
    assert.deepEqual(await sender.send('android-token-1234567890', { title: 'Delivered: HBD-10001', body: 'Your order has been delivered.', link: '/orders/HBD-10001' }), { result: 'sent' });
    assert.equal((await sender.send('gone-token-000000000000', { title: 't', body: 'b' })).result, 'invalid_token');
    assert.equal(logins, 1, 'one login for both');
    assert.deepEqual(sent[0], { token: 'android-token-1234567890', notification: { title: 'Delivered: HBD-10001', body: 'Your order has been delivered.' }, data: { link: '/orders/HBD-10001' }, android: { priority: 'high' } });
  } finally {
    server.close();
  }
});

// ----- over HTTP and through the worker -----

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

describe('notifications with the database', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let config: Config;
  let server: Server;
  let port: number;
  let smtp: Awaited<ReturnType<typeof fakeSmtp>>;
  let h2: Http2Server;
  let notify: NotifyDeps;
  let owner = '';
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const pushes: string[] = [];
  const mail = memoryMailer();
  const quiet = createLogger('error', () => undefined);

  function call(host: string, method: string, path: string, body?: unknown, options: { cookie?: string; headers?: Record<string, string>; raw?: string } = {}): Promise<{ status: number; body: Record<string, any>; text: string }> {
    const headers: Record<string, string> = { Host: host, ...(options.headers ?? {}) };
    if ((host === 'localhost' || host === 'admin.localhost') && !options.raw) headers.Origin = `http://${host}`;
    const payload = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
    if (payload !== undefined && !options.raw) headers['Content-Type'] = 'application/json';
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
          resolve({ status: res.statusCode ?? 0, body: parsed, text });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const worker = () => ({ db, now: () => clock, logger: quiet, config, mail, notify, fetchRates: async () => ({}) }) as never;

  before(async () => {
    smtp = await fakeSmtp();
    h2 = createH2Server();
    h2.on('stream', (stream, headers) => {
      stream.resume();
      stream.on('end', () => {
        pushes.push(String(headers[':path']).split('/').pop() ?? '');
        stream.respond({ ':status': String(headers[':path']).endsWith('dead'.repeat(16)) ? 410 : 200 });
        stream.end();
      });
    });
    await new Promise<void>((resolve) => h2.listen(0, '127.0.0.1', resolve));
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    config = loadConfig({ MAIL_TRANSPORT: 'smtp', SMTP_PORT: String(smtp.port), MAIL_FROM: 'hairbydemj <hello@hairbydemj.com>', DKIM_DOMAIN: 'hairbydemj.com', DKIM_PRIVATE_KEY: dkimKeys.privateKey.replace(/\n/g, '\\n') });
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    notify = {
      db, now: () => clock, logger: quiet, config,
      push: {
        ios: apns({ keyId: 'ABC123DEFG', teamId: 'TEAM123456', privateKey: appleKeys.privateKey, bundleId: 'com.hairbydemj.app', url: `http://127.0.0.1:${(h2.address() as AddressInfo).port}` }),
        android: fcm({ projectId: '', clientEmail: '', privateKey: '', apiUrl: 'http://x', tokenUrl: 'http://x' }),
      },
    };
    server = createServer(createApp(config, quiet, { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel', email: 'owner@hairbydemj.test' })).cookie;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    (notify.push.ios as ReturnType<typeof apns>).close();
    h2.close();
    smtp.server.close();
    await db.end();
    await testDb.drop();
  });

  test('a queued email is signed, sent through the mail server, and passes DKIM', async () => {
    await db.query("insert into jobs (kind, payload, run_at) values ('email.send', $1, $2)", [JSON.stringify({ to: 'Ada@Example.com', template: 'order_confirmation', data: { orderNumber: 'HBD-10001', orderToken: 'tok' } }), clock]);
    const before = smtp.received.length;
    assert.equal(await runOneJob(worker(), 'w', { 'email.send': HANDLERS['email.send']! }), true);
    const got = smtp.received[before] as Received;
    assert.deepEqual([got.from, got.to], ['hello@hairbydemj.com', 'ada@example.com']);
    assert.match(got.data, /^DKIM-Signature: /);
    assert.match(got.data, /\r\nSubject: Order HBD-10001 received\r\n/);
    assert.deepEqual(checkDkim(got.data, dkimKeys.publicKey), { bodyOk: true, signatureOk: true });
    const html = Buffer.from(got.data.split('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1]?.split('\r\n--')[0]?.replace(/\r\n/g, '') ?? '', 'base64').toString();
    assert.match(html, /track-order\/\?order=HBD-10001&amp;token=tok/);
    assert.equal((await db.query("select status from jobs where kind = 'email.send' order by id desc limit 1")).rows[0]?.status, 'done');
  });

  test('a refused address is not tried again; a busy mail server is', async () => {
    smtp.setRcpt('550 5.1.1 no such user');
    await db.query("insert into jobs (kind, payload, run_at) values ('email.send', $1, $2)", [JSON.stringify({ to: 'nobody@example.com', template: 'password_changed', data: {} }), clock]);
    await runOneJob(worker(), 'w', { 'email.send': HANDLERS['email.send']! });
    assert.equal((await db.query("select status from jobs where kind = 'email.send' order by id desc limit 1")).rows[0]?.status, 'failed');
    smtp.setRcpt('451 4.3.0 try later');
    await db.query("insert into jobs (kind, payload, run_at) values ('email.send', $1, $2)", [JSON.stringify({ to: 'later@example.com', template: 'password_changed', data: {} }), clock]);
    await runOneJob(worker(), 'w', { 'email.send': HANDLERS['email.send']! });
    assert.equal((await db.query("select status from jobs where kind = 'email.send' order by id desc limit 1")).rows[0]?.status, 'queued');
    smtp.setRcpt(undefined);
  });

  test('preferences, the newsletter and unsubscribing decide which emails go', async () => {
    await signUp(deps, { email: 'nkem@example.com', password: 'longenough' }, { ip: null });
    const nkem = await verifyEmail(deps, { email: 'nkem@example.com', code: mail.last('verify_email', 'nkem@example.com').data.code }, { ip: null });
    const auth = { Authorization: `Bearer ${nkem.token}` };
    const prefs = (await call('api.localhost', 'GET', '/v1/account/notifications', undefined, { headers: auth })).body.preferences;
    assert.deepEqual(prefs, { ordersEmail: true, ordersPush: true, offersEmail: false, offersPush: false, backInStockEmail: true, backInStockPush: true });
    assert.equal(await deliverEmail(notify, { to: 'nkem@example.com', template: 'abandoned_cart', data: { firstName: 'Nkem', itemCount: '1' } }), 'skipped', 'no offers without agreeing');
    const on = (await call('api.localhost', 'POST', '/v1/account/notifications', { offersEmail: true, ordersEmail: false }, { headers: auth })).body.preferences;
    assert.deepEqual([on.offersEmail, on.ordersEmail], [true, false]);
    assert.equal((await db.query('select marketing_consent from customers where id = $1', [nkem.customer.id])).rows[0]?.marketing_consent, true);
    assert.equal(await deliverEmail(notify, { to: 'nkem@example.com', template: 'order_update', data: { orderNumber: 'HBD-1', title: 'On its way', summary: 'x' } }), 'skipped', 'order progress turned off');
    assert.equal(await deliverEmail(notify, { to: 'nkem@example.com', template: 'order_confirmation', data: { orderNumber: 'HBD-1', orderToken: 'x' } }), 'sent', 'confirmations always go');
    const before = smtp.received.length;
    assert.equal(await deliverEmail(notify, { to: 'nkem@example.com', template: 'abandoned_cart', data: { firstName: 'Nkem', itemCount: '1' } }), 'sent');
    const offer = smtp.received[before] as Received;
    const link = /List-Unsubscribe: <([^>]+)>/.exec(offer.data)?.[1] ?? '';
    assert.match(offer.data, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
    const path = new URL(link).pathname + new URL(link).search;

    // The page asks first; the one-click address (and the button) unsubscribe.
    const shown = await call('localhost', 'GET', path);
    assert.equal(shown.status, 200);
    assert.match(shown.text, /nkem@example\.com/);
    assert.equal((await call('localhost', 'GET', '/unsubscribe?t=forged.token')).status, 400);
    const done = await call('localhost', 'POST', path, undefined, { raw: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(done.status, 200);
    assert.equal((await db.query('select marketing_consent from customers where id = $1', [nkem.customer.id])).rows[0]?.marketing_consent, false);
    assert.equal(await deliverEmail(notify, { to: 'nkem@example.com', template: 'abandoned_cart', data: {} }), 'skipped');

    // The newsletter: one welcome per address, and not after unsubscribing.
    assert.equal((await call('localhost', 'POST', '/api/newsletter', { email: 'not-an-email' })).status, 422);
    assert.equal((await call('localhost', 'POST', '/api/newsletter', { email: 'fan@example.com' })).status, 200);
    assert.equal((await call('localhost', 'POST', '/api/newsletter', { email: 'FAN@example.com' })).status, 200);
    const welcomes = await db.query("select payload from jobs where unique_key = 'newsletter_welcome:fan@example.com'");
    assert.equal(welcomes.rows.length, 1);
    assert.equal(await deliverEmail(notify, welcomes.rows[0]?.payload), 'sent');
  });

  test('order updates reach the in-app list, the phone and the inbox; a phone without the app is forgotten', async () => {
    await signUp(deps, { email: 'tobi@example.com', password: 'longenough' }, { ip: null });
    const tobi = await verifyEmail(deps, { email: 'tobi@example.com', code: mail.last('verify_email', 'tobi@example.com').data.code }, { ip: null });
    const auth = { Authorization: `Bearer ${tobi.token}` };
    assert.equal((await call('api.localhost', 'POST', '/v1/push/devices', { platform: 'ios', token: 'ab'.repeat(32) }, { headers: auth })).status, 200);
    assert.equal((await call('api.localhost', 'POST', '/v1/push/devices', { platform: 'ios', token: 'dead'.repeat(16) }, { headers: auth })).status, 200);
    assert.equal((await call('api.localhost', 'POST', '/v1/push/devices', { platform: 'windows', token: 'x'.repeat(30) }, { headers: auth })).status, 422);
    const order = await db.query("insert into orders (customer_id, email, currency, subtotal_minor, total_minor) values ($1, 'tobi@example.com', 'NGN', 100, 100) returning id, number", [tobi.customer.id]);
    const orderId = Number(order.rows[0]?.id);
    await orderEvent(db, orderId, 'shipment_in_transit', 'Your order is on its way.', { visible: true });
    await orderEvent(db, orderId, 'note', 'Staff note', {});
    const queued = await db.query("select id, payload from jobs where kind = 'order_update' order by id desc");
    assert.equal(queued.rows.length, 1, 'only events the customer sees are sent');
    await db.query('update jobs set run_at = $1 where id = $2', [clock, queued.rows[0]?.id]);
    await runOneJob(worker(), 'w', { order_update: HANDLERS.order_update! });
    assert.deepEqual(pushes.slice(-2).sort(), ['ab'.repeat(32), 'dead'.repeat(16)].sort());
    assert.deepEqual((await db.query('select token from push_devices where customer_id = $1', [tobi.customer.id])).rows, [{ token: 'ab'.repeat(32) }]);
    const list = (await call('api.localhost', 'GET', '/v1/notifications', undefined, { headers: auth })).body;
    assert.equal(list.unread, 1);
    assert.equal(list.notifications[0].title, `On its way: ${String(order.rows[0]?.number)}`);
    const email = await db.query("select payload from jobs where kind = 'email.send' and payload->>'template' = 'order_update' order by id desc limit 1");
    assert.deepEqual(email.rows[0]?.payload.data, { orderNumber: String(order.rows[0]?.number), title: 'On its way', summary: 'Your order is on its way.' });
    assert.equal((await call('api.localhost', 'POST', '/v1/notifications/read', { all: true }, { headers: auth })).body.unread, 0);
    assert.equal((await call('api.localhost', 'POST', '/v1/push/devices/delete', { token: 'ab'.repeat(32) }, { headers: auth })).status, 200);
    assert.equal((await db.query('select count(*)::int as n from push_devices where customer_id = $1', [tobi.customer.id])).rows[0]?.n, 0);
  });

  test('staff change an email\'s wording, preview it and send a test; sign-in emails stay on', async () => {
    const list = (await call('admin.localhost', 'GET', '/api/messages', undefined, { cookie: owner })).body.messages;
    assert.ok(list.some((m: any) => m.key === 'order_confirmation' && m.changed === false));
    const changed = (await call('admin.localhost', 'POST', '/api/messages/order_confirmation', { subject: 'We have your order {{orderNumber}}', intro: 'Thank you! Order {{orderNumber}} is with us.' }, { cookie: owner })).body.messages;
    assert.equal(changed.find((m: any) => m.key === 'order_confirmation').changed, true);
    const preview = await call('admin.localhost', 'GET', '/api/messages/order_confirmation/preview', undefined, { cookie: owner });
    assert.match(preview.text, /Thank you! Order HBD-10001 is with us\./);
    assert.equal((await call('admin.localhost', 'POST', '/api/messages/verify_email', { emailEnabled: false }, { cookie: owner })).status, 422);
    assert.equal((await call('admin.localhost', 'POST', '/api/messages/nothing', {}, { cookie: owner })).status, 404);
    ok((await call('admin.localhost', 'POST', '/api/messages/abandoned_cart/test', {}, { cookie: owner })).status);
    const test = await db.query("select payload from jobs where payload->>'template' = 'abandoned_cart' and payload->>'test' = 'true' order by id desc limit 1");
    assert.equal(test.rows[0]?.payload.to, 'owner@hairbydemj.test');
    assert.equal(await deliverEmail(notify, test.rows[0]?.payload), 'sent', 'a test goes even without consent');
    // Putting the original wording back.
    await call('admin.localhost', 'POST', '/api/messages/order_confirmation', { subject: '', intro: '' }, { cookie: owner });
    assert.match((await call('admin.localhost', 'GET', '/api/messages/order_confirmation/preview', undefined, { cookie: owner })).text, /We have your order HBD-10001\. We will email you/);
    // Switching off a non-essential email stops it.
    await call('admin.localhost', 'POST', '/api/messages/back_in_stock', { emailEnabled: false }, { cookie: owner });
    assert.equal(await deliverEmail(notify, { to: 'x@example.com', template: 'back_in_stock', data: { productName: 'Wig', slug: 'wig', variant: '' } }), 'skipped');
  });

  function ok(status: number): void {
    assert.equal(status, 200);
  }
});

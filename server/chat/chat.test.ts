import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
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
import { closeQuietConversations } from './chat.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  text: string;
  body: Record<string, any>;
  headers: IncomingMessage['headers'];
}

describe('live chat', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  let clock = new Date('2026-06-01T09:00:00Z');
  const tick = (s: number): void => {
    clock = new Date(clock.getTime() + s * 1000);
  };
  const mail = memoryMailer();
  let owner = '';
  let visitor = '';
  let conversationId = 0;

  function call(host: string, method: string, path: string, body?: object, o: { cookie?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host, Origin: `http://${host}`, ...(o.headers ?? {}) };
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload) headers['Content-Type'] = 'application/json';
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
            // HTML
          }
          resolve({ status: res.statusCode ?? 0, text, body: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  const ok = (r: Reply, status = 200): Reply => {
    assert.equal(r.status, status, r.text.slice(0, 400));
    return r;
  };

  /** Opens an event stream and collects events until `count` have arrived. */
  function events(host: string, path: string, headers: Record<string, string>, count: number): { done: Promise<Array<{ event: string; data: any }>>; ready: Promise<void>; close: () => void } {
    const got: Array<{ event: string; data: any }> = [];
    let close: () => void = () => undefined;
    let ready: () => void = () => undefined;
    const readyP = new Promise<void>((r) => (ready = r));
    const done = new Promise<Array<{ event: string; data: any }>>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host, ...headers } }, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
        let buffer = '';
        res.on('data', (c: Buffer) => {
          buffer += c.toString('utf8');
          if (buffer.includes('retry:')) ready();
          let at: number;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (event && data) got.push({ event, data: JSON.parse(data) });
            if (got.length >= count) {
              req.destroy();
              resolve(got);
            }
          }
        });
      });
      req.on('error', (e) => (got.length >= count ? undefined : reject(e)));
      close = () => req.destroy();
      req.end();
    });
    return { done, ready: readyP, close };
  }

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 8 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({});
    deps = accountDeps({ db, config, mail, now: () => clock, passwordParams: { N: 1024, r: 8, p: 1 }, identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }) });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = (await signedInStaff(deps, tick, { name: 'Emmanuel Oraegbu', email: 'owner@hairbydemj.test' })).cookie;
    await db.query("insert into store_settings (key, value) values ('store', '{\"name\":\"hairbydemj\",\"supportEmail\":\"help@hairbydemj.com\",\"whatsapp\":\"+2348000000000\"}') on conflict (key) do update set value = excluded.value");
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  test('a visitor starts a chat; the browser keeps a chat cookie; nothing exists before the first message', async () => {
    const empty = ok(await call('localhost', 'GET', '/api/chat')).body;
    assert.equal(empty.conversation, null);
    assert.equal(empty.whatsapp, '+2348000000000');
    assert.equal((await call('localhost', 'GET', '/api/chat/events')).status, 404);
    assert.equal((await call('localhost', 'POST', '/api/chat/messages', { body: '  ' })).body.error.fields.body, 'Type a message.');
    const first = ok(await call('localhost', 'POST', '/api/chat/messages', { body: 'Do you ship to Canada?', name: 'Ngozi', email: 'ngozi@example.com' }), 201);
    visitor = String(first.headers['set-cookie']).split(';')[0] ?? '';
    assert.match(visitor, /^hbd_chat=[A-Za-z0-9_-]{40,}$/);
    assert.match(String(first.headers['set-cookie']), /HttpOnly; SameSite=Lax/);
    conversationId = first.body.conversation.id;
    assert.deepEqual(first.body.conversation.messages.map((m: any) => [m.sender, m.body]), [['customer', 'Do you ship to Canada?']]);
    const again = ok(await call('localhost', 'POST', '/api/chat/messages', { body: 'To Toronto.' }, { cookie: visitor }), 201).body;
    assert.equal(again.conversation.id, conversationId);
    assert.equal(again.conversation.messages.length, 2);
    // Without the cookie, it is someone else.
    assert.equal(ok(await call('localhost', 'GET', '/api/chat')).body.conversation, null);
  });

  test('staff see it in the inbox, reply, and the visitor\'s open page gets the reply at once', async () => {
    const list = ok(await call('admin.localhost', 'GET', '/api/chat/conversations', undefined, { cookie: owner })).body.conversations;
    assert.equal(list[0].name, 'Ngozi');
    assert.equal(list[0].unread, 2);
    assert.equal(list[0].lastBody, 'To Toronto.');
    const stream = events('localhost', '/api/chat/events', { Cookie: visitor }, 2);
    await stream.ready;
    const conv = ok(await call('admin.localhost', 'GET', `/api/chat/conversations/${conversationId}`, undefined, { cookie: owner })).body.conversation;
    assert.equal(conv.online, true);
    assert.equal(conv.email, 'ngozi@example.com');
    ok(await call('admin.localhost', 'POST', `/api/chat/conversations/${conversationId}/messages`, { body: 'Yes, by DHL in 3 to 5 days.' }, { cookie: owner }), 201);
    const all = await stream.done;
    // Staff opening it tells the page the messages were seen, then the reply arrives.
    assert.deepEqual(all.map((e) => e.event), ['read', 'message']);
    const got = all[1];
    assert.deepEqual([got?.data.message.sender, got?.data.message.staffName, got?.data.message.body], ['staff', 'Emmanuel', 'Yes, by DHL in 3 to 5 days.']);
    // The visitor was on the page, so no email.
    assert.equal(mail.sent.filter((m) => m.template === 'chat_reply').length, 0);
    assert.equal(ok(await call('admin.localhost', 'GET', '/api/chat/conversations', undefined, { cookie: owner })).body.conversations[0].unread, 0);
  });

  test('staff\'s inbox stream hears new customer messages; a reply to someone who left goes by email', async () => {
    const inbox = events('admin.localhost', '/api/chat/events', { Cookie: owner }, 1);
    await inbox.ready;
    ok(await call('localhost', 'POST', '/api/chat/messages', { body: 'And duties?' }, { cookie: visitor }), 201);
    const [got] = await inbox.done;
    assert.deepEqual([got?.event, got?.data.conversationId, got?.data.message.body], ['message', conversationId, 'And duties?']);
    await new Promise((r) => setTimeout(r, 50));
    ok(await call('admin.localhost', 'POST', `/api/chat/conversations/${conversationId}/messages`, { body: 'Paid to the carrier on delivery.' }, { cookie: owner }), 201);
    assert.equal(mail.last('chat_reply', 'ngozi@example.com').data.message, 'Paid to the carrier on delivery.');
    ok(await call('localhost', 'POST', '/api/chat/read', {}, { cookie: visitor }));
    const mine = ok(await call('localhost', 'GET', '/api/chat', undefined, { cookie: visitor })).body.conversation;
    assert.ok(mine.messages.filter((m: any) => m.sender === 'staff').every((m: any) => m.read));
  });

  test('closing adds a note; the customer can write again; too many messages a minute are refused', async () => {
    ok(await call('admin.localhost', 'POST', `/api/chat/conversations/${conversationId}/close`, {}, { cookie: owner }));
    const closed = ok(await call('localhost', 'GET', '/api/chat', undefined, { cookie: visitor })).body.conversation;
    assert.equal(closed.status, 'closed');
    assert.equal(closed.messages.at(-1).sender, 'system');
    assert.equal(ok(await call('localhost', 'POST', '/api/chat/messages', { body: 'One more thing' }, { cookie: visitor }), 201).body.conversation.status, 'open');
    let status = 0;
    for (let i = 0; i < 25 && status !== 429; i++) status = (await call('localhost', 'POST', '/api/chat/messages', { body: `Message ${i}` }, { cookie: visitor })).status;
    assert.equal(status, 429);
  });

  test('saved replies, the inbox page, and closing quiet chats', async () => {
    ok(await call('admin.localhost', 'POST', '/api/chat/saved-replies', { title: 'Delivery times', body: 'Lagos 1 to 2 days; abroad 3 to 7 days.' }, { cookie: owner }));
    const page = ok(await call('admin.localhost', 'GET', `/chat/?c=${conversationId}`, undefined, { cookie: owner }));
    assert.match(page.text, /data-chat-inbox/);
    assert.match(page.text, /data-saved-reply="Lagos 1 to 2 days; abroad 3 to 7 days."/);
    assert.match(page.text, /Close conversation/);
    const site = ok(await call('localhost', 'GET', '/'));
    assert.match(site.text, /data-chat-open/);
    tick(8 * 86_400);
    assert.equal(await closeQuietConversations(db, clock), 1);
    tick(31 * 86_400);
    await closeQuietConversations(db, clock);
    assert.equal(Number((await db.query('select count(*)::int as n from chat_conversations')).rows[0]?.n), 0);
  });

  test('the app uses a chat token header instead of a cookie', async () => {
    const first = ok(await call('api.localhost', 'POST', '/v1/chat/messages', { body: 'Hello from the app' }), 201).body;
    assert.match(first.chatToken, /^[A-Za-z0-9_-]{40,}$/);
    const again = ok(await call('api.localhost', 'GET', '/v1/chat', undefined, { headers: { 'X-Chat-Token': first.chatToken } })).body;
    assert.equal(again.conversation.messages[0].body, 'Hello from the app');
  });
});

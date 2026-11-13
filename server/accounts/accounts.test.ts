import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { totpCode, totpStep } from './crypto.js';
import { accountDeps, type AccountDeps } from './deps.js';
import { memoryMailer } from './mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from './oidc.js';
import { makeIdToken, makeIssuer } from './oidc-testing.js';
import { inviteOwnerFromServer, resetAccessFromServer, STAFF } from './staff.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Reply {
  status: number;
  body: Record<string, any>;
  cookies: string[];
  headers: Record<string, string | string[] | undefined>;
}

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

describe('accounts over HTTP', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  let deps: AccountDeps;
  let server: Server;
  let port: number;
  let clock = new Date('2026-06-01T09:00:00Z');
  const mail = memoryMailer();
  const google = makeIssuer('g1');
  const apple = makeIssuer('a1');
  const SITE = 'localhost';
  const ADMIN = 'admin.localhost';
  const API = 'api.localhost';
  const tick = (seconds: number): void => {
    clock = new Date(clock.getTime() + seconds * 1000);
  };
  const idToken = (provider: 'google' | 'apple', claims: Record<string, unknown>): string => {
    const iat = Math.floor(clock.getTime() / 1000);
    return provider === 'google'
      ? makeIdToken(google, { iss: 'https://accounts.google.com', aud: 'web.hbd', email_verified: true, iat, exp: iat + 3600, ...claims })
      : makeIdToken(apple, { iss: 'https://appleid.apple.com', aud: 'com.hairbydemj.app', email_verified: 'true', iat, exp: iat + 600, ...claims });
  };

  /** Send a request. Cookie requests carry the Origin a browser would send from our own page. */
  function call(host: string, method: string, path: string, body?: unknown, options: { cookie?: string; bearer?: string; origin?: string | null; ip?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { Host: host };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
    if (options.origin !== null && host !== API) headers.Origin = options.origin ?? `http://${host}`;
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const textBody = Buffer.concat(chunks).toString('utf8');
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(textBody) as Record<string, any>;
          } catch {
            parsed = { raw: textBody };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, cookies: (res.headers['set-cookie'] ?? []).map(String), headers: res.headers });
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const cookieOf = (reply: Reply): string => (reply.cookies[0] ?? '').split(';')[0] ?? '';

  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 5 });
    await migrate(db, 'db/migrations');
    const config = loadConfig({ GOOGLE_CLIENT_IDS: 'web.hbd', APPLE_CLIENT_IDS: 'com.hairbydemj.app' });
    deps = accountDeps({
      db,
      config,
      mail,
      now: () => clock,
      passwordParams: { N: 1024, r: 8, p: 1 },
      identity: createIdentityVerifier(
        { google: { ...PROVIDER_DEFAULTS.google, clientIds: config.googleClientIds }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: config.appleClientIds } },
        async (url) => ({ keys: url.includes('google') ? [google.jwk] : [apple.jwk], maxAgeSeconds: 3600 }),
        () => clock,
      ),
    });
    server = createServer(createApp(config, createLogger('error', () => undefined), { version: 'test', accounts: deps }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.end();
    await testDb.drop();
  });

  // ---------------------------------------------------------------- customers

  test('sign-up, verify by code, sign in, use the session, sign out (website, cookie)', async () => {
    const signUp = await call(SITE, 'POST', '/api/auth/sign-up', { email: ' Ada@Example.com ', password: 'longenough', firstName: 'Ada', lastName: 'Obi', marketingConsent: true });
    assert.equal(signUp.status, 201);
    assert.deepEqual(signUp.body, { email: 'ada@example.com' });
    assert.equal(signUp.cookies.length, 0, 'no session before the email is verified');
    const stored = await db.query("select password_hash, email_verified_at, marketing_consent from customers where email = 'ada@example.com'");
    assert.match(String(stored.rows[0]?.password_hash), /^scrypt\$/);
    assert.equal(stored.rows[0]?.email_verified_at, null);

    // Signing in before verifying is refused.
    const early = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'longenough' });
    assert.equal(early.status, 403);
    assert.equal(early.body.error.code, 'email_not_verified');

    const code = mail.last('verify_email', 'ada@example.com').data.code ?? '';
    assert.match(code, /^\d{6}$/);
    const tokens = await db.query('select encode(token_hash, \'hex\') as h from customer_tokens');
    assert.ok(!tokens.rows.some((r) => String(r.h).includes(code)), 'the code itself is not stored');

    const wrong = await call(SITE, 'POST', '/api/auth/verify-email', { email: 'ada@example.com', code: code === '000000' ? '000001' : '000000' });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.error.code, 'wrong_code');

    const verified = await call(SITE, 'POST', '/api/auth/verify-email', { email: 'ada@example.com', code });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.customer.emailVerified, true);
    assert.equal(verified.body.token, undefined, 'the website never sees the token in the reply');
    const cookie = verified.cookies[0] ?? '';
    assert.match(cookie, /^hbd_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);

    const me = await call(SITE, 'GET', '/api/auth/me', undefined, { cookie: cookieOf(verified) });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.customer, { id: me.body.customer.id, email: 'ada@example.com', emailVerified: true, firstName: 'Ada', lastName: 'Obi', hasPassword: true, providers: [] });
    assert.equal(typeof me.body.csrfToken, 'string');

    // The code cannot be used again, and a verified address cannot be "verified" into a session.
    const again = await call(SITE, 'POST', '/api/auth/verify-email', { email: 'ada@example.com', code });
    assert.equal(again.status, 409);
    assert.equal(again.cookies.length, 0);

    const signIn = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ADA@example.com', password: 'longenough' });
    assert.equal(signIn.status, 200);
    const out = await call(SITE, 'POST', '/api/auth/sign-out', {}, { cookie: cookieOf(signIn) });
    assert.equal(out.status, 200);
    assert.match(out.cookies[0] ?? '', /^hbd_session=; .*Max-Age=0/);
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie: cookieOf(signIn) })).status, 401);
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie: cookieOf(verified) })).status, 200, 'other devices stay signed in');
  });

  test('what people type is checked, with a message per field', async () => {
    const short = await call(SITE, 'POST', '/api/auth/sign-up', { email: 'new@example.com', password: 'short' });
    assert.equal(short.status, 422);
    assert.equal(short.body.error.fields.password, 'Use at least 8 characters.');
    const bad = await call(SITE, 'POST', '/api/auth/sign-up', { email: 'you@example', password: 'longenough' });
    assert.equal(bad.body.error.fields.email, 'Enter a full email address, like name@example.com');
    const taken = await call(SITE, 'POST', '/api/auth/sign-up', { email: 'ADA@example.com', password: 'longenough' });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.fields.email, 'This email already has an account. Sign in instead.');
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', undefined)).status, 415);
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'a@b.co', password: 'x'.repeat(20000) })).status, 413);
  });

  test('wrong password and unknown email get the same answer', async () => {
    const wrong = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'not-the-one' }, { ip: '1' });
    const unknown = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'nobody@example.com', password: 'not-the-one' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.body.error.message, 'Email or password is not right. Try again or reset your password.');
  });

  test('a code expires after 10 minutes, a new one is sent, and resending waits 60 seconds', async () => {
    await call(SITE, 'POST', '/api/auth/sign-up', { email: 'bola@example.com', password: 'longenough' });
    const first = mail.last('verify_email', 'bola@example.com').data.code ?? '';
    const tooSoon = await call(SITE, 'POST', '/api/auth/resend-code', { email: 'bola@example.com' });
    assert.equal(tooSoon.status, 429);
    assert.equal(tooSoon.body.error.code, 'wait_to_resend');
    tick(61);
    assert.equal((await call(SITE, 'POST', '/api/auth/resend-code', { email: 'bola@example.com' })).status, 200);
    const second = mail.last('verify_email', 'bola@example.com').data.code ?? '';
    if (first !== second) assert.equal((await call(SITE, 'POST', '/api/auth/verify-email', { email: 'bola@example.com', code: first })).status, 422, 'the old code stopped working');
    tick(10 * 60 + 1);
    const sentBefore = mail.sent.length;
    const expired = await call(SITE, 'POST', '/api/auth/verify-email', { email: 'bola@example.com', code: second });
    assert.equal(expired.body.error.code, 'code_expired');
    assert.equal(expired.body.error.message, 'That code has expired. We have sent a new one.');
    assert.equal(mail.sent.length, sentBefore + 1);
    const third = mail.last('verify_email', 'bola@example.com').data.code ?? '';
    assert.equal((await call(SITE, 'POST', '/api/auth/verify-email', { email: 'bola@example.com', code: third })).status, 200);
    // Asking for a code for an unknown or already verified address says nothing and sends nothing.
    const quiet = mail.sent.length;
    assert.equal((await call(SITE, 'POST', '/api/auth/resend-code', { email: 'nobody@example.com' })).status, 200);
    assert.equal((await call(SITE, 'POST', '/api/auth/resend-code', { email: 'bola@example.com' })).status, 200);
    assert.equal(mail.sent.length, quiet);
  });

  test('guessing a password is stopped after 5 wrong tries, then allowed again later', async () => {
    await call(SITE, 'POST', '/api/auth/sign-up', { email: 'chi@example.com', password: 'longenough' });
    await call(SITE, 'POST', '/api/auth/verify-email', { email: 'chi@example.com', code: mail.last('verify_email', 'chi@example.com').data.code });
    for (let i = 0; i < 5; i++) assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'chi@example.com', password: `guess-${i}` })).status, 401);
    const blocked = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'chi@example.com', password: 'longenough' });
    assert.equal(blocked.status, 429, 'even the right password is refused while locked');
    assert.equal(blocked.headers['retry-after'], '900');
    // The lock is kept in the database's own time, so move those records back instead of the test clock.
    await db.query("update sign_in_attempts set created_at = created_at - interval '16 minutes' where subject = 'chi@example.com'");
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'chi@example.com', password: 'longenough' })).status, 200);
  });

  test('guessing a 6-digit code is stopped after 5 wrong tries', async () => {
    await call(SITE, 'POST', '/api/auth/sign-up', { email: 'dayo@example.com', password: 'longenough' });
    const real = mail.last('verify_email', 'dayo@example.com').data.code ?? '';
    const wrongCode = real === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) assert.equal((await call(SITE, 'POST', '/api/auth/verify-email', { email: 'dayo@example.com', code: wrongCode })).status, 422);
    assert.equal((await call(SITE, 'POST', '/api/auth/verify-email', { email: 'dayo@example.com', code: real })).status, 429);
  });

  test('forgot password: the link works once, for an hour, and signs out every device', async () => {
    const before = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'longenough' });
    assert.equal(before.status, 200);
    const quiet = mail.sent.length;
    assert.deepEqual((await call(SITE, 'POST', '/api/auth/forgot-password', { email: 'nobody@example.com' })).body, { ok: true });
    assert.equal(mail.sent.length, quiet, 'nothing is sent for an unknown email, and the answer is the same');
    assert.deepEqual((await call(SITE, 'POST', '/api/auth/forgot-password', { email: 'ada@example.com' })).body, { ok: true });
    const token = mail.last('reset_password', 'ada@example.com').data.token ?? '';
    const stored = await db.query("select encode(token_hash, 'base64') as h from customer_tokens where purpose = 'reset_password'");
    assert.ok(!stored.rows.some((r) => r.h === token), 'the link token is stored only as a hash');

    assert.equal((await call(SITE, 'POST', '/api/auth/reset-password', { token, password: 'short' })).status, 422);
    assert.equal((await call(SITE, 'POST', '/api/auth/reset-password', { token: 'wrong', password: 'brand-new-pass' })).status, 422);
    const done = await call(SITE, 'POST', '/api/auth/reset-password', { token, password: 'brand-new-pass' });
    assert.equal(done.status, 200);
    assert.equal(mail.last('password_changed').to, 'ada@example.com');
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie: cookieOf(before) })).status, 401, 'old sessions are ended');
    assert.equal((await call(SITE, 'POST', '/api/auth/reset-password', { token, password: 'another-pass-1' })).body.error.code, 'link_expired', 'the link works once');
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'longenough' })).status, 401);
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'brand-new-pass' })).status, 200);

    await db.query("delete from sign_in_attempts where subject = 'ada@example.com'");
    await call(SITE, 'POST', '/api/auth/forgot-password', { email: 'ada@example.com' });
    const late = mail.last('reset_password', 'ada@example.com').data.token;
    tick(60 * 60 + 1);
    assert.equal((await call(SITE, 'POST', '/api/auth/reset-password', { token: late, password: 'another-pass-1' })).body.error.code, 'link_expired');
  });

  test('the phone app signs in with a token instead of a cookie', async () => {
    const signIn = await call(API, 'POST', '/v1/auth/sign-in', { email: 'ada@example.com', password: 'brand-new-pass' });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.cookies.length, 0);
    assert.match(signIn.body.token, /^[A-Za-z0-9_-]{43}$/);
    const days = (new Date(signIn.body.expiresAt).getTime() - clock.getTime()) / 86_400_000;
    assert.equal(Math.round(days), 90);
    assert.equal((await call(API, 'GET', '/v1/auth/me', undefined, { bearer: signIn.body.token })).body.customer.email, 'ada@example.com');
    assert.equal((await call(API, 'GET', '/v1/auth/me')).status, 401);
    // A website cookie is not accepted on the app's address, and the other way round.
    assert.equal((await call(API, 'GET', '/v1/auth/me', undefined, { cookie: `hbd_session=${signIn.body.token}` })).status, 401);
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { bearer: signIn.body.token })).status, 401);
    await call(API, 'POST', '/v1/auth/sign-out', {}, { bearer: signIn.body.token });
    assert.equal((await call(API, 'GET', '/v1/auth/me', undefined, { bearer: signIn.body.token })).status, 401);
    const stored = await db.query("select count(*)::int as n from customer_sessions where encode(token_hash, 'base64') like '%' || $1 || '%'", [String(signIn.body.token).slice(0, 20)]);
    assert.equal(stored.rows[0]?.n, 0, 'session tokens are stored only as hashes');
  });

  test('a session that is not used for 30 days ends; using it keeps it alive', async () => {
    const signIn = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'brand-new-pass' });
    const cookie = cookieOf(signIn);
    tick(20 * 86_400);
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie })).status, 200);
    tick(20 * 86_400);
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie })).status, 200, 'used 20 days ago, so still alive');
    tick(31 * 86_400);
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie })).status, 401);
  });

  test('requests from another site are refused (cross-site request forgery)', async () => {
    const signIn = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'brand-new-pass' });
    const cookie = cookieOf(signIn);
    const evil = await call(SITE, 'POST', '/api/auth/sign-out', {}, { cookie, origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    assert.equal(evil.body.error.code, 'cross_site');
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-out', {}, { cookie, origin: null })).status, 403, 'no Origin at all is refused too');
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'brand-new-pass' }, { origin: 'http://admin.localhost' })).status, 403, 'even our own other hostnames');
    assert.equal((await call(SITE, 'GET', '/api/auth/me', undefined, { cookie })).status, 200, 'the session was not signed out');
  });

  test('Google: a new person gets an account; the same person signs in again', async () => {
    const first = await call(SITE, 'POST', '/api/auth/google', { idToken: idToken('google', { sub: 'g-efe', email: 'efe@example.com', name: 'Efe Okoro' }) });
    assert.equal(first.status, 201);
    assert.equal(first.body.created, true);
    assert.deepEqual(first.body.customer, { id: first.body.customer.id, email: 'efe@example.com', emailVerified: true, firstName: 'Efe', lastName: 'Okoro', hasPassword: false, providers: ['google'] });
    assert.match(first.cookies[0] ?? '', /^hbd_session=/);
    const second = await call(API, 'POST', '/v1/auth/google', { idToken: idToken('google', { sub: 'g-efe', email: 'changed@example.com' }) });
    assert.equal(second.status, 200);
    assert.equal(second.body.created, false);
    assert.equal(second.body.customer.id, first.body.customer.id, 'recognised by Google id, not by email');
    // No password was set, so password sign-in does not work for this account.
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'efe@example.com', password: '' })).status, 401);
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'efe@example.com', password: 'null' })).status, 401);
  });

  test('Google and Apple link to an existing email account, giving one customer', async () => {
    const viaGoogle = await call(SITE, 'POST', '/api/auth/google', { idToken: idToken('google', { sub: 'g-ada', email: 'ada@example.com' }) });
    assert.equal(viaGoogle.status, 200);
    assert.equal(viaGoogle.body.created, false);
    assert.deepEqual(viaGoogle.body.customer.providers, ['google']);
    assert.equal(viaGoogle.body.customer.hasPassword, true);
    // Signed in, Ada adds Apple (with Apple's private relay address) from her account page.
    const linked = await call(SITE, 'POST', '/api/auth/link/apple', { idToken: idToken('apple', { sub: 'a-ada', email: 'relay123@privaterelay.appleid.com' }) }, { cookie: cookieOf(viaGoogle) });
    assert.equal(linked.status, 200);
    assert.deepEqual(linked.body.customer.providers, ['apple', 'google']);
    const viaApple = await call(API, 'POST', '/v1/auth/apple', { idToken: idToken('apple', { sub: 'a-ada', email: 'relay123@privaterelay.appleid.com' }) });
    assert.equal(viaApple.body.customer.id, viaGoogle.body.customer.id);
    assert.equal((await db.query("select count(*)::int as n from customers where email in ('ada@example.com', 'relay123@privaterelay.appleid.com')")).rows[0]?.n, 1);
    // Someone else cannot attach Ada's Apple id to their own account.
    const efe = await call(SITE, 'POST', '/api/auth/google', { idToken: idToken('google', { sub: 'g-efe' }) });
    const steal = await call(SITE, 'POST', '/api/auth/link/apple', { idToken: idToken('apple', { sub: 'a-ada' }) }, { cookie: cookieOf(efe) });
    assert.equal(steal.status, 409);
    assert.equal((await call(SITE, 'POST', '/api/auth/link/apple', { idToken: idToken('apple', { sub: 'a-x' }) })).status, 401, 'linking needs a signed-in customer');
  });

  test('an email the provider has not confirmed never takes over an existing account', async () => {
    const attack = await call(SITE, 'POST', '/api/auth/google', { idToken: idToken('google', { sub: 'g-attacker', email: 'chi@example.com', email_verified: false }) });
    assert.equal(attack.status, 422);
    assert.equal(attack.body.error.code, 'email_needed');
    assert.equal(attack.cookies.length, 0);
    assert.equal((await db.query("select count(*)::int as n from customer_identities where subject = 'g-attacker'")).rows[0]?.n, 0);
  });

  test('an account someone else made with your email cannot be used against you', async () => {
    // A stranger signs up with Funke's address and a password they know, but can never verify it.
    await call(SITE, 'POST', '/api/auth/sign-up', { email: 'funke@example.com', password: 'strangers-password' });
    // Funke later signs in with Google, which confirms the address is hers.
    const funke = await call(SITE, 'POST', '/api/auth/google', { idToken: idToken('google', { sub: 'g-funke', email: 'funke@example.com' }) });
    assert.equal(funke.status, 200);
    assert.equal(funke.body.customer.hasPassword, false, "the stranger's password was removed");
    assert.equal(funke.body.customer.emailVerified, true);
    assert.equal((await call(SITE, 'POST', '/api/auth/sign-in', { email: 'funke@example.com', password: 'strangers-password' })).status, 401);
    const strangersCode = mail.last('verify_email', 'funke@example.com').data.code;
    assert.equal((await call(SITE, 'POST', '/api/auth/verify-email', { email: 'funke@example.com', code: strangersCode })).cookies.length, 0);
  });

  test('one address cannot create accounts without limit', async () => {
    await db.query('delete from sign_in_attempts');
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await call(SITE, 'POST', '/api/auth/sign-up', { email: `bulk${i}@example.com`, password: 'longenough' })).status;
    assert.equal(last, 429);
    assert.equal((await db.query("select count(*)::int as n from customers where email like 'bulk%'")).rows[0]?.n, 30);
    await db.query('delete from sign_in_attempts');
  });

  test('a forged or misdirected provider token is refused', async () => {
    const stranger = makeIssuer('g1');
    const iat = Math.floor(clock.getTime() / 1000);
    const forged = makeIdToken(stranger, { iss: 'https://accounts.google.com', aud: 'web.hbd', sub: 'g-ada', email: 'ada@example.com', email_verified: true, iat, exp: iat + 600 });
    assert.equal((await call(SITE, 'POST', '/api/auth/google', { idToken: forged })).status, 401);
    assert.equal((await call(SITE, 'POST', '/api/auth/google', { idToken: idToken('google', { sub: 'g-ada', aud: 'another-app' }) })).status, 401);
    assert.equal((await call(SITE, 'POST', '/api/auth/apple', { idToken: idToken('google', { sub: 'g-ada' }) })).status, 401);
    assert.equal((await call(SITE, 'POST', '/api/auth/google', {})).status, 401);
  });

  // -------------------------------------------------------------------- staff

  let ownerCookie = '';
  let ownerSecret: Buffer = Buffer.alloc(0);
  let fulfilmentRoleId = 0;
  const codeNow = (secret: Buffer): string => totpCode(secret, totpStep(clock));

  async function acceptInvite(token: string, password: string): Promise<Buffer> {
    const start = await call(ADMIN, 'POST', '/api/auth/invite/start', { token, password });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const secret = base32Decode(start.body.secret);
    const confirm = await call(ADMIN, 'POST', '/api/auth/invite/confirm', { token, code: codeNow(secret) });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    return secret;
  }
  async function staffSignIn(email: string, password: string, secret: Buffer): Promise<Reply> {
    tick(31); // a fresh 30-second step, since no code works twice
    const step1 = await call(ADMIN, 'POST', '/api/auth/sign-in', { email, password });
    assert.equal(step1.status, 200, JSON.stringify(step1.body));
    return call(ADMIN, 'POST', '/api/auth/two-step', { pending: step1.body.pending, code: codeNow(secret) });
  }

  test('the first Owner is created by a server command and must set a password and two-step verification', async () => {
    const { token } = await inviteOwnerFromServer(deps, { name: 'Emmanuel', email: 'owner@hairbydemj.test' });
    assert.equal(mail.sent.filter((e) => e.template === 'staff_invite').length, 0, 'the link is printed, not emailed');
    // Until both are set, the account cannot sign in.
    assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: 'owner-password' })).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/invite/start', { token, password: 'short' })).status, 422);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/invite/confirm', { token, code: '000000' })).status, 422, 'the password comes first');

    const start = await call(ADMIN, 'POST', '/api/auth/invite/start', { token, password: 'owner-password' });
    assert.match(start.body.uri, /^otpauth:\/\/totp\/hairbydemj:owner%40hairbydemj\.test\?secret=[A-Z2-7]{32}&/);
    ownerSecret = base32Decode(start.body.secret);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: 'owner-password' })).status, 401, 'password alone is not enough');
    const wrongCode = codeNow(ownerSecret) === '000000' ? '000001' : '000000';
    assert.equal((await call(ADMIN, 'POST', '/api/auth/invite/confirm', { token, code: wrongCode })).status, 422);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/invite/confirm', { token, code: codeNow(ownerSecret) })).status, 200);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/invite/start', { token, password: 'someone-else-1' })).body.error.code, 'link_expired', 'the link works once');

    const row = await db.query("select status, totp_secret_enc, password_hash from staff where email = 'owner@hairbydemj.test'");
    assert.equal(row.rows[0]?.status, 'active');
    assert.ok(!(row.rows[0]?.totp_secret_enc as Buffer).includes(ownerSecret), 'the two-step secret is stored encrypted');
  });

  test('staff sign-in needs the password and then a code; the cookie is strict', async () => {
    tick(31);
    const step1 = await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: 'owner-password' });
    assert.equal(step1.status, 200);
    assert.equal(step1.cookies.length, 0, 'no session after the password alone');
    assert.equal((await call(ADMIN, 'GET', '/api/auth/me')).status, 401);
    const wrongCode = codeNow(ownerSecret) === '000000' ? '000001' : '000000';
    assert.equal((await call(ADMIN, 'POST', '/api/auth/two-step', { pending: step1.body.pending, code: wrongCode })).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/two-step', { pending: 'made.up', code: codeNow(ownerSecret) })).body.error.code, 'start_again');

    const code = codeNow(ownerSecret);
    const done = await call(ADMIN, 'POST', '/api/auth/two-step', { pending: step1.body.pending, code });
    assert.equal(done.status, 200);
    assert.equal(done.cookies[0]?.replace(/=[^;]+/, '=TOKEN'), 'hbd_staff=TOKEN; Path=/; HttpOnly; SameSite=Strict');
    ownerCookie = cookieOf(done);
    assert.equal(done.body.staff.isOwner, true);
    assert.deepEqual(done.body.staff.permissions.settings, { view: true, change: true });

    // The same code cannot be used a second time, even with a fresh password step.
    const again = await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: 'owner-password' });
    assert.equal((await call(ADMIN, 'POST', '/api/auth/two-step', { pending: again.body.pending, code })).status, 401);
    // The password step expires after 5 minutes.
    tick(5 * 60 + 1);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/two-step', { pending: again.body.pending, code: codeNow(ownerSecret) })).body.error.code, 'start_again');
    // A customer session is not a staff session, and the admin is not reachable with one.
    const customer = await call(SITE, 'POST', '/api/auth/sign-in', { email: 'ada@example.com', password: 'brand-new-pass' });
    assert.equal((await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie: cookieOf(customer).replace('hbd_session', 'hbd_staff') })).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-out', {}, { cookie: ownerCookie, origin: 'https://evil.example' })).status, 403);
  });

  test('the Owner creates a role and invites staff; a role limits what its people can do', async () => {
    const role = await call(ADMIN, 'POST', '/api/roles', { name: 'Fulfilment', permissions: { orders: { view: true, change: true }, returns: { change: true }, products: { view: true }, customers: { view: true } } }, { cookie: ownerCookie });
    assert.equal(role.status, 201);
    fulfilmentRoleId = role.body.roleId;
    const roles = await call(ADMIN, 'GET', '/api/roles', undefined, { cookie: ownerCookie });
    const made = roles.body.roles.find((r: { name: string }) => r.name === 'Fulfilment');
    assert.deepEqual(made.permissions.returns, { view: true, change: true }, 'being able to change includes being able to view');
    assert.deepEqual(made.permissions.settings, { view: false, change: false });
    assert.equal((await call(ADMIN, 'POST', '/api/roles', { name: 'fulfilment' }, { cookie: ownerCookie })).status, 409);

    const invite = await call(ADMIN, 'POST', '/api/staff/invite', { name: 'Kemi Bello', email: 'kemi@hairbydemj.test', roleId: fulfilmentRoleId }, { cookie: ownerCookie });
    assert.equal(invite.status, 201);
    const emailed = mail.last('staff_invite', 'kemi@hairbydemj.test');
    assert.equal(emailed.data.hours, '48');
    assert.equal((await call(ADMIN, 'POST', '/api/staff/invite', { name: 'Kemi Again', email: 'KEMI@hairbydemj.test', roleId: fulfilmentRoleId }, { cookie: ownerCookie })).status, 409);
    const kemiSecret = await acceptInvite(emailed.data.token ?? '', 'kemi-password');
    const kemi = await staffSignIn('kemi@hairbydemj.test', 'kemi-password', kemiSecret);
    assert.equal(kemi.status, 200);
    assert.equal(kemi.body.staff.roleName, 'Fulfilment');
    const kemiCookie = cookieOf(kemi);

    // Kemi cannot see staff or roles (settings area), invite people, or change roles.
    assert.equal((await call(ADMIN, 'GET', '/api/staff', undefined, { cookie: kemiCookie })).status, 403);
    assert.equal((await call(ADMIN, 'GET', '/api/roles', undefined, { cookie: kemiCookie })).status, 403);
    assert.equal((await call(ADMIN, 'POST', '/api/staff/invite', { name: 'X', email: 'x@hairbydemj.test', roleId: fulfilmentRoleId }, { cookie: kemiCookie })).status, 403);
    assert.equal((await call(ADMIN, 'POST', `/api/roles/${fulfilmentRoleId}/permissions`, { permissions: { settings: { change: true } } }, { cookie: kemiCookie })).status, 403);
    const owner = (await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie: ownerCookie })).body.staff;
    assert.equal((await call(ADMIN, 'POST', `/api/staff/${kemi.body.staff.id}/role`, { roleId: owner.roleId }, { cookie: kemiCookie })).status, 403, 'nobody can make themselves Owner');

    // Even with "settings" allowed, only an Owner manages staff and roles.
    assert.equal((await call(ADMIN, 'POST', `/api/roles/${fulfilmentRoleId}/permissions`, { permissions: { orders: { change: true }, settings: { view: true, change: true } } }, { cookie: ownerCookie })).status, 200);
    assert.equal((await call(ADMIN, 'GET', '/api/staff', undefined, { cookie: kemiCookie })).status, 200, 'the change applies at once, with no new sign-in');
    assert.equal((await call(ADMIN, 'POST', '/api/staff/invite', { name: 'X', email: 'x@hairbydemj.test', roleId: fulfilmentRoleId }, { cookie: kemiCookie })).status, 403);
    assert.equal((await call(ADMIN, 'POST', `/api/roles/${owner.roleId}/permissions`, { permissions: {} }, { cookie: ownerCookie })).body.error.code, 'owner_role');

    const list = await call(ADMIN, 'GET', '/api/staff', undefined, { cookie: ownerCookie });
    assert.deepEqual(list.body.staff.map((s: { email: string; roleName: string; status: string; twoStep: boolean }) => [s.email, s.roleName, s.status, s.twoStep]), [
      ['owner@hairbydemj.test', 'Owner', 'active', true],
      ['kemi@hairbydemj.test', 'Fulfilment', 'active', true],
    ]);
    assert.ok(!JSON.stringify(list.body).includes('scrypt'), 'password hashes never leave the server');
  });

  test('disabling a staff member signs them out at once; the last Owner cannot be removed', async () => {
    const kemiId = Number((await db.query("select id from staff where email = 'kemi@hairbydemj.test'")).rows[0]?.id);
    const ownerId = Number((await db.query("select id from staff where email = 'owner@hairbydemj.test'")).rows[0]?.id);
    const secretRow = await db.query('select 1 from staff_sessions where staff_id = $1 and revoked_at is null', [kemiId]);
    assert.ok((secretRow.rowCount ?? 0) > 0);
    assert.equal((await call(ADMIN, 'POST', `/api/staff/${ownerId}/disable`, {}, { cookie: ownerCookie })).body.error.code, 'self');
    assert.equal((await call(ADMIN, 'POST', `/api/staff/${ownerId}/role`, { roleId: fulfilmentRoleId }, { cookie: ownerCookie })).body.error.code, 'last_owner');
    assert.equal((await call(ADMIN, 'POST', `/api/staff/${kemiId}/disable`, {}, { cookie: ownerCookie })).status, 200);
    assert.equal((await db.query('select count(*)::int as n from staff_sessions where staff_id = $1 and revoked_at is null', [kemiId])).rows[0]?.n, 0);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'kemi@hairbydemj.test', password: 'kemi-password' })).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/staff/999999/disable', {}, { cookie: ownerCookie })).status, 404);
  });

  test('a lost phone: the Owner resets a staff member, who sets everything up again', async () => {
    const kemiId = Number((await db.query("select id from staff where email = 'kemi@hairbydemj.test'")).rows[0]?.id);
    assert.equal((await call(ADMIN, 'POST', `/api/staff/${kemiId}/reset`, {}, { cookie: ownerCookie })).status, 200);
    const token = mail.last('staff_invite', 'kemi@hairbydemj.test').data.token ?? '';
    const newSecret = await acceptInvite(token, 'kemi-new-password');
    assert.equal((await staffSignIn('kemi@hairbydemj.test', 'kemi-new-password', newSecret)).status, 200);
    await db.query("delete from sign_in_attempts where subject = 'kemi@hairbydemj.test'");
    assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'kemi@hairbydemj.test', password: 'kemi-password' })).status, 401, 'the old password is gone');
  });

  test('a locked-out Owner is reset by the server command', async () => {
    const { token } = await resetAccessFromServer(deps, 'owner@hairbydemj.test');
    assert.equal((await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie: ownerCookie })).status, 401, 'signed out everywhere');
    ownerSecret = await acceptInvite(token, 'owner-new-password');
    const back = await staffSignIn('owner@hairbydemj.test', 'owner-new-password', ownerSecret);
    assert.equal(back.status, 200);
    ownerCookie = cookieOf(back);
  });

  test('a staff session ends after 2 hours unused and always after 12 hours', async () => {
    tick(119 * 60);
    assert.equal((await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie: ownerCookie })).status, 200);
    tick(121 * 60);
    assert.equal((await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie: ownerCookie })).status, 401, 'idle too long');
    const fresh = await staffSignIn('owner@hairbydemj.test', 'owner-new-password', ownerSecret);
    const cookie = cookieOf(fresh);
    for (let hour = 0; hour < 11; hour++) {
      tick(60 * 60);
      assert.equal((await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie })).status, 200);
    }
    tick(61 * 60);
    assert.equal((await call(ADMIN, 'GET', '/api/auth/me', undefined, { cookie })).status, 401, `over ${STAFF.sessionHours} hours`);
  });

  test('guessing staff passwords and codes is stopped', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: `guess-${i}` })).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: 'owner-new-password' })).status, 429);
    await db.query('delete from sign_in_attempts');
    tick(31);
    const step1 = await call(ADMIN, 'POST', '/api/auth/sign-in', { email: 'owner@hairbydemj.test', password: 'owner-new-password' });
    const wrongCode = codeNow(ownerSecret) === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await call(ADMIN, 'POST', '/api/auth/two-step', { pending: step1.body.pending, code: wrongCode })).status, 401);
    assert.equal((await call(ADMIN, 'POST', '/api/auth/two-step', { pending: step1.body.pending, code: codeNow(ownerSecret) })).status, 429);
    await db.query('delete from sign_in_attempts');
  });

  test('what staff do is written to the activity log', async () => {
    const log = await db.query('select staff_name, area, summary from activity_log order by id');
    const lines = log.rows.map((r) => `${r.staff_name}: ${r.summary}`);
    for (const expected of [
      'Server command: Invited owner@hairbydemj.test as Owner',
      'Emmanuel: Accepted the invite and set up two-step verification',
      'Emmanuel: Signed in',
      'Emmanuel: Created the role Fulfilment',
      'Emmanuel: Invited kemi@hairbydemj.test as Fulfilment',
      'Emmanuel: Changed what the role Fulfilment may do',
      'Emmanuel: Disabled kemi@hairbydemj.test',
      'Emmanuel: Reset sign-in for kemi@hairbydemj.test',
      'Server command: Reset sign-in for owner@hairbydemj.test',
    ]) {
      assert.ok(lines.includes(expected), `activity log has "${expected}"`);
    }
  });

  test('nothing secret is stored readable', async () => {
    const tables = await db.query(`
      select string_agg(t::text, ' ') as dump from (
        select row_to_json(s) as t from customer_sessions s union all select row_to_json(s) from staff_sessions s
        union all select row_to_json(s) from customer_tokens s union all select row_to_json(s) from staff_invites s
        union all select row_to_json(s) from customers s union all select row_to_json(s) from staff s
      ) x`);
    const dump = String(tables.rows[0]?.dump);
    for (const secret of ['longenough', 'brand-new-pass', 'owner-new-password', 'kemi-new-password']) assert.ok(!dump.includes(secret), `the password "${secret}" is not in the database`);
    for (const email of mail.sent) {
      for (const key of ['code', 'token'] as const) {
        const value = email.data[key];
        if (value && key === 'token') assert.ok(!dump.includes(value), 'emailed link tokens are not in the database');
      }
    }
  });
});

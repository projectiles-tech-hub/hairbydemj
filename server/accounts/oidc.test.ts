import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createIdentityVerifier, IdentityError, PROVIDER_DEFAULTS, type KeyFetcher } from './oidc.js';
import { makeIdToken, makeIssuer } from './oidc-testing.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const seconds = Math.floor(NOW.getTime() / 1000);
const google = makeIssuer('g1');
const apple = makeIssuer('a1');
let fetches = 0;
let googleKeys = [google.jwk];
const keys: KeyFetcher = async (url) => {
  fetches++;
  return { keys: url.includes('google') ? googleKeys : [apple.jwk], maxAgeSeconds: 3600 };
};
const verifier = createIdentityVerifier(
  { google: { ...PROVIDER_DEFAULTS.google, clientIds: ['web.hbd', 'app.hbd'] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: ['com.hairbydemj.app'] } },
  keys,
  () => NOW,
);
const good = { iss: 'https://accounts.google.com', aud: 'web.hbd', sub: 'g-123', email: 'Ada@Example.com', email_verified: true, name: 'Ada Obi', iat: seconds - 5, exp: seconds + 3600 };
const refuses = (token: string, pattern: RegExp, options = {}): Promise<void> => assert.rejects(verifier.verify('google', token, options), (e: Error) => e instanceof IdentityError && pattern.test(e.message));

test('a genuine Google token gives the person, with the email in lower case', async () => {
  assert.deepEqual(await verifier.verify('google', makeIdToken(google, good)), { provider: 'google', subject: 'g-123', email: 'ada@example.com', emailVerified: true, name: 'Ada Obi' });
});

test('a genuine Apple token is accepted, including "true" sent as text', async () => {
  const token = makeIdToken(apple, { iss: 'https://appleid.apple.com', aud: 'com.hairbydemj.app', sub: 'a-9', email: 'x@privaterelay.appleid.com', email_verified: 'true', iat: seconds, exp: seconds + 600 });
  const identity = await verifier.verify('apple', token);
  assert.equal(identity.subject, 'a-9');
  assert.equal(identity.emailVerified, true);
  assert.equal(identity.name, null);
});

test('tokens for another app, issuer or time are refused', async () => {
  await refuses(makeIdToken(google, { ...good, aud: 'someone-else' }), /different app/);
  await refuses(makeIdToken(google, { ...good, iss: 'https://evil.example' }), /wrong issuer/);
  await refuses(makeIdToken(google, { ...good, exp: seconds - 120 }), /expired/);
  await refuses(makeIdToken(google, { ...good, iat: seconds - 3600 }), /too old/);
  await refuses(makeIdToken(google, { ...good, iat: seconds + 600 }), /too old/);
  await refuses(makeIdToken(google, { ...good, sub: '' }), /nobody/);
  // A Google token cannot be used as an Apple one.
  await assert.rejects(verifier.verify('apple', makeIdToken(google, good)), IdentityError);
});

test('forged tokens are refused', async () => {
  const stranger = makeIssuer('g1'); // same key id, different key
  await refuses(makeIdToken(stranger, good), /signature is wrong/);
  await refuses(makeIdToken(makeIssuer('unknown'), good), /unknown key/);
  // "alg: none" and an HMAC signed with the public key are classic forgeries.
  const head = Buffer.from(JSON.stringify({ alg: 'none', kid: 'g1' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(good)).toString('base64url');
  await refuses(`${head}.${body}.`, /unsupported signature/);
  const hsHead = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'g1' })).toString('base64url');
  const hsSig = createHmac('sha256', JSON.stringify(google.jwk)).update(`${hsHead}.${body}`).digest('base64url');
  await refuses(`${hsHead}.${body}.${hsSig}`, /unsupported signature/);
  // Changing the payload breaks the signature.
  const [h, , s] = makeIdToken(google, good).split('.') as [string, string, string];
  await refuses(`${h}.${Buffer.from(JSON.stringify({ ...good, sub: 'victim' })).toString('base64url')}.${s}`, /signature is wrong/);
  await refuses('not-a-token', /not readable/);
});

test('a nonce, when asked for, must match', async () => {
  const token = makeIdToken(google, { ...good, nonce: 'n-1' });
  assert.equal((await verifier.verify('google', token, { nonce: 'n-1' })).subject, 'g-123');
  await refuses(token, /does not match/, { nonce: 'n-2' });
  await refuses(makeIdToken(google, good), /does not match/, { nonce: 'n-1' });
});

test('an email the provider has not confirmed is marked unverified', async () => {
  const identity = await verifier.verify('google', makeIdToken(google, { ...good, email_verified: false }));
  assert.equal(identity.emailVerified, false);
});

test('keys are cached, and fetched again when the provider rotates them', async () => {
  const before = fetches;
  await verifier.verify('google', makeIdToken(google, good));
  assert.equal(fetches, before, 'a known key does not need a fetch');
  const rotated = makeIssuer('g2');
  googleKeys = [google.jwk, rotated.jwk];
  assert.equal((await verifier.verify('google', makeIdToken(rotated, good))).subject, 'g-123');
  assert.equal(fetches, before + 1);
});

test('sign-in with a provider that is not set up is refused', async () => {
  const none = createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }, keys, () => NOW);
  await assert.rejects(none.verify('google', makeIdToken(google, good)), /not set up/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base32Encode, deriveKey, hashCode, hashPassword, hashToken, newTotpSecret, passwordNeedsRehash, PASSWORD_PARAMS, randomCode, randomToken,
  readToken, seal, signToken, totpCode, totpStep, totpUri, unseal, verifyPassword, verifyTotp,
} from './crypto.js';

const FAST = { N: 1024, r: 8, p: 1 };

test('a password verifies against its own hash and nothing else', async () => {
  const hash = await hashPassword('correct horse battery', FAST);
  assert.match(hash, /^scrypt\$1024\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batterz', hash), false);
  assert.notEqual(hash, await hashPassword('correct horse battery', FAST), 'each hash has its own salt');
});

test('the default password settings work and meet the recommended strength', async () => {
  assert.deepEqual(PASSWORD_PARAMS, { N: 32768, r: 8, p: 3 });
  const hash = await hashPassword('a real one');
  assert.equal(await verifyPassword('a real one', hash), true);
  assert.equal(passwordNeedsRehash(hash), false);
  assert.equal(passwordNeedsRehash(await hashPassword('x', FAST)), true);
});

test('a malformed or missing hash never verifies and never throws', async () => {
  for (const bad of [null, '', 'plain', 'scrypt$1$2', 'scrypt$0$8$1$AAAA$AAAA', 'scrypt$99999999999$8$1$AAAA$AAAA', 'bcrypt$1024$8$1$AAAA$AAAA']) {
    assert.equal(await verifyPassword('x', bad), false);
  }
});

test('tokens and codes are random, and only hashes need storing', () => {
  assert.match(randomToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(randomToken(), randomToken());
  for (let i = 0; i < 200; i++) assert.match(randomCode(), /^\d{6}$/);
  assert.equal(hashToken('abc').length, 32);
  assert.ok(!hashCode('123456', 'verify_email', 1).equals(hashCode('123456', 'verify_email', 2)), 'the same code for two people has different hashes');
});

test('signed tokens are refused when changed, expired or signed with another key', () => {
  const key = deriveKey('s'.repeat(40), 'a');
  const now = new Date('2026-01-01T00:00:00Z');
  const token = signToken({ sid: 7 }, key, 300, now);
  assert.equal(readToken(token, key, now)?.sid, 7);
  assert.equal(readToken(token, key, new Date(now.getTime() + 301_000)), null);
  assert.equal(readToken(token, deriveKey('s'.repeat(40), 'b'), now), null);
  const [body, sig] = token.split('.') as [string, string];
  const forged = Buffer.from(JSON.stringify({ sid: 1, exp: 9999999999 })).toString('base64url');
  assert.equal(readToken(`${forged}.${sig}`, key, now), null);
  assert.equal(readToken(`${body}.${sig}.x`, key, now), null);
  assert.equal(readToken('nonsense', key, now), null);
});

test('sealed secrets open only with the right key and unchanged', () => {
  const key = deriveKey('s'.repeat(40), 'totp');
  const sealed = seal(Buffer.from('secret'), key);
  assert.equal(unseal(sealed, key).toString(), 'secret');
  assert.ok(!sealed.includes(Buffer.from('secret')));
  assert.throws(() => unseal(sealed, deriveKey('t'.repeat(40), 'totp')));
  const changed = Buffer.from(sealed);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  assert.throws(() => unseal(changed, key));
  assert.throws(() => unseal(Buffer.from([1, 2, 3]), key));
});

test('two-step codes match the published test values (RFC 6238)', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpCode(secret, Math.floor(1234567890 / 30)), '005924');
  assert.equal(totpCode(secret, Math.floor(20000000000 / 30)), '353130');
  assert.equal(base32Encode(secret), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.match(totpUri(secret, 'a b@x.com'), /^otpauth:\/\/totp\/hairbydemj:a%20b%40x\.com\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=hairbydemj/);
});

test('a two-step code works within one step of now, and never twice', () => {
  const secret = newTotpSecret();
  const now = new Date('2026-06-01T12:00:10Z');
  const step = totpStep(now);
  assert.equal(verifyTotp(secret, totpCode(secret, step), now, null), step);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), now, null), step - 1);
  assert.equal(verifyTotp(secret, totpCode(secret, step + 1), now, null), step + 1);
  assert.equal(verifyTotp(secret, totpCode(secret, step - 2), now, null), null);
  assert.equal(verifyTotp(secret, totpCode(secret, step), now, step), null, 'the same code again is refused');
  assert.equal(verifyTotp(secret, totpCode(secret, step - 1), now, step), null, 'an older code is refused');
  assert.equal(verifyTotp(secret, '12345', now, null), null);
  assert.equal(verifyTotp(secret, 'abcdef', now, null), null);
});

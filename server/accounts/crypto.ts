// Cryptography for accounts, built on Node's own crypto module: password
// hashing (scrypt), random tokens and codes, signed short-lived tokens,
// encryption of stored secrets, and two-step verification codes (TOTP).

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

// ----- passwords -----

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** OWASP's recommended scrypt setting that fits in 64 MB of memory. */
export const PASSWORD_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
const KEY_LENGTH = 32;

function scryptAsync(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...params, maxmem: 256 * params.N * params.r }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Hash a password for storage. The result records the settings used, so they can be raised later. */
export async function hashPassword(password: string, params: ScryptParams = PASSWORD_PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** True when the password matches the stored hash. Never throws on a malformed hash. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) };
  if (!Number.isInteger(params.N) || params.N < 2 || params.N > 2 ** 20 || !Number.isInteger(params.r) || params.r < 1 || params.r > 32 || !Number.isInteger(params.p) || params.p < 1 || params.p > 16) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, salt, params);
  return timingSafeEqual(actual, expected);
}

/** True when a stored hash was made with weaker settings than today's and should be redone at next sign-in. */
export function passwordNeedsRehash(stored: string, params: ScryptParams = PASSWORD_PARAMS): boolean {
  return !stored.startsWith(`scrypt$${params.N}$${params.r}$${params.p}$`);
}

// ----- random tokens and codes -----

/** A random token for sessions, links and invites: 256 bits, safe in URLs and cookies. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A 6-digit code, every value equally likely. */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** What is stored in place of a token: its SHA-256 hash. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Hash for a short code. A 6-digit code alone would be the same for many
 * people, so the hash also covers who and what the code is for.
 */
export function hashCode(code: string, purpose: string, ownerId: number): Buffer {
  return createHash('sha256').update(`${purpose}:${ownerId}:${code}`).digest();
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ----- keys derived from AUTH_SECRET -----

/** A separate key for each use, so one use can never be mistaken for another. */
export function deriveKey(secret: string, use: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'hairbydemj', use, 32));
}

// ----- signed short-lived tokens -----

/** A small signed message with an expiry, for example "this person passed the password step". */
export function signToken(payload: Record<string, unknown>, key: Buffer, ttlSeconds: number, now: Date = new Date()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now.getTime() / 1000) + ttlSeconds })).toString('base64url');
  const signature = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** The payload if the signature is right and the token has not expired; otherwise null. */
export function readToken(token: string, key: Buffer, now: Date = new Date()): Record<string, unknown> | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(now.getTime() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ----- encryption of stored secrets (AES-256-GCM) -----

export function seal(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body]);
}

/** Throws if the data was changed or the key is wrong. */
export function unseal(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < 29 || sealed[0] !== 1) throw new Error('Unreadable sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]);
}

// ----- two-step verification codes (TOTP, RFC 6238) -----

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** A new secret for an authenticator app: 160 bits, as the standard recommends. */
export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

/**
 * Check a code against the current 30-second step and the one on either side
 * (clocks drift). Returns the step that matched, or null. A step at or before
 * lastStep is refused, so no code works twice.
 */
export function verifyTotp(secret: Buffer, code: string, now: Date, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (safeEqual(totpCode(secret, step), code) && (lastStep === null || step > lastStep)) matched = matched ?? step;
  }
  return matched;
}

/** The address an authenticator app reads (usually from a QR code) to add the account. */
export function totpUri(secret: Buffer, account: string, issuer = 'hairbydemj'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

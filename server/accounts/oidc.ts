// Google and Apple sign-in. The website or the app gets an "ID token" from
// Google or Apple and sends it here; this code checks that the token is
// genuine, meant for us, and fresh. No Google or Apple library is used and
// no client secret is needed: the tokens are checked against the providers'
// published public keys.

import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

export type Provider = 'google' | 'apple';

export interface ProviderSettings {
  issuers: string[];
  keysUrl: string;
  clientIds: string[];
}

export interface Identity {
  provider: Provider;
  /** The provider's own, permanent id for the person. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export class IdentityError extends Error {
  override name = 'IdentityError';
}

export type KeyFetcher = (url: string) => Promise<{ keys: Array<JsonWebKey & { kid?: string }>; maxAgeSeconds: number }>;

export const PROVIDER_DEFAULTS: Record<Provider, Omit<ProviderSettings, 'clientIds'>> = {
  google: { issuers: ['https://accounts.google.com', 'accounts.google.com'], keysUrl: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { issuers: ['https://appleid.apple.com'], keysUrl: 'https://appleid.apple.com/auth/keys' },
};

/** Fetch a provider's public keys over HTTPS. */
export const fetchKeys: KeyFetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new IdentityError(`Could not fetch sign-in keys (${response.status})`);
  const body = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '');
  return { keys: body.keys ?? [], maxAgeSeconds: maxAge ? Number(maxAge[1]) : 3600 };
};

function decodePart(part: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new IdentityError('The sign-in token is not readable');
}

export interface VerifyOptions {
  /** If given, the token must carry exactly this nonce. */
  nonce?: string;
}

export interface IdentityVerifier {
  verify(provider: Provider, idToken: string, options?: VerifyOptions): Promise<Identity>;
}

/** Tokens older than this are refused even if the provider's own expiry is later. */
const MAX_TOKEN_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;

export function createIdentityVerifier(
  settings: Record<Provider, ProviderSettings>,
  getKeys: KeyFetcher = fetchKeys,
  now: () => Date = () => new Date(),
): IdentityVerifier {
  const cache = new Map<string, { keys: Array<JsonWebKey & { kid?: string }>; until: number }>();

  async function keyFor(url: string, kid: string): Promise<JsonWebKey | null> {
    const cached = cache.get(url);
    const hit = cached && cached.until > now().getTime() ? cached.keys.find((k) => k.kid === kid) : undefined;
    if (hit) return hit;
    // Unknown key id or stale cache: providers rotate keys, so fetch again once.
    const fresh = await getKeys(url);
    cache.set(url, { keys: fresh.keys, until: now().getTime() + Math.min(fresh.maxAgeSeconds, 24 * 3600) * 1000 });
    return fresh.keys.find((k) => k.kid === kid) ?? null;
  }

  return {
    async verify(provider, idToken, options = {}) {
      const config = settings[provider];
      if (config.clientIds.length === 0) throw new IdentityError(`${provider === 'google' ? 'Google' : 'Apple'} sign-in is not set up`);
      const parts = idToken.split('.');
      if (parts.length !== 3 || idToken.length > 8192) throw new IdentityError('The sign-in token is not readable');
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
      const header = decodePart(headerPart);
      // Only RS256 is accepted. In particular "none" and HMAC algorithms are
      // refused, which closes the classic token-forging tricks.
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new IdentityError('The sign-in token uses an unsupported signature');
      const jwk = await keyFor(config.keysUrl, header.kid);
      if (!jwk || jwk.kty !== 'RSA') throw new IdentityError('The sign-in token was signed with an unknown key');
      const verifier = createVerify('RSA-SHA256').update(`${headerPart}.${payloadPart}`);
      if (!verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signaturePart, 'base64url'))) {
        throw new IdentityError('The sign-in token signature is wrong');
      }

      const claims = decodePart(payloadPart);
      const seconds = Math.floor(now().getTime() / 1000);
      if (typeof claims.iss !== 'string' || !config.issuers.includes(claims.iss)) throw new IdentityError('The sign-in token is from the wrong issuer');
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.some((a) => typeof a === 'string' && config.clientIds.includes(a))) throw new IdentityError('The sign-in token was issued for a different app');
      if (typeof claims.exp !== 'number' || claims.exp <= seconds - CLOCK_SKEW_SECONDS) throw new IdentityError('The sign-in token has expired');
      if (typeof claims.iat !== 'number' || claims.iat > seconds + CLOCK_SKEW_SECONDS || claims.iat < seconds - MAX_TOKEN_AGE_SECONDS) throw new IdentityError('The sign-in token is too old');
      if (options.nonce !== undefined && claims.nonce !== options.nonce) throw new IdentityError('The sign-in token does not match this sign-in attempt');
      if (typeof claims.sub !== 'string' || claims.sub === '') throw new IdentityError('The sign-in token names nobody');

      const email = typeof claims.email === 'string' && claims.email.includes('@') ? claims.email.trim().toLowerCase() : null;
      return {
        provider,
        subject: claims.sub,
        email,
        // Apple sends "true" as text in some tokens.
        emailVerified: email !== null && (claims.email_verified === true || claims.email_verified === 'true'),
        name: typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name.trim() : null,
      };
    },
  };
}

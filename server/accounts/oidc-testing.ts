// Helpers for tests: a stand-in for Google or Apple that signs ID tokens with its own key.

import { createSign, generateKeyPairSync, type JsonWebKey, type KeyObject } from 'node:crypto';

export interface TestIssuer {
  kid: string;
  jwk: JsonWebKey & { kid: string };
  privateKey: KeyObject;
}

export function makeIssuer(kid: string): TestIssuer {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, jwk: { ...publicKey.export({ format: 'jwk' }), kid }, privateKey };
}

export function makeIdToken(issuer: TestIssuer, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: issuer.kid, typ: 'JWT', ...header })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(issuer.privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

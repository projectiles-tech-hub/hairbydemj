// Gift card codes: how they look, how they are stored, and how one is found.
// A code is stored only as a hash, like a password; the last four characters
// are kept so a card can be recognised.

import { createHash, randomInt } from 'node:crypto';
import type { Db, DbClient } from '../db/pool.js';

type Q = { query: DbClient['query'] } | Db;

/** Letters and digits that cannot be mistaken for one another (no 0/O, 1/I/L, 5/S, 8/B). */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ2345679';

/** A new code: 16 characters in four groups, about 77 bits of chance. */
export function newGiftCardCode(): string {
  let code = '';
  for (let i = 0; i < 16; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code.match(/.{4}/g)?.join('-') ?? code;
}

/** Spaces, dashes and letter case do not matter when a code is typed. */
export function normaliseGiftCardCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function giftCardHash(code: string): Buffer {
  return createHash('sha256').update(`gift-card:${normaliseGiftCardCode(code)}`).digest();
}

export function giftCardLast4(code: string): string {
  return normaliseGiftCardCode(code).slice(-4);
}

export interface GiftCardRow {
  id: number;
  last4: string;
  currency: string;
  balanceMinor: number;
  status: string;
  expiresAt: Date | null;
}

export async function findGiftCard(db: Q, code: string): Promise<GiftCardRow | null> {
  const result = await db.query('select id, code_last4, currency, balance_minor, status, expires_at from gift_cards where code_hash = $1', [giftCardHash(code)]);
  const r = result.rows[0] as Record<string, unknown> | undefined;
  return r ? { id: Number(r.id), last4: String(r.code_last4), currency: String(r.currency), balanceMinor: Number(r.balance_minor), status: String(r.status), expiresAt: (r.expires_at as Date | null) ?? null } : null;
}

/** Why a card cannot be used right now, or null when it can. */
export function giftCardProblem(card: GiftCardRow, now: Date): string | null {
  if (card.status === 'disabled') return 'This gift card has been switched off. Contact us if you think this is a mistake.';
  if (card.status === 'pending') return 'This gift card is not active yet.';
  if (card.status === 'expired' || (card.expiresAt !== null && card.expiresAt <= now)) return 'This gift card has expired.';
  if (card.status === 'used_up' || card.balanceMinor <= 0) return 'This gift card has no balance left.';
  return null;
}

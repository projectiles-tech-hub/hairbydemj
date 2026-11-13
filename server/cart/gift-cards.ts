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

// ----- using gift cards on an order (module 9) -----

export class GiftCardSpent extends Error {
  override name = 'GiftCardSpent';
}

/**
 * Take up to `amountMinor` from these cards, in order, for an order. Each
 * card is locked first, so two checkouts cannot spend the same balance.
 * Returns how much was taken. Must run inside a transaction.
 */
export async function redeemGiftCards(c: Q, orderId: number, cardIds: number[], currency: string, amountMinor: number, now: Date): Promise<number> {
  let left = amountMinor;
  for (const id of cardIds) {
    if (left <= 0) break;
    const found = await c.query('select id, code_last4, currency, balance_minor, status, expires_at from gift_cards where id = $1 for update', [id]);
    const r = found.rows[0];
    if (!r) continue;
    const card: GiftCardRow = { id: Number(r.id), last4: String(r.code_last4), currency: String(r.currency), balanceMinor: Number(r.balance_minor), status: String(r.status), expiresAt: (r.expires_at as Date | null) ?? null };
    if (giftCardProblem(card, now) || card.currency !== currency) continue;
    const take = Math.min(card.balanceMinor, left);
    const after = card.balanceMinor - take;
    await c.query("update gift_cards set balance_minor = $2::bigint, status = case when $2::bigint = 0 then 'used_up' else status end where id = $1", [id, after]);
    await c.query("insert into gift_card_transactions (gift_card_id, order_id, kind, amount_minor, balance_after_minor) values ($1, $2, 'redeem', $3, $4)", [id, orderId, -take, after]);
    left -= take;
  }
  return amountMinor - left;
}

/** What each card gave an order, less what was already put back. */
async function netUse(c: Q, orderId: number): Promise<Array<{ id: number; used: number }>> {
  const found = await c.query(
    "select gift_card_id, -sum(amount_minor)::bigint as used from gift_card_transactions where order_id = $1 and kind in ('redeem', 'refund') group by gift_card_id order by gift_card_id",
    [orderId],
  );
  return found.rows.map((r) => ({ id: Number(r.gift_card_id), used: Number(r.used) })).filter((r) => r.used > 0);
}

/**
 * Put money back onto the order's gift cards: all of it (an unpaid order
 * that expired, or a cancelled one), or `amountMinor` of it (a return).
 * Returns how much was put back.
 */
export async function restoreGiftCards(c: Q, orderId: number, staffId: number | null, amountMinor?: number): Promise<number> {
  let left = amountMinor ?? Number.MAX_SAFE_INTEGER;
  let restored = 0;
  for (const { id, used } of await netUse(c, orderId)) {
    if (left <= 0) break;
    const give = Math.min(used, left);
    const card = await c.query(
      "update gift_cards set balance_minor = least(balance_minor + $2, initial_minor), status = case when status = 'used_up' then 'active' else status end where id = $1 returning balance_minor",
      [id, give],
    );
    await c.query("insert into gift_card_transactions (gift_card_id, order_id, kind, amount_minor, balance_after_minor, staff_id) values ($1, $2, 'refund', $3, $4, $5)", [id, orderId, give, card.rows[0]?.balance_minor, staffId]);
    left -= give;
    restored += give;
  }
  return restored;
}

/**
 * A payment arrived for an order that had expired and given its gift card
 * money back. Take that money from the same cards again; if a card has been
 * spent since, throw GiftCardSpent so the payment is refunded instead.
 */
export async function reRedeemGiftCards(c: Q, orderId: number, now: Date): Promise<void> {
  const order = await c.query('select currency, gift_card_minor from orders where id = $1', [orderId]);
  const due = Number(order.rows[0]?.gift_card_minor ?? 0);
  const already = (await netUse(c, orderId)).reduce((s, r) => s + r.used, 0);
  const needed = due - already;
  if (needed <= 0) return;
  const cards = await c.query('select distinct gift_card_id from gift_card_transactions where order_id = $1 order by gift_card_id', [orderId]);
  const taken = await redeemGiftCards(c, orderId, cards.rows.map((r) => Number(r.gift_card_id)), String(order.rows[0]?.currency), needed, now);
  if (taken < needed) throw new GiftCardSpent('A gift card used on this order has been spent since');
}

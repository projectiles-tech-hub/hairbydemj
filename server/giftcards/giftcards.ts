// Gift cards bought in the shop, checking a balance, and staff management
// (module 17). Using a gift card at checkout is in cart/gift-cards.ts.
//
// Buying one places an order with a single gift card item and no delivery.
// The card is made then, waiting; when the payment is confirmed it gets its
// code and is emailed to the person receiving it, now or on the chosen day.

import { hashToken, randomToken } from '../accounts/crypto.js';
import { emailOf } from '../accounts/deps.js';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { findGiftCard, giftCardHash, giftCardLast4, newGiftCardCode } from '../cart/gift-cards.js';
import { checkCurrency } from '../cart/money.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import { orderEvent } from '../payments/order-paid.js';

type Q = { query: DbClient['query'] } | Db;

export interface GiftCardDeps {
  db: Db;
  now: () => Date;
  mail: { send(email: { to: string; template: 'order_confirmation' | 'gift_card'; data: Record<string, string> }): Promise<void> };
}

/** The amounts a card can be bought for, in each currency's main unit. */
export const GIFT_CARDS = {
  limits: { NGN: [5_000, 2_000_000], USD: [10, 1_500], GBP: [10, 1_200], EUR: [10, 1_400] } as Record<string, [number, number]>,
  /** Cards last this long from when they are sent. */
  validDays: 365 * 2,
  /** The latest a card can be set to arrive. */
  maxDeliverDays: 365,
  holdMinutes: 30,
};

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Start buying a gift card: an order to pay for, like any other. */
export async function buyGiftCard(deps: GiftCardDeps, customerId: number | null, input: Record<string, unknown>, source: 'web' | 'app'): Promise<{ orderId: number; number: string; orderToken: string; amountDueMinor: number; currency: string }> {
  const currency = await checkCurrency(deps.db, input.currency);
  const minorUnits = Number((await deps.db.query('select minor_units from currencies where code = $1', [currency])).rows[0]?.minor_units ?? 2);
  const limits = GIFT_CARDS.limits[currency] ?? [1, 1_000_000];
  const amount = Number(input.amountMinor);
  if (!Number.isInteger(amount) || amount < limits[0] * 10 ** minorUnits || amount > limits[1] * 10 ** minorUnits) throw invalid('amountMinor', `Choose an amount from ${limits[0].toLocaleString('en-NG')} to ${limits[1].toLocaleString('en-NG')} ${currency}.`);
  let buyer: string;
  if (customerId !== null) {
    const account = await deps.db.query('select email from customers where id = $1', [customerId]);
    buyer = input.email ? emailOf(input.email) : String(account.rows[0]?.email);
  } else {
    buyer = emailOf(input.email);
  }
  let recipient: string;
  try {
    recipient = emailOf(input.recipientEmail);
  } catch {
    throw invalid('recipientEmail', 'Enter the email address of the person receiving the card.');
  }
  const recipientName = text(input.recipientName, 80) || null;
  const from = text(input.fromName, 80);
  if (!from) throw invalid('fromName', 'Say who the card is from.');
  const message = text(input.message, 300) || null;
  const now = deps.now();
  let deliverAt: Date | null = null;
  if (input.deliverOn) {
    const d = new Date(`${String(input.deliverOn)}T08:00:00+01:00`);
    if (Number.isNaN(d.getTime())) throw invalid('deliverOn', 'Choose a date.');
    if (d.getTime() > now.getTime() + GIFT_CARDS.maxDeliverDays * 86_400_000) throw invalid('deliverOn', 'Choose a date within a year.');
    if (d.getTime() > now.getTime()) deliverAt = d;
  }
  const token = randomToken();
  const placed = await withTransaction(deps.db, async (c) => {
    // A waiting card; its real code is made when the payment is confirmed.
    const card = await c.query(
      `insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, purchaser_customer_id, recipient_email, recipient_name, message, deliver_at, status)
       values ($1, '----', $2, $3, $3, $4, $5, $6, $7, $8, 'pending') returning id`,
      [giftCardHash(randomToken()), currency, amount, customerId, recipient, recipientName, JSON.stringify({ from, message }), deliverAt],
    );
    const cardId = Number(card.rows[0]?.id);
    const made = await c.query(
      `insert into orders (customer_id, email, source, currency, status, payment_status, subtotal_minor, total_minor, stock_held_until, access_token_hash, placed_at)
       values ($1, $2, $3, $4, 'on_hold', 'awaiting', $5, $5, $6, $7, $8) returning id, number`,
      [customerId, buyer, source, currency, amount, new Date(now.getTime() + GIFT_CARDS.holdMinutes * 60_000), hashToken(token), now],
    );
    const orderId = Number(made.rows[0]?.id);
    await c.query(
      "insert into order_items (order_id, kind, gift_card_id, product_name, variant_description, quantity, unit_price_minor, total_minor, is_final_sale) values ($1, 'gift_card', $2, 'Gift card', $3, 1, $4, $4, true)",
      [orderId, cardId, `For ${recipientName ? `${recipientName}, ` : ''}${recipient}${deliverAt ? `, sent on ${deliverAt.toISOString().slice(0, 10)}` : ''}`, amount],
    );
    await orderEvent(c, orderId, 'placed', 'Gift card order placed', { visible: true });
    return { orderId, number: String(made.rows[0]?.number) };
  });
  await deps.mail.send({ to: buyer, template: 'order_confirmation', data: { orderNumber: placed.number, orderToken: token } });
  return { ...placed, orderToken: token, amountDueMinor: amount, currency };
}

/**
 * Called inside markOrderPaid: gift cards bought on the order get their codes
 * and are emailed (now, or on the day chosen). An order of only gift cards is
 * then complete.
 */
export async function activateBoughtGiftCards(c: Q, orderId: number, now: Date): Promise<void> {
  const cards = await c.query(
    "select g.id, g.currency, g.initial_minor, g.recipient_email, g.recipient_name, g.message, g.deliver_at from order_items oi join gift_cards g on g.id = oi.gift_card_id where oi.order_id = $1 and oi.kind = 'gift_card' and g.status in ('pending', 'disabled') and g.delivered_at is null for update of g",
    [orderId],
  );
  for (const g of cards.rows) {
    const code = newGiftCardCode();
    const sendAt = (g.deliver_at as Date | null) && (g.deliver_at as Date) > now ? (g.deliver_at as Date) : now;
    await c.query(
      "update gift_cards set code_hash = $2, code_last4 = $3, status = 'active', delivered_at = $4, expires_at = $5 where id = $1",
      [g.id, giftCardHash(code), giftCardLast4(code), sendAt, new Date(sendAt.getTime() + GIFT_CARDS.validDays * 86_400_000)],
    );
    await c.query("insert into gift_card_transactions (gift_card_id, order_id, kind, amount_minor, balance_after_minor) values ($1, $2, 'issue', $3, $3)", [g.id, orderId, g.initial_minor]);
    let note: { from?: string; message?: string | null } = {};
    try {
      note = JSON.parse(String(g.message ?? '{}')) as typeof note;
    } catch {
      note = { message: String(g.message ?? '') };
    }
    // The code sits in this job only until the email is sent (as with other emails).
    await c.query("insert into jobs (kind, payload, run_at) values ('email.send', $1, $2)", [
      JSON.stringify({ to: g.recipient_email, template: 'gift_card', data: { code, amountMinor: String(g.initial_minor), currency: String(g.currency), from: note.from ?? 'Someone', message: note.message ?? '', name: String(g.recipient_name ?? '') } }),
      sendAt,
    ]);
  }
  if (cards.rows.length) {
    const physical = await c.query("select 1 from order_items where order_id = $1 and kind = 'variant' limit 1", [orderId]);
    if (!physical.rowCount) {
      await c.query("update orders set status = 'delivered' where id = $1 and status in ('on_hold', 'to_fulfil')", [orderId]);
      await orderEvent(c, orderId, 'delivered', cards.rows.some((g) => (g.deliver_at as Date | null) && (g.deliver_at as Date) > now) ? 'Gift card ready; it will be emailed on the chosen day' : 'Gift card emailed', { visible: true });
    }
  }
}

/** A balance, from the code. Callers limit how often this can be tried. */
export async function giftCardBalance(db: Db, code: unknown, now: Date): Promise<{ last4: string; currency: string; balanceMinor: number; status: string; expiresAt: string | null }> {
  if (typeof code !== 'string' || code.replace(/[^A-Za-z0-9]/g, '').length < 8) throw invalid('code', 'Enter the code from your gift card email.');
  const card = await findGiftCard(db, code);
  if (!card || card.status === 'pending') throw invalid('code', 'We could not find a gift card with that code.');
  const expired = card.status === 'expired' || (card.expiresAt !== null && card.expiresAt <= now);
  return { last4: card.last4, currency: card.currency, balanceMinor: card.balanceMinor, status: expired ? 'expired' : card.status, expiresAt: card.expiresAt?.toISOString() ?? null };
}

// ----- staff -----

export async function listGiftCards(db: Db, staff: StaffMember, query: URLSearchParams): Promise<{ cards: Array<Record<string, unknown>>; total: number; page: number }> {
  requireAccess(staff, 'discounts', 'view');
  const page = Math.max(1, Math.min(10_000, Number(query.get('page')) || 1));
  const where: string[] = ["g.status <> 'pending'"];
  const params: unknown[] = [];
  const q = (query.get('q') ?? '').trim();
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    params.push(q.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-4));
    where.push(`(g.recipient_email ilike $${params.length - 1} or g.code_last4 = $${params.length})`);
  }
  const status = query.get('status');
  if (status && ['active', 'used_up', 'expired', 'disabled'].includes(status)) {
    params.push(status);
    where.push(`g.status = $${params.length}`);
  }
  const sql = `from gift_cards g left join staff s on s.id = g.issued_by_staff_id where ${where.join(' and ')}`;
  const total = Number((await db.query(`select count(*)::int as n ${sql}`, params)).rows[0]?.n ?? 0);
  params.push(page * 50 - 50);
  const found = await db.query(
    `select g.id, g.code_last4, g.currency, g.initial_minor, g.balance_minor, g.status, g.recipient_email, g.recipient_name, g.issue_reason, g.created_at, g.delivered_at, g.expires_at, s.name as issued_by,
            (select o.number from order_items oi join orders o on o.id = oi.order_id where oi.gift_card_id = g.id limit 1) as order_number
       ${sql} order by g.created_at desc, g.id desc limit 50 offset $${params.length}`,
    params,
  );
  return {
    cards: found.rows.map((r) => ({
      id: Number(r.id),
      last4: String(r.code_last4),
      currency: String(r.currency),
      initialMinor: Number(r.initial_minor),
      balanceMinor: Number(r.balance_minor),
      status: String(r.status),
      recipientEmail: String(r.recipient_email),
      recipientName: (r.recipient_name as string | null) ?? null,
      source: r.order_number ? `Bought (order ${String(r.order_number)})` : r.issue_reason ? `Issued by ${String(r.issued_by ?? 'staff')}: ${String(r.issue_reason)}` : 'Store credit',
      createdAt: (r.created_at as Date).toISOString(),
      expiresAt: r.expires_at ? (r.expires_at as Date).toISOString() : null,
    })),
    total,
    page,
  };
}

/** Staff give a card (a goodwill gesture, a prize). The reason is kept and logged. */
export async function issueGiftCard(deps: GiftCardDeps, staff: StaffMember, input: Record<string, unknown>, ip: string | null): Promise<{ id: number; last4: string }> {
  requireAccess(staff, 'discounts', 'change');
  const currency = await checkCurrency(deps.db, input.currency);
  const amount = Number(input.amountMinor);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000_00) throw invalid('amountMinor', 'Give an amount.');
  let recipient: string;
  try {
    recipient = emailOf(input.recipientEmail);
  } catch {
    throw invalid('recipientEmail', 'Enter the email address to send the card to.');
  }
  const reason = text(input.reason, 200);
  if (!reason) throw invalid('reason', 'Say why the card is given, for the record.');
  const code = newGiftCardCode();
  const now = deps.now();
  const id = await withTransaction(deps.db, async (c) => {
    const made = await c.query(
      "insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, issued_by_staff_id, issue_reason, recipient_email, recipient_name, status, delivered_at, expires_at) values ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'active', $9, $10) returning id",
      [giftCardHash(code), giftCardLast4(code), currency, amount, staff.id, reason, recipient, text(input.recipientName, 80) || null, now, new Date(now.getTime() + GIFT_CARDS.validDays * 86_400_000)],
    );
    const cardId = Number(made.rows[0]?.id);
    await c.query("insert into gift_card_transactions (gift_card_id, kind, amount_minor, balance_after_minor, staff_id) values ($1, 'issue', $2, $2, $3)", [cardId, amount, staff.id]);
    return cardId;
  });
  await deps.mail.send({ to: recipient, template: 'gift_card', data: { code, amountMinor: String(amount), currency, from: 'hairbydemj', message: text(input.message, 300), name: text(input.recipientName, 80) } });
  await logActivity(deps.db, staff, 'discounts', `Issued a gift card ending ${giftCardLast4(code)} to ${recipient}: ${reason}`, { type: 'gift_card', id }, ip);
  return { id, last4: giftCardLast4(code) };
}

export async function setGiftCardActive(db: Db, staff: StaffMember, id: number, active: boolean, ip: string | null): Promise<void> {
  requireAccess(staff, 'discounts', 'change');
  const found = await db.query(
    `update gift_cards set status = case when $2 then (case when balance_minor = 0 then 'used_up' when expires_at is not null and expires_at <= now() then 'expired' else 'active' end) else 'disabled' end
      where id = $1 and status <> 'pending' returning code_last4`,
    [id, active],
  );
  if (!found.rowCount) throw new ApiError(404, 'not_found', 'That gift card does not exist.');
  await logActivity(db, staff, 'discounts', `${active ? 'Switched on' : 'Switched off'} the gift card ending ${String(found.rows[0]?.code_last4)}`, { type: 'gift_card', id }, ip);
}

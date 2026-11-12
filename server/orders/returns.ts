// Returns: the customer asks, staff approve or decline, the parcel comes
// back, staff check it, and the money goes back (to the card or bank it came
// from, and to any gift card used) or as store credit with a bonus.
//
//   requested → approved → received → refunded
//            ↘ rejected   (or cancelled by the customer while still requested)

import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { giftCardHash, giftCardLast4, newGiftCardCode, restoreGiftCards } from '../cart/gift-cards.js';
import { restock } from '../cart/stock.js';
import { ApiError } from '../http.js';
import { orderEvent, updateRefundStatus } from '../payments/order-paid.js';
import { refundPayment, type PaymentDeps } from '../payments/payments.js';
import type { OrderDeps } from './checkout.js';
import { returnSettings, returnWindowOpen } from './orders.js';

type Q = { query: DbClient['query'] } | Db;

export const REASONS = ['wrong_item', 'wrong_length', 'damaged', 'not_as_described', 'changed_mind', 'other'] as const;
type Reason = (typeof REASONS)[number];
/** A final-sale item can still come back when we got it wrong or it arrived damaged. */
const FAULTS: readonly Reason[] = ['wrong_item', 'wrong_length', 'damaged', 'not_as_described'];

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', message, { [field]: message });

/** An item's share of the money paid: its price less its share of the order's discounts. */
function itemRefund(unitMinor: number, quantity: number, order: { subtotal: number; discount: number }): number {
  const gross = unitMinor * quantity;
  if (order.subtotal <= 0) return gross;
  return Math.max(0, gross - Math.ceil((order.discount * gross) / order.subtotal));
}

export interface ReturnView {
  id: number;
  number: string;
  orderId: number;
  orderNumber: string;
  status: string;
  resolution: string;
  customerNote: string | null;
  decisionNote: string | null;
  conditionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  receivedAt: string | null;
  items: Array<{ orderItemId: number; name: string; description: string; quantity: number; reason: string; refundMinor: number }>;
  refundMinor: number;
  currency: string;
  storeCreditLast4: string | null;
}

export async function returnView(db: Q, returnId: number): Promise<ReturnView> {
  const found = await db.query(
    'select r.*, o.number as order_number, o.currency, g.code_last4 from returns r join orders o on o.id = r.order_id left join gift_cards g on g.id = r.store_credit_gift_card_id where r.id = $1',
    [returnId],
  );
  const r = found.rows[0];
  if (!r) throw new ApiError(404, 'not_found', 'We could not find that return.');
  const items = await db.query('select ri.order_item_id, ri.quantity, ri.reason, ri.refund_minor, oi.product_name, oi.variant_description from return_items ri join order_items oi on oi.id = ri.order_item_id where ri.return_id = $1 order by ri.id', [returnId]);
  const list = items.rows.map((i) => ({ orderItemId: Number(i.order_item_id), name: String(i.product_name), description: String(i.variant_description), quantity: Number(i.quantity), reason: String(i.reason), refundMinor: Number(i.refund_minor) }));
  const date = (v: unknown): string | null => (v ? (v as Date).toISOString() : null);
  return {
    id: Number(r.id),
    number: String(r.number),
    orderId: Number(r.order_id),
    orderNumber: String(r.order_number),
    status: String(r.status),
    resolution: String(r.resolution),
    customerNote: (r.customer_note as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    conditionNote: (r.condition_note as string | null) ?? null,
    requestedAt: (r.requested_at as Date).toISOString(),
    decidedAt: date(r.decided_at),
    receivedAt: date(r.received_at),
    items: list,
    refundMinor: list.reduce((s, i) => s + i.refundMinor, 0),
    currency: String(r.currency),
    storeCreditLast4: (r.code_last4 as string | null) ?? null,
  };
}

/** The customer asks to send items back. */
export async function requestReturn(deps: OrderDeps, orderId: number, customerId: number | null, input: Record<string, unknown>): Promise<ReturnView> {
  const resolution = input.resolution === undefined ? 'refund' : input.resolution;
  if (resolution !== 'refund' && resolution !== 'store_credit') throw invalid('resolution', 'Choose money back or store credit.');
  const note = (typeof input.note === 'string' ? input.note.trim() : '').slice(0, 1000) || null;
  const requested: unknown[] = Array.isArray(input.items) ? input.items : [];
  if (requested.length === 0 || requested.length > 50) throw invalid('items', 'Choose the items to send back.');

  const returnId = await withTransaction(deps.db, async (c) => {
    const found = await c.query('select id, number, status, customer_id, email, subtotal_minor, discount_minor, points_minor from orders where id = $1 for update', [orderId]);
    const order = found.rows[0];
    if (!order) throw new ApiError(404, 'not_found', 'We could not find that order.');
    if (order.status !== 'delivered') throw new ApiError(409, 'not_delivered', 'Items can be sent back once your order has been delivered.');
    const window = await returnWindowOpen(c, orderId, deps.now());
    if (!window.open) throw new ApiError(409, 'window_closed', `Returns for this order closed on ${window.closesAt?.toISOString().slice(0, 10) ?? 'delivery'}. Contact us if something is wrong.`);
    const items = await c.query(
      `select oi.id, oi.kind, oi.quantity, oi.unit_price_minor, oi.is_final_sale, oi.product_name,
              coalesce((select sum(ri.quantity) from return_items ri join returns r on r.id = ri.return_id where ri.order_item_id = oi.id and r.status not in ('rejected', 'cancelled')), 0)::int as in_returns
       from order_items oi where oi.order_id = $1`,
      [orderId],
    );
    const byId = new Map(items.rows.map((r) => [Number(r.id), r]));
    const totals = { subtotal: Number(order.subtotal_minor), discount: Number(order.discount_minor) + Number(order.points_minor) };
    const wanted = new Map<number, { quantity: number; reason: Reason }>();
    requested.forEach((raw, k) => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const id = Number(r.orderItemId);
      const item = byId.get(id);
      if (!item || item.kind !== 'variant' || wanted.has(id)) throw invalid('items', `Item ${k + 1} is not part of this order.`);
      const quantity = Number(r.quantity ?? 1);
      const left = Number(item.quantity) - Number(item.in_returns);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > left) throw invalid('items', left === 0 ? `${String(item.product_name)} is already in a return.` : `You can send back at most ${left} of ${String(item.product_name)}.`);
      const reason = r.reason as Reason;
      if (!REASONS.includes(reason)) throw invalid('items', `Choose a reason for ${String(item.product_name)}.`);
      if (item.is_final_sale && !FAULTS.includes(reason)) throw invalid('items', `${String(item.product_name)} was a final sale, so it can only come back if it was wrong or damaged.`);
      wanted.set(id, { quantity, reason });
    });
    const made = await c.query('insert into returns (order_id, customer_id, resolution, customer_note, requested_at) values ($1, $2, $3, $4, $5) returning id, number', [orderId, customerId ?? order.customer_id, resolution, note, deps.now()]);
    const id = Number(made.rows[0]?.id);
    for (const [itemId, w] of wanted) {
      const item = byId.get(itemId);
      await c.query('insert into return_items (return_id, order_item_id, quantity, reason, refund_minor) values ($1, $2, $3, $4, $5)', [id, itemId, w.quantity, w.reason, itemRefund(Number(item?.unit_price_minor), w.quantity, totals)]);
    }
    await orderEvent(c, orderId, 'return_requested', `Return ${String(made.rows[0]?.number)} requested.`, { visible: true });
    return id;
  });
  const view = await returnView(deps.db, returnId);
  await notify(deps, returnId, 'requested');
  return view;
}

async function notify(deps: OrderDeps, returnId: number, status: string): Promise<void> {
  const r = await deps.db.query('select r.number, o.number as order_number, o.email from returns r join orders o on o.id = r.order_id where r.id = $1', [returnId]);
  const row = r.rows[0];
  if (row) await deps.mail.send({ to: String(row.email), template: 'return_update', data: { returnNumber: String(row.number), orderNumber: String(row.order_number), status } });
}

async function lockReturn(c: Q, returnId: number): Promise<{ id: number; number: string; orderId: number; status: string; resolution: string }> {
  const found = await c.query('select id, number, order_id, status, resolution from returns where id = $1 for update', [returnId]);
  const r = found.rows[0];
  if (!r) throw new ApiError(404, 'not_found', 'We could not find that return.');
  return { id: Number(r.id), number: String(r.number), orderId: Number(r.order_id), status: String(r.status), resolution: String(r.resolution) };
}

const wrongStep = (now: string, needed: string): ApiError => new ApiError(409, 'wrong_step', `This return is ${now.replace('_', ' ')}; it must be ${needed} first.`);

/** The customer changes their mind while the return is still waiting for a decision. */
export async function cancelReturn(deps: OrderDeps, returnId: number): Promise<void> {
  await withTransaction(deps.db, async (c) => {
    const r = await lockReturn(c, returnId);
    if (r.status === 'cancelled') return;
    if (r.status !== 'requested') throw new ApiError(409, 'wrong_step', 'This return has already been decided. Contact us to change it.');
    await c.query("update returns set status = 'cancelled' where id = $1", [returnId]);
    await orderEvent(c, r.orderId, 'return_cancelled', `Return ${r.number} cancelled by the customer.`, { visible: true });
  });
}

/** Staff approve (the customer may send the items) or decline, with a note the customer sees. */
export async function decideReturn(deps: OrderDeps, returnId: number, input: Record<string, unknown>, staffId: number): Promise<void> {
  const decision = input.decision;
  if (decision !== 'approve' && decision !== 'reject') throw invalid('decision', 'Choose approve or decline.');
  const note = (typeof input.note === 'string' ? input.note.trim() : '').slice(0, 1000) || null;
  if (decision === 'reject' && !note) throw invalid('note', 'Tell the customer why.');
  const tracking = (typeof input.trackingNumber === 'string' ? input.trackingNumber.trim() : '').slice(0, 60) || null;
  await withTransaction(deps.db, async (c) => {
    const r = await lockReturn(c, returnId);
    if (r.status !== 'requested') throw wrongStep(r.status, 'waiting for a decision');
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await c.query('update returns set status = $2, decision_note = $3, tracking_number = $4, decided_by = $5, decided_at = $6 where id = $1', [returnId, status, note, tracking, staffId, deps.now()]);
    await orderEvent(c, r.orderId, `return_${status}`, decision === 'approve' ? `Return ${r.number} approved.${note ? ` ${note}` : ''}` : `Return ${r.number} declined: ${note}`, { staffId, visible: true });
  });
  await notify(deps, returnId, decision === 'approve' ? 'approved' : 'rejected');
}

/**
 * The parcel came back. Staff note its condition and say which items go back
 * on sale (`restock`: a list of order item ids; anything else is written off).
 */
export async function receiveReturn(deps: OrderDeps, returnId: number, input: Record<string, unknown>, staffId: number): Promise<void> {
  const condition = (typeof input.conditionNote === 'string' ? input.conditionNote.trim() : '').slice(0, 1000);
  if (!condition) throw invalid('conditionNote', 'Note the condition of the items.');
  const restockIds = Array.isArray(input.restock) ? input.restock.map(Number) : [];
  await withTransaction(deps.db, async (c) => {
    const r = await lockReturn(c, returnId);
    if (r.status !== 'approved') throw wrongStep(r.status, 'approved');
    const items = await c.query('select ri.order_item_id, ri.quantity, oi.variant_id from return_items ri join order_items oi on oi.id = ri.order_item_id where ri.return_id = $1', [returnId]);
    const back = items.rows.filter((i) => restockIds.includes(Number(i.order_item_id)) && i.variant_id !== null);
    if (restockIds.some((id) => !items.rows.some((i) => Number(i.order_item_id) === id))) throw invalid('restock', 'Choose items from this return.');
    await restock(c, back.map((i) => ({ variantId: Number(i.variant_id), quantity: Number(i.quantity) })), r.orderId, 'return', staffId);
    await c.query("update returns set status = 'received', condition_note = $2, received_at = $3 where id = $1", [returnId, condition, deps.now()]);
    await orderEvent(c, r.orderId, 'return_received', `Return ${r.number} received. ${condition}`, { staffId });
    await orderEvent(c, r.orderId, 'return_received_customer', `We have received your return ${r.number} and are checking it.`, { visible: true });
  });
  await notify(deps, returnId, 'received');
}

/**
 * Give the money back for a received return. `includesShipping` also gives
 * back the delivery charge (for our mistakes). Money goes first to the
 * payment it came from, then to the gift cards used; or, if the customer
 * chose store credit, onto a new gift card with the bonus added.
 */
export async function refundReturn(deps: OrderDeps, payments: PaymentDeps, returnId: number, input: Record<string, unknown>, staffId: number): Promise<{ amountMinor: number; resolution: string; storeCreditLast4: string | null }> {
  const includesShipping = input.includesShipping === true;
  const current = await returnView(deps.db, returnId);
  if (current.status !== 'received') throw wrongStep(current.status, 'received');
  const order = (await deps.db.query('select id, number, email, currency, shipping_minor, customer_id from orders where id = $1', [current.orderId])).rows[0] as Record<string, unknown>;
  // Delivery is given back once at most.
  const shippingDone = await deps.db.query("select 1 from refunds where order_id = $1 and includes_shipping and status in ('pending', 'succeeded') limit 1", [current.orderId]);
  const shippingBack = includesShipping && !shippingDone.rowCount ? Number(order.shipping_minor) : 0;
  const amount = current.refundMinor + shippingBack;
  if (amount <= 0) throw new ApiError(409, 'nothing_to_refund', 'There is nothing to refund on this return.');
  const reason = `Return ${current.number}`;
  let last4: string | null = null;

  if (current.resolution === 'store_credit') {
    const settings = await returnSettings(deps.db);
    const credit = amount + Math.floor((amount * settings.storeCreditBonusBps) / 10_000);
    const code = newGiftCardCode();
    await withTransaction(deps.db, async (c) => {
      const r = await lockReturn(c, returnId);
      if (r.status !== 'received') throw wrongStep(r.status, 'received');
      const card = await c.query(
        "insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, purchaser_customer_id, issued_by_staff_id, issue_reason, recipient_email, status, delivered_at) values ($1, $2, $3, $4, $4, $5, $6, $7, $8, 'active', $9) returning id, balance_minor",
        [giftCardHash(code), giftCardLast4(code), order.currency, credit, order.customer_id ?? null, staffId, `Store credit for ${reason}`, order.email, deps.now()],
      );
      const cardId = Number(card.rows[0]?.id);
      await c.query("insert into gift_card_transactions (gift_card_id, order_id, kind, amount_minor, balance_after_minor, staff_id) values ($1, $2, 'issue', $3, $3, $4)", [cardId, current.orderId, credit, staffId]);
      await c.query("update returns set status = 'refunded', store_credit_gift_card_id = $2 where id = $1", [returnId, cardId]);
      await orderEvent(c, current.orderId, 'return_refunded', `Return ${current.number}: store credit of ${credit} sent by email.`, { staffId, visible: true });
      await settleReturnedOrder(c, current.orderId);
    });
    await deps.mail.send({ to: String(order.email), template: 'store_credit', data: { code, amountMinor: String(credit), currency: String(order.currency), returnNumber: current.number } });
    last4 = giftCardLast4(code);
    return { amountMinor: credit, resolution: 'store_credit', storeCreditLast4: last4 };
  }

  // Money back: as much as possible to the payments, the rest to the gift cards.
  const paid = await deps.db.query(
    "select p.id, p.amount_minor - coalesce((select sum(amount_minor) from refunds where payment_id = p.id and status in ('pending', 'succeeded')), 0) as left from payments p where p.order_id = $1 and p.status = 'succeeded' order by p.id",
    [current.orderId],
  );
  let left = amount;
  const items = current.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity }));
  for (const p of paid.rows) {
    if (left <= 0) break;
    const take = Math.min(left, Number(p.left));
    if (take <= 0) continue;
    await refundPayment(payments, Number(p.id), { amountMinor: take, reason, includesShipping: includesShipping && shippingBack > 0, returnId, items }, staffId);
    left -= take;
  }
  await withTransaction(deps.db, async (c) => {
    if (left > 0) {
      const restored = await restoreGiftCards(c, current.orderId, staffId, left);
      if (restored < left) throw new ApiError(409, 'refund_too_large', 'This return is worth more than is left to refund on the order. Check earlier refunds.');
      await orderEvent(c, current.orderId, 'gift_card_refunded', `${restored} put back on the gift card used for this order.`, { staffId, visible: true });
    }
    await c.query("update returns set status = 'refunded' where id = $1", [returnId]);
    await orderEvent(c, current.orderId, 'return_refunded', `Return ${current.number} refunded.`, { staffId, visible: true });
    await updateRefundStatus(c, current.orderId);
    await settleReturnedOrder(c, current.orderId);
  });
  await notify(deps, returnId, 'refunded');
  return { amountMinor: amount, resolution: 'refund', storeCreditLast4: null };
}

/** When every item has come back and been refunded, the whole order counts as returned. */
async function settleReturnedOrder(c: Q, orderId: number): Promise<void> {
  const left = await c.query(
    `select coalesce(sum(oi.quantity), 0)::int - coalesce((select sum(ri.quantity) from return_items ri join returns r on r.id = ri.return_id where r.order_id = $1 and r.status = 'refunded'), 0)::int as left
     from order_items oi where oi.order_id = $1 and oi.kind = 'variant'`,
    [orderId],
  );
  if (Number(left.rows[0]?.left) <= 0) await c.query("update orders set status = 'returned' where id = $1 and status = 'delivered'", [orderId]);
}

export async function listReturns(db: Q, query: URLSearchParams): Promise<Array<Record<string, unknown>>> {
  const status = query.get('status');
  const statuses = ['requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'];
  const found = await db.query(
    `select r.id, r.number, r.status, r.resolution, r.requested_at, o.number as order_number, o.ship_full_name, o.email, o.currency,
            coalesce((select sum(refund_minor) from return_items where return_id = r.id), 0)::bigint as refund,
            (select count(*)::int from return_items where return_id = r.id) as item_count
     from returns r join orders o on o.id = r.order_id ${status && statuses.includes(status) ? 'where r.status = $1' : ''} order by r.requested_at desc, r.id desc limit 200`,
    status && statuses.includes(status) ? [status] : [],
  );
  return found.rows.map((r) => ({ id: Number(r.id), number: r.number, status: r.status, resolution: r.resolution, requestedAt: (r.requested_at as Date).toISOString(), orderNumber: r.order_number, customer: r.ship_full_name || r.email, currency: r.currency, refundMinor: Number(r.refund), itemCount: r.item_count }));
}

export async function saveReturnSettings(db: Q, input: Record<string, unknown>, staffId: number): Promise<void> {
  const days = Number(input.windowDays);
  const bonus = Number(input.storeCreditBonusBps);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw invalid('windowDays', 'Enter the number of days, from 0 to 365.');
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 5000) throw invalid('storeCreditBonusBps', 'Enter the bonus in hundredths of a percent, from 0 to 5000.');
  await db.query("insert into store_settings (key, value, updated_by) values ('returns', $1, $2) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by", [JSON.stringify({ windowDays: days, storeCreditBonusBps: bonus }), staffId]);
}

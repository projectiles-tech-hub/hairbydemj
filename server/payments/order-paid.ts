// What happens to an order when its payment is confirmed, or refunded.
// Module 9 (Orders) builds on these.

import type { Db, DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import { holdStock } from '../cart/stock.js';

type Q = { query: DbClient['query'] } | Db;

export async function orderEvent(c: Q, orderId: number, kind: string, summary: string, options: { staffId?: number | null; visible?: boolean } = {}): Promise<void> {
  await c.query('insert into order_events (order_id, kind, summary, staff_id, visible_to_customer) values ($1, $2, $3, $4, $5)', [orderId, kind, summary, options.staffId ?? null, options.visible ?? false]);
}

/**
 * The provider has confirmed the money. The order becomes one to fulfil.
 * A payment that arrives after an unpaid order was cancelled (its stock let
 * go) takes the stock again if it is still there; if it has sold out
 * meanwhile, the caller must refund the payment.
 */
export async function markOrderPaid(c: Q, orderId: number, now: Date): Promise<{ refundNeeded: boolean }> {
  const found = await c.query('select id, number, status, payment_status from orders where id = $1 for update', [orderId]);
  const order = found.rows[0] as { id: number; number: string; status: string; payment_status: string } | undefined;
  if (!order) throw new Error(`Order ${orderId} vanished`);
  if (order.payment_status === 'paid' || order.payment_status === 'partly_refunded' || order.payment_status === 'refunded') return { refundNeeded: false };

  if (order.status === 'cancelled') {
    const items = await c.query("select variant_id, quantity from order_items where order_id = $1 and kind = 'variant' and variant_id is not null", [orderId]);
    try {
      await c.query('savepoint late_payment');
      await holdStock(c, items.rows.map((r) => ({ variantId: Number(r.variant_id), quantity: Number(r.quantity) })));
      await c.query('release savepoint late_payment');
    } catch (error) {
      await c.query('rollback to savepoint late_payment');
      if (!(error instanceof ApiError && error.code === 'out_of_stock')) throw error;
      await c.query("update orders set payment_status = 'paid', paid_at = $2 where id = $1", [orderId, now]);
      await orderEvent(c, orderId, 'paid_after_cancel', 'Payment arrived after the order was cancelled, and an item has sold out since. The payment is being refunded in full.', { visible: true });
      return { refundNeeded: true };
    }
    await orderEvent(c, orderId, 'reopened', 'Payment arrived after the checkout had expired. The items were still in stock, so the order goes ahead.');
  }
  await c.query("update orders set payment_status = 'paid', status = case when status in ('on_hold', 'cancelled') then 'to_fulfil' else status end, paid_at = $2, cancelled_at = null, stock_held_until = null where id = $1", [orderId, now]);
  // Each discount on the order has now been used once more.
  await c.query('update discounts d set times_used = times_used + 1 from order_discounts od where od.order_id = $1 and od.discount_id = d.id', [orderId]);
  await orderEvent(c, orderId, 'paid', 'Payment confirmed', { visible: true });
  return { refundNeeded: false };
}

/** After a refund succeeds: the order is partly or fully refunded. */
export async function updateRefundStatus(c: Q, orderId: number): Promise<void> {
  const totals = await c.query(
    `select coalesce((select sum(amount_minor) from payments where order_id = $1 and status = 'succeeded'), 0) + (select gift_card_minor from orders where id = $1) as paid,
            coalesce((select sum(amount_minor) from refunds where order_id = $1 and status = 'succeeded'), 0) as refunded`,
    [orderId],
  );
  const { paid, refunded } = totals.rows[0] as { paid: number; refunded: number };
  if (Number(refunded) <= 0) return;
  await c.query("update orders set payment_status = $2 where id = $1 and payment_status in ('paid', 'partly_refunded', 'refunded')", [orderId, Number(refunded) >= Number(paid) ? 'refunded' : 'partly_refunded']);
}

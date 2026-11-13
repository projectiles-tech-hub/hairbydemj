// Checkout: the bag becomes an order waiting for payment.
//
// In one database transaction: the bag is priced afresh, the delivery option
// is taken from a saved quote (never from what the browser says), the stock
// is held, gift cards are spent, and the order is written with its own copy
// of every name, price and the address. The customer then pays (module 7);
// stock stays held for 30 minutes, after which an unpaid order is cancelled
// and everything is let go.

import { hashToken, randomToken } from '../accounts/crypto.js';
import type { AccountDeps } from '../accounts/deps.js';
import { emailOf } from '../accounts/deps.js';
import { cartById, clearCart, priceCart, resolveCart, type CartOwner } from '../cart/cart.js';
import { redeemGiftCards, restoreGiftCards } from '../cart/gift-cards.js';
import { holdStock, releaseStock } from '../cart/stock.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { movePoints, pricePoints } from '../loyalty/loyalty.js';
import { ApiError } from '../http.js';
import type { Logger } from '../logger.js';
import { markOrderPaid, orderEvent, updateRefundStatus } from '../payments/order-paid.js';
import { chosenOption, parseAddress } from '../shipping/shipping.js';

type Q = { query: DbClient['query'] } | Db;

export const ORDERS = {
  /** How long an unpaid order keeps its stock. */
  holdMinutes: 30,
  maxNote: 500,
};

export interface OrderDeps {
  db: Db;
  now: () => Date;
  logger: Logger;
  mail: AccountDeps['mail'];
}

export interface Placed {
  orderId: number;
  number: string;
  /** For guests: the key to this order, shown once and sent in the confirmation email. */
  orderToken: string;
  /** What is left to pay through Paystack or Stripe; 0 when gift cards covered it all. */
  amountDueMinor: number;
  currency: string;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Turn the visitor's bag into an order. `input`: email, address (with name
 * and phone), quoteId and shippingOption from POST /shipping/quote, an
 * optional note, and saveAddress for signed-in customers.
 */
export async function placeOrder(deps: OrderDeps, owner: CartOwner, input: Record<string, unknown>, source: 'web' | 'app'): Promise<Placed> {
  const row = await resolveCart(deps, owner);
  if (!row) throw new ApiError(422, 'cart_not_ready', 'Your bag is empty.');
  let email: string;
  if (owner.customerId !== null) {
    const account = await deps.db.query('select email from customers where id = $1', [owner.customerId]);
    email = input.email === undefined || input.email === '' ? String(account.rows[0]?.email) : emailOf(input.email);
  } else {
    email = emailOf(input.email);
  }
  const address = parseAddress(input.address, { full: true });
  const note = text(input.note, ORDERS.maxNote) || null;
  const token = randomToken();
  const now = deps.now();

  const placed = await withTransaction(deps.db, async (c) => {
    // The cart row is locked so a double click cannot place two orders from one bag.
    await c.query('select id from carts where id = $1 for update', [row.id]);
    const fresh = await cartById(c, row.id);
    if (!fresh) throw new ApiError(422, 'cart_not_ready', 'Your bag is empty.');
    const cart = await priceCart({ db: deps.db, now: deps.now }, fresh, { customerId: owner.customerId, email });
    if (!cart.canCheckout || cart.id === null) throw new ApiError(422, 'cart_not_ready', 'Your bag needs attention before checkout. Check the items marked in your bag.');
    const chosen = await chosenOption(c, { quoteId: input.quoteId, optionId: input.shippingOption, cartId: cart.id, currency: cart.currency, address }, now);
    // Prices or discounts may have changed since the quote; the bag decides, the quote only gives delivery.
    if (chosen.freeShipping !== cart.freeShipping) throw new ApiError(409, 'quote_expired', 'Delivery prices have changed. Choose a delivery option again.');

    await holdStock(c, cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })));
    const shipping = chosen.option.priceMinor;
    // Loyalty points (module 17) pay for part of the items, for signed-in customers.
    const points = owner.customerId !== null && input.usePoints !== undefined && input.usePoints !== null && input.usePoints !== 0
      ? await pricePoints(c, owner.customerId, Number(input.usePoints), cart.currency, cart.subtotalMinor - cart.discountMinor)
      : { points: 0, minor: 0 };
    const total = cart.subtotalMinor - cart.discountMinor - points.minor + shipping;
    const weight = chosen.parcels.reduce((s, p) => s + p.weightGrams, 0);

    const made = await c.query(
      `insert into orders (customer_id, email, phone, source, currency, status, payment_status, subtotal_minor, discount_minor, points_redeemed, points_minor, shipping_minor, total_minor, gift_card_minor,
         ship_full_name, ship_phone, ship_line1, ship_line2, ship_city, ship_region, ship_postal_code, ship_country,
         shipping_carrier, shipping_service_code, shipping_service_name, delivery_estimate, total_weight_grams, package_size_id, duties_notice_shown,
         customer_note, stock_held_until, access_token_hash, placed_at)
       values ($1, $2, $3, $4, $5, 'on_hold', 'awaiting', $6, $7, $29, $30, $8, $9, 0, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
       returning id, number`,
      [
        owner.customerId, email, address.phone, source, cart.currency, cart.subtotalMinor, cart.discountMinor, shipping, total,
        address.name, address.phone, address.line1, address.line2, address.city, address.region, address.postalCode, address.country,
        chosen.option.carrier, chosen.option.serviceCode, `${chosen.option.carrierName}: ${chosen.option.serviceName}`, chosen.option.estimate, weight, chosen.parcels[0]?.packageSizeId ?? null, chosen.dutiesNotice,
        note, new Date(now.getTime() + ORDERS.holdMinutes * 60_000), hashToken(token), now,
        points.points, points.minor,
      ],
    );
    const orderId = Number(made.rows[0]?.id);
    const number = String(made.rows[0]?.number);
    if (points.points > 0 && owner.customerId !== null) await movePoints(c, owner.customerId, -points.points, 'redeem', now, { orderId, note: 'points spent' });

    for (const l of cart.lines) {
      const extra = await c.query('select p.is_final_sale from products p where p.id = $1', [l.productId]);
      await c.query(
        "insert into order_items (order_id, kind, variant_id, product_id, product_name, variant_description, sku, quantity, unit_price_minor, total_minor, weight_grams, is_final_sale) values ($1, 'variant', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [orderId, l.variantId, l.productId, l.name, l.description, l.sku, l.quantity, l.unitMinor, (l.unitMinor ?? 0) * l.quantity, l.weightGrams / l.quantity, extra.rows[0]?.is_final_sale === true],
      );
    }
    for (const d of cart.discounts) {
      await c.query('insert into order_discounts (order_id, discount_id, code, description, amount_minor) values ($1, $2, $3, $4, $5)', [orderId, d.id, d.code, d.name, d.amountMinor]);
    }

    // Gift cards can pay for delivery too, so they are spent against the full total here.
    const cards = cart.giftCards.filter((g) => g.problem === null).map((g) => g.id);
    const fromCards = cards.length ? await redeemGiftCards(c, orderId, cards, cart.currency, total, now) : 0;
    if (fromCards > 0) await c.query('update orders set gift_card_minor = $2 where id = $1', [orderId, fromCards]);

    if (owner.customerId !== null && input.saveAddress === true) {
      const has = await c.query('select 1 from addresses where customer_id = $1 and lower(line1) = lower($2) and lower(city) = lower($3) and country = $4 limit 1', [owner.customerId, address.line1, address.city, address.country]);
      if (!has.rowCount) {
        const first = await c.query('select count(*)::int as n from addresses where customer_id = $1', [owner.customerId]);
        await c.query('insert into addresses (customer_id, full_name, phone, line1, line2, city, region, postal_code, country, is_default) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [
          owner.customerId, address.name, address.phone, address.line1, address.line2, address.city, address.region, address.postalCode, address.country, Number(first.rows[0]?.n) === 0,
        ]);
      }
    }

    await orderEvent(c, orderId, 'placed', 'Order placed', { visible: true });
    if (total - fromCards === 0) await markOrderPaid(c, orderId, now);
    await clearCart(c, cart.id);
    return { orderId, number, due: total - fromCards, currency: cart.currency };
  });

  await deps.mail.send({ to: email, template: 'order_confirmation', data: { orderNumber: placed.number, orderToken: token } });
  return { orderId: placed.orderId, number: placed.number, orderToken: token, amountDueMinor: placed.due, currency: placed.currency };
}

/**
 * Cancel an order before anything has left: its held stock and gift card
 * money are let go. Used when an unpaid checkout runs out of time, when a
 * customer cancels an unpaid order, and by staff (who refund any payment
 * separately, see orders.ts).
 */
export async function cancelBeforeDispatch(c: Q, orderId: number, reason: string, options: { staffId: number | null; visible: boolean; now: Date }): Promise<void> {
  const found = await c.query('select status, stock_shipped_at from orders where id = $1 for update', [orderId]);
  const order = found.rows[0];
  if (!order) throw new ApiError(404, 'not_found', 'We could not find that order.');
  if (order.status === 'cancelled') return;
  if (order.stock_shipped_at || order.status === 'shipped' || order.status === 'delivered' || order.status === 'returned') throw new ApiError(409, 'already_sent', 'This order has already been sent. Use a return instead.');
  const items = await c.query("select variant_id, quantity from order_items where order_id = $1 and kind = 'variant' and variant_id is not null", [orderId]);
  await releaseStock(c, items.rows.map((r) => ({ variantId: Number(r.variant_id), quantity: Number(r.quantity) })));
  await restoreGiftCards(c, orderId, options.staffId);
  // Points spent on the order go back, and a gift card bought on it never starts (module 17).
  const spent = (await c.query('select customer_id, points_redeemed from orders where id = $1', [orderId])).rows[0];
  if (spent?.customer_id && Number(spent.points_redeemed) > 0) await movePoints(c, Number(spent.customer_id), Number(spent.points_redeemed), 'refund', options.now, { orderId, note: 'points given back' });
  await c.query("update gift_cards g set status = 'disabled' from order_items oi where oi.order_id = $1 and oi.gift_card_id = g.id and g.status = 'pending'", [orderId]);
  await c.query("update orders set status = 'cancelled', cancelled_at = $2, stock_held_until = null where id = $1", [orderId, options.now]);
  await orderEvent(c, orderId, 'cancelled', reason, { staffId: options.staffId, visible: options.visible });
  await updateRefundStatus(c, orderId);
}

/**
 * Unpaid orders whose time ran out are cancelled and their stock let go.
 * Run every few minutes by the worker (module 10). A payment that still
 * arrives later revives the order if it can (see markOrderPaid).
 */
export async function expireUnpaidOrders(deps: OrderDeps, limit = 100): Promise<number> {
  const due = await deps.db.query(
    "select id from orders where payment_status in ('awaiting', 'failed') and status = 'on_hold' and stock_held_until is not null and stock_held_until < $1 order by stock_held_until limit $2",
    [deps.now(), limit],
  );
  let cancelled = 0;
  for (const r of due.rows) {
    await withTransaction(deps.db, async (c) => {
      const still = await c.query("select 1 from orders where id = $1 and payment_status in ('awaiting', 'failed') and status = 'on_hold' for update", [r.id]);
      if (!still.rowCount) return;
      await cancelBeforeDispatch(c, Number(r.id), 'Not paid in time. The items were put back on sale.', { staffId: null, visible: true, now: deps.now() });
      cancelled += 1;
    });
  }
  return cancelled;
}

// Orders after checkout: what customers and staff see, cancelling, staff
// notes, changing the delivery address, guest look-up and invoices.

import { checkAttempts, recordAttempt } from '../accounts/guard.js';
import { formatMoney } from '../cart/money.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError, escapeHtml } from '../http.js';
import { orderEvent } from '../payments/order-paid.js';
import { refundPayment, type PaymentDeps } from '../payments/payments.js';
import { orderShipments, parseAddress, readShipFrom, type ShipmentView } from '../shipping/shipping.js';
import { cancelBeforeDispatch, type OrderDeps } from './checkout.js';

type Q = { query: DbClient['query'] } | Db;

export interface OrderItemView {
  id: number;
  productId: number | null;
  name: string;
  description: string;
  sku: string | null;
  quantity: number;
  unitMinor: number;
  totalMinor: number;
  isFinalSale: boolean;
  /** How many can still be asked back (not already in a return). */
  returnableQuantity: number;
}

export interface OrderView {
  id: number;
  number: string;
  placedAt: string;
  status: string;
  paymentStatus: string;
  currency: string;
  email: string;
  items: OrderItemView[];
  discounts: Array<{ code: string | null; description: string; amountMinor: number }>;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  giftCardMinor: number;
  refundedMinor: number;
  amountDueMinor: number;
  address: { name: string; phone: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string | null; country: string };
  delivery: { carrier: string | null; service: string | null; estimate: string | null };
  dutiesNotice: boolean;
  note: string | null;
  holdUntil: string | null;
  timeline: Array<{ kind: string; summary: string; at: string; staff?: string | null; visibleToCustomer?: boolean }>;
  shipments: ShipmentView[];
  returns: Array<{ id: number; number: string; status: string; resolution: string; requestedAt: string; refundMinor: number }>;
  /** What the customer may do now. */
  canPay: boolean;
  canCancel: boolean;
  canReturn: boolean;
}

/** One order, as its customer sees it (`staff` adds notes and who did what). */
export async function orderView(db: Q, orderId: number, now: Date, audience: 'customer' | 'staff'): Promise<OrderView> {
  const found = await db.query('select * from orders where id = $1', [orderId]);
  const o = found.rows[0];
  if (!o) throw new ApiError(404, 'not_found', 'We could not find that order.');
  const items = await db.query(
    `select oi.*, coalesce((select sum(ri.quantity) from return_items ri join returns r on r.id = ri.return_id where ri.order_item_id = oi.id and r.status not in ('rejected', 'cancelled')), 0)::int as in_returns
     from order_items oi where oi.order_id = $1 order by oi.id`,
    [orderId],
  );
  const discounts = await db.query('select code, description, amount_minor from order_discounts where order_id = $1 order by id', [orderId]);
  const events = await db.query(
    `select e.kind, e.summary, e.created_at, e.visible_to_customer, s.name as staff_name from order_events e left join staff s on s.id = e.staff_id
     where e.order_id = $1 ${audience === 'customer' ? 'and e.visible_to_customer' : ''} order by e.created_at, e.id`,
    [orderId],
  );
  const refunded = await db.query("select coalesce(sum(amount_minor), 0)::bigint as total from refunds where order_id = $1 and status = 'succeeded'", [orderId]);
  const returns = await db.query(
    'select r.id, r.number, r.status, r.resolution, r.requested_at, coalesce((select sum(refund_minor) from return_items where return_id = r.id), 0)::bigint as refund from returns r where r.order_id = $1 order by r.id',
    [orderId],
  );
  const paid = o.payment_status === 'paid' || o.payment_status === 'partly_refunded' || o.payment_status === 'refunded';
  const holdUntil = (o.stock_held_until as Date | null) ?? null;
  const window = await returnWindowOpen(db, orderId, now);
  const itemViews: OrderItemView[] = items.rows.map((r) => ({
    id: Number(r.id),
    productId: r.product_id === null ? null : Number(r.product_id),
    name: String(r.product_name),
    description: String(r.variant_description),
    sku: (r.sku as string | null) ?? null,
    quantity: Number(r.quantity),
    unitMinor: Number(r.unit_price_minor),
    totalMinor: Number(r.total_minor),
    isFinalSale: r.is_final_sale === true,
    returnableQuantity: r.kind === 'variant' ? Math.max(0, Number(r.quantity) - Number(r.in_returns)) : 0,
  }));
  return {
    id: Number(o.id),
    number: String(o.number),
    placedAt: (o.placed_at as Date).toISOString(),
    status: String(o.status),
    paymentStatus: String(o.payment_status),
    currency: String(o.currency),
    email: String(o.email),
    items: itemViews,
    discounts: discounts.rows.map((d) => ({ code: (d.code as string | null) ?? null, description: String(d.description), amountMinor: Number(d.amount_minor) })),
    subtotalMinor: Number(o.subtotal_minor),
    discountMinor: Number(o.discount_minor) + Number(o.points_minor),
    shippingMinor: Number(o.shipping_minor),
    totalMinor: Number(o.total_minor),
    giftCardMinor: Number(o.gift_card_minor),
    refundedMinor: Number(refunded.rows[0]?.total ?? 0),
    amountDueMinor: paid || o.status === 'cancelled' ? 0 : Number(o.total_minor) - Number(o.gift_card_minor),
    address: { name: String(o.ship_full_name ?? ''), phone: String(o.ship_phone ?? ''), line1: String(o.ship_line1 ?? ''), line2: (o.ship_line2 as string | null) ?? null, city: String(o.ship_city ?? ''), region: (o.ship_region as string | null) ?? null, postalCode: (o.ship_postal_code as string | null) ?? null, country: String(o.ship_country ?? '') },
    delivery: { carrier: (o.shipping_carrier as string | null) ?? null, service: (o.shipping_service_name as string | null) ?? null, estimate: (o.delivery_estimate as string | null) ?? null },
    dutiesNotice: o.duties_notice_shown === true,
    note: (o.customer_note as string | null) ?? null,
    holdUntil: holdUntil && !paid && o.status === 'on_hold' ? holdUntil.toISOString() : null,
    timeline: events.rows.map((e) => ({
      kind: String(e.kind),
      summary: String(e.summary),
      at: (e.created_at as Date).toISOString(),
      ...(audience === 'staff' ? { staff: (e.staff_name as string | null) ?? null, visibleToCustomer: e.visible_to_customer === true } : {}),
    })),
    shipments: await orderShipments(db, orderId),
    returns: returns.rows.map((r) => ({ id: Number(r.id), number: String(r.number), status: String(r.status), resolution: String(r.resolution), requestedAt: (r.requested_at as Date).toISOString(), refundMinor: Number(r.refund) })),
    canPay: !paid && o.status === 'on_hold' && holdUntil !== null && holdUntil > now && Number(o.total_minor) - Number(o.gift_card_minor) > 0,
    canCancel: !paid && o.status === 'on_hold',
    canReturn: o.status === 'delivered' && window.open && itemViews.some((i) => i.returnableQuantity > 0),
  };
}

// ----- returns policy (read here because the order view needs it) -----

export interface ReturnSettings {
  windowDays: number;
  /** Extra given when a customer takes store credit instead of money back, in hundredths of a percent. */
  storeCreditBonusBps: number;
}

export async function returnSettings(db: Q): Promise<ReturnSettings> {
  const found = await db.query("select value from store_settings where key = 'returns'");
  const v = (found.rows[0]?.value ?? {}) as Record<string, unknown>;
  // The sample data writes window_days and store_credit_bonus_percent; the admin saves windowDays and storeCreditBonusBps.
  const days = Number(v.windowDays ?? v.window_days);
  const bonus = v.storeCreditBonusBps !== undefined ? Number(v.storeCreditBonusBps) : Number(v.store_credit_bonus_percent) * 100;
  // Until staff set them, the sample figures from the designs apply: 14 days and a 10% bonus.
  return { windowDays: Number.isInteger(days) && days >= 0 ? days : 14, storeCreditBonusBps: Number.isInteger(bonus) && bonus >= 0 ? bonus : 1000 };
}

/** Returns are open for `windowDays` after delivery. */
export async function returnWindowOpen(db: Q, orderId: number, now: Date): Promise<{ open: boolean; closesAt: Date | null }> {
  const settings = await returnSettings(db);
  const found = await db.query("select coalesce((select max(delivered_at) from shipments where order_id = o.id and status = 'delivered'), case when o.status = 'delivered' then o.updated_at end) as delivered from orders o where o.id = $1", [orderId]);
  const delivered = (found.rows[0]?.delivered as Date | null) ?? null;
  if (!delivered) return { open: false, closesAt: null };
  const closesAt = new Date(delivered.getTime() + settings.windowDays * 86_400_000);
  return { open: closesAt > now, closesAt };
}

// ----- lists -----

/** A signed-in customer's orders, newest first. */
export async function customerOrders(db: Q, customerId: number, page: number): Promise<{ orders: Array<Record<string, unknown>>; page: number; more: boolean }> {
  const size = 20;
  const found = await db.query(
    `select o.id, o.number, o.placed_at, o.status, o.payment_status, o.currency, o.total_minor,
            (select count(*)::int from order_items where order_id = o.id) as item_count,
            (select product_name from order_items where order_id = o.id order by id limit 1) as first_item
     from orders o where o.customer_id = $1 order by o.placed_at desc, o.id desc limit $2 offset $3`,
    [customerId, size + 1, (page - 1) * size],
  );
  return {
    orders: found.rows.slice(0, size).map((r) => ({ number: r.number, placedAt: (r.placed_at as Date).toISOString(), status: r.status, paymentStatus: r.payment_status, currency: r.currency, totalMinor: Number(r.total_minor), itemCount: r.item_count, firstItem: r.first_item })),
    page,
    more: found.rows.length > size,
  };
}

const STATUSES = ['on_hold', 'to_fulfil', 'shipped', 'delivered', 'returned', 'cancelled'];
const PAYMENT_STATUSES = ['awaiting', 'paid', 'failed', 'partly_refunded', 'refunded'];

/** The admin's order list, with filters. */
export async function staffOrderList(db: Q, query: URLSearchParams): Promise<{ orders: Array<Record<string, unknown>>; total: number; page: number; counts: Record<string, number> }> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };
  const status = query.get('status');
  if (status && STATUSES.includes(status)) where.push(`o.status = ${add(status)}`);
  const payment = query.get('payment');
  if (payment && PAYMENT_STATUSES.includes(payment)) where.push(`o.payment_status = ${add(payment)}`);
  const q = (query.get('q') ?? '').trim().slice(0, 100);
  if (q) {
    const like = add(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(o.number ilike ${like} or o.email ilike ${like} or o.ship_full_name ilike ${like} or o.ship_phone ilike ${like})`);
  }
  const from = query.get('from');
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) where.push(`o.placed_at >= ${add(from)}::date`);
  const to = query.get('to');
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) where.push(`o.placed_at < ${add(to)}::date + 1`);
  const page = Math.max(1, Math.min(10_000, Number(query.get('page')) || 1));
  const size = 50;
  const filter = where.length ? `where ${where.join(' and ')}` : '';
  const total = await db.query(`select count(*)::int as n from orders o ${filter}`, values);
  const rows = await db.query(
    `select o.id, o.number, o.placed_at, o.email, o.ship_full_name, o.ship_country, o.status, o.payment_status, o.currency, o.total_minor, o.shipping_carrier,
            (select count(*)::int from order_items where order_id = o.id) as item_count
     from orders o ${filter} order by o.placed_at desc, o.id desc limit ${size} offset ${(page - 1) * size}`,
    values,
  );
  const counts = await db.query('select status, count(*)::int as n from orders group by status');
  return {
    orders: rows.rows.map((r) => ({ id: Number(r.id), number: r.number, placedAt: (r.placed_at as Date).toISOString(), customer: r.ship_full_name || r.email, email: r.email, country: r.ship_country, status: r.status, paymentStatus: r.payment_status, currency: r.currency, totalMinor: Number(r.total_minor), carrier: r.shipping_carrier, itemCount: r.item_count })),
    total: Number(total.rows[0]?.n ?? 0),
    page,
    counts: Object.fromEntries(counts.rows.map((r) => [String(r.status), Number(r.n)])),
  };
}

// ----- guest look-up -----

/**
 * A guest finds their order with its number and the email used at checkout.
 * Wrong guesses are limited like passwords; a wrong email looks exactly like
 * a wrong number.
 */
export async function lookUpOrder(db: Db, input: Record<string, unknown>, ip: string | null, now: Date): Promise<OrderView> {
  const number = (typeof input.number === 'string' ? input.number : '').trim().toUpperCase().replace(/^#/, '');
  const email = (typeof input.email === 'string' ? input.email : '').trim().toLowerCase();
  if (!number || !email) throw new ApiError(422, 'invalid', 'Enter your order number and email.', { ...(number ? {} : { number: 'Enter your order number.' }), ...(email ? {} : { email: 'Enter the email you used.' }) });
  await checkAttempts(db, 'order_lookup', number, ip);
  const found = await db.query('select id from orders where number = $1 and lower(email) = $2', [number.startsWith('HBD-') ? number : `HBD-${number}`, email]);
  const id = found.rows[0]?.id;
  await recordAttempt(db, 'order_lookup', number, ip, Boolean(id));
  if (!id) throw new ApiError(404, 'not_found', 'We could not find an order with that number and email.');
  return orderView(db, Number(id), now, 'customer');
}

// ----- changes -----

/** The customer gives up on an order they have not paid for. */
export async function customerCancel(deps: OrderDeps, orderId: number): Promise<void> {
  await withTransaction(deps.db, async (c) => {
    const found = await c.query('select payment_status, status from orders where id = $1 for update', [orderId]);
    const o = found.rows[0];
    if (!o) throw new ApiError(404, 'not_found', 'We could not find that order.');
    if (o.status === 'cancelled') return;
    if (o.payment_status !== 'awaiting' && o.payment_status !== 'failed') throw new ApiError(409, 'already_paid', 'This order has been paid. Contact us to cancel it.');
    await cancelBeforeDispatch(c, orderId, 'Cancelled by the customer before paying.', { staffId: null, visible: true, now: deps.now() });
  });
}

/**
 * Staff cancel an order that has not been sent. Stock and gift card money go
 * back at once; every payment is refunded in full through its provider.
 */
export async function staffCancel(deps: OrderDeps, payments: PaymentDeps, orderId: number, input: Record<string, unknown>, staffId: number): Promise<{ refunds: Array<{ refundId: number; status: string }> }> {
  const reason = (typeof input.reason === 'string' ? input.reason.trim() : '').slice(0, 300);
  if (!reason) throw new ApiError(422, 'invalid', 'Give a reason for cancelling.', { reason: 'Give a reason for cancelling.' });
  await withTransaction(deps.db, (c) => cancelBeforeDispatch(c, orderId, `Cancelled: ${reason}`, { staffId, visible: true, now: deps.now() }));
  const paid = await deps.db.query(
    "select p.id, p.amount_minor - coalesce((select sum(amount_minor) from refunds where payment_id = p.id and status in ('pending', 'succeeded')), 0) as left from payments p where p.order_id = $1 and p.status = 'succeeded'",
    [orderId],
  );
  const refunds: Array<{ refundId: number; status: string }> = [];
  for (const p of paid.rows) {
    if (Number(p.left) <= 0) continue;
    refunds.push(await refundPayment(payments, Number(p.id), { amountMinor: Number(p.left), reason: `Order cancelled: ${reason}`, includesShipping: true }, staffId));
  }
  const order = await deps.db.query('select email, number from orders where id = $1', [orderId]);
  await deps.mail.send({ to: String(order.rows[0]?.email), template: 'order_cancelled', data: { orderNumber: String(order.rows[0]?.number), reason } });
  return { refunds };
}

/** A note on the order's timeline, for staff only. */
export async function addNote(db: Q, orderId: number, input: Record<string, unknown>, staffId: number): Promise<void> {
  const note = (typeof input.note === 'string' ? input.note.trim() : '').slice(0, 2000);
  if (!note) throw new ApiError(422, 'invalid', 'Write the note.', { note: 'Write the note.' });
  const exists = await db.query('select 1 from orders where id = $1', [orderId]);
  if (!exists.rowCount) throw new ApiError(404, 'not_found', 'We could not find that order.');
  await orderEvent(db, orderId, 'note', note, { staffId });
}

/** Correct the delivery address before a label is bought or the parcel sent. Same country only: the delivery price depends on it. */
export async function changeAddress(db: Db, orderId: number, input: Record<string, unknown>, staffId: number): Promise<void> {
  const address = parseAddress(input, { full: true });
  await withTransaction(db, async (c) => {
    const found = await c.query('select status, ship_country from orders where id = $1 for update', [orderId]);
    const o = found.rows[0];
    if (!o) throw new ApiError(404, 'not_found', 'We could not find that order.');
    if (!['on_hold', 'to_fulfil'].includes(String(o.status))) throw new ApiError(409, 'already_sent', 'The parcel has been sent; the address can no longer be changed here.');
    const labelled = await c.query("select 1 from shipments where order_id = $1 and status <> 'pending' limit 1", [orderId]);
    if (labelled.rowCount) throw new ApiError(409, 'label_bought', 'A label has been bought for the old address. Cancel it with the carrier first.');
    if (address.country !== o.ship_country) throw new ApiError(422, 'invalid', 'The country cannot change: the delivery price depends on it.', { country: 'The country cannot change.' });
    await c.query('update orders set ship_full_name = $2, ship_phone = $3, ship_line1 = $4, ship_line2 = $5, ship_city = $6, ship_region = $7, ship_postal_code = $8 where id = $1', [
      orderId, address.name, address.phone, address.line1, address.line2, address.city, address.region, address.postalCode,
    ]);
    await orderEvent(c, orderId, 'address_changed', `Delivery address changed to ${address.line1}, ${address.city}.`, { staffId, visible: true });
  });
}

// ----- invoice -----

/** A plain printable invoice page for an order. */
export async function invoiceHtml(db: Q, orderId: number, now: Date): Promise<string> {
  const view = await orderView(db, orderId, now, 'customer');
  if (view.paymentStatus === 'awaiting' || view.paymentStatus === 'failed') throw new ApiError(409, 'not_paid', 'An invoice is ready once the order is paid.');
  const currency = await db.query('select code, symbol, minor_units from currencies where code = $1', [view.currency]);
  const cur = { code: view.currency, symbol: String(currency.rows[0]?.symbol ?? ''), minorUnits: Number(currency.rows[0]?.minor_units ?? 2) };
  const money = (minor: number): string => escapeHtml(formatMoney(minor, cur));
  const store = await readShipFrom(db);
  const e = escapeHtml;
  const addressLines = (a: { name: string; line1: string; line2?: string | null; city: string; region?: string | null; postalCode?: string | null; country: string }): string =>
    [a.name, a.line1, a.line2, [a.city, a.region, a.postalCode].filter(Boolean).join(', '), a.country].filter(Boolean).map((x) => e(String(x))).join('<br>');
  const rows = view.items.map((i) => `<tr><td>${e(i.name)}${i.description ? `<br><small>${e(i.description)}</small>` : ''}</td><td>${e(i.sku ?? '')}</td><td class="n">${i.quantity}</td><td class="n">${money(i.unitMinor)}</td><td class="n">${money(i.totalMinor)}</td></tr>`).join('');
  const line = (label: string, minor: number, strong = false): string => `<tr${strong ? ' class="total"' : ''}><td colspan="4">${e(label)}</td><td class="n">${money(minor)}</td></tr>`;
  const paidAt = (await db.query('select paid_at from orders where id = $1', [orderId])).rows[0]?.paid_at as Date | null;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Invoice ${e(view.number)}</title>
<style>
body{font-family:"Source Sans 3",system-ui,sans-serif;color:#1f1a17;background:#fff;margin:0;padding:32px 16px}
main{max-width:760px;margin:0 auto}
h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:32px;margin:0 0 4px}
.top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:32px}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #e6dfd8;vertical-align:top}
th{font-weight:600}.n{text-align:right;white-space:nowrap}
tr.total td{font-weight:700;border-bottom:2px solid #1f1a17}
small{color:#6b625b}
p.note{color:#6b625b;font-size:14px;margin-top:24px}
@media print{body{padding:0}}
</style></head><body><main>
<div class="top"><div><h1>Invoice</h1><div>${e(view.number)}</div><div>Date: ${e((paidAt ?? new Date(view.placedAt)).toISOString().slice(0, 10))}</div></div>
<div><strong>hairbydemj</strong><br>${store ? addressLines(store) : ''}${store?.email ? `<br>${e(store.email)}` : ''}</div></div>
<div class="top"><div><strong>Billed and delivered to</strong><br>${addressLines(view.address)}<br>${e(view.email)}</div><div><strong>Delivery</strong><br>${e(view.delivery.service ?? '')}</div></div>
<table><thead><tr><th>Item</th><th>SKU</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Total</th></tr></thead><tbody>
${rows}
${line('Subtotal', view.subtotalMinor)}
${view.discounts.map((d) => line(`Discount${d.code ? ` (${d.code})` : ''}: ${d.description}`, -d.amountMinor)).join('')}
${line('Delivery', view.shippingMinor)}
${line('Total', view.totalMinor, true)}
${view.giftCardMinor ? line('Paid with gift card', view.giftCardMinor) : ''}
${view.refundedMinor ? line('Refunded', -view.refundedMinor) : ''}
</tbody></table>
${view.dutiesNotice ? '<p class="note">Import duties and taxes, if any, are not included and are paid by the receiver to the carrier on delivery.</p>' : ''}
</main></body></html>`;
}

// Admin pages for selling: the dashboard, orders, returns, customers, reports.

import { can } from '../../accounts/staff.js';
import { orderView, staffOrderList } from '../../orders/orders.js';
import { listReturns, returnView } from '../../orders/returns.js';
import { customerDetail, listCustomers, salesReport } from '../api.js';
import { lineChart, num, panel, pageHead, raw, stat, table, tabs } from '../components.js';
import { each, esc } from '../../site/html.js';
import { checkbox, date, form, input, money, ORDER_STATUS, PAYMENT_STATUS, badge, pager, postButton, select, textarea, type AdminContext } from './view.js';
import { customerPointsPanel } from './loyalty.js';

export async function dashboard(ac: AdminContext): Promise<string> {
  const db = ac.deps.db;
  const today = await db.query(
    "select currency, count(*)::int as orders, sum(total_minor)::bigint as sales from orders where paid_at >= date_trunc('day', $1::timestamptz at time zone 'Africa/Lagos') at time zone 'Africa/Lagos' group by currency order by currency",
    [ac.now],
  );
  const counts = await db.query("select (select count(*)::int from orders where status = 'to_fulfil') as to_fulfil, (select count(*)::int from returns where status in ('requested', 'received')) as returns, (select count(*)::int from inventory where on_hand - reserved <= low_stock_threshold) as low, (select count(*)::int from jobs where status = 'failed') as failed");
  const c = counts.rows[0] ?? {};
  const report = can(ac.staff, 'reports', 'view') ? await salesReport(db, null, null, ac.now) : null;
  const naira = report ? report.byDay.filter((d) => d.currency === 'NGN') : [];
  const days: Array<[string, number]> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(ac.now.getTime() - i * 86_400_000 + 3600_000).toISOString().slice(0, 10);
    days.push([d.slice(5), Math.round((naira.find((x) => x.day === d)?.salesMinor ?? 0) / 100)]);
  }
  const max = Math.max(1, ...days.map(([, v]) => v));
  const recent = can(ac.staff, 'orders', 'view') ? await staffOrderList(db, new URLSearchParams()) : null;
  return `${pageHead('Dashboard')}
<div class="grid" style="--cols:4;--cols-tablet:2;--cols-phone:1">
${stat('Sales today', today.rows.length ? today.rows.map((r) => money(ac, Number(r.sales), String(r.currency))).join(' + ') : '₦0', `${today.rows.reduce((s, r) => s + Number(r.orders), 0)} paid orders`, true)}
${stat('Orders to fulfil', String(c.to_fulfil ?? 0))}
${stat('Returns waiting', String(c.returns ?? 0))}
${stat('Items running low', String(c.low ?? 0), Number(c.failed) ? `${c.failed} background jobs failed: see System` : '')}
</div>
${report ? panel('Naira sales, last 14 days', days.every(([, v]) => v === 0) ? '<p class="muted small">No paid naira orders in the last 14 days.</p>' : lineChart('Naira sales, last 14 days', days, [`₦${max.toLocaleString('en-NG')}`, `₦${Math.round(max / 2).toLocaleString('en-NG')}`, '₦0'], max, 2)) : ''}
${recent ? panel('Latest orders', (recent.orders.length ? orderTable(ac, recent.orders.slice(0, 8)) : '<p class="muted small">No orders yet.</p>') + '<a class="link small" href="/orders/">All orders</a>') : ''}`;
}

function orderTable(ac: AdminContext, orders: Array<Record<string, unknown>>): string {
  return table(
    ['Order', 'Date', 'Customer', 'Items', 'Total', 'Payment', 'Status'],
    orders.map((o) => [
      raw(`<a class="link" href="/orders/${Number(o.id)}/">${esc(String(o.number))}</a>`),
      date(String(o.placedAt), true),
      String(o.customer ?? ''),
      num(Number(o.itemCount)),
      num(money(ac, Number(o.totalMinor), String(o.currency))),
      raw(badge(PAYMENT_STATUS, String(o.paymentStatus))),
      raw(badge(ORDER_STATUS, String(o.status))),
    ]),
    { caption: 'Orders', minWidth: 760 },
  );
}

export async function orders(ac: AdminContext): Promise<string> {
  const list = await staffOrderList(ac.deps.db, ac.ctx.query);
  const q = ac.ctx.query;
  const status = q.get('status') ?? '';
  const tab = (label: string, value: string): [string, string, boolean] => {
    const p = new URLSearchParams(q);
    if (value) p.set('status', value);
    else p.delete('status');
    p.delete('page');
    const n = value ? (list.counts[value] ?? 0) : Object.values(list.counts).reduce((s, x) => s + x, 0);
    return [`${label} (${n})`, `/orders/?${p.toString()}`, status === value];
  };
  return `${pageHead('Orders')}
${tabs('Order status', [tab('All', ''), tab('Waiting for payment', 'on_hold'), tab('To fulfil', 'to_fulfil'), tab('Shipped', 'shipped'), tab('Delivered', 'delivered'), tab('Returned', 'returned'), tab('Cancelled', 'cancelled')])}
<form class="afilters" method="get" action="/orders/" role="search" aria-label="Filters">${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ''}
<label class="afilter" for="flt-q"><span class="visually-hidden">Search</span><input class="field__input" id="flt-q" name="q" type="search" placeholder="Number, email, name or phone" value="${esc(q.get('q') ?? '')}"></label>
<label class="afilter" for="flt-pay"><span class="visually-hidden">Payment</span><select id="flt-pay" name="payment" data-autosubmit>${each([['', 'Payment: any'], ...Object.entries(PAYMENT_STATUS).map(([k, [l]]) => [k, l])] as Array<[string, string]>, ([v, l]) => `<option value="${v}"${(q.get('payment') ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`)}</select></label>
<label class="afilter" for="flt-from"><span class="visually-hidden">From</span><input class="field__input" id="flt-from" name="from" type="date" value="${esc(q.get('from') ?? '')}"></label>
<label class="afilter" for="flt-to"><span class="visually-hidden">To</span><input class="field__input" id="flt-to" name="to" type="date" value="${esc(q.get('to') ?? '')}"></label>
<button class="btn btn--secondary" type="submit">Apply</button></form>
${list.orders.length ? orderTable(ac, list.orders) : '<div class="aempty"><h2 class="h3">No orders here</h2><p class="muted">Try another filter.</p></div>'}
${pager(ac, list.page, list.page * 50 < list.total, list.total)}`;
}

export async function orderDetail(ac: AdminContext, id: number): Promise<{ title: string; body: string } | null> {
  const exists = await ac.deps.db.query('select 1 from orders where id = $1', [id]);
  if (!exists.rowCount) return null;
  const o = await orderView(ac.deps.db, id, ac.now, 'staff');
  const payments = await ac.deps.db.query('select id, provider, reference, amount_minor, status, method, card_brand, card_last4, failure_reason, created_at, amount_minor - coalesce((select sum(amount_minor) from refunds r where r.payment_id = p.id and r.status in (\'pending\', \'succeeded\')), 0) as refundable from payments p where order_id = $1 order by id', [id]);
  const refunds = await ac.deps.db.query('select amount_minor, reason, status, created_at from refunds where order_id = $1 order by id', [id]);
  const m = (minor: number): string => money(ac, minor, o.currency);
  const change = can(ac.staff, 'orders', 'change');
  const carrierOrder = o.delivery.carrier && o.delivery.carrier !== 'local';
  const paid = o.paymentStatus === 'paid' || o.paymentStatus === 'partly_refunded';
  const actions = change
    ? [
        paid && o.status === 'to_fulfil' && carrierOrder && !o.shipments.length ? postButton('Buy label', `/api/orders/${id}/label`, { kind: 'primary' }) : '',
        paid && o.status === 'to_fulfil' && !carrierOrder ? `<button class="btn btn--primary" type="button" data-dialog-open="dispatch">Record dispatch</button>` : '',
        (o.status === 'on_hold' || o.status === 'to_fulfil') && !o.shipments.length ? `<button class="btn btn--secondary" type="button" data-dialog-open="cancel">Cancel order</button>` : '',
        payments.rows.some((p) => p.status === 'succeeded' && Number(p.refundable) > 0) ? `<button class="btn btn--secondary" type="button" data-dialog-open="refund">Refund</button>` : '',
      ].join('')
    : '';
  const shipments = o.shipments.length
    ? each(o.shipments, (s) => `<div class="stack stack--sm"><p class="strong">${esc(s.carrierName)}${s.serviceName ? `: ${esc(s.serviceName)}` : ''} ${badge({ [s.status]: [s.status.replace(/_/g, ' '), s.status === 'delivered' ? 'good' : s.status === 'exception' ? 'bad' : 'wait'] }, s.status)}</p>
${s.trackingNumber ? `<p class="small">Tracking ${esc(s.trackingNumber)}${s.trackingUrl ? ` · <a class="link" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">carrier's page</a>` : ''}</p>` : ''}
<div class="row">${s.carrier !== 'local' ? `<a class="btn btn--secondary" href="/api/shipments/${s.id}/label" target="_blank" rel="noopener">Print label</a>${postButton('Check tracking now', `/api/shipments/${s.id}/track`)}` : s.status !== 'delivered' && change ? postButton('Mark delivered', `/api/shipments/${s.id}/delivered`, { confirm: 'The courier has delivered this parcel?' }) : ''}</div>
<ol class="stack stack--xs small">${each(s.events.slice(0, 8), (e) => `<li><span class="muted">${esc(date(e.occurredAt, true))}</span> ${esc(e.description)}${e.location ? `, ${esc(e.location)}` : ''}</li>`)}</ol></div>`)
    : '<p class="muted small">Not sent yet.</p>';
  const body = `${pageHead(`Order ${o.number}`, actions, `<a class="link" href="/orders/">Orders</a> › ${esc(o.number)} · placed ${esc(date(o.placedAt, true))}`)}
<div class="row">${badge(ORDER_STATUS, o.status)} ${badge(PAYMENT_STATUS, o.paymentStatus)}</div>
<div class="split"><div class="stack stack--lg">
${panel('Items', table(['Item', 'SKU', 'Qty', 'Price', 'Total'], o.items.map((i) => [raw(`<span class="strong">${esc(i.name)}</span><br><span class="small muted">${esc(i.description)}</span>`), i.sku ?? '', num(i.quantity), num(m(i.unitMinor)), num(m(i.totalMinor))]), { caption: 'Items' }) + `<div class="stack stack--xs" style="max-width:360px;margin-left:auto">${totalsRows(o, m)}</div>`)}
${panel('Delivery', `<p class="small">${esc(o.delivery.service ?? '')}${o.delivery.estimate ? `, ${esc(o.delivery.estimate)}` : ''}${o.dutiesNotice ? ' · duties paid by the customer on delivery' : ''}</p>${shipments}`)}
${panel('Payments', payments.rows.length ? table(['When', 'Provider', 'Amount', 'Method', 'Status'], payments.rows.map((p) => [date(p.created_at as Date, true), String(p.provider), num(m(Number(p.amount_minor))), [p.method, p.card_brand, p.card_last4 ? `•••• ${String(p.card_last4)}` : ''].filter(Boolean).join(' '), String(p.status) + (p.failure_reason ? `: ${String(p.failure_reason)}` : '')]), { caption: 'Payments' }) + (refunds.rows.length ? `<h3 class="h3">Refunds</h3>${table(['When', 'Amount', 'Reason', 'Status'], refunds.rows.map((r) => [date(r.created_at as Date, true), num(m(Number(r.amount_minor))), String(r.reason), String(r.status)]), { caption: 'Refunds' })}` : '') : '<p class="muted small">No payment yet.</p>')}
${panel('Timeline', `<ol class="stack stack--sm">${each([...o.timeline].reverse(), (e) => `<li class="small"><span class="muted">${esc(date(e.at, true))}</span> ${esc(e.summary)}${e.staff ? ` <span class="muted">· ${esc(e.staff)}</span>` : ''}${e.visibleToCustomer ? '' : ' <span class="muted">(staff only)</span>'}</li>`)}</ol>${change ? form(`/api/orders/${id}/notes`, textarea('note', 'Add a note (staff only)', '', { rows: 2 }), { submit: 'Add note', secondary: true }) : ''}`)}
</div><div class="stack">
${panel('Customer', `<p>${esc(o.address.name)}<br><a class="link" href="mailto:${esc(o.email)}">${esc(o.email)}</a><br>${esc(o.address.phone)}</p>${o.note ? `<p class="small"><span class="strong">Note:</span> ${esc(o.note)}</p>` : ''}`)}
${panel('Delivery address', `<p class="small">${esc(o.address.line1)}${o.address.line2 ? `<br>${esc(o.address.line2)}` : ''}<br>${esc([o.address.city, o.address.region, o.address.postalCode].filter(Boolean).join(', '))}<br>${esc(o.address.country)}</p>${change && (o.status === 'on_hold' || o.status === 'to_fulfil') && !o.shipments.length ? `<details><summary class="link small">Correct the address</summary>${form(`/api/orders/${id}/address`, input('name', 'Name', { value: o.address.name }) + input('phone', 'Phone', { value: o.address.phone }) + input('line1', 'Street', { value: o.address.line1 }) + input('line2', 'More', { value: o.address.line2 }) + input('city', 'City', { value: o.address.city }) + input('region', 'State or region', { value: o.address.region }) + input('postalCode', 'Postcode', { value: o.address.postalCode }) + `<input type="hidden" data-key="country" value="${esc(o.address.country)}">`, { submit: 'Save address' })}</details>` : ''}`)}
${o.returns.length ? panel('Returns', each(o.returns, (r) => `<p class="small"><a class="link" href="/returns/${r.id}/">${esc(r.number)}</a> · ${esc(r.status)}</p>`)) : ''}
${paid || o.paymentStatus === 'refunded' ? `<a class="btn btn--secondary" href="/api/orders/${id}/invoice" target="_blank" rel="noopener">Invoice</a>` : ''}
</div></div>`;
  const refundable = payments.rows.filter((p) => p.status === 'succeeded' && Number(p.refundable) > 0);
  const after = change
    ? `${dialog('refund', 'Refund', refundable.length ? form(`/api/payments/${Number(refundable[0]?.id)}/refund`, `<p class="small muted">Up to ${esc(m(Number(refundable[0]?.refundable)))} can go back to the ${esc(String(refundable[0]?.provider))} payment.</p>${input('amountMinor', `Amount (${o.currency})`, { data: 'minor', attrs: 'inputmode="decimal"' })}${select('reason', 'Reason', [['Customer asked', 'Customer asked'], ['Item out of stock', 'Item out of stock'], ['Damaged in delivery', 'Damaged in delivery'], ['Price adjustment', 'Price adjustment'], ['Other', 'Other']], 'Customer asked')}${checkbox('includesShipping', 'Includes the delivery charge', false)}`, { submit: 'Refund', confirm: 'Send this refund now?' }) : '')}
${dialog('cancel', 'Cancel order', form(`/api/orders/${id}/cancel`, `<p class="small muted">Stock and gift card money go back at once. Every payment is refunded in full. The customer is emailed.</p>${input('reason', 'Reason')}`, { submit: 'Cancel the order', confirm: 'Cancel this order and refund it?' }))}
${dialog('dispatch', 'Record dispatch', form(`/api/orders/${id}/dispatch`, `${input('courier', 'Courier', { value: o.delivery.service?.split(':')[0] ?? '' })}${input('trackingNumber', 'Tracking number (optional)')}${input('trackingUrl', 'Tracking link (optional)', { type: 'url' })}`, { submit: 'Mark as sent' }))}`
    : '';
  return { title: `Order ${o.number}`, body: body + after };
}

function totalsRows(o: { subtotalMinor: number; discountMinor: number; shippingMinor: number; totalMinor: number; giftCardMinor: number; refundedMinor: number }, m: (minor: number) => string): string {
  const rows: Array<[string, number, boolean]> = [
    ['Subtotal', o.subtotalMinor, true],
    ['Discounts', -o.discountMinor, o.discountMinor !== 0],
    ['Delivery', o.shippingMinor, true],
    ['Total', o.totalMinor, true],
    ['Paid with gift card', o.giftCardMinor, o.giftCardMinor !== 0],
    ['Refunded', o.refundedMinor, o.refundedMinor !== 0],
  ];
  return rows.filter(([, , show]) => show).map(([l, v]) => `<div class="kv small"><span class="muted">${esc(l)}</span><span>${esc(m(v))}</span></div>`).join('');
}

/** A dialog opened with data-dialog-open. */
export function dialog(id: string, title: string, inner: string): string {
  return `<dialog class="adialog" id="${id}" aria-labelledby="${id}-h"><div class="adialog__in"><div class="adialog__head"><h2 class="h3" id="${id}-h">${esc(title)}</h2><button class="icon-btn" type="button" data-dialog-close aria-label="Close">×</button></div>${inner}</div></dialog>`;
}

const RETURN_STATUS: Record<string, [string, 'good' | 'wait' | 'bad' | 'off']> = {
  requested: ['Waiting for a decision', 'wait'],
  approved: ['Approved, on its way back', 'wait'],
  received: ['Received, to refund', 'wait'],
  refunded: ['Refunded', 'good'],
  rejected: ['Declined', 'off'],
  cancelled: ['Withdrawn', 'off'],
};

export async function returns(ac: AdminContext): Promise<string> {
  const status = ac.ctx.query.get('status') ?? '';
  const list = await listReturns(ac.deps.db, ac.ctx.query);
  return `${pageHead('Returns')}
${tabs('Return status', [['All', '/returns/', !status], ...Object.entries(RETURN_STATUS).map(([k, [l]]): [string, string, boolean] => [l, `/returns/?status=${k}`, status === k])])}
${list.length ? table(['Return', 'Order', 'Customer', 'Items', 'Refund', 'Asked', 'Status'], list.map((r) => [raw(`<a class="link" href="/returns/${Number(r.id)}/">${esc(String(r.number))}</a>`), String(r.orderNumber), String(r.customer), num(Number(r.itemCount)), num(money(ac, Number(r.refundMinor), String(r.currency))), date(String(r.requestedAt)), raw(badge(RETURN_STATUS, String(r.status)))]), { caption: 'Returns', minWidth: 720 }) : '<div class="aempty"><h2 class="h3">No returns here</h2></div>'}`;
}

export async function returnDetail(ac: AdminContext, id: number): Promise<{ title: string; body: string } | null> {
  let r;
  try {
    r = await returnView(ac.deps.db, id);
  } catch {
    return null;
  }
  const change = can(ac.staff, 'returns', 'change');
  const step =
    !change
      ? ''
      : r.status === 'requested'
        ? panel('Decide', `<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">${form(`/api/returns/${id}/decide`, `<input type="hidden" data-key="decision" value="approve">${textarea('note', 'Note for the customer (optional)', '', { rows: 2 })}${input('trackingNumber', 'Return tracking number (optional)')}`, { submit: 'Approve' })}${form(`/api/returns/${id}/decide`, `<input type="hidden" data-key="decision" value="reject">${textarea('note', 'Why it is declined (the customer sees this)', '', { rows: 2 })}`, { submit: 'Decline', secondary: true })}</div>`)
        : r.status === 'approved'
          ? panel('Parcel received', form(`/api/returns/${id}/receive`, `${textarea('conditionNote', 'Condition of the items', '', { rows: 2 })}<fieldset class="stack stack--sm"><legend class="strong small">Back on sale</legend>${each(r.items, (i) => `<label class="check"><input type="checkbox" data-list-key="restock" value="${i.orderItemId}" checked><span>${esc(i.name)} × ${i.quantity}</span></label>`)}</fieldset>`, { submit: 'Mark received' }))
          : r.status === 'received'
            ? panel(r.resolution === 'store_credit' ? 'Give store credit' : 'Refund', form(`/api/returns/${id}/refund`, `<p class="small muted">${r.resolution === 'store_credit' ? 'A gift card for the refund plus the bonus is emailed to the customer.' : 'Money goes back to the payment first, then to any gift card used.'} Items: ${esc(money(ac, r.refundMinor, r.currency))}.</p>${checkbox('includesShipping', 'Also give back the delivery charge (our mistake)', false)}`, { submit: r.resolution === 'store_credit' ? 'Send store credit' : 'Refund now', confirm: 'Send the refund now?' }))
            : '';
  return {
    title: `Return ${r.number}`,
    body: `${pageHead(`Return ${r.number}`, '', `<a class="link" href="/returns/">Returns</a> › ${esc(r.number)} · order <a class="link" href="/orders/${r.orderId}/">${esc(r.orderNumber)}</a>`)}
<div class="row">${badge(RETURN_STATUS, r.status)} <span class="small muted">${r.resolution === 'store_credit' ? 'Store credit' : 'Money back'}</span></div>
${panel('Items', table(['Item', 'Qty', 'Reason', 'Refund'], r.items.map((i) => [raw(`${esc(i.name)}<br><span class="small muted">${esc(i.description)}</span>`), num(i.quantity), i.reason.replace(/_/g, ' '), num(money(ac, i.refundMinor, r.currency))]), { caption: 'Items' }))}
${r.customerNote ? panel("Customer's note", `<p>${esc(r.customerNote)}</p>`) : ''}
${r.decisionNote ? panel('Decision note', `<p>${esc(r.decisionNote)}</p>`) : ''}
${r.conditionNote ? panel('Condition', `<p>${esc(r.conditionNote)}</p>`) : ''}
${r.storeCreditLast4 ? panel('Store credit', `<p>Gift card ending ${esc(r.storeCreditLast4)} was emailed.</p>`) : ''}
${step}`,
  };
}

export async function customers(ac: AdminContext): Promise<string> {
  const list = await listCustomers(ac.deps.db, ac.ctx.query);
  return `${pageHead('Customers')}
<form class="afilters" method="get" action="/customers/" role="search"><label class="afilter" for="cq"><span class="visually-hidden">Search customers</span><input class="field__input" id="cq" name="q" type="search" placeholder="Email, name or phone" value="${esc(ac.ctx.query.get('q') ?? '')}"></label><button class="btn btn--secondary" type="submit">Search</button></form>
${list.customers.length ? table(['Customer', 'Email', 'Orders', 'Joined', 'Offers', 'Status'], list.customers.map((c) => [raw(`<a class="link" href="/customers/${Number(c.id)}/">${esc(String(c.name || '(no name)'))}</a>`), String(c.email), num(Number(c.orders)), date(String(c.joinedAt)), c.marketingConsent ? 'Yes' : 'No', String(c.status)]), { caption: 'Customers', minWidth: 720 }) : '<div class="aempty"><h2 class="h3">No customers found</h2></div>'}
${pager(ac, list.page, list.page * 50 < list.total, list.total)}`;
}

export async function customerPage(ac: AdminContext, id: number): Promise<{ title: string; body: string } | null> {
  let c: Record<string, any>;
  try {
    c = await customerDetail(ac.deps.db, id);
  } catch {
    return null;
  }
  const change = can(ac.staff, 'customers', 'change');
  const name = `${String(c.firstName)} ${String(c.lastName)}`.trim() || String(c.email);
  return {
    title: name,
    body: `${pageHead(name, change ? (c.status === 'active' ? postButton('Disable account', `/api/customers/${id}`, { body: { status: 'disabled' }, confirm: 'Disable this account? They are signed out and cannot sign in.' }) : postButton('Turn account back on', `/api/customers/${id}`, { body: { status: 'active' } })) : '', `<a class="link" href="/customers/">Customers</a> › ${esc(name)}`)}
<div class="split"><div class="stack stack--lg">
${panel('Orders', (c.orders as any[]).length ? table(['Order', 'Date', 'Total', 'Payment', 'Status'], (c.orders as any[]).map((o) => [raw(`<a class="link" href="/orders/${o.id}/">${esc(o.number)}</a>`), date(o.placedAt), num(money(ac, o.totalMinor, o.currency)), raw(badge(PAYMENT_STATUS, o.paymentStatus)), raw(badge(ORDER_STATUS, o.status))]), { caption: 'Orders' }) : '<p class="muted small">No orders yet.</p>')}
${panel('Internal note', change ? form(`/api/customers/${id}`, textarea('internalNote', 'Seen by staff only', String(c.internalNote ?? ''), { rows: 3 }), { submit: 'Save note', secondary: true }) : `<p>${esc(String(c.internalNote ?? ''))}</p>`)}
</div><div class="stack">
${panel('Details', `<p><a class="link" href="mailto:${esc(String(c.email))}">${esc(String(c.email))}</a>${c.emailVerified ? '' : ' (not verified)'}<br>${esc(String(c.phone ?? ''))}</p><p class="small muted">Joined ${esc(date(String(c.joinedAt)))} · offers by email: ${c.marketingConsent ? 'yes' : 'no'} · status: ${esc(String(c.status))}</p>${(c.spent as any[]).map((s) => `<p class="small">Spent: ${esc(money(ac, s.totalMinor, s.currency))}</p>`).join('')}`)}
${await customerPointsPanel(ac, id)}
${panel('Addresses', (c.addresses as any[]).map((a) => `<p class="small">${esc(a.name)}, ${esc(a.line1)}, ${esc(a.city)}, ${esc(a.country)}${a.isDefault ? ' (default)' : ''}</p>`).join('') || '<p class="muted small">None saved.</p>')}
</div></div>`,
  };
}

export async function reports(ac: AdminContext): Promise<string> {
  const q = ac.ctx.query;
  const r = await salesReport(ac.deps.db, q.get('from'), q.get('to'), ac.now);
  const search = await ac.deps.db.query("select query, count(*)::int as n, max(results)::int as results from search_queries where created_at >= $1::timestamptz - interval '30 days' group by query order by n desc limit 10", [ac.now]);
  const none = await ac.deps.db.query("select query, count(*)::int as n from search_queries where created_at >= $1::timestamptz - interval '30 days' and results = 0 group by query order by n desc limit 10", [ac.now]);
  return `${pageHead('Reports', `<a class="btn btn--secondary" href="/api/reports/sales.csv?from=${esc(r.from)}&to=${esc(r.to)}">Download as a spreadsheet</a>`)}
<form class="afilters" method="get" action="/reports/"><label class="afilter" for="rf">From <input class="field__input" id="rf" name="from" type="date" value="${esc(r.from)}"></label><label class="afilter" for="rt">To <input class="field__input" id="rt" name="to" type="date" value="${esc(r.to)}"></label><button class="btn btn--secondary" type="submit">Show</button></form>
<div class="grid" style="--cols:3;--cols-tablet:2;--cols-phone:1">${r.totals.length ? each(r.totals, (t) => stat(`Sales in ${t.currency}`, money(ac, t.salesMinor, t.currency), `${t.orders} orders · average ${money(ac, t.averageMinor, t.currency)}${t.refundsMinor ? ` · refunds ${money(ac, t.refundsMinor, t.currency)}` : ''}`, true)) : stat('Sales', '₦0', 'No paid orders in these days')}</div>
${panel('By day', r.byDay.length ? table(['Day', 'Currency', 'Orders', 'Sales'], r.byDay.map((d) => [d.day, d.currency, num(d.orders), num(money(ac, d.salesMinor, d.currency))]), { caption: 'Sales by day' }) : '<p class="muted small">No sales in these days.</p>')}
${panel('Best-selling items', r.topProducts.length ? table(['Item', 'Sold'], r.topProducts.map((p) => [p.name, num(p.quantity)]), { caption: 'Best-selling items' }) : '<p class="muted small">Nothing sold in these days.</p>')}
<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">${panel('Most searched, last 30 days', search.rows.length ? table(['Search', 'Times', 'Found'], search.rows.map((s) => [String(s.query), num(Number(s.n)), num(Number(s.results))]), { caption: 'Most searched' }) : '<p class="muted small">No searches yet.</p>')}
${panel('Searches that found nothing', none.rows.length ? table(['Search', 'Times'], none.rows.map((s) => [String(s.query), num(Number(s.n))]), { caption: 'Searches that found nothing' }) : '<p class="muted small">None.</p>')}</div>`;
}

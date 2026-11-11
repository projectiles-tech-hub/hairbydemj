// Admin pages for the day-to-day work: sign-in, dashboard, orders, returns, customers.
// All names and figures are samples for the design preview.

import { button, check, field } from '../../site/components.js';
import { each, esc } from '../../site/html.js';
import { dialog, emptyState, filters, lineChart, num, pageHead, pager, pair, panel, raw, stat, status, table, tabs, thumb } from '../components.js';

const SAVED = 'data-toast="Saved. This is a preview, so nothing was stored."';

export function signIn(): string {
  return (
    `<div class="narrow stack stack--lg"><h1 class="h2">Sign in</h1>` +
    panel(
      'Staff sign-in',
      `<form class="stack" action="/admin/">` +
        field('Work email', { type: 'email', placeholder: 'name@hairbydemj.com', autocomplete: 'username' }) +
        field('Password', { type: 'password', autocomplete: 'current-password' }) +
        button('Continue') +
        `<fieldset class="stack" id="two-step"><legend class="strong">Two-step verification</legend>` +
        field('6-digit code', { inputmode: 'numeric', autocomplete: 'one-time-code', inputClass: 'code-input' }) +
        button('Sign in', { type: 'submit' }) +
        `</fieldset><p class="small muted">Lost your device? Contact the store owner.</p></form>`,
    ) +
    `</div>`
  );
}

export function dashboard(): string {
  const days: Array<[string, number]> = [['Thu', 2100000], ['Fri', 3300000], ['Sat', 2900000], ['Sun', 4600000], ['Mon', 3900000], ['Tue', 5300000], ['Today', 4250000]];
  return (
    pageHead('Today', `<label class="afilter"><span class="visually-hidden">Period</span><select><option>Last 7 days</option><option>Last 30 days</option><option>This year</option></select></label>`) +
    `<div class="astats">` +
    stat('Sales today', '₦4,250,000', '12 orders', true) +
    stat('Orders to fulfil', '8', '3 waiting for payment') +
    stat('Returns to review', '2') +
    stat('Low stock', '5 variants', 'below 3 units') +
    stat('Visitors today', '1,240', '3.1% bought') +
    `</div><div class="acols acols--wide">` +
    panel('Sales, last 7 days', lineChart('Sales in naira for the last 7 days', days, ['₦6m', '₦4m', '₦2m', '₦0'], 6000000)) +
    panel(
      'Top products',
      table(['Product', num('Sold'), num('Revenue')], [['Bone straight wig', num(24), num('₦6,840,000')], ['Body wave bundles', num(19), num('₦3,135,000')], ['HD lace closure 5×5', num(11), num('₦858,000')]], { caption: 'Top products' }),
    ) +
    `</div>` +
    panel(
      'Latest orders',
      table(
        ['Order', 'Customer', 'Country', num('Total'), 'Payment', 'Status'],
        [
          [raw('<a class="link" href="/admin/orders/hbd-10432/">HBD-10432</a>'), 'Name', 'Nigeria', num('₦285,000'), 'Paid · Paystack', status('To fulfil', 'wait')],
          [raw('<a class="link" href="/admin/orders/hbd-10432/">HBD-10431</a>'), 'Name', 'United Kingdom', num('£240'), 'Paid · Stripe', status('To fulfil', 'wait')],
          [raw('<a class="link" href="/admin/orders/hbd-10432/">HBD-10430</a>'), 'Name', 'United States', num('$310'), 'Awaiting payment', status('On hold', 'off')],
        ],
        { caption: 'Latest orders', minWidth: 720 },
      ),
    )
  );
}

function ordersFrame(inner: string, current = 'To fulfil (8)'): string {
  const t: Array<[string, string]> = [['All (412)', '/admin/orders/'], ['To fulfil (8)', '/admin/orders/'], ['On hold (3)', '/admin/orders/'], ['Shipped (24)', '/admin/orders/'], ['Delivered', '/admin/orders/'], ['Returned', '/admin/orders/'], ['Cancelled', '/admin/orders/']];
  return (
    pageHead('Orders', button('Export', { kind: 'secondary' })) +
    tabs('Order status', t.map(([l, h]) => [l, h, l === current] as [string, string, boolean])) +
    filters([['Date', ['Last 30 days', 'Last 7 days', 'Today']], ['Country', ['All', 'Nigeria', 'United Kingdom', 'United States', 'Ghana']], ['Payment', ['All', 'Paystack', 'Stripe', 'Awaiting payment']], ['Carrier', ['All', 'DHL Express', 'UPS', 'FedEx', 'Local courier']]]) +
    inner
  );
}

export function orders(): string {
  const o = (id: string): { html: string } => raw(`<a class="link" href="/admin/orders/hbd-10432/">${id}</a>`);
  return ordersFrame(
    panel(
      '',
      table(
        ['Order', 'Date', 'Customer', 'Country', num('Items'), num('Total'), 'Payment', 'Shipping', 'Status'],
        [
          [o('HBD-10432'), 'Today 09:10', 'Name', 'Nigeria', num(2), num('₦285,000'), 'Paid · Paystack', 'DHL Express', status('To fulfil', 'wait')],
          [o('HBD-10431'), 'Today 08:52', 'Name', 'United Kingdom', num(1), num('£240'), 'Paid · Stripe', 'UPS Saver', status('To fulfil', 'wait')],
          [o('HBD-10430'), 'Yesterday', 'Name', 'United States', num(3), num('$310'), 'Awaiting payment', 'FedEx', status('On hold', 'off')],
          [o('HBD-10429'), 'Yesterday', 'Name', 'Ghana', num(1), num('$310'), 'Paid · Stripe', 'DHL Express', status('Shipped', 'good')],
          [o('HBD-10428'), '2 days ago', 'Name', 'Nigeria', num(2), num('₦285,000'), 'Paid · Paystack', 'Local courier', status('Delivered', 'good')],
        ],
        { caption: 'Orders', select: true, minWidth: 1040 },
      ),
    ),
  );
}

export function ordersEmpty(): string {
  return ordersFrame(panel('', emptyState('No orders to fulfil', 'New paid orders show here. Orders waiting for payment are under On hold.', button('View all orders', { kind: 'secondary', href: '/admin/orders/' }))));
}

export function ordersLoading(): string {
  return ordersFrame(panel('', `<div class="askeleton" aria-hidden="true">${'<span></span>'.repeat(30)}</div><p class="small muted" role="status">Loading orders…</p>`));
}

export function ordersError(): string {
  return ordersFrame(panel('', emptyState('We could not load the orders', 'The server did not answer. Your orders are safe. Check your connection and try again.', button('Try again', { href: '/admin/orders/' }), true)));
}

export function orderDetail(): string {
  return (
    pageHead(
      'Order HBD-10432',
      button('Print packing slip', { kind: 'secondary' }) + button('Refund', { kind: 'secondary', attrs: 'data-dialog-open="refund"' }) + button('Buy shipping label', { kind: 'secondary' }) + button('Mark shipped', { attrs: 'data-toast="Marked as shipped. This is a preview, so nothing was stored."' }),
      `<a class="link" href="/admin/orders/">Orders</a> › HBD-10432 · Placed today 09:10 · Paid · To fulfil`,
    ) +
    `<div class="acols"><div class="stack">` +
    panel(
      'Items (2)',
      table(
        ['Photo', 'Product', 'SKU', num('Qty'), num('Price'), num('Total')],
        [
          [thumb(), 'Bone straight wig · 22" · 180% · Natural black', 'WIG-BW-22-180-NB', num(1), num('₦285,000'), num('₦285,000')],
          [thumb(), 'Body wave bundles · 18" · 150% · 613', 'BUN-ST-18-613', num(1), num('₦285,000'), num('₦285,000')],
        ],
        { caption: 'Items in this order', nameColumn: 1, minWidth: 640 },
      ) + `<p class="small muted">Subtotal ₦285,000 · Discount −₦18,500 (CODE10) · Shipping ₦18,500 · Total ₦285,000 · Duties: paid by receiver</p>`,
    ) +
    panel('Shipping', `<p class="small">DHL Express · chosen at checkout · rate ₦18,500 · package: Medium box 0.9 kg</p><p class="small muted">Label: not bought yet · Tracking: none</p>`) +
    panel(
      'Timeline',
      `<ul class="atimeline small"><li>09:10 Order placed by customer</li><li>09:10 Payment confirmed by Paystack (ref 000000)</li><li>09:11 Confirmation email sent</li></ul>` + field('Add an internal note', { textarea: true }),
    ) +
    `</div><div class="stack">` +
    panel('Customer', `<p class="small">Name · you@example.com · +234 000 000 0000 · 3 orders · Gold tier</p>`) +
    panel('Delivery address', `<p class="small">Name<br>12 Street<br>Lagos, Nigeria</p><a class="link small" href="#">Edit</a>`) +
    panel('Payment', `<p class="small">Paystack · Card ending 1234 · ₦285,000 · Paid 09:10</p>`) +
    `</div></div>`
  );
}

export function refundDialog(): string {
  return dialog(
    'refund',
    'Refund order HBD-10432',
    `<fieldset class="stack stack--sm"><legend class="strong small">Choose what to refund</legend>` +
      check('Bone straight wig, 22 inches · ₦285,000', { checked: true }) +
      check('HD lace closure 5×5, 18 inches · ₦78,000') +
      check('Shipping · ₦18,500') +
      `</fieldset>` +
      field('Amount to refund', { value: '₦285,000', inputmode: 'numeric' }) +
      field('Reason', { options: ['Returned by customer', 'Item out of stock', 'Damaged in delivery', 'Goodwill'] }) +
      `<p class="small muted">₦285,000 goes back to the customer's card through Paystack. The customer is emailed. A refund cannot be undone.</p>`,
    button('Cancel', { kind: 'secondary', type: 'submit', attrs: 'value="cancel"' }) + button('Refund ₦285,000', { type: 'submit', attrs: 'value="ok" data-toast="Refund recorded. This is a preview, so no money moved."' }),
  );
}

export function returns(): string {
  return (
    pageHead(
      'Return RET-205 · Order HBD-10398',
      button('Reject', { kind: 'secondary', attrs: 'data-toast="Return rejected. This is a preview, so nothing was stored."' }) + button('Approve', { attrs: 'data-toast="Return approved. This is a preview, so nothing was stored."' }),
      `Returns › RET-205 · Requested yesterday · Awaiting review`,
    ) +
    `<div class="acols"><div class="stack">` +
    panel(
      'Items to return',
      table(['Product', 'Reason', num('Qty'), num('Refund')], [['HD lace closure 5×5 · 22" · 180%', 'Wrong length received', num(1), num('₦285,000')]], { caption: 'Items to return', minWidth: 560 }) +
        `<p class="small muted">Customer note: "I ordered 22 inches but received 18."</p><div class="row">${thumb('Customer photo 1', 112).html}${thumb('Customer photo 2', 112).html}</div>`,
    ) +
    panel(
      'Steps',
      `<ol class="asteps small"><li aria-current="step">Review request (you are here)</li><li>Approved: instructions and return label sent</li><li>Item received: condition recorded</li><li>Refund issued: ₦285,000 to original card</li></ol>` +
        field('Decision note to the customer', { textarea: true }),
    ) +
    `</div><div class="stack">` +
    panel('Customer', `<p class="small">Name · 3 orders · 1 previous return</p>`) +
    panel('Policy check', `<ul class="achecks small"><li>Within 14 days of delivery</li><li>Photos attached</li><li>Item not marked final sale</li></ul>`) +
    `</div></div>`
  );
}

export function customers(): string {
  const rows: Array<[string, string, string, string, string, string]> = [
    ['Name', 'you@example.com', 'Nigeria', '3', '₦285,000', 'Gold'],
    ['Name', 'name@example.com', 'United Kingdom', '1', '£240', 'Bronze'],
    ['Name', 'name@example.com', 'United States', '7', '$3,100', 'Platinum'],
  ];
  return (
    pageHead('Customers', button('Export', { kind: 'secondary' })) +
    filters([['Country', ['All', 'Nigeria', 'United Kingdom', 'United States']], ['Tier', ['All', 'Bronze', 'Gold', 'Platinum']], ['Has ordered', ['All', 'Yes', 'No']], ['Subscribed to offers', ['All', 'Yes', 'No']]]) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel('', table(['Customer', 'Email', 'Country', num('Orders'), num('Spent'), 'Tier'], rows.map(([a, b, c, d, e, f]) => [a, b, c, num(d), num(e), f]), { caption: 'Customers', minWidth: 620 })) +
    pager() +
    `</div>` +
    panel(
      'Customer profile',
      `<p class="small">Name Surname · you@example.com · Verified ✓ · +234 000 000 0000</p>` +
        pair('Orders', '3 · ₦285,000') +
        pair('Points', '1,250 · Gold') +
        pair('Returns', '1') +
        pair('Saved cards', 'Visa ending 1234') +
        `<div class="row">${button('Adjust points', { kind: 'secondary' })}${button('Send password reset email', { kind: 'secondary', attrs: 'data-toast="Reset email sent. This is a preview, so no email went out."' })}</div>` +
        field('Internal note', { textarea: true }) +
        `<p class="small muted">Recent orders: ${each(['HBD-10432', 'HBD-10398', 'HBD-10211'], (id, i) => `${i ? ' · ' : ''}<a class="link" href="/admin/orders/hbd-10432/">${esc(id)}</a>`)}</p>`,
    ) +
    `</div>`
  );
}

export { SAVED };

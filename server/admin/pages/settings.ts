// Admin pages for running the store: shipping, payments, reports, staff, activity, settings.

import { button, check, field } from '../../site/components.js';
import { each } from '../../site/html.js';
import { dialog, filters, lineChart, num, pageHead, pager, pair, panel, raw, stat, status, table, tabs, tick } from '../components.js';
import { SAVED } from './sales.js';

export function shipping(): string {
  return (
    pageHead('Shipping settings', button('Save changes', { attrs: SAVED })) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel(
      'Carriers',
      table(
        ['Carrier', 'Status', 'Services offered', num('Markup')],
        [['DHL Express', status('Connected', 'good'), 'Express Worldwide', num('0 %')], ['UPS', status('Connected', 'good'), 'Saver, Expedited', num('0 %')], ['FedEx', status('Connected', 'good'), 'International Economy, Priority', num('0 %')]],
        { caption: 'Carriers', minWidth: 520 },
      ) + button('Test live rates', { kind: 'secondary', attrs: 'data-toast="This is a preview, so no carrier was contacted."' }),
    ) +
    panel('Local rates (Nigeria)', table(['Zone', 'Courier', num('Price'), 'Time'], [['Benin City', 'Dispatch rider', num('₦6,500'), 'Same day'], ['Lagos, Abuja', 'Courier', num('₦6,500'), '1 to 2 days'], ['Other states', 'Courier', num('₦6,500'), '2 to 4 days']], { caption: 'Local rates in Nigeria', minWidth: 480 })) +
    `</div><div class="stack">` +
    panel('Ships from', field('Address', { value: 'Benin City, Edo State, Nigeria' })) +
    panel('Package sizes', table(['Name', 'Size (cm)', num('Empty weight')], [['Small box', '20 × 15 × 8', num('0.1 kg')], ['Medium box', '30 × 22 × 10', num('0.2 kg')]], { caption: 'Package sizes' })) +
    panel('Rules', check('Free shipping over ₦000,000 (Nigeria)', { checked: true }) + check('Show duties notice at checkout', { checked: true })) +
    `</div></div>`
  );
}

export function payments(): string {
  return (
    pageHead('Payments and currencies', button('Save changes', { attrs: SAVED })) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel(
      'Payment providers',
      table(['Provider', 'Status', 'Currencies', 'Methods'], [['Paystack', status('Connected · Live', 'good'), 'NGN', 'Card, bank transfer, USSD'], ['Stripe', status('Connected · Live', 'good'), 'USD, GBP, EUR', 'Card, Apple Pay, Google Pay']], { caption: 'Payment providers', minWidth: 560 }),
    ) +
    panel(
      'Currencies',
      table(
        ['Currency', 'Shown to', 'Rate source', 'Rounding'],
        [['NGN ₦', 'Nigeria', 'Base currency', 'Nearest ₦500'], ['USD $', 'United States and rest of world', 'Daily rate + 0 %', 'To .00'], ['GBP £', 'United Kingdom', 'Daily rate + 0 %', 'To .00'], ['EUR €', 'Eurozone', 'Daily rate + 0 %', 'To .00']],
        { caption: 'Currencies', minWidth: 560 },
      ),
    ) +
    `</div><div class="stack">` +
    panel('Options', check('Customers can save cards', { checked: true }) + check('Hold stock for 30 minutes after a failed payment', { checked: true }) + check('Test mode')) +
    panel('Latest payouts', pair('Paystack · 9 Nov', '₦4,250,000') + pair('Stripe · 8 Nov', '$3,100')) +
    `</div></div>`
  );
}

export function reports(): string {
  const days: Array<[string, number]> = [];
  const values = [310, 420, 380, 520, 470, 610, 560, 700, 640, 590, 730, 680, 760, 820, 790, 870, 910, 860, 940, 880, 760, 820, 900, 950, 870, 930, 980, 900, 840, 890];
  const start = Date.UTC(2026, 9, 12);
  values.forEach((v, i) => {
    const d = new Date(start + i * 86400000);
    days.push([`${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`, v * 1000]);
  });
  return (
    pageHead('Reports', `<label class="afilter"><span class="visually-hidden">Date</span><select><option>Date: Last 30 days</option><option>Last 7 days</option><option>This year</option></select></label>` + button('Export CSV', { kind: 'secondary' })) +
    tabs('Report', [['Sales', '/admin/reports/', true], ['Products', '/admin/reports/'], ['Customers', '/admin/reports/'], ['Currencies', '/admin/reports/'], ['Discounts', '/admin/reports/'], ['Shipping', '/admin/reports/']]) +
    `<div class="astats astats--4">${stat('Sales', '₦18,450,000', '', true)}${stat('Orders', '412')}${stat('Average order', '₦285,000', '', true)}${stat('Returns', '3.1 %')}</div>` +
    `<div class="acols acols--wide">` +
    panel('Sales by day', lineChart('Sales in naira by day, last 30 days', days, ['₦1m', '₦0.7m', '₦0.3m', '₦0'], 1000000, 9)) +
    panel('Sales by currency', table(['Currency', num('Orders'), num('Sales')], [['NGN', num(280), num('₦18,450,000')], ['USD', num(70), num('$15,800')], ['GBP', num(45), num('£12,400')], ['EUR', num(17), num('€2,900')]], { caption: 'Sales by currency' })) +
    `</div>` +
    panel('', table(['Product', num('Sold'), num('Sales'), num('Returned'), num('Stock left')], [['Wig care set', num(64), num('₦18,240,000'), num(1), num(48)], ['Bone straight wig', num(51), num('₦8,415,000'), num(0), num(3)], ['Body wave bundles', num(33), num('₦2,574,000'), num(2), num(17)]], { caption: 'Sales by product', minWidth: 620 }))
  );
}

export function staff(): string {
  const areas: Array<[string, boolean, boolean]> = [['Orders', true, true], ['Returns', true, true], ['Products', true, false], ['Customers', true, false], ['Discounts', false, false], ['Payments and settings', false, false], ['Reports', false, false]];
  return (
    pageHead('Staff and roles', button('New role', { kind: 'secondary' }) + button('Invite staff', { attrs: 'data-dialog-open="invite"' })) +
    `<div class="acols acols--wide">` +
    panel(
      '',
      table(
        ['Name', 'Email', 'Role', 'Two-step', 'Last sign-in'],
        [
          ['Emmanuel', 'owner@hairbydemj.com', 'Owner', status('On', 'good'), 'Today'],
          ['Staff name', 'name@hairbydemj.com', 'Manager', status('On', 'good'), 'Today'],
          ['Staff name', 'name@hairbydemj.com', 'Fulfilment', status('On', 'good'), 'Yesterday'],
          ['Staff name', 'name@hairbydemj.com', 'Support', status('Not set up', 'bad'), 'Never'],
        ],
        { caption: 'Staff', minWidth: 620 },
      ),
    ) +
    panel('Role: Fulfilment', table(['Area', 'View', 'Change'], areas.map(([a, v, c]) => [a, raw(tick(`View ${a}`, v)), raw(tick(`Change ${a}`, c))]), { caption: 'What the Fulfilment role can do' }) + button('Save role', { attrs: SAVED })) +
    `</div>`
  );
}

export function inviteDialog(): string {
  return dialog(
    'invite',
    'Invite a staff member',
    field('Full name', { autocomplete: 'off' }) +
      field('Work email', { type: 'email', placeholder: 'name@hairbydemj.com' }) +
      field('Role', { options: ['Fulfilment', 'Manager', 'Support'] }) +
      `<p class="small muted">They get an email with a link that lasts 48 hours, to set a password and two-step verification. They can do nothing until both are set.</p>`,
    button('Cancel', { kind: 'secondary', type: 'submit', attrs: 'value="cancel"' }) + button('Send invite', { type: 'submit', attrs: 'value="ok" data-toast="Invite recorded. This is a preview, so no email went out."' }),
  );
}

export function activity(): string {
  return (
    pageHead('Activity log', button('Export', { kind: 'secondary' })) +
    filters([['Staff', ['All', 'Emmanuel', 'Staff name']], ['Area', ['All', 'Orders', 'Products', 'Returns', 'Gift cards', 'Staff and roles']], ['Date', ['Last 7 days', 'Last 30 days', 'Today']]]) +
    panel(
      '',
      table(
        ['When', 'Who', 'Area', 'What changed'],
        [
          ['Today 09:14', 'Staff name', 'Orders', 'Marked HBD-10432 shipped; DHL label bought'],
          ['Today 08:50', 'Staff name', 'Products', 'Price of "Product name" 22" changed from ₦285,000 to ₦285,000'],
          ['Yesterday 17:02', 'Emmanuel', 'Staff and roles', 'Invited name@hairbydemj.com as Support'],
          ['Yesterday 16:40', 'Staff name', 'Returns', 'Refunded ₦285,000 for RET-204'],
          ['Yesterday 11:15', 'Staff name', 'Gift cards', 'Issued ₦100,000 gift card: goodwill'],
        ],
        { caption: 'Activity log', minWidth: 760 },
      ),
    ) +
    pager()
  );
}

export function storeSettings(): string {
  const box = (label: string, on: boolean | null): { html: string } => (on === null ? raw('<span class="muted" aria-label="Not available">—</span>') : raw(tick(label, on)));
  const msgs: Array<[string, boolean, boolean | null, boolean | null]> = [['Order confirmed', true, true, true], ['Order shipped', true, true, true], ['Return approved', true, false, true], ['Back in stock', true, false, true], ['Verify your email', true, null, null]];
  return (
    pageHead('Store settings', button('Save changes', { attrs: SAVED })) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel(
      'Store details',
      `<div class="fields fields--2">${field('Store name', { value: 'hairbydemj' })}${field('Support email', { type: 'email', value: 'hello@hairbydemj.com' })}${field('WhatsApp number', { value: '+234', inputmode: 'tel' })}${field('Business hours', { value: 'Mon to Sat, 9:00 to 18:00' })}</div>` + field('Business address'),
    ) +
    panel(
      'Customer emails and messages',
      table(['Message', 'Email', 'WhatsApp', 'Push'], msgs.map(([m, e, w, p]) => [m, box(`${m} by email`, e), box(`${m} by WhatsApp`, w), box(`${m} by push`, p)]), { caption: 'Customer emails and messages', minWidth: 480 }) + button('Edit templates', { kind: 'secondary' }),
    ) +
    `</div><div class="stack">` +
    panel('Staff alerts', each(['New order', 'Low stock', 'New return request', 'Failed payout'], (a) => check(a, { checked: true }))) +
    panel('Returns', `<div class="fields fields--2">${field('Return window', { value: '14 days' })}${field('Store credit bonus', { value: '10 %' })}</div>`) +
    `</div></div>`
  );
}

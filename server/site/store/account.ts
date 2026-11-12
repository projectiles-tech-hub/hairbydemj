// Account pages: signing in and up, codes and passwords, and the signed-in
// customer's orders, returns, addresses, details, choices and wishlist.
// Guests see an order with its private link, or by order number and email.

import { readPreferences } from '../../notifications/notify.js';
import { customerOrders, orderView, type OrderView } from '../../orders/orders.js';
import { REASONS } from '../../orders/returns.js';
import { listAddresses, listWishlist, readProfile } from '../../accounts/profile.js';
import { button, card, icon } from '../components.js';
import { each, esc } from '../html.js';
import { COUNTRIES } from './checkout.js';
import { money, picture, type Currency, type SiteContext } from './view.js';

const field = (id: string, label: string, attrs: string, value = '', help = ''): string =>
  `<div class="field"><label class="field__label" for="${id}">${esc(label)}</label><input class="field__input" id="${id}" name="${id}" ${attrs} value="${esc(value)}">${help ? `<p class="field__help">${esc(help)}</p>` : ''}<p class="field__error" data-error-for="${id}" hidden></p></div>`;

const formEnd = (label: string): string => `${button(label, { type: 'submit', fullPhone: true })}<p class="small" role="alert" data-form-error></p><p class="small" role="status" data-form-ok></p>`;

/** A form the browser script sends as JSON to `action`, then goes to `next` (or reloads). */
const jsonForm = (action: string, inner: string, o: { next?: string; reload?: boolean; confirm?: string } = {}): string =>
  `<form class="stack" data-json-form="${esc(action)}"${o.next ? ` data-next="${esc(o.next)}"` : ''}${o.reload ? ' data-reload' : ''}${o.confirm ? ` data-confirm="${esc(o.confirm)}"` : ''} novalidate>${inner}</form>`;

function safeNext(sc: SiteContext): string {
  const next = sc.ctx.query.get('next') ?? '';
  return /^\/[a-z0-9/_?=&.-]*$/i.test(next) && !next.startsWith('//') ? next : '/account/';
}

export function signInPage(sc: SiteContext): { title: string; body: string; scripts: string[] } {
  const google = sc.deps.config.googleClientIds[0];
  return {
    title: 'Sign in',
    scripts: google ? ['https://accounts.google.com/gsi/client'] : [],
    body: `<div class="narrow stack"><h1 class="h1">Sign in</h1>
${jsonForm('/api/auth/sign-in', `${field('email', 'Email', 'type="email" autocomplete="email" required')}${field('password', 'Password', 'type="password" autocomplete="current-password" required')}<p class="small"><a class="link" href="/forgot-password/">Forgot your password?</a></p>${formEnd('Sign in')}`, { next: safeNext(sc) })}
${google ? `<div class="stack stack--sm"><p class="small muted center">or</p><div id="g_id_onload" data-client_id="${esc(google)}" data-callback="hbdGoogle" data-auto_prompt="false" data-next="${esc(safeNext(sc))}"></div><div class="g_id_signin" data-type="standard" data-shape="pill" data-theme="filled_black" data-text="continue_with" data-width="320"></div></div>` : ''}
<p>New here? <a class="link" href="/create-account/">Create an account</a></p></div>`,
  };
}

export function createAccountPage(): { title: string; body: string } {
  return {
    title: 'Create an account',
    body: `<div class="narrow stack"><h1 class="h1">Create an account</h1>
${jsonForm('/api/auth/sign-up', `<div class="fields fields--2">${field('firstName', 'First name', 'autocomplete="given-name" required')}${field('lastName', 'Last name', 'autocomplete="family-name"')}</div>${field('email', 'Email', 'type="email" autocomplete="email" required')}${field('password', 'Password', 'type="password" autocomplete="new-password" minlength="10" required', '', 'At least 10 characters.')}
<label class="check"><input type="checkbox" name="marketingConsent"><span>Email me new arrivals and offers. I can stop at any time.</span></label>${formEnd('Create account')}`, { next: '/verify-email/?email={email}' })}
<p>Already have an account? <a class="link" href="/sign-in/">Sign in</a></p></div>`,
  };
}

export function verifyEmailPage(sc: SiteContext): { title: string; body: string } {
  const email = (sc.ctx.query.get('email') ?? '').slice(0, 254);
  return {
    title: 'Verify your email',
    body: `<div class="narrow stack"><h1 class="h1">Check your email</h1><p class="muted">We sent a 6-digit code to ${email ? `<strong>${esc(email)}</strong>` : 'your email'}. Enter it below.</p>
${jsonForm('/api/auth/verify-email', `<input type="hidden" name="email" value="${esc(email)}">${email ? '' : field('email', 'Email', 'type="email" autocomplete="email" required')}${field('code', 'Code', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" required')}${formEnd('Verify')}`, { next: '/account/' })}
${jsonForm('/api/auth/resend-code', `<input type="hidden" name="email" value="${esc(email)}"><button class="btn btn--text small" type="submit">Send a new code</button><p class="small" role="status" data-form-ok></p><p class="small" role="alert" data-form-error></p>`)}</div>`,
  };
}

export function forgotPasswordPage(): { title: string; body: string } {
  return {
    title: 'Forgot your password',
    body: `<div class="narrow stack"><h1 class="h1">Forgot your password?</h1><p class="muted">Enter your email and we will send you a link to choose a new one.</p>
${jsonForm('/api/auth/forgot-password', `${field('email', 'Email', 'type="email" autocomplete="email" required')}${formEnd('Send the link')}`, {})}
<p data-ok-text hidden>If there is an account for that email, the link is on its way. It works for one hour.</p></div>`,
  };
}

export function resetPasswordPage(sc: SiteContext): { title: string; body: string } {
  const token = (sc.ctx.query.get('token') ?? '').slice(0, 200);
  return {
    title: 'Choose a new password',
    body: `<div class="narrow stack"><h1 class="h1">Choose a new password</h1>${token ? jsonForm('/api/auth/reset-password', `<input type="hidden" name="token" value="${esc(token)}">${field('password', 'New password', 'type="password" autocomplete="new-password" minlength="10" required', '', 'At least 10 characters.')}${formEnd('Save password')}`, { next: '/sign-in/?reset=1' }) : card('<p class="muted">This link is not complete. Use the full link from the email, or ask for a new one.</p><a class="link" href="/forgot-password/">Send a new link</a>')}</div>`,
  };
}

// ----- signed-in pages -----

const ACCOUNT_NAV: ReadonlyArray<[string, string]> = [
  ['Overview', '/account/'],
  ['Orders', '/account/orders/'],
  ['Addresses', '/account/addresses/'],
  ['Wishlist', '/account/wishlist/'],
  ['Details and password', '/account/profile/'],
  ['Email and notifications', '/account/preferences/'],
];

function accountShell(sc: SiteContext, current: string, title: string, inner: string): string {
  return `<div class="split" style="--side:260px;--side-tablet:220px;grid-template-columns:var(--side) 1fr"><nav class="stack stack--sm" aria-label="Account">${each(ACCOUNT_NAV, ([l, h]) => `<a class="menu-link menu-link--small" href="${h}"${h === current ? ' aria-current="page"' : ''}>${esc(l)}</a>`)}<button class="menu-link menu-link--small" type="button" data-sign-out>Sign out</button></nav>
<div class="stack stack--lg"><h1 class="h1">${esc(title)}</h1>${inner}</div></div>`;
}

export async function overviewPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const customer = sc.customer!;
  const orders = await customerOrders(sc.deps.db, customer.id, 1);
  const recent = orders.orders.slice(0, 3);
  return {
    title: 'Your account',
    body: accountShell(sc, '/account/', `Hello${customer.firstName ? `, ${customer.firstName}` : ''}`, `${card(recent.length ? each(recent, (o) => orderRow(sc, o)) : '<p class="muted">No orders yet.</p>', { title: 'Recent orders' })}${recent.length ? '<a class="link" href="/account/orders/">All orders</a>' : button('Start shopping', { href: '/' })}`),
  };
}

const STATUS_TEXT: Record<string, string> = { on_hold: 'Waiting for payment', to_fulfil: 'Being prepared', shipped: 'On its way', delivered: 'Delivered', returned: 'Returned', cancelled: 'Cancelled' };

function orderRow(sc: SiteContext, o: Record<string, unknown>): string {
  const cur = sc.currencies.find((c) => c.code === o.currency) ?? sc.currency;
  return `<div class="row row--between"><div class="stack stack--xs"><a class="strong" href="/account/orders/${esc(String(o.number).toLowerCase())}/">${esc(String(o.number))}</a><span class="small muted">${esc(new Date(String(o.placedAt)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))} · ${Number(o.itemCount)} ${Number(o.itemCount) === 1 ? 'item' : 'items'}</span></div><div class="stack stack--xs" style="text-align:right"><span class="strong">${esc(money(sc, Number(o.totalMinor), cur))}</span><span class="small">${esc(STATUS_TEXT[String(o.status)] ?? String(o.status))}</span></div></div><hr class="divider">`;
}

export async function ordersPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const page = Math.max(1, Number(sc.ctx.query.get('page')) || 1);
  const list = await customerOrders(sc.deps.db, sc.customer!.id, page);
  return {
    title: 'Your orders',
    body: accountShell(sc, '/account/orders/', 'Orders', `${list.orders.length ? card(each(list.orders, (o) => orderRow(sc, o))) : card('<p class="muted">No orders yet.</p>')}${list.more ? `<a class="link" href="/account/orders/?page=${page + 1}">Older orders</a>` : ''}`),
  };
}

/** One order, for its customer: the same for a signed-in customer, a guest with the link, or after a look-up. */
export function orderDetail(sc: SiteContext, view: OrderView, o: { token: string | null; canAct: boolean }): string {
  const cur: Currency = sc.currencies.find((c) => c.code === view.currency) ?? sc.currency;
  const m = (minor: number): string => esc(money(sc, minor, cur));
  const actions = o.canAct
    ? `${view.canPay ? button('Pay now', { attrs: `data-pay-order="${esc(view.number)}"${o.token ? ` data-token="${esc(o.token)}"` : ''}` }) : ''}
${view.canCancel ? button('Cancel this order', { kind: 'secondary', attrs: `data-cancel-order="${esc(view.number)}"${o.token ? ` data-token="${esc(o.token)}"` : ''}` }) : ''}
${view.paymentStatus !== 'awaiting' && view.paymentStatus !== 'failed' ? `<a class="btn btn--secondary" href="/api/orders/${esc(view.number)}/invoice${o.token ? `?token=${esc(encodeURIComponent(o.token))}` : ''}" target="_blank" rel="noopener">Invoice</a>` : ''}`
    : '';
  const returnable = view.items.filter((i) => i.returnableQuantity > 0);
  const reasonText: Record<string, string> = { wrong_item: 'Wrong item sent', wrong_length: 'Wrong length', damaged: 'Arrived damaged', not_as_described: 'Not as described', changed_mind: 'Changed my mind', other: 'Something else' };
  const returnForm =
    o.canAct && view.canReturn
      ? card(
          `<form class="stack" data-return-form="${esc(view.number)}"${o.token ? ` data-token="${esc(o.token)}"` : ''} novalidate>
<p class="muted">Choose what you are sending back. Final-sale items can only come back if they were wrong or damaged.</p>
${each(returnable, (i) => `<fieldset class="stack stack--sm card card--outline"><legend class="strong">${esc(i.name)}${i.description ? `, ${esc(i.description)}` : ''}${i.isFinalSale ? ' (final sale)' : ''}</legend><label class="check"><input type="checkbox" name="item" value="${i.id}"><span>Send this back</span></label><div class="fields fields--2"><div class="field"><label class="field__label" for="rq-${i.id}">How many</label><input class="field__input" id="rq-${i.id}" type="number" min="1" max="${i.returnableQuantity}" value="${i.returnableQuantity}" data-return-qty="${i.id}"></div><div class="field"><label class="field__label" for="rr-${i.id}">Why</label><select class="field__input" id="rr-${i.id}" data-return-reason="${i.id}">${each(REASONS, (r) => `<option value="${r}">${esc(reasonText[r] ?? r)}</option>`)}</select></div></div></fieldset>`)}
<fieldset class="stack stack--sm"><legend class="strong small">What would you like?</legend><label class="check"><input type="radio" name="resolution" value="refund" checked><span>My money back</span></label><label class="check"><input type="radio" name="resolution" value="store_credit"><span>Store credit, with a bonus</span></label></fieldset>
<div class="field"><label class="field__label" for="return-note">Anything we should know? (optional)</label><textarea class="field__input" id="return-note" name="note" rows="3" maxlength="1000"></textarea></div>
${button('Ask for a return', { type: 'submit', fullPhone: true })}<p class="small" role="alert" data-form-error></p></form>`,
          { title: 'Send something back' },
        )
      : view.status === 'delivered' && o.canAct === false
        ? '<p class="small muted">To ask for a return, use the link in your order email, or sign in.</p>'
        : '';
  return `<div class="row row--between"><div class="stack stack--xs"><p class="strong">${esc(STATUS_TEXT[view.status] ?? view.status)}</p><p class="small muted">Placed ${esc(new Date(view.placedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p></div><div class="row">${actions}</div></div>
<p class="small" role="alert" data-order-error></p>
<div class="split"><div class="stack stack--lg">
${card(each(view.items, (i) => `<div class="row row--between"><div class="stack stack--xs"><span class="strong">${esc(i.name)}</span><span class="small muted">${esc(i.description)} · Qty ${i.quantity}</span></div><span class="strong">${m(i.totalMinor)}</span></div>`), { title: 'Items' })}
${view.shipments.length ? card(each(view.shipments, (s) => `<div class="stack stack--sm"><p class="strong">${esc(s.carrierName)}${s.serviceName ? `: ${esc(s.serviceName)}` : ''}</p>${s.trackingNumber ? `<p class="small">Tracking number ${esc(s.trackingNumber)}${s.trackingUrl ? ` · <a class="link" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">Track with the carrier</a>` : ''}</p>` : ''}<ol class="stack stack--xs small">${each(s.events, (e) => `<li><span class="muted">${esc(new Date(e.occurredAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span> ${esc(e.description)}${e.location ? `, ${esc(e.location)}` : ''}</li>`)}</ol></div>`), { title: 'Delivery' }) : ''}
${view.returns.length ? card(each(view.returns, (r) => `<div class="row row--between"><span>${esc(r.number)}: ${esc(r.status.replace('_', ' '))}</span>${r.status === 'requested' && o.canAct ? `<button class="btn btn--text small" type="button" data-cancel-return="${r.id}" data-order="${esc(view.number)}"${o.token ? ` data-token="${esc(o.token)}"` : ''}>Withdraw</button>` : ''}</div>`), { title: 'Returns' }) : ''}
${returnForm}
${card(`<ol class="stack stack--xs">${each([...view.timeline].reverse(), (e) => `<li class="small"><span class="muted">${esc(new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span> ${esc(e.summary)}</li>`)}</ol>`, { title: 'What has happened' })}
</div><div class="stack">${card(`<div class="kv"><span>Subtotal</span><span>${m(view.subtotalMinor)}</span></div>${view.discountMinor ? `<div class="kv"><span>Discounts</span><span>−${m(view.discountMinor)}</span></div>` : ''}<div class="kv"><span>Delivery</span><span>${m(view.shippingMinor)}</span></div>${view.giftCardMinor ? `<div class="kv"><span>Gift cards</span><span>−${m(view.giftCardMinor)}</span></div>` : ''}<hr class="divider"><div class="kv strong"><span>Total</span><span class="price">${m(view.totalMinor)}</span></div>${view.refundedMinor ? `<div class="kv"><span>Refunded</span><span>${m(view.refundedMinor)}</span></div>` : ''}${view.dutiesNotice ? '<p class="small muted">Import duties and taxes, if any, are paid to the carrier on delivery.</p>' : ''}`, { title: 'Payment' })}
${card(`<p>${esc(view.address.name)}<br>${esc(view.address.line1)}${view.address.line2 ? `<br>${esc(view.address.line2)}` : ''}<br>${esc([view.address.city, view.address.region, view.address.postalCode].filter(Boolean).join(', '))}<br>${esc(COUNTRIES.find(([c]) => c === view.address.country)?.[1] ?? view.address.country)}</p><p class="small muted">${esc(view.delivery.service ?? '')}${view.delivery.estimate ? `, ${esc(view.delivery.estimate)}` : ''}</p>`, { title: 'Delivery address' })}</div></div>`;
}

/** Stripe's card form is needed only for an unpaid order in dollars, pounds or euros. */
export function stripeFor(view: OrderView): string[] {
  return view.canPay && view.currency !== 'NGN' ? ['https://js.stripe.com/v3/'] : [];
}

export async function orderPage(sc: SiteContext, number: string): Promise<{ title: string; body: string; scripts: string[] } | null> {
  const found = await sc.deps.db.query('select id from orders where number = $1 and customer_id = $2', [number.toUpperCase(), sc.customer!.id]);
  const id = found.rows[0]?.id;
  if (!id) return null;
  const view = await orderView(sc.deps.db, Number(id), sc.now, 'customer');
  return { title: `Order ${view.number}`, scripts: stripeFor(view), body: accountShell(sc, '/account/orders/', `Order ${view.number}`, orderDetail(sc, view, { token: null, canAct: true })) };
}

export async function addressesPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const list = await listAddresses(sc.deps, sc.customer!.id);
  const form = (a: (typeof list)[number] | null): string =>
    jsonForm(
      a ? `/api/account/addresses/${a.id}` : '/api/account/addresses',
      `<div class="fields fields--2">${field(`name-${a?.id ?? 'new'}`, 'Full name', 'autocomplete="name" data-key="name" required', a?.name ?? '')}${field(`phone-${a?.id ?? 'new'}`, 'Phone', 'type="tel" autocomplete="tel" data-key="phone" required', a?.phone ?? '')}</div>
${field(`line1-${a?.id ?? 'new'}`, 'Street address', 'autocomplete="address-line1" data-key="line1" required', a?.line1 ?? '')}${field(`line2-${a?.id ?? 'new'}`, 'Apartment, landmark (optional)', 'autocomplete="address-line2" data-key="line2"', a?.line2 ?? '')}
<div class="fields fields--2">${field(`city-${a?.id ?? 'new'}`, 'Town or city', 'autocomplete="address-level2" data-key="city" required', a?.city ?? '')}${field(`region-${a?.id ?? 'new'}`, 'State, county or province', 'autocomplete="address-level1" data-key="region"', a?.region ?? '')}</div>
<div class="fields fields--2">${field(`postal-${a?.id ?? 'new'}`, 'Postcode', 'autocomplete="postal-code" data-key="postalCode"', a?.postalCode ?? '')}<div class="field"><label class="field__label" for="country-${a?.id ?? 'new'}">Country</label><select class="field__input" id="country-${a?.id ?? 'new'}" data-key="country">${each(COUNTRIES, ([c, n]) => `<option value="${c}"${c === (a?.country ?? 'NG') ? ' selected' : ''}>${esc(n)}</option>`)}</select></div></div>
<label class="check"><input type="checkbox" data-key="isDefault"${a?.isDefault ? ' checked' : ''}><span>Use as my default address</span></label>${formEnd(a ? 'Save changes' : 'Add address')}`,
      { reload: true },
    );
  return {
    title: 'Your addresses',
    body: accountShell(
      sc,
      '/account/addresses/',
      'Addresses',
      `${each(list, (a) => `<details class="card stack"><summary class="row row--between"><span><span class="strong">${esc(a.name)}</span>${a.isDefault ? ' <span class="tag">Default</span>' : ''}<br><span class="small muted">${esc(a.line1)}, ${esc(a.city)}, ${esc(a.country)}</span></span><span class="link small">Change</span></summary>${form(a)}<button class="btn btn--text small" type="button" data-delete-address="${a.id}">Remove this address</button></details>`)}
${card(form(null), { title: 'Add an address' })}`,
    ),
  };
}

export async function profilePage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const p = await readProfile(sc.deps, sc.customer!.id);
  return {
    title: 'Your details',
    body: accountShell(
      sc,
      '/account/profile/',
      'Details and password',
      `${card(jsonForm('/api/account/profile', `<p class="small muted">Signed in as ${esc(p.email)}</p><div class="fields fields--2">${field('firstName', 'First name', 'autocomplete="given-name" required', p.firstName)}${field('lastName', 'Last name', 'autocomplete="family-name"', p.lastName)}</div>${field('phone', 'Phone', 'type="tel" autocomplete="tel"', p.phone ?? '')}${field('birthday', 'Birthday (optional)', 'type="date" autocomplete="bday"', p.birthday ?? '', 'We send you a treat on your birthday.')}${formEnd('Save details')}`, { reload: true }), { title: 'Your details' })}
${card(jsonForm('/api/account/password', `${p.hasPassword ? field('currentPassword', 'Current password', 'type="password" autocomplete="current-password" required') : '<p class="small muted">You sign in with Google or Apple. You can add a password too.</p>'}${field('newPassword', 'New password', 'type="password" autocomplete="new-password" minlength="10" required', '', 'At least 10 characters. Other devices are signed out.')}${formEnd('Change password')}`, {}), { title: 'Password' })}
${card(`<p class="muted">Closing your account removes your details, addresses and wishlist. Past orders are kept for our records without your name.</p>${jsonForm('/api/account/delete', `${p.hasPassword ? field('password', 'Your password', 'type="password" autocomplete="current-password" required') : '<label class="check"><input type="checkbox" name="confirm"><span>I want to close my account</span></label>'}${formEnd('Close my account')}`, { next: '/', confirm: 'Close your account for good?' })}`, { title: 'Close your account' })}`,
    ),
  };
}

export async function preferencesPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const p = await readPreferences(sc.deps.db, sc.customer!.id);
  const box = (key: keyof typeof p, label: string, help: string): string => `<label class="check"><input type="checkbox" name="${key}"${p[key] ? ' checked' : ''} data-bool><span>${esc(label)}<br><span class="small muted">${esc(help)}</span></span></label>`;
  return {
    title: 'Email and notifications',
    body: accountShell(sc, '/account/preferences/', 'Email and notifications', card(jsonForm('/api/account/notifications', `<fieldset class="stack stack--sm"><legend class="strong">Your orders</legend>${box('ordersEmail', 'Delivery updates by email', 'Payment received, on its way, delivered. Order confirmations always come.')}${box('ordersPush', 'Delivery updates on the app', 'If you use the hairbydemj app.')}</fieldset>
<fieldset class="stack stack--sm"><legend class="strong">Offers</legend>${box('offersEmail', 'New arrivals and offers by email', 'A few emails a month. Stop at any time.')}${box('offersPush', 'Offers on the app', '')}</fieldset>
<fieldset class="stack stack--sm"><legend class="strong">Back in stock</legend>${box('backInStockEmail', 'Tell me by email', 'When something you asked about is back.')}${box('backInStockPush', 'Tell me on the app', '')}</fieldset>${formEnd('Save choices')}`, {}))),
  };
}

export async function wishlistPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const items = await listWishlist(sc.deps, sc.customer!.id, sc.currency.code);
  return {
    title: 'Your wishlist',
    body: accountShell(sc, '/account/wishlist/', 'Wishlist', items.length ? `<div class="grid" style="--cols:3;--cols-tablet:2;--cols-phone:2">${each(items, (i) => `<article class="product-card product-card--panel"><a class="product-card__media" href="/products/${esc(i.slug)}/">${picture(i.image as never, { alt: i.name, ratio: '4 / 5' })}</a><div class="product-card__body"><a class="product-card__name" href="/products/${esc(i.slug)}/">${esc(i.name)}</a><span class="price">${i.priceFromMinor === null ? '' : esc(money(sc, i.priceFromMinor))}</span>${i.inStock ? '' : '<span class="small muted">Sold out</span>'}<button class="btn btn--text small" type="button" data-unwish="${i.productId}">Remove</button></div></article>`)}</div>` : card(`<p class="muted">Tap ${icon('heart', 16)} on a product to keep it here.</p>${button('Start shopping', { href: '/' })}`)),
  };
}

export function trackOrderForm(error = ''): string {
  return `<div class="narrow stack"><h1 class="h1">Track your order</h1><p class="muted">Enter your order number and the email you used at checkout.</p>
<form class="stack" method="post" action="/track-order/">${field('number', 'Order number', 'placeholder="HBD-10001" required autocomplete="off"')}${field('email', 'Email', 'type="email" autocomplete="email" required')}${error ? `<p class="small" role="alert" style="color:var(--error)">${esc(error)}</p>` : ''}${button('Find my order', { type: 'submit', fullPhone: true })}</form>
<p class="small muted">Have an account? <a class="link" href="/account/orders/">See your orders</a>.</p></div>`;
}

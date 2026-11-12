// The bag, the mini-bag panel, checkout and the page customers come back to
// after paying.

import { readCart, type Cart } from '../../cart/cart.js';
import { cartOwner } from '../../cart/routes.js';
import { NIGERIAN_STATES } from '../../shipping/shipping.js';
import { button, card, icon } from '../components.js';
import { each, esc } from '../html.js';
import { money, picture, type SiteContext } from './view.js';

/** Every country by its two-letter code, named in English. */
const CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const COUNTRIES: ReadonlyArray<[code: string, name: string]> = CODES.map((c): [string, string] => [c, names.of(c) ?? c]).sort((a, b) => a[1].localeCompare(b[1]));

async function cartFor(sc: SiteContext): Promise<Cart> {
  return (await readCart(sc.deps, await cartOwner(sc.deps, sc.ctx, 'cookie'), sc.currency.code)).cart;
}

const PROBLEMS: Record<string, string> = {
  unavailable: 'No longer available. Remove it to check out.',
  no_price: `Not sold in this currency. Remove it or change currency.`,
  sold_out: 'Sold out. Remove it to check out.',
  not_enough_stock: 'Fewer left than you asked for. Lower the quantity.',
};

function lineHtml(sc: SiteContext, l: Cart['lines'][number], compact: boolean): string {
  return `<div class="row row--top row--nowrap" data-line="${l.id}">${picture(l.image, { alt: l.name, sizes: compact ? '72px' : '96px', className: 'photo--thumb', ratio: '1 / 1' })}
<div class="stack stack--sm grow"><a class="strong" href="/products/${esc(l.slug)}/">${esc(l.name)}</a>${l.description ? `<span class="small muted">${esc(l.description)}</span>` : ''}
${l.problem ? `<p class="small" style="color:var(--error)">${icon('warning', 16)} ${esc(PROBLEMS[l.problem] ?? '')}${l.problem === 'not_enough_stock' ? ` Only ${l.available} left.` : ''}</p>` : ''}
<div class="row row--between"><label class="row small" style="gap:8px">Qty <input class="field__input" style="width:72px;min-height:40px" type="number" min="1" max="20" inputmode="numeric" value="${l.quantity}" data-qty="${l.id}" aria-label="Quantity of ${esc(l.name)}"></label><span class="strong">${l.unitMinor === null ? '' : esc(money(sc, l.lineMinor || l.unitMinor * l.quantity))}</span></div>
<button class="btn btn--text small" type="button" style="min-height:32px;padding:0;justify-content:flex-start" data-remove="${l.id}">Remove</button></div></div>`;
}

function summary(sc: SiteContext, cart: Cart, o: { cta?: boolean; shipping?: string } = {}): string {
  return card(
    `${each(cart.discounts, (d) => `<div class="kv"><span>${esc(d.name)}${d.code ? ` (${esc(d.code)})` : ''}</span><span>${d.freeShipping ? 'Free delivery' : `−${esc(money(sc, d.amountMinor))}`}</span></div>`)}
<div class="kv"><span>Subtotal</span><span>${esc(money(sc, cart.subtotalMinor))}</span></div>
${cart.discountMinor ? `<div class="kv"><span>Discounts</span><span>−${esc(money(sc, cart.discountMinor))}</span></div>` : ''}
<div class="kv"><span>Delivery</span><span data-summary-shipping>${esc(o.shipping ?? 'Worked out at checkout')}</span></div>
${cart.giftCardMinor ? `<div class="kv"><span>Gift cards</span><span>−${esc(money(sc, cart.giftCardMinor))}</span></div>` : ''}
<hr class="divider"><div class="kv strong"><span>Total</span><span class="price" data-summary-total data-base-total="${cart.subtotalMinor - cart.discountMinor}" data-gift="${cart.giftCardMinor}">${esc(money(sc, cart.totalMinor))}</span></div>
<p class="small muted">Import duties and taxes, if your country charges them, are paid on delivery.</p>
${o.cta ? (cart.canCheckout ? button('Go to checkout', { href: '/checkout/', full: true }) : '<p class="small">Sort out the items marked above to check out.</p>') : ''}`,
    { title: 'Order summary' },
  );
}

export async function miniCartHtml(sc: SiteContext): Promise<{ html: string; count: number }> {
  const cart = await cartFor(sc);
  if (cart.lines.length === 0) return { html: '<p class="muted">Your bag is empty.</p>', count: 0 };
  return {
    html: `${each(cart.lines, (l) => `${lineHtml(sc, l, true)}<hr class="divider">`)}<div class="kv strong"><span>Subtotal</span><span class="price">${esc(money(sc, cart.subtotalMinor - cart.discountMinor))}</span></div><p class="small muted">Delivery is worked out at checkout.</p>`,
    count: cart.itemCount,
  };
}

export async function cartPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const cart = await cartFor(sc);
  if (cart.lines.length === 0) {
    return { title: 'Your bag', body: `<h1 class="h1">Your bag</h1>${card(`<p class="muted">Your bag is empty.</p>${button('Start shopping', { href: '/' })}`)}` };
  }
  const code = cart.code;
  return {
    title: 'Your bag',
    body: `<h1 class="h1">Your bag (${cart.itemCount})</h1>
<div class="split"><div class="stack" data-cart>${each(cart.lines, (l) => `${lineHtml(sc, l, false)}<hr class="divider">`)}
<form class="row row--nowrap" style="align-items:flex-end" data-code-form novalidate><div class="field grow"><label class="field__label" for="code">Discount code</label><input class="field__input" id="code" name="code" autocomplete="off" value="${esc(code?.code ?? '')}"></div>${button(code ? 'Change' : 'Apply', { kind: 'secondary', type: 'submit' })}</form>
${code ? `<p class="small" role="status">${esc(code.message ?? (code.applied ? 'Code applied.' : ''))}${code ? ` <button class="btn btn--text small" type="button" data-remove-code style="min-height:32px">Remove code</button>` : ''}</p>` : ''}
<form class="row row--nowrap" style="align-items:flex-end" data-gift-form novalidate><div class="field grow"><label class="field__label" for="gift">Gift card code</label><input class="field__input" id="gift" name="code" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX"></div>${button('Use', { kind: 'secondary', type: 'submit' })}</form>
${each(cart.giftCards, (g) => `<p class="small">Gift card ending ${esc(g.last4)}: ${g.problem ? esc(g.problem) : `${esc(money(sc, g.appliedMinor))} used, ${esc(money(sc, g.balanceMinor))} on the card`} <button class="btn btn--text small" type="button" data-remove-gift="${g.id}" style="min-height:32px">Remove</button></p>`)}
<p class="small" role="alert" data-cart-error></p>
</div>${summary(sc, cart, { cta: true })}</div>`,
  };
}

export async function checkoutPage(sc: SiteContext): Promise<{ title: string; body: string; scripts: string[] }> {
  const cart = await cartFor(sc);
  if (cart.lines.length === 0 || !cart.canCheckout) {
    return { title: 'Checkout', scripts: [], body: `<h1 class="h1">Checkout</h1>${card(`<p class="muted">${cart.lines.length ? 'Some items in your bag need attention first.' : 'Your bag is empty.'}</p>${button(cart.lines.length ? 'Back to your bag' : 'Start shopping', { href: cart.lines.length ? '/cart/' : '/' })}`)}` };
  }
  let saved: Array<Record<string, unknown>> = [];
  let email = '';
  let phone = '';
  let name = '';
  if (sc.customer) {
    saved = (await sc.deps.db.query('select id, full_name, phone, line1, line2, city, region, postal_code, country, is_default from addresses where customer_id = $1 order by is_default desc, id', [sc.customer.id])).rows;
    const me = (await sc.deps.db.query('select email, phone, first_name, last_name from customers where id = $1', [sc.customer.id])).rows[0];
    email = String(me?.email ?? '');
    phone = String(me?.phone ?? '');
    name = `${String(me?.first_name ?? '')} ${String(me?.last_name ?? '')}`.trim();
  }
  const first = saved[0];
  const value = (k: string, fallback = ''): string => (first ? String(first[k] ?? '') : fallback);
  const country = value('country', sc.currency.code === 'GBP' ? 'GB' : sc.currency.code === 'USD' ? 'US' : sc.currency.code === 'EUR' ? 'DE' : 'NG');
  const stripe = sc.currency.code !== 'NGN';
  const step = (n: number, title: string, inner: string): string => `<section class="stack" data-step="${n}"${n === 1 ? '' : ' hidden'} aria-labelledby="step-${n}-h"><h2 class="h3" id="step-${n}-h" tabindex="-1">${n}. ${esc(title)}</h2>${inner}</section>`;
  const fieldHtml = (id: string, label: string, attrs: string, val = '', help = ''): string => `<div class="field"><label class="field__label" for="${id}">${esc(label)}</label><input class="field__input" id="${id}" name="${id}" ${attrs} value="${esc(val)}">${help ? `<p class="field__help">${esc(help)}</p>` : ''}<p class="field__error" data-error-for="${id}" hidden></p></div>`;
  return {
    title: 'Checkout',
    scripts: stripe ? ['https://js.stripe.com/v3/'] : [],
    body: `<h1 class="h1">Checkout</h1>
<ol class="steps" aria-label="Checkout steps">${each(['Contact', 'Address', 'Delivery', 'Review and pay'], (s, i) => `<li data-step-label="${i + 1}"${i === 0 ? ' aria-current="step"' : ''}>${i + 1}. ${esc(s)}</li>`)}</ol>
<div class="split"><form class="stack stack--lg" data-checkout data-currency="${esc(sc.currency.code)}" data-provider="${stripe ? 'stripe' : 'paystack'}" novalidate>
${step(1, 'Contact', `${fieldHtml('email', 'Email', 'type="email" autocomplete="email" required', email, 'We send your order updates here.')}${fieldHtml('phone', 'Phone', 'type="tel" autocomplete="tel" required', phone || value('phone'), 'The courier calls this number on delivery.')}${sc.customer ? '' : '<p class="small">Have an account? <a class="link" href="/sign-in/?next=/checkout/">Sign in</a> for a faster checkout.</p>'}${button('Continue to address', { attrs: 'data-next="2"', fullPhone: true })}`)}
${step(2, 'Address', `${saved.length ? `<fieldset class="stack stack--sm"><legend class="strong small">Saved addresses</legend>${each(saved, (a, i) => `<label class="check"><input type="radio" name="saved" value="${esc(String(a.id))}"${i === 0 ? ' checked' : ''} data-saved='${esc(JSON.stringify({ name: a.full_name, phone: a.phone, line1: a.line1, line2: a.line2 ?? '', city: a.city, region: a.region ?? '', postalCode: a.postal_code ?? '', country: a.country }))}'><span>${esc(String(a.full_name))}, ${esc(String(a.line1))}, ${esc(String(a.city))}</span></label>`)}<label class="check"><input type="radio" name="saved" value="new"><span>A new address</span></label></fieldset>` : ''}
<div class="fields fields--2">${fieldHtml('name', 'Full name', 'autocomplete="name" required', value('full_name', name))}<div class="field"><label class="field__label" for="country">Country</label><select class="field__input" id="country" name="country" autocomplete="country">${each(COUNTRIES, ([c, n]) => `<option value="${c}"${c === country ? ' selected' : ''}>${esc(n)}</option>`)}</select></div></div>
${fieldHtml('line1', 'Street address', 'autocomplete="address-line1" required', value('line1'))}
${fieldHtml('line2', 'Apartment, landmark (optional)', 'autocomplete="address-line2"', value('line2'))}
<div class="fields fields--2">${fieldHtml('city', 'Town or city', 'autocomplete="address-level2" required', value('city'))}
<div class="field" data-region-ng${country === 'NG' ? '' : ' hidden'}><label class="field__label" for="state">State</label><select class="field__input" id="state" name="state">${each(NIGERIAN_STATES, (s) => `<option${s === value('region') ? ' selected' : ''}>${esc(s)}</option>`)}</select></div>
<div class="field" data-region-other${country === 'NG' ? ' hidden' : ''}><label class="field__label" for="region">State, county or province</label><input class="field__input" id="region" name="region" autocomplete="address-level1" value="${esc(country === 'NG' ? '' : value('region'))}"></div></div>
${fieldHtml('postalCode', 'Postcode', 'autocomplete="postal-code"', value('postal_code'), 'Needed for most countries outside Nigeria.')}
${sc.customer ? '<label class="check"><input type="checkbox" name="saveAddress"><span>Save this address to my account</span></label>' : ''}
${button('See delivery options', { attrs: 'data-next="3"', fullPhone: true })}`)}
${step(3, 'Delivery', `<div class="stack stack--sm" data-options aria-live="polite"><p class="muted">Delivery options appear here.</p></div><p class="small muted" data-duties hidden></p>${button('Review your order', { attrs: 'data-next="4"', fullPhone: true })}`)}
${step(4, 'Review and pay', `<div class="card card--outline stack stack--sm" data-review></div>
<div class="field"><label class="field__label" for="note">Note for us (optional)</label><textarea class="field__input" id="note" name="note" rows="3" maxlength="500"></textarea></div>
<p class="small muted">${stripe ? 'You pay by card, Apple Pay or Google Pay through Stripe.' : 'You pay by card, bank transfer or USSD through Paystack.'} By paying you agree to the <a class="link" href="/terms/">terms</a> and the <a class="link" href="/returns/">returns policy</a>.</p>
<div data-stripe-element hidden></div>
${button('Place order and pay', { type: 'submit', fullPhone: true, attrs: 'data-pay' })}`)}
<p class="small" role="alert" data-checkout-error></p>
</form>
<div class="stack">${card(each(cart.lines, (l) => `<div class="row row--top row--nowrap">${picture(l.image, { alt: l.name, sizes: '56px', className: 'photo--thumb', ratio: '1 / 1' })}<div class="stack stack--xs grow"><span class="strong small">${esc(l.name)}</span><span class="small muted">${esc(l.description)} · Qty ${l.quantity}</span></div><span class="strong small">${esc(money(sc, l.lineMinor))}</span></div>`), { title: 'Your items' })}${summary(sc, cart)}</div></div>`,
  };
}

export function completePage(sc: SiteContext): { title: string; body: string } {
  const number = (sc.ctx.query.get('order') ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
  return {
    title: 'Your order',
    body: `<div class="stack center narrow" style="align-items:center;padding:32px 0" data-complete="${esc(number)}">
<div data-state="waiting"><h1 class="h1">Checking your payment…</h1><p class="muted">This takes a few seconds. Please keep this page open.</p></div>
<div data-state="paid" hidden><span style="color:var(--gold)">${icon('check', 40)}</span><h1 class="h1">Thank you. Your order is confirmed.</h1><p class="muted">Order ${esc(number)}. A confirmation is on its way to your email.</p>${button('See your order', { href: '#', attrs: 'data-order-link' })}${button('Continue shopping', { kind: 'secondary', href: '/' })}</div>
<div data-state="failed" hidden><span style="color:var(--error)">${icon('warning', 40)}</span><h1 class="h1">Your payment did not go through</h1><p class="muted" data-failure>Nothing was charged.</p><p class="muted">Your items are kept for 30 minutes.</p>${button('Try again', { attrs: 'data-retry' })}<p class="small muted">Need help? <a class="link" href="/contact/">Contact us</a>.</p></div>
<div data-state="slow" hidden><h1 class="h1">Still checking</h1><p class="muted">Your bank has not confirmed yet. We will email you as soon as it does. You can close this page.</p>${button('See your order', { href: '#', attrs: 'data-order-link' })}</div>
</div>`,
  };
}

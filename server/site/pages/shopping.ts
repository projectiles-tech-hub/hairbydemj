// Shopping pages: home, category, search, product, shop the look, try-on,
// cart, checkout, order confirmation, payment failed and gift cards.

import {
  accordion,
  button,
  card,
  check,
  chipGroup,
  chipLinks,
  divider,
  field,
  icon,
  kv,
  listLoader,
  photo,
  productGrid,
  rating,
  sectionHead,
  stepper,
} from '../components.js';
import { each, esc } from '../html.js';
import { CATEGORIES, naira, sampleProducts, type Product } from '../sample-data.js';

const SAMPLE_REVIEW = 'Sample review. Real customer reviews show here once the store is live.';

export function orderSummary(o: { button?: string; note?: boolean } = {}): string {
  const items = sampleProducts(3).filter((_, i) => i !== 1);
  const subtotal = items.reduce((sum, p) => sum + p.priceMinor, 0);
  return card(
    each(
      items,
      (p) =>
        `<div class="row row--top row--nowrap">${photo(p.name, { thumb: 56 })}<div class="stack stack--xs grow"><span class="strong small">${esc(p.name)}</span><span class="small muted">${esc(p.details)} · Qty 1</span></div><span class="strong small">${naira(p.priceMinor)}</span></div>`,
    ) +
      divider() +
      kv('Subtotal', naira(subtotal)) +
      kv('Shipping', 'At shipping step') +
      kv('Duties and taxes', 'Paid on delivery') +
      divider() +
      kv('Total', naira(subtotal), { strong: true, price: true }) +
      (o.button ? button(o.button, { href: '/checkout/', full: true }) : '') +
      (o.note ? '<p class="small muted">Pay securely with Paystack or Stripe</p>' : ''),
    { title: 'Order summary' },
  );
}

export function home(): string {
  const products = sampleProducts(8);
  return `
<section class="hero" aria-labelledby="hero-h">
${photo('Campaign photo: one model, one style, lit against black')}
<div class="hero__copy"><h1 class="display" id="hero-h">Hair that moves the way you do</h1>
<p class="body-large">Human hair wigs, bundles and closures. Sent from Benin City to your door, anywhere in the world.</p>
<div class="row">${button('Shop new arrivals', { href: '/wigs/', fullPhone: true })}${button('Try a wig on with your camera', { kind: 'text', href: '/try-on/', fullPhone: true })}</div></div>
</section>
<section class="stack" aria-label="Shop by collection">${sectionHead('Shop by collection', ['View all', '/wigs/'])}
<div class="grid" style="--cols:4;--cols-tablet:4;--cols-phone:2">${each(CATEGORIES, (c) => `<a class="stack stack--sm" href="/wigs/" style="text-decoration:none">${photo(c, { ratio: '4 / 3' })}<span class="strong">${esc(c)}</span></a>`)}</div></section>
<section class="stack" aria-label="Best-sellers">${sectionHead('Best-sellers', ['View all', '/wigs/'])}${productGrid(products.slice(0, 4), { panel: true })}</section>
<section class="stack" aria-label="New arrivals">${sectionHead('New arrivals', ['View all', '/wigs/'])}${productGrid(products.slice(4, 8), { panel: true })}</section>
<section class="stack" aria-label="Shop the look">${sectionHead('Shop the look', ['See all looks', '/shop-the-look/'])}
<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">${[1, 2]
    .map(
      () =>
        `<div class="grid" style="--cols:2;--cols-tablet:1;--cols-phone:1;gap:16px">${photo('Look photo', { ratio: '4 / 5' })}<div class="stack"><h3 class="h3">Look name</h3><p class="muted">Wig, closure and care set chosen to be worn together.</p><p class="strong">3 items · ${naira(38500000)}</p>${button('Add the set to bag', { fullPhone: true, attrs: 'data-open="mini-cart"' })}</div></div>`,
    )
    .join('')}</div></section>
<section class="stack" aria-label="What customers say">${sectionHead('What customers say')}
<div class="grid" style="--cols:3;--cols-tablet:3;--cols-phone:1">${[1, 2, 3].map(() => card(rating(5, '5 out of 5') + `<p class="muted">${SAMPLE_REVIEW}</p><p class="small muted">Customer name, City</p>`)).join('')}</div></section>`;
}

const FILTERS: ReadonlyArray<[string, readonly string[], readonly string[]]> = [
  ['Texture', ['Straight', 'Body wave', 'Deep wave', 'Curly', 'Kinky'], ['Body wave']],
  ['Length', ['12"', '14"', '16"', '18"', '20"', '22"', '24"', '26"'], ['22"']],
  ['Lace type', ['HD', 'Transparent', 'Closure', 'Frontal', 'Full lace'], []],
  ['Colour', ['Natural black', '1B/27', '613', 'Burgundy'], []],
  ['Origin', ['Vietnamese', 'Cambodian', 'Peruvian', 'Brazilian'], []],
];

export function filterControls(prefix: string): string {
  return (
    each(FILTERS, ([name, options, selected]) => chipGroup(`${prefix}-${name}`, options, { type: 'checkbox', selected, legend: name })) +
    `<fieldset class="stack stack--sm"><legend class="strong small" style="margin-bottom:8px">Price</legend><div class="fields fields--2">${field('From', { value: '₦0', inputmode: 'numeric', id: `${prefix}-from` })}${field('To', { value: '₦500,000', inputmode: 'numeric', id: `${prefix}-to` })}</div></fieldset>`
  );
}

function listing(title: string, crumb: string, products: readonly Product[], total: number): string {
  return `
<p class="small muted">${crumb}</p>
<div class="row row--between"><h1 class="h1">${esc(title)}</h1>
<div class="field not-phone" style="flex-direction:row;align-items:center;gap:12px"><label class="small" for="sort">Sort by</label><select class="field__input" id="sort" style="width:auto;min-height:44px"><option>Featured</option><option>Newest</option><option>Price: low to high</option><option>Price: high to low</option><option>Best reviewed</option></select></div></div>
<div class="with-filters">
<form class="filters-side" aria-label="Filters">${filterControls('side')}</form>
<div class="stack stack--lg">
<div class="chips"><button class="chip chip--on filter-open" type="button" data-open="filters" aria-controls="filters">${icon('filter', 16)} Filter (2)</button>
<label class="chip only-phone"><span>Sort: Featured ${icon('chevronDown', 16)}</span></label>
<a class="chip chip--on" href="#">Body wave ${icon('close', 16)}</a><a class="chip chip--on" href="#">22" ${icon('close', 16)}</a><a class="chip" href="#">Clear all</a></div>
${productGrid(products, { cols: 3, colsTablet: 3, colsPhone: 2, id: 'product-list' })}
<p class="small muted" data-count>Showing ${products.length} of ${total}</p>
<div data-endless data-total="${total}" data-batch="12" data-target="product-list">${listLoader(total, 'products')}</div>
</div></div>`;
}

export function filtersPanel(): string {
  return `<div class="panel panel--sheet" id="filters" role="dialog" aria-modal="true" aria-labelledby="filters-h" data-panel>
<div class="panel__head"><h2 class="h3" id="filters-h">Filters</h2><div class="row"><a class="link small" href="#">Clear all</a><button class="icon-btn" type="button" data-close aria-label="Close the filters">${icon('close')}</button></div></div>
<form class="panel__body">${filterControls('panel')}</form>
<div class="panel__foot">${button('Show 23 products', { full: true, attrs: 'data-close' })}</div></div>`;
}

export function category(): string {
  return listing('Wigs (48)', 'Home › Wigs', sampleProducts(12), 48);
}

export function search(): string {
  return (
    `<p class="small muted">Home › Search</p><h1 class="h1">48 results for "body wave"</h1>` +
    chipLinks([['Wigs (30)', '#', true], ['Bundles (12)', '#'], ['Closures (6)', '#']]) +
    productGrid(sampleProducts(8), { cols: 4, colsTablet: 3, colsPhone: 2, id: 'product-list' }) +
    `<div data-endless data-total="48" data-batch="12" data-target="product-list">${listLoader(48, 'products')}</div>` +
    card(
      `<p class="muted">Did you mean body wave? Check the spelling, try fewer words, or browse the categories.</p>` +
        chipLinks(CATEGORIES.map((c) => [c, '/wigs/'] as [string, string])),
      { title: 'No results for "bdy wvae"' },
    ) +
    `<section class="stack">${sectionHead('Best-sellers')}${productGrid(sampleProducts(4), { panel: true })}</section>`
  );
}

export function product(): string {
  const p = sampleProducts(1)[0] as Product;
  const options: ReadonlyArray<[string, readonly string[], string]> = [
    ['Length', ['14"', '16"', '18"', '20"', '22"', '24"', '26"'], '22"'],
    ['Density', ['150%', '180%', '200%'], '180%'],
    ['Lace', ['HD lace', 'Transparent'], 'HD lace'],
    ['Colour', ['Natural black', '1B/27', '613'], 'Natural black'],
  ];
  return `
<p class="small muted">Home › Wigs › ${esc(p.name)}</p>
<div class="split split--media">
<div class="stack stack--sm">${photo('Product photo or video · 1 of 6')}<div class="thumbs">${[1, 2, 3, 4].map((i) => photo(`Photo ${i}`, { thumb: 72 })).join('')}</div></div>
<form class="stack" action="/cart/">
<h1 class="h1">${esc(p.name)}</h1>
${rating(4.8, '4.8 out of 5 (120 reviews)')}
<p class="price" style="font-size:24px;line-height:32px">${naira(p.priceMinor)}</p>
${each(options, ([name, list, selected]) => chipGroup(`opt-${name}`, list, { selected: [selected], legend: name }))}
<p class="small muted">In stock · Delivery to Lagos in 2 to 4 days</p>
<div class="row">${stepper('quantity')}${button('Add to bag', { attrs: 'data-open="mini-cart" style="flex:1"' })}</div>
${button('Save to wishlist', { kind: 'secondary', icon: 'heart', full: true })}
${button('Try it on with your camera', { kind: 'secondary', icon: 'camera', href: '/try-on/', full: true })}
<div>${accordion('Description', '<p>Soft, full bone straight hair on an HD lace front. Sample description.</p>')}${accordion('Hair details', '<p>Texture, origin, lace size, cap size and what is in the box.</p>')}${accordion('Care guide', '<p>How to wash, dry, style and store the hair so it lasts.</p>')}${accordion('Shipping and returns', '<p>Sent with DHL, UPS or FedEx. Import duties and taxes are paid by you on delivery. Unworn items can be returned within 14 days.</p>')}</div>
</form></div>
<section class="stack">${sectionHead('Complete the set')}${productGrid(sampleProducts(5).slice(1), {})}</section>
<section class="stack">${sectionHead('Reviews (120)', ['Write a review', '/account/reviews/'])}
<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">${[1, 2]
    .map(() => `<div class="stack stack--sm">${rating(5, '5 out of 5 · Customer name · Verified buyer')}<p class="muted">${SAMPLE_REVIEW}</p><div class="row">${[1, 2, 3].map((i) => photo(`Customer photo ${i}`, { thumb: 64 })).join('')}</div></div>`)
    .join('')}</div></section>
<div class="sticky-bar"><span class="price">${naira(p.priceMinor)}</span>${button('Add to bag', { attrs: 'data-open="mini-cart" style="flex:1"' })}</div>`;
}

export function shopTheLook(): string {
  const items = sampleProducts(3);
  return (
    `<h1 class="h1">Shop the look</h1>` +
    [1, 2]
      .map(
        () =>
          `<section class="split" style="--side:520px;--side-tablet:320px">${photo('Look photo', { ratio: '4 / 5' })}<div class="stack"><h2 class="h3">Look name</h2><p class="muted">Wig, closure and care set chosen to be worn together.</p>` +
          each(
            items,
            (p) => `<div class="row row--top row--nowrap">${photo(p.name, { thumb: 56 })}<div class="stack stack--xs grow"><span class="strong small">${esc(p.name)}</span><span class="small muted">${esc(p.details)} · ${naira(p.priceMinor)}</span></div></div>`,
          ) +
          kv('Set total', naira(items.reduce((s, p) => s + p.priceMinor, 0)), { strong: true, price: true }) +
          button('Add the set to bag', { full: true, attrs: 'data-open="mini-cart"' }) +
          `</div></section>`,
      )
      .join('')
  );
}

export function tryOn(): string {
  return `<h1 class="h1">Try it on</h1>
<div class="split" style="--side:320px;--side-tablet:280px">
<div class="stack">${photo('Live camera view', { ratio: '4 / 5' })}<div class="row">${button('Add to bag', { fullPhone: true, attrs: 'data-open="mini-cart"' })}${button('Save photo', { kind: 'secondary', fullPhone: true })}</div></div>
<div class="stack"><h2 class="strong">Styles</h2><div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:2;gap:8px">${[1, 2, 3, 4].map((i) => `<div class="stack stack--xs">${photo(`Style ${i}`, { ratio: '1 / 1' })}<span class="small">Style name</span></div>`).join('')}</div>
${chipGroup('try-colour', ['Natural black', '1B/27', '613', 'Burgundy'], { selected: ['Natural black'], legend: 'Colour' })}
${card(`<p class="small muted">Allow the camera in your browser settings, or upload a photo of yourself instead. The picture stays on your device.</p>${button('Upload a photo', { kind: 'secondary', full: true })}`, { title: 'Camera not allowed' })}</div></div>`;
}

export function cart(): string {
  const items = sampleProducts(3).filter((_, i) => i !== 1);
  return `<h1 class="h1">Your bag (${items.length})</h1>
<div class="split">
<div class="stack">${each(
    items,
    (p) =>
      `<div class="row row--top row--nowrap">${photo(p.name, { thumb: 96 })}<div class="stack stack--sm grow"><span class="strong">${esc(p.name)}</span><span class="small muted">${esc(p.details)} · Natural black</span><div class="row row--between">${stepper('quantity of ' + p.name)}<span class="strong">${naira(p.priceMinor)}</span></div><p class="small"><a class="link" href="#">Save for later</a> · <a class="link" href="#">Remove</a></p></div></div>${divider()}`,
  )}
<form class="row row--nowrap" style="align-items:flex-end" action="#"><div class="grow">${field('Discount or gift card code')}</div>${button('Apply', { kind: 'secondary', type: 'submit' })}</form></div>
${orderSummary({ button: 'Go to checkout', note: true })}</div>
<section class="stack">${sectionHead('You may also like')}${productGrid(sampleProducts(8).slice(4), {})}</section>`;
}

export function checkout(): string {
  const ship: ReadonlyArray<[string, string, number]> = [
    ['DHL Express', '1 to 3 days', 1850000],
    ['UPS Worldwide Saver', '3 to 5 days', 1420000],
    ['FedEx International Economy', '5 to 8 days', 1100000],
  ];
  const step = (n: number, title: string, body: string, open: boolean) =>
    `<section class="stack" data-step="${n}"${open ? '' : ' hidden'}><h2 class="h3">${n}. ${esc(title)}</h2>${body}</section>`;
  return `<h1 class="h1">Checkout</h1>
<ol class="steps" aria-label="Checkout steps">${['Contact', 'Address', 'Shipping', 'Payment', 'Review'].map((s, i) => `<li data-step-label="${i + 1}"${i === 0 ? ' aria-current="step"' : ''}>${i + 1}. ${s}</li>`).join('')}</ol>
<div class="split">
<form class="stack stack--lg" action="/order-confirmed/" data-checkout>
${step(1, 'Contact', field('Email', { type: 'email', autocomplete: 'email', value: 'you@example.com', help: 'We send your order updates here.' }) + field('Phone', { type: 'tel', autocomplete: 'tel', value: '+234 800 000 0000', help: 'The carrier calls this number on delivery.' }) + `<p class="small">Have an account? <a class="link" href="/sign-in/">Sign in</a> for a faster checkout.</p>` + button('Continue to address', { fullPhone: true, attrs: 'data-next' }), true)}
${step(2, 'Address', `<div class="fields fields--2">${field('Full name', { autocomplete: 'name' })}${field('Country', { options: ['Nigeria', 'Ghana', 'United Kingdom', 'United States', 'Canada', 'Germany', 'France'], value: 'Nigeria' })}</div>` + field('Street address', { autocomplete: 'address-line1' }) + field('Apartment, landmark (optional)', { autocomplete: 'address-line2' }) + `<div class="fields fields--2">${field('City', { autocomplete: 'address-level2' })}${field('State', { options: ['Lagos', 'Edo', 'Abuja (FCT)', 'Rivers'], value: 'Lagos' })}</div>` + button('Continue to shipping', { fullPhone: true, attrs: 'data-next' }), false)}
${step(3, 'Shipping option', each(ship, ([name, time, cost], i) => `<label class="card--select check"><input type="radio" name="ship"${i === 0 ? ' checked' : ''}><span class="stack stack--xs grow"><span class="strong">${name}</span><span class="small muted">${time}</span></span><span class="strong">${naira(cost)}</span></label>`) + `<p class="small muted">Import duties and taxes for your country are paid by you to the carrier on delivery. They are not included in this total.</p>` + button('Continue to payment', { fullPhone: true, attrs: 'data-next' }), false)}
${step(4, 'Payment', `<p class="muted">You pay in naira with Paystack. Customers paying in dollars, pounds or euros pay with Stripe.</p><div class="stack stack--sm">${check('Card', { type: 'radio', name: 'pay', checked: true })}${check('Bank transfer', { type: 'radio', name: 'pay' })}${check('USSD', { type: 'radio', name: 'pay' })}</div>` + card(`<p class="small muted">Secure form from Paystack</p>${field('Card number', { inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '0000 0000 0000 0000' })}<div class="fields fields--2">${field('Expiry', { placeholder: 'MM / YY', autocomplete: 'cc-exp' })}${field('Security code', { placeholder: 'CVV', autocomplete: 'cc-csc', inputmode: 'numeric' })}</div>`) + check('Save this card for next time') + button('Review your order', { fullPhone: true, attrs: 'data-next' }), false)}
${step(5, 'Review and pay', card(kv('Contact', 'you@example.com') + kv('Deliver to', '12 Street, Lagos, Nigeria') + kv('Shipping', 'DHL Express, 1 to 3 days') + kv('Payment', 'Card ending 1234'), { outline: true }) + `<p class="small muted">By paying you agree to the Terms and the Returns policy.</p>` + button(`Pay ${naira(38150000)}`, { type: 'submit', fullPhone: true }) + `<p class="small"><a class="link" href="/payment-failed/">See what happens if the payment fails</a></p>`, false)}
</form>
${orderSummary()}</div>`;
}

export function orderConfirmed(): string {
  return `<div class="stack center" style="align-items:center"><span style="color:var(--gold)">${icon('check', 40)}</span><h1 class="h1">Thank you. Your order is confirmed.</h1><p class="muted">Order HBD-10432 · A confirmation has been sent to you@example.com</p></div>
<div class="split"><div class="stack stack--lg">
<section class="stack stack--sm"><h2 class="h3">What happens next</h2><ol class="stack stack--sm" style="list-style:decimal;padding-left:20px"><li>We prepare your order (1 to 2 days).</li><li>We send you the tracking number by email and WhatsApp.</li><li>DHL Express delivers in 1 to 3 days. Duties and taxes are paid on delivery.</li></ol></section>
<section class="stack stack--sm"><h2 class="h3">Delivery</h2><p class="muted">Name · 12 Street, Lagos, Nigeria · +234 800 000 0000</p></section>
<div class="row">${button('Track your order', { href: '/account/orders/hbd-10432/', fullPhone: true })}${button('Continue shopping', { kind: 'secondary', href: '/', fullPhone: true })}</div>
${card(`<p class="muted">Create a password to track orders, earn points and check out faster.</p>${button('Create account', { kind: 'secondary', href: '/create-account/', fullPhone: true })}`, { title: 'Save your details for next time' })}
</div>${orderSummary()}</div>`;
}

export function paymentFailed(): string {
  return `<div class="stack center narrow" style="align-items:center;padding:32px 0"><span style="color:var(--error)">${icon('warning', 40)}</span><h1 class="h1">Your payment did not go through</h1>
<p class="muted">Your bank declined the card. Nothing was charged. Your items are kept for 30 minutes.</p>
${button('Try again', { href: '/checkout/', full: true })}${button('Use another payment method', { kind: 'secondary', href: '/checkout/', full: true })}
<p class="small muted">Need help? <a class="link" href="/contact/">Chat with us or message on WhatsApp.</a></p></div>`;
}

export function giftCards(): string {
  return `<h1 class="h1">Gift cards</h1>
<div class="split"><form class="stack" action="/cart/">${photo('Gift card design', { ratio: '16 / 9' })}
${chipGroup('gift-amount', ['₦25,000', '₦50,000', '₦100,000', '₦200,000', 'Other amount'], { selected: ['₦50,000'], legend: 'Amount' })}
<div class="fields fields--2">${field('Recipient name')}${field('Recipient email', { type: 'email' })}</div>${field('Message (optional)', { textarea: true })}${field('Send on', { options: ['Today', 'Choose a date'] })}
${button('Add gift card to bag', { fullPhone: true, attrs: 'data-open="mini-cart"' })}</form>
${card(field('Gift card code', { placeholder: 'XXXX-XXXX-XXXX' }) + button('Check balance', { kind: 'secondary', full: true }) + `<p class="strong small">Balance: ${naira(2000000)} · Expires 10 Nov 2027</p>`, { title: 'Check a balance' })}</div>`;
}

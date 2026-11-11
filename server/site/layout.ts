// The page shell shared by every website page: head, header, footer, and the
// panels that can open over any page (menu, mini-cart, cookie notice, chat).

import { button, check, chipGroup, icon, kv, photo, stepper } from './components.js';
import { each, esc } from './html.js';
import { naira, sampleProducts } from './sample-data.js';

export interface PageOptions {
  title: string;
  description?: string;
  /** Which main navigation item is current, if any. */
  nav?: string;
  body: string;
  /** Extra HTML placed after the main content, inside the page. */
  after?: string;
  /** True while the site is a design preview with sample data. */
  preview?: boolean;
}

const NAV: ReadonlyArray<[label: string, href: string]> = [
  ['Wigs', '/wigs/'],
  ['Bundles', '/wigs/'],
  ['Closures and frontals', '/wigs/'],
  ['Accessories', '/wigs/'],
  ['Guides', '/guides/'],
  ['Help', '/faq/'],
];

const FOOTER: ReadonlyArray<[title: string, links: ReadonlyArray<[string, string]>]> = [
  ['Shop', [['Wigs', '/wigs/'], ['Bundles', '/wigs/'], ['Closures and frontals', '/wigs/'], ['Accessories', '/wigs/'], ['Gift cards', '/gift-cards/']]],
  ['Help', [['Shipping and delivery', '/shipping/'], ['Returns and refunds', '/returns/'], ['Questions and answers', '/faq/'], ['Contact us', '/contact/'], ['Track an order', '/track-order/']]],
  ['About', [['Our story', '/about/'], ['Hair guides', '/guides/'], ['Length and density guide', '/guides/length-and-density/']]],
  ['Legal', [['Privacy', '/privacy/'], ['Terms', '/privacy/'], ['Cookies', '/privacy/']]],
];

function header(nav?: string): string {
  return `<header class="site-header"><div class="wrap site-header__in">
<button class="icon-btn only-compact" type="button" data-open="menu" aria-label="Open the menu" aria-controls="menu">${icon('menu')}</button>
<a class="site-header__logo" href="/" aria-label="hairbydemj home"><img src="/brand/wordmark.svg" alt="hairbydemj" width="170" height="34"></a>
<nav class="site-nav" aria-label="Main">${each(NAV, ([l, h]) => `<a href="${h}"${l === nav ? ' aria-current="page"' : ''}>${esc(l)}</a>`)}</nav>
<span class="spacer only-compact"></span>
<form class="site-header__search" action="/search/" role="search">${icon('search', 20)}<label class="visually-hidden" for="q">Search</label><input id="q" name="q" type="search" placeholder="Search"></form>
<a class="icon-btn only-compact" href="/search/" aria-label="Search">${icon('search')}</a>
<button class="currency only-desktop" type="button" aria-label="Currency: Nigerian naira. Change currency">NGN ${icon('chevronDown', 16)}</button>
<a class="icon-btn only-desktop" href="/account/" aria-label="Your account">${icon('account')}</a>
<a class="icon-btn only-desktop" href="/account/wishlist/" aria-label="Your wishlist">${icon('heart')}</a>
<button class="icon-btn" type="button" data-open="mini-cart" aria-controls="mini-cart" aria-label="Your bag, 2 items">${icon('bag')}<span class="bag-count" aria-hidden="true">2</span></button>
</div></header>`;
}

function footer(): string {
  return `<footer class="site-footer"><div class="wrap site-footer__in">
<div class="site-footer__brand stack stack--sm"><img src="/brand/monogram.svg" alt="hairbydemj" width="64" height="56"><p class="small muted">Hair you will love, delivered worldwide.</p></div>
<div class="site-footer__cols">${each(
    FOOTER,
    ([title, links]) =>
      `<details open><summary>${esc(title)}${icon('plus', 20)}</summary><ul>${each(links, ([l, h]) => `<li><a class="small" href="${h}">${esc(l)}</a></li>`)}</ul></details>`,
  )}</div>
<form class="stack stack--sm" action="/system/" aria-labelledby="news-h"><h2 class="h3" id="news-h" style="font:500 22px/30px var(--font-head);color:var(--ivory)">New arrivals and offers, by email</h2>
<div class="field"><label class="field__label" for="news-email">Email address</label><input class="field__input" id="news-email" type="email" autocomplete="email" placeholder="you@example.com"></div>
${button('Sign up', { type: 'submit', fullPhone: true })}</form>
<div class="site-footer__legal small muted"><span>© 2026 hairbydemj</span><span>Pay with Paystack or Stripe · Delivered by DHL, UPS and FedEx</span></div>
</div></footer>`;
}

function menuPanel(): string {
  const shop: ReadonlyArray<[string, string]> = [['Wigs', '/wigs/'], ['Bundles', '/wigs/'], ['Closures and frontals', '/wigs/'], ['Accessories', '/wigs/'], ['Shop the look', '/shop-the-look/'], ['Hair guides', '/guides/']];
  const more: ReadonlyArray<[string, string]> = [['Account', '/account/'], ['Wishlist', '/account/wishlist/'], ['Track an order', '/track-order/'], ['Help', '/faq/']];
  return `<div class="panel panel--left" id="menu" role="dialog" aria-modal="true" aria-label="Menu" data-panel>
<div class="panel__head"><img src="/brand/wordmark.svg" alt="hairbydemj" width="130" height="26" style="height:26px;width:auto"><button class="icon-btn" type="button" data-close aria-label="Close the menu">${icon('close')}</button></div>
<nav class="panel__body" aria-label="Menu" style="gap:0">${each(shop, ([l, h]) => `<a class="menu-link" href="${h}">${esc(l)}${icon('chevronRight', 20)}</a>`)}
<hr class="divider" style="margin:12px 0">${each(more, ([l, h]) => `<a class="menu-link menu-link--small" href="${h}">${esc(l)}</a>`)}
<hr class="divider" style="margin:12px 0">${chipGroup('currency', ['NGN ₦', 'USD $', 'GBP £', 'EUR €'], { selected: ['NGN ₦'], legend: 'Currency' })}</nav>
<div class="panel__foot">${button('Message us on WhatsApp', { kind: 'secondary', full: true, icon: 'whatsapp', href: '/contact/' })}</div></div>`;
}

function miniCart(): string {
  const items = sampleProducts(3).filter((_, i) => i !== 1);
  const subtotal = items.reduce((sum, p) => sum + p.priceMinor, 0);
  return `<div class="panel panel--right" id="mini-cart" role="dialog" aria-modal="true" aria-labelledby="mini-cart-h" data-panel>
<div class="panel__head"><h2 class="h3" id="mini-cart-h">Your bag (${items.length})</h2><button class="icon-btn" type="button" data-close aria-label="Close your bag">${icon('close')}</button></div>
<div class="panel__body">${each(
    items,
    (p) =>
      `<div class="row row--top row--nowrap">${photo(p.name, { thumb: 72 })}<div class="stack stack--sm grow"><span class="strong">${esc(p.name)}</span><span class="small muted">${esc(p.details)}</span>
<div class="row row--between">${stepper('quantity of ' + p.name)}<span class="strong">${naira(p.priceMinor)}</span></div><button class="btn btn--text small" type="button" style="min-height:32px;padding:0;justify-content:flex-start">Remove</button></div></div><hr class="divider">`,
  )}</div>
<div class="panel__foot">${kv('Subtotal', naira(subtotal), { strong: true, price: true })}
<p class="small muted">Shipping is worked out at checkout. Import duties and taxes are paid on delivery.</p>
${button('Go to checkout', { href: '/checkout/', full: true })}${button('View bag', { kind: 'secondary', href: '/cart/', full: true })}</div></div>`;
}

function cookieNotice(): string {
  return `<section class="cookie" id="cookie" aria-labelledby="cookie-h" data-cookie>
<h2 class="h3" id="cookie-h">Your privacy</h2>
<p>We use necessary cookies to keep your bag and sign-in working. With your permission we also use cookies to see how the shop is used and to show you relevant offers.</p>
<div class="stack stack--sm" data-cookie-choices hidden>${check('Necessary', { checked: true, disabled: true, help: 'Always on. Keeps your bag, sign-in and currency.' })}${check('Analytics', { help: 'Helps us see which pages work and which do not.' })}${check('Marketing', { help: 'Lets us show you offers on other sites.' })}</div>
<div class="row">${button('Accept all', { attrs: 'data-cookie-accept' })}${button('Only necessary', { kind: 'secondary', attrs: 'data-cookie-accept' })}${button('Choose', { kind: 'text', attrs: 'data-cookie-choose' })}</div></section>`;
}

function chat(): string {
  return `<section class="chat" id="chat" role="dialog" aria-labelledby="chat-h" data-chat>
<div class="panel__head"><h2 class="h3" id="chat-h">Chat with us</h2><button class="icon-btn" type="button" data-chat-close aria-label="Close the chat">${icon('close')}</button></div>
<div class="stack grow" style="overflow-y:auto">
<div class="bubble"><p>Hello. How can we help you today?</p><p class="small">hairbydemj · 09:12</p></div>
${chipGroup('chat-topic', ['Where is my order?', 'Delivery times', 'Returns', 'Choosing a length'], { type: 'radio' })}
</div>
<form class="row row--nowrap" style="align-items:flex-end" action="#" data-chat-form><div class="field grow"><label class="field__label" for="chat-msg">Message</label><input class="field__input" id="chat-msg" placeholder="Type your message"></div>${button('Send', { type: 'submit' })}</form>
<p class="small muted">We reply within a few minutes, Monday to Saturday, 9:00 to 18:00 Lagos time.</p></section>
<div class="fabs"><a class="fab" href="#top" hidden data-top aria-label="Back to the top">${icon('arrowUp')}</a>
<a class="fab" href="/contact/" aria-label="Message us on WhatsApp">${icon('whatsapp')}</a>
<button class="fab fab--main" type="button" data-chat-open aria-controls="chat" aria-label="Chat with us">${icon('chat')}</button></div>`;
}

/** A complete HTML document for one website page. */
export function page(o: PageOptions): string {
  const title = o.title === 'hairbydemj' ? o.title : `${o.title} · hairbydemj`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(o.description ?? 'Human hair wigs, bundles and closures, delivered worldwide from Benin City.')}">
<meta name="theme-color" content="#040204">
${o.preview ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" href="/brand/monogram.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/source-sans-3-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/site.css">
</head>
<body id="top">
<a class="skip" href="#main">Skip to the content</a>
${o.preview ? '<div class="preview-bar"><span>Design preview. Products, prices and photos are samples; nothing can be bought.</span><a class="link" href="/designs/">See every page</a></div>' : ''}
${header(o.nav)}
<main id="main"><div class="wrap page stack stack--lg">
${o.body}
</div></main>
${o.after ?? ''}
${footer()}
<div class="scrim" data-scrim></div>
${menuPanel()}
${miniCart()}
${cookieNotice()}
${chat()}
<script src="/js/site.js" defer></script>
</body>
</html>
`;
}

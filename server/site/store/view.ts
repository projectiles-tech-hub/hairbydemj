// The live website's shared parts: what every page needs to know about the
// visitor (signed in, bag, currency, menu), the page shell, and the pieces
// that show real products and money. The design preview keeps its own files
// (server/site/layout.ts and pages/) with sample data; these are the real ones.

import type { AccountDeps } from '../../accounts/deps.js';
import { currentCustomer } from '../../accounts/routes.js';
import { resolveCart } from '../../cart/cart.js';
import { cartOwner } from '../../cart/routes.js';
import { currencyForCountry, formatMoney, pickCurrency } from '../../cart/money.js';
import { listCategories, type CategoryNode, type Picture, type ProductCard } from '../../catalog/public.js';
import { readCookies, sendHtml, type RequestContext } from '../../http.js';
import { button, check, icon } from '../components.js';
import { cls, each, esc } from '../html.js';

export interface Currency {
  code: string;
  symbol: string;
  minorUnits: number;
}

export interface SiteContext {
  deps: AccountDeps;
  ctx: RequestContext;
  customer: { id: number; firstName: string; email: string } | null;
  currency: Currency;
  currencies: Currency[];
  bagCount: number;
  categories: CategoryNode[];
  now: Date;
  /** The site's own address, for canonical links and the sitemap: https://hairbydemj.com in production. */
  origin: string;
}

export function siteOrigin(deps: AccountDeps): string {
  const c = deps.config;
  return c.env === 'production' ? `https://${c.hosts.site}` : `http://${c.hosts.site}:${c.port}`;
}

/** Everything a page needs about this visitor, read once per request. */
export async function siteContext(deps: AccountDeps, ctx: RequestContext): Promise<SiteContext> {
  const signedIn = await currentCustomer(deps, ctx, 'cookie');
  const owner = await cartOwner(deps, ctx, 'cookie');
  const cart = await resolveCart(deps, owner);
  const currencies = (await deps.db.query('select code, symbol, minor_units from currencies where enabled order by is_base desc, code')).rows.map((r) => ({ code: String(r.code), symbol: String(r.symbol), minorUnits: Number(r.minor_units) }));
  let preferred: string | null = null;
  if (signedIn) preferred = ((await deps.db.query('select preferred_currency from customers where id = $1', [signedIn.customer.id])).rows[0]?.preferred_currency as string | null) ?? null;
  const cookie = readCookies(ctx.req).hbd_currency ?? null;
  const country = deps.config.trustProxy && typeof ctx.req.headers['cf-ipcountry'] === 'string' ? ctx.req.headers['cf-ipcountry'] : null;
  const code = cart?.currency ?? (await pickCurrency(deps.db, [ctx.query.get('currency'), cookie, preferred, currencyForCountry(country)]));
  const currency = currencies.find((c) => c.code === code) ?? currencies[0] ?? { code: 'NGN', symbol: '₦', minorUnits: 2 };
  const bagCount = cart ? Number((await deps.db.query('select coalesce(sum(quantity), 0)::int as n from cart_items where cart_id = $1', [cart.id])).rows[0]?.n ?? 0) : 0;
  return {
    deps,
    ctx,
    customer: signedIn ? { id: signedIn.customer.id, firstName: signedIn.customer.firstName, email: signedIn.customer.email } : null,
    currency,
    currencies,
    bagCount,
    categories: await listCategories(deps),
    now: deps.now(),
    origin: siteOrigin(deps),
  };
}

export function money(sc: SiteContext, minor: number, currency?: Currency): string {
  return formatMoney(minor, currency ?? sc.currency);
}

// ----- pictures and product cards -----

/** A product photo in WebP with a JPEG fallback, at the widths that exist. */
export function picture(pic: Picture | null, o: { alt?: string; sizes?: string; ratio?: string; eager?: boolean; className?: string } = {}): string {
  if (!pic || pic.widths.length === 0) {
    return `<div class="${cls('photo', o.className)}" role="img" aria-label="${esc(o.alt ?? 'No photo yet')}"${o.ratio ? ` style="--ratio:${o.ratio}"` : ''}></div>`;
  }
  const widths = [...pic.widths].sort((a, b) => a - b);
  const src = (w: number, ext: string): string => `/media/${pic.path}/${w}.${ext}`;
  const set = (ext: string): string => widths.map((w) => `${src(w, ext)} ${w}w`).join(', ');
  const middle = widths[Math.min(widths.length - 1, 2)] as number;
  const sizes = o.sizes ?? '(max-width: 599px) 50vw, (max-width: 1023px) 33vw, 25vw';
  return `<picture class="${cls('pic', o.className)}"${o.ratio ? ` style="--ratio:${o.ratio}"` : ''}><source type="image/webp" srcset="${set('webp')}" sizes="${sizes}"><img src="${src(middle, 'jpg')}" srcset="${set('jpg')}" sizes="${sizes}" alt="${esc(o.alt ?? pic.alt)}" loading="${o.eager ? 'eager' : 'lazy'}" decoding="async"></picture>`;
}

export function priceRange(sc: SiteContext, from: number, to: number): string {
  return from === to ? money(sc, from) : `From ${money(sc, from)}`;
}

export function productCard(sc: SiteContext, p: ProductCard, o: { wished?: boolean } = {}): string {
  const badge = !p.inStock ? 'Sold out' : p.compareAtMinor && p.compareAtMinor > p.priceFromMinor ? 'Sale' : p.isNew ? 'New' : '';
  const details = [p.texture, p.lengths.length ? `${p.lengths[0]}" to ${p.lengths[p.lengths.length - 1]}"` : ''].filter(Boolean).join(', ');
  return (
    `<article class="product-card product-card--panel">` +
    `<a class="product-card__media" href="/products/${esc(p.slug)}/" tabindex="-1" aria-hidden="true">${picture(p.image, { alt: p.name, ratio: '4 / 5' })}${badge ? `<span class="tag">${esc(badge)}</span>` : ''}</a>` +
    `<button class="icon-btn product-card__wish" type="button" aria-pressed="${o.wished ? 'true' : 'false'}" aria-label="Save ${esc(p.name)} to your wishlist" data-wish="${p.id}">${icon('heart', 22)}</button>` +
    `<div class="product-card__body"><a class="product-card__name" href="/products/${esc(p.slug)}/">${esc(p.name)}</a>` +
    (details ? `<span class="small muted">${esc(details)}</span>` : '') +
    `<span class="price">${esc(priceRange(sc, p.priceFromMinor, p.priceToMinor))}${p.compareAtMinor && p.compareAtMinor > p.priceFromMinor ? ` <s class="muted small">${esc(money(sc, p.compareAtMinor))}</s>` : ''}</span></div></article>`
  );
}

export function productGrid(sc: SiteContext, products: readonly ProductCard[], o: { id?: string; cols?: number } = {}): string {
  return `<div class="grid"${o.id ? ` id="${o.id}"` : ''} style="--cols:${o.cols ?? 4};--cols-tablet:3;--cols-phone:2">${each(products, (p) => productCard(sc, p))}</div>`;
}

export function crumbs(items: ReadonlyArray<[label: string, href?: string]>): string {
  return `<nav class="small muted" aria-label="Breadcrumb"><ol class="crumbs">${each(items, ([l, h], i) => `<li>${h && i < items.length - 1 ? `<a href="${esc(h)}">${esc(l)}</a>` : `<span${i === items.length - 1 ? ' aria-current="page"' : ''}>${esc(l)}</span>`}</li>`)}</ol></nav>`;
}

// ----- the page shell -----

export interface ShellOptions {
  title: string;
  description?: string;
  /** Path for the canonical link, such as /products/bone-straight-wig/. */
  canonical?: string;
  nav?: string;
  body: string;
  after?: string;
  /** Structured data for search engines (schema.org), as objects. */
  jsonLd?: unknown[];
  noindex?: boolean;
  /** Extra scripts this page needs from outside (only Stripe's payment form). */
  scripts?: string[];
  status?: number;
  /** The camera try-on page (module 16): allows WebAssembly and camera pictures. */
  tryOn?: boolean;
  /** Our own module scripts this page needs besides store.js. */
  modules?: string[];
}

function header(sc: SiteContext, nav?: string): string {
  const top = sc.categories.slice(0, 5);
  return `<header class="site-header"><div class="wrap site-header__in">
<button class="icon-btn only-compact" type="button" data-open="menu" aria-label="Open the menu" aria-controls="menu">${icon('menu')}</button>
<a class="site-header__logo" href="/" aria-label="hairbydemj home"><img src="/brand/wordmark.svg" alt="hairbydemj" width="170" height="34"></a>
<nav class="site-nav" aria-label="Main">${each(top, (c) => `<a href="/c/${esc(c.slug)}/"${c.name === nav ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`)}<a href="/guides/"${nav === 'Guides' ? ' aria-current="page"' : ''}>Guides</a><a href="/faq/"${nav === 'Help' ? ' aria-current="page"' : ''}>Help</a></nav>
<span class="spacer only-compact"></span>
<form class="site-header__search" action="/search/" role="search" data-search>${icon('search', 20)}<label class="visually-hidden" for="q">Search</label><input id="q" name="q" type="search" placeholder="Search" autocomplete="off" aria-autocomplete="list" aria-controls="suggest" value="${esc(sc.ctx.path === '/search/' ? (sc.ctx.query.get('q') ?? '') : '')}"><div class="suggest" id="suggest" role="listbox" hidden></div></form>
<a class="icon-btn only-compact" href="/search/" aria-label="Search">${icon('search')}</a>
<button class="currency only-desktop" type="button" data-open="currency" aria-controls="currency" aria-label="Currency: ${esc(sc.currency.code)}. Change currency">${esc(sc.currency.code)} ${icon('chevronDown', 16)}</button>
<a class="icon-btn only-desktop" href="${sc.customer ? '/account/' : '/sign-in/'}" aria-label="${sc.customer ? 'Your account' : 'Sign in'}">${icon('account')}</a>
<a class="icon-btn only-desktop" href="/account/wishlist/" aria-label="Your wishlist">${icon('heart')}</a>
<button class="icon-btn" type="button" data-open="mini-cart" aria-controls="mini-cart" aria-label="Your bag, ${sc.bagCount} ${sc.bagCount === 1 ? 'item' : 'items'}" data-bag-button>${icon('bag')}<span class="bag-count" aria-hidden="true" data-bag-count${sc.bagCount ? '' : ' hidden'}>${sc.bagCount}</span></button>
</div></header>`;
}

function footer(sc: SiteContext): string {
  const shop: Array<[string, string]> = [...sc.categories.slice(0, 5).map((c): [string, string] => [c.name, `/c/${c.slug}/`]), ['Shop the look', '/looks/']];
  const groups: ReadonlyArray<[string, ReadonlyArray<[string, string]>]> = [
    ['Shop', shop],
    ['Help', [['Shipping and delivery', '/shipping/'], ['Returns and refunds', '/returns/'], ['Questions and answers', '/faq/'], ['Contact us', '/contact/'], ['Track an order', '/track-order/']]],
    ['About', [['Our story', '/about/'], ['Hair guides', '/guides/'], ['Length and density guide', '/guides/length-and-density/']]],
    ['Legal', [['Privacy', '/privacy/'], ['Terms', '/terms/'], ['Cookies', '/cookies/']]],
  ];
  return `<footer class="site-footer"><div class="wrap site-footer__in">
<div class="site-footer__brand stack stack--sm"><img src="/brand/monogram.svg" alt="hairbydemj" width="64" height="56"><p class="small muted">Hair you will love, delivered worldwide.</p></div>
<div class="site-footer__cols">${each(groups, ([title, links]) => `<details open><summary>${esc(title)}${icon('plus', 20)}</summary><ul>${each(links, ([l, h]) => `<li><a class="small" href="${esc(h)}">${esc(l)}</a></li>`)}</ul></details>`)}</div>
<form class="stack stack--sm" data-newsletter aria-labelledby="news-h" novalidate><h2 class="h3" id="news-h" style="font:500 22px/30px var(--font-head);color:var(--ivory)">New arrivals and offers, by email</h2>
<div class="field"><label class="field__label" for="news-email">Email address</label><input class="field__input" id="news-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
${button('Sign up', { type: 'submit', fullPhone: true })}<p class="small" role="status" aria-live="polite" data-newsletter-status></p></form>
<div class="site-footer__legal small muted"><span>© ${sc.now.getUTCFullYear()} hairbydemj</span><span>Pay with Paystack or Stripe. Delivered by DHL, UPS, FedEx and local couriers.</span></div>
</div></footer>`;
}

function menuPanel(sc: SiteContext): string {
  return `<div class="panel panel--left" id="menu" role="dialog" aria-modal="true" aria-label="Menu" data-panel>
<div class="panel__head"><img src="/brand/wordmark.svg" alt="hairbydemj" width="130" height="26" style="height:26px;width:auto"><button class="icon-btn" type="button" data-close aria-label="Close the menu">${icon('close')}</button></div>
<nav class="panel__body" aria-label="Menu" style="gap:0">${each(sc.categories, (c) => `<a class="menu-link" href="/c/${esc(c.slug)}/">${esc(c.name)}${icon('chevronRight', 20)}</a>`)}<a class="menu-link" href="/looks/">Shop the look${icon('chevronRight', 20)}</a><a class="menu-link" href="/guides/">Hair guides${icon('chevronRight', 20)}</a>
<hr class="divider" style="margin:12px 0"><a class="menu-link menu-link--small" href="${sc.customer ? '/account/' : '/sign-in/'}">${sc.customer ? 'Your account' : 'Sign in'}</a><a class="menu-link menu-link--small" href="/account/wishlist/">Wishlist</a><a class="menu-link menu-link--small" href="/track-order/">Track an order</a><a class="menu-link menu-link--small" href="/faq/">Help</a>
<hr class="divider" style="margin:12px 0"><button class="menu-link menu-link--small" type="button" data-open="currency" aria-controls="currency">Currency: ${esc(sc.currency.code)}</button></nav></div>`;
}

function currencyPanel(sc: SiteContext): string {
  return `<div class="panel panel--sheet" id="currency" role="dialog" aria-modal="true" aria-labelledby="currency-h" data-panel>
<div class="panel__head"><h2 class="h3" id="currency-h">Currency</h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon('close')}</button></div>
<form class="panel__body" data-currency-form><fieldset class="stack stack--sm"><legend class="visually-hidden">Choose the currency you pay in</legend>${each(sc.currencies, (c) => check(`${c.code} ${c.symbol}`, { type: 'radio', name: 'currency', checked: c.code === sc.currency.code }).replace('<input ', `<input value="${esc(c.code)}" `))}</fieldset>
<p class="small muted">Naira is paid with Paystack; dollars, pounds and euros with Stripe.</p>${button('Use this currency', { type: 'submit', full: true })}</form></div>`;
}

function miniCart(sc: SiteContext): string {
  return `<div class="panel panel--right" id="mini-cart" role="dialog" aria-modal="true" aria-labelledby="mini-cart-h" data-panel data-mini-cart>
<div class="panel__head"><h2 class="h3" id="mini-cart-h">Your bag (<span data-bag-count-text>${sc.bagCount}</span>)</h2><button class="icon-btn" type="button" data-close aria-label="Close your bag">${icon('close')}</button></div>
<div class="panel__body" data-mini-cart-body><p class="muted">${sc.bagCount ? 'Loading your bag…' : 'Your bag is empty.'}</p></div>
<div class="panel__foot">${button('Go to checkout', { href: '/checkout/', full: true })}${button('View bag', { kind: 'secondary', href: '/cart/', full: true })}</div></div>`;
}

function cookieNotice(): string {
  return `<section class="cookie" id="cookie" aria-labelledby="cookie-h" data-cookie hidden>
<h2 class="h3" id="cookie-h">Your privacy</h2>
<p>We use necessary cookies to keep your bag, sign-in and currency working. We do not use advertising or tracking cookies.</p>
<div class="row">${button('Got it', { attrs: 'data-cookie-accept' })}${button('Read about cookies', { kind: 'text', href: '/cookies/' })}</div></section>`;
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "font-src 'self'",
  // Stripe's payment form is the one thing loaded from outside, and only on checkout.
  // and Google's sign-in button, only on the sign-in page when Google sign-in is set up.
  "script-src 'self' https://js.stripe.com https://accounts.google.com/gsi/client",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://accounts.google.com/gsi/",
  "connect-src 'self' https://api.stripe.com https://accounts.google.com/gsi/",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/**
 * The try-on page runs MediaPipe's face tracking in the browser: its
 * WebAssembly needs 'wasm-unsafe-eval', and the camera picture and saved
 * photo are blob: addresses. Every file still comes from our own server.
 */
const TRY_ON_CSP = CSP.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'").replace("img-src 'self' data:", "img-src 'self' data: blob:") + "; media-src 'self' blob:; worker-src 'self' blob:";

export const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cache-Control': 'private, no-cache',
};

/** A complete HTML document for one live page. */
export function storePage(sc: SiteContext | null, o: ShellOptions): string {
  const title = o.title === 'hairbydemj' ? 'hairbydemj: human hair wigs, bundles and closures' : `${o.title} | hairbydemj`;
  const description = o.description ?? 'Human hair wigs, bundles and closures, sent from Benin City to your door anywhere in the world.';
  const origin = sc?.origin ?? '';
  const canonical = o.canonical ? `${origin}${o.canonical}` : '';
  const ld = (o.jsonLd ?? []).map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${o.noindex ? '<meta name="robots" content="noindex">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="hairbydemj">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta name="theme-color" content="#040204">
<link rel="icon" href="/brand/monogram.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/source-sans-3-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/site.css">
${ld}
</head>
<body id="top"${sc ? ` data-currency="${esc(sc.currency.code)}"${sc.customer ? ' data-signed-in' : ''}` : ''}>
<a class="skip" href="#main">Skip to the content</a>
${sc ? header(sc, o.nav) : '<header class="site-header"><div class="wrap site-header__in"><a class="site-header__logo" href="/" aria-label="hairbydemj home"><img src="/brand/wordmark.svg" alt="hairbydemj" width="170" height="34"></a></div></header>'}
<main id="main"><div class="wrap page stack stack--lg">
${o.body}
</div></main>
${o.after ?? ''}
${sc ? footer(sc) : ''}
<div class="scrim" data-scrim></div>
${sc ? menuPanel(sc) + currencyPanel(sc) + miniCart(sc) + chatWidget(sc) : ''}
${cookieNotice()}
${(o.scripts ?? []).map((s) => `<script src="${esc(s)}"></script>`).join('\n')}
${(o.modules ?? []).map((s) => `<script type="module" src="${esc(s)}"></script>`).join('\n')}
<script type="module" src="/js/store.js"></script>
</body>
</html>
`;
}

/** Live chat on every page (module 18): a button, and a panel the script fills. */
function chatWidget(sc: SiteContext): string {
  return `<button class="chat-fab" type="button" data-chat-open aria-controls="chat-panel" aria-expanded="false">${icon('chat', 22)}<span>Chat with us</span></button>
<section class="chat-panel" id="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chat-title" hidden data-chat-panel>
<header class="chat-panel__head"><h2 class="h3" id="chat-title">Chat with us</h2><button class="icon-btn" type="button" data-chat-close aria-label="Close the chat">${icon('close')}</button></header>
<p class="small muted" data-chat-status>We usually reply within a few minutes during the day.</p>
<a class="btn btn--secondary btn--full chat-panel__wa" href="#" target="_blank" rel="noopener" data-chat-whatsapp hidden>Message us on WhatsApp</a>
<div class="chat-panel__messages" data-chat-messages aria-live="polite"></div>
<form class="stack stack--sm" data-chat-form novalidate>
<div class="stack stack--sm" data-chat-intro${sc.customer ? ' hidden' : ''}>
<div class="field"><label class="field__label" for="chat-name">Your name (optional)</label><input class="field__input" id="chat-name" name="name" autocomplete="name"></div>
<div class="field"><label class="field__label" for="chat-email">Email, so we can reply if you leave (optional)</label><input class="field__input" id="chat-email" name="email" type="email" autocomplete="email"></div>
</div>
<div class="field"><label class="field__label" for="chat-text">Message</label><textarea class="field__input" id="chat-text" name="body" rows="2" maxlength="2000"></textarea></div>
<button class="btn btn--primary btn--full" type="submit">Send</button>
<p class="small" role="alert" data-chat-error></p>
</form>
</section>`;
}

export function sendPage(sc: SiteContext | null, o: ShellOptions): void {
  if (!sc) throw new Error('sendPage needs a context');
  sendHtml(sc.ctx.res, o.status ?? 200, storePage(sc, o), o.tryOn ? { ...PAGE_HEADERS, 'Content-Security-Policy': TRY_ON_CSP } : PAGE_HEADERS);
}

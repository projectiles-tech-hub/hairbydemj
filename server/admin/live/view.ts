// The live admin's shared parts: who is signed in and what they may do, the
// page shell (sidebar shows only what the staff member may open), and small
// helpers for money, dates and forms. The design preview keeps its own files.

import type { AccountDeps } from '../../accounts/deps.js';
import { requireStaff } from '../../accounts/routes.js';
import { can, type Area, type StaffMember } from '../../accounts/staff.js';
import { formatMoney } from '../../cart/money.js';
import { ApiError, sendHtml, type RequestContext } from '../../http.js';
import { icon } from '../../site/components.js';
import { cls, each, esc } from '../../site/html.js';

export interface AdminContext {
  deps: AccountDeps;
  ctx: RequestContext;
  staff: StaffMember;
  now: Date;
  currencies: Map<string, { code: string; symbol: string; minorUnits: number }>;
}

export async function adminContext(deps: AccountDeps, ctx: RequestContext): Promise<AdminContext | null> {
  let staff: StaffMember;
  try {
    staff = (await requireStaff(deps, ctx)).staff;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
  const rows = await deps.db.query('select code, symbol, minor_units from currencies order by is_base desc, code');
  return { deps, ctx, staff, now: deps.now(), currencies: new Map(rows.rows.map((r) => [String(r.code), { code: String(r.code), symbol: String(r.symbol), minorUnits: Number(r.minor_units) }])) };
}

export function money(ac: AdminContext, minor: number, currency: string): string {
  return formatMoney(minor, ac.currencies.get(currency) ?? { code: currency, symbol: `${currency} `, minorUnits: 2 });
}

export function date(value: string | Date | null, withTime = false): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

export const ORDER_STATUS: Record<string, [string, 'good' | 'wait' | 'bad' | 'off']> = {
  on_hold: ['Waiting for payment', 'wait'],
  to_fulfil: ['To fulfil', 'wait'],
  shipped: ['Shipped', 'good'],
  delivered: ['Delivered', 'good'],
  returned: ['Returned', 'off'],
  cancelled: ['Cancelled', 'off'],
};
export const PAYMENT_STATUS: Record<string, [string, 'good' | 'wait' | 'bad' | 'off']> = {
  awaiting: ['Awaiting', 'wait'],
  paid: ['Paid', 'good'],
  failed: ['Failed', 'bad'],
  partly_refunded: ['Partly refunded', 'off'],
  refunded: ['Refunded', 'off'],
};

export function badge(map: Record<string, [string, 'good' | 'wait' | 'bad' | 'off']>, key: string): string {
  const [label, tone] = map[key] ?? [key, 'off'];
  return `<span class="astatus astatus--${tone}">${esc(label)}</span>`;
}

// ----- forms -----

/** A labelled field. `key` is the name sent to the server (dots make nested objects). */
export function input(key: string, label: string, o: { value?: string | number | null; type?: string; help?: string; attrs?: string; data?: 'number' | 'minor' | 'list' | 'bool' } = {}): string {
  const id = `f-${key.replace(/[^a-z0-9]+/gi, '-')}`;
  return `<div class="field"><label class="field__label" for="${id}">${esc(label)}</label><input class="field__input" id="${id}" data-key="${esc(key)}"${o.data ? ` data-type="${o.data}"` : ''} type="${o.type ?? 'text'}" value="${esc(o.value === null || o.value === undefined ? '' : String(o.value))}"${o.attrs ? ` ${o.attrs}` : ''}>${o.help ? `<p class="field__help">${esc(o.help)}</p>` : ''}<p class="field__error" data-error-for="${esc(key)}" hidden></p></div>`;
}

export function textarea(key: string, label: string, value: string, o: { rows?: number; help?: string } = {}): string {
  const id = `f-${key.replace(/[^a-z0-9]+/gi, '-')}`;
  return `<div class="field"><label class="field__label" for="${id}">${esc(label)}</label><textarea class="field__input" id="${id}" data-key="${esc(key)}" rows="${o.rows ?? 4}">${esc(value)}</textarea>${o.help ? `<p class="field__help">${esc(o.help)}</p>` : ''}<p class="field__error" data-error-for="${esc(key)}" hidden></p></div>`;
}

export function select(key: string, label: string, options: ReadonlyArray<[value: string, label: string]>, value: string | null, o: { data?: 'number' } = {}): string {
  const id = `f-${key.replace(/[^a-z0-9]+/gi, '-')}`;
  return `<div class="field"><label class="field__label" for="${id}">${esc(label)}</label><select class="field__input" id="${id}" data-key="${esc(key)}"${o.data ? ` data-type="${o.data}"` : ''}>${each(options, ([v, l]) => `<option value="${esc(v)}"${v === (value ?? '') ? ' selected' : ''}>${esc(l)}</option>`)}</select><p class="field__error" data-error-for="${esc(key)}" hidden></p></div>`;
}

export function checkbox(key: string, label: string, checked: boolean, help = ''): string {
  return `<label class="check"><input type="checkbox" data-key="${esc(key)}" data-type="bool"${checked ? ' checked' : ''}><span>${esc(label)}${help ? `<br><span class="small muted">${esc(help)}</span>` : ''}</span></label>`;
}

/** A form the admin script sends as JSON. `next` may contain {id} from the answer. */
export function form(action: string, inner: string, o: { submit?: string; next?: string; reload?: boolean; confirm?: string; className?: string; secondary?: boolean } = {}): string {
  return `<form class="${cls('stack', o.className)}" data-json-form="${esc(action)}"${o.next ? ` data-next="${esc(o.next)}"` : ''}${o.reload !== false ? ' data-reload' : ''}${o.confirm ? ` data-confirm="${esc(o.confirm)}"` : ''} novalidate>${inner}<div class="row"><button class="btn btn--${o.secondary ? 'secondary' : 'primary'}" type="submit">${esc(o.submit ?? 'Save')}</button></div><p class="small" role="alert" data-form-error></p></form>`;
}

/** A button that sends one request, then reloads. */
export function postButton(label: string, action: string, o: { body?: unknown; confirm?: string; kind?: 'primary' | 'secondary' | 'text'; next?: string } = {}): string {
  return `<button class="btn btn--${o.kind ?? 'secondary'}" type="button" data-post="${esc(action)}"${o.body ? ` data-body="${esc(JSON.stringify(o.body))}"` : ''}${o.confirm ? ` data-confirm="${esc(o.confirm)}"` : ''}${o.next ? ` data-next="${esc(o.next)}"` : ''}>${esc(label)}</button>`;
}

/** Previous and next page links that keep the filters. */
export function pager(ac: AdminContext, page: number, more: boolean, total?: number, size = 50): string {
  const link = (p: number): string => {
    const params = new URLSearchParams(ac.ctx.query);
    params.set('page', String(p));
    return `${ac.ctx.path}?${params.toString()}`;
  };
  const shown = total === undefined ? '' : `Showing ${total === 0 ? 0 : (page - 1) * size + 1} to ${Math.min(total, page * size)} of ${total}`;
  return `<nav class="apager small muted" aria-label="Pages"><span>${shown}</span><span class="apager__links">${page > 1 ? `<a href="${esc(link(page - 1))}">‹ Previous</a>` : ''}${more ? `<a href="${esc(link(page + 1))}">Next ›</a>` : ''}</span></nav>`;
}

// ----- the shell -----

const NAV: ReadonlyArray<ReadonlyArray<[label: string, href: string, area: Area | null]>> = [
  [['Dashboard', '/', null]],
  [['Orders', '/orders/', 'orders'], ['Returns', '/returns/', 'returns'], ['Customers', '/customers/', 'customers']],
  [['Products', '/products/', 'products'], ['Categories and collections', '/categories/', 'products'], ['Inventory', '/inventory/', 'products']],
  [['Discounts', '/discounts/', 'discounts'], ['Gift cards', '/gift-cards/', 'discounts'], ['Loyalty and referrals', '/loyalty/', 'discounts'], ['Reviews', '/reviews/', 'products']],
  [['Homepage', '/homepage/', 'settings'], ['Content pages', '/content/', 'settings'], ['Emails', '/emails/', 'settings']],
  [['Shipping settings', '/shipping/', 'settings'], ['Payments and currencies', '/payments/', 'settings'], ['Reports', '/reports/', 'reports'], ['Staff and roles', '/staff/', null], ['Activity log', '/activity/', 'settings'], ['Store settings', '/settings/', 'settings'], ['System', '/system/', 'settings']],
];

function sidebar(ac: AdminContext, current: string): string {
  const groups = NAV.map((g) => g.filter(([, h, area]) => (h === '/staff/' ? ac.staff.isOwner : area === null || can(ac.staff, area, 'view')))).filter((g) => g.length);
  return `<aside class="aside" id="admin-nav" data-aside><div class="aside__head"><a class="aside__logo" href="/" aria-label="hairbydemj admin home"><img src="/brand/wordmark.svg" alt="hairbydemj" width="130" height="26"><span class="small muted">Admin</span></a><button class="icon-btn aside__close" type="button" data-aside-close aria-label="Close the menu">${icon('close')}</button></div>
<nav aria-label="Admin">${each(groups, (g) => `<ul>${each(g, ([l, h]) => `<li><a href="${h}"${h === current ? ' aria-current="page"' : ''}>${esc(l)}</a></li>`)}</ul>`)}</nav></aside>`;
}

function topBar(ac: AdminContext): string {
  return `<header class="atop"><button class="icon-btn atop__menu" type="button" data-aside-open aria-controls="admin-nav" aria-label="Open the menu">${icon('menu')}</button>
<form class="atop__search" action="/orders/" role="search">${icon('search', 20)}<label class="visually-hidden" for="admin-q">Search orders by number, email, name or phone</label><input id="admin-q" name="q" type="search" placeholder="Search orders" value="${esc(ac.ctx.path === '/orders/' ? (ac.ctx.query.get('q') ?? '') : '')}"></form>
<span class="spacer"></span><span class="atop__user small">${icon('account', 20)}<span>${esc(ac.staff.name)} · ${esc(ac.staff.roleName)}</span></span><button class="btn btn--text small" type="button" data-sign-out>Sign out</button></header>`;
}

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'";
export const ADMIN_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'private, no-store',
};

export function adminDocument(o: { title: string; body: string; ac?: AdminContext | null; current?: string; after?: string }): string {
  const shell = Boolean(o.ac);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} · hairbydemj admin</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#040204">
<link rel="icon" href="/brand/monogram.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/source-sans-3-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/site.css">
<link rel="stylesheet" href="/css/admin.css">
</head>
<body id="top" class="admin">
<a class="skip" href="#main">Skip to the content</a>
<div class="${shell ? 'ashell' : 'ashell ashell--bare'}">
${o.ac ? sidebar(o.ac, o.current ?? o.ac.ctx.path) : ''}
<div class="amain">
${o.ac ? topBar(o.ac) : '<header class="atop"><span class="aside__logo"><img src="/brand/wordmark.svg" alt="hairbydemj" width="130" height="26"><span class="small muted">Admin</span></span></header>'}
<main id="main" class="acontent stack stack--lg">
${o.body}
</main>
</div>
</div>
${shell ? '<div class="scrim" data-scrim></div>' : ''}
${o.after ?? ''}
<p class="atoast" role="status" aria-live="polite" data-toast-box hidden></p>
<script src="/js/staff.js" type="module"></script>
</body>
</html>
`;
}

export function sendAdmin(ctx: RequestContext, status: number, html: string): void {
  sendHtml(ctx.res, status, html, ADMIN_HEADERS);
}

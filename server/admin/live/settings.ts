// Admin pages for signing in, staff and roles, what the shop says (homepage,
// content pages, emails) and how it runs (shipping, payments and currencies,
// store settings, the activity log and the background jobs).

import { AREAS, can, listRoles, listStaff, type Area } from '../../accounts/staff.js';
import { listCurrencySettings } from '../../cart/rates.js';
import { listMessages } from '../../notifications/routes.js';
import { returnSettings } from '../../orders/orders.js';
import type { PaymentDeps } from '../../payments/payments.js';
import { listCarriers, listLocalRates } from '../../shipping/manage.js';
import { listPackageSizes, readShipFrom, type ShippingDeps } from '../../shipping/shipping.js';
import { listJobs } from '../../worker/queue.js';
import { SCHEDULE } from '../../worker/tasks.js';
import { each, esc } from '../../site/html.js';
import { num, panel, pageHead, raw, table, tabs } from '../components.js';
import { listActivity, listContent, listHomepage, readStore } from '../api.js';
import { checkbox, date, form, input, money, postButton, select, textarea, type AdminContext } from './view.js';

export interface LiveExtras {
  shipping?: ShippingDeps;
  payments?: PaymentDeps;
}

// ----- signing in -----

export function signInPage(): string {
  return `<section class="asign stack stack--lg" aria-labelledby="sign-in-title">
<h1 class="h2" id="sign-in-title">Staff sign in</h1>
<form class="stack" data-sign-in novalidate>
<div class="field"><label class="field__label" for="si-email">Email</label><input class="field__input" id="si-email" name="email" type="email" autocomplete="username" required></div>
<div class="field"><label class="field__label" for="si-password">Password</label><input class="field__input" id="si-password" name="password" type="password" autocomplete="current-password" required></div>
<button class="btn btn--primary" type="submit">Continue</button>
<p class="small" role="alert" data-form-error></p>
</form>
<form class="stack" data-two-step hidden novalidate>
<p>Enter the six-digit code from your authenticator app.</p>
<div class="field"><label class="field__label" for="si-code">Code</label><input class="field__input" id="si-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></div>
<button class="btn btn--primary" type="submit">Sign in</button>
<p class="small" role="alert" data-form-error></p>
</form>
<p class="small muted">Forgotten your password or lost your phone? Ask the store owner to reset your access.</p>
</section>`;
}

export function invitePage(token: string): string {
  return `<section class="asign stack stack--lg" aria-labelledby="invite-title">
<h1 class="h2" id="invite-title">Set up your staff account</h1>
<form class="stack" data-invite="${esc(token)}" novalidate>
<p>Choose a password of at least 10 characters.</p>
<div class="field"><label class="field__label" for="in-password">Password</label><input class="field__input" id="in-password" name="password" type="password" autocomplete="new-password" minlength="10" required></div>
<button class="btn btn--primary" type="submit">Continue</button>
<p class="small" role="alert" data-form-error></p>
</form>
<form class="stack" data-invite-confirm="${esc(token)}" hidden novalidate>
<p>Add hairbydemj to an authenticator app (such as Google Authenticator or 1Password) with this key, then enter the code it shows.</p>
<p class="strong" style="word-break:break-all" data-invite-secret></p>
<p class="small"><a class="link" href="#" data-invite-uri>Open in an authenticator app on this device</a></p>
<div class="field"><label class="field__label" for="in-code">Code</label><input class="field__input" id="in-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></div>
<button class="btn btn--primary" type="submit">Finish</button>
<p class="small" role="alert" data-form-error></p>
</form>
</section>`;
}

// ----- staff and roles (the owner only) -----

const AREA_NAMES: Record<Area, string> = { orders: 'Orders', returns: 'Returns', products: 'Products and stock', customers: 'Customers', discounts: 'Discounts', settings: 'Settings', reports: 'Reports' };

export async function staffPage(ac: AdminContext): Promise<string> {
  const people = await listStaff(ac.deps, ac.staff);
  const roles = await listRoles(ac.deps, ac.staff);
  const roleOptions = roles.map((r): [string, string] => [String(r.id), r.name]);
  const permissionFields = (prefix: string, perms?: Record<Area, { view: boolean; change: boolean }>): string =>
    `<table class="atable small"><caption class="visually-hidden">What this role may do</caption><thead><tr><th scope="col">Area</th><th scope="col">See</th><th scope="col">Change</th></tr></thead><tbody>${each(AREAS, (a) => `<tr><th scope="row">${esc(AREA_NAMES[a])}</th><td>${checkbox(`${prefix}${a}.view`, `See ${AREA_NAMES[a]}`, perms?.[a].view ?? false).replace('<span>', '<span class="visually-hidden">')}</td><td>${checkbox(`${prefix}${a}.change`, `Change ${AREA_NAMES[a]}`, perms?.[a].change ?? false).replace('<span>', '<span class="visually-hidden">')}</td></tr>`)}</tbody></table>`;
  const STATUS: Record<string, string> = { invited: 'Invited', active: 'Active', disabled: 'Switched off' };
  return `${pageHead('Staff and roles')}
${panel('Staff', `${table(['Name', 'Email', 'Role', 'Status', 'Last signed in', ''], people.map((p) => [raw(`<span class="strong">${esc(p.name)}</span>`), p.email, p.roleName, STATUS[p.status] ?? p.status, p.lastSignInAt ? date(p.lastSignInAt, true) : '', raw(p.isOwner ? '' : `<details><summary class="link small">Change</summary>${form(`/api/staff/${p.id}/role`, select('roleId', 'Role', roleOptions, String(p.roleId), { data: 'number' }), { submit: 'Change role' })}<div class="row">${postButton('Reset access', `/api/staff/${p.id}/reset`, { kind: 'text', confirm: `Reset ${p.name}'s access? They will get an email to set a new password and authenticator.` })}${p.status !== 'disabled' ? postButton('Switch off', `/api/staff/${p.id}/disable`, { kind: 'text', confirm: `Switch off ${p.name}'s account? They are signed out at once.` }) : ''}</div></details>`)]), { caption: 'Staff', minWidth: 760 })}
<details><summary class="strong small">Invite someone</summary>${form('/api/staff/invite', `${input('name', 'Name')}${input('email', 'Email', { type: 'email' })}${select('roleId', 'Role', roleOptions.filter(([v]) => !roles.find((r) => String(r.id) === v)?.isOwner), '', { data: 'number' })}`, { submit: 'Send invitation' })}</details>`)}
${panel('Roles', `${each(roles, (r) => `<details class="stack stack--sm"><summary class="strong">${esc(r.name)}${r.isOwner ? ' <span class="small muted">(can do everything)</span>' : ''}</summary>${r.isOwner ? '' : form(`/api/roles/${r.id}/permissions`, permissionFields('permissions.', r.permissions), { submit: 'Save role' })}</details>`)}
<details><summary class="strong small">Add a role</summary>${form('/api/roles', `${input('name', 'Name')}${permissionFields('permissions.')}`, { submit: 'Add role' })}</details>`)}`;
}

// ----- homepage, content pages and emails -----

const SECTION_NAMES: Record<string, string> = { hero: 'Top banner', collections: 'Collections', best_sellers: 'Best sellers', new_arrivals: 'New arrivals', shop_the_look: 'Shop the look', reviews: 'Reviews' };

export async function homepage(ac: AdminContext): Promise<string> {
  const sections = await listHomepage(ac.deps.db);
  const change = can(ac.staff, 'settings', 'change');
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  return `${pageHead('Homepage', `<a class="btn btn--secondary" href="${esc(siteBase(ac))}/" target="_blank" rel="noopener">View the shop</a>`)}
<p class="muted">Sections show in order of their position, lowest first. Words left empty keep the shop's own wording.</p>
${each(sections, (sec) =>
    panel(
      `${SECTION_NAMES[sec.kind] ?? sec.kind}${sec.isShown ? '' : ' (hidden)'}`,
      change
        ? form(
            `/api/homepage/${sec.id}`,
            `<div class="fields fields--2">${input('position', 'Position', { value: sec.position, data: 'number' })}<div class="field">${checkbox('isShown', 'Shown on the homepage', sec.isShown)}</div></div>${
              sec.kind === 'hero'
                ? `${input('settings.headline', 'Headline', { value: s(sec.settings.headline) })}${textarea('settings.sentence', 'Sentence under it', s(sec.settings.sentence), { rows: 2 })}<div class="fields fields--2">${input('settings.buttonLabel', 'Button words', { value: s(sec.settings.buttonLabel) })}${input('settings.buttonLink', 'Button link', { value: s(sec.settings.buttonLink), help: 'A page on this shop, such as /c/wigs/' })}</div>`
                : input('settings.title', 'Heading', { value: s(sec.settings.title) })
            }`,
            { submit: 'Save section' },
          )
        : '',
    ),
  )}`;
}

function siteBase(ac: AdminContext): string {
  const c = ac.deps.config;
  return c.env === 'production' ? `https://${c.hosts.site}` : `http://${c.hosts.site}:${c.port}`;
}

const CONTENT_KINDS: Array<[string, string]> = [['information', 'Information'], ['policy', 'Policy'], ['legal', 'Legal'], ['guide', 'Guide'], ['faq', 'Questions and answers']];

export async function contentList(ac: AdminContext): Promise<string> {
  const pages = await listContent(ac.deps.db);
  const change = can(ac.staff, 'settings', 'change');
  return `${pageHead('Content pages', change ? '<a class="btn btn--primary" href="/content/new/">Add a page</a>' : '')}
<p class="muted">The shop shows its own starting text for a page until one is published here.</p>
${pages.length ? table(['Page', 'Address', 'Kind', 'Status', 'Updated'], pages.map((p) => [raw(`<a class="link" href="/content/${Number(p.id)}/">${esc(String(p.title))}</a>`), `/${String(p.slug)}/`, CONTENT_KINDS.find(([k]) => k === p.kind)?.[1] ?? String(p.kind), p.status === 'published' ? 'Published' : 'Draft', date(String(p.updatedAt))]), { caption: 'Content pages', minWidth: 640 }) : '<div class="aempty"><h2 class="h3">No pages yet</h2><p class="muted">Add the shipping, returns, privacy and terms pages here.</p></div>'}`;
}

export async function contentEditor(ac: AdminContext, id: number | null): Promise<{ title: string; body: string } | null> {
  const pages = await listContent(ac.deps.db);
  const p = id === null ? null : pages.find((x) => Number(x.id) === id);
  if (id !== null && !p) return null;
  const change = can(ac.staff, 'settings', 'change');
  const v = (k: string): string => (p && typeof p[k] === 'string' ? (p[k] as string) : '');
  const fields = `${input('title', 'Title', { value: v('title') })}${input('slug', 'Address', { value: v('slug'), help: 'Lower-case letters, numbers and dashes. The page is at /<this>/.' })}${select('kind', 'Kind', CONTENT_KINDS, v('kind') || 'information')}${textarea('body', 'Text', v('body'), { rows: 16, help: 'Leave a blank line between paragraphs. A line starting with "## " is a heading; a line starting with "- " is a list item.' })}${input('searchDescription', 'Description for search engines', { value: v('searchDescription') })}${select('status', 'Status', [['draft', 'Draft'], ['published', 'Published']], v('status') || 'draft')}`;
  const title = p ? String(p.title) : 'Add a page';
  return {
    title,
    body: `${pageHead(title, p && change ? postButton('Delete page', `/api/content/${id}/delete`, { kind: 'text', confirm: 'Delete this page? The shop goes back to its starting text.', next: '/content/' }) : '', '<a class="link" href="/content/">Content pages</a>')}${panel('', change ? form(p ? `/api/content/${id}` : '/api/content', fields, { submit: p ? 'Save page' : 'Create page', next: p ? undefined : '/content/{id}/', reload: Boolean(p) }) : `<div class="prose">${esc(v('body'))}</div>`)}`,
  };
}

export async function emails(ac: AdminContext): Promise<string> {
  const messages = await listMessages(ac.deps.db);
  const change = can(ac.staff, 'settings', 'change');
  const CATEGORY: Record<string, string> = { account: 'Signing in', orders: 'Orders', marketing: 'Offers and reminders', staff: 'Staff' };
  return `${pageHead('Emails')}
<p class="muted">Each email keeps the shop's layout; you can change its subject and opening words. "Send me a test" sends it to your own address with sample details.</p>
${table(['Email', 'For', 'Subject', 'Sent', ''], messages.map((m) => [raw(`<span class="strong">${esc(String(m.name))}</span>${m.changed ? ' <span class="small muted">(changed)</span>' : ''}`), CATEGORY[String(m.category)] ?? String(m.category), String(m.subject), m.emailEnabled ? 'Yes' : 'Switched off', raw(`<details><summary class="link small">Open</summary><div class="stack stack--sm">${change ? form(`/api/messages/${esc(String(m.key))}`, `${input('subject', 'Subject', { value: String(m.subject) })}${textarea('intro', 'Opening words', String(m.intro), { rows: 4 })}${m.canSwitchOff ? checkbox('emailEnabled', 'Send this email', m.emailEnabled === true) : ''}`, { submit: 'Save email' }) : ''}<div class="row"><a class="btn btn--text small" href="/api/messages/${esc(String(m.key))}/preview" target="_blank" rel="noopener">Preview</a>${postButton('Send me a test', `/api/messages/${esc(String(m.key))}/test`, { kind: 'text' })}</div></div></details>`)]), { caption: 'Emails', minWidth: 760 })}`;
}

// ----- shipping -----

export async function shippingPage(ac: AdminContext, extras: LiveExtras): Promise<string> {
  const change = can(ac.staff, 'settings', 'change');
  const origin = await readShipFrom(ac.deps.db);
  const boxes = await listPackageSizes(ac.deps.db);
  const local = await listLocalRates(ac.deps.db);
  const carriers = extras.shipping ? await listCarriers(ac.deps.db, extras.shipping.carriers) : [];
  const o = (k: string): string => (origin ? String((origin as unknown as Record<string, unknown>)[k] ?? '') : '');
  return `${pageHead('Shipping settings')}
${panel('Sending from', `${origin ? '' : '<p class="astatus astatus--bad">Not set yet: labels cannot be bought until it is.</p>'}${change ? form('/api/shipping/origin', `<div class="fields fields--2">${input('name', 'Contact name', { value: o('name') })}${input('company', 'Business name', { value: o('company') })}</div><div class="fields fields--2">${input('phone', 'Phone', { value: o('phone'), type: 'tel' })}${input('email', 'Email', { value: o('email'), type: 'email' })}</div>${input('line1', 'Address', { value: o('line1') })}${input('line2', 'Address, second line', { value: o('line2') })}<div class="fields fields--3">${input('city', 'City', { value: o('city') })}${input('region', 'State', { value: o('region') })}${input('postalCode', 'Postcode', { value: o('postalCode') })}</div><div class="fields fields--2">${input('country', 'Country (two letters)', { value: o('country') || 'NG' })}${input('originCountry', 'Where the hair was made (two letters, for customs)', { value: o('originCountry') })}</div>`, { submit: 'Save address' }) : ''}`)}
${panel('Delivery in Nigeria', `${local.rates.length ? table(['Zone', 'States', 'Courier', 'Takes', 'Price', ''], local.rates.map((r) => [raw(`<span class="strong">${esc(r.zoneName)}</span>${r.enabled ? '' : ' <span class="small muted">(off)</span>'}`), r.states.join(', '), r.courier, r.deliveryTime, num(money(ac, r.priceMinor, 'NGN')), raw(change ? `<details><summary class="link small">Edit</summary>${form(`/api/shipping/local-rates/${r.id}`, localRateFields(ac, r), { submit: 'Save zone' })}${postButton('Remove', `/api/shipping/local-rates/${r.id}/delete`, { kind: 'text', confirm: 'Remove this zone?' })}</details>` : '')]), { caption: 'Local delivery zones', minWidth: 760 }) : '<p class="muted small">No zones yet: customers in Nigeria cannot check out.</p>'}
${change ? `<details><summary class="strong small">Add a zone</summary>${form('/api/shipping/local-rates', localRateFields(ac, null), { submit: 'Add zone' })}</details>` : ''}<p class="small muted">Each state can be in one zone only. States: ${esc(local.states.join(', '))}.</p>`)}
${panel('Carriers abroad', extras.shipping ? table(['Carrier', 'Account keys', 'Mark-up', 'On', ''], carriers.map((c) => [raw(`<span class="strong">${esc(c.name)}</span>`), c.configured ? `Set (${c.mode ?? 'live'})` : 'Not set', num(`${c.markupBps / 100}%`), c.enabled ? 'Yes' : 'No', raw(change ? `<details><summary class="link small">Edit</summary>${form(`/api/shipping/carriers/${c.code}`, `${checkbox('enabled', 'Offer this carrier', c.enabled)}${input('markupBps', 'Mark-up (100 = 1%)', { value: c.markupBps, data: 'number' })}`, { submit: 'Save carrier' })}</details>` : '')]), { caption: 'Carriers', minWidth: 640 }) + '<p class="small muted">Account keys live in the server settings, not here. See docs/shipping.md.</p>' : '<p class="muted">Shipping is not running on this server.</p>')}
${panel('Boxes', `${table(['Box', 'Inside size (cm)', 'Empty weight', ''], boxes.map((b) => [b.name, `${b.lengthMm / 10} × ${b.widthMm / 10} × ${b.heightMm / 10}`, num(`${b.emptyWeightGrams} g`), raw(change ? `<details><summary class="link small">Edit</summary>${form(`/api/shipping/package-sizes/${b.id}`, boxFields(b), { submit: 'Save box' })}${postButton('Remove', `/api/shipping/package-sizes/${b.id}/delete`, { kind: 'text', confirm: 'Remove this box?' })}</details>` : '')]), { caption: 'Boxes', minWidth: 560 })}
${change ? `<details><summary class="strong small">Add a box</summary>${form('/api/shipping/package-sizes', boxFields(null), { submit: 'Add box' })}</details>` : ''}`)}`;
}

function localRateFields(ac: AdminContext, r: { zoneName: string; states: string[]; courier: string; deliveryTime: string; priceMinor: number; position: number; enabled: boolean } | null): string {
  return `${input('zoneName', 'Zone name', { value: r?.zoneName })}${input('states', 'States (with commas)', { value: r?.states.join(', '), data: 'list' })}<div class="fields fields--3">${input('courier', 'Courier', { value: r?.courier })}${input('deliveryTime', 'Takes', { value: r?.deliveryTime, help: 'For example: 1 to 2 working days' })}${input('priceMinor', 'Price (₦)', { value: r ? r.priceMinor / 10 ** (ac.currencies.get('NGN')?.minorUnits ?? 2) : '', data: 'minor' })}</div><div class="fields fields--2">${input('position', 'Position', { value: r?.position ?? 0, data: 'number' })}<div class="field">${checkbox('enabled', 'Offered', r?.enabled ?? true)}</div></div>`;
}

function boxFields(b: { name: string; lengthMm: number; widthMm: number; heightMm: number; emptyWeightGrams: number } | null): string {
  return `${input('name', 'Name', { value: b?.name })}<div class="fields fields--3">${input('lengthMm', 'Length (mm)', { value: b?.lengthMm, data: 'number' })}${input('widthMm', 'Width (mm)', { value: b?.widthMm, data: 'number' })}${input('heightMm', 'Height (mm)', { value: b?.heightMm, data: 'number' })}</div>${input('emptyWeightGrams', 'Empty weight (g)', { value: b?.emptyWeightGrams, data: 'number' })}`;
}

// ----- payments and currencies -----

export async function paymentsPage(ac: AdminContext, extras: LiveExtras): Promise<string> {
  const change = can(ac.staff, 'settings', 'change');
  const currencies = await listCurrencySettings(ac.deps.db, ac.staff);
  const p = extras.payments?.providers;
  const providerRow = (label: string, codes: string, configured: boolean, mode: string | null): Array<string | { html: string }> => [raw(`<span class="strong">${esc(label)}</span>`), codes, configured ? `Keys set (${mode ?? 'live'} mode)` : 'Keys not set', raw(configured ? '<span class="astatus astatus--good">Taking payments</span>' : '<span class="astatus astatus--bad">Not taking payments</span>')];
  return `${pageHead('Payments and currencies')}
${panel('Payment providers', p ? `${table(['Provider', 'Currencies', 'Keys', 'Status'], [providerRow('Paystack', 'NGN', p.paystack.configured, p.paystack.mode), providerRow('Stripe', 'USD, GBP, EUR', p.stripe.configured, p.stripe.mode)], { caption: 'Payment providers' })}<p class="small muted">Keys live in the server settings, not here. See docs/payments.md.</p>` : '<p class="muted">Payments are not running on this server.</p>')}
${panel('Currencies', `${table(['Currency', 'Paid through', 'Rate from ₦1', 'Rate', 'Mark-up', 'Rounding', ''], currencies.map((c) => [raw(`<span class="strong">${esc(c.code)}</span> ${esc(c.name)}${c.isBase ? ' <span class="small muted">(main)</span>' : ''}`), c.provider === 'paystack' ? 'Paystack' : 'Stripe', c.isBase ? '' : num(c.rateFromBase === null ? 'none' : String(c.rateFromBase)), c.isBase ? '' : `${c.rateSource === 'daily' ? 'Daily' : 'Set by hand'}${c.rateUpdatedAt ? `, ${date(c.rateUpdatedAt, true)}` : ''}`, c.isBase ? '' : num(`${c.markupBps / 100}%`), num(String(c.roundingMinor)), raw(change && !c.isBase ? `<details><summary class="link small">Edit</summary>${form(`/api/currencies/${c.code}`, `${select('rateSource', 'Rate', [['daily', 'Fetched each day'], ['manual', 'Set by hand']], c.rateSource)}${input('rateFromBase', 'Rate from ₦1 (when set by hand)', { value: c.rateFromBase, attrs: 'inputmode="decimal"' })}${input('markupBps', 'Mark-up (100 = 1%)', { value: c.markupBps, data: 'number' })}${input('roundingMinor', 'Round prices up to (in the smallest unit, 100 = whole)', { value: c.roundingMinor, data: 'number' })}`, { submit: 'Save currency' })}</details>` : '')]), { caption: 'Currencies', minWidth: 860 })}
${change ? postButton('Fetch today’s rates now', '/api/currencies/refresh') : ''}`)}`;
}

// ----- store settings, activity, system -----

export async function storeSettings(ac: AdminContext): Promise<string> {
  const change = can(ac.staff, 'settings', 'change');
  const store = await readStore(ac.deps.db);
  const returns = await returnSettings(ac.deps.db);
  return `${pageHead('Store settings')}
${panel('Store details', change ? form('/api/settings/store', `${input('name', 'Store name', { value: store.name })}${input('supportEmail', 'Customer help email', { value: store.supportEmail, type: 'email' })}${input('whatsapp', 'WhatsApp number', { value: store.whatsapp, type: 'tel', help: 'With the country code, such as +2348000000000' })}`, { submit: 'Save details' }) : `<p>${esc(store.name)}</p>`)}
${panel('Returns', change ? form('/api/settings/returns', `${input('windowDays', 'Days to return after delivery', { value: returns.windowDays, data: 'number' })}${input('storeCreditBonusBps', 'Extra for taking store credit (100 = 1%)', { value: returns.storeCreditBonusBps, data: 'number' })}`, { submit: 'Save returns' }) : `<p>${returns.windowDays} days</p>`)}`;
}

export async function activityPage(ac: AdminContext): Promise<string> {
  const list = await listActivity(ac.deps.db, ac.ctx.query);
  const area = ac.ctx.query.get('area') ?? '';
  const link = (p: number): string => {
    const q = new URLSearchParams(ac.ctx.query);
    q.set('page', String(p));
    return `/activity/?${q.toString()}`;
  };
  return `${pageHead('Activity log')}
<form class="afilters" method="get" action="/activity/"><label class="afilter" for="aa"><span class="visually-hidden">Area</span><select id="aa" name="area" data-autosubmit><option value="">Area: any</option>${each(list.areas, (a) => `<option${a === area ? ' selected' : ''}>${esc(a)}</option>`)}</select></label><button class="btn btn--secondary" type="submit">Apply</button></form>
${list.entries.length ? table(['When', 'Who', 'Area', 'What'], list.entries.map((e) => [date(String(e.at), true), String(e.staff), String(e.area), String(e.summary)]), { caption: 'Activity', minWidth: 720 }) : '<div class="aempty"><h2 class="h3">Nothing yet</h2></div>'}
<nav class="apager small muted" aria-label="Pages"><span></span><span class="apager__links">${list.page > 1 ? `<a href="${esc(link(list.page - 1))}">‹ Newer</a>` : ''}${list.more ? `<a href="${esc(link(list.page + 1))}">Older ›</a>` : ''}</span></nav>`;
}

const TASK_NAMES: Record<string, string> = {
  expire_unpaid_orders: 'Cancel orders left unpaid',
  refresh_tracking: 'Check parcel tracking',
  daily_exchange_rates: 'Fetch exchange rates',
  back_in_stock_alerts: 'Back-in-stock emails',
  low_stock_alerts: 'Low-stock emails to staff',
  abandoned_cart_reminders: 'Bag reminders',
  daily_cleanup: 'Daily clean-up',
};

export async function systemPage(ac: AdminContext): Promise<string> {
  const status = ac.ctx.query.get('status');
  const jobs = await listJobs(ac.deps.db, status);
  const runs = await ac.deps.db.query('select name, last_started_at, last_finished_at, last_error, running_since from scheduled_runs');
  const byName = new Map(runs.rows.map((r) => [String(r.name), r]));
  const change = can(ac.staff, 'settings', 'change');
  const t = (k: string): string => `${k[0]?.toUpperCase()}${k.slice(1)} (${jobs.counts[k] ?? 0})`;
  return `${pageHead('System')}
${panel('Scheduled tasks', table(['Task', 'Every', 'Last ran', 'Problem'], SCHEDULE.map((task) => {
    const r = byName.get(task.name);
    return [TASK_NAMES[task.name] ?? task.name, task.everyMinutes >= 1440 ? 'Day' : task.everyMinutes >= 60 ? `${task.everyMinutes / 60} h` : `${task.everyMinutes} min`, r?.running_since ? 'Running now' : r?.last_finished_at ? date(r.last_finished_at as Date, true) : 'Not yet', String(r?.last_error ?? '')];
  }), { caption: 'Scheduled tasks', minWidth: 640 }) + '<p class="small muted">If nothing has run for a while, the worker is stopped. See docs/worker.md.</p>')}
${panel('Jobs', `${tabs('Job status', [['All', '/system/', !status], [t('queued'), '/system/?status=queued', status === 'queued'], [t('failed'), '/system/?status=failed', status === 'failed'], [t('done'), '/system/?status=done', status === 'done']])}
${jobs.jobs.length ? table(['Job', 'Kind', 'Status', 'Tries', 'Runs at', 'Problem', ''], jobs.jobs.map((j) => [num(String(j.id)), String(j.kind), String(j.status), num(`${String(j.attempts)} of ${String(j.maxAttempts)}`), date(String(j.runAt), true), String(j.lastError ?? ''), raw(change && j.status === 'failed' ? postButton('Try again', `/api/system/jobs/${Number(j.id)}/retry`, { kind: 'text' }) : '')]), { caption: 'Jobs', minWidth: 860 }) : '<p class="muted">No jobs.</p>'}`)}`;
}


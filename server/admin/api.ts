// Admin addresses that the earlier modules did not need: customers, the
// activity log, content pages, the homepage, store details and reports.
//
//   GET  /api/customers?q=&page=            customers, newest first           (customers view)
//   GET  /api/customers/:id                 one customer with orders and addresses
//   POST /api/customers/:id                 { internalNote, status: active | disabled }   (customers change)
//   GET  /api/activity?area=&staff=&page=   the activity log                  (settings view)
//   GET  /api/content                       content pages                     (settings view)
//   POST /api/content                       add; POST /api/content/:id change; /:id/delete   (settings change)
//   GET  /api/homepage                      homepage sections                 (settings view)
//   POST /api/homepage/:id                  { isShown, position, settings }   (settings change)
//   GET  /api/settings/store                store name, support email, WhatsApp number   (settings view)
//   POST /api/settings/store                (settings change)
//   GET  /api/reports/sales?from=&to=       sales by day and currency, top products, totals   (reports view)
//   GET  /api/reports/sales.csv?from=&to=   the same days as a spreadsheet file

import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess, type Area, type StaffMember } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import type { Db, DbClient } from '../db/pool.js';
import { ApiError, clientIp, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';

type Q = { query: DbClient['query'] } | Db;

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', message, { [field]: message });
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ----- customers -----

export async function listCustomers(db: Q, query: URLSearchParams): Promise<{ customers: Array<Record<string, unknown>>; total: number; page: number }> {
  const q = (query.get('q') ?? '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number(query.get('page')) || 1));
  const values: unknown[] = [];
  let where = "c.status <> 'deleted'";
  if (q) {
    values.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where += ` and (c.email ilike $1 or (c.first_name || ' ' || c.last_name) ilike $1 or c.phone ilike $1)`;
  }
  const total = Number((await db.query(`select count(*)::int as n from customers c where ${where}`, values)).rows[0]?.n ?? 0);
  const rows = await db.query(
    `select c.id, c.email, c.first_name, c.last_name, c.phone, c.status, c.marketing_consent, c.created_at, c.last_sign_in_at,
            (select count(*)::int from orders o where o.customer_id = c.id and o.payment_status in ('paid', 'partly_refunded', 'refunded')) as orders,
            (select max(placed_at) from orders o where o.customer_id = c.id) as last_order
     from customers c where ${where} order by c.created_at desc, c.id desc limit 50 offset ${(page - 1) * 50}`,
    values,
  );
  return {
    customers: rows.rows.map((r) => ({ id: Number(r.id), email: r.email, name: `${String(r.first_name)} ${String(r.last_name)}`.trim(), phone: r.phone, status: r.status, marketingConsent: r.marketing_consent === true, joinedAt: (r.created_at as Date).toISOString(), lastSignInAt: r.last_sign_in_at ? (r.last_sign_in_at as Date).toISOString() : null, orders: r.orders, lastOrderAt: r.last_order ? (r.last_order as Date).toISOString() : null })),
    total,
    page,
  };
}

export async function customerDetail(db: Q, id: number): Promise<Record<string, unknown>> {
  const c = (await db.query("select * from customers where id = $1 and status <> 'deleted'", [id])).rows[0];
  if (!c) throw new ApiError(404, 'not_found', 'We could not find that customer.');
  const orders = await db.query('select id, number, placed_at, status, payment_status, currency, total_minor from orders where customer_id = $1 order by placed_at desc limit 50', [id]);
  const spent = await db.query("select currency, sum(total_minor)::bigint as total from orders where customer_id = $1 and payment_status in ('paid', 'partly_refunded') group by currency order by currency", [id]);
  const addresses = await db.query('select full_name, line1, city, region, country, is_default from addresses where customer_id = $1 order by is_default desc, id', [id]);
  return {
    id: Number(c.id),
    email: c.email,
    firstName: c.first_name,
    lastName: c.last_name,
    phone: c.phone,
    status: c.status,
    emailVerified: c.email_verified_at !== null,
    marketingConsent: c.marketing_consent === true,
    loyaltyPoints: Number(c.loyalty_points),
    loyaltyTier: c.loyalty_tier,
    internalNote: c.internal_note,
    joinedAt: (c.created_at as Date).toISOString(),
    orders: orders.rows.map((o) => ({ id: Number(o.id), number: o.number, placedAt: (o.placed_at as Date).toISOString(), status: o.status, paymentStatus: o.payment_status, currency: o.currency, totalMinor: Number(o.total_minor) })),
    spent: spent.rows.map((s) => ({ currency: s.currency, totalMinor: Number(s.total) })),
    addresses: addresses.rows.map((a) => ({ name: a.full_name, line1: a.line1, city: a.city, region: a.region, country: a.country, isDefault: a.is_default === true })),
  };
}

export async function updateCustomer(db: Q, id: number, input: Record<string, unknown>, now: Date): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  if (input.internalNote !== undefined) {
    values.push(text(input.internalNote, 2000));
    sets.push(`internal_note = $${values.length}`);
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'disabled') throw invalid('status', 'Choose active or disabled.');
    values.push(input.status);
    sets.push(`status = $${values.length}`);
  }
  if (!sets.length) return;
  const changed = await db.query(`update customers set ${sets.join(', ')} where id = $1 and status <> 'deleted'`, values);
  if (!changed.rowCount) throw new ApiError(404, 'not_found', 'We could not find that customer.');
  // A disabled customer is signed out everywhere.
  if (input.status === 'disabled') await db.query('update customer_sessions set revoked_at = coalesce(revoked_at, $2) where customer_id = $1', [id, now]);
}

// ----- activity log -----

export async function listActivity(db: Q, query: URLSearchParams): Promise<{ entries: Array<Record<string, unknown>>; page: number; more: boolean; areas: string[] }> {
  const page = Math.max(1, Math.min(10_000, Number(query.get('page')) || 1));
  const values: unknown[] = [];
  const where: string[] = [];
  const area = query.get('area');
  if (area) where.push(`area = $${values.push(area)}`);
  const staff = Number(query.get('staff'));
  if (Number.isInteger(staff) && staff > 0) where.push(`staff_id = $${values.push(staff)}`);
  const found = await db.query(`select id, staff_name, area, summary, entity_type, entity_id, created_at from activity_log ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at desc, id desc limit 51 offset ${(page - 1) * 50}`, values);
  const areas = await db.query('select distinct area from activity_log order by area');
  return {
    entries: found.rows.slice(0, 50).map((r) => ({ id: Number(r.id), staff: r.staff_name, area: r.area, summary: r.summary, entityType: r.entity_type, entityId: r.entity_id, at: (r.created_at as Date).toISOString() })),
    page,
    more: found.rows.length > 50,
    areas: areas.rows.map((r) => String(r.area)),
  };
}

// ----- content pages -----

const KINDS = ['information', 'policy', 'legal', 'guide', 'faq'];

export async function listContent(db: Q): Promise<Array<Record<string, unknown>>> {
  const found = await db.query('select id, slug, title, kind, status, body, search_description, published_at, updated_at from content_pages order by slug');
  return found.rows.map((r) => ({ id: Number(r.id), slug: r.slug, title: r.title, kind: r.kind, status: r.status, body: r.body, searchDescription: r.search_description, publishedAt: r.published_at ? (r.published_at as Date).toISOString() : null, updatedAt: (r.updated_at as Date).toISOString() }));
}

export async function saveContent(db: Q, id: number | null, input: Record<string, unknown>, staffId: number, now: Date): Promise<{ id: number; slug: string }> {
  const slug = text(input.slug, 80).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw invalid('slug', 'Use lower-case letters, numbers and dashes, such as "shipping".');
  const title = text(input.title, 120);
  if (!title) throw invalid('title', 'Enter a title.');
  const kind = KINDS.includes(String(input.kind)) ? String(input.kind) : 'information';
  const body = typeof input.body === 'string' ? input.body.slice(0, 50_000) : '';
  const status = input.status === 'published' ? 'published' : 'draft';
  const description = text(input.searchDescription, 160) || null;
  try {
    if (id === null) {
      const made = await db.query('insert into content_pages (slug, title, kind, body, search_description, status, published_at, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id', [slug, title, kind, body, description, status, status === 'published' ? now : null, staffId]);
      return { id: Number(made.rows[0]?.id), slug };
    }
    const changed = await db.query(
      "update content_pages set slug = $2, title = $3, kind = $4, body = $5, search_description = $6, status = $7, published_at = case when $7 = 'published' then coalesce(published_at, $8) else null end, updated_by = $9 where id = $1",
      [id, slug, title, kind, body, description, status, now, staffId],
    );
    if (!changed.rowCount) throw new ApiError(404, 'not_found', 'We could not find that page.');
    return { id, slug };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw invalid('slug', 'Another page already uses this address.');
    throw error;
  }
}

// ----- homepage -----

export const SECTION_KINDS = ['hero', 'collections', 'best_sellers', 'new_arrivals', 'shop_the_look', 'reviews'] as const;

export interface HomepageSection {
  id: number;
  kind: string;
  position: number;
  isShown: boolean;
  settings: Record<string, unknown>;
  /** When it starts and stops showing (ISO times), and the countries it shows in (empty: everywhere). */
  showFrom: string | null;
  showUntil: string | null;
  countries: string[];
}

export async function listHomepage(db: Q): Promise<HomepageSection[]> {
  // Every kind has a row, so staff always see all of them.
  for (const [i, kind] of SECTION_KINDS.entries()) {
    await db.query('insert into homepage_sections (kind, position, is_shown) select $1, $2, $3 where not exists (select 1 from homepage_sections where kind = $1)', [kind, i, kind !== 'reviews']);
  }
  const found = await db.query('select id, kind, position, is_shown, settings, show_from, show_until, countries from homepage_sections order by position, id');
  const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
  return found.rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    position: Number(r.position),
    isShown: r.is_shown === true,
    settings: (r.settings ?? {}) as Record<string, unknown>,
    showFrom: iso(r.show_from),
    showUntil: iso(r.show_until),
    countries: ((r.countries as string[] | null) ?? []).map(String),
  }));
}

export async function saveSection(db: Q, id: number, input: Record<string, unknown>): Promise<void> {
  const row = (await db.query('select kind, settings from homepage_sections where id = $1', [id])).rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'We could not find that section.');
  const settings = { ...((row.settings ?? {}) as Record<string, unknown>) };
  if (input.settings && typeof input.settings === 'object') {
    const s = input.settings as Record<string, unknown>;
    // Only the words a section shows can be set; each is plain text.
    // (Its pictures are set by uploading them: server/admin/pictures.ts.)
    for (const key of ['headline', 'sentence', 'buttonLabel', 'buttonLink', 'title', 'alt']) {
      if (s[key] === undefined) continue;
      const v = text(s[key], key === 'sentence' ? 300 : 120);
      if (key === 'buttonLink' && v && !/^\/[a-z0-9/_?=&.-]*$/i.test(v)) throw invalid('buttonLink', 'Use a link on this shop, starting with /, such as /c/wigs/.');
      settings[key] = v;
    }
  }
  const position = input.position === undefined ? null : Number(input.position);
  if (position !== null && (!Number.isInteger(position) || position < 0 || position > 100)) throw invalid('position', 'Enter a position from 0 to 100.');
  // Dates and countries: only changed when sent. An empty value clears them.
  const when = (key: 'showFrom' | 'showUntil'): Date | null | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    // A date-and-time field sends Lagos time without a zone (UTC+1 all year).
    const raw = String(v);
    const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw.length === 16 ? `${raw}:00` : raw}+01:00` : raw);
    if (Number.isNaN(d.getTime())) throw invalid(key, 'Enter a date and time.');
    return d;
  };
  const current = (await db.query('select show_from, show_until, countries from homepage_sections where id = $1', [id])).rows[0] ?? {};
  const fromIn = when('showFrom');
  const untilIn = when('showUntil');
  const from = fromIn === undefined ? ((current.show_from as Date | null) ?? null) : fromIn;
  const until = untilIn === undefined ? ((current.show_until as Date | null) ?? null) : untilIn;
  if (from && until && until.getTime() <= new Date(from).getTime()) throw invalid('showUntil', 'The end must be after the start.');
  let countries = ((current.countries as string[] | null) ?? []).map(String);
  if (input.countries !== undefined) {
    const list = Array.isArray(input.countries) ? input.countries.map(String) : String(input.countries ?? '').split(/[\s,]+/);
    countries = [...new Set(list.map((c) => c.trim().toUpperCase()).filter(Boolean))];
    if (countries.some((c) => !/^[A-Z]{2}$/.test(c))) throw invalid('countries', 'Use two-letter country codes separated by commas, such as NG, GB, US.');
  }
  await db.query(
    'update homepage_sections set is_shown = coalesce($2, is_shown), position = coalesce($3, position), settings = $4, show_from = $5, show_until = $6, countries = $7 where id = $1',
    [id, typeof input.isShown === 'boolean' ? input.isShown : null, position, JSON.stringify(settings), from, until, countries],
  );
}


// ----- store details -----

export async function readStore(db: Q): Promise<{ name: string; supportEmail: string; whatsapp: string }> {
  const v = ((await db.query("select value from store_settings where key = 'store'")).rows[0]?.value ?? {}) as Record<string, unknown>;
  return { name: String(v.name ?? 'hairbydemj'), supportEmail: String(v.support_email ?? ''), whatsapp: String(v.whatsapp ?? '') };
}

export async function saveStore(db: Q, input: Record<string, unknown>, staffId: number): Promise<void> {
  const current = ((await db.query("select value from store_settings where key = 'store'")).rows[0]?.value ?? {}) as Record<string, unknown>;
  const name = text(input.name, 80) || 'hairbydemj';
  const email = text(input.supportEmail, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('supportEmail', 'Enter a valid email address.');
  const whatsapp = text(input.whatsapp, 20).replace(/[^0-9+]/g, '');
  if (whatsapp && !/^\+?[0-9]{8,15}$/.test(whatsapp)) throw invalid('whatsapp', 'Enter the WhatsApp number with its country code, such as +2348000000000.');
  await db.query("insert into store_settings (key, value, updated_by) values ('store', $1, $2) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by", [JSON.stringify({ ...current, name, support_email: email, whatsapp }), staffId]);
}

// ----- reports -----

export interface SalesReport {
  from: string;
  to: string;
  byDay: Array<{ day: string; currency: string; orders: number; salesMinor: number }>;
  totals: Array<{ currency: string; orders: number; salesMinor: number; averageMinor: number; refundsMinor: number }>;
  topProducts: Array<{ name: string; quantity: number }>;
  statusCounts: Record<string, number>;
}

/** Paid sales over a range of days (Lagos time), by day and currency. */
export async function salesReport(db: Q, fromText: string | null, toText: string | null, now: Date): Promise<SalesReport> {
  const day = (d: Date): string => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
  const to = toText && /^\d{4}-\d{2}-\d{2}$/.test(toText) ? toText : day(now);
  const from = fromText && /^\d{4}-\d{2}-\d{2}$/.test(fromText) ? fromText : day(new Date(now.getTime() - 29 * 86_400_000));
  if (from > to) throw invalid('from', 'The start must be before the end.');
  const range = "o.paid_at >= ($1::date)::timestamp at time zone 'Africa/Lagos' and o.paid_at < ($2::date + 1)::timestamp at time zone 'Africa/Lagos'";
  const byDay = await db.query(
    `select to_char(o.paid_at at time zone 'Africa/Lagos', 'YYYY-MM-DD') as day, o.currency, count(*)::int as orders, sum(o.total_minor)::bigint as sales
     from orders o where ${range} group by 1, 2 order by 1, 2`,
    [from, to],
  );
  const totals = await db.query(
    `select o.currency, count(*)::int as orders, sum(o.total_minor)::bigint as sales,
            coalesce((select sum(r.amount_minor) from refunds r join orders o2 on o2.id = r.order_id where r.status = 'succeeded' and o2.currency = o.currency and r.completed_at >= ($1::date)::timestamp at time zone 'Africa/Lagos' and r.completed_at < ($2::date + 1)::timestamp at time zone 'Africa/Lagos'), 0)::bigint as refunds
     from orders o where ${range} group by o.currency order by o.currency`,
    [from, to],
  );
  const top = await db.query(`select oi.product_name, sum(oi.quantity)::int as quantity from order_items oi join orders o on o.id = oi.order_id where ${range} group by 1 order by 2 desc, 1 limit 10`, [from, to]);
  const statuses = await db.query('select status, count(*)::int as n from orders group by status');
  return {
    from,
    to,
    byDay: byDay.rows.map((r) => ({ day: String(r.day), currency: String(r.currency), orders: Number(r.orders), salesMinor: Number(r.sales) })),
    totals: totals.rows.map((r) => ({ currency: String(r.currency), orders: Number(r.orders), salesMinor: Number(r.sales), averageMinor: Math.round(Number(r.sales) / Math.max(1, Number(r.orders))), refundsMinor: Number(r.refunds) })),
    topProducts: top.rows.map((r) => ({ name: String(r.product_name), quantity: Number(r.quantity) })),
    statusCounts: Object.fromEntries(statuses.rows.map((r) => [String(r.status), Number(r.n)])),
  };
}

/** A cell for a spreadsheet: quoted, with formulas made harmless. */
function csvCell(value: string | number): string {
  const s = String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n']/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function salesCsv(report: SalesReport): string {
  const rows: Array<Array<string | number>> = [['Day', 'Currency', 'Orders', 'Sales (minor units)'], ...report.byDay.map((d) => [d.day, d.currency, d.orders, d.salesMinor])];
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function adminApiRoutes(router: Router, deps: AccountDeps): Router {
  const staffFor = async (ctx: RequestContext, area: Area, access: 'view' | 'change'): Promise<StaffMember> => {
    if (ctx.req.method === 'POST') requireSameOrigin(ctx);
    const { staff } = await requireStaff(deps, ctx);
    requireAccess(staff, area, access);
    return staff;
  };
  const id = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };
  const log = (ctx: RequestContext, staff: StaffMember, area: string, summary: string, entity?: { type: string; id: number | string }): Promise<void> => logActivity(deps.db, staff, area, summary, entity, clientIp(ctx.req, deps.config.trustProxy));
  return router
    .get('/api/customers', async (ctx) => {
      await staffFor(ctx, 'customers', 'view');
      sendJson(ctx.res, 200, await listCustomers(deps.db, ctx.query));
    })
    .get('/api/customers/:id', async (ctx) => {
      await staffFor(ctx, 'customers', 'view');
      sendJson(ctx.res, 200, { customer: await customerDetail(deps.db, id(ctx)) });
    })
    .post('/api/customers/:id', async (ctx) => {
      const staff = await staffFor(ctx, 'customers', 'change');
      const input = await readJson(ctx.req);
      await updateCustomer(deps.db, id(ctx), input, deps.now());
      await log(ctx, staff, 'Customers', input.status === 'disabled' ? 'Disabled a customer account' : input.status === 'active' ? 'Turned a customer account back on' : 'Changed a customer note', { type: 'customer', id: id(ctx) });
      sendJson(ctx.res, 200, { customer: await customerDetail(deps.db, id(ctx)) });
    })
    .get('/api/activity', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, await listActivity(deps.db, ctx.query));
    })
    .get('/api/content', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { pages: await listContent(deps.db) });
    })
    .post('/api/content', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const saved = await saveContent(deps.db, null, await readJson(ctx.req, 64 * 1024), staff.id, deps.now());
      await log(ctx, staff, 'Content', `Added the page /${saved.slug}/`, { type: 'content_page', id: saved.id });
      sendJson(ctx.res, 201, saved);
    })
    .post('/api/content/:id', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const saved = await saveContent(deps.db, id(ctx), await readJson(ctx.req, 64 * 1024), staff.id, deps.now());
      await log(ctx, staff, 'Content', `Changed the page /${saved.slug}/`, { type: 'content_page', id: saved.id });
      sendJson(ctx.res, 200, saved);
    })
    .post('/api/content/:id/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const gone = await deps.db.query('delete from content_pages where id = $1 returning slug', [id(ctx)]);
      if (!gone.rowCount) throw new ApiError(404, 'not_found', 'We could not find that page.');
      await log(ctx, staff, 'Content', `Removed the page /${String(gone.rows[0]?.slug)}/`, { type: 'content_page', id: id(ctx) });
      sendJson(ctx.res, 200, { deleted: true });
    })
    .get('/api/homepage', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { sections: await listHomepage(deps.db) });
    })
    .post('/api/homepage/:id', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await saveSection(deps.db, id(ctx), await readJson(ctx.req));
      await log(ctx, staff, 'Content', 'Changed the homepage', { type: 'homepage_section', id: id(ctx) });
      sendJson(ctx.res, 200, { sections: await listHomepage(deps.db) });
    })
    .get('/api/settings/store', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { store: await readStore(deps.db) });
    })
    .post('/api/settings/store', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await saveStore(deps.db, await readJson(ctx.req), staff.id);
      await log(ctx, staff, 'Settings', 'Changed the store details');
      sendJson(ctx.res, 200, { store: await readStore(deps.db) });
    })
    .get('/api/reports/sales', async (ctx) => {
      await staffFor(ctx, 'reports', 'view');
      sendJson(ctx.res, 200, await salesReport(deps.db, ctx.query.get('from'), ctx.query.get('to'), deps.now()));
    })
    .get('/api/reports/sales.csv', async (ctx) => {
      await staffFor(ctx, 'reports', 'view');
      const report = await salesReport(deps.db, ctx.query.get('from'), ctx.query.get('to'), deps.now());
      const body = salesCsv(report);
      ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sales-${report.from}-to-${report.to}.csv"`, 'Cache-Control': 'private, no-store' });
      ctx.res.end(body);
    });
}

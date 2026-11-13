// Sending what the store has to say: emails (from the queue), order updates
// fanned out to email, app push and the in-app list, and the customer's
// choices about what they receive.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { formatMoney } from '../cart/money.js';
import type { Db, DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { Logger } from '../logger.js';
import { buildMessage, addressOf, dkimSign } from './mime.js';
import type { PushMessage, PushSender } from './push.js';
import { sendSmtp, SmtpError } from './smtp.js';
import { fill, layoutHtml, layoutText, returnStatusText, templateFor, type Category, type Links } from './templates.js';

type Q = { query: DbClient['query'] } | Db;

export interface NotifyDeps {
  db: Db;
  now: () => Date;
  logger: Logger;
  config: Config;
  push: { ios: PushSender; android: PushSender };
}

/** An email that can never be sent (bad address, unknown template, refused for good). */
export class Undeliverable extends Error {
  override name = 'Undeliverable';
}

export function links(config: Config): Links {
  const base = (host: string): string => (config.env === 'production' ? `https://${host}` : `http://${host}:${config.port}`);
  return { site: base(config.hosts.site), admin: base(config.hosts.admin) };
}

// ----- unsubscribe links -----

function unsubscribeSignature(config: Config, email: string): string {
  return createHmac('sha256', config.authSecret).update(`unsubscribe:${email.toLowerCase()}`).digest('base64url').slice(0, 32);
}

/** A link that unsubscribes this address from offers. It never runs out, as unsubscribe links must keep working. */
export function unsubscribeToken(config: Config, email: string): string {
  return `${Buffer.from(email.toLowerCase()).toString('base64url')}.${unsubscribeSignature(config, email)}`;
}

export function readUnsubscribeToken(config: Config, token: string): string | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || token.length > 400) return null;
  const email = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(unsubscribeSignature(config, email));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? email : null;
}

/** Stop all offers to this address: the newsletter, and the account's marketing choice. */
export async function unsubscribe(db: Q, email: string, now: Date): Promise<void> {
  await db.query('update newsletter_subscribers set unsubscribed_at = coalesce(unsubscribed_at, $2) where email = $1', [email, now]);
  const customer = await db.query('update customers set marketing_consent = false, marketing_consent_at = $2 where email = $1 returning id', [email, now]);
  const id = customer.rows[0]?.id;
  if (id) await db.query('insert into notification_preferences (customer_id, offers_email) values ($1, false) on conflict (customer_id) do update set offers_email = false', [id]);
}

// ----- preferences -----

export interface Preferences {
  ordersEmail: boolean;
  ordersPush: boolean;
  offersEmail: boolean;
  offersPush: boolean;
  backInStockEmail: boolean;
  backInStockPush: boolean;
}

const COLUMNS: Record<keyof Preferences, string> = {
  ordersEmail: 'orders_email',
  ordersPush: 'orders_push',
  offersEmail: 'offers_email',
  offersPush: 'offers_push',
  backInStockEmail: 'back_in_stock_email',
  backInStockPush: 'back_in_stock_push',
};

export async function readPreferences(db: Q, customerId: number): Promise<Preferences> {
  const found = await db.query('select p.*, c.marketing_consent from customers c left join notification_preferences p on p.customer_id = c.id where c.id = $1', [customerId]);
  const r = found.rows[0] ?? {};
  const pick = (column: string, fallback: boolean): boolean => (r[column] === null || r[column] === undefined ? fallback : r[column] === true);
  return {
    ordersEmail: pick('orders_email', true),
    ordersPush: pick('orders_push', true),
    // Offers by email need the marketing choice too; the two are kept in step.
    offersEmail: r.marketing_consent === true && pick('offers_email', true),
    offersPush: pick('offers_push', false),
    backInStockEmail: pick('back_in_stock_email', true),
    backInStockPush: pick('back_in_stock_push', true),
  };
}

export async function savePreferences(db: Q, customerId: number, input: Record<string, unknown>, now: Date): Promise<Preferences> {
  const sets: string[] = [];
  const values: unknown[] = [customerId];
  for (const [key, column] of Object.entries(COLUMNS)) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') throw new ApiError(422, 'invalid', 'Choose on or off.', { [key]: 'Choose on or off.' });
    values.push(v);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length) {
    const cols = sets.map((s) => s.split(' = ')[0]).join(', ');
    const vals = sets.map((s) => s.split(' = ')[1]).join(', ');
    await db.query(`insert into notification_preferences (customer_id, ${cols}) values ($1, ${vals}) on conflict (customer_id) do update set ${sets.join(', ')}`, values);
  }
  if (typeof input.offersEmail === 'boolean') {
    await db.query('update customers set marketing_consent = $2, marketing_consent_at = $3 where id = $1 and marketing_consent <> $2', [customerId, input.offersEmail, now]);
    if (input.offersEmail) {
      const email = (await db.query('select email from customers where id = $1', [customerId])).rows[0]?.email;
      await db.query('update newsletter_subscribers set unsubscribed_at = null where email = $1', [email]);
    }
  }
  return readPreferences(db, customerId);
}

/** Whether this kind of email may go to this address now. */
export async function mayEmail(db: Q, to: string, category: Category, key: string): Promise<boolean> {
  if (category === 'account' || category === 'staff' || category === 'order') return true;
  const customer = (await db.query('select id from customers where email = $1', [to])).rows[0];
  const prefs = customer ? await readPreferences(db, Number(customer.id)) : null;
  if (category === 'order_update') return prefs ? prefs.ordersEmail : true;
  if (category === 'stock') return prefs ? prefs.backInStockEmail : true;
  // Offers: never to an address that unsubscribed.
  const subscriber = (await db.query('select unsubscribed_at from newsletter_subscribers where email = $1', [to])).rows[0];
  if (subscriber?.unsubscribed_at) return false;
  if (prefs?.offersEmail) return true;
  // The newsletter welcome goes to someone who has just subscribed.
  return key === 'newsletter_welcome' && Boolean(subscriber);
}

// ----- email -----

async function storeAddress(db: Q): Promise<string> {
  const found = await db.query("select value from store_settings where key = 'ship_from'");
  const v = found.rows[0]?.value as { city?: string; country?: string } | undefined;
  return v?.city ? `hairbydemj, ${v.city}, ${v.country === 'NG' ? 'Nigeria' : (v.country ?? '')}`.replace(/, $/, '') : 'hairbydemj, Benin City, Nigeria';
}

/** Details some templates need worked out: money written properly, return status in words. */
async function enrich(db: Q, key: string, data: Record<string, string>): Promise<Record<string, string>> {
  const out = { ...data };
  if (key === 'store_credit' && data.amountMinor && data.currency) {
    const c = (await db.query('select symbol, minor_units from currencies where code = $1', [data.currency])).rows[0];
    out.amount = formatMoney(Number(data.amountMinor), { code: data.currency, symbol: String(c?.symbol ?? ''), minorUnits: Number(c?.minor_units ?? 2) });
  }
  if (key === 'return_update') out.statusText = returnStatusText(data.status ?? '');
  return out;
}

export interface Composed {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** The finished email for a template, with staff's own wording where they changed it. Null when staff switched it off. */
export async function composeEmail(db: Q, config: Config, to: string, key: string, data: Record<string, string>): Promise<Composed | null> {
  const t = templateFor(key);
  if (!t) throw new Undeliverable(`There is no email called "${key}"`);
  const row = (await db.query('select subject, body, email_enabled from message_templates where key = $1', [key])).rows[0];
  if (row && row.email_enabled === false && t.category !== 'account' && t.category !== 'staff') return null;
  const details = await enrich(db, key, data);
  const subject = fill(String(row?.subject || t.subject), details).replace(/\s+/g, ' ').trim();
  const intro = fill(String(row?.body || t.intro), details);
  const l = links(config);
  const rendered = t.build(details, l, { subject, intro });
  const marketing = t.category === 'marketing';
  const unsubscribeUrl = marketing ? `${l.site}/unsubscribe?t=${unsubscribeToken(config, to)}` : null;
  const footer = { address: await storeAddress(db), unsubscribeUrl, preferencesUrl: `${l.site}/account/preferences/` };
  return {
    to,
    subject: rendered.subject,
    html: layoutHtml(rendered, footer),
    text: layoutText(rendered, footer),
    headers: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
  };
}

/** Hand a finished email to the mail server (or the log, in development). */
export async function transmit(deps: NotifyDeps, email: Composed): Promise<void> {
  const m = deps.config.mail;
  let message = buildMessage({ from: m.from, to: email.to, replyTo: m.replyTo || undefined, subject: email.subject, text: email.text, html: email.html, headers: email.headers, date: deps.now(), domain: m.dkimDomain });
  if (m.dkimPrivateKey) message = dkimSign(message, { domain: m.dkimDomain, selector: m.dkimSelector, privateKey: m.dkimPrivateKey, now: deps.now() });
  if (m.transport === 'log') {
    deps.logger.info('email not sent (MAIL_TRANSPORT=log)', { to: email.to, subject: email.subject, text: email.text });
    return;
  }
  try {
    await sendSmtp({ host: m.smtpHost, port: m.smtpPort, heloName: m.heloName, user: m.smtpUser || undefined, password: m.smtpPassword || undefined }, { from: addressOf(m.from), to: email.to }, message);
  } catch (error) {
    if (error instanceof SmtpError && error.permanent) throw new Undeliverable(error.message);
    throw error;
  }
}

/** The `email.send` job: { to, template, data }. Returns what happened. */
export async function deliverEmail(deps: NotifyDeps, payload: Record<string, unknown>): Promise<'sent' | 'skipped'> {
  const to = String(payload.to ?? '').trim().toLowerCase();
  const key = String(payload.template ?? '');
  const data = Object.fromEntries(Object.entries((payload.data ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Undeliverable('The email address is not valid');
  const t = templateFor(key);
  if (!t) throw new Undeliverable(`There is no email called "${key}"`);
  // A test sent by staff from the admin goes even where the address has not opted in.
  if (payload.test !== true && !(await mayEmail(deps.db, to, t.category, key))) return 'skipped';
  const email = await composeEmail(deps.db, deps.config, to, key, data);
  if (!email) return 'skipped';
  await transmit(deps, email);
  return 'sent';
}

// ----- order updates: email, push and the in-app list -----

/** Order events customers hear about, and the title they see. */
export const ORDER_UPDATES: Record<string, string> = {
  paid: 'Payment received',
  shipped: 'On its way',
  shipment_in_transit: 'On its way',
  shipment_out_for_delivery: 'Out for delivery today',
  shipment_exception: 'Delivery delayed',
  delivered: 'Delivered',
  refunded: 'Refund sent',
};

/** Send a push to every phone of a customer; phones that no longer have the app are forgotten. */
export async function pushToCustomer(deps: NotifyDeps, customerId: number, message: PushMessage): Promise<{ sent: number; removed: number }> {
  const devices = await deps.db.query('select id, platform, token from push_devices where customer_id = $1', [customerId]);
  let sent = 0;
  let removed = 0;
  for (const d of devices.rows) {
    const sender = d.platform === 'ios' ? deps.push.ios : deps.push.android;
    if (!sender.configured) continue;
    const outcome = await sender.send(String(d.token), message);
    if (outcome.result === 'sent') sent += 1;
    else if (outcome.result === 'invalid_token') {
      await deps.db.query('delete from push_devices where id = $1', [d.id]);
      removed += 1;
    } else deps.logger.warn('push failed', { customerId, platform: d.platform, detail: outcome.detail });
  }
  return { sent, removed };
}

/** The `order_update` job: { orderId, kind, summary }. */
export async function deliverOrderUpdate(deps: NotifyDeps, payload: Record<string, unknown>, queueEmail: (to: string, data: Record<string, string>) => Promise<void>): Promise<void> {
  const orderId = Number(payload.orderId);
  const kind = String(payload.kind ?? '');
  const title = ORDER_UPDATES[kind];
  if (!title) throw new Undeliverable(`Customers are not told about "${kind}"`);
  const found = await deps.db.query('select number, email, customer_id from orders where id = $1', [orderId]);
  const order = found.rows[0];
  if (!order) throw new Undeliverable('The order no longer exists');
  const summary = String(payload.summary ?? title);
  const number = String(order.number);
  if (order.customer_id) {
    const customerId = Number(order.customer_id);
    await deps.db.query('insert into notifications (customer_id, kind, title, body, link, created_at) values ($1, $2, $3, $4, $5, $6)', [customerId, 'order', `${title}: ${number}`, summary, `/account/orders/${number.toLowerCase()}/`, deps.now()]);
    const prefs = await readPreferences(deps.db, customerId);
    if (prefs.ordersPush) await pushToCustomer(deps, customerId, { title: `${title}: ${number}`, body: summary, link: `/orders/${number}` });
  }
  await queueEmail(String(order.email), { orderNumber: number, title, summary });
}

// ----- newsletter, devices, in-app list -----

export async function subscribeNewsletter(db: Q, input: Record<string, unknown>, customerId: number | null, now: Date): Promise<{ email: string; isNew: boolean }> {
  const email = (typeof input.email === 'string' ? input.email.trim().toLowerCase() : '').slice(0, 254);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new ApiError(422, 'invalid', 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  const made = await db.query(
    "insert into newsletter_subscribers (email, customer_id, source, subscribed_at) values ($1, $2, $3, $4) on conflict (email) do update set unsubscribed_at = null, subscribed_at = case when newsletter_subscribers.unsubscribed_at is null then newsletter_subscribers.subscribed_at else excluded.subscribed_at end returning (xmax = 0) as is_new",
    [email, customerId, typeof input.source === 'string' ? input.source.slice(0, 40) : 'website', now],
  );
  return { email, isNew: made.rows[0]?.is_new === true };
}

export async function registerDevice(db: Q, customerId: number, input: Record<string, unknown>, now: Date): Promise<void> {
  const platform = input.platform;
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (platform !== 'ios' && platform !== 'android') throw new ApiError(422, 'invalid', 'Say which kind of phone this is.', { platform: 'Use ios or android.' });
  if (token.length < 20 || token.length > 400 || !/^[A-Za-z0-9:_\-.]+$/.test(token)) throw new ApiError(422, 'invalid', 'The push token is not valid.', { token: 'The push token is not valid.' });
  // A phone belongs to whoever signed in on it last.
  await db.query('insert into push_devices (customer_id, platform, token, last_seen_at) values ($1, $2, $3, $4) on conflict (token) do update set customer_id = excluded.customer_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at', [customerId, platform, token, now]);
}

export async function forgetDevice(db: Q, customerId: number, token: unknown): Promise<void> {
  await db.query('delete from push_devices where customer_id = $1 and token = $2', [customerId, typeof token === 'string' ? token : '']);
}

export async function listNotifications(db: Q, customerId: number): Promise<{ notifications: Array<Record<string, unknown>>; unread: number }> {
  const found = await db.query('select id, kind, title, body, link, read_at, created_at from notifications where customer_id = $1 order by created_at desc, id desc limit 50', [customerId]);
  const unread = await db.query('select count(*)::int as n from notifications where customer_id = $1 and read_at is null', [customerId]);
  return {
    notifications: found.rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body, link: r.link, read: r.read_at !== null, createdAt: (r.created_at as Date).toISOString() })),
    unread: Number(unread.rows[0]?.n ?? 0),
  };
}

export async function markRead(db: Q, customerId: number, input: Record<string, unknown>, now: Date): Promise<void> {
  if (input.all === true) {
    await db.query('update notifications set read_at = $2 where customer_id = $1 and read_at is null', [customerId, now]);
    return;
  }
  const ids = Array.isArray(input.ids) ? input.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100) : [];
  if (ids.length) await db.query('update notifications set read_at = $3 where customer_id = $1 and id = any($2::bigint[]) and read_at is null', [customerId, ids, now]);
}

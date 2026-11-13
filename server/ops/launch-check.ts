// The launch check (module 21): reads the live server's settings and
// database and lists what is ready and what is not, before the shop opens
// and again on launch day. It changes nothing.
//   cd /srv/hairbydemj/current
//   node --env-file=../shared/.env dist/server/ops/launch-check.js
// Each line is "ok", "PROBLEM" (must be fixed before taking real orders) or
// "check" (worth a look, but the shop can open).

import { pathToFileURL } from 'node:url';
import { loadConfig, type Config } from '../config.js';
import { migrationStatus } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';

export type Level = 'ok' | 'problem' | 'check';
export interface LaunchLine {
  level: Level;
  area: string;
  note: string;
}

const line = (level: Level, area: string, note: string): LaunchLine => ({ level, area, note });

/** The settings: live keys, email, carriers, push, alerts. */
export function checkSettings(config: Config, env: NodeJS.ProcessEnv): LaunchLine[] {
  const out: LaunchLine[] = [];
  const p = config.payments;
  out.push(config.env === 'production' ? line('ok', 'Server', 'running in production mode') : line('problem', 'Server', `NODE_ENV is "${config.env}", not production`));
  out.push(config.hosts.site === 'hairbydemj.com' ? line('ok', 'Addresses', `${config.hosts.site}, ${config.hosts.admin}, ${config.hosts.api}`) : line('check', 'Addresses', `the website is set to ${config.hosts.site} (fine for staging)`));
  out.push(config.authSecret.length >= 32 ? line('ok', 'Secrets', 'AUTH_SECRET is long enough') : line('problem', 'Secrets', 'AUTH_SECRET is missing or shorter than 32 characters'));
  out.push(config.trustProxy ? line('ok', 'Visitors’ addresses', 'read from Caddy') : line('problem', 'Visitors’ addresses', 'TRUST_PROXY is off, so every visitor looks like one address and sign-in limits would lock everyone out'));

  const live = (key: string, prefix: string): boolean => key.startsWith(prefix);
  if (live(p.paystackSecretKey, 'sk_live_') && live(p.paystackPublicKey, 'pk_live_')) out.push(line('ok', 'Paystack', 'live keys'));
  else if (p.paystackSecretKey.startsWith('sk_test_')) out.push(line('problem', 'Paystack', 'test keys: switch to the live keys from the Paystack dashboard'));
  else out.push(line('problem', 'Paystack', 'keys missing or not a matching live pair'));
  if (live(p.stripeSecretKey, 'sk_live_') && live(p.stripePublishableKey, 'pk_live_')) out.push(line('ok', 'Stripe', 'live keys'));
  else if (p.stripeSecretKey.startsWith('sk_test_')) out.push(line('problem', 'Stripe', 'test keys: switch to the live keys from the Stripe dashboard'));
  else out.push(line('problem', 'Stripe', 'keys missing or not a matching live pair'));
  out.push(p.stripeWebhookSecret.startsWith('whsec_') ? line('ok', 'Stripe webhook', 'secret set (make sure it is the live endpoint’s secret)') : line('problem', 'Stripe webhook', 'STRIPE_WEBHOOK_SECRET is not set, so card payments would never be confirmed'));

  const m = config.mail;
  out.push(m.transport === 'smtp' ? line('ok', 'Email', 'sent through Postfix') : line('problem', 'Email', 'MAIL_TRANSPORT is "log": no email would reach customers'));
  out.push(m.from ? line('ok', 'Email sender', m.from) : line('problem', 'Email sender', 'MAIL_FROM is not set'));
  out.push(m.dkimPrivateKey ? line('ok', 'Email signing', `DKIM selector "${m.dkimSelector}" on ${m.dkimDomain}`) : line('problem', 'Email signing', 'DKIM_PRIVATE_KEY is not set, so mail providers would treat our emails as spam'));

  const c = config.carriers;
  const carriers = [
    ['DHL', c.dhl.apiKey !== '', c.dhl.apiUrl.includes('/test')],
    ['UPS', c.ups.clientId !== '', c.ups.apiUrl.includes('wwwcie')],
    ['FedEx', c.fedex.apiKey !== '', c.fedex.apiUrl.includes('sandbox')],
  ] as const;
  const setUp = carriers.filter(([, on]) => on);
  if (setUp.length === 0) out.push(line('check', 'Carriers', 'none set up: only the Nigerian local delivery prices will be offered, so customers abroad cannot check out'));
  for (const [name, on, test] of carriers) if (on) out.push(test ? line('problem', name, 'still pointed at the test address') : line('ok', name, 'live'));

  const push = config.push;
  out.push(push.apnsKeyId && push.fcmProjectId ? line('ok', 'Push notifications', 'Apple and Google keys set') : line('check', 'Push notifications', 'not fully set up: app users will not get order updates on their phones'));
  if (push.apnsKeyId && push.apnsUrl.includes('sandbox')) out.push(line('problem', 'Push notifications', 'APNS_URL is Apple’s sandbox; App Store apps need https://api.push.apple.com'));
  out.push(config.googleClientIds.length && config.appleClientIds.length ? line('ok', 'Google and Apple sign-in', 'set up') : line('check', 'Google and Apple sign-in', 'not set up: customers sign in with email only'));
  out.push((env.ALERT_EMAIL ?? '') !== '' ? line('ok', 'Alerts', `to ${env.ALERT_EMAIL}`) : line('problem', 'Alerts', 'ALERT_EMAIL is not set: nobody would hear about failed backups or a stopped shop'));
  return out;
}

/** The database: migrations, the owner, products, pages, sample data, the worker. */
export async function checkDatabase(db: Db, now: Date): Promise<LaunchLine[]> {
  const out: LaunchLine[] = [];
  const q = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> => (await db.query(sql, values)).rows as T[];

  const status = await migrationStatus(db, 'db/migrations');
  out.push(status.pending.length === 0 ? line('ok', 'Database', `${status.applied.length} migrations applied`) : line('problem', 'Database', `${status.pending.length} migrations not applied: ${status.pending.map((m) => m.file).join(', ')}`));

  const owners = await q<{ email: string }>("select s.email from staff s join roles r on r.id = s.role_id where r.is_owner and s.status = 'active' and s.totp_enabled_at is not null");
  out.push(owners.length ? line('ok', 'Owner account', `${owners.map((o) => o.email).join(', ')} with two-step sign-in`) : line('problem', 'Owner account', 'no active owner with two-step sign-in: run the invite-owner command'));

  const sample = await q<{ n: number; what: string }>(
    `select count(*)::int as n, 'staff' as what from staff where email like '%.test' or email like '%@example.com'
     union all select count(*)::int, 'customers' from customers where email like '%.test' or email like '%@example.com'
     union all select count(*)::int, 'information pages' from content_pages where body like '%Sample text%'
     union all select count(*)::int, 'saved chat replies' from saved_replies where body like 'Sample %'
     union all select count(*)::int, 'store settings' from store_settings where value::text like '%.test%'`,
  );
  for (const s of sample) if (s.n > 0) out.push(line('problem', 'Sample data', `${s.n} ${s.what} still hold sample data (example.com, .test or "Sample" text)`));
  if (sample.every((s) => s.n === 0)) out.push(line('ok', 'Sample data', 'none left'));

  const products = await q<{ id: number; name: string; ngn: boolean; stock: number; photos: number; variants: number }>(
    `select p.id, p.name,
            count(distinct v.id)::int as variants,
            bool_and(exists (select 1 from prices pr where pr.variant_id = v.id and pr.currency = 'NGN')) as ngn,
            coalesce(sum(i.on_hand - i.reserved), 0)::int as stock,
            (select count(*)::int from product_media m where m.product_id = p.id) as photos
     from products p left join variants v on v.product_id = p.id left join inventory i on i.variant_id = v.id
     where p.status = 'published' group by p.id order by p.name`,
  );
  out.push(products.length ? line('ok', 'Products', `${products.length} published`) : line('problem', 'Products', 'nothing is published'));
  for (const p of products) {
    if (p.variants === 0) out.push(line('problem', 'Product', `${p.name}: no variants, so it cannot be bought`));
    else if (!p.ngn) out.push(line('problem', 'Product', `${p.name}: a variant has no naira price`));
    if (p.stock <= 0) out.push(line('check', 'Product', `${p.name}: out of stock`));
    if (p.photos === 0) out.push(line('check', 'Product', `${p.name}: no photos`));
  }

  const pages = await q<{ slug: string; status: string }>("select slug, status from content_pages where slug in ('shipping', 'returns', 'privacy', 'terms', 'about')");
  for (const slug of ['shipping', 'returns', 'privacy', 'terms']) {
    const page = pages.find((p) => p.slug === slug);
    if (!page) out.push(line('check', 'Information pages', `"${slug}" uses the built-in wording; edit it in the admin if the shop’s own wording is wanted`));
    else if (page.status !== 'published') out.push(line('problem', 'Information pages', `"${slug}" is not published`));
  }

  const rates = await q<{ code: string; updated: Date | null }>("select code, rate_updated_at as updated from currencies where enabled and not is_base");
  const stale = rates.filter((r) => !r.updated || now.getTime() - new Date(r.updated).getTime() > 2 * 86_400_000);
  out.push(stale.length === 0 ? line('ok', 'Exchange rates', 'updated in the last two days') : line('problem', 'Exchange rates', `not updated in two days: ${stale.map((r) => r.code).join(', ')} (is the worker running?)`));

  const runs = await q<{ name: string; finished: Date | null; error: string | null }>('select name, last_finished_at as finished, last_error as error from scheduled_runs');
  const recent = runs.filter((r) => r.finished && now.getTime() - new Date(r.finished).getTime() < 86_400_000);
  out.push(recent.length ? line('ok', 'Worker', `${recent.length} scheduled tasks ran in the last day`) : line('problem', 'Worker', 'no scheduled task has run in the last day: start hairbydemj-worker'));
  for (const r of runs) if (r.error) out.push(line('check', 'Worker', `${r.name} last failed: ${r.error.slice(0, 120)}`));

  const failed = await q<{ n: number }>("select count(*)::int as n from jobs where status = 'failed'");
  if ((failed[0]?.n ?? 0) > 0) out.push(line('check', 'Background jobs', `${failed[0]?.n} failed jobs (admin: System)`));
  return out;
}

export function launchReport(lines: LaunchLine[]): string {
  const label: Record<Level, string> = { ok: 'ok     ', problem: 'PROBLEM', check: 'check  ' };
  const problems = lines.filter((l) => l.level === 'problem').length;
  return `${lines.map((l) => `${label[l.level]}  ${l.area}: ${l.note}`).join('\n')}\n\n${problems === 0 ? 'Ready: nothing must be fixed before taking real orders.' : `${problems} must be fixed before taking real orders.`}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
  const db = createPool(config.databaseUrl);
  try {
    const lines = [...checkSettings(config, process.env), ...(await checkDatabase(db, new Date()))];
    process.stdout.write(`${launchReport(lines)}\n`);
    process.exitCode = lines.some((l) => l.level === 'problem') ? 1 : 0;
  } finally {
    await db.end();
  }
}

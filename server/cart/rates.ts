// Exchange rates and the "Payments and currencies" settings. A currency's
// rate is either typed by staff ("manual") or fetched each day ("daily").
// Whenever a rate or its markup or rounding changes, every price that was
// worked out from the naira price is worked out again; prices staff typed
// themselves are left alone.

import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { convertPrice } from '../catalog/manage.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';

type Q = { query: DbClient['query'] };

export interface CurrencySetting {
  code: string;
  name: string;
  symbol: string;
  isBase: boolean;
  provider: 'paystack' | 'stripe';
  shownTo: string;
  rateFromBase: number | null;
  rateSource: 'daily' | 'manual';
  rateUpdatedAt: Date | null;
  markupBps: number;
  roundingMinor: number;
  enabled: boolean;
}

interface Meta {
  ip: string | null;
}

/** Where daily rates come from: a free service that needs no key, with naira as the base. */
export const DEFAULT_RATES_URL = 'https://open.er-api.com/v6/latest/NGN';

function fromRow(r: Record<string, unknown>): CurrencySetting {
  return {
    code: String(r.code),
    name: String(r.name),
    symbol: String(r.symbol),
    isBase: r.is_base === true,
    provider: r.provider as CurrencySetting['provider'],
    shownTo: String(r.shown_to),
    rateFromBase: r.rate_from_base === null ? null : Number(r.rate_from_base),
    rateSource: r.rate_source as CurrencySetting['rateSource'],
    rateUpdatedAt: (r.rate_updated_at as Date | null) ?? null,
    markupBps: Number(r.rate_markup_bps),
    roundingMinor: Number(r.rounding_minor),
    enabled: r.enabled === true,
  };
}

export async function listCurrencySettings(db: Db, actor: StaffMember): Promise<CurrencySetting[]> {
  requireAccess(actor, 'settings', 'view');
  const result = await db.query('select * from currencies order by is_base desc, code');
  return result.rows.map((r) => fromRow(r as Record<string, unknown>));
}

/** Work out again every converted price in one currency. Returns how many changed. */
export async function reconvertPrices(c: Q, code: string): Promise<number> {
  const found = await c.query('select code, is_base, rate_from_base, rate_markup_bps, rounding_minor from currencies where code = $1', [code]);
  const cur = found.rows[0] as Record<string, unknown> | undefined;
  if (!cur || cur.is_base || cur.rate_from_base === null) return 0;
  const currency = { code, rate: Number(cur.rate_from_base), markupBps: Number(cur.rate_markup_bps), rounding: Number(cur.rounding_minor) };
  const rows = await c.query(
    `select p.variant_id, p.amount_minor as current, b.amount_minor as base
     from prices p join prices b on b.variant_id = p.variant_id join currencies bc on bc.code = b.currency and bc.is_base
     where p.currency = $1 and p.is_converted`,
    [code],
  );
  let changed = 0;
  for (const r of rows.rows) {
    const amount = convertPrice(Number(r.base), currency);
    if (amount !== Number(r.current)) {
      await c.query('update prices set amount_minor = $3 where variant_id = $1 and currency = $2', [r.variant_id, code, amount]);
      changed++;
    }
  }
  return changed;
}

function numberOf(value: unknown, field: string, label: string, min: number, max: number, wholeOnly: boolean): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (wholeOnly && !Number.isInteger(n))) {
    throw new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: `${label} must be ${wholeOnly ? 'a whole number' : 'a number'} from ${min} to ${max}.` });
  }
  return n;
}

/** Change a currency's rate, markup, rounding, rate source or whether it is offered. */
export async function updateCurrency(db: Db, actor: StaffMember, code: string, input: Record<string, unknown>, now: Date, meta: Meta): Promise<{ currency: CurrencySetting; pricesChanged: number }> {
  requireAccess(actor, 'settings', 'change');
  return withTransaction(db, async (c) => {
    const found = await c.query('select * from currencies where code = $1 for update', [code.toUpperCase()]);
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(404, 'not_found', 'We do not sell in that currency.');
    const before = fromRow(row);
    const changes: Record<string, unknown> = {};
    const said: string[] = [];
    if (before.isBase && ('rateFromBase' in input || 'enabled' in input || 'rateSource' in input || 'markupBps' in input)) {
      throw new ApiError(422, 'base_currency', `${before.code} is the currency every other price is worked out from. Its rate is always 1 and it is always offered.`);
    }
    if ('rateFromBase' in input) {
      changes.rate_from_base = numberOf(input.rateFromBase, 'rateFromBase', 'The rate', 0.00000001, 1_000_000, false);
      changes.rate_updated_at = now;
      // A rate typed by hand stays until staff change it again.
      if (!('rateSource' in input)) changes.rate_source = 'manual';
      said.push(`rate ${String(before.rateFromBase ?? 'none')} to ${String(changes.rate_from_base)}`);
    }
    if ('rateSource' in input) {
      if (input.rateSource !== 'daily' && input.rateSource !== 'manual') throw new ApiError(422, 'invalid', 'Check the details and try again.', { rateSource: 'Choose daily or manual.' });
      changes.rate_source = input.rateSource;
      said.push(`rate source ${input.rateSource}`);
    }
    if ('markupBps' in input) {
      changes.rate_markup_bps = numberOf(input.markupBps, 'markupBps', 'The markup (in hundredths of a percent)', 0, 5000, true);
      said.push(`markup ${before.markupBps / 100}% to ${Number(changes.rate_markup_bps) / 100}%`);
    }
    if ('roundingMinor' in input) {
      changes.rounding_minor = numberOf(input.roundingMinor, 'roundingMinor', 'Rounding (in minor units)', 1, 10_000_000, true);
      said.push(`rounding to ${String(changes.rounding_minor)}`);
    }
    if ('enabled' in input) {
      changes.enabled = input.enabled === true;
      said.push(changes.enabled ? 'offered' : 'no longer offered');
    }
    const keys = Object.keys(changes);
    if (!keys.length) return { currency: before, pricesChanged: 0 };
    await c.query(`update currencies set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where code = $1`, [before.code, ...Object.values(changes)]);
    const pricesChanged = 'rate_from_base' in changes || 'rate_markup_bps' in changes || 'rounding_minor' in changes ? (before.isBase ? 0 : await reconvertPrices(c, before.code)) : 0;
    await logActivity(c, actor, 'Payments and currencies', `${before.code}: ${said.join(', ')}${pricesChanged ? `; ${pricesChanged} converted prices updated` : ''}`, { type: 'currency', id: before.code }, meta.ip);
    const after = await c.query('select * from currencies where code = $1', [before.code]);
    return { currency: fromRow(after.rows[0] as Record<string, unknown>), pricesChanged };
  });
}

export type RatesFetcher = (url: string) => Promise<Record<string, number>>;

/** Read today's rates from the free service. The answer gives, per currency, how much one naira buys. */
export const fetchRates: RatesFetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`The rates service answered ${response.status}`);
  const body = (await response.json()) as { result?: string; base_code?: string; rates?: Record<string, number> };
  if (body.result !== 'success' || !body.rates) throw new Error('The rates service did not send rates');
  return body.rates;
};

/**
 * Update every currency whose rate source is "daily". A rate that moves by
 * more than a fifth in one day is not applied, in case the service sent a
 * wrong figure; staff are told through the activity log.
 */
export async function refreshDailyRates(db: Db, url: string, fetcher: RatesFetcher, now: Date): Promise<{ updated: string[]; skipped: string[] }> {
  const rates = await fetcher(url);
  const updated: string[] = [];
  const skipped: string[] = [];
  const daily = await db.query("select code, rate_from_base from currencies where rate_source = 'daily' and not is_base and enabled order by code");
  for (const row of daily.rows) {
    const code = String(row.code);
    const rate = rates[code];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      skipped.push(code);
      continue;
    }
    const previous = row.rate_from_base === null ? null : Number(row.rate_from_base);
    if (previous !== null && Math.abs(rate - previous) / previous > 0.2) {
      skipped.push(code);
      await logActivity(db, { id: null, name: 'Daily rates' }, 'Payments and currencies', `${code}: the new rate ${rate} is more than 20% away from ${previous}, so it was not applied. Check it and set it by hand if it is right.`, { type: 'currency', id: code });
      continue;
    }
    await withTransaction(db, async (c) => {
      await c.query('update currencies set rate_from_base = $2, rate_updated_at = $3 where code = $1', [code, rate, now]);
      const changed = await reconvertPrices(c, code);
      await logActivity(c, { id: null, name: 'Daily rates' }, 'Payments and currencies', `${code}: rate updated to ${rate}${changed ? `; ${changed} converted prices updated` : ''}`, { type: 'currency', id: code });
    });
    updated.push(code);
  }
  return { updated, skipped };
}

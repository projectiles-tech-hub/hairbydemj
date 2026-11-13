// Currencies the shop sells in, and the one a visitor should see first.

import type { Db, DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';

type Q = { query: DbClient['query'] } | Db;

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  isBase: boolean;
}

/** Countries that use the euro (the euro area and the places that use it by agreement). */
const EURO = new Set(['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'AD', 'MC', 'SM', 'VA', 'ME', 'XK']);
const POUND = new Set(['GB', 'IM', 'JE', 'GG']);

/** The currency a visitor from this country sees first. They can change it. */
export function currencyForCountry(country: string | null | undefined): string | null {
  const c = (country ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return null; // unknown, or Tor
  if (c === 'NG') return 'NGN';
  if (POUND.has(c)) return 'GBP';
  if (EURO.has(c)) return 'EUR';
  return 'USD';
}

export async function enabledCurrencies(db: Q): Promise<CurrencyInfo[]> {
  const result = await db.query('select code, name, symbol, is_base from currencies where enabled order by is_base desc, code');
  return result.rows.map((r) => ({ code: String(r.code), name: String(r.name), symbol: String(r.symbol), isBase: r.is_base === true }));
}

/** A currency code we sell in, upper-cased; the base currency when none is given. */
export async function checkCurrency(db: Q, code: unknown): Promise<string> {
  const list = await enabledCurrencies(db);
  const wanted = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (wanted === '') return list.find((c) => c.isBase)?.code ?? 'NGN';
  if (!list.some((c) => c.code === wanted)) throw new ApiError(422, 'invalid', `We do not sell in ${wanted}.`, { currency: 'Choose a currency we sell in.' });
  return wanted;
}

/** Pick the first currency that is on offer: the visitor's choice, then their country's, then the base. */
export async function pickCurrency(db: Q, choices: Array<string | null | undefined>): Promise<string> {
  const list = await enabledCurrencies(db);
  for (const choice of choices) {
    const code = (choice ?? '').toUpperCase();
    if (list.some((c) => c.code === code)) return code;
  }
  return list.find((c) => c.isBase)?.code ?? 'NGN';
}

/** An amount in minor units written for people: 2850000 NGN is "₦28,500". Whole amounts drop ".00". */
export function formatMoney(minor: number, currency: { code: string; symbol: string; minorUnits?: number }): string {
  const digits = currency.minorUnits ?? 2;
  const major = minor / 10 ** digits;
  const whole = Number.isInteger(major);
  return `${minor < 0 ? '−' : ''}${currency.symbol}${Math.abs(major).toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: digits })}`;
}

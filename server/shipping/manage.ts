// What staff set up for delivery: which carriers are offered and their
// markup, the local zones and prices inside Nigeria, and our boxes.

import type { Db, DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { Carrier, CarrierCode } from './carriers.js';
import { carrierSettings, NIGERIAN_STATES, nigerianState } from './shipping.js';

type Q = { query: DbClient['query'] } | Db;

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', message, { [field]: message });
const words = (v: unknown, field: string, label: string, max = 80): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || t.length > max) throw invalid(field, `Enter ${label}.`);
  return t;
};
const whole = (v: unknown, field: string, label: string, min: number, max: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw invalid(field, `Enter ${label} from ${min} to ${max}.`);
  return n;
};

// ----- carriers -----

export async function listCarriers(db: Q, carriers: Record<CarrierCode, Carrier>): Promise<Array<{ code: CarrierCode; name: string; enabled: boolean; services: Array<{ code: string; name: string }>; markupBps: number; configured: boolean; mode: string | null }>> {
  return (await carrierSettings(db)).map((s) => ({ ...s, configured: carriers[s.code].configured, mode: carriers[s.code].mode }));
}

export async function updateCarrier(db: Q, carriers: Record<CarrierCode, Carrier>, code: string, input: Record<string, unknown>): Promise<{ name: string }> {
  if (code !== 'dhl' && code !== 'ups' && code !== 'fedex') throw new ApiError(404, 'not_found', 'We do not know that carrier.');
  const carrier = carriers[code];
  const sets: string[] = [];
  const values: unknown[] = [code];
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw invalid('enabled', 'Choose on or off.');
    if (input.enabled && !carrier.configured) throw invalid('enabled', `Add the ${carrier.name} login to the server settings first. See docs/shipping.md.`);
    values.push(input.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (input.markupBps !== undefined) {
    values.push(whole(input.markupBps, 'markupBps', 'a markup in hundredths of a percent', 0, 10_000));
    sets.push(`markup_bps = $${values.length}`);
  }
  if (input.services !== undefined) {
    if (!Array.isArray(input.services) || input.services.length > 30) throw invalid('services', 'Send a list of services.');
    const services = input.services.map((raw, k) => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const serviceCode = typeof r.code === 'string' ? r.code.trim() : '';
      if (!/^[A-Za-z0-9_]{1,60}$/.test(serviceCode)) throw invalid('services', `Service ${k + 1}: enter the carrier's service code.`);
      return { code: serviceCode, name: words(r.name, 'services', `a name for service ${k + 1}`) };
    });
    values.push(JSON.stringify(services));
    sets.push(`services = $${values.length}`);
  }
  if (sets.length) await db.query(`update carriers set ${sets.join(', ')} where code = $1`, values);
  return { name: carrier.name };
}

// ----- local zones -----

export interface LocalRate {
  id: number;
  zoneName: string;
  states: string[];
  courier: string;
  priceMinor: number;
  deliveryTime: string;
  position: number;
  enabled: boolean;
}

export async function listLocalRates(db: Q): Promise<{ rates: LocalRate[]; states: string[] }> {
  const found = await db.query('select id, zone_name, states, courier, price_minor, delivery_time, position, enabled from local_shipping_rates order by position, id');
  return {
    rates: found.rows.map((r) => ({ id: Number(r.id), zoneName: String(r.zone_name), states: r.states as string[], courier: String(r.courier), priceMinor: Number(r.price_minor), deliveryTime: String(r.delivery_time), position: Number(r.position), enabled: r.enabled === true })),
    states: NIGERIAN_STATES,
  };
}

function readLocalRate(input: Record<string, unknown>, partial: boolean): Partial<LocalRate> {
  const out: Partial<LocalRate> = {};
  if (!partial || input.zoneName !== undefined) out.zoneName = words(input.zoneName, 'zoneName', 'a zone name');
  if (!partial || input.states !== undefined) {
    if (!Array.isArray(input.states) || input.states.length > NIGERIAN_STATES.length) throw invalid('states', 'Choose the states this zone covers, or none for everywhere else.');
    const states = input.states.map((s) => nigerianState(String(s)));
    if (states.some((s) => s === null)) throw invalid('states', 'Choose states from the list.');
    out.states = [...new Set(states as string[])];
  }
  if (!partial || input.courier !== undefined) out.courier = words(input.courier, 'courier', 'the courier');
  if (!partial || input.priceMinor !== undefined) out.priceMinor = whole(input.priceMinor, 'priceMinor', 'a price in kobo', 0, 100_000_000_00);
  if (!partial || input.deliveryTime !== undefined) out.deliveryTime = words(input.deliveryTime, 'deliveryTime', 'the delivery time, such as "1 to 2 working days"');
  if (input.position !== undefined) out.position = whole(input.position, 'position', 'a position', 0, 1000);
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw invalid('enabled', 'Choose on or off.');
    out.enabled = input.enabled;
  }
  return out;
}

/** A state may sit in only one zone, so a customer is never offered two prices for the same place. */
async function checkOverlap(db: Q, states: string[], exceptId: number | null): Promise<void> {
  if (states.length === 0) return;
  const clash = await db.query('select zone_name, states from local_shipping_rates where states && $1::text[] and ($2::bigint is null or id <> $2) limit 1', [states, exceptId]);
  const row = clash.rows[0];
  if (row) {
    const shared = (row.states as string[]).filter((s) => states.includes(s));
    throw invalid('states', `${shared.join(', ')} ${shared.length === 1 ? 'is' : 'are'} already in the zone "${String(row.zone_name)}".`);
  }
}

const duplicateName = (error: unknown): boolean => (error as { code?: string }).code === '23505';

export async function createLocalRate(db: Q, input: Record<string, unknown>): Promise<LocalRate> {
  const r = readLocalRate(input, false) as LocalRate;
  await checkOverlap(db, r.states, null);
  try {
    const made = await db.query('insert into local_shipping_rates (zone_name, states, courier, price_minor, delivery_time, position, enabled) values ($1, $2, $3, $4, $5, $6, $7) returning id', [r.zoneName, r.states, r.courier, r.priceMinor, r.deliveryTime, r.position ?? 0, r.enabled ?? true]);
    return { ...r, id: Number(made.rows[0]?.id), position: r.position ?? 0, enabled: r.enabled ?? true };
  } catch (error) {
    if (duplicateName(error)) throw invalid('zoneName', 'There is already a zone with this name.');
    throw error;
  }
}

export async function updateLocalRate(db: Q, id: number, input: Record<string, unknown>): Promise<void> {
  const r = readLocalRate(input, true);
  if (r.states) await checkOverlap(db, r.states, id);
  const columns: Record<string, string> = { zoneName: 'zone_name', states: 'states', courier: 'courier', priceMinor: 'price_minor', deliveryTime: 'delivery_time', position: 'position', enabled: 'enabled' };
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (key in r) {
      values.push((r as Record<string, unknown>)[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;
  try {
    const changed = await db.query(`update local_shipping_rates set ${sets.join(', ')} where id = $1`, values);
    if (!changed.rowCount) throw new ApiError(404, 'not_found', 'We could not find that zone.');
  } catch (error) {
    if (duplicateName(error)) throw invalid('zoneName', 'There is already a zone with this name.');
    throw error;
  }
}

export async function deleteLocalRate(db: Q, id: number): Promise<void> {
  const gone = await db.query('delete from local_shipping_rates where id = $1', [id]);
  if (!gone.rowCount) throw new ApiError(404, 'not_found', 'We could not find that zone.');
}

// ----- boxes -----

function readBox(input: Record<string, unknown>): { name: string; lengthMm: number; widthMm: number; heightMm: number; emptyWeightGrams: number } {
  return {
    name: words(input.name, 'name', 'a name for the box'),
    lengthMm: whole(input.lengthMm, 'lengthMm', 'the length in millimetres', 10, 2000),
    widthMm: whole(input.widthMm, 'widthMm', 'the width in millimetres', 10, 2000),
    heightMm: whole(input.heightMm, 'heightMm', 'the height in millimetres', 10, 2000),
    emptyWeightGrams: whole(input.emptyWeightGrams, 'emptyWeightGrams', 'the empty weight in grams', 0, 10_000),
  };
}

export async function createPackageSize(db: Q, input: Record<string, unknown>): Promise<{ id: number }> {
  const b = readBox(input);
  try {
    const made = await db.query('insert into package_sizes (name, length_mm, width_mm, height_mm, empty_weight_grams) values ($1, $2, $3, $4, $5) returning id', [b.name, b.lengthMm, b.widthMm, b.heightMm, b.emptyWeightGrams]);
    return { id: Number(made.rows[0]?.id) };
  } catch (error) {
    if (duplicateName(error)) throw invalid('name', 'There is already a box with this name.');
    throw error;
  }
}

export async function updatePackageSize(db: Q, id: number, input: Record<string, unknown>): Promise<void> {
  const b = readBox(input);
  try {
    const changed = await db.query('update package_sizes set name = $2, length_mm = $3, width_mm = $4, height_mm = $5, empty_weight_grams = $6 where id = $1', [id, b.name, b.lengthMm, b.widthMm, b.heightMm, b.emptyWeightGrams]);
    if (!changed.rowCount) throw new ApiError(404, 'not_found', 'We could not find that box.');
  } catch (error) {
    if (duplicateName(error)) throw invalid('name', 'There is already a box with this name.');
    throw error;
  }
}

export async function deletePackageSize(db: Q, id: number): Promise<void> {
  // Products using the box fall back to packing by weight and size (the column is set null).
  const gone = await db.query('delete from package_sizes where id = $1', [id]);
  if (!gone.rowCount) throw new ApiError(404, 'not_found', 'We could not find that box.');
}

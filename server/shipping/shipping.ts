// Delivery: prices at checkout, labels after payment, and tracking.
//
//   Inside Nigeria: the zones and prices staff set (local_shipping_rates).
//   Abroad: live prices from DHL, UPS and FedEx for the customer's address,
//   turned into the customer's currency, with the carrier's markup added.
//
// The prices offered are saved as a quote for 30 minutes. Checkout takes the
// quote id and the option the customer chose, so the price charged is the
// price shown, and nobody can send a cheaper price of their own.

import { randomToken } from '../accounts/crypto.js';
import type { Db, DbClient } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { Logger } from '../logger.js';
import type { Cart } from '../cart/cart.js';
import { orderEvent } from '../payments/order-paid.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CarrierError, trackingUrl, type Address, type Carrier, type CarrierCode, type Customs, type Rate, type TrackingStatus } from './carriers.js';
import { packItems, totalWeight, type Item, type PackageSize, type Parcel } from './parcel.js';

type Q = { query: DbClient['query'] } | Db;

export interface ShippingDeps {
  db: Db;
  now: () => Date;
  logger: Logger;
  carriers: Record<CarrierCode, Carrier>;
  /** Folder for label files. Private: never served to the public. */
  labelDir: string;
}

export const SHIPPING = {
  quoteMinutes: 30,
  /** Tracking is asked again after this long, for parcels still on the way. */
  trackEveryMinutes: 120,
};

export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

/** "abuja", "f.c.t." and "Federal Capital Territory" all mean FCT; other names are matched without regard to case. */
export function nigerianState(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').replace(/ state$/, '');
  if (['abuja', 'fct', 'federal capital territory', 'fct abuja'].includes(v)) return 'FCT';
  return NIGERIAN_STATES.find((s) => s.toLowerCase() === v) ?? null;
}

export const DUTIES_NOTICE =
  'Delivery prices do not include import duties or taxes. If your country charges them, the carrier will ask you to pay them when your parcel arrives.';

// ----- the store's own address -----

export interface ShipFrom extends Address {
  /** Where the hair was made, for customs forms. Two letters. */
  originCountry: string;
}

export async function readShipFrom(db: Q): Promise<ShipFrom | null> {
  const found = await db.query("select value from store_settings where key = 'ship_from'");
  const v = found.rows[0]?.value as Record<string, unknown> | undefined;
  if (!v) return null;
  try {
    return parseAddress(v, { full: true }) as ShipFrom & { originCountry: string };
  } catch {
    return null;
  }
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Check an address sent by a customer or staff. `full` asks for name and phone too (needed on a label). */
export function parseAddress(input: unknown, options: { full: boolean }): Address & { originCountry?: string } {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const country = text(r.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fields.country = 'Choose a country.';
  const city = text(r.city, 80);
  if (!city) fields.city = 'Enter a town or city.';
  const line1 = text(r.line1, 120);
  if (!line1) fields.line1 = 'Enter the street address.';
  let region = text(r.region, 80);
  if (country === 'NG') {
    const state = nigerianState(region);
    if (!state) fields.region = 'Choose a state.';
    else region = state;
  }
  const postalCode = text(r.postalCode, 20);
  if (['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'IE'].includes(country) && !postalCode) fields.postalCode = 'Enter the postcode.';
  const name = text(r.name, 80);
  const phone = text(r.phone, 30);
  if (options.full && !name) fields.name = 'Enter a name.';
  if (options.full && !/^\+?[0-9 ()-]{7,30}$/.test(phone)) fields.phone = 'Enter a phone number the courier can call.';
  const originCountry = text(r.originCountry, 2).toUpperCase();
  if (Object.keys(fields).length) throw new ApiError(422, 'invalid', 'Check the address and try again.', fields);
  return {
    name,
    company: text(r.company, 80) || null,
    phone,
    email: text(r.email, 120) || null,
    line1,
    line2: text(r.line2, 120) || null,
    city,
    region: region || null,
    postalCode: postalCode || null,
    country,
    ...(originCountry ? { originCountry } : {}),
  };
}

export async function saveShipFrom(db: Q, input: unknown, staffId: number): Promise<ShipFrom> {
  const address = parseAddress(input, { full: true });
  const shipFrom: ShipFrom = { ...address, originCountry: address.originCountry && /^[A-Z]{2}$/.test(address.originCountry) ? address.originCountry : address.country };
  await db.query(
    "insert into store_settings (key, value, updated_by) values ('ship_from', $1, $2) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by",
    [JSON.stringify(shipFrom), staffId],
  );
  return shipFrom;
}

// ----- boxes -----

export async function listPackageSizes(db: Q): Promise<PackageSize[]> {
  const found = await db.query('select id, name, length_mm, width_mm, height_mm, empty_weight_grams from package_sizes order by length_mm * width_mm * height_mm, id');
  return found.rows.map((r) => ({ id: Number(r.id), name: String(r.name), lengthMm: Number(r.length_mm), widthMm: Number(r.width_mm), heightMm: Number(r.height_mm), emptyWeightGrams: Number(r.empty_weight_grams) }));
}

/** The items of some variants, with what packing needs to know. */
async function itemsFor(db: Q, lines: Array<{ variantId: number; quantity: number }>): Promise<Item[]> {
  if (lines.length === 0) return [];
  const found = await db.query(
    'select v.id, v.weight_grams, v.length_mm, v.width_mm, v.height_mm, p.package_size_id from variants v join products p on p.id = v.product_id where v.id = any($1::bigint[])',
    [lines.map((l) => l.variantId)],
  );
  const byId = new Map(found.rows.map((r) => [Number(r.id), r]));
  return lines.flatMap((l): Item[] => {
    const r = byId.get(l.variantId);
    if (!r) return [];
    return [{ quantity: l.quantity, weightGrams: Number(r.weight_grams), lengthMm: r.length_mm === null ? null : Number(r.length_mm), widthMm: r.width_mm === null ? null : Number(r.width_mm), heightMm: r.height_mm === null ? null : Number(r.height_mm), packageSizeId: r.package_size_id === null ? null : Number(r.package_size_id) }];
  });
}

// ----- money -----

interface CurrencyRow {
  code: string;
  rate: number | null;
  minorUnits: number;
  rounding: number;
}

async function currencyRows(db: Q): Promise<Map<string, CurrencyRow>> {
  const found = await db.query('select code, rate_from_base, minor_units, rounding_minor from currencies');
  return new Map(found.rows.map((r) => [String(r.code), { code: String(r.code), rate: r.rate_from_base === null ? null : Number(r.rate_from_base), minorUnits: Number(r.minor_units), rounding: Number(r.rounding_minor) }]));
}

/**
 * A carrier's price (major units of its currency) in the customer's currency,
 * in minor units, with our markup, rounded up to the currency's rounding.
 * Null when we have no exchange rate for one of the two.
 */
export function carrierPriceIn(amount: number, from: string, to: CurrencyRow, currencies: Map<string, CurrencyRow>, markupBps: number): number | null {
  const source = currencies.get(from);
  if (!source || source.rate === null || to.rate === null) return null;
  const inTarget = (amount / source.rate) * to.rate * (1 + markupBps / 10_000);
  const minor = Math.ceil(inTarget * 10 ** to.minorUnits - 1e-9);
  return Math.ceil(minor / to.rounding) * to.rounding;
}

const toMajor = (minor: number, units: number): number => Math.round(minor) / 10 ** units;

// ----- quotes -----

export interface ShippingOption {
  id: string;
  carrier: CarrierCode | 'local';
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  priceMinor: number;
  /** The price before a free-delivery discount, when one applies. */
  originalPriceMinor: number | null;
  currency: string;
  /** In words, for example "2 working days" or "1 to 3 days". */
  estimate: string;
  transitDays: number | null;
  deliveryDate: string | null;
}

export interface Quote {
  id: string;
  currency: string;
  address: Address;
  parcels: Parcel[];
  weightGrams: number;
  options: ShippingOption[];
  /** Shown to every customer whose parcel leaves Nigeria. */
  dutiesNotice: string | null;
  /** When nothing can be offered: why, in words for the customer. */
  message: string | null;
  expiresAt: string;
}

/** Stored next to each option, never shown to customers: what the carrier charges us. */
interface StoredOption extends ShippingOption {
  cost: { amount: number; currency: string } | null;
}

function estimateText(rate: { transitDays: number | null; deliveryDate: string | null }): string {
  if (rate.transitDays !== null) return rate.transitDays === 1 ? '1 working day' : `${rate.transitDays} working days`;
  if (rate.deliveryDate) {
    const d = new Date(`${rate.deliveryDate}T12:00:00Z`);
    return `Expected ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  }
  return 'Delivery time confirmed after dispatch';
}

interface CarrierSetting {
  code: CarrierCode;
  name: string;
  enabled: boolean;
  /** Service codes staff allow, each with the name to show. Empty means every service the carrier offers. */
  services: Array<{ code: string; name: string }>;
  markupBps: number;
}

export async function carrierSettings(db: Q): Promise<CarrierSetting[]> {
  const found = await db.query('select code, name, enabled, services, markup_bps from carriers order by code');
  return found.rows.map((r) => ({
    code: r.code as CarrierCode,
    name: String(r.name),
    enabled: r.enabled === true,
    services: (Array.isArray(r.services) ? r.services : []).filter((s: unknown) => s && typeof s === 'object' && typeof (s as { code?: unknown }).code === 'string') as Array<{ code: string; name: string }>,
    markupBps: Number(r.markup_bps),
  }));
}

/** Customs details for a parcel leaving the country: each line at the price the customer pays. */
async function customsFor(db: Q, lines: Array<{ variantId: number; productName: string; quantity: number; unitMinor: number; weightGrams: number }>, currency: CurrencyRow, origin: string, invoiceNumber: string): Promise<Customs> {
  const found = lines.length
    ? await db.query('select v.id, p.customs_description, p.hs_code from variants v join products p on p.id = v.product_id where v.id = any($1::bigint[])', [lines.map((l) => l.variantId)])
    : { rows: [] };
  const byId = new Map(found.rows.map((r) => [Number(r.id), r]));
  return {
    currency: currency.code,
    invoiceNumber,
    items: lines.map((l) => {
      const r = byId.get(l.variantId);
      return {
        description: String(r?.customs_description || `Human hair: ${l.productName}`),
        hsCode: r?.hs_code ? String(r.hs_code) : null,
        quantity: l.quantity,
        unitValue: toMajor(l.unitMinor, currency.minorUnits),
        weightGrams: l.weightGrams,
        originCountry: origin,
      };
    }),
  };
}

/**
 * Delivery options for this cart to this address. Saved as a quote the
 * customer picks from at checkout.
 */
export async function quoteForCart(deps: ShippingDeps, cart: Cart, addressInput: unknown): Promise<Quote> {
  if (cart.id === null || !cart.canCheckout) throw new ApiError(422, 'cart_not_ready', 'Your bag needs attention before delivery can be priced. Check the items marked in your bag.');
  const to = parseAddress(addressInput, { full: false });
  const lines = cart.lines.map((l) => ({ variantId: l.variantId, productName: l.name, quantity: l.quantity, unitMinor: l.unitMinor ?? 0, weightGrams: l.weightGrams / l.quantity }));
  const parcels = packItems(await itemsFor(deps.db, lines), await listPackageSizes(deps.db));
  const shipFrom = await readShipFrom(deps.db);
  const home = shipFrom?.country ?? 'NG';
  const currencies = await currencyRows(deps.db);
  const target = currencies.get(cart.currency);
  if (!target) throw new Error(`Currency ${cart.currency} vanished`);

  const options: StoredOption[] = [];
  let message: string | null = null;
  const international = to.country !== home;

  if (!international) {
    // Inside Nigeria: the zone for the customer's state, else the zone for "everywhere else".
    const zones = await deps.db.query('select id, zone_name, states, courier, price_minor, delivery_time from local_shipping_rates where enabled order by position, id');
    const state = (to.region ?? '').toLowerCase();
    const matching = zones.rows.filter((z) => (z.states as string[]).some((s) => s.toLowerCase() === state));
    const chosen = matching.length ? matching : zones.rows.filter((z) => (z.states as string[]).length === 0);
    const naira = currencies.get('NGN');
    for (const z of chosen) {
      // Local prices are set in naira; other currencies get today's rate.
      const price = cart.currency === 'NGN' ? Number(z.price_minor) : naira ? carrierPriceIn(Number(z.price_minor) / 10 ** naira.minorUnits, 'NGN', target, currencies, 0) : null;
      if (price === null) continue;
      options.push({ id: `local:${z.id}`, carrier: 'local', carrierName: String(z.courier), serviceCode: String(z.id), serviceName: String(z.zone_name), priceMinor: price, originalPriceMinor: null, currency: cart.currency, estimate: String(z.delivery_time), transitDays: null, deliveryDate: null, cost: null });
    }
    if (options.length === 0) message = 'We cannot deliver to this state yet. Please contact us and we will arrange it.';
  } else if (!shipFrom) {
    deps.logger.warn('shipping.no_origin', { note: 'Set the store address under Shipping before international prices can be fetched' });
    message = 'International delivery prices are not available right now. Please try again later or contact us.';
  } else {
    const settings = (await carrierSettings(deps.db)).filter((s) => s.enabled && deps.carriers[s.code].configured);
    const customs = await customsFor(deps.db, lines, target, shipFrom.originCountry, 'QUOTE');
    const request = { from: shipFrom, to: { ...to, name: to.name || 'Customer', phone: to.phone || shipFrom.phone }, parcels, shipDate: deps.now(), customs };
    const answers = await Promise.allSettled(settings.map((s) => deps.carriers[s.code].rates(request)));
    answers.forEach((answer, k) => {
      const setting = settings[k] as CarrierSetting;
      if (answer.status === 'rejected') {
        deps.logger.warn('shipping.rates_failed', { carrier: setting.code, error: answer.reason instanceof Error ? answer.reason.message : String(answer.reason) });
        return;
      }
      const allowed = new Map(setting.services.map((s) => [s.code, s.name]));
      for (const rate of answer.value as Rate[]) {
        if (allowed.size && !allowed.has(rate.serviceCode)) continue;
        const price = carrierPriceIn(rate.amount, rate.currency, target, currencies, setting.markupBps);
        if (price === null) {
          deps.logger.warn('shipping.no_rate_for_currency', { carrier: setting.code, currency: rate.currency });
          continue;
        }
        options.push({
          id: `${setting.code}:${rate.serviceCode}`,
          carrier: setting.code,
          carrierName: setting.name,
          serviceCode: rate.serviceCode,
          serviceName: allowed.get(rate.serviceCode) || rate.serviceName,
          priceMinor: price,
          originalPriceMinor: null,
          currency: cart.currency,
          estimate: estimateText(rate),
          transitDays: rate.transitDays,
          deliveryDate: rate.deliveryDate,
          cost: { amount: rate.amount, currency: rate.currency },
        });
      }
    });
    if (options.length === 0) message = 'We could not get delivery prices for this address. Check the address, or try again in a few minutes.';
  }

  options.sort((a, b) => a.priceMinor - b.priceMinor || (a.transitDays ?? 99) - (b.transitDays ?? 99));
  // A free-delivery discount makes the cheapest option free.
  const cheapest = options[0];
  if (cart.freeShipping && cheapest) {
    cheapest.originalPriceMinor = cheapest.priceMinor;
    cheapest.priceMinor = 0;
  }

  const id = randomToken().slice(0, 32);
  const expiresAt = new Date(deps.now().getTime() + SHIPPING.quoteMinutes * 60_000);
  await deps.db.query(
    'insert into shipping_quotes (id, cart_id, currency, address, packages, options, duties_notice, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [id, cart.id, cart.currency, JSON.stringify(to), JSON.stringify(parcels), JSON.stringify(options), international, deps.now(), expiresAt],
  );
  return {
    id,
    currency: cart.currency,
    address: to,
    parcels,
    weightGrams: totalWeight(parcels),
    options: options.map(({ cost: _cost, ...shown }) => shown),
    dutiesNotice: international ? DUTIES_NOTICE : null,
    message,
    expiresAt: expiresAt.toISOString(),
  };
}

export interface ChosenOption {
  option: ShippingOption;
  address: Address;
  parcels: Parcel[];
  dutiesNotice: boolean;
}

/**
 * The option a customer chose from a quote, checked: the quote must be theirs
 * (same cart), still fresh, in the cart's currency, and for the same address.
 * Used by checkout (module 9).
 */
export async function chosenOption(db: Q, input: { quoteId: unknown; optionId: unknown; cartId: number; currency: string; address: Address }, now: Date): Promise<ChosenOption> {
  const stale = new ApiError(409, 'quote_expired', 'Delivery prices have changed. Choose a delivery option again.');
  const quoteId = typeof input.quoteId === 'string' ? input.quoteId : '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(quoteId)) throw stale;
  const found = await db.query('select cart_id, currency, address, packages, options, duties_notice, expires_at from shipping_quotes where id = $1', [quoteId]);
  const q = found.rows[0];
  if (!q || Number(q.cart_id) !== input.cartId || q.currency !== input.currency || (q.expires_at as Date) <= now) throw stale;
  const quoted = q.address as Address;
  const same = (a: unknown, b: unknown): boolean => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  if (!same(quoted.country, input.address.country) || !same(quoted.city, input.address.city) || !same(quoted.region, input.address.region) || !same(quoted.postalCode, input.address.postalCode) || !same(quoted.line1, input.address.line1)) throw stale;
  const option = (q.options as StoredOption[]).find((o) => o.id === input.optionId);
  if (!option) throw new ApiError(422, 'invalid', 'Choose a delivery option.', { shippingOption: 'Choose a delivery option.' });
  const { cost: _cost, ...shown } = option;
  return { option: shown, address: quoted, parcels: q.packages as Parcel[], dutiesNotice: q.duties_notice === true };
}

/** Quotes older than a day are of no use to anyone. Run daily by the worker (module 10). */
export async function pruneQuotes(db: Q, now: Date): Promise<number> {
  const result = await db.query("delete from shipping_quotes where expires_at < $1::timestamptz - interval '1 day'", [now]);
  return result.rowCount ?? 0;
}

// ----- labels -----

interface OrderForLabel {
  id: number;
  number: string;
  email: string;
  currency: string;
  paymentStatus: string;
  status: string;
  shippingMinor: number;
  carrier: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  to: Address;
}

async function orderForLabel(db: Q, orderId: number, lock: boolean): Promise<OrderForLabel> {
  const found = await db.query(`select * from orders where id = $1${lock ? ' for update' : ''}`, [orderId]);
  const o = found.rows[0];
  if (!o) throw new ApiError(404, 'not_found', 'We could not find that order.');
  return {
    id: Number(o.id),
    number: String(o.number),
    email: String(o.email),
    currency: String(o.currency),
    paymentStatus: String(o.payment_status),
    status: String(o.status),
    shippingMinor: Number(o.shipping_minor),
    carrier: (o.shipping_carrier as string | null) ?? null,
    serviceCode: (o.shipping_service_code as string | null) ?? null,
    serviceName: (o.shipping_service_name as string | null) ?? null,
    to: {
      name: String(o.ship_full_name ?? ''),
      phone: String(o.ship_phone ?? o.phone ?? ''),
      email: String(o.email),
      line1: String(o.ship_line1 ?? ''),
      line2: (o.ship_line2 as string | null) ?? null,
      city: String(o.ship_city ?? ''),
      region: (o.ship_region as string | null) ?? null,
      postalCode: (o.ship_postal_code as string | null) ?? null,
      country: String(o.ship_country ?? ''),
    },
  };
}

export interface ShipmentView {
  id: number;
  carrier: string;
  carrierName: string;
  serviceName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: Array<{ status: string; description: string; location: string | null; occurredAt: string }>;
}

const CARRIER_NAMES: Record<string, string> = { dhl: 'DHL Express', ups: 'UPS', fedex: 'FedEx' };

/** Statuses that mean a shipment is real (not a failed or abandoned attempt). */
const ACTIVE = "status in ('pending', 'label_bought', 'in_transit', 'out_for_delivery', 'delivered', 'exception')";

/**
 * Buy the carrier's label for a paid order, using the service the customer
 * chose. Safe to call twice: an order that already has a label gets it back.
 * Run by the worker straight after payment (module 10), or by staff.
 */
export async function buyLabel(deps: ShippingDeps, orderId: number, staffId: number | null): Promise<{ shipmentId: number; trackingNumber: string; created: boolean }> {
  const claim = await withTransaction(deps.db, async (c) => {
    const order = await orderForLabel(c, orderId, true);
    const existing = await c.query(`select id, status, tracking_number from shipments where order_id = $1 and carrier <> 'local' and ${ACTIVE} order by id desc limit 1`, [orderId]);
    const prior = existing.rows[0];
    if (prior && prior.status === 'pending') throw new ApiError(409, 'label_in_progress', 'A label is being bought for this order. Wait a moment and look again.');
    if (prior) return { order, existing: { shipmentId: Number(prior.id), trackingNumber: String(prior.tracking_number) } };
    if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partly_refunded') throw new ApiError(409, 'not_paid', 'Labels are bought only for paid orders.');
    if (order.status === 'cancelled' || order.status === 'returned') throw new ApiError(409, 'order_closed', 'This order is closed.');
    if (order.carrier === 'local' || order.carrier === null) throw new ApiError(409, 'local_delivery', 'This order goes by local courier. Record the dispatch instead of buying a label.');
    if (!order.serviceCode) throw new ApiError(409, 'no_service', 'This order has no delivery service chosen.');
    const made = await c.query("insert into shipments (order_id, carrier, service_code, service_name, rate_minor, rate_currency, status, created_by) values ($1, $2, $3, $4, $5, $6, 'pending', $7) returning id", [
      orderId, order.carrier, order.serviceCode, order.serviceName, order.shippingMinor, order.currency, staffId,
    ]);
    return { order, shipmentId: Number(made.rows[0]?.id) };
  });
  if ('existing' in claim && claim.existing) return { ...claim.existing, created: false };
  const { order } = claim;
  const shipmentId = (claim as { shipmentId: number }).shipmentId;

  try {
    const carrier = deps.carriers[order.carrier as CarrierCode];
    if (!carrier.configured) throw new CarrierError(`${carrier.name} is not set up on the server`);
    const shipFrom = await readShipFrom(deps.db);
    if (!shipFrom) throw new ApiError(409, 'no_origin', 'Set the store address under Shipping first.');
    const to = parseAddress(order.to, { full: true });
    const items = await deps.db.query("select variant_id, product_name, quantity, unit_price_minor, weight_grams from order_items where order_id = $1 and kind = 'variant' and variant_id is not null order by id", [orderId]);
    const lines = items.rows.map((r) => ({ variantId: Number(r.variant_id), productName: String(r.product_name), quantity: Number(r.quantity), unitMinor: Number(r.unit_price_minor), weightGrams: Number(r.weight_grams) }));
    const parcels = packItems(await itemsFor(deps.db, lines), await listPackageSizes(deps.db));
    if (parcels.length === 0) throw new ApiError(409, 'nothing_to_ship', 'This order has nothing to send.');
    const currencies = await currencyRows(deps.db);
    const customs = to.country !== shipFrom.country ? await customsFor(deps.db, lines, currencies.get(order.currency) as CurrencyRow, shipFrom.originCountry, order.number) : null;
    const result = await carrier.ship({ from: shipFrom, to, parcels, shipDate: deps.now(), customs, serviceCode: order.serviceCode as string, reference: order.number });

    await mkdir(deps.labelDir, { recursive: true });
    const saved: Array<Parcel & { trackingNumber: string; labelPath: string }> = [];
    for (const [k, label] of result.labels.entries()) {
      const file = `${order.number}-${shipmentId}-${k + 1}.${label.format}`;
      await writeFile(join(deps.labelDir, file), Buffer.from(label.data, 'base64'), { mode: 0o640 });
      const parcel = parcels[k] ?? (parcels[parcels.length - 1] as Parcel);
      saved.push({ ...parcel, trackingNumber: label.trackingNumber, labelPath: file });
    }
    await withTransaction(deps.db, async (c) => {
      await c.query(
        `update shipments set status = 'label_bought', tracking_number = $2, tracking_url = $3, carrier_shipment_id = $4, label_path = $5, label_format = $6,
           label_cost_minor = $7, label_cost_currency = $8, packages = $9, weight_grams = $10, package_size_id = $11 where id = $1`,
        [
          shipmentId, result.trackingNumber, result.trackingUrl, result.carrierShipmentId, saved[0]?.labelPath ?? null, result.labels[0]?.format ?? null,
          result.cost ? Math.round(result.cost.amount * 100) : null, result.cost?.currency ?? null, JSON.stringify(saved), totalWeight(parcels), parcels[0]?.packageSizeId ?? null,
        ],
      );
      await orderEvent(c, orderId, 'label_bought', `${carrier.name} label bought. Tracking number ${result.trackingNumber}.`, { staffId });
    });
    return { shipmentId, trackingNumber: result.trackingNumber, created: true };
  } catch (error) {
    // The attempt is let go so it can be tried again.
    await deps.db.query("delete from shipments where id = $1 and status = 'pending'", [shipmentId]);
    await orderEvent(deps.db, orderId, 'label_failed', `Could not buy the label: ${error instanceof Error ? error.message : 'unknown problem'}`, { staffId });
    if (error instanceof CarrierError) throw new ApiError(502, 'carrier_failed', `${error.message}. Try again, or buy the label on the carrier's own site and enter the tracking number.`);
    throw error;
  }
}

/** A label file of a shipment, for staff to print. */
export async function labelFile(deps: ShippingDeps, shipmentId: number, index: number): Promise<{ data: Buffer; format: string; name: string }> {
  const found = await deps.db.query('select packages, label_format from shipments where id = $1', [shipmentId]);
  const s = found.rows[0];
  const parcels = (s?.packages ?? []) as Array<{ labelPath?: string }>;
  const path = parcels[index]?.labelPath;
  if (!s || !path || !/^[A-Za-z0-9-]+\.(pdf|gif|png|zpl)$/.test(path)) throw new ApiError(404, 'not_found', 'There is no label for this parcel.');
  return { data: await readFile(join(deps.labelDir, path)), format: path.split('.').pop() as string, name: path };
}

// ----- local courier -----

/** Staff hand an order to a local courier and record it. */
export async function recordLocalDispatch(deps: ShippingDeps, orderId: number, input: Record<string, unknown>, staffId: number): Promise<{ shipmentId: number }> {
  const courier = text(input.courier, 80);
  const tracking = text(input.trackingNumber, 60) || null;
  const url = text(input.trackingUrl, 300) || null;
  if (!courier) throw new ApiError(422, 'invalid', 'Enter the courier.', { courier: 'Enter the courier.' });
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new ApiError(422, 'invalid', 'Enter a tracking link that starts with https://', { trackingUrl: 'Enter a tracking link that starts with https://' });
  return withTransaction(deps.db, async (c) => {
    const order = await orderForLabel(c, orderId, true);
    if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partly_refunded') throw new ApiError(409, 'not_paid', 'Only paid orders can be sent.');
    if (order.status === 'cancelled' || order.status === 'returned') throw new ApiError(409, 'order_closed', 'This order is closed.');
    const made = await c.query(
      "insert into shipments (order_id, carrier, service_name, courier, tracking_number, tracking_url, rate_minor, rate_currency, status, shipped_at, created_by) values ($1, 'local', $2, $3, $4, $5, $6, $7, 'in_transit', $8, $9) returning id",
      [orderId, order.serviceName, courier, tracking, url, order.shippingMinor, order.currency, deps.now(), staffId],
    );
    await c.query("update orders set status = 'shipped' where id = $1 and status = 'to_fulfil'", [orderId]);
    await orderEvent(c, orderId, 'shipped', `Sent with ${courier}${tracking ? `, tracking number ${tracking}` : ''}.`, { staffId, visible: true });
    return { shipmentId: Number(made.rows[0]?.id) };
  });
}

/** For local couriers, which have no tracking to read: staff say it arrived. */
export async function markDelivered(deps: ShippingDeps, shipmentId: number, staffId: number): Promise<void> {
  await withTransaction(deps.db, async (c) => {
    const found = await c.query('select order_id, carrier, status from shipments where id = $1 for update', [shipmentId]);
    const s = found.rows[0];
    if (!s) throw new ApiError(404, 'not_found', 'We could not find that shipment.');
    if (s.carrier !== 'local') throw new ApiError(409, 'tracked', 'Carrier parcels are marked delivered by their tracking.');
    if (s.status === 'delivered') return;
    await c.query("update shipments set status = 'delivered', delivered_at = $2 where id = $1", [shipmentId, deps.now()]);
    await settleOrder(c, Number(s.order_id), deps.now(), staffId);
  });
}

// ----- tracking -----

const RANK: Record<string, number> = { pending: 0, label_bought: 1, in_transit: 2, exception: 2, out_for_delivery: 3, delivered: 4, returned: 4 };

const STATUS_WORDS: Record<TrackingStatus, string> = {
  in_transit: 'Your order is on its way.',
  out_for_delivery: 'Your order is out for delivery today.',
  delivered: 'Your order has been delivered.',
  exception: 'There is a delay with your delivery. The carrier is working on it; we will keep watching.',
  returned: 'Your parcel is being returned to us. We will contact you.',
};

/** Once every parcel of an order has arrived, the order is delivered. */
async function settleOrder(c: Q, orderId: number, now: Date, staffId: number | null): Promise<void> {
  const open = await c.query(`select count(*)::int as n from shipments where order_id = $1 and ${ACTIVE} and status <> 'delivered'`, [orderId]);
  if (Number(open.rows[0]?.n) > 0) return;
  const changed = await c.query("update orders set status = 'delivered' where id = $1 and status in ('to_fulfil', 'shipped') returning id", [orderId]);
  if (changed.rowCount) await orderEvent(c, orderId, 'delivered', STATUS_WORDS.delivered, { staffId, visible: true });
  void now;
}

/** Ask the carrier where a parcel is, and record anything new. */
export async function refreshTracking(deps: ShippingDeps, shipmentId: number): Promise<{ status: string; newEvents: number }> {
  const found = await deps.db.query('select id, order_id, carrier, tracking_number, status from shipments where id = $1', [shipmentId]);
  const s = found.rows[0];
  if (!s) throw new ApiError(404, 'not_found', 'We could not find that shipment.');
  if (s.carrier === 'local' || !s.tracking_number) return { status: String(s.status), newEvents: 0 };
  let tracked;
  try {
    tracked = await deps.carriers[s.carrier as CarrierCode].track(String(s.tracking_number));
  } catch (error) {
    await deps.db.query('update shipments set last_tracked_at = $2 where id = $1', [shipmentId, deps.now()]);
    if (error instanceof CarrierError) throw new ApiError(502, 'carrier_failed', error.message);
    throw error;
  }
  return withTransaction(deps.db, async (c) => {
    const current = await c.query('select status, shipped_at from shipments where id = $1 for update', [shipmentId]);
    const before = String(current.rows[0]?.status);
    let added = 0;
    for (const e of tracked.events) {
      const r = await c.query('insert into shipment_events (shipment_id, status, description, location, occurred_at, raw) values ($1, $2, $3, $4, $5, $6) on conflict do nothing', [shipmentId, e.status, e.description.slice(0, 500), e.location, e.occurredAt, JSON.stringify(e.raw ?? null)]);
      added += r.rowCount ?? 0;
    }
    let status = before;
    // A status never goes backwards (a late "in transit" scan after delivery changes nothing), except into a problem and out of it again.
    if (tracked.status && (RANK[tracked.status] ?? 0) >= (RANK[before] ?? 0)) status = tracked.status;
    const firstMove = tracked.events.find((e) => e.status !== 'exception')?.occurredAt ?? (status !== 'label_bought' ? deps.now() : null);
    const delivered = status === 'delivered' ? (tracked.events.filter((e) => e.status === 'delivered').pop()?.occurredAt ?? deps.now()) : null;
    await c.query('update shipments set status = $2, last_tracked_at = $3, shipped_at = coalesce(shipped_at, $4), delivered_at = coalesce(delivered_at, $5) where id = $1', [shipmentId, status, deps.now(), status === 'label_bought' ? null : firstMove, delivered]);
    const orderId = Number(s.order_id);
    if (status !== before && status !== 'label_bought') {
      if (status === 'in_transit' || status === 'out_for_delivery') await c.query("update orders set status = 'shipped' where id = $1 and status = 'to_fulfil'", [orderId]);
      if (status === 'delivered') await settleOrder(c, orderId, deps.now(), null);
      else await orderEvent(c, orderId, `shipment_${status}`, STATUS_WORDS[status as TrackingStatus] ?? `Delivery status: ${status}`, { visible: true });
    }
    return { status, newEvents: added };
  });
}

/** Every parcel still on the way that has not been looked at for a while. Run by the worker (module 10). */
export async function refreshAllTracking(deps: ShippingDeps, limit = 50): Promise<{ checked: number; failed: number }> {
  const due = await deps.db.query(
    `select id from shipments where carrier <> 'local' and tracking_number is not null and status in ('label_bought', 'in_transit', 'out_for_delivery', 'exception')
       and (last_tracked_at is null or last_tracked_at < $1::timestamptz - make_interval(mins => $2)) order by last_tracked_at nulls first, id limit $3`,
    [deps.now(), SHIPPING.trackEveryMinutes, limit],
  );
  let failed = 0;
  for (const row of due.rows) {
    try {
      await refreshTracking(deps, Number(row.id));
    } catch (error) {
      failed += 1;
      deps.logger.warn('shipping.tracking_failed', { shipmentId: Number(row.id), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: due.rows.length, failed };
}

/** The shipments of an order with their tracking history, as customers and staff see them. */
export async function orderShipments(db: Q, orderId: number): Promise<ShipmentView[]> {
  const found = await db.query(`select id, carrier, courier, service_name, tracking_number, tracking_url, status, shipped_at, delivered_at from shipments where order_id = $1 and status <> 'pending' order by id`, [orderId]);
  const events = await db.query('select shipment_id, status, description, location, occurred_at from shipment_events where shipment_id = any($1::bigint[]) order by occurred_at desc, id desc', [found.rows.map((r) => r.id)]);
  return found.rows.map((r) => ({
    id: Number(r.id),
    carrier: String(r.carrier),
    carrierName: r.carrier === 'local' ? String(r.courier ?? 'Local courier') : (CARRIER_NAMES[String(r.carrier)] ?? String(r.carrier)),
    serviceName: (r.service_name as string | null) ?? null,
    trackingNumber: (r.tracking_number as string | null) ?? null,
    trackingUrl: (r.tracking_url as string | null) ?? (r.tracking_number && r.carrier !== 'local' ? trackingUrl(r.carrier as CarrierCode, String(r.tracking_number)) : null),
    status: String(r.status),
    shippedAt: r.shipped_at ? (r.shipped_at as Date).toISOString() : null,
    deliveredAt: r.delivered_at ? (r.delivered_at as Date).toISOString() : null,
    events: events.rows
      .filter((e) => Number(e.shipment_id) === Number(r.id))
      .map((e) => ({ status: String(e.status), description: String(e.description), location: (e.location as string | null) ?? null, occurredAt: (e.occurred_at as Date).toISOString() })),
  }));
}

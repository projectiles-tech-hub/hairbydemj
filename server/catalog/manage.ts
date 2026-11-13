// What staff do to the catalogue: products, variants, prices, stock,
// categories and collections. Every function takes the signed-in staff
// member and checks their role first; every change is written to the
// activity log.

import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { CatalogDeps } from './public.js';
import { describeRules, parseRules, storedRules, type Rule } from './rules.js';

/** The signed-in staff member doing the work. */
export type Actor = StaffMember;

type Q = { query: DbClient['query'] };
type Input = Record<string, unknown>;
interface Meta {
  ip: string | null;
}

const fieldError = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });
const notFound = (what: string): ApiError => new ApiError(404, 'not_found', `That ${what} does not exist.`);

// ----- reading what staff type -----

function str(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function optional(value: unknown, max = 200): string | null {
  const s = str(value, max);
  return s === '' ? null : s;
}
function required(input: Input, field: string, label: string, max = 200): string {
  const s = str(input[field], max);
  if (s === '') throw fieldError(field, `Enter ${label}.`);
  return s;
}
function whole(value: unknown, field: string, label: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw fieldError(field, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
function optionalWhole(value: unknown, field: string, label: string, min: number, max: number): number | null {
  return value === undefined || value === null || value === '' ? null : whole(value, field, label, min, max);
}
function idOf(value: unknown, field: string, label: string): number {
  return whole(value, field, label, 1, Number.MAX_SAFE_INTEGER);
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** A slug nobody else in the table is using: "bone-straight-wig", then "-2", "-3"... */
async function freeSlug(db: Q, table: 'products' | 'categories' | 'collections', wanted: string, exceptId: number | null): Promise<string> {
  const base = slugify(wanted);
  if (base === '') throw fieldError('name', 'Use letters or numbers in the name.');
  for (let n = 1; n < 200; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await db.query(`select 1 from ${table} where slug = $1 and id is distinct from $2`, [slug, exceptId]);
    if (taken.rows.length === 0) return slug;
  }
  throw fieldError('name', 'Choose a different name; too many things share this one.');
}

function isUnique(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}
function isForeignKey(error: unknown): boolean {
  return (error as { code?: string }).code === '23503';
}

const PRODUCT_STATUSES = ['draft', 'published', 'scheduled', 'unpublished'] as const;

// ----- currencies and prices -----

interface Currency {
  code: string;
  isBase: boolean;
  rate: number | null;
  markupBps: number;
  rounding: number;
}

async function loadCurrencies(db: Q): Promise<Currency[]> {
  const result = await db.query('select code, is_base, rate_from_base, rate_markup_bps, rounding_minor from currencies where enabled order by is_base desc, code');
  return result.rows.map((r) => ({ code: String(r.code), isBase: r.is_base === true, rate: r.rate_from_base === null ? null : Number(r.rate_from_base), markupBps: Number(r.rate_markup_bps), rounding: Number(r.rounding_minor) }));
}

/** A base-currency price turned into another currency: daily rate, plus the markup, rounded as the settings say. */
export function convertPrice(baseMinor: number, currency: { rate: number | null; markupBps: number; rounding: number; code: string }): number {
  if (currency.rate === null) throw new ApiError(422, 'no_rate', `There is no exchange rate for ${currency.code} yet. Set it under Payments and currencies, or type the ${currency.code} price yourself.`);
  const raw = baseMinor * currency.rate * (1 + currency.markupBps / 10_000);
  return Math.max(currency.rounding, Math.round(raw / currency.rounding) * currency.rounding);
}

/**
 * Save prices for one variant. `prices` maps a currency code to an amount in
 * minor units (or to null to remove that price). With autoConvert, every
 * currency not typed in is worked out from the base-currency price.
 */
async function writePrices(db: Q, variantId: number, prices: unknown, autoConvert: boolean): Promise<void> {
  const given = (prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {}) as Record<string, unknown>;
  const currencies = await loadCurrencies(db);
  const known = new Map(currencies.map((c) => [c.code, c]));
  for (const code of Object.keys(given)) if (!known.has(code)) throw fieldError('prices', `${code} is not a currency we sell in.`);
  const base = currencies.find((c) => c.isBase);
  let baseMinor: number | null = null;
  for (const currency of currencies) {
    const value = given[currency.code];
    if (value === null) {
      await db.query('delete from prices where variant_id = $1 and currency = $2', [variantId, currency.code]);
      continue;
    }
    if (value === undefined) continue;
    const amount = whole(value, 'prices', `The ${currency.code} price`, 0, 9_000_000_000_000);
    if (currency.isBase) baseMinor = amount;
    await db.query(
      `insert into prices (variant_id, currency, amount_minor, is_converted) values ($1, $2, $3, false)
       on conflict (variant_id, currency) do update set amount_minor = excluded.amount_minor, is_converted = false, compare_at_minor = case when prices.compare_at_minor > excluded.amount_minor then prices.compare_at_minor end`,
      [variantId, currency.code, amount],
    );
  }
  if (!autoConvert || !base) return;
  if (baseMinor === null) {
    const existing = await db.query('select amount_minor from prices where variant_id = $1 and currency = $2', [variantId, base.code]);
    if (existing.rows[0]) baseMinor = Number(existing.rows[0].amount_minor);
  }
  if (baseMinor === null) throw fieldError('prices', `Enter the ${base.code} price first; the others are worked out from it.`);
  for (const currency of currencies) {
    if (currency.isBase || given[currency.code] !== undefined) continue;
    await db.query(
      `insert into prices (variant_id, currency, amount_minor, is_converted) values ($1, $2, $3, true)
       on conflict (variant_id, currency) do update set amount_minor = excluded.amount_minor, is_converted = true, compare_at_minor = null
       where prices.is_converted`,
      [variantId, currency.code, convertPrice(baseMinor, currency)],
    );
  }
}

// ----- products -----

export interface AdminVariant {
  id: number;
  sku: string;
  lengthInches: number | null;
  densityPercent: number | null;
  colour: string | null;
  laceType: string | null;
  capSize: string | null;
  weightGrams: number;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  isActive: boolean;
  position: number;
  prices: Record<string, { amountMinor: number; isConverted: boolean }>;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
}

export interface AdminProduct {
  id: number;
  name: string;
  slug: string;
  description: string;
  careGuide: string;
  categoryId: number | null;
  origin: string | null;
  texture: string | null;
  grade: string | null;
  tags: string[];
  status: (typeof PRODUCT_STATUSES)[number];
  publishAt: Date | null;
  isFinalSale: boolean;
  packageSizeId: number | null;
  customsDescription: string | null;
  hsCode: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  collectionIds: number[];
  variants: AdminVariant[];
}

function productColumns(input: Input, existing?: Record<string, unknown>): Record<string, unknown> {
  const has = (key: string): boolean => key in input;
  const out: Record<string, unknown> = {};
  if (has('description')) out.description = str(input.description, 20_000);
  if (has('careGuide')) out.care_guide = str(input.careGuide, 20_000);
  if (has('categoryId')) out.category_id = input.categoryId === null || input.categoryId === '' ? null : idOf(input.categoryId, 'categoryId', 'The category');
  if (has('origin')) out.hair_origin = optional(input.origin, 80);
  if (has('texture')) out.texture = optional(input.texture, 80);
  if (has('grade')) out.grade = optional(input.grade, 80);
  if (has('tags')) {
    const tags = Array.isArray(input.tags) ? input.tags : typeof input.tags === 'string' ? input.tags.split(',') : [];
    out.tags = [...new Set(tags.map((t) => str(t, 40).toLowerCase()).filter(Boolean))].slice(0, 30);
  }
  if (has('isFinalSale')) out.is_final_sale = input.isFinalSale === true;
  if (has('packageSizeId')) out.package_size_id = input.packageSizeId === null || input.packageSizeId === '' ? null : idOf(input.packageSizeId, 'packageSizeId', 'The package size');
  if (has('customsDescription')) out.customs_description = optional(input.customsDescription, 200);
  if (has('hsCode')) out.hs_code = optional(input.hsCode, 20);
  if (has('seoTitle')) out.seo_title = optional(input.seoTitle, 200);
  if (has('seoDescription')) out.seo_description = optional(input.seoDescription, 400);
  if (has('status') || has('publishAt')) {
    const status = has('status') ? str(input.status) : String(existing?.status ?? 'draft');
    if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) throw fieldError('status', 'Choose draft, published, scheduled or unpublished.');
    out.status = status;
    if (status === 'scheduled') {
      const when = has('publishAt') ? new Date(String(input.publishAt)) : (existing?.publish_at as Date | null | undefined);
      if (!when || Number.isNaN(when.getTime())) throw fieldError('publishAt', 'Choose the date and time to publish.');
      out.publish_at = when;
    } else {
      out.publish_at = null;
    }
  }
  return out;
}

async function setCollections(db: Q, productId: number, collectionIds: unknown): Promise<void> {
  if (!Array.isArray(collectionIds)) throw fieldError('collectionIds', 'Choose collections from the list.');
  const ids = [...new Set(collectionIds.map((x) => idOf(x, 'collectionIds', 'A collection')))];
  const manual = await db.query("select id from collections where id = any ($1) and kind = 'manual'", [ids]);
  if (manual.rows.length !== ids.length) throw fieldError('collectionIds', 'Only hand-picked collections can have products added to them; rule-based ones fill themselves.');
  await db.query("delete from collection_products cp using collections c where c.id = cp.collection_id and c.kind = 'manual' and cp.product_id = $1 and cp.collection_id <> all ($2)", [productId, ids]);
  for (const id of ids) {
    await db.query('insert into collection_products (collection_id, product_id, position) values ($1, $2, (select coalesce(max(position), 0) + 1 from collection_products where collection_id = $1)) on conflict do nothing', [id, productId]);
  }
}

export async function getAdminProduct(db: Q, id: number): Promise<AdminProduct> {
  const found = await db.query('select * from products where id = $1', [id]);
  const p = found.rows[0] as Record<string, unknown> | undefined;
  if (!p) throw notFound('product');
  const [variants, collections] = await Promise.all([
    db.query(
      `select v.*, coalesce(i.on_hand, 0) as on_hand, coalesce(i.reserved, 0) as reserved, coalesce(i.low_stock_threshold, 3) as low_stock_threshold,
              coalesce((select jsonb_object_agg(pr.currency, jsonb_build_object('amountMinor', pr.amount_minor, 'isConverted', pr.is_converted)) from prices pr where pr.variant_id = v.id), '{}') as prices
       from variants v left join inventory i on i.variant_id = v.id where v.product_id = $1 order by v.position, v.id`,
      [id],
    ),
    db.query('select collection_id from collection_products where product_id = $1 order by collection_id', [id]),
  ]);
  const nullable = (v: unknown): number | null => (v === null ? null : Number(v));
  return {
    id: Number(p.id),
    name: String(p.name),
    slug: String(p.slug),
    description: String(p.description),
    careGuide: String(p.care_guide),
    categoryId: nullable(p.category_id),
    origin: (p.hair_origin as string | null) ?? null,
    texture: (p.texture as string | null) ?? null,
    grade: (p.grade as string | null) ?? null,
    tags: p.tags as string[],
    status: p.status as AdminProduct['status'],
    publishAt: (p.publish_at as Date | null) ?? null,
    isFinalSale: p.is_final_sale === true,
    packageSizeId: nullable(p.package_size_id),
    customsDescription: (p.customs_description as string | null) ?? null,
    hsCode: (p.hs_code as string | null) ?? null,
    seoTitle: (p.seo_title as string | null) ?? null,
    seoDescription: (p.seo_description as string | null) ?? null,
    collectionIds: collections.rows.map((r) => Number(r.collection_id)),
    variants: variants.rows.map((v) => ({
      id: Number(v.id),
      sku: String(v.sku),
      lengthInches: nullable(v.length_inches),
      densityPercent: nullable(v.density_percent),
      colour: (v.colour as string | null) ?? null,
      laceType: (v.lace_type as string | null) ?? null,
      capSize: (v.cap_size as string | null) ?? null,
      weightGrams: Number(v.weight_grams),
      lengthMm: nullable(v.length_mm),
      widthMm: nullable(v.width_mm),
      heightMm: nullable(v.height_mm),
      isActive: v.is_active === true,
      position: Number(v.position),
      prices: v.prices as AdminVariant['prices'],
      onHand: Number(v.on_hand),
      reserved: Number(v.reserved),
      lowStockThreshold: Number(v.low_stock_threshold),
    })),
  };
}

export async function readProduct(deps: CatalogDeps, actor: StaffMember, id: number): Promise<AdminProduct> {
  requireAccess(actor, 'products', 'view');
  return getAdminProduct(deps.db, id);
}

export async function createProduct(deps: CatalogDeps, actor: StaffMember, input: Input, meta: Meta): Promise<AdminProduct> {
  requireAccess(actor, 'products', 'change');
  const name = required(input, 'name', 'the product name', 160);
  const columns = { status: 'draft', created_at: deps.now(), ...productColumns(input) };
  try {
    return await withTransaction(deps.db, async (c) => {
      const slug = await freeSlug(c, 'products', str(input.slug) || name, null);
      const keys = ['name', 'slug', ...Object.keys(columns)];
      const made = await c.query(`insert into products (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [name, slug, ...Object.values(columns)]);
      const id = Number(made.rows[0]?.id);
      if ('collectionIds' in input) await setCollections(c, id, input.collectionIds);
      await logActivity(c, actor, 'Products', `Created the product "${name}"`, { type: 'product', id }, meta.ip);
      return getAdminProduct(c, id);
    });
  } catch (error) {
    if (isForeignKey(error)) throw fieldError('categoryId', 'Choose a category and package size from the lists.');
    throw error;
  }
}

export async function updateProduct(deps: CatalogDeps, actor: StaffMember, id: number, input: Input, meta: Meta): Promise<AdminProduct> {
  requireAccess(actor, 'products', 'change');
  try {
    return await withTransaction(deps.db, async (c) => {
      const found = await c.query('select * from products where id = $1 for update', [id]);
      const existing = found.rows[0] as Record<string, unknown> | undefined;
      if (!existing) throw notFound('product');
      const columns = productColumns(input, existing);
      if ('name' in input) columns.name = required(input, 'name', 'the product name', 160);
      if ('slug' in input) columns.slug = await freeSlug(c, 'products', str(input.slug) || String(columns.name ?? existing.name), id);
      const keys = Object.keys(columns);
      if (keys.length) await c.query(`update products set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...Object.values(columns)]);
      if ('collectionIds' in input) await setCollections(c, id, input.collectionIds);
      const what = columns.status && columns.status !== existing.status ? `Changed "${String(columns.name ?? existing.name)}" from ${String(existing.status)} to ${String(columns.status)}` : `Edited the product "${String(columns.name ?? existing.name)}"`;
      await logActivity(c, actor, 'Products', what, { type: 'product', id }, meta.ip);
      return getAdminProduct(c, id);
    });
  } catch (error) {
    if (isForeignKey(error)) throw fieldError('categoryId', 'Choose a category and package size from the lists.');
    throw error;
  }
}

/** Delete a product that was never ordered. One that has orders is unpublished instead, so order history stays whole. */
export async function deleteProduct(deps: CatalogDeps, actor: StaffMember, id: number, meta: Meta): Promise<{ deleted: boolean }> {
  requireAccess(actor, 'products', 'change');
  return withTransaction(deps.db, async (c) => {
    const found = await c.query('select name from products where id = $1 for update', [id]);
    const name = found.rows[0]?.name as string | undefined;
    if (name === undefined) throw notFound('product');
    const ordered = await c.query('select 1 from order_items where product_id = $1 limit 1', [id]);
    if (ordered.rows.length > 0) {
      await c.query("update products set status = 'unpublished', publish_at = null where id = $1", [id]);
      await logActivity(c, actor, 'Products', `Unpublished "${name}" (it has orders, so it was not deleted)`, { type: 'product', id }, meta.ip);
      return { deleted: false };
    }
    await c.query('delete from products where id = $1', [id]);
    await logActivity(c, actor, 'Products', `Deleted the product "${name}"`, { type: 'product', id }, meta.ip);
    return { deleted: true };
  });
}

export interface AdminProductRow {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  status: string;
  variants: number;
  stock: number;
  priceFromMinor: number | null;
  image: string | null;
}

export async function listAdminProducts(
  deps: CatalogDeps,
  actor: StaffMember,
  query: { q?: string; status?: string; categoryId?: number; stock?: 'in' | 'low' | 'out'; texture?: string; origin?: string; page?: number; perPage?: number },
): Promise<{ products: AdminProductRow[]; total: number; page: number; perPage: number }> {
  requireAccess(actor, 'products', 'view');
  const values: unknown[] = [];
  const param = (v: unknown): string => `$${values.push(v)}`;
  const where: string[] = ['true'];
  if (query.q) where.push(`(p.name ilike '%' || ${param(query.q.replace(/[%_\\]/g, '\\$&'))} || '%' or exists (select 1 from variants v where v.product_id = p.id and v.sku ilike '%' || $${values.length} || '%'))`);
  if (query.status) where.push(`p.status = ${param(query.status)}`);
  if (query.categoryId) where.push(`p.category_id = ${param(query.categoryId)}`);
  if (query.texture) where.push(`lower(p.texture) = lower(${param(query.texture)})`);
  if (query.origin) where.push(`lower(p.hair_origin) = lower(${param(query.origin)})`);
  const stockSql = '(select coalesce(sum(i.on_hand - i.reserved), 0) from variants v join inventory i on i.variant_id = v.id where v.product_id = p.id)';
  const lowSql = '(select count(*) from variants v join inventory i on i.variant_id = v.id where v.product_id = p.id and i.on_hand - i.reserved <= i.low_stock_threshold)';
  if (query.stock === 'in') where.push(`${stockSql} > 0`);
  if (query.stock === 'out') where.push(`${stockSql} <= 0`);
  if (query.stock === 'low') where.push(`${lowSql} > 0`);
  const perPage = Math.min(Math.max(1, query.perPage ?? 25), 100);
  const page = Math.max(1, query.page ?? 1);
  const total = await deps.db.query(`select count(*)::int as n from products p where ${where.join(' and ')}`, values);
  const result = await deps.db.query(
    `select p.id, p.name, p.slug, p.status, c.name as category,
            (select count(*)::int from variants v where v.product_id = p.id) as variants,
            ${stockSql}::int as stock,
            (select min(pr.amount_minor) from variants v join prices pr on pr.variant_id = v.id join currencies cu on cu.code = pr.currency and cu.is_base where v.product_id = p.id) as price_from,
            (select m.path from product_media m where m.product_id = p.id and m.kind = 'image' and m.status = 'ready' order by m.position, m.id limit 1) as image
     from products p left join categories c on c.id = p.category_id
     where ${where.join(' and ')} order by p.created_at desc, p.id desc limit ${param(perPage)} offset ${param((page - 1) * perPage)}`,
    values,
  );
  return {
    products: result.rows.map((r) => ({ id: Number(r.id), name: String(r.name), slug: String(r.slug), category: (r.category as string | null) ?? null, status: String(r.status), variants: Number(r.variants), stock: Number(r.stock), priceFromMinor: r.price_from === null ? null : Number(r.price_from), image: (r.image as string | null) ?? null })),
    total: Number(total.rows[0]?.n),
    page,
    perPage,
  };
}

// ----- variants -----

function variantColumns(input: Input, creating: boolean): Record<string, unknown> {
  const has = (key: string): boolean => key in input;
  const out: Record<string, unknown> = {};
  if (creating || has('sku')) {
    const sku = required(input, 'sku', 'a SKU', 60);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(sku)) throw fieldError('sku', 'A SKU can use letters, numbers, dots, dashes, slashes and underscores.');
    out.sku = sku.toUpperCase();
  }
  if (has('lengthInches')) out.length_inches = optionalWhole(input.lengthInches, 'lengthInches', 'Length in inches', 1, 60);
  if (has('densityPercent')) out.density_percent = optionalWhole(input.densityPercent, 'densityPercent', 'Density', 50, 400);
  if (has('colour')) out.colour = optional(input.colour, 60);
  if (has('laceType')) out.lace_type = optional(input.laceType, 60);
  if (has('capSize')) out.cap_size = optional(input.capSize, 40);
  if (creating || has('weightGrams')) out.weight_grams = whole(input.weightGrams, 'weightGrams', 'Weight in grams', 1, 50_000);
  if (has('lengthMm')) out.length_mm = optionalWhole(input.lengthMm, 'lengthMm', 'Package length', 1, 3000);
  if (has('widthMm')) out.width_mm = optionalWhole(input.widthMm, 'widthMm', 'Package width', 1, 3000);
  if (has('heightMm')) out.height_mm = optionalWhole(input.heightMm, 'heightMm', 'Package height', 1, 3000);
  if (has('isActive')) out.is_active = input.isActive === true;
  if (has('position')) out.position = whole(input.position, 'position', 'Position', 0, 10_000);
  return out;
}

function variantConflict(error: unknown): never {
  const constraint = (error as { constraint?: string }).constraint ?? '';
  if (constraint.includes('sku')) throw fieldError('sku', 'Another variant already uses this SKU.');
  throw new ApiError(409, 'duplicate_variant', 'This product already has a variant with the same length, density, colour, lace type and cap size.');
}

async function insertVariant(c: Q, productId: number, columns: Record<string, unknown>, stock: { onHand: number; threshold: number }, actor: StaffMember): Promise<number> {
  const keys = ['product_id', ...Object.keys(columns)];
  const made = await c.query(`insert into variants (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [productId, ...Object.values(columns)]);
  const id = Number(made.rows[0]?.id);
  await c.query('insert into inventory (variant_id, on_hand, low_stock_threshold) values ($1, $2, $3)', [id, stock.onHand, stock.threshold]);
  if (stock.onHand > 0) await c.query("insert into stock_movements (variant_id, change, on_hand_after, reason, note, staff_id) values ($1, $2, $2, 'received', 'Opening stock', $3)", [id, stock.onHand, actor.id]);
  return id;
}

export async function createVariant(deps: CatalogDeps, actor: StaffMember, productId: number, input: Input, meta: Meta): Promise<AdminProduct> {
  requireAccess(actor, 'products', 'change');
  const columns = variantColumns(input, true);
  const stock = { onHand: optionalWhole(input.onHand, 'onHand', 'Stock', 0, 1_000_000) ?? 0, threshold: optionalWhole(input.lowStockThreshold, 'lowStockThreshold', 'The low-stock alert', 0, 1_000_000) ?? 3 };
  try {
    return await withTransaction(deps.db, async (c) => {
      const product = await c.query('select name from products where id = $1 for update', [productId]);
      if (!product.rows[0]) throw notFound('product');
      const id = await insertVariant(c, productId, columns, stock, actor);
      await writePrices(c, id, input.prices, input.autoConvert === true);
      await logActivity(c, actor, 'Products', `Added the variant ${String(columns.sku)} to "${String(product.rows[0].name)}"`, { type: 'variant', id }, meta.ip);
      return getAdminProduct(c, productId);
    });
  } catch (error) {
    if (isUnique(error)) variantConflict(error);
    throw error;
  }
}

/** Short code for a colour in a SKU: "Natural black" becomes NB, "1B/27" becomes 1B27, "613" stays 613. */
export function colourCode(colour: string): string {
  const words = colour.trim().split(/\s+/);
  const code = words.length > 1 && words.every((w) => /^[A-Za-z]/.test(w)) ? words.map((w) => w[0]).join('') : colour.replace(/[^A-Za-z0-9]/g, '');
  return code.toUpperCase().slice(0, 8) || 'X';
}

/**
 * Make one variant for every combination of the lengths, densities and
 * colours given, as the product editor's "variants generated" does.
 * Combinations the product already has are skipped.
 */
export async function generateVariants(deps: CatalogDeps, actor: StaffMember, productId: number, input: Input, meta: Meta): Promise<{ created: number; skipped: number; product: AdminProduct }> {
  requireAccess(actor, 'products', 'change');
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map((x) => x.trim().replace(/[%"]/g, '')).filter(Boolean) : []);
  const lengths = [...new Set(list(input.lengths).map((v) => whole(v, 'lengths', 'Each length', 1, 60)))];
  const densities = [...new Set(list(input.densities).map((v) => whole(v, 'densities', 'Each density', 50, 400)))];
  const colours = [...new Set(list(input.colours).map((v) => str(v, 60)).filter(Boolean))];
  const axes = { lengths: lengths.length ? lengths : [null], densities: densities.length ? densities : [null], colours: colours.length ? colours : [null] };
  const count = axes.lengths.length * axes.densities.length * axes.colours.length;
  if (lengths.length + densities.length + colours.length === 0) throw fieldError('lengths', 'Enter at least one length, density or colour.');
  if (count > 300) throw fieldError('lengths', `That would make ${count} variants. Make at most 300 at a time.`);
  const prefix = (str(input.skuPrefix, 20) || 'SKU').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SKU';
  const weight = whole(input.weightGrams, 'weightGrams', 'Weight in grams', 1, 50_000);
  const laceType = optional(input.laceType, 60);
  const capSize = optional(input.capSize, 40);
  const threshold = optionalWhole(input.lowStockThreshold, 'lowStockThreshold', 'The low-stock alert', 0, 1_000_000) ?? 3;

  return withTransaction(deps.db, async (c) => {
    const product = await c.query('select name from products where id = $1 for update', [productId]);
    if (!product.rows[0]) throw notFound('product');
    const start = Number((await c.query('select coalesce(max(position), -1) + 1 as next from variants where product_id = $1', [productId])).rows[0]?.next);
    let created = 0;
    let skipped = 0;
    for (const length of axes.lengths) {
      for (const density of axes.densities) {
        for (const colour of axes.colours) {
          const exists = await c.query(
            'select 1 from variants where product_id = $1 and length_inches is not distinct from $2 and density_percent is not distinct from $3 and colour is not distinct from $4 and lace_type is not distinct from $5 and cap_size is not distinct from $6',
            [productId, length, density, colour, laceType, capSize],
          );
          if (exists.rows.length) {
            skipped++;
            continue;
          }
          const parts = [prefix, length, density, colour === null ? null : colourCode(colour)].filter((x) => x !== null);
          let sku = parts.join('-');
          for (let n = 2; (await c.query('select 1 from variants where sku = $1', [sku])).rows.length; n++) sku = `${parts.join('-')}-${n}`;
          const id = await insertVariant(c, productId, { sku, length_inches: length, density_percent: density, colour, lace_type: laceType, cap_size: capSize, weight_grams: weight, position: start + created }, { onHand: 0, threshold }, actor);
          if (input.prices !== undefined) await writePrices(c, id, input.prices, input.autoConvert === true);
          created++;
        }
      }
    }
    await logActivity(c, actor, 'Products', `Generated ${created} variants for "${String(product.rows[0].name)}"`, { type: 'product', id: productId }, meta.ip);
    return { created, skipped, product: await getAdminProduct(c, productId) };
  });
}

export async function updateVariant(deps: CatalogDeps, actor: StaffMember, variantId: number, input: Input, meta: Meta): Promise<AdminProduct> {
  requireAccess(actor, 'products', 'change');
  const columns = variantColumns(input, false);
  try {
    return await withTransaction(deps.db, async (c) => {
      const found = await c.query('select v.product_id, v.sku, p.name from variants v join products p on p.id = v.product_id where v.id = $1 for update of v', [variantId]);
      const v = found.rows[0] as { product_id: number; sku: string; name: string } | undefined;
      if (!v) throw notFound('variant');
      const keys = Object.keys(columns);
      if (keys.length) await c.query(`update variants set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [variantId, ...Object.values(columns)]);
      if ('lowStockThreshold' in input) await c.query('update inventory set low_stock_threshold = $2 where variant_id = $1', [variantId, whole(input.lowStockThreshold, 'lowStockThreshold', 'The low-stock alert', 0, 1_000_000)]);
      if ('prices' in input || input.autoConvert === true) {
        const before = await c.query('select currency, amount_minor from prices where variant_id = $1', [variantId]);
        await writePrices(c, variantId, input.prices, input.autoConvert === true);
        const after = await c.query('select currency, amount_minor from prices where variant_id = $1 order by currency', [variantId]);
        const old = new Map(before.rows.map((r) => [String(r.currency), Number(r.amount_minor)]));
        const changes = after.rows.filter((r) => old.get(String(r.currency)) !== Number(r.amount_minor)).map((r) => `${String(r.currency)} ${old.has(String(r.currency)) ? formatMinor(old.get(String(r.currency)) ?? 0) + ' to ' : ''}${formatMinor(Number(r.amount_minor))}`);
        if (changes.length) await logActivity(c, actor, 'Products', `Price of "${v.name}" ${v.sku} changed: ${changes.join('; ')}`, { type: 'variant', id: variantId }, meta.ip);
      }
      if (keys.length) await logActivity(c, actor, 'Products', `Edited the variant ${v.sku} of "${v.name}"`, { type: 'variant', id: variantId }, meta.ip);
      return getAdminProduct(c, Number(v.product_id));
    });
  } catch (error) {
    if (isUnique(error)) variantConflict(error);
    throw error;
  }
}

function formatMinor(minor: number): string {
  return (minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Delete a variant that was never ordered. One that has orders is switched off instead. */
export async function deleteVariant(deps: CatalogDeps, actor: StaffMember, variantId: number, meta: Meta): Promise<{ deleted: boolean }> {
  requireAccess(actor, 'products', 'change');
  return withTransaction(deps.db, async (c) => {
    const found = await c.query('select v.sku, p.name from variants v join products p on p.id = v.product_id where v.id = $1 for update of v', [variantId]);
    const v = found.rows[0] as { sku: string; name: string } | undefined;
    if (!v) throw notFound('variant');
    const ordered = await c.query('select 1 from order_items where variant_id = $1 limit 1', [variantId]);
    if (ordered.rows.length > 0) {
      await c.query('update variants set is_active = false where id = $1', [variantId]);
      await logActivity(c, actor, 'Products', `Switched off the variant ${v.sku} of "${v.name}" (it has orders, so it was not deleted)`, { type: 'variant', id: variantId }, meta.ip);
      return { deleted: false };
    }
    await c.query('delete from variants where id = $1', [variantId]);
    await logActivity(c, actor, 'Products', `Deleted the variant ${v.sku} of "${v.name}"`, { type: 'variant', id: variantId }, meta.ip);
    return { deleted: true };
  });
}

// ----- inventory -----

export const STOCK_REASONS = { received: 'Received from supplier', damaged: 'Damaged', correction: 'Stock count correction', supplier_return: 'Returned to supplier' } as const;
export type StockReason = keyof typeof STOCK_REASONS;

export interface InventoryRow {
  variantId: number;
  product: string;
  variant: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
  lastChange: { at: Date; reason: string } | null;
}

export async function listInventory(deps: CatalogDeps, actor: StaffMember, query: { lowOnly?: boolean; categoryId?: number; q?: string; page?: number; perPage?: number }): Promise<{ rows: InventoryRow[]; total: number; page: number; perPage: number }> {
  requireAccess(actor, 'products', 'view');
  const values: unknown[] = [];
  const param = (v: unknown): string => `$${values.push(v)}`;
  const where = ['true'];
  if (query.lowOnly) where.push('i.on_hand - i.reserved <= i.low_stock_threshold');
  if (query.categoryId) where.push(`p.category_id = ${param(query.categoryId)}`);
  if (query.q) where.push(`(v.sku ilike '%' || ${param(query.q.replace(/[%_\\]/g, '\\$&'))} || '%' or p.name ilike '%' || $${values.length} || '%')`);
  const perPage = Math.min(Math.max(1, query.perPage ?? 25), 100);
  const page = Math.max(1, query.page ?? 1);
  const from = `from variants v join products p on p.id = v.product_id join inventory i on i.variant_id = v.id where ${where.join(' and ')}`;
  const total = await deps.db.query(`select count(*)::int as n ${from}`, values);
  const result = await deps.db.query(
    `select v.id, p.name, v.sku, v.length_inches, v.density_percent, v.colour, i.on_hand, i.reserved, i.low_stock_threshold,
            (select jsonb_build_object('at', m.created_at, 'reason', m.reason) from stock_movements m where m.variant_id = v.id order by m.created_at desc, m.id desc limit 1) as last
     ${from} order by p.name, v.position, v.id limit ${param(perPage)} offset ${param((page - 1) * perPage)}`,
    values,
  );
  return {
    rows: result.rows.map((r) => {
      const last = r.last as { at: string; reason: string } | null;
      const available = Number(r.on_hand) - Number(r.reserved);
      return {
        variantId: Number(r.id),
        product: String(r.name),
        variant: [r.length_inches ? `${Number(r.length_inches)}"` : null, r.density_percent ? `${Number(r.density_percent)}%` : null, r.colour as string | null].filter(Boolean).join(' · '),
        sku: String(r.sku),
        onHand: Number(r.on_hand),
        reserved: Number(r.reserved),
        available,
        lowStockThreshold: Number(r.low_stock_threshold),
        isLow: available <= Number(r.low_stock_threshold),
        lastChange: last ? { at: new Date(last.at), reason: last.reason } : null,
      };
    }),
    total: Number(total.rows[0]?.n),
    page,
    perPage,
  };
}

/** Add to, remove from or set the stock of one variant. The change and its reason are kept. */
export async function adjustStock(deps: CatalogDeps, actor: StaffMember, variantId: number, input: Input, meta: Meta): Promise<{ onHand: number; reserved: number; available: number }> {
  requireAccess(actor, 'products', 'change');
  const mode = str(input.mode);
  if (mode !== 'add' && mode !== 'remove' && mode !== 'set') throw fieldError('mode', 'Choose add, remove or set to.');
  const quantity = whole(input.quantity, 'quantity', 'Quantity', mode === 'set' ? 0 : 1, 1_000_000);
  const reason = str(input.reason) as StockReason;
  if (!(reason in STOCK_REASONS)) throw fieldError('reason', 'Choose a reason.');
  const note = optional(input.note, 300);
  return withTransaction(deps.db, async (c) => {
    // The row is locked so two adjustments, or an adjustment and a sale, cannot overwrite each other.
    const found = await c.query('select i.on_hand, i.reserved, v.sku, p.name from inventory i join variants v on v.id = i.variant_id join products p on p.id = v.product_id where i.variant_id = $1 for update of i', [variantId]);
    const row = found.rows[0] as { on_hand: number; reserved: number; sku: string; name: string } | undefined;
    if (!row) throw notFound('variant');
    const after = mode === 'add' ? row.on_hand + quantity : mode === 'remove' ? row.on_hand - quantity : quantity;
    if (after < 0) throw fieldError('quantity', `There are only ${row.on_hand} on hand.`);
    if (after < row.reserved) throw fieldError('quantity', `${row.reserved} are held for orders, so stock cannot go below that.`);
    const change = after - row.on_hand;
    if (change === 0) throw fieldError('quantity', `Stock is already ${row.on_hand}.`);
    await c.query('update inventory set on_hand = $2 where variant_id = $1', [variantId, after]);
    await c.query('insert into stock_movements (variant_id, change, on_hand_after, reason, note, staff_id) values ($1, $2, $3, $4, $5, $6)', [variantId, change, after, reason, note, actor.id]);
    await logActivity(c, actor, 'Inventory', `Stock of "${row.name}" ${row.sku} changed from ${row.on_hand} to ${after}: ${STOCK_REASONS[reason].toLowerCase()}`, { type: 'variant', id: variantId }, meta.ip);
    return { onHand: after, reserved: row.reserved, available: after - row.reserved };
  });
}

// ----- categories -----

export interface AdminCategory {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string;
  position: number;
  showInMenu: boolean;
  products: number;
}

export async function listAdminCategories(deps: CatalogDeps, actor: StaffMember): Promise<AdminCategory[]> {
  requireAccess(actor, 'products', 'view');
  const result = await deps.db.query('select c.*, (select count(*)::int from products p where p.category_id = c.id) as products from categories c order by coalesce(c.parent_id, c.id), c.parent_id nulls first, c.position, c.name');
  return result.rows.map((r) => ({ id: Number(r.id), parentId: r.parent_id === null ? null : Number(r.parent_id), name: String(r.name), slug: String(r.slug), description: String(r.description), position: Number(r.position), showInMenu: r.show_in_menu === true, products: Number(r.products) }));
}

async function categoryColumns(c: Q, input: Input, id: number | null): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (id === null || 'name' in input) out.name = required(input, 'name', 'the category name', 80);
  if (id === null || 'slug' in input || 'name' in input) out.slug = await freeSlug(c, 'categories', str(input.slug) || String(out.name ?? ''), id);
  if ('description' in input) out.description = str(input.description, 2000);
  if ('position' in input) out.position = whole(input.position, 'position', 'Position', 0, 10_000);
  if ('showInMenu' in input) out.show_in_menu = input.showInMenu === true;
  if ('parentId' in input) {
    const parentId = input.parentId === null || input.parentId === '' ? null : idOf(input.parentId, 'parentId', 'The parent category');
    if (parentId !== null) {
      // A category cannot sit inside itself or inside one of its own sub-categories.
      const loop = await c.query('with recursive up as (select id, parent_id from categories where id = $1 union all select c.id, c.parent_id from categories c join up on c.id = up.parent_id) select 1 from up where id = $2', [parentId, id]);
      if (parentId === id || loop.rows.length > 0) throw fieldError('parentId', 'A category cannot be placed inside itself.');
      const exists = await c.query('select 1 from categories where id = $1', [parentId]);
      if (!exists.rows.length) throw fieldError('parentId', 'Choose a parent category from the list.');
    }
    out.parent_id = parentId;
  }
  return out;
}

export async function saveCategory(deps: CatalogDeps, actor: StaffMember, id: number | null, input: Input, meta: Meta): Promise<{ id: number }> {
  requireAccess(actor, 'products', 'change');
  return withTransaction(deps.db, async (c) => {
    if (id !== null && !(await c.query('select 1 from categories where id = $1 for update', [id])).rows.length) throw notFound('category');
    const columns = await categoryColumns(c, input, id);
    const keys = Object.keys(columns);
    let saved = id;
    if (id === null) {
      const made = await c.query(`insert into categories (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(columns));
      saved = Number(made.rows[0]?.id);
    } else if (keys.length) {
      await c.query(`update categories set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...Object.values(columns)]);
    }
    const name = (await c.query('select name from categories where id = $1', [saved])).rows[0]?.name as string;
    await logActivity(c, actor, 'Categories and collections', `${id === null ? 'Created' : 'Edited'} the category ${name}`, { type: 'category', id: saved ?? 0 }, meta.ip);
    return { id: saved ?? 0 };
  });
}

export async function deleteCategory(deps: CatalogDeps, actor: StaffMember, id: number, meta: Meta): Promise<void> {
  requireAccess(actor, 'products', 'change');
  await withTransaction(deps.db, async (c) => {
    const found = await c.query('select name, (select count(*)::int from products p where p.category_id = categories.id) as products, (select count(*)::int from categories k where k.parent_id = categories.id) as children from categories where id = $1 for update', [id]);
    const row = found.rows[0] as { name: string; products: number; children: number } | undefined;
    if (!row) throw notFound('category');
    if (row.products > 0 || row.children > 0) throw new ApiError(409, 'in_use', `${row.name} still has ${row.products} product(s) and ${row.children} sub-categor${row.children === 1 ? 'y' : 'ies'}. Move them first.`);
    await c.query('delete from categories where id = $1', [id]);
    await logActivity(c, actor, 'Categories and collections', `Deleted the category ${row.name}`, { type: 'category', id }, meta.ip);
  });
}

// ----- collections and shop-the-look sets -----

export interface AdminCollection {
  id: number;
  name: string;
  slug: string;
  description: string;
  kind: 'manual' | 'rules';
  isLook: boolean;
  rules: Rule[];
  /** "Hand-picked" or a sentence describing the rules, as the admin list shows. */
  type: string;
  status: 'draft' | 'live';
  position: number;
  bannerPath: string | null;
  products: number;
  items?: Array<{ productId: number; name: string; variantId: number | null; position: number }>;
}

function collectionFromRow(r: Record<string, unknown>, products: number): AdminCollection {
  const rules = storedRules(r.rules) ?? [];
  return {
    id: Number(r.id),
    name: String(r.name),
    slug: String(r.slug),
    description: String(r.description),
    kind: r.kind as 'manual' | 'rules',
    isLook: r.is_look === true,
    rules,
    type: r.kind === 'manual' ? 'Hand-picked' : describeRules(rules),
    status: r.status as 'draft' | 'live',
    position: Number(r.position),
    bannerPath: (r.banner_path as string | null) ?? null,
    products,
  };
}

/** How many products a collection holds now. For rule-based ones this asks the same question the shop does. */
async function countCollection(deps: CatalogDeps, db: Db | Q, r: Record<string, unknown>): Promise<number> {
  if (r.kind === 'manual') return Number((await db.query('select count(*)::int as n from collection_products where collection_id = $1', [r.id])).rows[0]?.n);
  const { rulesToSql, VISIBLE_SQL } = await import('./rules.js');
  const rules = storedRules(r.rules);
  if (!rules || rules.length === 0) return 0;
  const values: unknown[] = [deps.now()];
  const conditions = rulesToSql(rules, (v) => `$${values.push(v)}`, '$1');
  return Number((await db.query(`select count(*)::int as n from products p where ${VISIBLE_SQL('p', '$1')} and ${conditions.join(' and ')}`, values)).rows[0]?.n);
}

export async function listAdminCollections(deps: CatalogDeps, actor: StaffMember): Promise<AdminCollection[]> {
  requireAccess(actor, 'products', 'view');
  const result = await deps.db.query('select * from collections order by position, name');
  const out: AdminCollection[] = [];
  for (const r of result.rows) out.push(collectionFromRow(r, await countCollection(deps, deps.db, r)));
  return out;
}

export async function readCollection(deps: CatalogDeps, actor: StaffMember, id: number): Promise<AdminCollection> {
  requireAccess(actor, 'products', 'view');
  return loadCollection(deps, deps.db, id);
}

async function loadCollection(deps: CatalogDeps, db: Db | Q, id: number): Promise<AdminCollection> {
  const found = await db.query('select * from collections where id = $1', [id]);
  const r = found.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw notFound('collection');
  const collection = collectionFromRow(r, await countCollection(deps, db, r));
  if (collection.kind === 'manual') {
    const items = await db.query('select cp.product_id, p.name, cp.variant_id, cp.position from collection_products cp join products p on p.id = cp.product_id where cp.collection_id = $1 order by cp.position, p.id', [id]);
    collection.items = items.rows.map((i) => ({ productId: Number(i.product_id), name: String(i.name), variantId: i.variant_id === null ? null : Number(i.variant_id), position: Number(i.position) }));
  }
  return collection;
}

/**
 * Create or edit a collection. For a hand-picked collection or a look,
 * `items` (a list of { productId, variantId? }) sets its products and their order.
 */
export async function saveCollection(deps: CatalogDeps, actor: StaffMember, id: number | null, input: Input, meta: Meta): Promise<AdminCollection> {
  requireAccess(actor, 'products', 'change');
  return withTransaction(deps.db, async (c) => {
    const found = id === null ? null : ((await c.query('select * from collections where id = $1 for update', [id])).rows[0] as Record<string, unknown> | undefined);
    if (id !== null && !found) throw notFound('collection');
    const columns: Record<string, unknown> = {};
    if (id === null || 'name' in input) columns.name = required(input, 'name', 'the collection name', 120);
    if (id === null || 'slug' in input || 'name' in input) columns.slug = await freeSlug(c, 'collections', str(input.slug) || String(columns.name ?? ''), id);
    if ('description' in input) columns.description = str(input.description, 4000);
    if ('position' in input) columns.position = whole(input.position, 'position', 'Position', 0, 10_000);
    if ('status' in input) {
      if (input.status !== 'draft' && input.status !== 'live') throw fieldError('status', 'Choose draft or live.');
      columns.status = input.status;
    }
    const isLook = 'isLook' in input ? input.isLook === true : found?.is_look === true;
    let kind = 'kind' in input ? str(input.kind) : String(found?.kind ?? (isLook ? 'manual' : 'manual'));
    if (kind !== 'manual' && kind !== 'rules') throw fieldError('kind', 'Choose rules or hand-picked.');
    if (isLook && kind !== 'manual') {
      if ('kind' in input) throw fieldError('kind', 'A shop-the-look set is always hand-picked.');
      kind = 'manual';
    }
    columns.kind = kind;
    columns.is_look = isLook;
    if (kind === 'rules') {
      if ('rules' in input) columns.rules = JSON.stringify(parseRules(input.rules));
      else if (found?.kind !== 'rules') columns.rules = '[]';
    } else {
      columns.rules = '[]';
    }
    const keys = Object.keys(columns);
    let saved = id;
    if (id === null) {
      const made = await c.query(`insert into collections (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(columns));
      saved = Number(made.rows[0]?.id);
    } else {
      await c.query(`update collections set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...Object.values(columns)]);
    }
    const collectionId = saved ?? 0;
    if (kind === 'rules') {
      // Rules decide the products, so any hand-picked list is cleared.
      await c.query('delete from collection_products where collection_id = $1', [collectionId]);
      if ('items' in input) throw fieldError('items', 'A rule-based collection fills itself; products cannot be added by hand.');
    } else if ('items' in input) {
      if (!Array.isArray(input.items) || input.items.length > 200) throw fieldError('items', 'Send the products as a list of at most 200.');
      await c.query('delete from collection_products where collection_id = $1', [collectionId]);
      const seen = new Set<number>();
      let position = 0;
      for (const raw of input.items) {
        const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const productId = idOf(item.productId, 'items', 'Each product');
        if (seen.has(productId)) throw fieldError('items', 'A product can be in a collection only once.');
        seen.add(productId);
        const variantId = item.variantId === undefined || item.variantId === null ? null : idOf(item.variantId, 'items', 'Each variant');
        if (variantId !== null) {
          const owns = await c.query('select 1 from variants where id = $1 and product_id = $2', [variantId, productId]);
          if (!owns.rows.length) throw fieldError('items', 'A chosen variant does not belong to its product.');
        }
        try {
          await c.query('savepoint item');
          await c.query('insert into collection_products (collection_id, product_id, variant_id, position) values ($1, $2, $3, $4)', [collectionId, productId, variantId, position++]);
        } catch (error) {
          if (isForeignKey(error)) {
            await c.query('rollback to savepoint item');
            throw fieldError('items', 'One of the products does not exist.');
          }
          throw error;
        }
      }
    }
    const name = String(columns.name ?? found?.name);
    await logActivity(c, actor, 'Categories and collections', `${id === null ? 'Created' : 'Edited'} the ${isLook ? 'look' : 'collection'} ${name}`, { type: 'collection', id: collectionId }, meta.ip);
    return loadCollection(deps, c, collectionId);
  });
}

export async function deleteCollection(deps: CatalogDeps, actor: StaffMember, id: number, meta: Meta): Promise<void> {
  requireAccess(actor, 'products', 'change');
  await withTransaction(deps.db, async (c) => {
    const gone = await c.query('delete from collections where id = $1 returning name', [id]);
    if (!gone.rows[0]) throw notFound('collection');
    await logActivity(c, actor, 'Categories and collections', `Deleted the collection ${String(gone.rows[0].name)}`, { type: 'collection', id }, meta.ip);
  });
}

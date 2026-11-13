// What customers see of the catalogue: categories, collections, product
// lists with filters and sorting, product pages and shop-the-look sets.
// Only published products, active variants and prices in the asked currency
// are ever returned.

import type { Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import { rulesToSql, SOLD_SQL, storedRules, VISIBLE_SQL } from './rules.js';
import { MATCH_SQL, parseSearch, RANK_SQL, recordSearch } from '../search/search.js';

/** A photo: its address folder, description and the widths that exist (add "/640.webp" or "/640.jpg" under /media/). */
export interface Picture {
  path: string;
  alt: string;
  widths: number[];
}

export interface CatalogDeps {
  db: Db;
  now: () => Date;
}

export const SORTS = ['newest', 'best_selling', 'price_low', 'price_high', 'name', 'relevance'] as const;
export type Sort = (typeof SORTS)[number];

export interface ProductQuery {
  currency: string;
  /** Words to search for (module 12). With it, the list is sorted by how well products fit unless another sort is asked for. */
  q?: string;
  category?: string;
  collection?: string;
  textures?: string[];
  origins?: string[];
  laceTypes?: string[];
  colours?: string[];
  lengths?: number[];
  densities?: number[];
  minPriceMinor?: number;
  maxPriceMinor?: number;
  inStock?: boolean;
  sort?: Sort;
  cursor?: string;
  limit?: number;
}

export interface ProductCard {
  id: number;
  slug: string;
  name: string;
  category: { slug: string; name: string } | null;
  texture: string | null;
  origin: string | null;
  image: Picture | null;
  currency: string;
  priceFromMinor: number;
  priceToMinor: number;
  compareAtMinor: number | null;
  inStock: boolean;
  lengths: number[];
  isNew: boolean;
}

export interface ProductPage {
  products: ProductCard[];
  /** Pass back as "cursor" to get the next products; null at the end of the list. */
  nextCursor: string | null;
  /** How many products match in all. Sent with the first page only. */
  total?: number;
  /** For a search: what was searched for, the corrected words if any, and whether "any word" was used because "all words" found nothing. */
  search?: { query: string; corrected: string | null; broadened: boolean };
}

export const PAGE_SIZE = { default: 24, max: 48 };

const notFound = (what: string): ApiError => new ApiError(404, 'not_found', `That ${what} does not exist.`);

async function currencyOf(db: Db, code: string | undefined): Promise<string> {
  const wanted = (code ?? '').toUpperCase();
  const result = await db.query('select code, is_base from currencies where enabled order by is_base desc');
  const codes = result.rows.map((r) => String(r.code));
  if (wanted === '') return codes[0] ?? 'NGN';
  if (!codes.includes(wanted)) throw new ApiError(422, 'invalid', `We do not sell in ${wanted}. Choose one of: ${codes.join(', ')}.`, { currency: 'Choose a currency we sell in.' });
  return wanted;
}

function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

function decodeCursor(cursor: string): [string | number, number] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && Number.isInteger(value[1])) return [value[0], value[1] as number];
  } catch {
    // fall through
  }
  throw new ApiError(422, 'invalid', 'That place in the list is not valid. Start the list again.');
}

/** Sort key, its direction and its SQL type, for each way of sorting. */
const SORT_SQL: Record<Sort, { key: string; desc: boolean; cast: string }> = {
  newest: { key: 'created_key', desc: true, cast: 'text' },
  best_selling: { key: 'sold', desc: true, cast: 'bigint' },
  price_low: { key: 'price_from', desc: false, cast: 'bigint' },
  price_high: { key: 'price_from', desc: true, cast: 'bigint' },
  name: { key: 'name_key', desc: false, cast: 'text' },
  relevance: { key: 'rank', desc: true, cast: 'float8' },
};

/** A list of products for a category, a collection or the whole shop, one page at a time. */
export async function listProducts(deps: CatalogDeps, query: ProductQuery): Promise<ProductPage> {
  const currency = await currencyOf(deps.db, query.currency);
  const values: unknown[] = [];
  const param = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const now = param(deps.now());
  const cur = param(currency);
  const where: string[] = [VISIBLE_SQL('p', now)];

  if (query.category) {
    where.push(`p.category_id in (with recursive tree as (select id from categories where slug = ${param(query.category)} union all select c.id from categories c join tree t on c.parent_id = t.id) select id from tree)`);
  }
  if (query.collection) {
    const found = await deps.db.query("select id, kind, rules from collections where slug = $1 and status = 'live'", [query.collection]);
    const collection = found.rows[0] as { id: number; kind: string; rules: unknown } | undefined;
    if (!collection) throw notFound('collection');
    if (collection.kind === 'manual') {
      where.push(`p.id in (select product_id from collection_products where collection_id = ${param(collection.id)})`);
    } else {
      const rules = storedRules(collection.rules);
      // A collection with no rules, or rules we cannot read, shows nothing rather than everything.
      if (!rules || rules.length === 0) where.push('false');
      else where.push(...rulesToSql(rules, param, now));
    }
  }
  const lowerList = (list: string[]): string[] => list.map((x) => x.toLowerCase());
  if (query.textures?.length) where.push(`lower(p.texture) = any (${param(lowerList(query.textures))})`);
  if (query.origins?.length) where.push(`lower(p.hair_origin) = any (${param(lowerList(query.origins))})`);
  // Filters on variants must all hold for the same variant, and that variant must have a price.
  const variantWhere: string[] = [];
  if (query.laceTypes?.length) variantWhere.push(`lower(v.lace_type) = any (${param(lowerList(query.laceTypes))})`);
  if (query.colours?.length) variantWhere.push(`lower(v.colour) = any (${param(lowerList(query.colours))})`);
  if (query.lengths?.length) variantWhere.push(`v.length_inches = any (${param(query.lengths)})`);
  if (query.densities?.length) variantWhere.push(`v.density_percent = any (${param(query.densities)})`);
  if (query.minPriceMinor !== undefined) variantWhere.push(`pr.amount_minor >= ${param(query.minPriceMinor)}`);
  if (query.maxPriceMinor !== undefined) variantWhere.push(`pr.amount_minor <= ${param(query.maxPriceMinor)}`);
  if (query.inStock) variantWhere.push('exists (select 1 from inventory i where i.variant_id = v.id and i.on_hand - i.reserved > 0)');
  // A search: products whose words match, with typing mistakes corrected.
  let rankSql = '0::float8';
  let search: ProductPage['search'];
  let parsedSearch: Awaited<ReturnType<typeof parseSearch>> | null = null;
  if (query.q && query.q.trim()) {
    const parsed = await parseSearch(deps.db, query.q);
    parsedSearch = parsed;
    if (parsed.lengths.length) variantWhere.push(`v.length_inches = any (${param(parsed.lengths)})`);
    let broadened = false;
    if (parsed.tsquery) {
      let tsquery = parsed.tsquery;
      if (parsed.tsqueryAny) {
        // All the words first; if nothing has them all, any of them.
        const all = await deps.db.query(`select 1 from products p where ${VISIBLE_SQL('p', '$1')} and ${MATCH_SQL('p', '$2', '$3')} limit 1`, [deps.now(), parsed.tsquery, parsed.normalised]);
        if (!all.rowCount) {
          tsquery = parsed.tsqueryAny;
          broadened = true;
        }
      }
      const tsParam = param(tsquery);
      const typedParam = param(parsed.normalised);
      where.push(MATCH_SQL('p', tsParam, typedParam));
      rankSql = RANK_SQL('p', tsParam, typedParam);
    }
    search = { query: parsed.normalised, corrected: parsed.corrected, broadened };
  }
  if (variantWhere.length) {
    where.push(`exists (select 1 from variants v join prices pr on pr.variant_id = v.id and pr.currency = ${cur} where v.product_id = p.id and v.is_active and ${variantWhere.join(' and ')})`);
  }

  const base = `
    select p.id, p.slug, p.name, p.texture, p.hair_origin, p.created_at,
           to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as created_key,
           lower(p.name) as name_key,
           c.slug as category_slug, c.name as category_name,
           x.price_from, x.price_to, x.compare_at, x.lengths,
           coalesce(x.available, 0) as available,
           ${SOLD_SQL('p')}::bigint as sold,
           ${rankSql}::float8 as rank,
           (select jsonb_build_object('path', m.path, 'alt', m.alt, 'widths', m.widths) from product_media m where m.product_id = p.id and m.kind = 'image' and m.status = 'ready' order by m.position, m.id limit 1) as image
    from products p
    left join categories c on c.id = p.category_id
    join lateral (
      select min(pr.amount_minor) as price_from, max(pr.amount_minor) as price_to,
             max(pr.compare_at_minor) filter (where pr.compare_at_minor is not null) as compare_at,
             array_agg(distinct v.length_inches order by v.length_inches) filter (where v.length_inches is not null) as lengths,
             sum(coalesce(i.on_hand - i.reserved, 0)) as available
      from variants v
      join prices pr on pr.variant_id = v.id and pr.currency = ${cur}
      left join inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.is_active
    ) x on x.price_from is not null
    where ${where.join(' and ')}`;

  const sort = SORT_SQL[query.sort ?? (search ? 'relevance' : 'newest')];
  const limit = Math.min(Math.max(1, query.limit ?? PAGE_SIZE.default), PAGE_SIZE.max);
  let total: number | undefined;
  let page = '';
  if (query.cursor) {
    const [key, id] = decodeCursor(query.cursor);
    page = `where (${sort.key}, id) ${sort.desc ? '<' : '>'} (${param(key)}::${sort.cast}, ${param(id)}::bigint)`;
  } else {
    const counted = await deps.db.query(`select count(*)::int as n from (${base}) b`, values);
    total = Number(counted.rows[0]?.n);
  }
  const dir = sort.desc ? 'desc' : 'asc';
  const result = await deps.db.query(`select * from (${base}) b ${page} order by ${sort.key} ${dir}, id ${dir} limit ${param(limit + 1)}`, values);
  const rows = result.rows.slice(0, limit) as Array<Record<string, unknown>>;
  // The first page of a search is noted for the admin's search report.
  if (parsedSearch && total !== undefined) await recordSearch(deps.db, parsedSearch, total, deps.now());
  const last = rows[rows.length - 1];
  const newSince = deps.now().getTime() - 30 * 86_400_000;
  return {
    products: rows.map((r) => ({
      id: Number(r.id),
      slug: String(r.slug),
      name: String(r.name),
      category: r.category_slug ? { slug: String(r.category_slug), name: String(r.category_name) } : null,
      texture: (r.texture as string | null) ?? null,
      origin: (r.hair_origin as string | null) ?? null,
      image: (r.image as Picture | null) ?? null,
      currency,
      priceFromMinor: Number(r.price_from),
      priceToMinor: Number(r.price_to),
      compareAtMinor: r.compare_at === null ? null : Number(r.compare_at),
      inStock: Number(r.available) > 0,
      lengths: (r.lengths as number[] | null) ?? [],
      isNew: (r.created_at as Date).getTime() > newSince,
    })),
    nextCursor: result.rows.length > limit && last ? encodeCursor([sort.cast === 'text' ? String(last[sort.key]) : Number(last[sort.key]), Number(last.id)]) : null,
    ...(total === undefined ? {} : { total }),
    ...(search ? { search } : {}),
  };
}

export interface Filters {
  textures: string[];
  origins: string[];
  laceTypes: string[];
  colours: string[];
  lengths: number[];
  densities: number[];
  currency: string;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
}

/** The choices to offer in the filter panel for a category (or the whole shop). */
export async function listFilters(deps: CatalogDeps, query: { currency: string; category?: string }): Promise<Filters> {
  const currency = await currencyOf(deps.db, query.currency);
  const values: unknown[] = [deps.now(), currency];
  let category = '';
  if (query.category) {
    values.push(query.category);
    category = 'and p.category_id in (with recursive tree as (select id from categories where slug = $3 union all select c.id from categories c join tree t on c.parent_id = t.id) select id from tree)';
  }
  const result = await deps.db.query(
    `with shown as (
       select p.texture, p.hair_origin, v.lace_type, v.colour, v.length_inches, v.density_percent, pr.amount_minor
       from products p join variants v on v.product_id = p.id and v.is_active
       join prices pr on pr.variant_id = v.id and pr.currency = $2
       where ${VISIBLE_SQL('p', '$1')} ${category}
     )
     select coalesce(array_agg(distinct texture order by texture) filter (where texture is not null), '{}') as textures,
            coalesce(array_agg(distinct hair_origin order by hair_origin) filter (where hair_origin is not null), '{}') as origins,
            coalesce(array_agg(distinct lace_type order by lace_type) filter (where lace_type is not null), '{}') as lace_types,
            coalesce(array_agg(distinct colour order by colour) filter (where colour is not null), '{}') as colours,
            coalesce(array_agg(distinct length_inches order by length_inches) filter (where length_inches is not null), '{}') as lengths,
            coalesce(array_agg(distinct density_percent order by density_percent) filter (where density_percent is not null), '{}') as densities,
            min(amount_minor) as min_price, max(amount_minor) as max_price
     from shown`,
    values,
  );
  const r = result.rows[0] as Record<string, unknown>;
  return {
    textures: r.textures as string[],
    origins: r.origins as string[],
    laceTypes: r.lace_types as string[],
    colours: r.colours as string[],
    lengths: (r.lengths as number[]).map(Number),
    densities: (r.densities as number[]).map(Number),
    currency,
    minPriceMinor: r.min_price === null ? null : Number(r.min_price),
    maxPriceMinor: r.max_price === null ? null : Number(r.max_price),
  };
}

export interface ProductDetail {
  id: number;
  slug: string;
  name: string;
  description: string;
  careGuide: string;
  category: { slug: string; name: string } | null;
  origin: string | null;
  texture: string | null;
  grade: string | null;
  tags: string[];
  isFinalSale: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  currency: string;
  /** Photos and video, in the order staff set. A video's pictures are its poster; add "/video.mp4" for the film. */
  media: Array<{ kind: 'image' | 'video'; path: string; alt: string; colour: string | null; width: number | null; height: number | null; widths: number[]; durationMs: number | null }>;
  variants: Array<{
    id: number;
    sku: string;
    lengthInches: number | null;
    densityPercent: number | null;
    colour: string | null;
    laceType: string | null;
    capSize: string | null;
    priceMinor: number;
    compareAtMinor: number | null;
    /** How many can be bought now: stock on hand less what is held for orders. */
    available: number;
    lowStock: boolean;
  }>;
}

export async function getProduct(deps: CatalogDeps, slug: string, currencyCode: string): Promise<ProductDetail> {
  const currency = await currencyOf(deps.db, currencyCode);
  const found = await deps.db.query(
    `select p.*, c.slug as category_slug, c.name as category_name from products p left join categories c on c.id = p.category_id
     where p.slug = $1 and ${VISIBLE_SQL('p', '$2')}`,
    [slug, deps.now()],
  );
  const p = found.rows[0] as Record<string, unknown> | undefined;
  if (!p) throw notFound('product');
  const [media, variants] = await Promise.all([
    deps.db.query("select kind, path, alt, colour, width, height, widths, duration_ms from product_media where product_id = $1 and status = 'ready' order by position, id", [p.id]),
    deps.db.query(
      `select v.id, v.sku, v.length_inches, v.density_percent, v.colour, v.lace_type, v.cap_size, pr.amount_minor, pr.compare_at_minor,
              greatest(coalesce(i.on_hand - i.reserved, 0), 0) as available, coalesce(i.low_stock_threshold, 0) as threshold
       from variants v join prices pr on pr.variant_id = v.id and pr.currency = $2
       left join inventory i on i.variant_id = v.id
       where v.product_id = $1 and v.is_active order by v.position, v.id`,
      [p.id, currency],
    ),
  ]);
  if (variants.rows.length === 0) throw notFound('product');
  return {
    id: Number(p.id),
    slug: String(p.slug),
    name: String(p.name),
    description: String(p.description),
    careGuide: String(p.care_guide),
    category: p.category_slug ? { slug: String(p.category_slug), name: String(p.category_name) } : null,
    origin: (p.hair_origin as string | null) ?? null,
    texture: (p.texture as string | null) ?? null,
    grade: (p.grade as string | null) ?? null,
    tags: p.tags as string[],
    isFinalSale: p.is_final_sale === true,
    seoTitle: (p.seo_title as string | null) ?? null,
    seoDescription: (p.seo_description as string | null) ?? null,
    currency,
    media: media.rows.map((m) => ({ kind: m.kind as 'image' | 'video', path: String(m.path), alt: String(m.alt), colour: (m.colour as string | null) ?? null, width: m.width === null ? null : Number(m.width), height: m.height === null ? null : Number(m.height), widths: ((m.widths as number[] | null) ?? []).map(Number), durationMs: m.duration_ms === null ? null : Number(m.duration_ms) })),
    variants: variants.rows.map((v) => {
      const available = Number(v.available);
      return {
        id: Number(v.id),
        sku: String(v.sku),
        lengthInches: v.length_inches === null ? null : Number(v.length_inches),
        densityPercent: v.density_percent === null ? null : Number(v.density_percent),
        colour: (v.colour as string | null) ?? null,
        laceType: (v.lace_type as string | null) ?? null,
        capSize: (v.cap_size as string | null) ?? null,
        priceMinor: Number(v.amount_minor),
        compareAtMinor: v.compare_at_minor === null ? null : Number(v.compare_at_minor),
        available,
        lowStock: available > 0 && available <= Number(v.threshold),
      };
    }),
  };
}

export interface CategoryNode {
  id: number;
  slug: string;
  name: string;
  description: string;
  productCount: number;
  children: CategoryNode[];
}

/** The category menu as a tree. A category's count includes its sub-categories. */
export async function listCategories(deps: CatalogDeps): Promise<CategoryNode[]> {
  const result = await deps.db.query(
    `select c.id, c.parent_id, c.slug, c.name, c.description,
            (select count(*)::int from products p where p.category_id = c.id and ${VISIBLE_SQL('p', '$1')}) as own_count
     from categories c where c.show_in_menu order by c.position, c.name`,
    [deps.now()],
  );
  const nodes = new Map<number, CategoryNode & { parentId: number | null }>();
  for (const r of result.rows) nodes.set(Number(r.id), { id: Number(r.id), slug: String(r.slug), name: String(r.name), description: String(r.description), productCount: Number(r.own_count), children: [], parentId: r.parent_id === null ? null : Number(r.parent_id) });
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else if (node.parentId === null) roots.push(node);
  }
  const total = (node: CategoryNode): number => {
    node.productCount += node.children.reduce((sum, child) => sum + total(child), 0);
    return node.productCount;
  };
  roots.forEach(total);
  const strip = (node: CategoryNode): CategoryNode => ({ id: node.id, slug: node.slug, name: node.name, description: node.description, productCount: node.productCount, children: node.children.map(strip) });
  return roots.map(strip);
}

export interface CollectionSummary {
  slug: string;
  name: string;
  description: string;
  bannerPath: string | null;
  isLook: boolean;
}

export async function listCollections(deps: CatalogDeps, options: { looks?: boolean } = {}): Promise<CollectionSummary[]> {
  const result = await deps.db.query("select slug, name, description, banner_path, is_look from collections where status = 'live' and is_look = $1 order by position, name", [options.looks === true]);
  return result.rows.map((r) => ({ slug: String(r.slug), name: String(r.name), description: String(r.description), bannerPath: (r.banner_path as string | null) ?? null, isLook: r.is_look === true }));
}

export interface Look extends CollectionSummary {
  currency: string;
  items: Array<{ product: { slug: string; name: string; image: Picture | null }; variantId: number; description: string; priceMinor: number; available: boolean }>;
  /** The price of the whole look, and whether every piece can be bought now. */
  totalMinor: number;
  allAvailable: boolean;
}

/** A shop-the-look set: the exact variants that go in the bag with one tap. */
export async function getLook(deps: CatalogDeps, slug: string, currencyCode: string): Promise<Look> {
  const currency = await currencyOf(deps.db, currencyCode);
  const found = await deps.db.query("select id, slug, name, description, banner_path from collections where slug = $1 and status = 'live' and is_look", [slug]);
  const c = found.rows[0] as Record<string, unknown> | undefined;
  if (!c) throw notFound('look');
  // Each piece uses the variant staff chose; if none was chosen (or it was removed), the first one that has a price.
  const items = await deps.db.query(
    `select p.slug, p.name, v.id as variant_id, v.length_inches, v.density_percent, v.colour, pr.amount_minor,
            coalesce(i.on_hand - i.reserved, 0) > 0 as available,
            (select jsonb_build_object('path', m.path, 'alt', m.alt, 'widths', m.widths) from product_media m where m.product_id = p.id and m.kind = 'image' and m.status = 'ready' order by m.position, m.id limit 1) as image
     from collection_products cp
     join products p on p.id = cp.product_id and ${VISIBLE_SQL('p', '$3')}
     join lateral (
       select v.* from variants v join prices pr0 on pr0.variant_id = v.id and pr0.currency = $2
       where v.product_id = p.id and v.is_active order by (v.id = cp.variant_id) desc, v.position, v.id limit 1
     ) v on true
     join prices pr on pr.variant_id = v.id and pr.currency = $2
     left join inventory i on i.variant_id = v.id
     where cp.collection_id = $1 order by cp.position, p.id`,
    [c.id, currency, deps.now()],
  );
  const list = items.rows.map((r) => ({
    product: { slug: String(r.slug), name: String(r.name), image: (r.image as Picture | null) ?? null },
    variantId: Number(r.variant_id),
    description: [r.length_inches ? `${Number(r.length_inches)}"` : null, r.density_percent ? `${Number(r.density_percent)}%` : null, r.colour as string | null].filter(Boolean).join(' · '),
    priceMinor: Number(r.amount_minor),
    available: r.available === true,
  }));
  return {
    slug: String(c.slug),
    name: String(c.name),
    description: String(c.description),
    bannerPath: (c.banner_path as string | null) ?? null,
    isLook: true,
    currency,
    items: list,
    totalMinor: list.reduce((sum, item) => sum + item.priceMinor, 0),
    allAvailable: list.length > 0 && list.every((item) => item.available),
  };
}

/** The homepage sections staff chose in the admin (Homepage), shown ones only, in order. Used by the app. */
export async function homeLayout(db: Db): Promise<{ sections: Array<{ kind: string; settings: Record<string, unknown> }> }> {
  const rows = await db.query('select kind, settings from homepage_sections where is_shown order by position, id');
  if (rows.rows.length === 0 && Number((await db.query('select count(*)::int as n from homepage_sections')).rows[0]?.n ?? 0) === 0) {
    // Nothing set up yet: the same order the website uses.
    return { sections: ['hero', 'collections', 'best_sellers', 'new_arrivals', 'shop_the_look'].map((kind) => ({ kind, settings: {} })) };
  }
  return { sections: rows.rows.map((r) => ({ kind: String(r.kind), settings: (r.settings ?? {}) as Record<string, unknown> })) };
}

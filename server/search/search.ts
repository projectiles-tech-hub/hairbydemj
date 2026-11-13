// Product search with PostgreSQL only: full-text matching on names,
// descriptions, hair details, categories, tags and colours; typing mistakes
// corrected against the words the shop knows (trigram similarity); the last
// word finished as it is typed; and lengths like "22 inch" understood.

import type { Db, DbClient } from '../db/pool.js';

type Q = { query: DbClient['query'] } | Db;

export const SEARCH = {
  maxLength: 100,
  /** How alike a typed word and a known word must be to correct one to the other (0 to 1). */
  similarity: 0.3,
  /** Search records are kept this long for the admin's report. */
  keepDays: 180,
};

export interface ParsedSearch {
  /** What was typed, tidied: lower case, single spaces. */
  normalised: string;
  /** The words searched for, after corrections; the last may be a beginning ("bon" for "bone"). */
  words: string[];
  /** The query with corrections, when a word was corrected; null when nothing changed. */
  corrected: string | null;
  /** A to_tsquery expression built only from letters and digits; null when nothing is left to search. */
  tsquery: string | null;
  /** The same words joined with "or", for a wider second try when "and" finds nothing. */
  tsqueryAny: string | null;
  /** Lengths in inches asked for ("22 inch", "22in", 22"). */
  lengths: number[];
}

/** Turn what a customer typed into what the database searches for. */
export async function parseSearch(db: Q, raw: string): Promise<ParsedSearch> {
  const normalised = raw.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, SEARCH.maxLength);
  const lengths: number[] = [];
  // 22 inch, 22 inches, 22in, 22", 22''
  const withoutLengths = normalised.replace(/\b(\d{1,2})\s*(?:inches|inch|in\b|"|'')/g, (_m, n: string) => {
    const value = Number(n);
    if (value >= 6 && value <= 40) lengths.push(value);
    return ' ';
  });
  const typed = withoutLengths.split(/[^a-z0-9]+/).filter((w) => w.length > 0).slice(0, 8);
  const words: string[] = [];
  let changed = false;
  for (const [k, word] of typed.entries()) {
    const last = k === typed.length - 1;
    // A number on its own, in the range of hair lengths, is taken as a length ("bob 12").
    if (/^\d+$/.test(word)) {
      const value = Number(word);
      if (value >= 6 && value <= 40 && typed.length > 1) lengths.push(value);
      else words.push(word);
      continue;
    }
    if (word.length < 3) {
      words.push(word);
      continue;
    }
    // Small everyday words ("for", "with") are never "corrected" into product words.
    const stop = await db.query("select to_tsvector('english', $1) = ''::tsvector as stop", [word]);
    if (stop.rows[0]?.stop === true) continue;
    const known = await db.query('select 1 from search_words where word = $1', [word]);
    if (known.rowCount) {
      words.push(word);
      continue;
    }
    // The last word may still be being typed: if a known word starts with it, leave it as a beginning.
    if (last) {
      const begins = await db.query("select 1 from search_words where word like $1 || '%' limit 1", [word]);
      if (begins.rowCount) {
        words.push(word);
        continue;
      }
    }
    const close = await db.query('select word, similarity(word, $1) as s from search_words where similarity(word, $1) >= $2 order by s desc, length(word), word limit 1', [word, SEARCH.similarity]);
    const best = close.rows[0]?.word as string | undefined;
    if (best && best !== word) {
      words.push(best);
      changed = true;
    } else words.push(word);
  }
  const terms = words.map((w, k) => (k === words.length - 1 && !/^\d+$/.test(w) ? `${w}:*` : w));
  return {
    normalised,
    words,
    corrected: changed ? [...words, ...lengths.map((n) => `${n} inch`)].join(' ') : null,
    tsquery: terms.length ? terms.join(' & ') : null,
    tsqueryAny: terms.length > 1 ? terms.join(' | ') : null,
    lengths,
  };
}

/**
 * Everything a product can be found by, as one search document: the stored
 * one (name, hair details, description) plus its category, tags and the
 * colours and lace types of its variants.
 */
export const DOCUMENT_SQL = (alias: string): string => `(${alias}.search || setweight(to_tsvector('english',
  coalesce((select name from categories where id = ${alias}.category_id), '') || ' ' || array_to_string(${alias}.tags, ' ') || ' ' ||
  coalesce((select string_agg(distinct coalesce(colour, '') || ' ' || coalesce(lace_type, ''), ' ') from variants where product_id = ${alias}.id and is_active), '')), 'B'))`;

/**
 * How well a product fits: full-text rank, plus how alike its name is to
 * what was typed, plus a lift for an exact name or SKU.
 */
export const RANK_SQL = (alias: string, tsqueryParam: string, typedParam: string): string =>
  `(ts_rank_cd(${DOCUMENT_SQL(alias)}, to_tsquery('english', ${tsqueryParam}), 32) * 4
    + similarity(lower(${alias}.name), ${typedParam})
    + case when lower(${alias}.name) = ${typedParam} then 2 else 0 end
    + case when exists (select 1 from variants sv where sv.product_id = ${alias}.id and lower(sv.sku) = ${typedParam}) then 3 else 0 end)`;

/** The condition a product must meet to be a result. */
export const MATCH_SQL = (alias: string, tsqueryParam: string, typedParam: string): string =>
  `(${DOCUMENT_SQL(alias)} @@ to_tsquery('english', ${tsqueryParam})
    or word_similarity(${typedParam}, lower(${alias}.name)) >= 0.6
    or exists (select 1 from variants sv where sv.product_id = ${alias}.id and lower(sv.sku) = ${typedParam}))`;

/** Note a search for the admin's report. Nothing about who searched is kept. */
export async function recordSearch(db: Q, parsed: ParsedSearch, results: number, now: Date): Promise<void> {
  if (!parsed.normalised) return;
  await db.query('insert into search_queries (query, results, corrected, created_at) values ($1, $2, $3, $4)', [parsed.normalised, results, parsed.corrected, now]);
}

export interface Suggestions {
  query: string;
  /** Known words that start with the last word typed, to finish it. */
  terms: string[];
  categories: Array<{ slug: string; name: string }>;
  products: Array<{ slug: string; name: string; image: { path: string; alt: string; widths: number[] } | null; priceFromMinor: number | null; currency: string }>;
}

/** As-you-type suggestions: words, categories and up to five products. */
export async function suggest(db: Q, raw: string, currency: string, now: Date): Promise<Suggestions> {
  const parsed = await parseSearch(db, raw);
  const last = parsed.words[parsed.words.length - 1] ?? '';
  if (!parsed.tsquery || last.length < 2) return { query: parsed.normalised, terms: [], categories: [], products: [] };
  const terms = await db.query("select word from search_words where word like $1 || '%' and word <> $1 order by length(word), word limit 5", [last]);
  const categories = await db.query(
    "select slug, name from categories where to_tsvector('english', name) @@ to_tsquery('english', $1) or similarity(lower(name), $2) >= 0.4 order by similarity(lower(name), $2) desc, position limit 3",
    [parsed.tsquery, parsed.normalised],
  );
  const products = await db.query(
    `select p.slug, p.name,
            (select min(pr.amount_minor) from variants v join prices pr on pr.variant_id = v.id and pr.currency = $4 where v.product_id = p.id and v.is_active) as price_from,
            (select jsonb_build_object('path', m.path, 'alt', m.alt, 'widths', m.widths) from product_media m where m.product_id = p.id and m.kind = 'image' and m.status = 'ready' order by m.position, m.id limit 1) as image
     from products p
     where (p.status = 'published' or (p.status = 'scheduled' and p.publish_at <= $3)) and ${MATCH_SQL('p', '$1', '$2')}
     order by ${RANK_SQL('p', '$1', '$2')} desc, p.id limit 5`,
    [parsed.tsquery, parsed.normalised, now, currency],
  );
  return {
    query: parsed.normalised,
    terms: terms.rows.map((r) => String(r.word)),
    categories: categories.rows.map((r) => ({ slug: String(r.slug), name: String(r.name) })),
    products: products.rows.map((r) => ({ slug: String(r.slug), name: String(r.name), image: (r.image as Suggestions['products'][number]['image']) ?? null, priceFromMinor: r.price_from === null ? null : Number(r.price_from), currency })),
  };
}

/** For staff: what people search for most, and what finds nothing, over the last `days` days. */
export async function searchReport(db: Q, now: Date, days: number): Promise<{ top: Array<{ query: string; count: number; results: number }>; noResults: Array<{ query: string; count: number }>; total: number }> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const top = await db.query('select query, count(*)::int as n, max(results)::int as results from search_queries where created_at >= $1 group by query order by n desc, query limit 30', [since]);
  const none = await db.query('select query, count(*)::int as n from search_queries where created_at >= $1 and results = 0 group by query order by n desc, query limit 30', [since]);
  const total = await db.query('select count(*)::int as n from search_queries where created_at >= $1', [since]);
  return {
    top: top.rows.map((r) => ({ query: String(r.query), count: Number(r.n), results: Number(r.results) })),
    noResults: none.rows.map((r) => ({ query: String(r.query), count: Number(r.n) })),
    total: Number(total.rows[0]?.n ?? 0),
  };
}

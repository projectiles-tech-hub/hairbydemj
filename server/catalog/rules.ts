// Rule-based collections. Staff describe a collection with rules such as
// "added in the last 30 days" or "top 20 by sales"; this file checks the
// rules and turns them into SQL conditions. Values always travel as query
// parameters, never as text inside the SQL.

import { ApiError } from '../http.js';

export type Rule =
  | { field: 'date_added'; condition: 'in_the_last_days'; value: number }
  | { field: 'sales'; condition: 'top'; value: number }
  | { field: 'category'; condition: 'is'; value: string }
  | { field: 'tag'; condition: 'is'; value: string }
  | { field: 'texture'; condition: 'is'; value: string }
  | { field: 'origin'; condition: 'is'; value: string };

const invalid = (message: string): ApiError => new ApiError(422, 'invalid', 'Check the rules and try again.', { rules: message });

/** Check rules sent by staff and return them in a tidy form. */
export function parseRules(value: unknown): Rule[] {
  if (!Array.isArray(value)) throw invalid('Rules must be a list.');
  if (value.length > 10) throw invalid('Use at most 10 rules.');
  return value.map((raw, index): Rule => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const n = index + 1;
    const whole = (max: number): number => {
      const v = Number(r.value);
      if (!Number.isInteger(v) || v < 1 || v > max) throw invalid(`Rule ${n}: enter a whole number from 1 to ${max}.`);
      return v;
    };
    const word = (): string => {
      const v = typeof r.value === 'string' ? r.value.trim() : '';
      if (v === '' || v.length > 80) throw invalid(`Rule ${n}: enter a value.`);
      return v;
    };
    if (r.field === 'date_added' && r.condition === 'in_the_last_days') return { field: 'date_added', condition: 'in_the_last_days', value: whole(3650) };
    if (r.field === 'sales' && r.condition === 'top') return { field: 'sales', condition: 'top', value: whole(500) };
    if ((r.field === 'category' || r.field === 'tag' || r.field === 'texture' || r.field === 'origin') && r.condition === 'is') return { field: r.field, condition: 'is', value: word() };
    throw invalid(`Rule ${n} is not one we know.`);
  });
}

/** Rules as stored in the database; anything unreadable counts as "no products". */
export function storedRules(value: unknown): Rule[] | null {
  try {
    return parseRules(value);
  } catch {
    return null;
  }
}

/** A plain sentence for each rule, for the admin's collection list. */
export function describeRules(rules: Rule[]): string {
  if (rules.length === 0) return 'Rules: none yet';
  return (
    'Rules: ' +
    rules
      .map((r) => {
        if (r.field === 'date_added') return `added in last ${r.value} days`;
        if (r.field === 'sales') return `top ${r.value} by sales`;
        return `${r.field} is ${r.value}`;
      })
      .join(', ')
  );
}

/** Expression for how many of a product have been sold in paid orders. */
export const SOLD_SQL = (alias: string): string =>
  `(select coalesce(sum(oi.quantity), 0) from order_items oi join orders o on o.id = oi.order_id where oi.product_id = ${alias}.id and o.payment_status in ('paid', 'partly_refunded'))`;

/** Condition for "a product customers can see now". */
export const VISIBLE_SQL = (alias: string, nowParam: string): string => `(${alias}.status = 'published' or (${alias}.status = 'scheduled' and ${alias}.publish_at <= ${nowParam}))`;

/**
 * SQL conditions on the products table (alias "p") for a set of rules.
 * `param` registers a value and returns its placeholder ($1, $2, ...).
 */
export function rulesToSql(rules: Rule[], param: (value: unknown) => string, nowParam: string): string[] {
  return rules.map((r) => {
    switch (r.field) {
      case 'date_added':
        return `p.created_at > ${nowParam}::timestamptz - make_interval(days => ${param(r.value)})`;
      case 'sales':
        return `p.id in (select p2.id from products p2 where ${VISIBLE_SQL('p2', nowParam)} order by ${SOLD_SQL('p2')} desc, p2.id limit ${param(r.value)})`;
      case 'category':
        return `p.category_id in (with recursive tree as (select id from categories where slug = ${param(r.value)} union all select c.id from categories c join tree t on c.parent_id = t.id) select id from tree)`;
      case 'tag':
        return `${param(r.value)} = any (p.tags)`;
      case 'texture':
        return `lower(p.texture) = lower(${param(r.value)})`;
      case 'origin':
        return `lower(p.hair_origin) = lower(${param(r.value)})`;
    }
  });
}

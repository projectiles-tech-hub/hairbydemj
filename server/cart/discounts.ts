// Discounts: codes customers type, and automatic deals. Working out which
// apply to a cart, and the best combination for the customer, is done here;
// so is the staff side (the Discounts page).

import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import { rulesToSql, storedRules } from '../catalog/rules.js';

type Q = { query: DbClient['query'] } | Db;

export type DiscountKind = 'percentage' | 'fixed' | 'free_shipping' | 'buy_x_get_y';

export interface Discount {
  id: number;
  name: string;
  code: string | null;
  kind: DiscountKind;
  percentBps: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  appliesTo: 'all' | 'categories' | 'collections' | 'products';
  targetIds: number[];
  customerGroup: 'everyone' | 'new_customers' | 'gold_and_platinum';
  totalUsesLimit: number | null;
  perCustomerLimit: number | null;
  timesUsed: number;
  combinable: boolean;
  startsAt: Date;
  endsAt: Date | null;
  status: 'draft' | 'active' | 'disabled';
  /** Per currency: the amount off (fixed discounts) and the minimum order. */
  amounts: Record<string, { amountMinor: number | null; minOrderMinor: number | null }>;
}

/** One cart line as discounts see it. */
export interface DiscountLine {
  lineId: number;
  productId: number;
  unitMinor: number;
  quantity: number;
}

export interface AppliedDiscount {
  id: number;
  name: string;
  code: string | null;
  amountMinor: number;
  freeShipping: boolean;
}

function fromRow(r: Record<string, unknown>, amounts: Discount['amounts']): Discount {
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(r.id),
    name: String(r.name),
    code: (r.code as string | null) ?? null,
    kind: r.kind as DiscountKind,
    percentBps: n(r.percent_bps),
    buyQuantity: n(r.buy_quantity),
    getQuantity: n(r.get_quantity),
    appliesTo: r.applies_to as Discount['appliesTo'],
    targetIds: ((r.target_ids as unknown[] | null) ?? []).map(Number),
    customerGroup: r.customer_group as Discount['customerGroup'],
    totalUsesLimit: n(r.total_uses_limit),
    perCustomerLimit: n(r.per_customer_limit),
    timesUsed: Number(r.times_used),
    combinable: r.combinable === true,
    startsAt: r.starts_at as Date,
    endsAt: (r.ends_at as Date | null) ?? null,
    status: r.status as Discount['status'],
    amounts,
  };
}

async function loadAmounts(db: Q, ids: number[]): Promise<Map<number, Discount['amounts']>> {
  const out = new Map<number, Discount['amounts']>();
  if (!ids.length) return out;
  const result = await db.query('select discount_id, currency, amount_minor, min_order_minor from discount_amounts where discount_id = any($1)', [ids]);
  for (const r of result.rows) {
    const map = out.get(Number(r.discount_id)) ?? {};
    map[String(r.currency)] = { amountMinor: r.amount_minor === null ? null : Number(r.amount_minor), minOrderMinor: r.min_order_minor === null ? null : Number(r.min_order_minor) };
    out.set(Number(r.discount_id), map);
  }
  return out;
}

async function loadMany(db: Q, where: string, values: unknown[]): Promise<Discount[]> {
  const result = await db.query(`select * from discounts where ${where} order by id`, values);
  const amounts = await loadAmounts(db, result.rows.map((r) => Number(r.id)));
  return result.rows.map((r) => fromRow(r as Record<string, unknown>, amounts.get(Number(r.id)) ?? {}));
}

/** Who is buying, for the discounts that depend on it. */
export interface Buyer {
  customerId: number | null;
  /** Known at checkout; used for "once per customer" when not signed in. */
  email: string | null;
}

export interface CodeStatus {
  code: string;
  applied: boolean;
  message: string;
}

/**
 * Which products in the cart a discount covers. Categories include their
 * sub-categories; collections cover hand-picked members and rule-based ones.
 */
async function coveredProducts(db: Q, discount: Discount, productIds: number[], now: Date): Promise<Set<number>> {
  if (discount.appliesTo === 'all') return new Set(productIds);
  if (discount.appliesTo === 'products') return new Set(productIds.filter((id) => discount.targetIds.includes(id)));
  if (discount.appliesTo === 'categories') {
    const result = await db.query(
      `with recursive tree as (select id from categories where id = any($1) union all select c.id from categories c join tree t on c.parent_id = t.id)
       select id from products where id = any($2) and category_id in (select id from tree)`,
      [discount.targetIds, productIds],
    );
    return new Set(result.rows.map((r) => Number(r.id)));
  }
  const covered = new Set<number>();
  const collections = await db.query('select id, kind, rules from collections where id = any($1)', [discount.targetIds]);
  for (const c of collections.rows) {
    if (c.kind === 'manual') {
      const members = await db.query('select product_id from collection_products where collection_id = $1 and product_id = any($2)', [c.id, productIds]);
      for (const m of members.rows) covered.add(Number(m.product_id));
    } else {
      const rules = storedRules(c.rules);
      if (!rules?.length) continue;
      const values: unknown[] = [now, productIds];
      const conditions = rulesToSql(rules, (v) => `$${values.push(v)}`, '$1');
      const members = await db.query(`select p.id from products p where p.id = any($2) and ${conditions.join(' and ')}`, values);
      for (const m of members.rows) covered.add(Number(m.id));
    }
  }
  return covered;
}

/** How much a discount takes off these lines, before any other discount. Amounts are rounded down, never up. */
export function amountOff(discount: Discount, lines: DiscountLine[], currency: string): number {
  const subtotal = lines.reduce((sum, l) => sum + l.unitMinor * l.quantity, 0);
  if (subtotal === 0) return 0;
  switch (discount.kind) {
    case 'percentage':
      return Math.floor((subtotal * (discount.percentBps ?? 0)) / 10_000);
    case 'fixed':
      return Math.min(subtotal, discount.amounts[currency]?.amountMinor ?? 0);
    case 'free_shipping':
      return 0;
    case 'buy_x_get_y': {
      // Every group of (x + y) items: the y cheapest of the group are free.
      // Items are taken from the dearest down, so the customer always pays for the dearer ones.
      const buy = discount.buyQuantity ?? 0;
      const get = discount.getQuantity ?? 0;
      if (buy < 1 || get < 1) return 0;
      const units = lines.flatMap((l) => Array<number>(l.quantity).fill(l.unitMinor)).sort((a, b) => b - a);
      let off = 0;
      for (let start = 0; start + buy + get <= units.length; start += buy + get) {
        for (let i = start + buy; i < start + buy + get; i++) off += units[i] ?? 0;
      }
      return off;
    }
  }
}

interface Candidate {
  discount: Discount;
  lines: DiscountLine[];
}

/** The amounts for a set of discounts applied together. Together they never take off more than the subtotal. */
function applySet(set: Candidate[], currency: string, subtotal: number): AppliedDiscount[] {
  let left = subtotal;
  return set.map(({ discount, lines }) => {
    const amount = Math.min(left, amountOff(discount, lines, currency));
    left -= amount;
    return { id: discount.id, name: discount.name, code: discount.code, amountMinor: amount, freeShipping: discount.kind === 'free_shipping' };
  });
}

function value(applied: AppliedDiscount[]): [number, number] {
  return [applied.reduce((s, a) => s + a.amountMinor, 0), applied.some((a) => a.freeShipping) ? 1 : 0];
}

/**
 * The discounts a cart gets. Automatic deals apply by themselves; a code
 * applies when typed. Discounts marked "combinable" can be used together; one
 * that is not is used alone. The combination that saves the customer most is
 * chosen (free delivery counts as a tie-breaker).
 */
export async function chooseDiscounts(
  db: Q,
  input: { lines: DiscountLine[]; currency: string; code: string | null; buyer: Buyer; tier: string | null; now: Date },
): Promise<{ applied: AppliedDiscount[]; code: CodeStatus | null }> {
  const { lines, currency, now } = input;
  const subtotal = lines.reduce((sum, l) => sum + l.unitMinor * l.quantity, 0);
  const code = input.code?.trim() || null;
  const live = await loadMany(db, "status = 'active' and starts_at <= $1 and (ends_at is null or ends_at > $1) and (code is null or lower(code) = lower($2))", [now, code ?? '']);
  let codeStatus: CodeStatus | null = code ? { code, applied: false, message: 'This code does not exist or has ended.' } : null;

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const candidates: Candidate[] = [];
  for (const discount of live) {
    const isCode = discount.code !== null;
    const refuse = (message: string): void => {
      if (isCode && codeStatus) codeStatus = { code, applied: false, message } as CodeStatus;
    };
    if (isCode && codeStatus) codeStatus.code = discount.code ?? code ?? '';
    if (discount.totalUsesLimit !== null && discount.timesUsed >= discount.totalUsesLimit) {
      refuse('This code has been used up.');
      continue;
    }
    if (discount.kind === 'fixed' && !discount.amounts[currency]?.amountMinor) {
      refuse(`This code cannot be used when paying in ${currency}.`);
      continue;
    }
    const minimum = discount.amounts[currency]?.minOrderMinor ?? null;
    if (minimum !== null && subtotal < minimum) {
      refuse('Your order is below the minimum for this code.');
      continue;
    }
    if (discount.customerGroup === 'gold_and_platinum' && input.tier !== 'gold' && input.tier !== 'platinum') {
      refuse(input.buyer.customerId ? 'This code is for Gold and Platinum members.' : 'Sign in to use this code: it is for Gold and Platinum members.');
      continue;
    }
    if (discount.customerGroup === 'new_customers' || discount.perCustomerLimit !== null) {
      const { customerId, email } = input.buyer;
      if (customerId !== null || email) {
        const used = await db.query(
          `select count(distinct o.id)::int as orders,
                  count(distinct o.id) filter (where od.discount_id = $3)::int as uses
           from orders o left join order_discounts od on od.order_id = o.id
           where o.payment_status in ('paid', 'partly_refunded', 'refunded') and (o.customer_id = $1 or lower(o.email) = lower($2))`,
          [customerId, email ?? '', discount.id],
        );
        const row = used.rows[0] as { orders: number; uses: number };
        if (discount.customerGroup === 'new_customers' && row.orders > 0) {
          refuse('This code is for first orders only.');
          continue;
        }
        if (discount.perCustomerLimit !== null && row.uses >= discount.perCustomerLimit) {
          refuse('You have already used this code.');
          continue;
        }
      }
    }
    const covered = await coveredProducts(db, discount, productIds, now);
    const coveredLines = lines.filter((l) => covered.has(l.productId));
    if (!coveredLines.length) {
      refuse('This code does not apply to anything in your bag.');
      continue;
    }
    if (discount.kind !== 'free_shipping' && amountOff(discount, coveredLines, currency) === 0) {
      refuse(discount.kind === 'buy_x_get_y' ? `Add ${(discount.buyQuantity ?? 0) + (discount.getQuantity ?? 0)} qualifying items to use this code.` : 'This code does not apply to anything in your bag.');
      continue;
    }
    candidates.push({ discount, lines: coveredLines });
  }

  // The possible combinations: each discount that stands alone, and all the
  // combinable ones together. Larger savings first in each combination.
  const combinable = candidates.filter((c) => c.discount.combinable).sort((a, b) => amountOff(b.discount, b.lines, currency) - amountOff(a.discount, a.lines, currency));
  const sets: Candidate[][] = candidates.filter((c) => !c.discount.combinable).map((c) => [c]);
  if (combinable.length) sets.push(combinable);
  let best: AppliedDiscount[] = [];
  for (const set of sets) {
    const applied = applySet(set, currency, subtotal);
    const [a, b] = value(applied);
    const [x, y] = value(best);
    if (a > x || (a === x && b > y) || (a === x && b === y && applied.some((d) => d.code) && !best.some((d) => d.code))) best = applied;
  }
  best = best.filter((d) => d.amountMinor > 0 || d.freeShipping);

  if (code && codeStatus) {
    const usedCode = best.find((d) => d.code !== null);
    const status: CodeStatus = codeStatus;
    if (usedCode) codeStatus = { code: usedCode.code ?? code, applied: true, message: 'Code applied.' };
    else if (candidates.some((c) => c.discount.code !== null)) codeStatus = { code: status.code, applied: false, message: 'A better deal is already applied, and this code cannot be combined with it.' };
  }
  return { applied: best, code: codeStatus };
}

// ----- staff: the Discounts page -----

interface Meta {
  ip: string | null;
}

const fieldError = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });

function whole(value: unknown, field: string, label: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw fieldError(field, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

function optionalWhole(value: unknown, field: string, label: string, min: number, max: number): number | null {
  return value === null || value === undefined || value === '' ? null : whole(value, field, label, min, max);
}

function dateOf(value: unknown, field: string): Date {
  const d = typeof value === 'string' || value instanceof Date ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw fieldError(field, 'Enter a date and time.');
  return d;
}

export async function listDiscounts(db: Db, actor: StaffMember): Promise<Discount[]> {
  requireAccess(actor, 'discounts', 'view');
  return loadMany(db, 'true', []);
}

export async function readDiscount(db: Db, actor: StaffMember, id: number): Promise<Discount> {
  requireAccess(actor, 'discounts', 'view');
  const [found] = await loadMany(db, 'id = $1', [id]);
  if (!found) throw new ApiError(404, 'not_found', 'That discount does not exist.');
  return found;
}

/** Create (id null) or edit a discount. Only the fields sent are changed. */
export async function saveDiscount(db: Db, actor: StaffMember, id: number | null, input: Record<string, unknown>, now: Date, meta: Meta): Promise<Discount> {
  requireAccess(actor, 'discounts', 'change');
  const saved = await withTransaction(db, async (c) => {
    const [existing] = id === null ? [undefined] : await loadMany(c, 'id = $1', [id]);
    if (id !== null && !existing) throw new ApiError(404, 'not_found', 'That discount does not exist.');
    const has = (key: string): boolean => key in input;
    const columns: Record<string, unknown> = {};
    if (id === null || has('name')) {
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
      if (!name) throw fieldError('name', 'Give the discount a name.');
      columns.name = name;
    }
    if (has('code')) {
      const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
      if (code !== '' && !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) throw fieldError('code', 'Use 3 to 32 letters, numbers, dashes or underscores.');
      columns.code = code || null;
    }
    const kind = (has('kind') ? input.kind : existing?.kind) as DiscountKind | undefined;
    if (kind !== 'percentage' && kind !== 'fixed' && kind !== 'free_shipping' && kind !== 'buy_x_get_y') throw fieldError('kind', 'Choose percentage, fixed amount, free shipping or buy X get Y.');
    columns.kind = kind;
    columns.percent_bps = kind === 'percentage' ? whole(has('percentBps') ? input.percentBps : existing?.percentBps, 'percentBps', 'The percentage (in hundredths, 1000 = 10%)', 1, 10_000) : null;
    columns.buy_quantity = kind === 'buy_x_get_y' ? whole(has('buyQuantity') ? input.buyQuantity : existing?.buyQuantity, 'buyQuantity', 'Buy', 1, 100) : null;
    columns.get_quantity = kind === 'buy_x_get_y' ? whole(has('getQuantity') ? input.getQuantity : existing?.getQuantity, 'getQuantity', 'Get', 1, 100) : null;
    if (has('appliesTo') || id === null) {
      const appliesTo = (input.appliesTo ?? 'all') as string;
      if (!['all', 'categories', 'collections', 'products'].includes(appliesTo)) throw fieldError('appliesTo', 'Choose all products, categories, collections or products.');
      const targets = appliesTo === 'all' ? [] : (Array.isArray(input.targetIds) ? input.targetIds : []).map((v, i) => whole(v, 'targetIds', `Choice ${i + 1}`, 1, Number.MAX_SAFE_INTEGER));
      if (appliesTo !== 'all' && !targets.length) throw fieldError('targetIds', 'Choose at least one.');
      const table = { all: '', categories: 'categories', collections: 'collections', products: 'products' }[appliesTo as 'all'];
      if (table) {
        const found = await c.query(`select count(*)::int as n from ${table} where id = any($1)`, [targets]);
        if (Number(found.rows[0]?.n) !== new Set(targets).size) throw fieldError('targetIds', 'One of the choices no longer exists.');
      }
      columns.applies_to = appliesTo;
      columns.target_ids = [...new Set(targets)];
    }
    if (has('customerGroup')) {
      if (!['everyone', 'new_customers', 'gold_and_platinum'].includes(String(input.customerGroup))) throw fieldError('customerGroup', 'Choose everyone, new customers, or Gold and Platinum.');
      columns.customer_group = input.customerGroup;
    }
    if (has('totalUsesLimit')) columns.total_uses_limit = optionalWhole(input.totalUsesLimit, 'totalUsesLimit', 'Total uses', 1, 10_000_000);
    if (has('perCustomerLimit')) columns.per_customer_limit = optionalWhole(input.perCustomerLimit, 'perCustomerLimit', 'Uses per customer', 1, 1000);
    if (has('combinable')) columns.combinable = input.combinable === true;
    const startsAt = has('startsAt') ? dateOf(input.startsAt, 'startsAt') : (existing?.startsAt ?? now);
    columns.starts_at = startsAt;
    if (has('endsAt')) columns.ends_at = input.endsAt === null || input.endsAt === '' ? null : dateOf(input.endsAt, 'endsAt');
    const endsAt = (has('endsAt') ? columns.ends_at : existing?.endsAt) as Date | null | undefined;
    if (endsAt && endsAt <= startsAt) throw fieldError('endsAt', 'The end must be after the start.');
    if (has('status')) {
      if (!['draft', 'active', 'disabled'].includes(String(input.status))) throw fieldError('status', 'Choose draft, active or disabled.');
      columns.status = input.status;
    }
    if (id === null) columns.created_by = actor.id;

    const keys = Object.keys(columns);
    let discountId = id;
    try {
      if (id === null) {
        const made = await c.query(`insert into discounts (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(columns));
        discountId = Number(made.rows[0]?.id);
      } else {
        await c.query(`update discounts set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...Object.values(columns)]);
      }
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw fieldError('code', 'Another discount already uses this code.');
      throw error;
    }

    if (has('amounts')) {
      const given = (input.amounts && typeof input.amounts === 'object' ? input.amounts : {}) as Record<string, { amountMinor?: unknown; minOrderMinor?: unknown }>;
      const currencies = new Set((await c.query('select code from currencies')).rows.map((r) => String(r.code)));
      await c.query('delete from discount_amounts where discount_id = $1', [discountId]);
      for (const [code, value] of Object.entries(given)) {
        if (!currencies.has(code)) throw fieldError('amounts', `${code} is not a currency we sell in.`);
        const amount = optionalWhole(value?.amountMinor, 'amounts', `The ${code} amount`, 1, 9_000_000_000_000);
        const minimum = optionalWhole(value?.minOrderMinor, 'amounts', `The ${code} minimum order`, 0, 9_000_000_000_000);
        if (amount !== null || minimum !== null) await c.query('insert into discount_amounts (discount_id, currency, amount_minor, min_order_minor) values ($1, $2, $3, $4)', [discountId, code, amount, minimum]);
      }
    }
    const [after] = await loadMany(c, 'id = $1', [discountId]);
    if (!after) throw new Error('Discount vanished while saving');
    if (after.kind === 'fixed' && !Object.values(after.amounts).some((a) => a.amountMinor)) throw fieldError('amounts', 'Enter the amount off for at least one currency.');
    await logActivity(c, actor, 'Discounts', `${id === null ? 'Created' : 'Edited'} the discount ${after.code ?? after.name}`, { type: 'discount', id: after.id }, meta.ip);
    return after;
  });
  return saved;
}

/** A discount that was never used is deleted; one that was is switched off, so past orders still name it. */
export async function deleteDiscount(db: Db, actor: StaffMember, id: number, meta: Meta): Promise<{ deleted: boolean }> {
  requireAccess(actor, 'discounts', 'change');
  return withTransaction(db, async (c) => {
    const found = await c.query('select name, code, (select count(*)::int from order_discounts where discount_id = discounts.id) as uses from discounts where id = $1 for update', [id]);
    const row = found.rows[0] as { name: string; code: string | null; uses: number } | undefined;
    if (!row) throw new ApiError(404, 'not_found', 'That discount does not exist.');
    if (row.uses > 0) {
      await c.query("update discounts set status = 'disabled' where id = $1", [id]);
      await logActivity(c, actor, 'Discounts', `Switched off the discount ${row.code ?? row.name} (it has been used, so it was not deleted)`, { type: 'discount', id }, meta.ip);
      return { deleted: false };
    }
    await c.query('delete from discounts where id = $1', [id]);
    await logActivity(c, actor, 'Discounts', `Deleted the discount ${row.code ?? row.name}`, { type: 'discount', id }, meta.ip);
    return { deleted: true };
  });
}

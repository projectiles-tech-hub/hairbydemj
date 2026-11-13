// Loyalty points, tiers and referrals (module 17).
//
// Points are earned on delivered orders, published reviews, birthdays and
// referrals, and spent at checkout as money off. Every movement is a row in
// loyalty_transactions; customers.loyalty_points is the running balance.
// The rules are in store_settings 'loyalty' and set by staff in the admin.

import { randomInt } from 'node:crypto';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';

type Q = { query: DbClient['query'] } | Db;

export interface LoyaltySettings {
  /** Points for each ₦1,000 paid for delivered goods (other currencies are converted). */
  pointsPer1000Ngn: number;
  /** What one point is worth at checkout, in naira. */
  nairaPerPoint: number;
  /** The fewest points that can be used at once. */
  minimumToRedeem: number;
  /** Points can pay at most this share of the items, in percent. */
  maxPercentOfOrder: number;
  reviewPoints: number;
  reviewWithPhotosPoints: number;
  birthdayBonus: number;
  referralFriend: number;
  referralReferrer: number;
}

/**
 * Until staff set them, the sample figures from the build plan apply
 * (the owner confirms them; see docs/loyalty.md).
 */
export const LOYALTY_DEFAULTS: LoyaltySettings = {
  pointsPer1000Ngn: 1,
  nairaPerPoint: 10,
  minimumToRedeem: 500,
  maxPercentOfOrder: 50,
  reviewPoints: 50,
  reviewWithPhotosPoints: 100,
  birthdayBonus: 200,
  referralFriend: 500,
  referralReferrer: 500,
};

/** The sample data uses snake_case names; the admin saves these camelCase ones. */
const SNAKE: Record<keyof LoyaltySettings, string> = {
  pointsPer1000Ngn: 'points_per_1000_ngn',
  nairaPerPoint: 'naira_per_point',
  minimumToRedeem: 'minimum_to_redeem',
  maxPercentOfOrder: 'max_percent_of_order',
  reviewPoints: 'review',
  reviewWithPhotosPoints: 'review_with_photos',
  birthdayBonus: 'birthday_bonus',
  referralFriend: 'referral_friend',
  referralReferrer: 'referral_referrer',
};

export async function loyaltySettings(db: Q): Promise<LoyaltySettings> {
  const v = ((await db.query("select value from store_settings where key = 'loyalty'")).rows[0]?.value ?? {}) as Record<string, unknown>;
  const out = { ...LOYALTY_DEFAULTS };
  for (const key of Object.keys(LOYALTY_DEFAULTS) as Array<keyof LoyaltySettings>) {
    const n = Number(v[key] ?? v[SNAKE[key]]);
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });

export async function saveLoyaltySettings(db: Db, staff: StaffMember, input: Record<string, unknown>, ip: string | null): Promise<LoyaltySettings> {
  requireAccess(staff, 'discounts', 'change');
  const current = await loyaltySettings(db);
  const limits: Record<keyof LoyaltySettings, [number, number]> = {
    pointsPer1000Ngn: [0, 1000],
    nairaPerPoint: [0, 100_000],
    minimumToRedeem: [0, 1_000_000],
    maxPercentOfOrder: [0, 100],
    reviewPoints: [0, 100_000],
    reviewWithPhotosPoints: [0, 100_000],
    birthdayBonus: [0, 100_000],
    referralFriend: [0, 100_000],
    referralReferrer: [0, 100_000],
  };
  for (const key of Object.keys(limits) as Array<keyof LoyaltySettings>) {
    if (input[key] === undefined || input[key] === null) continue;
    const n = Number(input[key]);
    const [min, max] = limits[key];
    if (!Number.isFinite(n) || n < min || n > max || (key !== 'pointsPer1000Ngn' && key !== 'nairaPerPoint' && !Number.isInteger(n))) throw invalid(key, `Give a number from ${min} to ${max}.`);
    current[key] = n;
  }
  await db.query("insert into store_settings (key, value, updated_by) values ('loyalty', $1, $2) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by", [JSON.stringify(current), staff.id]);
  await logActivity(db, staff, 'discounts', 'Changed the loyalty rules', undefined, ip);
  return current;
}

// ----- balance, history and tiers -----

export interface Tier {
  code: string;
  name: string;
  minPoints: number;
  benefit: string;
}

export async function listTiers(db: Q): Promise<Tier[]> {
  const found = await db.query('select code, name, min_points, benefit from loyalty_tiers order by min_points');
  return found.rows.map((r) => ({ code: String(r.code), name: String(r.name), minPoints: Number(r.min_points), benefit: String(r.benefit) }));
}

const EARNING_KINDS = "('order', 'review', 'birthday', 'referral')";

/** Points earned in the last 12 months decide the tier. */
async function recomputeTier(c: Q, customerId: number, now: Date): Promise<void> {
  await c.query(
    `update customers set loyalty_tier = coalesce((
       select t.code from loyalty_tiers t
        where t.min_points <= (select coalesce(sum(points), 0) from loyalty_transactions where customer_id = $1 and points > 0 and kind in ${EARNING_KINDS} and created_at > $2::timestamptz - interval '365 days')
        order by t.min_points desc limit 1), loyalty_tier)
     where id = $1`,
    [customerId, now],
  );
}

/**
 * Move a customer's points. A negative change never takes the balance below
 * zero (it takes what is there). Returns the points actually moved.
 */
export async function movePoints(c: Q, customerId: number, points: number, kind: string, now: Date, extra: { orderId?: number | null; reviewId?: number | null; staffId?: number | null; note?: string | null } = {}): Promise<number> {
  if (points === 0) return 0;
  const row = (await c.query("select loyalty_points from customers where id = $1 and status <> 'deleted' for update", [customerId])).rows[0];
  if (!row) return 0;
  const balance = Number(row.loyalty_points);
  const change = points < 0 ? -Math.min(balance, -points) : points;
  if (change === 0) return 0;
  await c.query('update customers set loyalty_points = loyalty_points + $2 where id = $1', [customerId, change]);
  await c.query(
    'insert into loyalty_transactions (customer_id, points, balance_after, kind, order_id, review_id, staff_id, note, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [customerId, change, balance + change, kind, extra.orderId ?? null, extra.reviewId ?? null, extra.staffId ?? null, extra.note ?? null, now],
  );
  if (change > 0) await recomputeTier(c, customerId, now);
  return change;
}

export interface LoyaltyView {
  points: number;
  /** What the points are worth now, in naira (kobo). */
  worthMinor: number;
  tier: Tier;
  nextTier: (Tier & { pointsToGo: number }) | null;
  referralCode: string;
  referrals: { invited: number; rewarded: number };
  history: Array<{ points: number; kind: string; note: string | null; orderNumber: string | null; at: string }>;
  rules: LoyaltySettings;
}

const ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ2345679';

/** A customer's referral code, made the first time it is asked for. */
export async function referralCode(db: Q, customerId: number): Promise<string> {
  const existing = (await db.query('select referral_code from customers where id = $1', [customerId])).rows[0]?.referral_code as string | null | undefined;
  if (existing) return existing;
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = 'DEMJ';
    for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    const set = await db.query('update customers set referral_code = $2 where id = $1 and referral_code is null and not exists (select 1 from customers where referral_code = $2) returning referral_code', [customerId, code]);
    if (set.rowCount) return code;
    const now = (await db.query('select referral_code from customers where id = $1', [customerId])).rows[0]?.referral_code as string | null;
    if (now) return now;
  }
  throw new Error('Could not make a referral code');
}

export async function loyaltyView(db: Db, customerId: number, now: Date): Promise<LoyaltyView> {
  const rules = await loyaltySettings(db);
  const c = (await db.query('select loyalty_points, loyalty_tier from customers where id = $1', [customerId])).rows[0];
  if (!c) throw new ApiError(404, 'not_found', 'Account not found.');
  const tiers = await listTiers(db);
  const tier = tiers.find((t) => t.code === c.loyalty_tier) ?? tiers[0] ?? { code: 'bronze', name: 'Bronze', minPoints: 0, benefit: '' };
  const earned = Number((await db.query(`select coalesce(sum(points), 0) as n from loyalty_transactions where customer_id = $1 and points > 0 and kind in ${EARNING_KINDS} and created_at > $2::timestamptz - interval '365 days'`, [customerId, now])).rows[0]?.n ?? 0);
  const next = tiers.find((t) => t.minPoints > tier.minPoints) ?? null;
  const history = await db.query(
    'select t.points, t.kind, t.note, t.created_at, o.number from loyalty_transactions t left join orders o on o.id = t.order_id where t.customer_id = $1 order by t.created_at desc, t.id desc limit 50',
    [customerId],
  );
  const refs = (await db.query("select count(*)::int as invited, count(*) filter (where status = 'rewarded')::int as rewarded from referrals where referrer_id = $1", [customerId])).rows[0];
  const points = Number(c.loyalty_points);
  return {
    points,
    worthMinor: Math.round(points * rules.nairaPerPoint * 100),
    tier,
    nextTier: next ? { ...next, pointsToGo: Math.max(0, next.minPoints - earned) } : null,
    referralCode: await referralCode(db, customerId),
    referrals: { invited: Number(refs?.invited ?? 0), rewarded: Number(refs?.rewarded ?? 0) },
    history: history.rows.map((r) => ({ points: Number(r.points), kind: String(r.kind), note: (r.note as string | null) ?? null, orderNumber: (r.number as string | null) ?? null, at: (r.created_at as Date).toISOString() })),
    rules,
  };
}

// ----- spending points at checkout -----

/** How many minor units of a currency one naira is (from today's rates). */
async function nairaRate(c: Q, currency: string): Promise<{ rate: number; minorUnits: number }> {
  const r = (await c.query('select is_base, rate_from_base, minor_units from currencies where code = $1', [currency])).rows[0];
  if (!r) throw invalid('currency', 'That currency is not sold in.');
  const rate = r.is_base ? 1 : Number(r.rate_from_base);
  if (!Number.isFinite(rate) || rate <= 0) throw new ApiError(409, 'no_rate', 'Points cannot be used in this currency just now.');
  return { rate, minorUnits: Number(r.minor_units ?? 2) };
}

/**
 * Check and price points the customer wants to use on an order. Points pay
 * for items only (not delivery), up to the store's share.
 */
export async function pricePoints(c: Q, customerId: number, wanted: number, currency: string, itemsAfterDiscountMinor: number): Promise<{ points: number; minor: number }> {
  if (!Number.isInteger(wanted) || wanted <= 0) return { points: 0, minor: 0 };
  const rules = await loyaltySettings(c);
  const balance = Number((await c.query('select loyalty_points from customers where id = $1', [customerId])).rows[0]?.loyalty_points ?? 0);
  if (wanted > balance) throw invalid('usePoints', `You have ${balance} points.`);
  if (wanted < rules.minimumToRedeem) throw invalid('usePoints', `Use at least ${rules.minimumToRedeem} points at a time.`);
  if (rules.nairaPerPoint <= 0) throw invalid('usePoints', 'Points cannot be used just now.');
  const { rate, minorUnits } = await nairaRate(c, currency);
  const perPoint = rules.nairaPerPoint * rate * 10 ** minorUnits;
  const cap = Math.floor((itemsAfterDiscountMinor * rules.maxPercentOfOrder) / 100);
  // Never more points than the cap is worth.
  const points = Math.min(wanted, Math.floor(cap / perPoint));
  if (points < rules.minimumToRedeem) throw invalid('usePoints', `Points can pay up to ${rules.maxPercentOfOrder}% of the items; this order is too small to use ${rules.minimumToRedeem} points.`);
  return { points, minor: Math.floor(points * perPoint) };
}

// ----- earning, run by the worker -----

/**
 * Points for delivered orders, kept right as orders are refunded: each
 * order's points are worked out again from what was paid for its goods, and
 * the difference is added or taken back.
 */
export async function settleOrderPoints(db: Db, now: Date, limit = 200): Promise<number> {
  const rules = await loyaltySettings(db);
  const orders = await db.query(
    `select o.id, o.customer_id, o.currency, o.subtotal_minor - o.discount_minor - o.points_minor as goods,
            coalesce((select sum(r.amount_minor) from refunds r where r.order_id = o.id and r.status = 'succeeded'), 0) as refunded,
            coalesce((select sum(t.points) from loyalty_transactions t where t.order_id = o.id and (t.kind = 'order' or (t.kind = 'refund' and t.note = 'refunded goods'))), 0) as awarded
       from orders o
      where o.customer_id is not null and o.status in ('delivered', 'returned')
        and (o.points_settled_at is null
             or exists (select 1 from refunds r where r.order_id = o.id and r.status = 'succeeded' and r.completed_at > o.points_settled_at))
      order by o.id limit $1`,
    [limit],
  );
  for (const o of orders.rows) {
    const { rate, minorUnits } = await nairaRate(db, String(o.currency)).catch(() => ({ rate: 0, minorUnits: 2 }));
    await withTransaction(db, async (c) => {
      if (rate > 0) {
        const goods = Math.max(0, Number(o.goods) - Number(o.refunded));
        const target = Math.floor(goods / 10 ** minorUnits / rate / 1000) * rules.pointsPer1000Ngn;
        const diff = Math.floor(target) - Number(o.awarded);
        if (diff > 0) await movePoints(c, Number(o.customer_id), diff, 'order', now, { orderId: Number(o.id) });
        if (diff < 0) await movePoints(c, Number(o.customer_id), diff, 'refund', now, { orderId: Number(o.id), note: 'refunded goods' });
      }
      await c.query('update orders set points_settled_at = $2 where id = $1', [o.id, now]);
    });
  }
  return orders.rows.length;
}

/** Referral rewards: once the invited friend has a delivered order, both get points. */
export async function settleReferrals(db: Db, now: Date): Promise<number> {
  const rules = await loyaltySettings(db);
  const due = await db.query(
    `select r.id, r.referrer_id, r.referred_customer_id,
            (select o.id from orders o where o.customer_id = r.referred_customer_id and o.status = 'delivered' order by o.placed_at limit 1) as first_order
       from referrals r where r.status = 'pending'`,
  );
  let rewarded = 0;
  for (const r of due.rows) {
    if (!r.first_order) continue;
    await withTransaction(db, async (c) => {
      const still = await c.query("update referrals set status = 'rewarded', rewarded_at = $2, first_order_id = $3 where id = $1 and status = 'pending' returning id", [r.id, now, r.first_order]);
      if (!still.rowCount) return;
      await movePoints(c, Number(r.referrer_id), rules.referralReferrer, 'referral', now, { note: 'A friend you invited made their first order' });
      await movePoints(c, Number(r.referred_customer_id), rules.referralFriend, 'referral', now, { note: 'Welcome gift for joining with a friend\'s code' });
      rewarded += 1;
    });
  }
  return rewarded;
}

/** Birthday points, once a year, on the customer's birthday (Lagos time). */
export async function birthdayPoints(db: Db, now: Date): Promise<number> {
  const rules = await loyaltySettings(db);
  if (rules.birthdayBonus <= 0) return 0;
  const today = new Date(now.getTime() + 3600_000);
  const due = await db.query(
    `select id from customers c
      where status = 'active' and birthday is not null
        and extract(month from birthday) = $1 and extract(day from birthday) = $2
        and not exists (select 1 from loyalty_transactions t where t.customer_id = c.id and t.kind = 'birthday' and t.created_at > $3::timestamptz - interval '300 days')`,
    [today.getUTCMonth() + 1, today.getUTCDate(), now],
  );
  for (const r of due.rows) await withTransaction(db, (c) => movePoints(c, Number(r.id), rules.birthdayBonus, 'birthday', now, { note: 'Happy birthday from hairbydemj' }));
  return due.rows.length;
}

/** Staff add or take away points, with a reason. */
export async function adjustPoints(db: Db, staff: StaffMember, customerId: number, input: Record<string, unknown>, ip: string | null, now: Date): Promise<number> {
  requireAccess(staff, 'customers', 'change');
  const points = Number(input.points);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1_000_000) throw invalid('points', 'Give a whole number of points, more or less than 0.');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  if (!note) throw invalid('note', 'Say why, for the record.');
  const moved = await withTransaction(db, (c) => movePoints(c, customerId, points, 'adjust', now, { staffId: staff.id, note }));
  await logActivity(db, staff, 'customers', `${moved >= 0 ? 'Added' : 'Took away'} ${Math.abs(moved)} points: ${note}`, { type: 'customer', id: customerId }, ip);
  return moved;
}

/** Remember who invited a new customer (from the code they typed when signing up). */
export async function recordReferral(c: Q, newCustomerId: number, code: unknown): Promise<void> {
  if (typeof code !== 'string' || !code.trim()) return;
  const referrer = (await c.query("select id from customers where referral_code = $1 and status = 'active'", [code.trim().toUpperCase()])).rows[0];
  if (!referrer || Number(referrer.id) === newCustomerId) return;
  await c.query('insert into referrals (referrer_id, referred_customer_id) values ($1, $2) on conflict (referred_customer_id) do nothing', [referrer.id, newCustomerId]);
}

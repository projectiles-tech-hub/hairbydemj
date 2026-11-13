// Holding stock for orders. Each change is one SQL statement that only
// succeeds when enough stock is free at that instant, so two customers can
// never both get the last one, however close together they check out.

import type { DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';

export interface StockLine {
  variantId: number;
  quantity: number;
}

type Q = { query: DbClient['query'] };

/** Merge lines for the same variant, in a fixed order so two checkouts never lock rows in opposite orders. */
function combine(lines: StockLine[]): StockLine[] {
  const totals = new Map<number, number>();
  for (const l of lines) if (l.quantity > 0) totals.set(l.variantId, (totals.get(l.variantId) ?? 0) + l.quantity);
  return [...totals].sort((a, b) => a[0] - b[0]).map(([variantId, quantity]) => ({ variantId, quantity }));
}

/**
 * Hold stock for every line, all or nothing. Must run inside a transaction:
 * if any line cannot be held, an error names it and the caller's
 * transaction rolls back the lines already held.
 */
export async function holdStock(c: Q, lines: StockLine[]): Promise<void> {
  for (const line of combine(lines)) {
    const held = await c.query('update inventory set reserved = reserved + $2 where variant_id = $1 and on_hand - reserved >= $2 returning variant_id', [line.variantId, line.quantity]);
    if (held.rowCount === 0) {
      const left = await c.query('select greatest(on_hand - reserved, 0)::int as free from inventory where variant_id = $1', [line.variantId]);
      const free = Number(left.rows[0]?.free ?? 0);
      throw new ApiError(409, 'out_of_stock', free === 0 ? 'Sorry, one of your items has just sold out.' : `Sorry, only ${free} of one of your items ${free === 1 ? 'is' : 'are'} left.`, {}, {});
    }
  }
}

/** Let go of stock held for an order that was not paid or was cancelled before shipping. */
export async function releaseStock(c: Q, lines: StockLine[]): Promise<void> {
  for (const line of combine(lines)) {
    await c.query('update inventory set reserved = greatest(reserved - $2, 0) where variant_id = $1', [line.variantId, line.quantity]);
  }
}

/**
 * The held stock has left the building: take it off what is on hand and
 * record the sale. Called when an order is shipped.
 */
export async function shipStock(c: Q, lines: StockLine[], orderId: number): Promise<void> {
  for (const line of combine(lines)) {
    const moved = await c.query(
      'update inventory set on_hand = on_hand - $2, reserved = greatest(reserved - $2, 0) where variant_id = $1 and on_hand >= $2 returning on_hand',
      [line.variantId, line.quantity],
    );
    if (moved.rowCount === 0) throw new ApiError(409, 'stock_mismatch', 'The stock count for an item in this order is lower than the order. Check the inventory.');
    await c.query("insert into stock_movements (variant_id, change, on_hand_after, reason, order_id) values ($1, $2, $3, 'sale', $4)", [line.variantId, -line.quantity, moved.rows[0]?.on_hand, orderId]);
  }
}

/** Items that come back in sellable condition go back on the shelf. */
export async function restock(c: Q, lines: StockLine[], orderId: number, reason: 'return' | 'cancelled_order', staffId: number | null): Promise<void> {
  for (const line of combine(lines)) {
    const moved = await c.query('update inventory set on_hand = on_hand + $2 where variant_id = $1 returning on_hand', [line.variantId, line.quantity]);
    if (moved.rowCount === 0) continue; // the variant was deleted since
    await c.query('insert into stock_movements (variant_id, change, on_hand_after, reason, order_id, staff_id) values ($1, $2, $3, $4, $5, $6)', [line.variantId, line.quantity, moved.rows[0]?.on_hand, reason, orderId, staffId]);
  }
}

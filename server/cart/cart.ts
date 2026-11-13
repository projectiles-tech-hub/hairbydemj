// The cart. A guest's cart is found by a random token (a cookie on the
// website, a header from the phone app); a signed-in customer has one cart,
// shared by every device they sign in on. When a guest signs in, the guest
// cart is merged into theirs.
//
// The cart holds variants and quantities only. Prices, stock, discounts and
// gift cards are worked out fresh every time the cart is read, so a customer
// always sees today's price and today's stock.

import { checkAttempts, recordAttempt } from '../accounts/guard.js';
import { hashToken, randomToken } from '../accounts/crypto.js';
import { withTransaction, type Db, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import { VISIBLE_SQL } from '../catalog/rules.js';
import { chooseDiscounts, type AppliedDiscount, type CodeStatus } from './discounts.js';
import { findGiftCard, giftCardProblem } from './gift-cards.js';
import { checkCurrency } from './money.js';

type Q = { query: DbClient['query'] } | Db;

export interface CartDeps {
  db: Db;
  now: () => Date;
}

export const CART = {
  /** Most of one variant in one cart. */
  maxQuantity: 20,
  maxLines: 50,
  maxGiftCards: 5,
};

/** Who is asking: a signed-in customer, a guest token, or both (just signed in). */
export interface CartOwner {
  customerId: number | null;
  token: string | null;
}

export interface CartLine {
  id: number;
  variantId: number;
  productId: number;
  slug: string;
  name: string;
  /** Length, density and colour, for example '22" · 180% · Natural black'. */
  description: string;
  sku: string;
  image: { path: string; alt: string; widths: number[] } | null;
  quantity: number;
  unitMinor: number | null;
  compareAtMinor: number | null;
  lineMinor: number;
  /** How many can be bought now. */
  available: number;
  weightGrams: number;
  /** Why this line cannot be bought as it is, if it cannot. */
  problem: null | 'unavailable' | 'no_price' | 'sold_out' | 'not_enough_stock';
}

export interface CartGiftCard {
  id: number;
  last4: string;
  balanceMinor: number;
  appliedMinor: number;
  problem: string | null;
}

export interface Cart {
  id: number | null;
  currency: string;
  lines: CartLine[];
  itemCount: number;
  subtotalMinor: number;
  discounts: AppliedDiscount[];
  discountMinor: number;
  freeShipping: boolean;
  code: CodeStatus | null;
  giftCards: CartGiftCard[];
  giftCardMinor: number;
  /** Subtotal less discounts and gift cards. Delivery is added at checkout. */
  totalMinor: number;
  weightGrams: number;
  /** False while any line has a problem or the cart is empty. */
  canCheckout: boolean;
}

interface CartRow {
  id: number;
  currency: string;
  discountCode: string | null;
  customerId: number | null;
}

async function cartById(db: Q, id: number): Promise<CartRow | null> {
  const result = await db.query('select id, currency, discount_code, customer_id from carts where id = $1', [id]);
  const r = result.rows[0] as Record<string, unknown> | undefined;
  return r ? { id: Number(r.id), currency: String(r.currency), discountCode: (r.discount_code as string | null) ?? null, customerId: r.customer_id === null ? null : Number(r.customer_id) } : null;
}

async function findCartId(db: Q, owner: CartOwner): Promise<{ customerCart: number | null; guestCart: number | null }> {
  const customer = owner.customerId === null ? null : await db.query('select id from carts where customer_id = $1', [owner.customerId]);
  const guest = owner.token && owner.token.length <= 200 ? await db.query('select id from carts where token_hash = $1 and customer_id is null', [hashToken(owner.token)]) : null;
  return { customerCart: customer?.rows[0] ? Number(customer.rows[0].id) : null, guestCart: guest?.rows[0] ? Number(guest.rows[0].id) : null };
}

/** Move a guest cart's lines and gift cards into the customer's cart, then remove the guest cart. */
async function mergeInto(c: Q, from: number, into: number): Promise<void> {
  await c.query(
    `insert into cart_items (cart_id, variant_id, quantity, added_at)
     select $2, variant_id, quantity, added_at from cart_items where cart_id = $1 and variant_id is not null
     on conflict (cart_id, variant_id) where variant_id is not null
     do update set quantity = least(greatest(cart_items.quantity, excluded.quantity), ${CART.maxQuantity})`,
    [from, into],
  );
  await c.query('insert into cart_gift_cards (cart_id, gift_card_id, added_at) select $2, gift_card_id, added_at from cart_gift_cards where cart_id = $1 on conflict do nothing', [from, into]);
  const guest = await c.query('select discount_code from carts where id = $1', [from]);
  if (guest.rows[0]?.discount_code) await c.query('update carts set discount_code = coalesce(discount_code, $2) where id = $1', [into, guest.rows[0].discount_code]);
  await c.query('delete from carts where id = $1', [from]);
}

/**
 * The cart for this owner, or null when there is none yet. A signed-in
 * customer who still has a guest cart gets it merged into theirs; with no
 * cart of their own, the guest cart simply becomes theirs.
 */
export async function resolveCart(deps: CartDeps, owner: CartOwner): Promise<CartRow | null> {
  const found = await findCartId(deps.db, owner);
  if (owner.customerId !== null && found.guestCart !== null) {
    return withTransaction(deps.db, async (c) => {
      if (found.customerCart === null) {
        await c.query('update carts set customer_id = $2, token_hash = null where id = $1', [found.guestCart, owner.customerId]);
        return cartById(c, found.guestCart ?? 0);
      }
      await mergeInto(c, found.guestCart ?? 0, found.customerCart);
      return cartById(c, found.customerCart);
    });
  }
  const id = found.customerCart ?? found.guestCart;
  return id === null ? null : cartById(deps.db, id);
}

/** The owner's cart, made if there is none. A new guest cart comes with a new token, to be handed back. */
async function ensureCart(deps: CartDeps, owner: CartOwner, currency: string): Promise<{ cart: CartRow; newToken: string | null }> {
  const existing = await resolveCart(deps, owner);
  if (existing) return { cart: existing, newToken: null };
  if (owner.customerId !== null) {
    const made = await deps.db.query('insert into carts (customer_id, currency) values ($1, $2) on conflict (customer_id) where customer_id is not null do update set updated_at = now() returning id', [owner.customerId, currency]);
    return { cart: (await cartById(deps.db, Number(made.rows[0]?.id))) as CartRow, newToken: null };
  }
  const token = randomToken();
  const made = await deps.db.query('insert into carts (token_hash, currency) values ($1, $2) returning id', [hashToken(token), currency]);
  return { cart: (await cartById(deps.db, Number(made.rows[0]?.id))) as CartRow, newToken: token };
}

async function touch(db: Q, cartId: number): Promise<void> {
  await db.query('update carts set updated_at = now() where id = $1', [cartId]);
}

const emptyCart = (currency: string): Cart => ({ id: null, currency, lines: [], itemCount: 0, subtotalMinor: 0, discounts: [], discountMinor: 0, freeShipping: false, code: null, giftCards: [], giftCardMinor: 0, totalMinor: 0, weightGrams: 0, canCheckout: false });

/**
 * Work out everything about a cart in its currency: today's prices, stock,
 * discounts and gift cards. Used for showing the cart and, at checkout, for
 * the order itself (with the buyer's email, which some discounts need).
 */
export async function priceCart(deps: CartDeps, cart: CartRow, buyer: { customerId: number | null; email: string | null }): Promise<Cart> {
  const now = deps.now();
  const result = await deps.db.query(
    `select ci.id, ci.quantity, v.id as variant_id, v.sku, v.length_inches, v.density_percent, v.colour, v.weight_grams, v.is_active,
            p.id as product_id, p.slug, p.name, ${VISIBLE_SQL('p', '$3')} as visible,
            pr.amount_minor, pr.compare_at_minor,
            coalesce(greatest(i.on_hand - i.reserved, 0), 0)::int as available,
            (select jsonb_build_object('path', m.path, 'alt', m.alt, 'widths', m.widths) from product_media m
              where m.product_id = p.id and m.kind = 'image' and m.status = 'ready' and (m.colour is null or lower(m.colour) = lower(v.colour))
              order by (lower(m.colour) = lower(v.colour)) desc nulls last, m.position, m.id limit 1) as image
     from cart_items ci
     join variants v on v.id = ci.variant_id
     join products p on p.id = v.product_id
     left join prices pr on pr.variant_id = v.id and pr.currency = $2
     left join inventory i on i.variant_id = v.id
     where ci.cart_id = $1
     order by ci.added_at, ci.id`,
    [cart.id, cart.currency, now],
  );
  const lines: CartLine[] = result.rows.map((r) => {
    const quantity = Number(r.quantity);
    const available = Number(r.available);
    const unit = r.amount_minor === null ? null : Number(r.amount_minor);
    let problem: CartLine['problem'] = null;
    if (!r.visible || !r.is_active) problem = 'unavailable';
    else if (unit === null) problem = 'no_price';
    else if (available === 0) problem = 'sold_out';
    else if (available < quantity) problem = 'not_enough_stock';
    return {
      id: Number(r.id),
      variantId: Number(r.variant_id),
      productId: Number(r.product_id),
      slug: String(r.slug),
      name: String(r.name),
      description: [r.length_inches ? `${Number(r.length_inches)}"` : null, r.density_percent ? `${Number(r.density_percent)}%` : null, r.colour as string | null].filter(Boolean).join(' · '),
      sku: String(r.sku),
      image: (r.image as CartLine['image']) ?? null,
      quantity,
      unitMinor: unit,
      compareAtMinor: r.compare_at_minor === null ? null : Number(r.compare_at_minor),
      lineMinor: problem === null || problem === 'not_enough_stock' ? (unit ?? 0) * quantity : 0,
      available,
      weightGrams: Number(r.weight_grams) * quantity,
      problem,
    };
  });
  // Only lines that can be bought count towards the totals and the discounts.
  const priced = lines.filter((l) => l.problem === null);
  const subtotal = priced.reduce((sum, l) => sum + l.lineMinor, 0);

  let tier: string | null = null;
  if (buyer.customerId !== null) tier = String((await deps.db.query('select loyalty_tier from customers where id = $1', [buyer.customerId])).rows[0]?.loyalty_tier ?? '') || null;
  const { applied, code } = priced.length
    ? await chooseDiscounts(deps.db, { lines: priced.map((l) => ({ lineId: l.id, productId: l.productId, unitMinor: l.unitMinor ?? 0, quantity: l.quantity })), currency: cart.currency, code: cart.discountCode, buyer, tier, now })
    : { applied: [] as AppliedDiscount[], code: cart.discountCode ? { code: cart.discountCode, applied: false, message: 'Add items to your bag to use this code.' } : null };
  const discountMinor = applied.reduce((sum, d) => sum + d.amountMinor, 0);

  const cards = await deps.db.query(
    'select g.id, g.code_last4, g.currency, g.balance_minor, g.status, g.expires_at from cart_gift_cards cg join gift_cards g on g.id = cg.gift_card_id where cg.cart_id = $1 order by cg.added_at, g.id',
    [cart.id],
  );
  let left = subtotal - discountMinor;
  const giftCards: CartGiftCard[] = cards.rows.map((r) => {
    const card = { id: Number(r.id), last4: String(r.code_last4), currency: String(r.currency), balanceMinor: Number(r.balance_minor), status: String(r.status), expiresAt: (r.expires_at as Date | null) ?? null };
    const problem = giftCardProblem(card, now) ?? (card.currency !== cart.currency ? `This gift card is in ${card.currency}. Pay in ${card.currency} to use it.` : null);
    const appliedMinor = problem ? 0 : Math.min(card.balanceMinor, left);
    left -= appliedMinor;
    return { id: card.id, last4: card.last4, balanceMinor: card.balanceMinor, appliedMinor, problem };
  });
  const giftCardMinor = giftCards.reduce((sum, g) => sum + g.appliedMinor, 0);

  return {
    id: cart.id,
    currency: cart.currency,
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotalMinor: subtotal,
    discounts: applied,
    discountMinor,
    freeShipping: applied.some((d) => d.freeShipping),
    code,
    giftCards,
    giftCardMinor,
    totalMinor: subtotal - discountMinor - giftCardMinor,
    weightGrams: priced.reduce((sum, l) => sum + l.weightGrams, 0),
    canCheckout: lines.length > 0 && lines.every((l) => l.problem === null),
  };
}

export interface CartResult {
  cart: Cart;
  /** Set when a new guest cart was made: the token to keep (cookie, or the app's storage). */
  newToken: string | null;
}

/** Read the cart. With no cart yet, an empty one in the currency given is returned (nothing is stored). */
export async function readCart(deps: CartDeps, owner: CartOwner, fallbackCurrency: string): Promise<CartResult> {
  const cart = await resolveCart(deps, owner);
  if (!cart) return { cart: emptyCart(fallbackCurrency), newToken: null };
  return { cart: await priceCart(deps, cart, { customerId: owner.customerId, email: null }), newToken: null };
}

function quantityOf(value: unknown, min: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > CART.maxQuantity) {
    throw new ApiError(422, 'invalid', 'Check the quantity.', { quantity: `Choose a quantity from ${min} to ${CART.maxQuantity}.` });
  }
  return n;
}

/** Add a variant, or more of one already in the cart. Refused when there is not enough stock. */
export async function addItem(deps: CartDeps, owner: CartOwner, input: Record<string, unknown>, fallbackCurrency: string): Promise<CartResult> {
  const variantId = Number(input.variantId);
  if (!Number.isInteger(variantId) || variantId < 1) throw new ApiError(422, 'invalid', 'Choose a length, density and colour first.', { variantId: 'Choose a length, density and colour first.' });
  const quantity = quantityOf(input.quantity ?? 1, 1);
  const { cart, newToken } = await ensureCart(deps, owner, fallbackCurrency);
  await withTransaction(deps.db, async (c) => {
    const variant = await c.query(
      `select v.id, coalesce(greatest(i.on_hand - i.reserved, 0), 0)::int as available, pr.amount_minor is not null as priced
       from variants v join products p on p.id = v.product_id left join inventory i on i.variant_id = v.id left join prices pr on pr.variant_id = v.id and pr.currency = $3
       where v.id = $1 and v.is_active and ${VISIBLE_SQL('p', '$2')}`,
      [variantId, deps.now(), cart.currency],
    );
    const v = variant.rows[0] as { available: number; priced: boolean } | undefined;
    if (!v) throw new ApiError(404, 'not_found', 'That item is no longer sold.');
    if (!v.priced) throw new ApiError(422, 'no_price', `That item cannot be bought in ${cart.currency}. Choose another currency.`);
    // The row lock stops two quick taps on "add" from both reading the old quantity.
    await c.query('select id from carts where id = $1 for update', [cart.id]);
    const current = await c.query('select quantity from cart_items where cart_id = $1 and variant_id = $2', [cart.id, variantId]);
    const total = Number(current.rows[0]?.quantity ?? 0) + quantity;
    if (total > CART.maxQuantity) throw new ApiError(422, 'invalid', `You can have up to ${CART.maxQuantity} of one item in your bag.`, { quantity: `Up to ${CART.maxQuantity} of one item.` });
    if (total > v.available) {
      throw new ApiError(409, 'not_enough_stock', v.available === 0 ? 'Sorry, that item is sold out.' : `Sorry, only ${v.available} ${v.available === 1 ? 'is' : 'are'} left${current.rows[0] ? ', and some are already in your bag' : ''}.`);
    }
    if (!current.rows[0]) {
      const lines = await c.query('select count(*)::int as n from cart_items where cart_id = $1', [cart.id]);
      if (Number(lines.rows[0]?.n) >= CART.maxLines) throw new ApiError(422, 'cart_full', `Your bag can hold up to ${CART.maxLines} different items.`);
    }
    await c.query(
      `insert into cart_items (cart_id, variant_id, quantity) values ($1, $2, $3)
       on conflict (cart_id, variant_id) where variant_id is not null do update set quantity = $3`,
      [cart.id, variantId, total],
    );
    await touch(c, cart.id);
  });
  return { cart: await priceCart(deps, (await cartById(deps.db, cart.id)) as CartRow, { customerId: owner.customerId, email: null }), newToken };
}

async function ownLine(deps: CartDeps, owner: CartOwner, lineId: number): Promise<CartRow> {
  const cart = await resolveCart(deps, owner);
  if (!cart) throw new ApiError(404, 'not_found', 'That item is not in your bag.');
  const line = await deps.db.query('select 1 from cart_items where id = $1 and cart_id = $2', [lineId, cart.id]);
  if (!line.rows[0]) throw new ApiError(404, 'not_found', 'That item is not in your bag.');
  return cart;
}

/** Change a line's quantity. 0 removes it. More than is in stock is refused. */
export async function setQuantity(deps: CartDeps, owner: CartOwner, lineId: number, input: Record<string, unknown>): Promise<CartResult> {
  const quantity = quantityOf(input.quantity, 0);
  const cart = await ownLine(deps, owner, lineId);
  if (quantity === 0) {
    await deps.db.query('delete from cart_items where id = $1', [lineId]);
  } else {
    const stock = await deps.db.query('select coalesce(greatest(i.on_hand - i.reserved, 0), 0)::int as available, ci.quantity from cart_items ci left join inventory i on i.variant_id = ci.variant_id where ci.id = $1', [lineId]);
    const available = Number(stock.rows[0]?.available ?? 0);
    // Lowering the quantity is always allowed, even below stock that has since run short.
    if (quantity > Number(stock.rows[0]?.quantity) && quantity > available) throw new ApiError(409, 'not_enough_stock', available === 0 ? 'Sorry, that item is sold out.' : `Sorry, only ${available} ${available === 1 ? 'is' : 'are'} left.`);
    await deps.db.query('update cart_items set quantity = $2 where id = $1', [lineId, quantity]);
  }
  await touch(deps.db, cart.id);
  return { cart: await priceCart(deps, cart, { customerId: owner.customerId, email: null }), newToken: null };
}

/** Switch the cart to another currency. Every price is then read in that currency. */
export async function setCurrency(deps: CartDeps, owner: CartOwner, input: Record<string, unknown>): Promise<CartResult> {
  const currency = await checkCurrency(deps.db, input.currency);
  const cart = await resolveCart(deps, owner);
  if (owner.customerId !== null) await deps.db.query('update customers set preferred_currency = $2 where id = $1', [owner.customerId, currency]);
  if (!cart) return { cart: emptyCart(currency), newToken: null };
  await deps.db.query('update carts set currency = $2, updated_at = now() where id = $1', [cart.id, currency]);
  return { cart: await priceCart(deps, { ...cart, currency }, { customerId: owner.customerId, email: null }), newToken: null };
}

/** Put a discount code on the cart. Whether it applies, and why not, is in the cart's "code". */
export async function applyCode(deps: CartDeps, owner: CartOwner, input: Record<string, unknown>, fallbackCurrency: string): Promise<CartResult> {
  const code = typeof input.code === 'string' ? input.code.trim().slice(0, 40) : '';
  if (!code) throw new ApiError(422, 'invalid', 'Enter a code.', { code: 'Enter a code.' });
  const { cart, newToken } = await ensureCart(deps, owner, fallbackCurrency);
  await deps.db.query('update carts set discount_code = $2, updated_at = now() where id = $1', [cart.id, code]);
  return { cart: await priceCart(deps, { ...cart, discountCode: code }, { customerId: owner.customerId, email: null }), newToken };
}

export async function removeCode(deps: CartDeps, owner: CartOwner): Promise<CartResult> {
  const cart = await resolveCart(deps, owner);
  if (!cart) throw new ApiError(404, 'not_found', 'Your bag is empty.');
  await deps.db.query('update carts set discount_code = null, updated_at = now() where id = $1', [cart.id]);
  return { cart: await priceCart(deps, { ...cart, discountCode: null }, { customerId: owner.customerId, email: null }), newToken: null };
}

/**
 * Put a gift card on the cart. Wrong codes count as failed tries, so codes
 * cannot be guessed by trying many: 5 wrong per cart, 30 per address, in 15 minutes.
 */
export async function applyGiftCard(deps: CartDeps, owner: CartOwner, input: Record<string, unknown>, ip: string | null, fallbackCurrency: string): Promise<CartResult> {
  const code = typeof input.code === 'string' ? input.code.slice(0, 60) : '';
  if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) throw new ApiError(422, 'invalid', 'Enter the code from your gift card.', { code: 'Enter the code from your gift card.' });
  const { cart, newToken } = await ensureCart(deps, owner, fallbackCurrency);
  const subject = `cart:${cart.id}`;
  await checkAttempts(deps.db, 'gift_card', subject, ip);
  const card = await findGiftCard(deps.db, code);
  await recordAttempt(deps.db, 'gift_card', subject, ip, card !== null);
  if (!card) throw new ApiError(422, 'invalid', 'That gift card code is not right. Check it and try again.', { code: 'That gift card code is not right.' });
  const problem = giftCardProblem(card, deps.now());
  if (problem) throw new ApiError(422, 'invalid', problem, { code: problem });
  if (card.currency !== cart.currency) throw new ApiError(422, 'invalid', `This gift card is in ${card.currency}. Pay in ${card.currency} to use it.`, { code: `This gift card is in ${card.currency}.` });
  const count = await deps.db.query('select count(*)::int as n, bool_or(gift_card_id = $2) as has from cart_gift_cards where cart_id = $1', [cart.id, card.id]);
  if (!count.rows[0]?.has) {
    if (Number(count.rows[0]?.n) >= CART.maxGiftCards) throw new ApiError(422, 'invalid', `You can use up to ${CART.maxGiftCards} gift cards on one order.`);
    await deps.db.query('insert into cart_gift_cards (cart_id, gift_card_id) values ($1, $2) on conflict do nothing', [cart.id, card.id]);
  }
  await touch(deps.db, cart.id);
  return { cart: await priceCart(deps, cart, { customerId: owner.customerId, email: null }), newToken };
}

export async function removeGiftCard(deps: CartDeps, owner: CartOwner, giftCardId: number): Promise<CartResult> {
  const cart = await resolveCart(deps, owner);
  if (!cart) throw new ApiError(404, 'not_found', 'Your bag is empty.');
  await deps.db.query('delete from cart_gift_cards where cart_id = $1 and gift_card_id = $2', [cart.id, giftCardId]);
  return { cart: await priceCart(deps, cart, { customerId: owner.customerId, email: null }), newToken: null };
}

/** Empty the cart after an order is placed. */
export async function clearCart(db: Q, cartId: number): Promise<void> {
  await db.query('delete from cart_items where cart_id = $1', [cartId]);
  await db.query('delete from cart_gift_cards where cart_id = $1', [cartId]);
  await db.query('update carts set discount_code = null, updated_at = now() where id = $1', [cartId]);
}

export { cartById, type CartRow };

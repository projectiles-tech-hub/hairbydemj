// What a signed-in customer manages themselves: their details, password,
// saved addresses, wishlist, and closing the account.
//
//   GET  /account/profile            name, phone, birthday, email
//   POST /account/profile            { firstName, lastName, phone, birthday }
//   POST /account/password           { currentPassword, newPassword } (or just newPassword for Google or Apple accounts)
//   POST /account/delete             { password } closes the account; past orders are kept without the name
//   GET  /account/addresses          saved addresses, default first
//   POST /account/addresses          add one; POST /account/addresses/:id to change; /:id/delete to remove
//   GET  /wishlist                   saved products
//   POST /wishlist                   { productId }
//   POST /wishlist/:productId/delete
// All under /api on the website (cookie) and /v1 in the app (bearer token).

import { hashPassword, hashToken, verifyPassword } from './crypto.js';
import type { AccountDeps } from './deps.js';
import { passwordOf, text } from './deps.js';
import { currentCustomer } from './routes.js';
import { requireSameOrigin } from './web.js';
import { withTransaction } from '../db/pool.js';
import { ApiError, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import { parseAddress } from '../shipping/shipping.js';
import { VISIBLE_SQL } from '../catalog/rules.js';

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', message, { [field]: message });

export interface Profile {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  birthday: string | null;
  hasPassword: boolean;
}

export async function readProfile(deps: AccountDeps, customerId: number): Promise<Profile> {
  const r = (await deps.db.query('select email, first_name, last_name, phone, birthday::text as birthday, password_hash is not null as has_password from customers where id = $1', [customerId])).rows[0];
  if (!r) throw new ApiError(404, 'not_found', 'Account not found.');
  return { email: String(r.email), firstName: String(r.first_name), lastName: String(r.last_name), phone: (r.phone as string | null) ?? null, birthday: (r.birthday as string | null) ?? null, hasPassword: r.has_password === true };
}

export async function saveProfile(deps: AccountDeps, customerId: number, input: Record<string, unknown>): Promise<Profile> {
  const firstName = text(input.firstName, 80);
  const lastName = text(input.lastName, 80);
  if (!firstName) throw invalid('firstName', 'Enter your first name.');
  const phone = text(input.phone, 30);
  if (phone && !/^\+?[0-9 ()-]{7,30}$/.test(phone)) throw invalid('phone', 'Enter a phone number with digits only, with or without the + and country code.');
  const birthdayText = text(input.birthday, 10);
  let birthday: string | null = null;
  if (birthdayText) {
    const d = new Date(`${birthdayText}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayText) || Number.isNaN(d.getTime()) || d > deps.now() || d.getUTCFullYear() < 1900) throw invalid('birthday', 'Enter your birthday as a date in the past.');
    birthday = birthdayText;
  }
  await deps.db.query('update customers set first_name = $2, last_name = $3, phone = $4, birthday = $5 where id = $1', [customerId, firstName, lastName, phone || null, birthday]);
  return readProfile(deps, customerId);
}

/** Change the password while signed in. Every other device is signed out. */
export async function changePassword(deps: AccountDeps, customerId: number, keepToken: string, input: Record<string, unknown>): Promise<void> {
  const row = (await deps.db.query('select email, password_hash from customers where id = $1', [customerId])).rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'Account not found.');
  if (row.password_hash) {
    const current = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    if (!(await verifyPassword(current, String(row.password_hash)))) throw invalid('currentPassword', 'That is not your current password.');
  }
  const next = passwordOf(input.newPassword, 'newPassword');
  const hash = await hashPassword(next, deps.passwordParams);
  await withTransaction(deps.db, async (c) => {
    await c.query('update customers set password_hash = $2 where id = $1', [customerId, hash]);
    await c.query('update customer_sessions set revoked_at = $3 where customer_id = $1 and token_hash <> $2 and revoked_at is null', [customerId, hashToken(keepToken), deps.now()]);
  });
  await deps.mail.send({ to: String(row.email), template: 'password_changed', data: {} });
}

/**
 * Close the account. Orders stay (the law and our books need them) but lose
 * the link to the person; everything else about them is removed.
 */
export async function deleteAccount(deps: AccountDeps, customerId: number, input: Record<string, unknown>): Promise<void> {
  const row = (await deps.db.query('select password_hash from customers where id = $1', [customerId])).rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'Account not found.');
  if (row.password_hash && !(await verifyPassword(typeof input.password === 'string' ? input.password : '', String(row.password_hash)))) throw invalid('password', 'Enter your password to confirm.');
  if (!row.password_hash && input.confirm !== true) throw invalid('confirm', 'Tick the box to confirm.');
  await withTransaction(deps.db, async (c) => {
    for (const table of ['addresses', 'wishlist_items', 'push_devices', 'notification_preferences', 'notifications', 'customer_identities', 'customer_tokens', 'payment_methods', 'back_in_stock_requests']) {
      await c.query(`delete from ${table} where customer_id = $1`, [customerId]);
    }
    await c.query('delete from carts where customer_id = $1', [customerId]);
    await c.query('update customer_sessions set revoked_at = coalesce(revoked_at, $2) where customer_id = $1', [customerId, deps.now()]);
    await c.query('update orders set customer_id = null where customer_id = $1', [customerId]);
    await c.query(
      `update customers set status = 'deleted', deleted_at = $2, email = 'deleted-' || id || '@deleted.invalid', password_hash = null, first_name = '', last_name = '', phone = null,
         birthday = null, marketing_consent = false, referral_code = null, internal_note = '' where id = $1`,
      [customerId, deps.now()],
    );
  });
}

// ----- addresses -----

export interface SavedAddress {
  id: number;
  label: string | null;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

export async function listAddresses(deps: AccountDeps, customerId: number): Promise<SavedAddress[]> {
  const found = await deps.db.query('select * from addresses where customer_id = $1 order by is_default desc, id', [customerId]);
  return found.rows.map((r) => ({ id: Number(r.id), label: (r.label as string | null) ?? null, name: String(r.full_name), phone: String(r.phone), line1: String(r.line1), line2: (r.line2 as string | null) ?? null, city: String(r.city), region: (r.region as string | null) ?? null, postalCode: (r.postal_code as string | null) ?? null, country: String(r.country), isDefault: r.is_default === true }));
}

export async function saveAddress(deps: AccountDeps, customerId: number, id: number | null, input: Record<string, unknown>): Promise<SavedAddress[]> {
  const a = parseAddress(input, { full: true });
  const label = text(input.label, 40) || null;
  const makeDefault = input.isDefault === true;
  await withTransaction(deps.db, async (c) => {
    const count = Number((await c.query('select count(*)::int as n from addresses where customer_id = $1', [customerId])).rows[0]?.n);
    if (id === null && count >= 20) throw invalid('line1', 'You can keep up to 20 addresses. Remove one first.');
    const isDefault = makeDefault || count === 0;
    if (isDefault) await c.query('update addresses set is_default = false where customer_id = $1', [customerId]);
    if (id === null) {
      await c.query('insert into addresses (customer_id, label, full_name, phone, line1, line2, city, region, postal_code, country, is_default) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [customerId, label, a.name, a.phone, a.line1, a.line2, a.city, a.region, a.postalCode, a.country, isDefault]);
    } else {
      const changed = await c.query(
        'update addresses set label = $3, full_name = $4, phone = $5, line1 = $6, line2 = $7, city = $8, region = $9, postal_code = $10, country = $11, is_default = is_default or $12 where id = $1 and customer_id = $2',
        [id, customerId, label, a.name, a.phone, a.line1, a.line2, a.city, a.region, a.postalCode, a.country, makeDefault],
      );
      if (!changed.rowCount) throw new ApiError(404, 'not_found', 'We could not find that address.');
    }
  });
  return listAddresses(deps, customerId);
}

export async function deleteAddress(deps: AccountDeps, customerId: number, id: number): Promise<SavedAddress[]> {
  await withTransaction(deps.db, async (c) => {
    const gone = await c.query('delete from addresses where id = $1 and customer_id = $2 returning is_default', [id, customerId]);
    if (!gone.rowCount) throw new ApiError(404, 'not_found', 'We could not find that address.');
    // The oldest remaining address becomes the default.
    if (gone.rows[0]?.is_default) await c.query('update addresses set is_default = true where id = (select id from addresses where customer_id = $1 order by id limit 1)', [customerId]);
  });
  return listAddresses(deps, customerId);
}

// ----- wishlist -----

export async function listWishlist(deps: AccountDeps, customerId: number, currency: string): Promise<Array<{ productId: number; slug: string; name: string; priceFromMinor: number | null; inStock: boolean; image: unknown }>> {
  const found = await deps.db.query(
    `select p.id, p.slug, p.name,
            (select min(pr.amount_minor) from variants v join prices pr on pr.variant_id = v.id and pr.currency = $2 where v.product_id = p.id and v.is_active) as price_from,
            exists (select 1 from variants v join inventory i on i.variant_id = v.id where v.product_id = p.id and v.is_active and i.on_hand - i.reserved > 0) as in_stock,
            (select jsonb_build_object('path', m.path, 'alt', m.alt, 'widths', m.widths) from product_media m where m.product_id = p.id and m.kind = 'image' and m.status = 'ready' order by m.position, m.id limit 1) as image
     from wishlist_items w join products p on p.id = w.product_id
     where w.customer_id = $1 and ${VISIBLE_SQL('p', '$3')} order by w.created_at desc`,
    [customerId, currency, deps.now()],
  );
  return found.rows.map((r) => ({ productId: Number(r.id), slug: String(r.slug), name: String(r.name), priceFromMinor: r.price_from === null ? null : Number(r.price_from), inStock: r.in_stock === true, image: r.image ?? null }));
}

export async function addToWishlist(deps: AccountDeps, customerId: number, input: Record<string, unknown>): Promise<void> {
  const productId = Number(input.productId);
  if (!Number.isInteger(productId) || productId < 1) throw invalid('productId', 'Choose a product.');
  const exists = await deps.db.query(`select 1 from products p where p.id = $1 and ${VISIBLE_SQL('p', '$2')}`, [productId, deps.now()]);
  if (!exists.rowCount) throw new ApiError(404, 'not_found', 'That product does not exist.');
  const count = Number((await deps.db.query('select count(*)::int as n from wishlist_items where customer_id = $1', [customerId])).rows[0]?.n);
  if (count >= 200) throw invalid('productId', 'Your wishlist is full. Remove something first.');
  await deps.db.query('insert into wishlist_items (customer_id, product_id, created_at) values ($1, $2, $3) on conflict do nothing', [customerId, productId, deps.now()]);
}

export function customerAccountRoutes(router: Router, deps: AccountDeps, prefix: string, transport: 'cookie' | 'bearer'): Router {
  const who = async (ctx: RequestContext): Promise<{ id: number; token: string }> => {
    const signedIn = await currentCustomer(deps, ctx, transport);
    if (!signedIn) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
    return { id: signedIn.customer.id, token: signedIn.token };
  };
  const change = (work: (id: number, input: Record<string, unknown>, ctx: RequestContext, token: string) => Promise<unknown>) => async (ctx: RequestContext): Promise<void> => {
    if (transport === 'cookie') requireSameOrigin(ctx);
    const { id, token } = await who(ctx);
    const result = await work(id, await readJson(ctx.req), ctx, token);
    sendJson(ctx.res, 200, result ?? { ok: true });
  };
  const idOf = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };
  const currencyOf = async (ctx: RequestContext, id: number): Promise<string> => {
    const asked = (ctx.query.get('currency') ?? '').toUpperCase();
    const known = (await deps.db.query('select code from currencies where enabled')).rows.map((r) => String(r.code));
    if (known.includes(asked)) return asked;
    const preferred = (await deps.db.query('select preferred_currency from customers where id = $1', [id])).rows[0]?.preferred_currency as string | null;
    return preferred && known.includes(preferred) ? preferred : 'NGN';
  };
  return router
    .get(`${prefix}/account/profile`, async (ctx) => sendJson(ctx.res, 200, { profile: await readProfile(deps, (await who(ctx)).id) }))
    .post(`${prefix}/account/profile`, change(async (id, input) => ({ profile: await saveProfile(deps, id, input) })))
    .post(`${prefix}/account/password`, change(async (id, input, _ctx, token) => {
      await changePassword(deps, id, token, input);
      return { changed: true };
    }))
    .post(`${prefix}/account/delete`, change(async (id, input) => {
      await deleteAccount(deps, id, input);
      return { deleted: true };
    }))
    .get(`${prefix}/account/addresses`, async (ctx) => sendJson(ctx.res, 200, { addresses: await listAddresses(deps, (await who(ctx)).id) }))
    .post(`${prefix}/account/addresses`, change(async (id, input) => ({ addresses: await saveAddress(deps, id, null, input) })))
    .post(`${prefix}/account/addresses/:id`, change(async (id, input, ctx) => ({ addresses: await saveAddress(deps, id, idOf(ctx), input) })))
    .post(`${prefix}/account/addresses/:id/delete`, change(async (id, _input, ctx) => ({ addresses: await deleteAddress(deps, id, idOf(ctx)) })))
    .get(`${prefix}/wishlist`, async (ctx) => {
      const { id } = await who(ctx);
      sendJson(ctx.res, 200, { items: await listWishlist(deps, id, await currencyOf(ctx, id)) });
    })
    .post(`${prefix}/wishlist`, change(async (id, input) => {
      await addToWishlist(deps, id, input);
      return { saved: true };
    }))
    .post(`${prefix}/wishlist/:id/delete`, change(async (id, _input, ctx) => {
      await deps.db.query('delete from wishlist_items where customer_id = $1 and product_id = $2', [id, idOf(ctx)]);
      return { removed: true };
    }));
}

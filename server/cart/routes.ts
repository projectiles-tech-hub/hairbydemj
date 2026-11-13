// The HTTP addresses for the cart, currencies and discounts.
//
//   Website  hairbydemj.com/api/cart...      guest cart found by a cookie
//   App      api.hairbydemj.com/v1/cart...   guest cart found by the X-Cart-Token header
//   Both     .../currency                    the currencies on offer and the one to show first
//   Admin    admin.hairbydemj.com/api/currencies..., /api/discounts...

import type { AccountDeps } from '../accounts/deps.js';
import { currentCustomer, requireStaff } from '../accounts/routes.js';
import { requireSameOrigin } from '../accounts/web.js';
import { ApiError, clientIp, readCookies, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import * as cart from './cart.js';
import * as discounts from './discounts.js';
import { currencyForCountry, enabledCurrencies, pickCurrency } from './money.js';
import { DEFAULT_RATES_URL, fetchRates, listCurrencySettings, refreshDailyRates, updateCurrency, type RatesFetcher } from './rates.js';

type Transport = 'cookie' | 'header';

const CART_DAYS = 60;

function cartCookieName(deps: AccountDeps): string {
  return deps.config.env === 'production' ? '__Host-hbd_cart' : 'hbd_cart';
}

function setCartCookie(deps: AccountDeps, ctx: RequestContext, token: string): void {
  const parts = [`${cartCookieName(deps)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${CART_DAYS * 86_400}`];
  if (deps.config.env === 'production') parts.push('Secure');
  const existing = ctx.res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : typeof existing === 'string' ? [existing] : [];
  ctx.res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

function guestToken(deps: AccountDeps, ctx: RequestContext, transport: Transport): string | null {
  if (transport === 'cookie') return readCookies(ctx.req)[cartCookieName(deps)] || null;
  const header = ctx.req.headers['x-cart-token'];
  return typeof header === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(header) ? header : null;
}

/** The visitor's country, as Cloudflare reports it. Only believed behind our own proxy. */
function country(deps: AccountDeps, ctx: RequestContext): string | null {
  if (!deps.config.trustProxy) return null;
  const header = ctx.req.headers['cf-ipcountry'];
  return typeof header === 'string' ? header : null;
}

/** Whose cart this request is about: the signed-in customer, the guest token, or both. Used by checkout and shipping. */
export async function cartOwner(deps: AccountDeps, ctx: RequestContext, transport: Transport): Promise<cart.CartOwner> {
  const signedIn = await currentCustomer(deps, ctx, transport === 'cookie' ? 'cookie' : 'bearer');
  return { customerId: signedIn?.customer.id ?? null, token: guestToken(deps, ctx, transport) };
}

export function shopCartRoutes(router: Router, deps: AccountDeps, prefix: string, transport: Transport): Router {
  const owner = async (ctx: RequestContext): Promise<{ owner: cart.CartOwner; preferred: string | null }> => {
    const signedIn = await currentCustomer(deps, ctx, transport === 'cookie' ? 'cookie' : 'bearer');
    let preferred: string | null = null;
    if (signedIn) preferred = ((await deps.db.query('select preferred_currency from customers where id = $1', [signedIn.customer.id])).rows[0]?.preferred_currency as string | null) ?? null;
    return { owner: { customerId: signedIn?.customer.id ?? null, token: guestToken(deps, ctx, transport) }, preferred };
  };
  const fallback = (ctx: RequestContext, preferred: string | null): Promise<string> => pickCurrency(deps.db, [ctx.query.get('currency'), preferred, currencyForCountry(country(deps, ctx))]);
  const reply = (ctx: RequestContext, result: cart.CartResult, status = 200): void => {
    if (result.newToken && transport === 'cookie') setCartCookie(deps, ctx, result.newToken);
    sendJson(ctx.res, status, { cart: result.cart, ...(result.newToken && transport === 'header' ? { cartToken: result.newToken } : {}) });
  };
  const guard = (ctx: RequestContext): void => {
    if (transport === 'cookie') requireSameOrigin(ctx);
  };
  const id = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };

  return router
    .get(`${prefix}/currency`, async (ctx) => {
      const { preferred } = await owner(ctx);
      const suggested = currencyForCountry(country(deps, ctx));
      sendJson(ctx.res, 200, { currencies: await enabledCurrencies(deps.db), current: await fallback(ctx, preferred), suggested });
    })
    .get(`${prefix}/cart`, async (ctx) => {
      const { owner: o, preferred } = await owner(ctx);
      reply(ctx, await cart.readCart(deps, o, await fallback(ctx, preferred)));
    })
    .post(`${prefix}/cart/items`, async (ctx) => {
      guard(ctx);
      const { owner: o, preferred } = await owner(ctx);
      reply(ctx, await cart.addItem(deps, o, await readJson(ctx.req), await fallback(ctx, preferred)), 201);
    })
    .post(`${prefix}/cart/items/:id`, async (ctx) => {
      guard(ctx);
      reply(ctx, await cart.setQuantity(deps, (await owner(ctx)).owner, id(ctx), await readJson(ctx.req)));
    })
    .post(`${prefix}/cart/items/:id/delete`, async (ctx) => {
      guard(ctx);
      reply(ctx, await cart.setQuantity(deps, (await owner(ctx)).owner, id(ctx), { quantity: 0 }));
    })
    .post(`${prefix}/cart/currency`, async (ctx) => {
      guard(ctx);
      reply(ctx, await cart.setCurrency(deps, (await owner(ctx)).owner, await readJson(ctx.req)));
    })
    .post(`${prefix}/cart/discount`, async (ctx) => {
      guard(ctx);
      const { owner: o, preferred } = await owner(ctx);
      reply(ctx, await cart.applyCode(deps, o, await readJson(ctx.req), await fallback(ctx, preferred)));
    })
    .post(`${prefix}/cart/discount/delete`, async (ctx) => {
      guard(ctx);
      reply(ctx, await cart.removeCode(deps, (await owner(ctx)).owner));
    })
    .post(`${prefix}/cart/gift-cards`, async (ctx) => {
      guard(ctx);
      const { owner: o, preferred } = await owner(ctx);
      reply(ctx, await cart.applyGiftCard(deps, o, await readJson(ctx.req), clientIp(ctx.req, deps.config.trustProxy), await fallback(ctx, preferred)));
    })
    .post(`${prefix}/cart/gift-cards/:id/delete`, async (ctx) => {
      guard(ctx);
      reply(ctx, await cart.removeGiftCard(deps, (await owner(ctx)).owner, id(ctx)));
    });
}

export function adminCartRoutes(router: Router, deps: AccountDeps, options: { ratesUrl?: string; fetchRates?: RatesFetcher } = {}): Router {
  const meta = (ctx: RequestContext): { ip: string | null } => ({ ip: clientIp(ctx.req, deps.config.trustProxy) });
  const id = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };
  return router
    .get('/api/currencies', async (ctx) => {
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { currencies: await listCurrencySettings(deps.db, staff) });
    })
    .post('/api/currencies/refresh', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(deps, ctx);
      if (!staff.isOwner && !staff.permissions.settings.change) throw new ApiError(403, 'not_allowed', 'Your role does not allow this. Ask the store owner.');
      try {
        sendJson(ctx.res, 200, await refreshDailyRates(deps.db, options.ratesUrl ?? DEFAULT_RATES_URL, options.fetchRates ?? fetchRates, deps.now()));
      } catch (error) {
        throw new ApiError(502, 'rates_unavailable', `The daily rates could not be fetched just now (${error instanceof Error ? error.message : 'no answer'}). The current rates stay in place.`);
      }
    })
    .post('/api/currencies/:code', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, await updateCurrency(deps.db, staff, String(ctx.params.code ?? ''), await readJson(ctx.req), deps.now(), meta(ctx)));
    })
    .get('/api/discounts', async (ctx) => {
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { discounts: await discounts.listDiscounts(deps.db, staff) });
    })
    .post('/api/discounts', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 201, { discount: await discounts.saveDiscount(deps.db, staff, null, await readJson(ctx.req), deps.now(), meta(ctx)) });
    })
    .get('/api/discounts/:id', async (ctx) => {
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { discount: await discounts.readDiscount(deps.db, staff, id(ctx)) });
    })
    .post('/api/discounts/:id', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { discount: await discounts.saveDiscount(deps.db, staff, id(ctx), await readJson(ctx.req), deps.now(), meta(ctx)) });
    })
    .post('/api/discounts/:id/delete', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, await discounts.deleteDiscount(deps.db, staff, id(ctx), meta(ctx)));
    });
}

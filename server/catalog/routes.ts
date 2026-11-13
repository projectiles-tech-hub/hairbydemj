// The HTTP addresses for the catalogue.
//
//   Shop (hairbydemj.com /api/catalog/..., api.hairbydemj.com /v1/catalog/...)
//     Open to everyone, read-only: categories, collections, product lists
//     with filters, product pages, shop-the-look sets.
//   Admin (admin.hairbydemj.com /api/...)
//     Signed-in staff with the "products" permission: products, variants,
//     prices, stock, categories and collections.

import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { requireSameOrigin } from '../accounts/web.js';
import { ApiError, clientIp, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import { removeProductFiles, type MediaDeps } from '../media/media.js';
import * as manage from './manage.js';
import * as shop from './public.js';

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });

function list(query: URLSearchParams, name: string): string[] | undefined {
  const values = query.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean).slice(0, 50);
  return values.length ? values : undefined;
}

function wholeNumbers(query: URLSearchParams, name: string, min: number, max: number): number[] | undefined {
  return list(query, name)?.map((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw invalid(name, `Each ${name} must be a whole number from ${min} to ${max}.`);
    return n;
  });
}

function whole(query: URLSearchParams, name: string, min: number, max: number): number | undefined {
  const raw = query.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw invalid(name, `${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

function text(query: URLSearchParams, name: string, max = 120): string | undefined {
  const value = (query.get(name) ?? '').trim().slice(0, max);
  return value === '' ? undefined : value;
}

const MAX_MINOR = 9_000_000_000_000;

/** Read-only catalogue addresses for the website and the phone app. */
export function shopCatalogRoutes(router: Router, deps: shop.CatalogDeps, prefix: string): Router {
  return router
    .get(`${prefix}/categories`, async (ctx) => {
      sendJson(ctx.res, 200, { categories: await shop.listCategories(deps) });
    })
    .get(`${prefix}/collections`, async (ctx) => {
      sendJson(ctx.res, 200, { collections: await shop.listCollections(deps, { looks: ctx.query.get('looks') === '1' }) });
    })
    .get(`${prefix}/filters`, async (ctx) => {
      sendJson(ctx.res, 200, await shop.listFilters(deps, { currency: text(ctx.query, 'currency', 3) ?? '', category: text(ctx.query, 'category') }));
    })
    .get(`${prefix}/products`, async (ctx) => {
      const q = ctx.query;
      const sort = text(q, 'sort', 20);
      if (sort !== undefined && !(shop.SORTS as readonly string[]).includes(sort)) throw invalid('sort', `Sort by one of: ${shop.SORTS.join(', ')}.`);
      const page = await shop.listProducts(deps, {
        currency: text(q, 'currency', 3) ?? '',
        category: text(q, 'category'),
        collection: text(q, 'collection'),
        textures: list(q, 'texture'),
        origins: list(q, 'origin'),
        laceTypes: list(q, 'lace_type'),
        colours: list(q, 'colour'),
        lengths: wholeNumbers(q, 'length', 1, 60),
        densities: wholeNumbers(q, 'density', 50, 400),
        minPriceMinor: whole(q, 'min_price', 0, MAX_MINOR),
        maxPriceMinor: whole(q, 'max_price', 0, MAX_MINOR),
        inStock: q.get('in_stock') === '1',
        sort: sort as shop.Sort | undefined,
        cursor: text(q, 'cursor', 400),
        limit: whole(q, 'limit', 1, shop.PAGE_SIZE.max),
      });
      sendJson(ctx.res, 200, page);
    })
    .get(`${prefix}/products/:slug`, async (ctx) => {
      sendJson(ctx.res, 200, { product: await shop.getProduct(deps, ctx.params.slug ?? '', text(ctx.query, 'currency', 3) ?? '') });
    })
    .get(`${prefix}/looks/:slug`, async (ctx) => {
      sendJson(ctx.res, 200, { look: await shop.getLook(deps, ctx.params.slug ?? '', text(ctx.query, 'currency', 3) ?? '') });
    });
}

function id(ctx: RequestContext): number {
  const n = Number(ctx.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
  return n;
}

/** Catalogue management for signed-in staff, on the admin address. */
export function adminCatalogRoutes(router: Router, deps: AccountDeps, media?: MediaDeps): Router {
  const meta = (ctx: RequestContext): { ip: string | null } => ({ ip: clientIp(ctx.req, deps.config.trustProxy) });
  /** A request that only reads. */
  const read = <T>(work: (actor: manage.Actor, ctx: RequestContext) => Promise<T>, key?: string) => async (ctx: RequestContext): Promise<void> => {
    const { staff } = await requireStaff(deps, ctx);
    const result = await work(staff, ctx);
    sendJson(ctx.res, 200, key ? { [key]: result } : result);
  };
  /** A request that changes something: same-origin check, sign-in, then the JSON body. */
  const change = <T>(status: number, work: (actor: manage.Actor, ctx: RequestContext, input: Record<string, unknown>) => Promise<T>, key?: string) => async (ctx: RequestContext): Promise<void> => {
    requireSameOrigin(ctx);
    const { staff } = await requireStaff(deps, ctx);
    const result = await work(staff, ctx, await readJson(ctx.req, 256 * 1024));
    sendJson(ctx.res, status, key ? { [key]: result } : (result ?? { ok: true }));
  };

  return router
    // products
    .get('/api/products', read((actor, ctx) => {
      const stock = text(ctx.query, 'stock', 4);
      if (stock !== undefined && stock !== 'in' && stock !== 'low' && stock !== 'out') throw invalid('stock', 'Stock must be in, low or out.');
      return manage.listAdminProducts(deps, actor, { q: text(ctx.query, 'q'), status: text(ctx.query, 'status', 20), categoryId: whole(ctx.query, 'category_id', 1, Number.MAX_SAFE_INTEGER), stock, texture: text(ctx.query, 'texture'), origin: text(ctx.query, 'origin'), page: whole(ctx.query, 'page', 1, 100_000), perPage: whole(ctx.query, 'per_page', 1, 100) });
    }))
    .post('/api/products', change(201, (actor, ctx, input) => manage.createProduct(deps, actor, input, meta(ctx)), 'product'))
    .get('/api/products/:id', read((actor, ctx) => manage.readProduct(deps, actor, id(ctx)), 'product'))
    .post('/api/products/:id', change(200, (actor, ctx, input) => manage.updateProduct(deps, actor, id(ctx), input, meta(ctx)), 'product'))
    .post('/api/products/:id/delete', change(200, async (actor, ctx) => {
      const result = await manage.deleteProduct(deps, actor, id(ctx), meta(ctx));
      // A deleted product's photos and videos go with it.
      if (result.deleted && media) await removeProductFiles(media, id(ctx));
      return result;
    }))
    // variants and prices
    .post('/api/products/:id/variants', change(201, (actor, ctx, input) => manage.createVariant(deps, actor, id(ctx), input, meta(ctx)), 'product'))
    .post('/api/products/:id/variants/generate', change(201, (actor, ctx, input) => manage.generateVariants(deps, actor, id(ctx), input, meta(ctx))))
    .post('/api/variants/:id', change(200, (actor, ctx, input) => manage.updateVariant(deps, actor, id(ctx), input, meta(ctx)), 'product'))
    .post('/api/variants/:id/delete', change(200, (actor, ctx) => manage.deleteVariant(deps, actor, id(ctx), meta(ctx))))
    // stock
    .get('/api/inventory', read((actor, ctx) => manage.listInventory(deps, actor, { lowOnly: ctx.query.get('low') === '1', categoryId: whole(ctx.query, 'category_id', 1, Number.MAX_SAFE_INTEGER), q: text(ctx.query, 'q'), page: whole(ctx.query, 'page', 1, 100_000), perPage: whole(ctx.query, 'per_page', 1, 100) })))
    .post('/api/inventory/:id/adjust', change(200, (actor, ctx, input) => manage.adjustStock(deps, actor, id(ctx), input, meta(ctx))))
    // categories
    .get('/api/categories', read((actor) => manage.listAdminCategories(deps, actor), 'categories'))
    .post('/api/categories', change(201, (actor, ctx, input) => manage.saveCategory(deps, actor, null, input, meta(ctx))))
    .post('/api/categories/:id', change(200, (actor, ctx, input) => manage.saveCategory(deps, actor, id(ctx), input, meta(ctx))))
    .post('/api/categories/:id/delete', change(200, async (actor, ctx) => {
      await manage.deleteCategory(deps, actor, id(ctx), meta(ctx));
    }))
    // collections and shop-the-look sets
    .get('/api/collections', read((actor) => manage.listAdminCollections(deps, actor), 'collections'))
    .post('/api/collections', change(201, (actor, ctx, input) => manage.saveCollection(deps, actor, null, input, meta(ctx)), 'collection'))
    .get('/api/collections/:id', read((actor, ctx) => manage.readCollection(deps, actor, id(ctx)), 'collection'))
    .post('/api/collections/:id', change(200, (actor, ctx, input) => manage.saveCollection(deps, actor, id(ctx), input, meta(ctx)), 'collection'))
    .post('/api/collections/:id/delete', change(200, async (actor, ctx) => {
      await manage.deleteCollection(deps, actor, id(ctx), meta(ctx));
    }));
}

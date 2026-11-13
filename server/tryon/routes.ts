// The HTTP addresses for try-on pictures.
//
//   Admin (admin.hairbydemj.com), staff who may change products:
//     POST /api/products/:id/try-on?colour=&leftX=&leftY=&rightX=&rightY=
//       The body is the PNG itself (not a form). Placement values are
//       optional; the template's are used when left out.
//     GET  /api/products/:id/try-on
//     POST /api/try-on/:id/delete
//   Shop (hairbydemj.com /api/catalog/try-on, api.hairbydemj.com /v1/catalog/try-on)
//     GET  .../try-on?currency=   products that can be tried on, with their pictures

import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { pickCurrency } from '../cart/money.js';
import { ApiError, clientIp, sendJson, type RequestContext } from '../http.js';
import { receiveUpload, type MediaDeps } from '../media/media.js';
import type { Router } from '../router.js';
import { addTryOn, listTryOn, removeTryOn, TRY_ON, tryOnProducts } from './tryon.js';

function id(ctx: RequestContext): number {
  const n = Number(ctx.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
  return n;
}

export function adminTryOnRoutes(router: Router, accounts: AccountDeps, deps: MediaDeps): Router {
  return router
    .post('/api/products/:id/try-on', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'products', 'change');
      const upload = await receiveUpload(deps, ctx.req, TRY_ON.maxBytes);
      const q = ctx.query;
      const image = await addTryOn(deps, staff, id(ctx), upload, { colour: q.get('colour'), leftX: q.get('leftX'), leftY: q.get('leftY'), rightX: q.get('rightX'), rightY: q.get('rightY') }, clientIp(ctx.req, accounts.config.trustProxy));
      sendJson(ctx.res, 201, { tryOn: image });
    })
    .get('/api/products/:id/try-on', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'products', 'view');
      sendJson(ctx.res, 200, { tryOn: await listTryOn(deps.db, id(ctx)) });
    })
    .post('/api/try-on/:id/delete', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      await removeTryOn(deps, staff, id(ctx), clientIp(ctx.req, accounts.config.trustProxy));
      sendJson(ctx.res, 200, { removed: true });
    });
}

export function shopTryOnRoutes(router: Router, accounts: AccountDeps, prefix: string): Router {
  return router.get(`${prefix}/try-on`, async (ctx) => {
    const currency = await pickCurrency(accounts.db, [ctx.query.get('currency')?.toUpperCase()]);
    sendJson(ctx.res, 200, { products: await tryOnProducts(accounts.db, currency, accounts.now()) });
  });
}

// The HTTP addresses for product photos and videos, on the admin address.
//
//   POST /api/products/:id/media?alt=...&colour=...&name=...
//     The body is the file itself (not a form). Photos answer 201 when ready;
//     videos answer 202 and are compressed afterwards.
//   GET  /api/products/:id/media          the product's photos and video
//   POST /api/products/:id/media/order    { ids: [...] } in the new order
//   POST /api/media/:id                   { alt, colour }
//   POST /api/media/:id/delete
//
// The files themselves are served to everyone under /media/ on every address.

import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { ApiError, clientIp, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import * as media from './media.js';

function id(ctx: RequestContext): number {
  const n = Number(ctx.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
  return n;
}

export function mediaRoutes(router: Router, accounts: AccountDeps, deps: media.MediaDeps): Router {
  const meta = (ctx: RequestContext): { ip: string | null } => ({ ip: clientIp(ctx.req, accounts.config.trustProxy) });
  return router
    .post('/api/products/:id/media', async (ctx) => {
      // Who is asking is settled before a single byte of the file is accepted.
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'products', 'change');
      const upload = await media.receiveUpload(deps, ctx.req, media.MEDIA.maxVideoBytes);
      const item = await media.addProductMedia(deps, staff, id(ctx), { ...upload, name: ctx.query.get('name') }, { alt: ctx.query.get('alt') ?? '', colour: ctx.query.get('colour') ?? '' }, meta(ctx));
      sendJson(ctx.res, item.status === 'ready' ? 201 : 202, { media: item });
      if (item.status === 'processing') {
        media.processPending(deps).catch((error: unknown) => deps.logger.error('media processing stopped', { error }));
      }
    })
    .get('/api/products/:id/media', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      sendJson(ctx.res, 200, { media: await media.listProductMedia(deps, staff, id(ctx)) });
    })
    .post('/api/products/:id/media/order', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      sendJson(ctx.res, 200, { media: await media.orderProductMedia(deps, staff, id(ctx), await readJson(ctx.req), meta(ctx)) });
    })
    .post('/api/media/:id', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      sendJson(ctx.res, 200, { media: await media.updateMedia(deps, staff, id(ctx), await readJson(ctx.req), meta(ctx)) });
    })
    .post('/api/media/:id/delete', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      await media.deleteMedia(deps, staff, id(ctx), meta(ctx));
      sendJson(ctx.res, 200, { ok: true });
    });
}

// HTTP addresses for loyalty points, reviews and gift cards (module 17).
//
//   Shop (hairbydemj.com /api..., api.hairbydemj.com /v1...):
//     GET  .../account/loyalty                  points, tier, referral code, history
//     GET  .../catalog/products/:slug/reviews   published reviews and the average
//     GET  .../account/reviews                  my reviews, and items I can review
//     POST .../reviews                          { orderItemId, rating, body }
//     POST .../reviews/:id/photos               the photo itself (not a form)
//     POST .../gift-cards/buy                   { amountMinor, currency, recipientEmail, recipientName, fromName, message, deliverOn, email }
//     POST .../gift-cards/balance               { code }
//   Admin (admin.hairbydemj.com):
//     GET/POST /api/settings/loyalty            the point rules (discounts)
//     POST /api/loyalty/tiers                    { tiers: [{ code, name, minPoints, benefit }] } (discounts)
//     POST /api/customers/:id/points             { points, note } (customers)
//     GET  /api/reviews?status=                  (products view)
//     POST /api/reviews/:id                      { status, reply } (products change)
//     GET  /api/gift-cards?q=&status=&page=      (discounts view)
//     POST /api/gift-cards                       { amountMinor, currency, recipientEmail, recipientName, reason, message } (discounts change)
//     POST /api/gift-cards/:id/disable, /enable  (discounts change)

import type { AccountDeps } from '../accounts/deps.js';
import { checkAttempts, recordAttempt } from '../accounts/guard.js';
import { currentCustomer, requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { buyGiftCard, giftCardBalance, issueGiftCard, listGiftCards, setGiftCardActive } from '../giftcards/giftcards.js';
import { ApiError, clientIp, readJson, sendJson, type RequestContext } from '../http.js';
import { receiveUpload, type MediaDeps } from '../media/media.js';
import { addReviewPhoto, itemsToReview, listReviews, moderateReview, myReviews, productReviews, REVIEWS, writeReview } from '../reviews/reviews.js';
import type { Router } from '../router.js';
import { adjustPoints, listTiers, loyaltySettings, loyaltyView, saveLoyaltySettings } from './loyalty.js';

const idOf = (ctx: RequestContext): number => {
  const n = Number(ctx.params.id);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
  return n;
};

export function shopLoyaltyRoutes(router: Router, deps: AccountDeps, media: MediaDeps | undefined, prefix: string, catalogPrefix: string, transport: 'cookie' | 'bearer'): Router {
  const who = async (ctx: RequestContext): Promise<number> => {
    const signedIn = await currentCustomer(deps, ctx, transport);
    if (!signedIn) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
    return signedIn.customer.id;
  };
  const guard = (ctx: RequestContext): void => {
    if (transport === 'cookie') requireSameOrigin(ctx);
  };
  return router
    .get(`${prefix}/account/loyalty`, async (ctx) => {
      sendJson(ctx.res, 200, { loyalty: await loyaltyView(deps.db, await who(ctx), deps.now()), tiers: await listTiers(deps.db) });
    })
    .get(`${catalogPrefix}/products/:slug/reviews`, async (ctx) => {
      sendJson(ctx.res, 200, await productReviews(deps.db, String(ctx.params.slug), Number(ctx.query.get('page')) || 1));
    })
    .get(`${prefix}/account/reviews`, async (ctx) => {
      const id = await who(ctx);
      sendJson(ctx.res, 200, { reviews: await myReviews(deps.db, id), toReview: await itemsToReview(deps.db, id) });
    })
    .post(`${prefix}/reviews`, async (ctx) => {
      guard(ctx);
      const id = await who(ctx);
      sendJson(ctx.res, 201, { review: await writeReview(deps.db, id, await readJson(ctx.req)) });
    })
    .post(`${prefix}/reviews/:id/photos`, async (ctx) => {
      guard(ctx);
      const id = await who(ctx);
      if (!media) throw new ApiError(503, 'unavailable', 'Photos cannot be added just now.');
      const upload = await receiveUpload(media, ctx.req, REVIEWS.maxPhotoBytes);
      sendJson(ctx.res, 201, { review: await addReviewPhoto(media, id, idOf(ctx), upload) });
    })
    .post(`${prefix}/gift-cards/buy`, async (ctx) => {
      guard(ctx);
      const signedIn = await currentCustomer(deps, ctx, transport);
      const placed = await buyGiftCard(deps, signedIn?.customer.id ?? null, await readJson(ctx.req), transport === 'cookie' ? 'web' : 'app');
      sendJson(ctx.res, 201, placed);
    })
    .post(`${prefix}/gift-cards/balance`, async (ctx) => {
      guard(ctx);
      const ip = clientIp(ctx.req, deps.config.trustProxy);
      const subject = `balance:${ip ?? 'unknown'}`;
      await checkAttempts(deps.db, 'gift_card', subject, ip);
      const input = await readJson(ctx.req);
      try {
        const card = await giftCardBalance(deps.db, input.code, deps.now());
        await recordAttempt(deps.db, 'gift_card', subject, ip, true);
        sendJson(ctx.res, 200, { card });
      } catch (error) {
        await recordAttempt(deps.db, 'gift_card', subject, ip, false);
        throw error;
      }
    });
}

export function adminLoyaltyRoutes(router: Router, deps: AccountDeps): Router {
  const ip = (ctx: RequestContext): string | null => clientIp(ctx.req, deps.config.trustProxy);
  const staffOf = async (ctx: RequestContext) => {
    if (ctx.req.method === 'POST') requireSameOrigin(ctx);
    return (await requireStaff(deps, ctx)).staff;
  };
  return router
    .get('/api/settings/loyalty', async (ctx) => {
      const staff = await staffOf(ctx);
      requireAccess(staff, 'discounts', 'view');
      sendJson(ctx.res, 200, { rules: await loyaltySettings(deps.db), tiers: await listTiers(deps.db) });
    })
    .post('/api/settings/loyalty', async (ctx) => {
      const staff = await staffOf(ctx);
      sendJson(ctx.res, 200, { rules: await saveLoyaltySettings(deps.db, staff, await readJson(ctx.req), ip(ctx)) });
    })
    .post('/api/loyalty/tiers', async (ctx) => {
      const staff = await staffOf(ctx);
      requireAccess(staff, 'discounts', 'change');
      const input = await readJson(ctx.req);
      const tiers = Array.isArray(input.tiers) ? (input.tiers as Array<Record<string, unknown>>) : [];
      for (const [i, t] of tiers.entries()) {
        const code = String(t.code ?? '');
        const min = Number(t.minPoints);
        const name = typeof t.name === 'string' ? t.name.trim().slice(0, 40) : '';
        if (!name || !Number.isInteger(min) || min < 0) throw new ApiError(422, 'invalid', 'Check the details and try again.', { [`tiers.${i}`]: 'Give each tier a name and the points needed.' });
        const updated = await deps.db.query('update loyalty_tiers set name = $2, min_points = $3, benefit = $4 where code = $1', [code, name, code === 'bronze' ? 0 : min, typeof t.benefit === 'string' ? t.benefit.slice(0, 200) : '']);
        if (!updated.rowCount) throw new ApiError(404, 'not_found', `There is no tier ${code}.`);
      }
      await logActivity(deps.db, staff, 'discounts', 'Changed the loyalty tiers', undefined, ip(ctx));
      sendJson(ctx.res, 200, { tiers: await listTiers(deps.db) });
    })
    .post('/api/customers/:id/points', async (ctx) => {
      const staff = await staffOf(ctx);
      sendJson(ctx.res, 200, { moved: await adjustPoints(deps.db, staff, idOf(ctx), await readJson(ctx.req), ip(ctx), deps.now()) });
    })
    .get('/api/reviews', async (ctx) => {
      sendJson(ctx.res, 200, await listReviews(deps.db, await staffOf(ctx), ctx.query));
    })
    .post('/api/reviews/:id', async (ctx) => {
      const staff = await staffOf(ctx);
      sendJson(ctx.res, 200, { review: await moderateReview(deps, staff, idOf(ctx), await readJson(ctx.req), ip(ctx)) });
    })
    .get('/api/gift-cards', async (ctx) => {
      sendJson(ctx.res, 200, await listGiftCards(deps.db, await staffOf(ctx), ctx.query));
    })
    .post('/api/gift-cards', async (ctx) => {
      const staff = await staffOf(ctx);
      sendJson(ctx.res, 201, { card: await issueGiftCard(deps, staff, await readJson(ctx.req), ip(ctx)) });
    })
    .post('/api/gift-cards/:id/disable', async (ctx) => {
      const staff = await staffOf(ctx);
      await setGiftCardActive(deps.db, staff, idOf(ctx), false, ip(ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post('/api/gift-cards/:id/enable', async (ctx) => {
      const staff = await staffOf(ctx);
      await setGiftCardActive(deps.db, staff, idOf(ctx), true, ip(ctx));
      sendJson(ctx.res, 200, { ok: true });
    });
}

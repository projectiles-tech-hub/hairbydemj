// The HTTP addresses for delivery.
//
//   Customers (website /api, app /v1):
//     POST /shipping/quote             { address } → delivery options for the bag, kept 30 minutes
//     GET  /orders/:number/tracking    where the parcels are (own order, or a guest with the order token)
//   Staff (admin):
//     GET  /api/shipping/origin              the store's address on labels   (settings view)
//     POST /api/shipping/origin              change it                       (settings change)
//     GET  /api/shipping/carriers            DHL, UPS, FedEx: on or off, set up, test or live
//     POST /api/shipping/carriers/:code      { enabled, markupBps, services }
//     GET  /api/shipping/local-rates         zones inside Nigeria
//     POST /api/shipping/local-rates         add a zone; POST .../:id to change; POST .../:id/delete
//     GET  /api/shipping/package-sizes       our boxes; POST to add, .../:id to change, .../:id/delete
//     GET  /api/orders/:id/shipments         an order's parcels and their tracking   (orders view)
//     POST /api/orders/:id/label             buy the carrier label                   (orders change)
//     POST /api/orders/:id/dispatch          record a local courier dispatch          (orders change)
//     GET  /api/shipments/:id/label?parcel=1 download a label to print               (orders view)
//     POST /api/shipments/:id/track          ask the carrier now                     (orders view)
//     POST /api/shipments/:id/delivered      a local delivery arrived                (orders change)

import { join } from 'node:path';
import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess, type Area, type StaffMember } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { cartById, priceCart, resolveCart } from '../cart/cart.js';
import { cartOwner } from '../cart/routes.js';
import { ApiError, clientIp, readJson, sendJson, type RequestContext } from '../http.js';
import type { Logger } from '../logger.js';
import { ownOrder } from '../payments/routes.js';
import type { Router } from '../router.js';
import { dhl, fedex, ups } from './carriers.js';
import * as manage from './manage.js';
import { buyLabel, labelFile, listPackageSizes, markDelivered, orderShipments, quoteForCart, readShipFrom, recordLocalDispatch, refreshTracking, saveShipFrom, type ShippingDeps } from './shipping.js';

export function shippingDeps(accounts: AccountDeps, logger: Logger): ShippingDeps {
  const c = accounts.config.carriers;
  return {
    db: accounts.db,
    now: accounts.now,
    logger,
    carriers: { dhl: dhl(c.dhl), ups: ups(c.ups), fedex: fedex(c.fedex) },
    labelDir: join(accounts.config.mediaDir, 'private', 'labels'),
  };
}

export function shopShippingRoutes(router: Router, accounts: AccountDeps, deps: ShippingDeps, prefix: string, transport: 'cookie' | 'bearer'): Router {
  return router
    .post(`${prefix}/shipping/quote`, async (ctx) => {
      if (transport === 'cookie') requireSameOrigin(ctx);
      const input = await readJson(ctx.req);
      const owner = await cartOwner(accounts, ctx, transport === 'cookie' ? 'cookie' : 'header');
      const row = await resolveCart(accounts, owner);
      if (!row) throw new ApiError(422, 'cart_not_ready', 'Your bag is empty.');
      const cart = await priceCart(accounts, (await cartById(accounts.db, row.id)) ?? row, { customerId: owner.customerId, email: null });
      sendJson(ctx.res, 200, { quote: await quoteForCart(deps, cart, input.address) });
    })
    .get(`${prefix}/orders/:number/tracking`, async (ctx) => {
      const orderId = await ownOrder(accounts, ctx, transport);
      sendJson(ctx.res, 200, { shipments: await orderShipments(accounts.db, orderId) });
    });
}

export function adminShippingRoutes(router: Router, accounts: AccountDeps, deps: ShippingDeps): Router {
  const staffFor = async (ctx: RequestContext, area: Area, access: 'view' | 'change'): Promise<StaffMember> => {
    if (ctx.req.method === 'POST') requireSameOrigin(ctx);
    const { staff } = await requireStaff(accounts, ctx);
    requireAccess(staff, area, access);
    return staff;
  };
  const id = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };
  const log = (ctx: RequestContext, staff: StaffMember, summary: string, entity?: { type: string; id: number | string }): Promise<void> =>
    logActivity(accounts.db, staff, 'Shipping', summary, entity, clientIp(ctx.req, accounts.config.trustProxy));
  const orderNumber = async (orderId: number): Promise<string> => String((await accounts.db.query('select number from orders where id = $1', [orderId])).rows[0]?.number ?? orderId);

  return router
    .get('/api/shipping/origin', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { origin: await readShipFrom(accounts.db) });
    })
    .post('/api/shipping/origin', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const origin = await saveShipFrom(accounts.db, await readJson(ctx.req), staff.id);
      await log(ctx, staff, 'Changed the store address used on labels');
      sendJson(ctx.res, 200, { origin });
    })
    .get('/api/shipping/carriers', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { carriers: await manage.listCarriers(accounts.db, deps.carriers) });
    })
    .post('/api/shipping/carriers/:code', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const { name } = await manage.updateCarrier(accounts.db, deps.carriers, String(ctx.params.code), await readJson(ctx.req));
      await log(ctx, staff, `Changed ${name} delivery settings`);
      sendJson(ctx.res, 200, { carriers: await manage.listCarriers(accounts.db, deps.carriers) });
    })
    .get('/api/shipping/local-rates', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, await manage.listLocalRates(accounts.db));
    })
    .post('/api/shipping/local-rates', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const rate = await manage.createLocalRate(accounts.db, await readJson(ctx.req));
      await log(ctx, staff, `Added the delivery zone "${rate.zoneName}"`, { type: 'local_rate', id: rate.id });
      sendJson(ctx.res, 201, await manage.listLocalRates(accounts.db));
    })
    .post('/api/shipping/local-rates/:id', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await manage.updateLocalRate(accounts.db, id(ctx), await readJson(ctx.req));
      await log(ctx, staff, 'Changed a delivery zone', { type: 'local_rate', id: id(ctx) });
      sendJson(ctx.res, 200, await manage.listLocalRates(accounts.db));
    })
    .post('/api/shipping/local-rates/:id/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await manage.deleteLocalRate(accounts.db, id(ctx));
      await log(ctx, staff, 'Removed a delivery zone', { type: 'local_rate', id: id(ctx) });
      sendJson(ctx.res, 200, await manage.listLocalRates(accounts.db));
    })
    .get('/api/shipping/package-sizes', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { packageSizes: await listPackageSizes(accounts.db) });
    })
    .post('/api/shipping/package-sizes', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      const made = await manage.createPackageSize(accounts.db, await readJson(ctx.req));
      await log(ctx, staff, 'Added a box size', { type: 'package_size', id: made.id });
      sendJson(ctx.res, 201, made);
    })
    .post('/api/shipping/package-sizes/:id', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await manage.updatePackageSize(accounts.db, id(ctx), await readJson(ctx.req));
      await log(ctx, staff, 'Changed a box size', { type: 'package_size', id: id(ctx) });
      sendJson(ctx.res, 200, { id: id(ctx) });
    })
    .post('/api/shipping/package-sizes/:id/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await manage.deletePackageSize(accounts.db, id(ctx));
      await log(ctx, staff, 'Removed a box size', { type: 'package_size', id: id(ctx) });
      sendJson(ctx.res, 200, { deleted: true });
    })
    .get('/api/orders/:id/shipments', async (ctx) => {
      await staffFor(ctx, 'orders', 'view');
      sendJson(ctx.res, 200, { shipments: await orderShipments(accounts.db, id(ctx)) });
    })
    .post('/api/orders/:id/label', async (ctx) => {
      const staff = await staffFor(ctx, 'orders', 'change');
      const result = await buyLabel(deps, id(ctx), staff.id);
      if (result.created) await log(ctx, staff, `Bought a label for ${await orderNumber(id(ctx))}`, { type: 'order', id: id(ctx) });
      sendJson(ctx.res, result.created ? 201 : 200, { ...result, shipments: await orderShipments(accounts.db, id(ctx)) });
    })
    .post('/api/orders/:id/dispatch', async (ctx) => {
      const staff = await staffFor(ctx, 'orders', 'change');
      const result = await recordLocalDispatch(deps, id(ctx), await readJson(ctx.req), staff.id);
      await log(ctx, staff, `Sent ${await orderNumber(id(ctx))} by local courier`, { type: 'order', id: id(ctx) });
      sendJson(ctx.res, 201, { ...result, shipments: await orderShipments(accounts.db, id(ctx)) });
    })
    .get('/api/shipments/:id/label', async (ctx) => {
      await staffFor(ctx, 'orders', 'view');
      const parcel = Number(ctx.query.get('parcel') ?? '1');
      const file = await labelFile(deps, id(ctx), Number.isInteger(parcel) && parcel > 0 ? parcel - 1 : 0);
      const types: Record<string, string> = { pdf: 'application/pdf', gif: 'image/gif', png: 'image/png', zpl: 'application/octet-stream' };
      ctx.res.writeHead(200, {
        'Content-Type': types[file.format] ?? 'application/octet-stream',
        'Content-Length': String(file.data.length),
        'Content-Disposition': `inline; filename="${file.name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : file.data);
    })
    .post('/api/shipments/:id/track', async (ctx) => {
      await staffFor(ctx, 'orders', 'view');
      sendJson(ctx.res, 200, await refreshTracking(deps, id(ctx)));
    })
    .post('/api/shipments/:id/delivered', async (ctx) => {
      const staff = await staffFor(ctx, 'orders', 'change');
      await markDelivered(deps, id(ctx), staff.id);
      await log(ctx, staff, 'Marked a local delivery as arrived', { type: 'shipment', id: id(ctx) });
      sendJson(ctx.res, 200, { delivered: true });
    });
}

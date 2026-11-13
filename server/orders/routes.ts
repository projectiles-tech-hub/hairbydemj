// The HTTP addresses for checkout, orders and returns.
//
//   Customers (website /api with cookies, app /v1 with the bearer token):
//     POST /checkout                          the bag becomes an order; answers with the order token once
//     GET  /orders                            a signed-in customer's orders (?page=)
//     POST /orders/lookup                     { number, email } a guest finds an order
//     GET  /orders/:number                    one order (own order, or the X-Order-Token header / ?token=)
//     POST /orders/:number/cancel             give up on an unpaid order
//     GET  /orders/:number/invoice            printable invoice (paid orders)
//     POST /orders/:number/returns            { items: [{ orderItemId, quantity, reason }], resolution, note }
//     POST /orders/:number/returns/:id/cancel withdraw a return still waiting for a decision
//   Staff (admin):
//     GET  /api/orders                        list with filters: status, payment, q, from, to, page   (orders view)
//     GET  /api/orders/:id                    everything about an order                               (orders view)
//     GET  /api/orders/:id/invoice            printable invoice                                       (orders view)
//     POST /api/orders/:id/notes              { note } staff-only note                                (orders change)
//     POST /api/orders/:id/address            correct the delivery address before dispatch            (orders change)
//     POST /api/orders/:id/cancel             { reason } cancel before dispatch, refunding payments   (orders change)
//     GET  /api/returns                       ?status=                                                (returns view)
//     GET  /api/returns/:id                                                                           (returns view)
//     POST /api/returns/:id/decide            { decision: approve | reject, note, trackingNumber }    (returns change)
//     POST /api/returns/:id/receive           { conditionNote, restock: [orderItemId] }               (returns change)
//     POST /api/returns/:id/refund            { includesShipping }                                    (returns change)
//     GET  /api/settings/returns, POST same   return window and store credit bonus                   (settings)

import type { AccountDeps } from '../accounts/deps.js';
import { currentCustomer, requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess, type Area, type StaffMember } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { cartOwner } from '../cart/routes.js';
import { ApiError, clientIp, readJson, sendHtml, sendJson, type RequestContext } from '../http.js';
import type { Logger } from '../logger.js';
import type { PaymentDeps } from '../payments/payments.js';
import { ownOrder } from '../payments/routes.js';
import type { Router } from '../router.js';
import { placeOrder, type OrderDeps } from './checkout.js';
import { addNote, changeAddress, customerCancel, customerOrders, invoiceHtml, lookUpOrder, orderView, returnSettings, staffCancel, staffOrderList } from './orders.js';
import { cancelReturn, decideReturn, listReturns, receiveReturn, refundReturn, requestReturn, returnView, saveReturnSettings } from './returns.js';

export function orderDeps(accounts: AccountDeps, logger: Logger): OrderDeps {
  return { db: accounts.db, now: accounts.now, logger, mail: accounts.mail };
}

const INVOICE_HEADERS = { 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" };

export function shopOrderRoutes(router: Router, accounts: AccountDeps, deps: OrderDeps, prefix: string, transport: 'cookie' | 'bearer'): Router {
  const guard = (ctx: RequestContext): void => {
    if (transport === 'cookie') requireSameOrigin(ctx);
  };
  return router
    .post(`${prefix}/checkout`, async (ctx) => {
      guard(ctx);
      const input = await readJson(ctx.req);
      const owner = await cartOwner(accounts, ctx, transport === 'cookie' ? 'cookie' : 'header');
      const placed = await placeOrder(deps, owner, input, transport === 'cookie' ? 'web' : 'app');
      sendJson(ctx.res, 201, { order: await orderView(deps.db, placed.orderId, deps.now(), 'customer'), orderToken: placed.orderToken, amountDueMinor: placed.amountDueMinor });
    })
    .get(`${prefix}/orders`, async (ctx) => {
      const signedIn = await currentCustomer(accounts, ctx, transport);
      if (!signedIn) throw new ApiError(401, 'signed_out', 'Sign in to see your orders.');
      const page = Math.max(1, Math.min(1000, Number(ctx.query.get('page')) || 1));
      sendJson(ctx.res, 200, await customerOrders(deps.db, signedIn.customer.id, page));
    })
    .post(`${prefix}/orders/lookup`, async (ctx) => {
      guard(ctx);
      sendJson(ctx.res, 200, { order: await lookUpOrder(deps.db, await readJson(ctx.req), clientIp(ctx.req, accounts.config.trustProxy), deps.now()) });
    })
    .get(`${prefix}/orders/:number`, async (ctx) => {
      const id = await ownOrder(accounts, ctx, transport);
      sendJson(ctx.res, 200, { order: await orderView(deps.db, id, deps.now(), 'customer') });
    })
    .post(`${prefix}/orders/:number/cancel`, async (ctx) => {
      guard(ctx);
      const id = await ownOrder(accounts, ctx, transport);
      await customerCancel(deps, id);
      sendJson(ctx.res, 200, { order: await orderView(deps.db, id, deps.now(), 'customer') });
    })
    .get(`${prefix}/orders/:number/invoice`, async (ctx) => {
      const id = await ownOrder(accounts, ctx, transport);
      sendHtml(ctx.res, 200, await invoiceHtml(deps.db, id, deps.now()), INVOICE_HEADERS);
    })
    .post(`${prefix}/orders/:number/returns`, async (ctx) => {
      guard(ctx);
      const id = await ownOrder(accounts, ctx, transport);
      const signedIn = await currentCustomer(accounts, ctx, transport);
      sendJson(ctx.res, 201, { return: await requestReturn(deps, id, signedIn?.customer.id ?? null, await readJson(ctx.req)) });
    })
    .post(`${prefix}/orders/:number/returns/:id/cancel`, async (ctx) => {
      guard(ctx);
      const orderId = await ownOrder(accounts, ctx, transport);
      const returnId = Number(ctx.params.id);
      const view = Number.isInteger(returnId) && returnId > 0 ? await returnView(deps.db, returnId).catch(() => null) : null;
      if (!view || view.orderId !== orderId) throw new ApiError(404, 'not_found', 'We could not find that return.');
      await cancelReturn(deps, returnId);
      sendJson(ctx.res, 200, { return: await returnView(deps.db, returnId) });
    });
}

export function adminOrderRoutes(router: Router, accounts: AccountDeps, deps: OrderDeps, payments: PaymentDeps): Router {
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
  const log = async (ctx: RequestContext, staff: StaffMember, area: string, summary: string, entity: { type: string; id: number }): Promise<void> =>
    logActivity(accounts.db, staff, area, summary, entity, clientIp(ctx.req, accounts.config.trustProxy));
  const number = async (orderId: number): Promise<string> => String((await deps.db.query('select number from orders where id = $1', [orderId])).rows[0]?.number ?? orderId);

  return router
    .get('/api/orders', async (ctx) => {
      await staffFor(ctx, 'orders', 'view');
      sendJson(ctx.res, 200, await staffOrderList(deps.db, ctx.query));
    })
    .get('/api/orders/:id', async (ctx) => {
      await staffFor(ctx, 'orders', 'view');
      const view = await orderView(deps.db, id(ctx), deps.now(), 'staff');
      const customer = await deps.db.query('select c.id, c.email, c.first_name, c.last_name, (select count(*)::int from orders where customer_id = c.id) as orders from orders o join customers c on c.id = o.customer_id where o.id = $1', [id(ctx)]);
      const c = customer.rows[0];
      sendJson(ctx.res, 200, { order: view, customer: c ? { id: Number(c.id), email: c.email, name: `${String(c.first_name ?? '')} ${String(c.last_name ?? '')}`.trim(), orderCount: c.orders } : null });
    })
    .get('/api/orders/:id/invoice', async (ctx) => {
      await staffFor(ctx, 'orders', 'view');
      sendHtml(ctx.res, 200, await invoiceHtml(deps.db, id(ctx), deps.now()), INVOICE_HEADERS);
    })
    .post('/api/orders/:id/notes', async (ctx) => {
      const staff = await staffFor(ctx, 'orders', 'change');
      await addNote(deps.db, id(ctx), await readJson(ctx.req), staff.id);
      sendJson(ctx.res, 201, { order: await orderView(deps.db, id(ctx), deps.now(), 'staff') });
    })
    .post('/api/orders/:id/address', async (ctx) => {
      const staff = await staffFor(ctx, 'orders', 'change');
      await changeAddress(deps.db, id(ctx), await readJson(ctx.req), staff.id);
      await log(ctx, staff, 'Orders', `Changed the delivery address of ${await number(id(ctx))}`, { type: 'order', id: id(ctx) });
      sendJson(ctx.res, 200, { order: await orderView(deps.db, id(ctx), deps.now(), 'staff') });
    })
    .post('/api/orders/:id/cancel', async (ctx) => {
      const staff = await staffFor(ctx, 'orders', 'change');
      const result = await staffCancel(deps, payments, id(ctx), await readJson(ctx.req), staff.id);
      await log(ctx, staff, 'Orders', `Cancelled ${await number(id(ctx))}`, { type: 'order', id: id(ctx) });
      sendJson(ctx.res, 200, { ...result, order: await orderView(deps.db, id(ctx), deps.now(), 'staff') });
    })
    .get('/api/returns', async (ctx) => {
      await staffFor(ctx, 'returns', 'view');
      sendJson(ctx.res, 200, { returns: await listReturns(deps.db, ctx.query) });
    })
    .get('/api/returns/:id', async (ctx) => {
      await staffFor(ctx, 'returns', 'view');
      sendJson(ctx.res, 200, { return: await returnView(deps.db, id(ctx)) });
    })
    .post('/api/returns/:id/decide', async (ctx) => {
      const staff = await staffFor(ctx, 'returns', 'change');
      const input = await readJson(ctx.req);
      await decideReturn(deps, id(ctx), input, staff.id);
      const view = await returnView(deps.db, id(ctx));
      await log(ctx, staff, 'Returns', `${view.status === 'approved' ? 'Approved' : 'Declined'} return ${view.number}`, { type: 'return', id: id(ctx) });
      sendJson(ctx.res, 200, { return: view });
    })
    .post('/api/returns/:id/receive', async (ctx) => {
      const staff = await staffFor(ctx, 'returns', 'change');
      await receiveReturn(deps, id(ctx), await readJson(ctx.req), staff.id);
      const view = await returnView(deps.db, id(ctx));
      await log(ctx, staff, 'Returns', `Received return ${view.number}`, { type: 'return', id: id(ctx) });
      sendJson(ctx.res, 200, { return: view });
    })
    .post('/api/returns/:id/refund', async (ctx) => {
      const staff = await staffFor(ctx, 'returns', 'change');
      const result = await refundReturn(deps, payments, id(ctx), await readJson(ctx.req), staff.id);
      const view = await returnView(deps.db, id(ctx));
      await log(ctx, staff, 'Returns', `Refunded return ${view.number} (${result.resolution === 'store_credit' ? 'store credit' : 'money back'}, ${result.amountMinor})`, { type: 'return', id: id(ctx) });
      sendJson(ctx.res, 200, { ...result, return: view });
    })
    .get('/api/settings/returns', async (ctx) => {
      await staffFor(ctx, 'settings', 'view');
      sendJson(ctx.res, 200, { settings: await returnSettings(deps.db) });
    })
    .post('/api/settings/returns', async (ctx) => {
      const staff = await staffFor(ctx, 'settings', 'change');
      await saveReturnSettings(deps.db, await readJson(ctx.req), staff.id);
      await log(ctx, staff, 'Settings', 'Changed the returns policy figures', { type: 'setting', id: 0 });
      sendJson(ctx.res, 200, { settings: await returnSettings(deps.db) });
    });
}

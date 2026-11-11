// The HTTP addresses for payments.
//
//   Customers (website /api, app /v1):
//     POST /orders/:number/pay       start paying; answers with what the payment form needs
//     GET  /orders/:number/payment   has it been paid yet? (the return page asks)
//     A signed-in customer's own orders, or a guest with the order's token
//     (the X-Order-Token header, or ?token= on the GET).
//   Providers (api.hairbydemj.com):
//     POST /webhooks/paystack, POST /webhooks/stripe
//   Staff (admin):
//     GET  /api/payments/providers   which providers are set up, test or live
//     GET  /api/payments/payouts     latest payouts to the bank
//     GET  /api/orders/:id/payments  payments and refunds of an order
//     POST /api/payments/:id/refund  { amountMinor, reason }

import type { AccountDeps } from '../accounts/deps.js';
import { hashToken } from '../accounts/crypto.js';
import { currentCustomer, requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import type { Config } from '../config.js';
import { ApiError, clientIp, readJson, readRaw, sendJson, type RequestContext } from '../http.js';
import type { Logger } from '../logger.js';
import type { Router } from '../router.js';
import { handleWebhook, paymentStatus, refundPayment, startPayment, type PaymentDeps } from './payments.js';
import { paystack, stripe } from './providers.js';

export function paymentDeps(accounts: AccountDeps, logger: Logger): PaymentDeps {
  const p = accounts.config.payments;
  return {
    db: accounts.db,
    now: accounts.now,
    logger,
    providers: {
      paystack: paystack({ secretKey: p.paystackSecretKey, apiUrl: p.paystackApiUrl }),
      stripe: stripe({ secretKey: p.stripeSecretKey, webhookSecret: p.stripeWebhookSecret, apiUrl: p.stripeApiUrl }),
    },
    publicKeys: { paystack: p.paystackPublicKey, stripe: p.stripePublishableKey },
    returnUrl: siteUrl(accounts.config, '/checkout/complete/'),
  };
}

export function siteUrl(config: Config, path: string): string {
  return config.env === 'production' ? `https://${config.hosts.site}${path}` : `http://${config.hosts.site}:${config.port}${path}`;
}

/** The order at this number, if the caller may see it: their own order, or a guest holding its token. */
export async function ownOrder(accounts: AccountDeps, ctx: RequestContext, transport: 'cookie' | 'bearer'): Promise<number> {
  const number = String(ctx.params.number ?? '').toUpperCase();
  const found = await accounts.db.query('select id, customer_id, access_token_hash from orders where number = $1', [number]);
  const order = found.rows[0] as { id: number; customer_id: number | null; access_token_hash: Buffer | null } | undefined;
  const notFound = new ApiError(404, 'not_found', 'We could not find that order.');
  if (!order) throw notFound;
  const header = ctx.req.headers['x-order-token'];
  const token = (typeof header === 'string' ? header : '') || ctx.query.get('token') || '';
  if (token && token.length <= 200 && order.access_token_hash && hashToken(token).equals(order.access_token_hash)) return Number(order.id);
  const signedIn = await currentCustomer(accounts, ctx, transport);
  if (signedIn && order.customer_id !== null && Number(order.customer_id) === signedIn.customer.id) return Number(order.id);
  // Someone else's order looks exactly like one that does not exist.
  throw notFound;
}

export function shopPaymentRoutes(router: Router, accounts: AccountDeps, deps: PaymentDeps, prefix: string, transport: 'cookie' | 'bearer'): Router {
  return router
    .post(`${prefix}/orders/:number/pay`, async (ctx) => {
      if (transport === 'cookie') requireSameOrigin(ctx);
      const orderId = await ownOrder(accounts, ctx, transport);
      sendJson(ctx.res, 200, { payment: await startPayment(deps, orderId) });
    })
    .get(`${prefix}/orders/:number/payment`, async (ctx) => {
      const orderId = await ownOrder(accounts, ctx, transport);
      sendJson(ctx.res, 200, await paymentStatus(deps, orderId));
    });
}

export function webhookRoutes(router: Router, deps: PaymentDeps): Router {
  const handle = (provider: 'paystack' | 'stripe') => async (ctx: RequestContext): Promise<void> => {
    const raw = await readRaw(ctx.req);
    sendJson(ctx.res, 200, await handleWebhook(deps, provider, raw, ctx.req.headers));
  };
  return router.post('/webhooks/paystack', handle('paystack')).post('/webhooks/stripe', handle('stripe'));
}

export function adminPaymentRoutes(router: Router, accounts: AccountDeps, deps: PaymentDeps): Router {
  return router
    .get('/api/payments/providers', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'view');
      const p = accounts.config.payments;
      sendJson(ctx.res, 200, {
        providers: [
          { name: 'paystack', currencies: ['NGN'], methods: ['Card', 'Bank transfer', 'USSD'], configured: deps.providers.paystack.configured, mode: deps.providers.paystack.mode, publicKeySet: p.paystackPublicKey !== '' },
          { name: 'stripe', currencies: ['USD', 'GBP', 'EUR'], methods: ['Card', 'Apple Pay', 'Google Pay'], configured: deps.providers.stripe.configured, mode: deps.providers.stripe.mode, publicKeySet: p.stripePublishableKey !== '', webhookSecretSet: p.stripeWebhookSecret !== '' },
        ],
      });
    })
    .get('/api/payments/payouts', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'reports', 'view');
      const out: Array<Record<string, unknown>> = [];
      const problems: string[] = [];
      for (const provider of [deps.providers.paystack, deps.providers.stripe]) {
        if (!provider.configured) continue;
        try {
          for (const payout of await provider.payouts()) out.push({ provider: provider.name, ...payout });
        } catch (error) {
          problems.push(`${provider.name}: ${error instanceof Error ? error.message : 'no answer'}`);
        }
      }
      sendJson(ctx.res, 200, { payouts: out, problems });
    })
    .get('/api/orders/:id/payments', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'orders', 'view');
      const id = Number(ctx.params.id);
      const payments = await accounts.db.query('select id, provider, reference, amount_minor, currency, status, method, card_brand, card_last4, failure_reason, webhook_confirmed_at, created_at from payments where order_id = $1 order by id', [id]);
      const refunds = await accounts.db.query('select id, payment_id, amount_minor, includes_shipping, reason, status, staff_id, created_at, completed_at from refunds where order_id = $1 order by id', [id]);
      sendJson(ctx.res, 200, { payments: payments.rows, refunds: refunds.rows });
    })
    .post('/api/payments/:id/refund', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'orders', 'change');
      const id = Number(ctx.params.id);
      const input = await readJson(ctx.req);
      const outcome = await refundPayment(deps, id, { amountMinor: Number(input.amountMinor), reason: typeof input.reason === 'string' ? input.reason : '', includesShipping: input.includesShipping === true }, staff.id);
      const order = await accounts.db.query('select o.id, o.number from payments p join orders o on o.id = p.order_id where p.id = $1', [id]);
      await logActivity(accounts.db, staff, 'Orders', `Refunded ${Number(input.amountMinor)} on ${String(order.rows[0]?.number)} (${outcome.status})`, { type: 'order', id: Number(order.rows[0]?.id) }, clientIp(ctx.req, accounts.config.trustProxy));
      sendJson(ctx.res, 200, { refund: outcome });
    });
}

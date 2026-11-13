// Routes for the API (api.hairbydemj.com), used by the website, admin and app.
// Endpoints are added module by module, under the /v1 prefix.

import type { AccountDeps } from '../accounts/deps.js';
import { customerAuthRoutes } from '../accounts/routes.js';
import { shopCartRoutes } from '../cart/routes.js';
import { shopCatalogRoutes } from '../catalog/routes.js';
import { shopTryOnRoutes } from '../tryon/routes.js';
import type { PaymentDeps } from '../payments/payments.js';
import { shopPaymentRoutes, webhookRoutes } from '../payments/routes.js';
import type { OrderDeps } from '../orders/checkout.js';
import { shopOrderRoutes } from '../orders/routes.js';
import type { ShippingDeps } from '../shipping/shipping.js';
import { shopShippingRoutes } from '../shipping/routes.js';
import { shopNotificationRoutes } from '../notifications/routes.js';
import { customerAccountRoutes } from '../accounts/profile.js';
import { Router } from '../router.js';
import { sendJson } from '../http.js';

export function apiRoutes(accounts?: AccountDeps, payments?: PaymentDeps, shipping?: ShippingDeps, orders?: OrderDeps): Router {
  const router = new Router().get('/v1', ({ res }) => {
    sendJson(res, 200, { name: 'hairbydemj API', version: 1 });
  });
  // Account and catalogue addresses need the database, so they exist only when one is set up.
  if (accounts) {
    customerAuthRoutes(router, accounts, '/v1/auth', 'bearer');
    shopCatalogRoutes(router, accounts, '/v1/catalog');
    shopTryOnRoutes(router, accounts, '/v1/catalog');
    shopCartRoutes(router, accounts, '/v1', 'header');
    if (payments) {
      shopPaymentRoutes(router, accounts, payments, '/v1', 'bearer');
      webhookRoutes(router, payments);
    }
    if (shipping) shopShippingRoutes(router, accounts, shipping, '/v1', 'bearer');
    if (orders) shopOrderRoutes(router, accounts, orders, '/v1', 'bearer');
    shopNotificationRoutes(router, accounts, '/v1', 'bearer');
    customerAccountRoutes(router, accounts, '/v1', 'bearer');
  }
  return router;
}

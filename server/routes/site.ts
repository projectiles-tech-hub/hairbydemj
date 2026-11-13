// Routes for the customer website (hairbydemj.com).
// Pages are added in module 13, from approved designs.

import type { AccountDeps } from '../accounts/deps.js';
import { customerAuthRoutes } from '../accounts/routes.js';
import { shopCartRoutes } from '../cart/routes.js';
import { shopCatalogRoutes } from '../catalog/routes.js';
import type { PaymentDeps } from '../payments/payments.js';
import { shopPaymentRoutes } from '../payments/routes.js';
import type { OrderDeps } from '../orders/checkout.js';
import { shopOrderRoutes } from '../orders/routes.js';
import type { ShippingDeps } from '../shipping/shipping.js';
import { shopShippingRoutes } from '../shipping/routes.js';
import { shopNotificationRoutes, unsubscribeRoutes } from '../notifications/routes.js';
import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function siteRoutes(accounts?: AccountDeps, payments?: PaymentDeps, shipping?: ShippingDeps, orders?: OrderDeps): Router {
  const router = new Router().get('/', ({ res }) => {
    sendHtml(
      res,
      200,
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>hairbydemj</title></head><body><h1>hairbydemj</h1></body></html>',
    );
  });
  if (accounts) {
    customerAuthRoutes(router, accounts, '/api/auth', 'cookie');
    shopCatalogRoutes(router, accounts, '/api/catalog');
    shopCartRoutes(router, accounts, '/api', 'cookie');
    if (payments) shopPaymentRoutes(router, accounts, payments, '/api', 'cookie');
    if (shipping) shopShippingRoutes(router, accounts, shipping, '/api', 'cookie');
    if (orders) shopOrderRoutes(router, accounts, orders, '/api', 'cookie');
    shopNotificationRoutes(router, accounts, '/api', 'cookie');
    unsubscribeRoutes(router, accounts);
  }
  return router;
}

// Routes for the customer website (hairbydemj.com).
// The pages are in server/site/store (module 13).

import type { AccountDeps } from '../accounts/deps.js';
import { customerAuthRoutes } from '../accounts/routes.js';
import { shopCartRoutes } from '../cart/routes.js';
import { shopCatalogRoutes } from '../catalog/routes.js';
import { shopTryOnRoutes } from '../tryon/routes.js';
import { shopLoyaltyRoutes } from '../loyalty/routes.js';
import { shopChatRoutes } from '../chat/routes.js';
import type { MediaDeps } from '../media/media.js';
import type { PaymentDeps } from '../payments/payments.js';
import { shopPaymentRoutes } from '../payments/routes.js';
import type { OrderDeps } from '../orders/checkout.js';
import { shopOrderRoutes } from '../orders/routes.js';
import type { ShippingDeps } from '../shipping/shipping.js';
import { shopShippingRoutes } from '../shipping/routes.js';
import { shopNotificationRoutes, unsubscribeRoutes } from '../notifications/routes.js';
import { customerAccountRoutes } from '../accounts/profile.js';
import { storeRoutes } from '../site/store/routes.js';
import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function siteRoutes(accounts?: AccountDeps, payments?: PaymentDeps, shipping?: ShippingDeps, orders?: OrderDeps, media?: MediaDeps): Router {
  const router = new Router();
  // Without a database (development only) there is just a placeholder page.
  if (!accounts) {
    return router.get('/', ({ res }) => {
      sendHtml(
        res,
        200,
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<title>hairbydemj</title></head><body><h1>hairbydemj</h1></body></html>',
      );
    });
  }
  if (accounts) {
    customerAuthRoutes(router, accounts, '/api/auth', 'cookie');
    shopCatalogRoutes(router, accounts, '/api/catalog');
    shopTryOnRoutes(router, accounts, '/api/catalog');
    shopCartRoutes(router, accounts, '/api', 'cookie');
    if (payments) shopPaymentRoutes(router, accounts, payments, '/api', 'cookie');
    if (shipping) shopShippingRoutes(router, accounts, shipping, '/api', 'cookie');
    if (orders) shopOrderRoutes(router, accounts, orders, '/api', 'cookie');
    shopNotificationRoutes(router, accounts, '/api', 'cookie');
    customerAccountRoutes(router, accounts, '/api', 'cookie');
    shopLoyaltyRoutes(router, accounts, media, '/api', '/api/catalog', 'cookie');
    shopChatRoutes(router, accounts, '/api', 'cookie');
    // The pages themselves (module 13).
    storeRoutes(router, accounts);
    unsubscribeRoutes(router, accounts);
  }
  return router;
}

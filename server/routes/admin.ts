// Routes for the staff admin dashboard (admin.hairbydemj.com).
// Pages are added in module 14, from approved designs.

import type { AccountDeps } from '../accounts/deps.js';
import { staffRoutes } from '../accounts/routes.js';
import { adminCartRoutes } from '../cart/routes.js';
import { adminCatalogRoutes } from '../catalog/routes.js';
import type { MediaDeps } from '../media/media.js';
import { mediaRoutes } from '../media/routes.js';
import type { PaymentDeps } from '../payments/payments.js';
import { adminPaymentRoutes } from '../payments/routes.js';
import type { OrderDeps } from '../orders/checkout.js';
import { adminOrderRoutes } from '../orders/routes.js';
import type { ShippingDeps } from '../shipping/shipping.js';
import { adminShippingRoutes } from '../shipping/routes.js';
import { adminWorkerRoutes } from '../worker/routes.js';
import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function adminRoutes(accounts?: AccountDeps, media?: MediaDeps, payments?: PaymentDeps, shipping?: ShippingDeps, orders?: OrderDeps): Router {
  const router = new Router().get('/', ({ res }) => {
    sendHtml(
      res,
      200,
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta name="robots" content="noindex">' +
        '<title>hairbydemj admin</title></head><body><h1>hairbydemj admin</h1></body></html>',
    );
  });
  if (accounts) {
    staffRoutes(router, accounts);
    adminCatalogRoutes(router, accounts, media);
    adminCartRoutes(router, accounts, { ratesUrl: accounts.config.ratesUrl });
    if (media) mediaRoutes(router, accounts, media);
    if (payments) adminPaymentRoutes(router, accounts, payments);
    if (shipping) adminShippingRoutes(router, accounts, shipping);
    if (orders && payments) adminOrderRoutes(router, accounts, orders, payments);
    adminWorkerRoutes(router, accounts);
  }
  return router;
}

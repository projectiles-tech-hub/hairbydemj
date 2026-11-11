// Routes for the customer website (hairbydemj.com).
// Pages are added in module 13, from approved designs.

import type { AccountDeps } from '../accounts/deps.js';
import { customerAuthRoutes } from '../accounts/routes.js';
import { shopCartRoutes } from '../cart/routes.js';
import { shopCatalogRoutes } from '../catalog/routes.js';
import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function siteRoutes(accounts?: AccountDeps): Router {
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
  }
  return router;
}

// Routes for the API (api.hairbydemj.com), used by the website, admin and app.
// Endpoints are added module by module, under the /v1 prefix.

import type { AccountDeps } from '../accounts/deps.js';
import { customerAuthRoutes } from '../accounts/routes.js';
import { shopCartRoutes } from '../cart/routes.js';
import { shopCatalogRoutes } from '../catalog/routes.js';
import { Router } from '../router.js';
import { sendJson } from '../http.js';

export function apiRoutes(accounts?: AccountDeps): Router {
  const router = new Router().get('/v1', ({ res }) => {
    sendJson(res, 200, { name: 'hairbydemj API', version: 1 });
  });
  // Account and catalogue addresses need the database, so they exist only when one is set up.
  if (accounts) {
    customerAuthRoutes(router, accounts, '/v1/auth', 'bearer');
    shopCatalogRoutes(router, accounts, '/v1/catalog');
    shopCartRoutes(router, accounts, '/v1', 'header');
  }
  return router;
}

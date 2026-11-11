// Routes for the staff admin dashboard (admin.hairbydemj.com).
// Pages are added in module 14, from approved designs.

import type { AccountDeps } from '../accounts/deps.js';
import { staffRoutes } from '../accounts/routes.js';
import { adminCatalogRoutes } from '../catalog/routes.js';
import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function adminRoutes(accounts?: AccountDeps): Router {
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
    adminCatalogRoutes(router, accounts);
  }
  return router;
}

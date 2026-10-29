// Routes for the staff admin dashboard (admin.hairbydemj.com).
// Pages are added in module 14, from approved designs.

import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function adminRoutes(): Router {
  return new Router().get('/', ({ res }) => {
    sendHtml(
      res,
      200,
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<meta name="robots" content="noindex">' +
        '<title>hairbydemj admin</title></head><body><h1>hairbydemj admin</h1></body></html>',
    );
  });
}

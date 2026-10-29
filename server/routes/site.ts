// Routes for the customer website (hairbydemj.com).
// Pages are added in module 13, from approved designs.

import { Router } from '../router.js';
import { sendHtml } from '../http.js';

export function siteRoutes(): Router {
  return new Router().get('/', ({ res }) => {
    sendHtml(
      res,
      200,
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>hairbydemj</title></head><body><h1>hairbydemj</h1></body></html>',
    );
  });
}

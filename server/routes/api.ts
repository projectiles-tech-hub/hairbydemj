// Routes for the API (api.hairbydemj.com), used by the website, admin and app.
// Endpoints are added module by module, under the /v1 prefix.

import { Router } from '../router.js';
import { sendJson } from '../http.js';

export function apiRoutes(): Router {
  return new Router().get('/v1', ({ res }) => {
    sendJson(res, 200, { name: 'hairbydemj API', version: 1 });
  });
}

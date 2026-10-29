// The request handler: picks the website, admin or API by hostname, runs the
// matching route, serves static files, and turns errors into clean responses.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { Router } from './router.js';
import { type Area, HttpError, escapeHtml, sendHtml, sendJson } from './http.js';
import { serveStatic } from './static.js';
import { siteRoutes } from './routes/site.js';
import { adminRoutes } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';

export interface AppOptions {
  version: string;
  /** Routers per area; defaults to the real routes. Tests can pass their own. */
  routers?: Partial<Record<Area, Router>>;
}

export type App = (req: IncomingMessage, res: ServerResponse) => void;

/** Hostname from the Host header, lower-cased and without a port. */
export function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1); // IPv6 literal
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function createApp(config: Config, logger: Logger, options: AppOptions): App {
  const routers: Record<Area, Router> = {
    site: options.routers?.site ?? siteRoutes(),
    admin: options.routers?.admin ?? adminRoutes(),
    api: options.routers?.api ?? apiRoutes(),
  };
  const areaByHost = new Map<string, Area>([
    [config.hosts.site, 'site'],
    [config.hosts.admin, 'admin'],
    [config.hosts.api, 'api'],
  ]);
  const startedAt = Date.now();
  const staticMaxAge = config.env === 'production' ? 3600 : 0;
  const showErrorDetail = config.env !== 'production';

  function sendError(res: ServerResponse, area: Area | undefined, status: number, message: string, headers: Record<string, string> = {}): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (area === 'api' || area === undefined) {
      sendJson(res, status, { error: { status, message } }, headers);
      return;
    }
    const safe = escapeHtml(message);
    sendHtml(
      res,
      status,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${status} | hairbydemj</title></head>` +
        `<body><h1>${status}</h1><p>${safe}</p></body></html>`,
      headers,
    );
  }

  async function handle(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
    const area = areaByHost.get(hostnameOf(req.headers.host));
    if (area === undefined) {
      sendError(res, undefined, 404, 'Unknown host');
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendError(res, area, 400, 'Bad request');
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    const path = url.pathname;

    if (path === '/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        sendError(res, 'api', 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, {
        status: 'ok',
        version: options.version,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
      return;
    }

    const match = routers[area].match(method, path);
    if (match.kind === 'found') {
      await match.handler({ req, res, area, method, path, query: url.searchParams, params: match.params, requestId });
      return;
    }

    if (area !== 'api' && (await serveStatic(req, res, path, { root: config.publicDir, maxAge: staticMaxAge }))) {
      return;
    }

    if (match.kind === 'method-not-allowed') {
      sendError(res, area, 405, 'Method not allowed', { Allow: match.allow.join(', ') });
    } else {
      sendError(res, area, 404, 'Page not found');
    }
  }

  return (req, res) => {
    const requestId = randomUUID();
    const start = process.hrtime.bigint();
    const area = areaByHost.get(hostnameOf(req.headers.host));
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      logger.info('request', {
        requestId,
        method: req.method,
        host: hostnameOf(req.headers.host),
        path: req.url,
        area,
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - start) / 1_000_000n),
      });
    });

    handle(req, res, requestId).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(res, area, error.status, error.message, error.headers);
        return;
      }
      logger.error('unhandled error', { requestId, path: req.url, error });
      const message = showErrorDetail && error instanceof Error ? error.message : 'Something went wrong';
      sendError(res, area, 500, message);
    });
  };
}

// Our own router. Patterns are plain paths with optional ":name" segments,
// e.g. "/products/:slug". HEAD requests are answered by GET routes.

import type { Handler } from './http.js';

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export type RouteMatch =
  | { kind: 'found'; handler: Handler; params: Record<string, string> }
  | { kind: 'method-not-allowed'; allow: string[] }
  | { kind: 'not-found' };

function split(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    if (!pattern.startsWith('/')) throw new Error(`Route pattern must start with "/": ${pattern}`);
    this.routes.push({ method: method.toUpperCase(), segments: split(pattern), handler });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  match(method: string, path: string): RouteMatch {
    const wanted = method.toUpperCase();
    const lookup = wanted === 'HEAD' ? 'GET' : wanted;
    const segments = split(path);
    const allowed = new Set<string>();

    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (params === null) continue;
      if (route.method === lookup) return { kind: 'found', handler: route.handler, params };
      allowed.add(route.method);
      if (route.method === 'GET') allowed.add('HEAD');
    }

    if (allowed.size > 0) return { kind: 'method-not-allowed', allow: [...allowed].sort() };
    return { kind: 'not-found' };
  }
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i] as string;
    const value = actual[i] as string;
    if (expected.startsWith(':')) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        return null;
      }
      params[expected.slice(1)] = decoded;
    } else if (expected !== value) {
      return null;
    }
  }
  return params;
}

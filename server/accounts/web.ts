// How sessions travel over HTTP, and protection against cross-site request
// forgery (a page on another site making a signed-in person's browser send a
// request they did not intend).
//
// - Website and admin: the session token is in a cookie that scripts cannot
//   read (HttpOnly), is only sent over HTTPS (Secure) and is locked to the
//   one hostname that set it (the "__Host-" prefix).
// - Phone app: the token is sent in an "Authorization: Bearer" header.

import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../config.js';
import { ApiError, readCookies, type RequestContext } from '../http.js';
import { safeEqual } from './crypto.js';

export type CookieKind = 'customer' | 'staff';

export function cookieName(kind: CookieKind, config: Config): string {
  const base = kind === 'customer' ? 'hbd_session' : 'hbd_staff';
  // Browsers only accept "__Host-" cookies over HTTPS, which development does not use.
  return config.env === 'production' ? `__Host-${base}` : base;
}

function appendCookie(res: ServerResponse, value: string): void {
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : typeof existing === 'string' ? [existing] : [];
  res.setHeader('Set-Cookie', [...list, value]);
}

export function setSessionCookie(res: ServerResponse, kind: CookieKind, config: Config, token: string, expiresAt: Date, now: Date): void {
  const parts = [`${cookieName(kind, config)}=${token}`, 'Path=/', 'HttpOnly'];
  if (config.env === 'production') parts.push('Secure');
  if (kind === 'customer') {
    // Lax: sent when the customer follows a link to the shop, never on another site's form posts.
    parts.push('SameSite=Lax', `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))}`);
  } else {
    // Strict, and no Max-Age: the staff cookie is never sent from other sites and goes when the browser closes.
    parts.push('SameSite=Strict');
  }
  appendCookie(res, parts.join('; '));
}

export function clearSessionCookie(res: ServerResponse, kind: CookieKind, config: Config): void {
  const parts = [`${cookieName(kind, config)}=`, 'Path=/', 'HttpOnly', 'Max-Age=0', `SameSite=${kind === 'customer' ? 'Lax' : 'Strict'}`];
  if (config.env === 'production') parts.push('Secure');
  appendCookie(res, parts.join('; '));
}

export function cookieToken(req: IncomingMessage, kind: CookieKind, config: Config): string | null {
  return readCookies(req)[cookieName(kind, config)] || null;
}

export function bearerToken(req: IncomingMessage): string | null {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(req.headers.authorization ?? '');
  return match?.[1] ?? null;
}

/**
 * Refuse a request that changes something unless it comes from our own page
 * on the same hostname. Browsers always say where such a request came from
 * (the Origin header, or Sec-Fetch-Site), and another site cannot fake it.
 * Requests that carry no cookie (the phone app) are not affected.
 */
export function requireSameOrigin(ctx: RequestContext): void {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const host = (ctx.req.headers.host ?? '').toLowerCase();
  const origin = ctx.req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    let originHost = '';
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      // handled below
    }
    if (originHost !== '' && originHost === host) return;
  } else if (ctx.req.headers['sec-fetch-site'] === 'same-origin') {
    return;
  }
  throw new ApiError(403, 'cross_site', 'This request did not come from our own page, so it was refused.');
}

/**
 * A token tied to one session, for HTML forms (modules 13 and 14). The page
 * puts it in a hidden field; a form posted from another site cannot know it.
 */
export function csrfToken(sessionToken: string, key: Buffer): string {
  return createHmac('sha256', key).update(sessionToken).digest('base64url');
}

export function csrfTokenValid(sessionToken: string, key: Buffer, given: unknown): boolean {
  return typeof given === 'string' && safeEqual(given, csrfToken(sessionToken, key));
}

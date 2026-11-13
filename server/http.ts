// Shared request/response types and helpers for the plain Node.js server.

import type { IncomingMessage, ServerResponse } from 'node:http';

export type Area = 'site' | 'admin' | 'api';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  area: Area;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  requestId: string;
}

export type Handler = (ctx: RequestContext) => void | Promise<void>;

/** An error that should reach the client with a specific status code. */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

/**
 * An error with a short code that programs can act on (the website and the
 * app), a message for people, and optionally a message per form field.
 */
export class ApiError extends HttpError {
  override name = 'ApiError';
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    headers: Record<string, string> = {},
  ) {
    super(status, message, headers);
  }
}

/** Read the request body exactly as sent, for checking a webhook's signature. */
export async function readRaw(req: IncomingMessage, maxBytes = 512 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const stalled = setTimeout(() => req.destroy(), 30_000);
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBytes) throw new ApiError(413, 'too_large', 'The request is too large');
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(stalled);
  }
  return Buffer.concat(chunks);
}

/** Read a JSON object from the request body. Bodies over the limit are refused. */
export async function readJson(req: IncomingMessage, maxBytes = 16 * 1024): Promise<Record<string, unknown>> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError(415, 'json_required', 'Send the request as JSON');
  const chunks: Buffer[] = [];
  let size = 0;
  // A small request that takes this long is a stalled or hostile client.
  const stalled = setTimeout(() => req.destroy(), 30_000);
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxBytes) throw new ApiError(413, 'too_large', 'The request is too large');
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(stalled);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'bad_json', 'The request is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'bad_json', 'The request must be a JSON object');
  return data as Record<string, unknown>;
}

/** Cookies sent with the request, by name. */
export function readCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name && !(name in out)) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * The visitor's address. Behind our own proxy (Caddy) the real address is the
 * last entry the proxy added to X-Forwarded-For; without a proxy that header
 * can be faked, so the connection's own address is used.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const list = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((x) => x.trim()).filter(Boolean);
    const last = list[list.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? null;
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(buffer.length),
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : buffer);
}

export function sendJson(res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data), { 'Cache-Control': 'no-store', ...headers });
}

export function sendHtml(res: ServerResponse, status: number, html: string, headers?: Record<string, string>): void {
  send(res, status, 'text/html; charset=utf-8', html, headers);
}

export function sendText(res: ServerResponse, status: number, text: string, headers?: Record<string, string>): void {
  send(res, status, 'text/plain; charset=utf-8', text, headers);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text before placing it inside HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

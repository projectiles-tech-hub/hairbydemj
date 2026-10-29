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

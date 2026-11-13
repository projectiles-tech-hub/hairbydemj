// Serves files from the public folder (CSS, browser scripts, icons).
// Guards against requests that try to leave the folder or read hidden files.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  // The try-on's face tracking (module 16).
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

export interface StaticOptions {
  root: string;
  /** Seconds browsers may cache files; 0 means always revalidate. */
  maxAge: number;
  /** True for files whose address never changes content, so caches need not check back. */
  immutable?: boolean;
}

/**
 * Try to answer a GET/HEAD request with a file from the public folder.
 * Returns true when a response was sent, false when no file matched.
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  options: StaticOptions,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;
  if (decoded.split('/').some((part) => part.startsWith('.'))) return false;

  const root = resolve(options.root);
  const file = resolve(root, '.' + decoded);
  if (file !== root && !file.startsWith(root + sep)) return false;

  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': options.maxAge > 0 ? `public, max-age=${options.maxAge}${options.immutable ? ', immutable' : ''}` : 'no-cache',
    'Accept-Ranges': 'bytes',
    'Last-Modified': info.mtime.toUTCString(),
    ETag: etag,
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  // A request for part of a file ("Range: bytes=100-199"), which video
  // players use to start playing early and to jump ahead.
  let range: { start: number; end: number } | null = null;
  const wanted = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (wanted && (wanted[1] !== '' || wanted[2] !== '') && info.size > 0) {
    const start = wanted[1] === '' ? Math.max(0, info.size - Number(wanted[2])) : Number(wanted[1]);
    const end = wanted[1] === '' || wanted[2] === '' ? info.size - 1 : Math.min(Number(wanted[2]), info.size - 1);
    if (start > end || start >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      res.end();
      return true;
    }
    range = { start, end };
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }

  headers['Content-Length'] = String(range ? range.end - range.start + 1 : info.size);
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  await new Promise<void>((done, fail) => {
    const stream = createReadStream(file, range ?? {});
    stream.on('error', fail);
    res.on('close', done);
    stream.pipe(res);
  });
  return true;
}

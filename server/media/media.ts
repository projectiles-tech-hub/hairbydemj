// Product photos and videos: storing an upload, making the sizes the shop
// needs, and linking each to a product (and, by colour, to its variants).
//
// On disk, under MEDIA_DIR:
//   originals/p/<product>/<key>.<ext>     the untouched upload; never served
//   public/p/<product>/<key>/640.webp     the sizes visitors are sent
//   public/p/<product>/<key>/640.jpg
//   public/p/<product>/<key>/video.mp4    for a video (the pictures are its poster)
//   tmp/                                  uploads while they arrive
//
// Each file's address contains a random key and never changes, so browsers
// and Cloudflare may keep it for a year.

import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { withTransaction, type Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { Logger } from '../logger.js';
import { compressVideo, imageSize, isImage, resizeImage, sniff, ToolError, videoInfo, videoPoster, type FileKind } from './tools.js';

export interface MediaDeps {
  db: Db;
  now: () => Date;
  logger: Logger;
  /** Folder that holds originals/, public/ and tmp/. */
  mediaDir: string;
}

export const MEDIA = {
  /** Sizes made from each picture, in pixels wide. Never larger than the original. */
  widths: [320, 640, 960, 1280, 1920],
  maxImageBytes: 25 * 1024 * 1024,
  maxVideoBytes: 300 * 1024 * 1024,
  /** Pictures above this many pixels are refused before they are opened. */
  maxPixels: 60_000_000,
  minImageSide: 300,
  maxVideoSeconds: 120,
  /** Per product, from the approved product editor. */
  maxImages: 10,
  maxVideos: 1,
};

export interface MediaItem {
  id: number;
  productId: number;
  kind: 'image' | 'video';
  status: 'processing' | 'ready' | 'failed';
  alt: string;
  colour: string | null;
  position: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Address folder for this item; add "/640.webp", "/640.jpg" or "/video.mp4". */
  path: string;
  widths: number[];
  error: string | null;
}

interface Meta {
  ip: string | null;
}

const publicDir = (deps: MediaDeps): string => join(deps.mediaDir, 'public');
const fieldError = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });
const notFound = (what: string): ApiError => new ApiError(404, 'not_found', `That ${what} does not exist.`);

function itemFromRow(r: Record<string, unknown>): MediaItem {
  const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(r.id),
    productId: Number(r.product_id),
    kind: r.kind as 'image' | 'video',
    status: r.status as MediaItem['status'],
    alt: String(r.alt),
    colour: (r.colour as string | null) ?? null,
    position: Number(r.position),
    width: n(r.width),
    height: n(r.height),
    durationMs: n(r.duration_ms),
    path: String(r.path),
    widths: ((r.widths as number[] | null) ?? []).map(Number),
    error: (r.error as string | null) ?? null,
  };
}

/** The sizes to make for a picture this wide. */
export function widthsFor(originalWidth: number): number[] {
  const widths = MEDIA.widths.filter((w) => w <= originalWidth);
  const largest = MEDIA.widths[MEDIA.widths.length - 1] ?? 1920;
  if (originalWidth < largest && !widths.includes(originalWidth)) widths.push(originalWidth);
  return widths.sort((a, b) => a - b);
}

/**
 * Save the body of an upload request to a temporary file, stopping at the
 * size limit. Returns where it was saved and how big it is.
 */
export async function receiveUpload(deps: MediaDeps, req: IncomingMessage, maxBytes: number): Promise<{ path: string; bytes: number }> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, 'too_large', `That file is too large. The limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  const dir = join(deps.mediaDir, 'tmp');
  await mkdir(dir, { recursive: true });
  const path = join(dir, randomBytes(12).toString('hex'));
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > maxBytes ? new ApiError(413, 'too_large', `That file is too large. The limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`) : null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(path, { mode: 0o600 }));
  } catch (error) {
    await rm(path, { force: true });
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'upload_failed', 'The upload was cut off. Try again.');
  }
  if (bytes === 0) {
    await rm(path, { force: true });
    throw fieldError('file', 'Choose a photo or video to upload.');
  }
  return { path, bytes };
}

async function makeImageSizes(source: string, folder: string, widths: number[]): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (const width of widths) {
    await resizeImage(source, join(folder, `${width}.webp`), width, 'webp');
    await resizeImage(source, join(folder, `${width}.jpg`), width, 'jpg');
  }
}

/**
 * Add an uploaded photo or video to a product. The file has already been
 * received into a temporary place; this checks what it really is, files it,
 * and makes the sizes. Photos are ready when this returns; videos are
 * compressed afterwards and show as "processing" until done.
 */
export async function addProductMedia(
  deps: MediaDeps,
  actor: StaffMember,
  productId: number,
  upload: { path: string; bytes: number; name?: string | null },
  input: { alt?: unknown; colour?: unknown },
  meta: Meta,
): Promise<MediaItem> {
  requireAccess(actor, 'products', 'change');
  const cleanUp: string[] = [upload.path];
  try {
    const kind: FileKind | null = await sniff(upload.path);
    if (kind === null) throw fieldError('file', 'Upload a JPEG, PNG, WebP or iPhone (HEIC) photo, or an MP4, MOV or WebM video.');
    const image = isImage(kind);
    if (image && upload.bytes > MEDIA.maxImageBytes) throw new ApiError(413, 'too_large', `That photo is too large. The limit is ${MEDIA.maxImageBytes / 1024 / 1024} MB.`);

    const product = await deps.db.query(
      `select p.name, (select count(*)::int from product_media m where m.product_id = p.id and m.kind = 'image') as images,
              (select count(*)::int from product_media m where m.product_id = p.id and m.kind = 'video') as videos,
              (select coalesce(max(position), -1) + 1 from product_media m where m.product_id = p.id) as next
       from products p where p.id = $1`,
      [productId],
    );
    const p = product.rows[0] as { name: string; images: number; videos: number; next: number } | undefined;
    if (!p) throw notFound('product');
    if (image && p.images >= MEDIA.maxImages) throw new ApiError(409, 'limit', `A product can have up to ${MEDIA.maxImages} photos. Remove one first.`);
    if (!image && p.videos >= MEDIA.maxVideos) throw new ApiError(409, 'limit', `A product can have ${MEDIA.maxVideos} video. Remove it first.`);

    let size: { width: number; height: number } | null = null;
    if (image) {
      try {
        size = await imageSize(upload.path);
      } catch (error) {
        if (error instanceof ToolError && !error.message.includes('not installed')) throw fieldError('file', 'That photo could not be read. Save it again as a JPEG and try once more.');
        throw error;
      }
      if (size.width * size.height > MEDIA.maxPixels) throw fieldError('file', 'That photo is too large to process. Use one under 60 megapixels.');
      if (Math.min(size.width, size.height) < MEDIA.minImageSide) throw fieldError('file', `That photo is too small. Use one at least ${MEDIA.minImageSide} pixels on its shorter side.`);
    }

    const key = randomBytes(8).toString('hex');
    const path = `p/${productId}/${key}`;
    const originalPath = join('originals', 'p', String(productId), `${key}.${kind}`);
    await mkdir(join(deps.mediaDir, 'originals', 'p', String(productId)), { recursive: true });
    await rename(upload.path, join(deps.mediaDir, originalPath));
    cleanUp.length = 0;
    cleanUp.push(join(deps.mediaDir, originalPath), join(publicDir(deps), path));

    const widths = size ? widthsFor(size.width) : [];
    if (size) await makeImageSizes(join(deps.mediaDir, originalPath), join(publicDir(deps), path), widths);

    const alt = typeof input.alt === 'string' ? input.alt.trim().slice(0, 300) : '';
    const colour = typeof input.colour === 'string' && input.colour.trim() !== '' ? input.colour.trim().slice(0, 60) : null;
    const item = await withTransaction(deps.db, async (c) => {
      const made = await c.query(
        `insert into product_media (product_id, kind, path, alt, colour, width, height, position, status, widths, original_name, original_path, bytes, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`,
        [productId, image ? 'image' : 'video', path, alt, colour, size?.width ?? null, size?.height ?? null, p.next, image ? 'ready' : 'processing', widths, (upload.name ?? '').slice(0, 200) || null, originalPath, upload.bytes, actor.id, deps.now()],
      );
      await logActivity(c, actor, 'Products', `Added a ${image ? 'photo' : 'video'} to "${p.name}"`, { type: 'product', id: productId }, meta.ip);
      return itemFromRow(made.rows[0] as Record<string, unknown>);
    });
    cleanUp.length = 0;
    return item;
  } catch (error) {
    await Promise.all(cleanUp.map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
}

let working = false;

/**
 * Compress the videos that are waiting, one at a time. Called after an
 * upload and when the server starts, so a video interrupted by a restart is
 * picked up again. Returns how many were handled.
 */
export async function processPending(deps: MediaDeps): Promise<number> {
  if (working) return 0;
  working = true;
  let handled = 0;
  try {
    for (;;) {
      const next = await deps.db.query("select * from product_media where status = 'processing' order by created_at, id limit 1");
      const row = next.rows[0] as Record<string, unknown> | undefined;
      if (!row) break;
      const source = join(deps.mediaDir, String(row.original_path));
      const folder = join(publicDir(deps), String(row.path));
      try {
        const info = await videoInfo(source);
        if (info.durationMs > MEDIA.maxVideoSeconds * 1000) throw new ToolError(`The video is longer than ${MEDIA.maxVideoSeconds} seconds`);
        await mkdir(folder, { recursive: true });
        await compressVideo(source, join(folder, 'video.mp4'));
        const made = await videoInfo(join(folder, 'video.mp4'));
        const poster = join(deps.mediaDir, 'tmp', `${randomBytes(8).toString('hex')}.png`);
        await mkdir(join(deps.mediaDir, 'tmp'), { recursive: true });
        try {
          await videoPoster(join(folder, 'video.mp4'), poster, Math.min(1000, Math.floor(made.durationMs / 2)));
          const widths = widthsFor(made.width);
          await makeImageSizes(poster, folder, widths);
          await deps.db.query("update product_media set status = 'ready', error = null, width = $2, height = $3, duration_ms = $4, widths = $5 where id = $1", [row.id, made.width, made.height, made.durationMs, widths]);
        } finally {
          await rm(poster, { force: true });
        }
      } catch (error) {
        await rm(folder, { recursive: true, force: true });
        const message = error instanceof ToolError ? error.message : 'The video could not be processed';
        deps.logger.error('video processing failed', { mediaId: row.id, error });
        await deps.db.query("update product_media set status = 'failed', error = $2 where id = $1", [row.id, message.slice(0, 300)]);
      }
      handled++;
    }
  } finally {
    working = false;
  }
  return handled;
}

export async function listProductMedia(deps: MediaDeps, actor: StaffMember, productId: number): Promise<MediaItem[]> {
  requireAccess(actor, 'products', 'view');
  const result = await deps.db.query('select * from product_media where product_id = $1 order by position, id', [productId]);
  return result.rows.map((r) => itemFromRow(r as Record<string, unknown>));
}

/** Change the description, or the colour a photo shows. */
export async function updateMedia(deps: MediaDeps, actor: StaffMember, mediaId: number, input: Record<string, unknown>, meta: Meta): Promise<MediaItem> {
  requireAccess(actor, 'products', 'change');
  return withTransaction(deps.db, async (c) => {
    const found = await c.query('select m.*, p.name from product_media m join products p on p.id = m.product_id where m.id = $1 for update of m', [mediaId]);
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw notFound('photo or video');
    const alt = 'alt' in input ? (typeof input.alt === 'string' ? input.alt.trim().slice(0, 300) : '') : String(row.alt);
    let colour = (row.colour as string | null) ?? null;
    if ('colour' in input) {
      colour = typeof input.colour === 'string' && input.colour.trim() !== '' ? input.colour.trim().slice(0, 60) : null;
      if (colour !== null) {
        // Linking to variants is by colour, so the colour must be one the product is sold in.
        const known = await c.query('select colour from variants where product_id = $1 and lower(colour) = lower($2) limit 1', [row.product_id, colour]);
        if (!known.rows[0]) throw fieldError('colour', 'Choose one of the colours this product is sold in.');
        colour = String(known.rows[0].colour);
      }
    }
    const saved = await c.query('update product_media set alt = $2, colour = $3 where id = $1 returning *', [mediaId, alt, colour]);
    await logActivity(c, actor, 'Products', `Edited a ${row.kind === 'image' ? 'photo' : 'video'} of "${String(row.name)}"`, { type: 'product', id: Number(row.product_id) }, meta.ip);
    return itemFromRow(saved.rows[0] as Record<string, unknown>);
  });
}

/** Set the order of a product's photos and video. The first photo is the cover. */
export async function orderProductMedia(deps: MediaDeps, actor: StaffMember, productId: number, input: Record<string, unknown>, meta: Meta): Promise<MediaItem[]> {
  requireAccess(actor, 'products', 'change');
  const ids = Array.isArray(input.ids) ? input.ids.map(Number) : [];
  return withTransaction(deps.db, async (c) => {
    const product = await c.query('select name from products where id = $1 for update', [productId]);
    if (!product.rows[0]) throw notFound('product');
    const existing = await c.query('select id from product_media where product_id = $1', [productId]);
    const have = new Set(existing.rows.map((r) => Number(r.id)));
    if (ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) throw fieldError('ids', 'Send every photo and video of this product once, in the new order.');
    for (const [position, id] of ids.entries()) await c.query('update product_media set position = $2 where id = $1', [id, position]);
    await logActivity(c, actor, 'Products', `Reordered the photos of "${String(product.rows[0].name)}"`, { type: 'product', id: productId }, meta.ip);
    const result = await c.query('select * from product_media where product_id = $1 order by position, id', [productId]);
    return result.rows.map((r) => itemFromRow(r as Record<string, unknown>));
  });
}

export async function deleteMedia(deps: MediaDeps, actor: StaffMember, mediaId: number, meta: Meta): Promise<void> {
  requireAccess(actor, 'products', 'change');
  const gone = await withTransaction(deps.db, async (c) => {
    const removed = await c.query('delete from product_media where id = $1 returning product_id, kind, path, original_path', [mediaId]);
    const row = removed.rows[0] as { product_id: number; kind: string; path: string; original_path: string | null } | undefined;
    if (!row) throw notFound('photo or video');
    const product = await c.query('select name from products where id = $1', [row.product_id]);
    await logActivity(c, actor, 'Products', `Removed a ${row.kind === 'image' ? 'photo' : 'video'} from "${String(product.rows[0]?.name)}"`, { type: 'product', id: Number(row.product_id) }, meta.ip);
    return row;
  });
  // Files go only after the database has let go of them.
  await rm(join(publicDir(deps), gone.path), { recursive: true, force: true });
  if (gone.original_path) await rm(join(deps.mediaDir, gone.original_path), { force: true });
}

/** Remove every file of a product that has been deleted. */
export async function removeProductFiles(deps: MediaDeps, productId: number): Promise<void> {
  await rm(join(publicDir(deps), 'p', String(productId)), { recursive: true, force: true });
  await rm(join(deps.mediaDir, 'originals', 'p', String(productId)), { recursive: true, force: true });
}

/** Make sure the folders exist and can be written to. Called when the server starts. */
export async function prepareMediaDir(deps: MediaDeps): Promise<void> {
  for (const part of ['originals', 'public', 'tmp']) await mkdir(join(deps.mediaDir, part), { recursive: true });
  // Anything left in tmp is from an upload that never finished.
  await rm(join(deps.mediaDir, 'tmp'), { recursive: true, force: true });
  await mkdir(join(deps.mediaDir, 'tmp'), { recursive: true });
  await stat(publicDir(deps));
}

// ----- pictures for the shop itself: homepage banners, categories, collections -----

/** A picture made for the shop (not a product): where it is and which sizes exist. */
export interface SitePicture {
  /** Address folder; add "/1280.webp" or "/1280.jpg". */
  path: string;
  widths: number[];
  width: number;
  height: number;
}

export const SITE_PICTURES = {
  /** Full-width banners: wide screens get up to 2560 pixels. */
  banner: { widths: [640, 960, 1280, 1920, 2560], minSide: 500 },
  /** Category cards and other small pictures. */
  card: { widths: [320, 640, 960], minSide: 300 },
} as const;

/** The sizes to make from a picture this wide: never larger than the original. */
export function sizesFor(originalWidth: number, steps: readonly number[]): number[] {
  const widths = steps.filter((w) => w <= originalWidth);
  const largest = steps[steps.length - 1] ?? 1920;
  if (originalWidth < largest && !widths.includes(originalWidth)) widths.push(originalWidth);
  return widths.sort((a, b) => a - b);
}

/**
 * File an uploaded picture for the shop under public/s/<folder>/<key>/, in the
 * sizes of its kind, as WebP and JPEG, turned the right way up and with its
 * hidden details (camera, place) removed, just like product photos. The
 * upload has already been received into a temporary place.
 */
export async function storeSitePicture(deps: MediaDeps, upload: { path: string; bytes: number }, kind: keyof typeof SITE_PICTURES, folder: string): Promise<SitePicture> {
  const cleanUp: string[] = [upload.path];
  try {
    if (!/^[a-z0-9/-]+$/.test(folder)) throw new Error(`bad picture folder: ${folder}`);
    const fileKind = await sniff(upload.path);
    if (fileKind === null || !isImage(fileKind)) throw fieldError('file', 'Upload a JPEG, PNG, WebP or iPhone (HEIC) photo.');
    if (upload.bytes > MEDIA.maxImageBytes) throw new ApiError(413, 'too_large', `That photo is too large. The limit is ${MEDIA.maxImageBytes / 1024 / 1024} MB.`);
    let size: { width: number; height: number };
    try {
      size = await imageSize(upload.path);
    } catch (error) {
      if (error instanceof ToolError && !error.message.includes('not installed')) throw fieldError('file', 'That photo could not be read. Save it again as a JPEG and try once more.');
      throw error;
    }
    const rules = SITE_PICTURES[kind];
    if (size.width * size.height > MEDIA.maxPixels) throw fieldError('file', 'That photo is too large to process. Use one under 60 megapixels.');
    if (Math.min(size.width, size.height) < rules.minSide) throw fieldError('file', `That photo is too small. Use one at least ${rules.minSide} pixels on its shorter side.`);
    const key = randomBytes(8).toString('hex');
    const path = `s/${folder}/${key}`;
    const original = join(deps.mediaDir, 'originals', 's', ...folder.split('/'), `${key}.${fileKind}`);
    await mkdir(join(original, '..'), { recursive: true });
    await rename(upload.path, original);
    cleanUp.length = 0;
    cleanUp.push(original, join(publicDir(deps), path));
    const widths = sizesFor(size.width, rules.widths);
    await makeImageSizes(original, join(publicDir(deps), path), widths);
    cleanUp.length = 0;
    return { path, widths, width: size.width, height: size.height };
  } catch (error) {
    await Promise.all(cleanUp.map((p) => rm(p, { recursive: true, force: true })));
    throw error;
  }
}

/** Remove a shop picture's sizes and its original. */
export async function removeSitePicture(deps: MediaDeps, path: string): Promise<void> {
  if (!/^s\/[a-z0-9/-]+\/[0-9a-f]{16}$/.test(path)) return;
  await rm(join(publicDir(deps), path), { recursive: true, force: true });
  const parts = path.split('/');
  const key = parts.pop() as string;
  const dir = join(deps.mediaDir, 'originals', ...parts);
  for (const ext of ['jpeg', 'png', 'webp', 'heic']) await rm(join(dir, `${key}.${ext}`), { force: true });
}

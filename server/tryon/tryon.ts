// Try-on pictures: see-through PNGs of wigs, placed on the customer's face by
// the website (MediaPipe) and the app (ARKit, ARCore). Nothing about the
// customer's face or camera ever reaches the server.
//
// On disk, under MEDIA_DIR:
//   public/p/<product>/tryon-<key>/1200.png    the picture, at most 1200 wide
//   public/p/<product>/tryon-<key>/1200.webp   the same, smaller to send
//
// Pictures are drawn to a template (docs/try-on.md): 1000 by 1200 pixels,
// with the temples at 30% and 70% across, 42% down. Other placements can be
// given when uploading.

import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import type { Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { MediaDeps } from '../media/media.js';
import { imageSize, run, sniff } from '../media/tools.js';
import { VISIBLE_SQL } from '../catalog/rules.js';

export const TRY_ON = {
  maxBytes: 15 * 1024 * 1024,
  minWidth: 400,
  maxWidth: 1200,
  maxPerProduct: 12,
  /** Where the temples sit on the template picture. */
  template: { leftX: 0.3, leftY: 0.42, rightX: 0.7, rightY: 0.42 },
};

export interface TryOnImage {
  id: number;
  productId: number;
  colour: string | null;
  /** Address folder; add "/1200.png" or "/1200.webp". */
  path: string;
  width: number;
  height: number;
  /** Where the temples sit, as fractions of the width and height. */
  temples: { leftX: number; leftY: number; rightX: number; rightY: number };
}

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });

function fromRow(r: Record<string, unknown>): TryOnImage {
  return {
    id: Number(r.id),
    productId: Number(r.product_id),
    colour: (r.colour as string | null) ?? null,
    path: String(r.path),
    width: Number(r.width),
    height: Number(r.height),
    temples: { leftX: Number(r.left_x), leftY: Number(r.left_y), rightX: Number(r.right_x), rightY: Number(r.right_y) },
  };
}

export async function listTryOn(db: Db, productId: number): Promise<TryOnImage[]> {
  const found = await db.query('select * from try_on_images where product_id = $1 order by position, id', [productId]);
  return found.rows.map(fromRow);
}

function fraction(value: string | null, fallback: number, field: string): number {
  if (value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw invalid(field, 'Give a number from 0 to 1.');
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Add a try-on picture from an upload already received into tmp. Only PNG is
 * taken, because the wig must be see-through around its edges.
 */
export async function addTryOn(deps: MediaDeps, staff: StaffMember, productId: number, upload: { path: string }, options: { colour: string | null; leftX: string | null; leftY: string | null; rightX: string | null; rightY: string | null }, ip: string | null): Promise<TryOnImage> {
  requireAccess(staff, 'products', 'change');
  try {
    const product = (await deps.db.query('select id, name from products where id = $1', [productId])).rows[0];
    if (!product) throw new ApiError(404, 'not_found', 'That product does not exist.');
    if ((await sniff(upload.path)) !== 'png') throw invalid('file', 'Upload a PNG with a see-through background.');
    const size = await imageSize(upload.path);
    if (size.width < TRY_ON.minWidth) throw invalid('file', `The picture must be at least ${TRY_ON.minWidth} pixels wide.`);
    if (size.width * size.height > 20_000_000) throw invalid('file', 'The picture is too large. Keep it under 20 million pixels.');
    const t = TRY_ON.template;
    const temples = {
      leftX: fraction(options.leftX, t.leftX, 'leftX'),
      leftY: fraction(options.leftY, t.leftY, 'leftY'),
      rightX: fraction(options.rightX, t.rightX, 'rightX'),
      rightY: fraction(options.rightY, t.rightY, 'rightY'),
    };
    if (temples.leftX >= temples.rightX) throw invalid('rightX', 'The right temple must be to the right of the left one.');
    const colour = options.colour?.trim().slice(0, 60) || null;
    const count = Number((await deps.db.query('select count(*)::int as n from try_on_images where product_id = $1', [productId])).rows[0]?.n ?? 0);
    if (count >= TRY_ON.maxPerProduct) throw invalid('file', `A product can have at most ${TRY_ON.maxPerProduct} try-on pictures.`);
    const clash = await deps.db.query("select 1 from try_on_images where product_id = $1 and coalesce(lower(colour), '') = coalesce(lower($2), '')", [productId, colour]);
    if (clash.rows.length) throw invalid('colour', colour ? `There is already a try-on picture for ${colour}. Remove it first.` : 'There is already a try-on picture without a colour. Remove it first.');

    const key = randomBytes(9).toString('base64url');
    const path = `p/${productId}/tryon-${key}`;
    const folder = join(deps.mediaDir, 'public', path);
    await mkdir(folder, { recursive: true });
    const width = Math.min(size.width, TRY_ON.maxWidth);
    // Smaller copies keep the see-through edges; hidden details in the file are removed.
    await run('vipsthumbnail', [upload.path, '-s', `${TRY_ON.maxWidth}x>`, '-o', join(folder, '1200.png[strip,compression=9]')], 60_000);
    await run('vipsthumbnail', [upload.path, '-s', `${TRY_ON.maxWidth}x>`, '-o', join(folder, '1200.webp[Q=85,strip,alpha_q=90]')], 60_000);
    const height = Math.round((size.height * width) / size.width);
    const inserted = await deps.db.query(
      `insert into try_on_images (product_id, colour, path, width, height, left_x, left_y, right_x, right_y, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [productId, colour, path, width, height, temples.leftX, temples.leftY, temples.rightX, temples.rightY, count],
    );
    await logActivity(deps.db, staff, 'products', `Added a try-on picture to ${String(product.name)}${colour ? ` (${colour})` : ''}`, { type: 'product', id: productId }, ip);
    return fromRow(inserted.rows[0] as Record<string, unknown>);
  } finally {
    await rm(upload.path, { force: true });
  }
}

export async function removeTryOn(deps: MediaDeps, staff: StaffMember, id: number, ip: string | null): Promise<void> {
  requireAccess(staff, 'products', 'change');
  const found = (await deps.db.query('delete from try_on_images t using products p where t.id = $1 and p.id = t.product_id returning t.path, t.product_id, p.name', [id])).rows[0];
  if (!found) throw new ApiError(404, 'not_found', 'That try-on picture does not exist.');
  await rm(join(deps.mediaDir, 'public', String(found.path)), { recursive: true, force: true });
  await logActivity(deps.db, staff, 'products', `Removed a try-on picture from ${String(found.name)}`, { type: 'product', id: Number(found.product_id) }, ip);
}

/** Published products that can be tried on, with their pictures, for the try-on page and the app's Try on tab. */
export async function tryOnProducts(db: Db, currency: string, now: Date): Promise<Array<{ id: number; slug: string; name: string; priceFromMinor: number | null; currency: string; images: TryOnImage[] }>> {
  const found = await db.query(
    `select p.id, p.slug, p.name,
            (select min(pr.amount_minor) from variants v join prices pr on pr.variant_id = v.id and pr.currency = $1 where v.product_id = p.id and v.is_active) as price_from
       from products p
      where exists (select 1 from try_on_images t where t.product_id = p.id)
        and ${VISIBLE_SQL('p', '$2')}
      order by p.name`,
    [currency, now],
  );
  const images = found.rows.length ? await db.query('select * from try_on_images where product_id = any($1::bigint[]) order by position, id', [found.rows.map((r) => r.id)]) : { rows: [] };
  return found.rows.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    priceFromMinor: r.price_from === null ? null : Number(r.price_from),
    currency,
    images: images.rows.filter((i) => Number(i.product_id) === Number(r.id)).map((i) => fromRow(i as Record<string, unknown>)),
  }));
}

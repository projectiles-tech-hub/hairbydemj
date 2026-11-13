// Reviews with photos from customers who bought the item (module 17).
// A review waits until staff publish it; staff can hide it again and reply.
// Publishing gives the customer loyalty points once.
//
// Photos, under MEDIA_DIR:  public/r/<review>/<key>/640.jpg (and .webp, 1280)

import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { withTransaction, type Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import { loyaltySettings, movePoints } from '../loyalty/loyalty.js';
import type { MediaDeps } from '../media/media.js';
import { imageSize, isImage, resizeImage, sniff } from '../media/tools.js';

export const REVIEWS = { maxBody: 2000, maxPhotos: 4, maxPhotoBytes: 15 * 1024 * 1024, widths: [640, 1280] };

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });

export interface ReviewView {
  id: number;
  productSlug: string;
  productName: string;
  author: string;
  rating: number;
  body: string;
  verifiedBuyer: boolean;
  status: string;
  photos: Array<{ path: string; widths: number[] }>;
  reply: string | null;
  createdAt: string;
}

/** "Ada O." from a customer's name. */
function shortName(first: string, last: string): string {
  return [first.trim(), last.trim() ? `${last.trim()[0]?.toUpperCase()}.` : ''].filter(Boolean).join(' ') || 'A customer';
}

async function views(db: Db, where: string, params: unknown[], extra = ''): Promise<ReviewView[]> {
  const found = await db.query(
    `select r.id, r.author_name, r.rating, r.body, r.verified_buyer, r.status, r.reply, r.created_at, p.slug, p.name
       from reviews r join products p on p.id = r.product_id where ${where} ${extra}`,
    params,
  );
  const ids = found.rows.map((r) => Number(r.id));
  const photos = ids.length ? await db.query('select review_id, path, widths from review_media where review_id = any($1::bigint[]) order by position, id', [ids]) : { rows: [] };
  return found.rows.map((r) => ({
    id: Number(r.id),
    productSlug: String(r.slug),
    productName: String(r.name),
    author: String(r.author_name),
    rating: Number(r.rating),
    body: String(r.body),
    verifiedBuyer: r.verified_buyer === true,
    status: String(r.status),
    photos: photos.rows.filter((m) => Number(m.review_id) === Number(r.id)).map((m) => ({ path: String(m.path), widths: ((m.widths as number[] | null) ?? []).map(Number) })),
    reply: (r.reply as string | null) ?? null,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

/** Published reviews of a product, with the average and how many of each star. */
export async function productReviews(db: Db, slug: string, page: number): Promise<{ average: number | null; count: number; stars: Record<string, number>; reviews: ReviewView[]; more: boolean }> {
  const product = (await db.query('select id from products where slug = $1', [slug])).rows[0];
  if (!product) throw new ApiError(404, 'not_found', 'We could not find that product.');
  const summary = (await db.query("select count(*)::int as n, avg(rating)::float8 as avg, count(*) filter (where rating = 5)::int as s5, count(*) filter (where rating = 4)::int as s4, count(*) filter (where rating = 3)::int as s3, count(*) filter (where rating = 2)::int as s2, count(*) filter (where rating = 1)::int as s1 from reviews where product_id = $1 and status = 'published'", [product.id])).rows[0];
  const size = 10;
  const p = Math.max(1, Math.min(1000, page));
  const list = await views(db, "r.product_id = $1 and r.status = 'published'", [product.id, size + 1, (p - 1) * size], 'order by r.published_at desc, r.id desc limit $2 offset $3');
  return {
    average: Number(summary?.n) ? Math.round(Number(summary?.avg) * 10) / 10 : null,
    count: Number(summary?.n ?? 0),
    stars: { '5': Number(summary?.s5 ?? 0), '4': Number(summary?.s4 ?? 0), '3': Number(summary?.s3 ?? 0), '2': Number(summary?.s2 ?? 0), '1': Number(summary?.s1 ?? 0) },
    reviews: list.slice(0, size),
    more: list.length > size,
  };
}

/** Items a customer has received and not yet reviewed. */
export async function itemsToReview(db: Db, customerId: number): Promise<Array<{ orderItemId: number; productSlug: string; productName: string; description: string; orderNumber: string }>> {
  const found = await db.query(
    `select oi.id, oi.product_name, oi.variant_description, o.number, p.slug
       from order_items oi join orders o on o.id = oi.order_id join products p on p.id = oi.product_id
      where o.customer_id = $1 and o.status in ('delivered', 'returned') and oi.kind = 'variant'
        and not exists (select 1 from reviews r where r.order_item_id = oi.id)
        and not exists (select 1 from reviews r where r.customer_id = $1 and r.product_id = oi.product_id)
      order by o.placed_at desc limit 50`,
    [customerId],
  );
  return found.rows.map((r) => ({ orderItemId: Number(r.id), productSlug: String(r.slug), productName: String(r.product_name), description: String(r.variant_description ?? ''), orderNumber: String(r.number) }));
}

export async function myReviews(db: Db, customerId: number): Promise<ReviewView[]> {
  return views(db, 'r.customer_id = $1', [customerId], 'order by r.created_at desc limit 100');
}

export async function writeReview(db: Db, customerId: number, input: Record<string, unknown>): Promise<ReviewView> {
  const itemId = Number(input.orderItemId);
  const item = (await db.query(
    `select oi.id, oi.product_id, c.first_name, c.last_name from order_items oi join orders o on o.id = oi.order_id join customers c on c.id = o.customer_id
      where oi.id = $1 and o.customer_id = $2 and o.status in ('delivered', 'returned') and oi.kind = 'variant'`,
    [itemId, customerId],
  )).rows[0];
  if (!item) throw invalid('orderItemId', 'You can review items once they have been delivered to you.');
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw invalid('rating', 'Choose from 1 to 5 stars.');
  const body = typeof input.body === 'string' ? input.body.trim().slice(0, REVIEWS.maxBody) : '';
  if (body.length < 10) throw invalid('body', 'Write at least a few words about the hair.');
  const already = await db.query('select 1 from reviews where (order_item_id = $1) or (customer_id = $2 and product_id = $3)', [itemId, customerId, item.product_id]);
  if (already.rowCount) throw invalid('orderItemId', 'You have already reviewed this.');
  const made = await db.query(
    "insert into reviews (product_id, customer_id, order_item_id, author_name, rating, body, verified_buyer, status) values ($1, $2, $3, $4, $5, $6, true, 'waiting') returning id",
    [item.product_id, customerId, itemId, shortName(String(item.first_name), String(item.last_name)), rating, body],
  );
  return (await views(db, 'r.id = $1', [made.rows[0]?.id]))[0]!;
}

/** A photo on the customer's own review, while it waits for staff. */
export async function addReviewPhoto(deps: MediaDeps, customerId: number, reviewId: number, upload: { path: string }): Promise<ReviewView> {
  try {
    const review = (await deps.db.query("select id from reviews where id = $1 and customer_id = $2 and status = 'waiting'", [reviewId, customerId])).rows[0];
    if (!review) throw new ApiError(404, 'not_found', 'Photos can be added to your review until it is published.');
    const count = Number((await deps.db.query('select count(*)::int as n from review_media where review_id = $1', [reviewId])).rows[0]?.n ?? 0);
    if (count >= REVIEWS.maxPhotos) throw invalid('file', `A review can have up to ${REVIEWS.maxPhotos} photos.`);
    const kind = await sniff(upload.path);
    if (!kind || !isImage(kind)) throw invalid('file', 'Upload a photo (JPEG, PNG, WebP or HEIC).');
    const size = await imageSize(upload.path);
    if (size.width * size.height > 60_000_000) throw invalid('file', 'That photo is too large.');
    const path = `r/${reviewId}/${randomBytes(9).toString('base64url')}`;
    const folder = join(deps.mediaDir, 'public', path);
    await mkdir(folder, { recursive: true });
    const widths = REVIEWS.widths.filter((w, i) => i === 0 || w <= size.width);
    for (const w of widths) {
      // Turned the right way up, with camera details and location removed.
      await resizeImage(upload.path, join(folder, `${w}.webp`), w, 'webp');
      await resizeImage(upload.path, join(folder, `${w}.jpg`), w, 'jpg');
    }
    await deps.db.query('insert into review_media (review_id, path, position, widths) values ($1, $2, $3, $4)', [reviewId, path, count, widths]);
    return (await views(deps.db, 'r.id = $1', [reviewId]))[0]!;
  } finally {
    await rm(upload.path, { force: true });
  }
}

// ----- staff -----

export async function listReviews(db: Db, staff: StaffMember, query: URLSearchParams): Promise<{ reviews: Array<ReviewView & { customerEmail: string | null }>; counts: Record<string, number> }> {
  requireAccess(staff, 'products', 'view');
  const status = query.get('status') ?? 'waiting';
  const s = ['waiting', 'published', 'hidden'].includes(status) ? status : 'waiting';
  const list = await views(db, 'r.status = $1', [s], 'order by r.created_at desc limit 200');
  const emails = list.length ? await db.query('select r.id, c.email from reviews r left join customers c on c.id = r.customer_id where r.id = any($1::bigint[])', [list.map((r) => r.id)]) : { rows: [] };
  const counts = Object.fromEntries((await db.query('select status, count(*)::int as n from reviews group by status')).rows.map((r) => [String(r.status), Number(r.n)]));
  return { reviews: list.map((r) => ({ ...r, customerEmail: (emails.rows.find((e) => Number(e.id) === r.id)?.email as string | undefined) ?? null })), counts };
}

/** Publish, hide, or reply to a review. */
export async function moderateReview(deps: { db: Db; now: () => Date; mail: { send(e: { to: string; template: 'review_reply'; data: Record<string, string> }): Promise<void> } }, staff: StaffMember, id: number, input: Record<string, unknown>, ip: string | null): Promise<ReviewView> {
  requireAccess(staff, 'products', 'change');
  const now = deps.now();
  const status = input.status;
  if (status !== undefined && status !== 'published' && status !== 'hidden') throw invalid('status', 'Choose published or hidden.');
  const reply = typeof input.reply === 'string' ? input.reply.trim().slice(0, 1000) : undefined;
  const result = await withTransaction(deps.db, async (c) => {
    const r = (await c.query('select r.*, p.name as product_name, cu.email from reviews r join products p on p.id = r.product_id left join customers cu on cu.id = r.customer_id where r.id = $1 for update of r', [id])).rows[0];
    if (!r) throw new ApiError(404, 'not_found', 'That review does not exist.');
    if (status) await c.query('update reviews set status = $2, published_at = case when $2 = \'published\' then coalesce(published_at, $3) else published_at end where id = $1', [id, status, now]);
    if (reply !== undefined) await c.query('update reviews set reply = $2, replied_by = $3, replied_at = $4 where id = $1', [id, reply || null, staff.id, now]);
    // Points for the review, once, the first time it is published.
    if (status === 'published' && r.customer_id) {
      const given = await c.query("select 1 from loyalty_transactions where review_id = $1 and kind = 'review'", [id]);
      if (!given.rowCount) {
        const rules = await loyaltySettings(c);
        const photos = Number((await c.query('select count(*)::int as n from review_media where review_id = $1', [id])).rows[0]?.n ?? 0);
        await movePoints(c, Number(r.customer_id), photos > 0 ? rules.reviewWithPhotosPoints : rules.reviewPoints, 'review', now, { reviewId: id, note: `Thank you for reviewing ${String(r.product_name)}` });
      }
    }
    return { email: (r.email as string | null) ?? null, productName: String(r.product_name), hadReply: r.reply !== null };
  });
  if (reply && result.email && !result.hadReply) await deps.mail.send({ to: result.email, template: 'review_reply', data: { productName: result.productName, reply } });
  await logActivity(deps.db, staff, 'products', `${status === 'published' ? 'Published' : status === 'hidden' ? 'Hid' : 'Replied to'} a review of ${result.productName}`, { type: 'review', id }, ip);
  return (await views(deps.db, 'r.id = $1', [id]))[0]!;
}

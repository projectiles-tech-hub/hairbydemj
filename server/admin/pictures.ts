// Pictures staff add for the shop itself (added after module 21): the
// homepage's top banner and promotional banners (each with a desktop and a
// phone picture), category pictures and collection banners. They are resized
// like product photos (server/media/media.ts, "pictures for the shop").
//
//   POST /api/homepage/promos                        add a promotional banner (hidden until it is ready)
//   POST /api/homepage/:id/delete                    remove a promotional banner and its pictures
//   POST /api/homepage/:id/picture?slot=desktop|phone        upload (the body is the file)
//   POST /api/homepage/:id/picture/delete?slot=desktop|phone
//   POST /api/categories/:id/picture,  POST /api/categories/:id/picture/delete
//   POST /api/collections/:id/picture, POST /api/collections/:id/picture/delete
// All need the settings (homepage) or products (categories, collections) change permission.

import type { AccountDeps } from '../accounts/deps.js';
import { requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { ApiError, clientIp, sendJson, type RequestContext } from '../http.js';
import { MEDIA, receiveUpload, removeSitePicture, storeSitePicture, type MediaDeps, type SitePicture } from '../media/media.js';
import type { Router } from '../router.js';
import { listHomepage } from './api.js';

/** The most promotional banners at one time. */
export const MAX_PROMOS = 10;

type Slot = 'picture' | 'phonePicture';

function slotOf(ctx: RequestContext): Slot {
  const slot = ctx.query.get('slot') ?? 'desktop';
  if (slot !== 'desktop' && slot !== 'phone') throw new ApiError(422, 'invalid', 'Choose the desktop or phone picture.', { slot: 'Choose desktop or phone.' });
  return slot === 'phone' ? 'phonePicture' : 'picture';
}

export function adminPictureRoutes(router: Router, accounts: AccountDeps, media: MediaDeps): Router {
  const db = accounts.db;
  const staffFor = async (ctx: RequestContext, area: 'settings' | 'products'): Promise<StaffMember> => {
    requireSameOrigin(ctx);
    const { staff } = await requireStaff(accounts, ctx);
    requireAccess(staff, area, 'change');
    return staff;
  };
  const id = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };
  const log = (ctx: RequestContext, staff: StaffMember, area: string, what: string, target: { type: string; id: number }): Promise<void> =>
    logActivity(db, staff, area, what, target, clientIp(ctx.req, accounts.config.trustProxy));

  async function section(sectionId: number): Promise<{ kind: string; settings: Record<string, unknown> }> {
    const row = (await db.query('select kind, settings from homepage_sections where id = $1', [sectionId])).rows[0];
    if (!row) throw new ApiError(404, 'not_found', 'We could not find that section.');
    return { kind: String(row.kind), settings: (row.settings ?? {}) as Record<string, unknown> };
  }
  const pictureIn = (v: unknown): SitePicture | null => (v && typeof v === 'object' && typeof (v as SitePicture).path === 'string' ? (v as SitePicture) : null);

  return router
    .post('/api/homepage/promos', async (ctx) => {
      const staff = await staffFor(ctx, 'settings');
      const count = Number((await db.query("select count(*)::int as n from homepage_sections where kind = 'promo'")).rows[0]?.n ?? 0);
      if (count >= MAX_PROMOS) throw new ApiError(409, 'limit', `There can be up to ${MAX_PROMOS} promotional banners. Remove one first.`);
      const made = await db.query(
        "insert into homepage_sections (kind, position, is_shown, settings) values ('promo', (select coalesce(max(position), 0) + 1 from homepage_sections), false, '{}') returning id",
      );
      await log(ctx, staff, 'Content', 'Added a promotional banner to the homepage', { type: 'homepage_section', id: Number(made.rows[0]?.id) });
      sendJson(ctx.res, 201, { sections: await listHomepage(db) });
    })
    .post('/api/homepage/:id/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'settings');
      const s = await section(id(ctx));
      if (s.kind !== 'promo') throw new ApiError(409, 'not_removable', 'Only promotional banners can be removed. Hide this section instead.');
      await db.query('delete from homepage_sections where id = $1', [id(ctx)]);
      for (const slot of ['picture', 'phonePicture'] as const) {
        const pic = pictureIn(s.settings[slot]);
        if (pic) await removeSitePicture(media, pic.path);
      }
      await log(ctx, staff, 'Content', 'Removed a promotional banner from the homepage', { type: 'homepage_section', id: id(ctx) });
      sendJson(ctx.res, 200, { sections: await listHomepage(db) });
    })
    .post('/api/homepage/:id/picture', async (ctx) => {
      const staff = await staffFor(ctx, 'settings');
      const slot = slotOf(ctx);
      const s = await section(id(ctx));
      if (s.kind !== 'hero' && s.kind !== 'promo') throw new ApiError(409, 'no_picture', 'Only the top banner and promotional banners have pictures.');
      const upload = await receiveUpload(media, ctx.req, MEDIA.maxImageBytes);
      const pic = await storeSitePicture(media, upload, 'banner', `home/${id(ctx)}`);
      const old = pictureIn(s.settings[slot]);
      await db.query('update homepage_sections set settings = settings || $2::jsonb where id = $1', [id(ctx), JSON.stringify({ [slot]: pic })]);
      if (old) await removeSitePicture(media, old.path);
      await log(ctx, staff, 'Content', `Changed the ${slot === 'phonePicture' ? 'phone' : 'desktop'} picture of a homepage banner`, { type: 'homepage_section', id: id(ctx) });
      sendJson(ctx.res, 200, { sections: await listHomepage(db) });
    })
    .post('/api/homepage/:id/picture/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'settings');
      const slot = slotOf(ctx);
      const s = await section(id(ctx));
      const old = pictureIn(s.settings[slot]);
      await db.query('update homepage_sections set settings = settings - $2 where id = $1', [id(ctx), slot]);
      if (old) await removeSitePicture(media, old.path);
      await log(ctx, staff, 'Content', 'Removed a picture from a homepage banner', { type: 'homepage_section', id: id(ctx) });
      sendJson(ctx.res, 200, { sections: await listHomepage(db) });
    })
    .post('/api/categories/:id/picture', async (ctx) => {
      const staff = await staffFor(ctx, 'products');
      const old = (await db.query('select name, image_path from categories where id = $1', [id(ctx)])).rows[0];
      if (!old) throw new ApiError(404, 'not_found', 'We could not find that category.');
      const upload = await receiveUpload(media, ctx.req, MEDIA.maxImageBytes);
      const pic = await storeSitePicture(media, upload, 'card', `category/${id(ctx)}`);
      await db.query('update categories set image_path = $2, image_widths = $3 where id = $1', [id(ctx), pic.path, pic.widths]);
      if (old.image_path) await removeSitePicture(media, String(old.image_path));
      await log(ctx, staff, 'Products', `Changed the picture of the category "${String(old.name)}"`, { type: 'category', id: id(ctx) });
      sendJson(ctx.res, 200, { picture: pic });
    })
    .post('/api/categories/:id/picture/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'products');
      const old = (await db.query("update categories c set image_path = null, image_widths = '{}' from (select id, image_path from categories where id = $1) o where c.id = o.id returning c.name, o.image_path", [id(ctx)])).rows[0];
      if (!old) throw new ApiError(404, 'not_found', 'We could not find that category.');
      if (old.image_path) await removeSitePicture(media, String(old.image_path));
      await log(ctx, staff, 'Products', `Removed the picture of the category "${String(old.name)}"`, { type: 'category', id: id(ctx) });
      sendJson(ctx.res, 200, { picture: null });
    })
    .post('/api/collections/:id/picture', async (ctx) => {
      const staff = await staffFor(ctx, 'products');
      const old = (await db.query('select name, banner_path from collections where id = $1', [id(ctx)])).rows[0];
      if (!old) throw new ApiError(404, 'not_found', 'We could not find that collection.');
      const upload = await receiveUpload(media, ctx.req, MEDIA.maxImageBytes);
      const pic = await storeSitePicture(media, upload, 'banner', `collection/${id(ctx)}`);
      await db.query('update collections set banner_path = $2, banner_widths = $3 where id = $1', [id(ctx), pic.path, pic.widths]);
      if (old.banner_path) await removeSitePicture(media, String(old.banner_path));
      await log(ctx, staff, 'Products', `Changed the banner of the collection "${String(old.name)}"`, { type: 'collection', id: id(ctx) });
      sendJson(ctx.res, 200, { picture: pic });
    })
    .post('/api/collections/:id/picture/delete', async (ctx) => {
      const staff = await staffFor(ctx, 'products');
      const old = (await db.query("update collections c set banner_path = null, banner_widths = '{}' from (select id, banner_path from collections where id = $1) o where c.id = o.id returning c.name, o.banner_path", [id(ctx)])).rows[0];
      if (!old) throw new ApiError(404, 'not_found', 'We could not find that collection.');
      if (old.banner_path) await removeSitePicture(media, String(old.banner_path));
      await log(ctx, staff, 'Products', `Removed the banner of the collection "${String(old.name)}"`, { type: 'collection', id: id(ctx) });
      sendJson(ctx.res, 200, { picture: null });
    });
}

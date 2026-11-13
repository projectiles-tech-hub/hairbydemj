// The HTTP addresses for notifications.
//
//   Customers (website /api with cookies, app /v1 with the bearer token):
//     GET  /account/notifications         what they receive (preferences)
//     POST /account/notifications         change it: { ordersEmail, ordersPush, offersEmail, offersPush, backInStockEmail, backInStockPush }
//     GET  /notifications                 the in-app list, newest first, with the unread count
//     POST /notifications/read            { ids: [...] } or { all: true }
//     POST /newsletter                    { email } join the newsletter (signed in or not)
//   App only (/v1):
//     POST /v1/push/devices               { platform: ios | android, token } this phone gets push notifications
//     POST /v1/push/devices/delete        { token } stop (on sign-out)
//   Anyone with the link in an offers email (website):
//     GET  /unsubscribe?t=...             a page with one button
//     POST /unsubscribe?t=...             unsubscribe (also the one-click unsubscribe mail apps use)
//   Staff (admin, settings area):
//     GET  /api/messages                  every email, with staff's own wording if changed
//     POST /api/messages/:key             { subject, intro, emailEnabled }; empty text puts the original back
//     GET  /api/messages/:key/preview     the email as it looks, with sample details
//     POST /api/messages/:key/test        send it with sample details to the signed-in staff member

import type { AccountDeps } from '../accounts/deps.js';
import { currentCustomer, requireStaff } from '../accounts/routes.js';
import { logActivity, requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { ApiError, clientIp, escapeHtml, readJson, readRaw, sendHtml, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import { composeEmail, forgetDevice, listNotifications, markRead, readPreferences, readUnsubscribeToken, registerDevice, savePreferences, subscribeNewsletter, unsubscribe } from './notify.js';
import { TEMPLATES, templateFor } from './templates.js';

/** Made-up details for previews and test emails. */
const SAMPLE: Record<string, Record<string, string>> = {
  verify_email: { code: '482913', minutes: '10' },
  reset_password: { token: 'sample-token', minutes: '60' },
  password_changed: {},
  staff_invite: { name: 'Ada', token: 'sample-token', hours: '72', invitedBy: 'Emmanuel' },
  low_stock: { count: '2', items: 'Bone straight wig (WIG-22-180-NB): 1 left\nBody wave bundle (BW-18-NB): 2 left' },
  order_confirmation: { orderNumber: 'HBD-10001', orderToken: 'sample-token' },
  order_update: { orderNumber: 'HBD-10001', title: 'On its way', summary: 'Your order is on its way.' },
  order_cancelled: { orderNumber: 'HBD-10001', reason: 'Not paid in time.' },
  return_update: { returnNumber: 'RET-201', orderNumber: 'HBD-10001', status: 'approved' },
  store_credit: { code: 'ACDE-FGHJ-KMNP-QRTU', amountMinor: '9900000', currency: 'NGN', returnNumber: 'RET-201' },
  back_in_stock: { productName: 'Bone straight wig', slug: 'bone-straight-wig', variant: '22" Natural black' },
  abandoned_cart: { firstName: 'Ada', itemCount: '2' },
  newsletter_welcome: {},
};

export function shopNotificationRoutes(router: Router, accounts: AccountDeps, prefix: string, transport: 'cookie' | 'bearer'): Router {
  const signedIn = async (ctx: RequestContext): Promise<number> => {
    const who = await currentCustomer(accounts, ctx, transport);
    if (!who) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
    return who.customer.id;
  };
  const guard = (ctx: RequestContext): void => {
    if (transport === 'cookie') requireSameOrigin(ctx);
  };
  router
    .get(`${prefix}/account/notifications`, async (ctx) => {
      sendJson(ctx.res, 200, { preferences: await readPreferences(accounts.db, await signedIn(ctx)) });
    })
    .post(`${prefix}/account/notifications`, async (ctx) => {
      guard(ctx);
      const id = await signedIn(ctx);
      sendJson(ctx.res, 200, { preferences: await savePreferences(accounts.db, id, await readJson(ctx.req), accounts.now()) });
    })
    .get(`${prefix}/notifications`, async (ctx) => {
      sendJson(ctx.res, 200, await listNotifications(accounts.db, await signedIn(ctx)));
    })
    .post(`${prefix}/notifications/read`, async (ctx) => {
      guard(ctx);
      const id = await signedIn(ctx);
      await markRead(accounts.db, id, await readJson(ctx.req), accounts.now());
      sendJson(ctx.res, 200, await listNotifications(accounts.db, id));
    })
    .post(`${prefix}/newsletter`, async (ctx) => {
      guard(ctx);
      const who = await currentCustomer(accounts, ctx, transport);
      const result = await subscribeNewsletter(accounts.db, await readJson(ctx.req), who?.customer.id ?? null, accounts.now());
      // One welcome per address, ever.
      await accounts.db.query("insert into jobs (kind, payload, unique_key) values ('email.send', $1, $2) on conflict (unique_key) do nothing", [JSON.stringify({ to: result.email, template: 'newsletter_welcome', data: {} }), `newsletter_welcome:${result.email}`]);
      sendJson(ctx.res, 200, { subscribed: true });
    });
  if (transport === 'bearer') {
    router
      .post(`${prefix}/push/devices`, async (ctx) => {
        const id = await signedIn(ctx);
        await registerDevice(accounts.db, id, await readJson(ctx.req), accounts.now());
        sendJson(ctx.res, 200, { registered: true });
      })
      .post(`${prefix}/push/devices/delete`, async (ctx) => {
        const id = await signedIn(ctx);
        await forgetDevice(accounts.db, id, (await readJson(ctx.req)).token);
        sendJson(ctx.res, 200, { removed: true });
      });
  }
  return router;
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#040204;color:#e6d5be;font-family:"Source Sans 3",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}main{max-width:420px}h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;color:#cfa262;font-size:32px;margin:0 0 12px}p{line-height:1.5}button{background:#cfa262;color:#040204;border:0;border-radius:999px;padding:14px 24px;font:600 16px "Source Sans 3",system-ui,sans-serif;cursor:pointer}button:focus-visible{outline:2px solid #eac27f;outline-offset:3px}a{color:#eac27f}</style></head><body><main>${body}</main></body></html>`;

/** The unsubscribe page and the one-click address. No sign-in: the signed link is the permission. */
export function unsubscribeRoutes(router: Router, accounts: AccountDeps): Router {
  const headers = { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" };
  return router
    .get('/unsubscribe', async (ctx) => {
      const token = ctx.query.get('t') ?? '';
      const email = readUnsubscribeToken(accounts.config, token);
      if (!email) return sendHtml(ctx.res, 400, page('Link not valid', '<h1>This link is not valid</h1><p>It may have been cut short. Use the full link from the email, or change your choices under Email preferences in your account.</p>'), headers);
      sendHtml(ctx.res, 200, page('Unsubscribe', `<h1>Unsubscribe</h1><p>Stop offers and news from hairbydemj to <strong>${escapeHtml(email)}</strong>? You will still get emails about orders you place.</p><form method="post" action="/unsubscribe?t=${escapeHtml(encodeURIComponent(token))}"><button type="submit">Unsubscribe</button></form>`), headers);
    })
    .post('/unsubscribe', async (ctx) => {
      await readRaw(ctx.req, 4096);
      const email = readUnsubscribeToken(accounts.config, ctx.query.get('t') ?? '');
      if (!email) return sendHtml(ctx.res, 400, page('Link not valid', '<h1>This link is not valid</h1><p>Use the full link from the email.</p>'), headers);
      await unsubscribe(accounts.db, email, accounts.now());
      sendHtml(ctx.res, 200, page('Unsubscribed', `<h1>You are unsubscribed</h1><p>We will not send offers or news to ${escapeHtml(email)}. Changed your mind? Turn offers back on under Email preferences in your account.</p>`), headers);
    });
}

export function adminMessageRoutes(router: Router, accounts: AccountDeps): Router {
  const known = (ctx: RequestContext): string => {
    const key = String(ctx.params.key ?? '');
    if (!templateFor(key)) throw new ApiError(404, 'not_found', 'There is no email with that name.');
    return key;
  };
  const list = (): Promise<Array<Record<string, unknown>>> => listMessages(accounts.db);
  return routes(router, accounts, known, list);
}

/** Every email the shop sends, with the wording staff have changed. */
export async function listMessages(db: AccountDeps['db']): Promise<Array<Record<string, unknown>>> {
  const rows = await db.query('select key, subject, body, email_enabled, updated_at from message_templates');
  const byKey = new Map(rows.rows.map((r) => [String(r.key), r]));
  return TEMPLATES.map((t) => {
    const r = byKey.get(t.key);
    return {
      key: t.key,
      name: t.name,
      category: t.category,
      subject: (r?.subject as string) || t.subject,
      intro: (r?.body as string) || t.intro,
      changed: Boolean(r?.subject || r?.body),
      emailEnabled: r ? r.email_enabled !== false : true,
      // Sign-in and staff emails cannot be switched off.
      canSwitchOff: t.category !== 'account' && t.category !== 'staff',
      defaultSubject: t.subject,
      defaultIntro: t.intro,
    };
  });
}

function routes(router: Router, accounts: AccountDeps, known: (ctx: RequestContext) => string, list: () => Promise<Array<Record<string, unknown>>>): Router {
  return router
    .get('/api/messages', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'view');
      sendJson(ctx.res, 200, { messages: await list() });
    })
    .post('/api/messages/:key', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'change');
      const key = known(ctx);
      const t = templateFor(key)!;
      const input = await readJson(ctx.req);
      const text = (v: unknown, max: number, field: string): string | undefined => {
        if (v === undefined) return undefined;
        if (typeof v !== 'string' || v.length > max) throw new ApiError(422, 'invalid', 'Check the wording.', { [field]: `Use at most ${max} characters.` });
        return v.trim();
      };
      const subject = text(input.subject, 150, 'subject');
      const intro = text(input.intro, 1000, 'intro');
      if (input.emailEnabled !== undefined && typeof input.emailEnabled !== 'boolean') throw new ApiError(422, 'invalid', 'Choose on or off.', { emailEnabled: 'Choose on or off.' });
      if (input.emailEnabled === false && (t.category === 'account' || t.category === 'staff')) throw new ApiError(422, 'invalid', 'This email is needed for signing in and cannot be switched off.', { emailEnabled: 'This email cannot be switched off.' });
      await accounts.db.query(
        `insert into message_templates (key, name, subject, body, email_enabled) values ($1, $2, coalesce($3, ''), coalesce($4, ''), coalesce($5, true))
         on conflict (key) do update set subject = coalesce($3, message_templates.subject), body = coalesce($4, message_templates.body), email_enabled = coalesce($5, message_templates.email_enabled)`,
        [key, t.name, subject ?? null, intro ?? null, typeof input.emailEnabled === 'boolean' ? input.emailEnabled : null],
      );
      await logActivity(accounts.db, staff, 'Settings', `Changed the "${t.name}" email`, { type: 'message', id: key }, clientIp(ctx.req, accounts.config.trustProxy));
      sendJson(ctx.res, 200, { messages: await list() });
    })
    .get('/api/messages/:key/preview', async (ctx) => {
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'view');
      const key = known(ctx);
      const email = await composeEmail(accounts.db, accounts.config, 'customer@example.com', key, SAMPLE[key] ?? {});
      if (!email) return sendHtml(ctx.res, 200, page('Switched off', '<h1>This email is switched off</h1>'));
      sendHtml(ctx.res, 200, email.html, { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    })
    .post('/api/messages/:key/test', async (ctx) => {
      requireSameOrigin(ctx);
      const { staff } = await requireStaff(accounts, ctx);
      requireAccess(staff, 'settings', 'view');
      const key = known(ctx);
      await accounts.db.query("insert into jobs (kind, payload) values ('email.send', $1)", [JSON.stringify({ to: staff.email, template: key, data: SAMPLE[key] ?? {}, test: true })]);
      sendJson(ctx.res, 200, { sentTo: staff.email });
    });
}

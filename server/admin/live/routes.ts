// The live admin's pages, on admin.hairbydemj.com. Every page is built on the
// server from real data; the browser script (browser/staff.ts) sends the
// forms and buttons to the same /api addresses the app and tests use.

import type { AccountDeps } from '../../accounts/deps.js';
import { can, type Area } from '../../accounts/staff.js';
import { ApiError, type RequestContext } from '../../http.js';
import type { Router } from '../../router.js';
import { categories, discountEditor, discounts, inventory, productEditor, products } from './catalog.js';
import { chatInbox } from './chat.js';
import { giftCards, loyaltyPage as loyaltyAdmin, reviewsPage as reviewsAdmin } from './loyalty.js';
import { customerPage, customers, dashboard, orderDetail, orders, reports, returnDetail, returns } from './sales.js';
import { activityPage, contentEditor, contentList, emails, homepage, invitePage, paymentsPage, shippingPage, signInPage, staffPage, storeSettings, systemPage, type LiveExtras } from './settings.js';
import { adminContext, adminDocument, sendAdmin, type AdminContext } from './view.js';

type Rendered = string | { title?: string; body: string; after?: string } | null;

/** The "not found" page for the admin, without the staff member's details. */
export function adminNotFoundHtml(): string {
  return adminDocument({ title: 'Page not found', body: '<div class="aempty"><h1 class="h2">Page not found</h1><p class="muted">The address may be mistyped, or the item may have been removed.</p><p><a class="btn btn--primary" href="/">Go to the dashboard</a></p></div>' });
}

function idOf(ctx: RequestContext): number | null {
  const n = Number(ctx.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function liveAdminRoutes(router: Router, deps: AccountDeps, extras: LiveExtras = {}): Router {
  /**
   * A page for signed-in staff. `area` is what they must be allowed to see
   * ('owner' for the Owner only). Signed-out visitors go to sign in and come back.
   */
  const page = (title: string, area: Area | 'owner' | null, render: (ac: AdminContext, ctx: RequestContext) => Promise<Rendered>, current?: string) => async (ctx: RequestContext): Promise<void> => {
    const ac = await adminContext(deps, ctx);
    if (!ac) {
      ctx.res.writeHead(302, { Location: `/sign-in/?next=${encodeURIComponent(ctx.path + (ctx.query.toString() ? `?${ctx.query.toString()}` : ''))}`, 'Cache-Control': 'no-store' });
      ctx.res.end();
      return;
    }
    const allowed = area === null || (area === 'owner' ? ac.staff.isOwner : can(ac.staff, area, 'view'));
    if (!allowed) {
      sendAdmin(ctx, 403, adminDocument({ title: 'Not allowed', ac, current, body: '<div class="aempty"><h1 class="h2">Your role does not include this page</h1><p class="muted">Ask the store owner if you need it.</p></div>' }));
      return;
    }
    let out: Rendered;
    try {
      out = await render(ac, ctx);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) out = null;
      else throw error;
    }
    if (out === null) {
      sendAdmin(ctx, 404, adminDocument({ title: 'Not found', ac, current, body: '<div class="aempty"><h1 class="h2">We could not find that</h1><p class="muted">It may have been removed.</p></div>' }));
      return;
    }
    const o = typeof out === 'string' ? { body: out } : out;
    sendAdmin(ctx, 200, adminDocument({ title: o.title ?? title, body: o.body, after: o.after, ac, current }));
  };

  const invite = async (ctx: RequestContext): Promise<void> => {
    const token = ctx.query.get('token') ?? '';
    const body = /^[A-Za-z0-9_-]{20,200}$/.test(token) ? invitePage(token) : '<div class="aempty"><h1 class="h2">This link is not complete</h1><p class="muted">Open the link from your invitation email again, or ask the store owner for a new one.</p></div>';
    sendAdmin(ctx, 200, adminDocument({ title: 'Set up your account', body }));
  };

  return router
    .get('/sign-in/', async (ctx) => {
      // Already signed in: straight on.
      if (await adminContext(deps, ctx)) {
        const next = ctx.query.get('next') ?? '/';
        ctx.res.writeHead(302, { Location: next.startsWith('/') && !next.startsWith('//') ? next : '/', 'Cache-Control': 'no-store' });
        ctx.res.end();
        return;
      }
      sendAdmin(ctx, 200, adminDocument({ title: 'Sign in', body: signInPage() }));
    })
    // The emailed invitation uses /invite/; the owner command prints /accept-invite/.
    .get('/accept-invite/', invite)
    .get('/invite/', invite)
    .get('/', page('Dashboard', null, (ac) => dashboard(ac)))
    .get('/orders/', page('Orders', 'orders', (ac) => orders(ac)))
    .get('/orders/:id/', page('Order', 'orders', (ac, ctx) => (idOf(ctx) ? orderDetail(ac, idOf(ctx)!) : Promise.resolve(null)), '/orders/'))
    .get('/returns/', page('Returns', 'returns', (ac) => returns(ac)))
    .get('/returns/:id/', page('Return', 'returns', (ac, ctx) => (idOf(ctx) ? returnDetail(ac, idOf(ctx)!) : Promise.resolve(null)), '/returns/'))
    .get('/customers/', page('Customers', 'customers', (ac) => customers(ac)))
    .get('/customers/:id/', page('Customer', 'customers', (ac, ctx) => (idOf(ctx) ? customerPage(ac, idOf(ctx)!) : Promise.resolve(null)), '/customers/'))
    .get('/products/', page('Products', 'products', (ac) => products(ac)))
    .get('/products/new/', page('Add a product', 'products', (ac) => productEditor(ac, null), '/products/'))
    .get('/products/:id/', page('Product', 'products', (ac, ctx) => (idOf(ctx) ? productEditor(ac, idOf(ctx)!) : Promise.resolve(null)), '/products/'))
    .get('/categories/', page('Categories and collections', 'products', (ac) => categories(ac)))
    .get('/inventory/', page('Inventory', 'products', (ac) => inventory(ac)))
    .get('/discounts/', page('Discounts', 'discounts', (ac) => discounts(ac)))
    .get('/discounts/new/', page('Add a discount', 'discounts', (ac) => discountEditor(ac, null), '/discounts/'))
    .get('/discounts/:id/', page('Discount', 'discounts', (ac, ctx) => (idOf(ctx) ? discountEditor(ac, idOf(ctx)!) : Promise.resolve(null)), '/discounts/'))
    .get('/chat/', page('Live chat inbox', 'customers', (ac) => chatInbox(ac)))
    .get('/gift-cards/', page('Gift cards', 'discounts', (ac) => giftCards(ac)))
    .get('/loyalty/', page('Loyalty and referrals', 'discounts', (ac) => loyaltyAdmin(ac)))
    .get('/reviews/', page('Reviews', 'products', (ac) => reviewsAdmin(ac)))
    .get('/homepage/', page('Homepage', 'settings', (ac) => homepage(ac)))
    .get('/content/', page('Content pages', 'settings', (ac) => contentList(ac)))
    .get('/content/new/', page('Add a page', 'settings', (ac) => contentEditor(ac, null), '/content/'))
    .get('/content/:id/', page('Content page', 'settings', (ac, ctx) => (idOf(ctx) ? contentEditor(ac, idOf(ctx)!) : Promise.resolve(null)), '/content/'))
    .get('/emails/', page('Emails', 'settings', (ac) => emails(ac)))
    .get('/shipping/', page('Shipping settings', 'settings', (ac) => shippingPage(ac, extras)))
    .get('/payments/', page('Payments and currencies', 'settings', (ac) => paymentsPage(ac, extras)))
    .get('/reports/', page('Reports', 'reports', (ac) => reports(ac)))
    .get('/staff/', page('Staff and roles', 'owner', (ac) => staffPage(ac)))
    .get('/activity/', page('Activity log', 'settings', (ac) => activityPage(ac)))
    .get('/settings/', page('Store settings', 'settings', (ac) => storeSettings(ac)))
    .get('/system/', page('System', 'settings', (ac) => systemPage(ac)));
}


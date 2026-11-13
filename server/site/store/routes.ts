// The live website's pages, on hairbydemj.com. Each page is built on the
// server with real data and works without the browser script; the script
// (browser/store.ts) makes adding to the bag, checkout and forms smoother.

import { hashToken } from '../../accounts/crypto.js';
import type { AccountDeps } from '../../accounts/deps.js';
import { requireSameOrigin } from '../../accounts/web.js';
import { ApiError, clientIp, readRaw, sendJson, sendText, type RequestContext } from '../../http.js';
import { lookUpOrder, orderView } from '../../orders/orders.js';
import type { Router } from '../../router.js';
import * as account from './account.js';
import { cartPage, checkoutPage, completePage, miniCartHtml } from './checkout.js';
import { infoPage, notFoundBody, robotsTxt, sitemapXml } from './info.js';
import { tryOnPage } from './tryon.js';
import { giftCardsPage, loyaltyPage, reviewsPage, writeReviewPage } from './loyalty.js';
import { categoryPage, homePage, lookPage, looksPage, moreCards, productPage, searchPage } from './shop.js';
import { PAGE_HEADERS, sendPage, siteContext, siteOrigin, storePage, type SiteContext } from './view.js';

/** The "not found" page, without the visitor's details (used for any unknown address). */
export function notFoundHtml(): string {
  return storePage(null, { title: 'Page not found', body: notFoundBody(), noindex: true });
}

export function storeRoutes(router: Router, deps: AccountDeps): Router {
  const page = (render: (sc: SiteContext, ctx: RequestContext) => Promise<boolean | void>) => async (ctx: RequestContext): Promise<void> => {
    const sc = await siteContext(deps, ctx);
    const done = await render(sc, ctx);
    if (done === false) sendPage(sc, { title: 'Page not found', body: notFoundBody(), noindex: true, status: 404 });
  };
  /** A page only for signed-in customers; others go to sign in and come back. */
  const signedIn = (render: (sc: SiteContext, ctx: RequestContext) => Promise<boolean | void>) =>
    page(async (sc, ctx) => {
      if (!sc.customer) {
        ctx.res.writeHead(302, { Location: `/sign-in/?next=${encodeURIComponent(ctx.path)}`, 'Cache-Control': 'no-store' });
        ctx.res.end();
        return;
      }
      return render(sc, ctx);
    });

  router
    .get('/', page(async (sc) => sendPage(sc, { ...(await homePage(sc)), canonical: '/' })))
    .get('/c/:slug/', page(async (sc, ctx) => {
      const p = await categoryPage(sc, String(ctx.params.slug));
      if (!p) return false;
      sendPage(sc, { ...p, canonical: `/c/${String(ctx.params.slug)}/`, noindex: ctx.query.toString() !== '' });
    }))
    .get('/search/', page(async (sc) => sendPage(sc, { ...(await searchPage(sc)), noindex: true })))
    .get('/products/:slug/', page(async (sc, ctx) => {
      const p = await productPage(sc, String(ctx.params.slug));
      if (!p) return false;
      sendPage(sc, p);
    }))
    .get('/try-on/', page(async (sc) => sendPage(sc, { ...(await tryOnPage(sc)), canonical: '/try-on/', tryOn: true, modules: ['/js/try-on.js'] })))
    .get('/looks/', page(async (sc) => sendPage(sc, { ...(await looksPage(sc)), canonical: '/looks/' })))
    .get('/looks/:slug/', page(async (sc, ctx) => {
      const p = await lookPage(sc, String(ctx.params.slug));
      if (!p) return false;
      sendPage(sc, { ...p, canonical: `/looks/${String(ctx.params.slug)}/` });
    }))
    .get('/cart/', page(async (sc) => sendPage(sc, { ...(await cartPage(sc)), noindex: true })))
    .get('/checkout/', page(async (sc) => sendPage(sc, { ...(await checkoutPage(sc)), noindex: true })))
    .get('/checkout/complete/', page(async (sc) => sendPage(sc, { ...completePage(sc), noindex: true })))
    .get('/sign-in/', page(async (sc) => sendPage(sc, { ...account.signInPage(sc), noindex: true })))
    .get('/create-account/', page(async (sc, ctx) => sendPage(sc, { ...account.createAccountPage(ctx.query.get('ref') ?? ''), noindex: true })))
    .get('/verify-email/', page(async (sc) => sendPage(sc, { ...account.verifyEmailPage(sc), noindex: true })))
    .get('/forgot-password/', page(async (sc) => sendPage(sc, { ...account.forgotPasswordPage(), noindex: true })))
    .get('/reset-password/', page(async (sc) => sendPage(sc, { ...account.resetPasswordPage(sc), noindex: true })))
    .get('/account/', signedIn(async (sc) => sendPage(sc, { ...(await account.overviewPage(sc)), noindex: true })))
    .get('/account/orders/', signedIn(async (sc) => sendPage(sc, { ...(await account.ordersPage(sc)), noindex: true })))
    .get('/account/orders/:number/', signedIn(async (sc, ctx) => {
      const p = await account.orderPage(sc, String(ctx.params.number));
      if (!p) return false;
      sendPage(sc, { ...p, noindex: true });
    }))
    .get('/account/addresses/', signedIn(async (sc) => sendPage(sc, { ...(await account.addressesPage(sc)), noindex: true })))
    .get('/account/profile/', signedIn(async (sc) => sendPage(sc, { ...(await account.profilePage(sc)), noindex: true })))
    .get('/account/preferences/', signedIn(async (sc) => sendPage(sc, { ...(await account.preferencesPage(sc)), noindex: true })))
    .get('/account/loyalty/', signedIn(async (sc) => sendPage(sc, { ...(await loyaltyPage(sc)), noindex: true })))
    .get('/account/reviews/', signedIn(async (sc) => sendPage(sc, { ...(await reviewsPage(sc)), noindex: true })))
    .get('/account/reviews/new/', signedIn(async (sc) => {
      const p = await writeReviewPage(sc);
      if (!p) return false;
      sendPage(sc, { ...p, noindex: true });
    }))
    .get('/gift-cards/', page(async (sc) => sendPage(sc, { ...(await giftCardsPage(sc)), canonical: '/gift-cards/' })))
    .get('/account/wishlist/', signedIn(async (sc) => sendPage(sc, { ...(await account.wishlistPage(sc)), noindex: true })))
    .get('/track-order/', page(async (sc, ctx) => {
      // With the private link from the order email, the order shows straight away.
      const number = (ctx.query.get('order') ?? '').toUpperCase();
      const token = ctx.query.get('token') ?? '';
      if (number && token && token.length <= 200) {
        const found = await deps.db.query('select id, access_token_hash from orders where number = $1', [number]);
        const row = found.rows[0];
        if (row?.access_token_hash && hashToken(token).equals(row.access_token_hash as Buffer)) {
          const view = await orderView(deps.db, Number(row.id), sc.now, 'customer');
          return sendPage(sc, { title: `Order ${view.number}`, noindex: true, scripts: account.stripeFor(view), body: `<h1 class="h1">Order ${view.number}</h1>${account.orderDetail(sc, view, { token, canAct: true })}` });
        }
      }
      sendPage(sc, { title: 'Track your order', noindex: true, body: account.trackOrderForm(number && token ? 'That link is not complete. Enter your order number and email instead.' : '') });
    }))
    .post('/track-order/', page(async (sc, ctx) => {
      requireSameOrigin(ctx);
      const form = new URLSearchParams((await readRaw(ctx.req, 4096)).toString('utf8'));
      try {
        const view = await lookUpOrder(deps.db, { number: form.get('number') ?? '', email: form.get('email') ?? '' }, clientIp(ctx.req, deps.config.trustProxy), sc.now);
        sendPage(sc, { title: `Order ${view.number}`, noindex: true, body: `<h1 class="h1">Order ${view.number}</h1>${account.orderDetail(sc, view, { token: null, canAct: false })}` });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        sendPage(sc, { title: 'Track your order', noindex: true, status: error.status === 429 ? 429 : 200, body: account.trackOrderForm(error.message) });
      }
    }))
    // Fragments of HTML for the browser script: the mini-bag and more products.
    .get('/api/site/mini-cart', async (ctx) => {
      const sc = await siteContext(deps, ctx);
      sendJson(ctx.res, 200, await miniCartHtml(sc));
    })
    .get('/api/site/products', async (ctx) => {
      const sc = await siteContext(deps, ctx);
      sendJson(ctx.res, 200, await moreCards(sc));
    })
    .get('/sitemap.xml', async (ctx) => {
      const sc = await siteContext(deps, ctx);
      ctx.res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      ctx.res.end(await sitemapXml(sc));
    })
    .get('/robots.txt', async (ctx) => sendText(ctx.res, 200, robotsTxt(siteOrigin(deps)), { 'Cache-Control': 'public, max-age=3600' }));

  // Information pages, at their own short addresses.
  for (const slug of ['about', 'contact', 'faq', 'guides', 'shipping', 'returns', 'privacy', 'terms', 'cookies']) {
    router.get(`/${slug}/`, page(async (sc) => {
      const p = await infoPage(sc, slug);
      if (!p) return false;
      sendPage(sc, p);
    }));
  }
  router.get('/guides/length-and-density/', page(async (sc) => {
    const p = await infoPage(sc, 'length-and-density');
    if (!p) return false;
    sendPage(sc, p);
  }));
  return router;
}

export { PAGE_HEADERS };

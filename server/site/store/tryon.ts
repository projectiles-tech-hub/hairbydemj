// The camera try-on page (module 16). Everything happens in the visitor's
// browser: the camera picture is never sent anywhere. MediaPipe's face
// tracking and its model are served from our own server (docs/try-on.md).

import { tryOnProducts } from '../../tryon/tryon.js';
import { button, icon } from '../components.js';
import { each, esc } from '../html.js';
import { crumbs, money, type SiteContext } from './view.js';

export async function tryOnPage(sc: SiteContext): Promise<{ title: string; description: string; body: string }> {
  const products = await tryOnProducts(sc.deps.db, sc.currency.code, sc.now);
  const wanted = sc.ctx.query.get('product');
  const start = products.find((p) => p.slug === wanted) ?? products[0];
  const description = 'See a wig on you with your camera before you buy. Nothing is uploaded or saved.';
  if (!start) {
    return {
      title: 'Try on',
      description,
      body: `${crumbs([['Home', '/'], ['Try on']])}<h1 class="h1">Try on</h1><p class="muted">No wigs can be tried on yet. Please check back soon.</p>${button('Shop wigs', { href: '/search/?q=wig' })}`,
    };
  }
  // What the script needs: each style's pictures, as plain data.
  const data = products.map((p) => ({
    slug: p.slug,
    name: p.name,
    price: p.priceFromMinor === null ? null : money(sc, p.priceFromMinor),
    images: p.images.map((i) => ({ colour: i.colour, src: `/media/${i.path}/1200.png`, width: i.width, height: i.height, temples: i.temples })),
  }));
  return {
    title: 'Try on',
    description,
    body: `${crumbs([['Home', '/'], ['Try on']])}
<h1 class="h1">Try on</h1>
<div class="tryon" data-tryon data-start="${esc(start.slug)}" data-currency="${esc(sc.currency.code)}">
<script type="application/json" data-tryon-styles>${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<div class="tryon__stage" data-stage>
  <video class="tryon__video" data-video playsinline muted aria-hidden="true"></video>
  <canvas class="tryon__canvas" data-canvas role="img" aria-label="Your camera picture with the wig on"></canvas>
  <div class="tryon__panel stack" data-ask>
    <span class="tryon__badge">${icon('camera', 28)}</span>
    <h2 class="h2">See the wig on you</h2>
    <p class="muted">The try-on needs your camera. The picture stays in your browser; nothing is uploaded or saved unless you choose Save photo.</p>
    ${button('Allow camera', { attrs: 'data-start-camera', fullPhone: true })}
    <label class="btn btn--secondary btn--full-phone tryon__upload">Upload a photo instead<input type="file" accept="image/*" data-photo hidden></label>
    <a class="link small" href="/products/${esc(start.slug)}/" data-not-now>Not now</a>
  </div>
  <div class="tryon__panel stack" data-refused hidden>
    <span class="tryon__badge">${icon('camera', 28)}</span>
    <h2 class="h2">The camera is off for this site</h2>
    <p class="muted">To use the try-on, allow the camera for hairbydemj.com in your browser's site settings, then reload the page. Or upload a photo of yourself instead.</p>
    <label class="btn btn--primary btn--full-phone tryon__upload">Upload a photo instead<input type="file" accept="image/*" data-photo hidden></label>
  </div>
  <p class="tryon__status small" role="status" aria-live="polite" data-status></p>
</div>
<div class="tryon__bar row">
  <button class="btn btn--text" type="button" data-switch hidden>Switch camera</button>
  <label class="tryon__colour" for="tryon-colour"><span class="small">Colour</span> <select class="field__input" id="tryon-colour" data-colour></select></label>
  <label class="tryon__colour" for="tryon-length"><span class="small">Length</span> <select class="field__input" id="tryon-length" data-length></select></label>
</div>
<div class="tryon__styles" role="radiogroup" aria-label="Styles to try">
${each(data, (p) => `<button class="tryon__style" type="button" role="radio" aria-checked="false" data-style="${esc(p.slug)}"><img src="${esc(p.images[0]?.src ?? '')}" alt="" loading="lazy"><span class="small">${esc(p.name)}</span>${p.price ? `<span class="small muted">From ${esc(p.price)}</span>` : ''}</button>`)}
</div>
<div class="row tryon__actions">
  ${button('Add to bag', { attrs: 'data-tryon-add disabled', fullPhone: true })}
  ${button('Save photo', { kind: 'secondary', attrs: 'data-save disabled', fullPhone: true })}
  <a class="link" href="/products/${esc(start.slug)}/" data-product-link>See this wig's details</a>
</div>
<p class="small" role="status" aria-live="polite" data-add-status></p>
</div>`,
  };
}

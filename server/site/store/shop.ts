// Shopping pages with real products: home, category lists with filters,
// search results, product pages and shop-the-look sets.

import { getLook, getProduct, listCollections, sectionShowsNow, listFilters, listProducts, SORTS, type ProductPage, type ProductQuery, type Sort } from '../../catalog/public.js';
import { ApiError } from '../../http.js';
import { accordion, button, card, icon, sectionHead } from '../components.js';
import { each, esc } from '../html.js';
import { productReviewsSection } from './loyalty.js';
import { bannerPicture, crumbs, money, picture, priceRange, productGrid, type BannerPicture, type SiteContext } from './view.js';

const SORT_LABELS: Record<Sort, string> = { newest: 'Newest', best_selling: 'Best-selling', price_low: 'Price: low to high', price_high: 'Price: high to low', name: 'Name', relevance: 'Best match' };

/** Filters and sort from the page address, in the shape the product list takes. */
export function queryFromUrl(sc: SiteContext, extra: Partial<ProductQuery> = {}): ProductQuery {
  const q = sc.ctx.query;
  const list = (name: string): string[] => q.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean).slice(0, 20);
  const nums = (name: string): number[] => list(name).map((v) => Number(v.replace(/"/g, ''))).filter((n) => Number.isInteger(n) && n > 0 && n < 1000);
  const minor = (name: string): number | undefined => {
    const v = q.get(name);
    if (!v) return undefined;
    const n = Number(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** sc.currency.minorUnits) : undefined;
  };
  const sort = q.get('sort');
  return {
    currency: sc.currency.code,
    textures: list('texture'),
    origins: list('origin'),
    laceTypes: list('lace_type'),
    colours: list('colour'),
    lengths: nums('length'),
    densities: nums('density'),
    minPriceMinor: minor('min_price'),
    maxPriceMinor: minor('max_price'),
    inStock: q.get('in_stock') === '1',
    sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : undefined,
    cursor: q.get('cursor') ?? undefined,
    limit: 24,
    ...extra,
  };
}

/** The address of the next page of a list, keeping the filters. */
function nextHref(sc: SiteContext, cursor: string): string {
  const params = new URLSearchParams(sc.ctx.query);
  params.set('cursor', cursor);
  return `${sc.ctx.path}?${params.toString()}`;
}

function filterForm(sc: SiteContext, filters: Awaited<ReturnType<typeof listFilters>>, keep: Record<string, string>): string {
  const q = sc.ctx.query;
  const chosen = (name: string): string[] => q.getAll(name).flatMap((v) => v.split(','));
  const group = (legend: string, name: string, values: ReadonlyArray<string | number>, label: (v: string | number) => string = String): string =>
    values.length < 2
      ? ''
      : `<fieldset class="stack stack--sm"><legend class="strong small" style="margin-bottom:8px">${esc(legend)}</legend><div class="chips">${each(values, (v) => `<label class="chip"><input type="checkbox" name="${name}" value="${esc(String(v))}"${chosen(name).includes(String(v)) ? ' checked' : ''}><span>${esc(label(v))}</span></label>`)}</div></fieldset>`;
  const major = (minor: number | null): string => (minor === null ? '' : String(Math.round(minor / 10 ** sc.currency.minorUnits)));
  return `<form class="filters-side stack" method="get" action="${esc(sc.ctx.path)}" aria-label="Filters" data-filters>
${each(Object.entries(keep), ([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)}
${group('Texture', 'texture', filters.textures)}
${group('Length', 'length', filters.lengths, (v) => `${v}"`)}
${group('Density', 'density', filters.densities, (v) => `${v}%`)}
${group('Lace', 'lace_type', filters.laceTypes)}
${group('Colour', 'colour', filters.colours)}
${group('Origin', 'origin', filters.origins)}
<fieldset class="stack stack--sm"><legend class="strong small" style="margin-bottom:8px">Price (${esc(sc.currency.code)})</legend><div class="fields fields--2">
<div class="field"><label class="field__label" for="min-price">From</label><input class="field__input" id="min-price" name="min_price" inputmode="numeric" placeholder="${esc(major(filters.minPriceMinor))}" value="${esc(q.get('min_price') ?? '')}"></div>
<div class="field"><label class="field__label" for="max-price">To</label><input class="field__input" id="max-price" name="max_price" inputmode="numeric" placeholder="${esc(major(filters.maxPriceMinor))}" value="${esc(q.get('max_price') ?? '')}"></div></div></fieldset>
<label class="check"><input type="checkbox" name="in_stock" value="1"${q.get('in_stock') === '1' ? ' checked' : ''}><span>In stock only</span></label>
<div class="field"><label class="field__label" for="sort">Sort by</label><select class="field__input" id="sort" name="sort">${each(SORTS.filter((s) => s !== 'relevance' || keep.q), (s) => `<option value="${s}"${q.get('sort') === s ? ' selected' : ''}>${esc(SORT_LABELS[s])}</option>`)}</select></div>
${button('Show products', { type: 'submit', full: true })}
<a class="link small" href="${esc(sc.ctx.path)}${keep.q ? `?q=${encodeURIComponent(keep.q)}` : ''}">Clear all</a>
</form>`;
}

function listBody(sc: SiteContext, page: ProductPage): string {
  if (page.products.length === 0) return '';
  return `${productGrid(sc, page.products, { id: 'product-list', cols: 3 })}
<p class="small muted" data-count>${page.total !== undefined ? `${page.total} ${page.total === 1 ? 'product' : 'products'}` : ''}</p>
${page.nextCursor ? `<div class="center" data-more-wrap>${button('Show more products', { kind: 'secondary', href: nextHref(sc, page.nextCursor), attrs: `data-more="${esc(page.nextCursor)}"` })}</div>` : ''}`;
}

export async function homePage(sc: SiteContext): Promise<{ title: string; body: string; jsonLd: unknown[] }> {
  const base = { currency: sc.currency.code, limit: 4 };
  const [best, fresh, looks] = await Promise.all([listProducts(sc.deps, { ...base, sort: 'best_selling' }), listProducts(sc.deps, { ...base, sort: 'newest' }), listCollections(sc.deps, { looks: true })]);
  const first = sc.categories[0];
  // Staff choose the order, which sections show, the banners' words and pictures, and when and where
  // each shows, in the admin (Homepage).
  const rows = await sc.deps.db.query('select id, kind, position, is_shown, settings, show_from, show_until, countries from homepage_sections order by position, id');
  const showsNow = (r: Record<string, unknown>): boolean =>
    sectionShowsNow({ isShown: r.is_shown === true, showFrom: (r.show_from as Date | null) ?? null, showUntil: (r.show_until as Date | null) ?? null, countries: ((r.countries as string[] | null) ?? []).map(String) }, sc.now, sc.country);
  const layout = new Map(rows.rows.filter((r) => r.kind !== 'promo').map((r) => [String(r.kind), { shown: showsNow(r), position: Number(r.position), settings: (r.settings ?? {}) as Record<string, unknown> }]));
  const promos = rows.rows.filter((r) => r.kind === 'promo' && showsNow(r)).map((r) => ({ id: Number(r.id), position: Number(r.position), settings: (r.settings ?? {}) as Record<string, unknown> }));
  const pic = (v: unknown): BannerPicture | null => (v && typeof v === 'object' && typeof (v as BannerPicture).path === 'string' && Array.isArray((v as BannerPicture).widths) ? (v as BannerPicture) : null);
  let firstBanner = true;
  const bannerMedia = (settings: Record<string, unknown>, alt: string): string => {
    const html = bannerPicture(pic(settings.picture), pic(settings.phonePicture), { alt, eager: firstBanner });
    firstBanner = false;
    return html;
  };
  const DEFAULT_ORDER = ['hero', 'collections', 'best_sellers', 'new_arrivals', 'shop_the_look'];
  const word = (kind: string, key: string, fallback: string): string => {
    const v = layout.get(kind)?.settings[key];
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
  };
  const parts: Record<string, () => string> = {
    hero: () => `<section class="hero" aria-labelledby="hero-h">
${bannerMedia(layout.get('hero')?.settings ?? {}, word('hero', 'alt', 'hairbydemj'))}
<div class="hero__copy"><h1 class="display" id="hero-h">${esc(word('hero', 'headline', 'Hair that moves the way you do'))}</h1>
<p class="body-large">${esc(word('hero', 'sentence', 'Human hair wigs, bundles and closures. Sent from Benin City to your door, anywhere in the world.'))}</p>
<div class="row">${button(word('hero', 'buttonLabel', 'Shop new arrivals'), { href: word('hero', 'buttonLink', first ? `/c/${first.slug}/?sort=newest` : '/search/?q='), fullPhone: true })}</div></div>
</section>`,
    collections: () => (sc.categories.length ? `<section class="stack" aria-label="${esc(word('collections', 'title', 'Shop by category'))}">${sectionHead(word('collections', 'title', 'Shop by category'))}<div class="grid" style="--cols:4;--cols-tablet:4;--cols-phone:2">${each(sc.categories.slice(0, 8), (c) => `<a class="card stack stack--sm" href="/c/${esc(c.slug)}/" style="text-decoration:none">${c.image ? picture(c.image, { alt: '', ratio: '1 / 1', sizes: '(max-width: 599px) 50vw, 25vw' }) : ''}<span class="strong">${esc(c.name)}</span><span class="small muted">${c.productCount} ${c.productCount === 1 ? 'product' : 'products'}</span></a>`)}</div></section>` : ''),
    best_sellers: () => (best.products.length ? `<section class="stack" aria-label="${esc(word('best_sellers', 'title', 'Best-sellers'))}">${sectionHead(word('best_sellers', 'title', 'Best-sellers'))}${productGrid(sc, best.products)}</section>` : ''),
    new_arrivals: () => (fresh.products.length ? `<section class="stack" aria-label="${esc(word('new_arrivals', 'title', 'New arrivals'))}">${sectionHead(word('new_arrivals', 'title', 'New arrivals'))}${productGrid(sc, fresh.products)}</section>` : ''),
    shop_the_look: () => (looks.length ? `<section class="stack" aria-label="${esc(word('shop_the_look', 'title', 'Shop the look'))}">${sectionHead(word('shop_the_look', 'title', 'Shop the look'), ['See all looks', '/looks/'])}<div class="grid" style="--cols:3;--cols-tablet:2;--cols-phone:1">${each(looks.slice(0, 3), (l) => card(`${l.banner ? picture(l.banner, { alt: '', ratio: '16 / 9', sizes: '(max-width: 599px) 100vw, 33vw' }) : ''}<h3 class="h3"><a href="/looks/${esc(l.slug)}/">${esc(l.name)}</a></h3><p class="muted">${esc(l.description)}</p>`))}</div></section>` : ''),
    // Reviews arrive with module 17.
  };
  // Promotional banners: as many as staff add, each placed by its position.
  const promo = (p: { id: number; settings: Record<string, unknown> }): string => {
    const t = (key: string): string => (typeof p.settings[key] === 'string' ? (p.settings[key] as string).trim() : '');
    const link = t('buttonLink');
    const words = t('headline') || t('sentence') || (t('buttonLabel') && link);
    return `<section class="hero hero--promo"${t('headline') ? ` aria-labelledby="promo-${p.id}"` : ' aria-label="Offer"'}>${bannerMedia(p.settings, t('alt') || t('headline') || 'hairbydemj')}${words ? `<div class="hero__copy">${t('headline') ? `<h2 class="h1" id="promo-${p.id}">${esc(t('headline'))}</h2>` : ''}${t('sentence') ? `<p class="body-large">${esc(t('sentence'))}</p>` : ''}${t('buttonLabel') && link ? `<div class="row">${button(t('buttonLabel'), { href: link, fullPhone: true })}</div>` : ''}</div>` : ''}</section>`;
  };
  const order = [
    ...DEFAULT_ORDER.map((kind, i) => ({ kind, shown: layout.get(kind)?.shown ?? true, position: layout.get(kind)?.position ?? i, i, html: () => parts[kind]?.() ?? '' })),
    ...promos.map((p, i) => ({ kind: 'promo', shown: true, position: p.position, i: DEFAULT_ORDER.length + i, html: () => promo(p) })),
  ]
    .filter((x) => x.shown)
    .sort((x, y) => x.position - y.position || x.i - y.i);
  const body = `${order.some((x) => x.kind === 'hero') ? '' : '<h1 class="visually-hidden">hairbydemj</h1>'}
${order.map((x) => x.html()).join('\n')}
${!best.products.length && !fresh.products.length ? card('<p class="muted">New hair is on its way. Please check back soon.</p>', { title: 'Coming soon' }) : ''}`;
  return {
    title: 'hairbydemj',
    body,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'hairbydemj', url: sc.origin, logo: `${sc.origin}/brand/monogram.svg` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'hairbydemj', url: sc.origin, potentialAction: { '@type': 'SearchAction', target: `${sc.origin}/search/?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    ],
  };
}

export async function categoryPage(sc: SiteContext, slug: string): Promise<{ title: string; description: string; nav: string; body: string; jsonLd: unknown[] } | null> {
  const flat = (nodes: typeof sc.categories, trail: typeof sc.categories = []): Array<{ node: (typeof sc.categories)[number]; trail: typeof sc.categories }> => nodes.flatMap((n) => [{ node: n, trail }, ...flat(n.children, [...trail, n])]);
  const found = flat(sc.categories).find((x) => x.node.slug === slug);
  if (!found) return null;
  const { node, trail } = found;
  const [page, filters] = await Promise.all([listProducts(sc.deps, queryFromUrl(sc, { category: slug })), listFilters(sc.deps, { currency: sc.currency.code, category: slug })]);
  const body = `${crumbs([['Home', '/'], ...trail.map((t): [string, string] => [t.name, `/c/${t.slug}/`]), [node.name]])}
<div class="row row--between"><h1 class="h1">${esc(node.name)}</h1>${button('Filter and sort', { kind: 'secondary', attrs: 'data-open="filters" aria-controls="filters"' })}</div>
${node.description ? `<p class="muted">${esc(node.description)}</p>` : ''}
${node.children.length ? `<div class="chips">${each(node.children, (c) => `<a class="chip" href="/c/${esc(c.slug)}/">${esc(c.name)}</a>`)}</div>` : ''}
<div class="with-filters">
<div class="filters-wrap" id="filters" data-panel role="region" aria-label="Filters">${filterForm(sc, filters, {})}</div>
<div class="stack stack--lg">${page.products.length ? listBody(sc, page) : card('<p class="muted">No products match these filters. Try removing one.</p>', { title: 'Nothing here yet' })}</div></div>`;
  return {
    title: node.name,
    description: node.description || `${node.name} from hairbydemj: human hair, delivered worldwide.`,
    nav: (trail[0] ?? node).name,
    body,
    jsonLd: [breadcrumbLd(sc, [['Home', '/'], ...trail.map((t): [string, string] => [t.name, `/c/${t.slug}/`]), [node.name, `/c/${node.slug}/`]])],
  };
}

function breadcrumbLd(sc: SiteContext, items: ReadonlyArray<[string, string]>): unknown {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${sc.origin}${path}` })) };
}

export async function searchPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const words = (sc.ctx.query.get('q') ?? '').trim().slice(0, 200);
  if (!words) {
    return { title: 'Search', body: `<h1 class="h1">Search</h1><form class="row row--nowrap" action="/search/" role="search" style="align-items:flex-end"><div class="field grow"><label class="field__label" for="search-page-q">What are you looking for?</label><input class="field__input" id="search-page-q" name="q" type="search" placeholder="For example: body wave 22 inch"></div>${button('Search', { type: 'submit' })}</form>` };
  }
  const [page, filters] = await Promise.all([listProducts(sc.deps, queryFromUrl(sc, { q: words })), listFilters(sc.deps, { currency: sc.currency.code })]);
  const s = page.search;
  const heading = page.total === 0 ? `No results for "${words}"` : `${page.total} ${page.total === 1 ? 'result' : 'results'} for "${s?.corrected ?? words}"`;
  const notes = [
    s?.corrected ? `<p class="muted">Showing results for <strong>${esc(s.corrected)}</strong>. You searched for "${esc(words)}".</p>` : '',
    s?.broadened ? '<p class="muted">No product has all those words, so these have some of them.</p>' : '',
  ].join('');
  const empty = page.total === 0 ? card(`<p class="muted">Check the spelling, try fewer words, or browse a category.</p><div class="chips">${each(sc.categories, (c) => `<a class="chip" href="/c/${esc(c.slug)}/">${esc(c.name)}</a>`)}</div>`, { title: 'Try something else' }) : '';
  return {
    title: `Search: ${words}`,
    body: `${crumbs([['Home', '/'], ['Search']])}<div class="row row--between"><h1 class="h1">${esc(heading)}</h1>${page.total ? button('Filter and sort', { kind: 'secondary', attrs: 'data-open="filters" aria-controls="filters"' }) : ''}</div>${notes}
${page.total ? `<div class="with-filters"><div class="filters-wrap" id="filters" data-panel role="region" aria-label="Filters">${filterForm(sc, filters, { q: words })}</div><div class="stack stack--lg">${listBody(sc, page)}</div></div>` : empty}`,
  };
}

/** The next cards of a list, as HTML, for "Show more" without leaving the page. */
export async function moreCards(sc: SiteContext): Promise<{ html: string; nextCursor: string | null }> {
  const category = sc.ctx.query.get('category') ?? undefined;
  const words = sc.ctx.query.get('q') ?? undefined;
  const page = await listProducts(sc.deps, queryFromUrl(sc, { category, q: words }));
  return { html: page.products.length ? productGrid(sc, page.products).replace(/^<div class="grid"[^>]*>|<\/div>$/g, '') : '', nextCursor: page.nextCursor };
}

export async function productPage(sc: SiteContext, slug: string): Promise<{ title: string; description: string; canonical: string; nav?: string; body: string; after: string; jsonLd: unknown[] } | null> {
  let p;
  try {
    p = await getProduct(sc.deps, slug, sc.currency.code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  const images = p.media.filter((m) => m.kind === 'image');
  const reviews = await productReviewsSection(sc, p.slug);
  const first = images[0];
  const dims: Array<[label: string, key: 'lengthInches' | 'densityPercent' | 'laceType' | 'colour', unit: (v: string | number) => string]> = [
    ['Length', 'lengthInches', (v) => `${v}"`],
    ['Density', 'densityPercent', (v) => `${v}%`],
    ['Lace', 'laceType', String],
    ['Colour', 'colour', String],
  ];
  const choices = dims
    .map(([label, key, unit]) => {
      const values = [...new Set(p.variants.map((v) => v[key]).filter((v): v is string | number => v !== null))];
      if (values.length === 0) return '';
      return `<fieldset class="stack stack--sm" data-dim="${key}"><legend class="strong small" style="margin-bottom:8px">${esc(label)}</legend><div class="chips">${each(values, (v, i) => `<label class="chip"><input type="radio" name="${key}" value="${esc(String(v))}"${i === 0 ? ' checked' : ''}><span>${esc(unit(v))}</span></label>`)}</div></fieldset>`;
    })
    .join('');
  const variants = p.variants.map((v) => ({ id: v.id, lengthInches: v.lengthInches, densityPercent: v.densityPercent, laceType: v.laceType, colour: v.colour, price: money(sc, v.priceMinor), was: v.compareAtMinor ? money(sc, v.compareAtMinor) : null, available: v.available, lowStock: v.lowStock }));
  const v0 = p.variants[0]!;
  const prices = p.variants.map((v) => v.priceMinor);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const stockLine = (v: typeof v0): string => (v.available === 0 ? 'Sold out' : v.lowStock ? `Only ${v.available} left` : `${v.available} in stock`);
  const details = [p.texture && ['Texture', p.texture], p.origin && ['Hair origin', p.origin], p.grade && ['Grade', p.grade]].filter(Boolean) as Array<[string, string]>;
  const body = `${crumbs([['Home', '/'], ...(p.category ? [[p.category.name, `/c/${p.category.slug}/`] as [string, string]] : []), [p.name]])}
<div class="split split--media">
<div class="stack stack--sm" data-gallery>${first ? picture({ path: first.path, alt: first.alt, widths: first.widths }, { sizes: '(max-width: 1023px) 100vw, 50vw', eager: true, ratio: '4 / 5' }) : picture(null, { alt: p.name, ratio: '4 / 5' })}
${images.length > 1 ? `<div class="thumbs">${each(images.slice(0, 8), (m, i) => `<button type="button" class="thumb" data-thumb="${i}" aria-label="Show photo ${i + 1} of ${images.length}">${picture({ path: m.path, alt: '', widths: m.widths }, { sizes: '72px' })}</button>`)}</div>` : ''}</div>
<form class="stack" data-product-form data-product-id="${p.id}">
<h1 class="h1">${esc(p.name)}</h1>
${reviews.rating ? `<a class="small link" href="#reviews">${'★'.repeat(Math.round(reviews.rating.average))} ${reviews.rating.average} out of 5 (${reviews.rating.count} ${reviews.rating.count === 1 ? 'review' : 'reviews'})</a>` : ''}
<p class="price" style="font-size:24px;line-height:32px"><span data-price>${esc(lo === hi ? money(sc, lo) : priceRange(sc, lo, hi))}</span>${v0.compareAtMinor ? ` <s class="muted small" data-was>${esc(money(sc, v0.compareAtMinor))}</s>` : ' <s class="muted small" data-was hidden></s>'}</p>
${choices}
<noscript><div class="field"><label class="field__label" for="variant-select">Choose</label><select class="field__input" id="variant-select" name="variantId">${each(p.variants, (v) => `<option value="${v.id}"${v.available === 0 ? ' disabled' : ''}>${esc([v.lengthInches ? `${v.lengthInches}"` : '', v.densityPercent ? `${v.densityPercent}%` : '', v.laceType ?? '', v.colour ?? ''].filter(Boolean).join(', '))}: ${esc(money(sc, v.priceMinor))}</option>`)}</select></div></noscript>
<input type="hidden" name="variantId" value="${v0.id}" data-variant-id>
<p class="small muted" data-stock aria-live="polite">${esc(stockLine(v0))}</p>
<div class="row"><div class="field" style="width:96px"><label class="field__label" for="qty">Quantity</label><input class="field__input" id="qty" name="quantity" type="number" inputmode="numeric" min="1" max="20" value="1"></div>${button('Add to bag', { type: 'submit', attrs: 'style="flex:1;align-self:flex-end" data-add' })}</div>
<p class="small" role="status" aria-live="polite" data-add-status></p>
${p.tryOn.length ? button('Try it on with your camera', { kind: 'secondary', full: true, href: `/try-on/?product=${encodeURIComponent(p.slug)}` }) : ''}
${button('Save to wishlist', { kind: 'secondary', icon: 'heart', full: true, attrs: `data-wish="${p.id}" aria-pressed="false"` })}
${p.isFinalSale ? '<p class="small">This item is a final sale: it can only be returned if it arrives wrong or damaged.</p>' : ''}
<div>${p.description ? accordion('Description', `<p>${esc(p.description)}</p>`, true) : ''}${details.length ? accordion('Hair details', `<dl class="stack stack--xs">${each(details, ([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)}</dl>`) : ''}${p.careGuide ? accordion('Care guide', `<p>${esc(p.careGuide)}</p>`) : ''}${accordion('Delivery and returns', '<p>Sent with DHL, UPS or FedEx abroad, or a local courier inside Nigeria; the price and time show at checkout for your address. Import duties and taxes, if your country charges them, are paid by you on delivery. Unworn items can be returned after delivery; see <a class="link" href="/returns/">returns</a>.</p>')}</div>
</form></div>
<script type="application/json" id="variants">${JSON.stringify(variants).replace(/</g, '\\u003c')}</script>
${reviews.html}`;
  const availability = p.variants.some((v) => v.available > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  return {
    title: p.seoTitle || p.name,
    description: p.seoDescription || (p.description ? p.description.slice(0, 155) : `${p.name} from hairbydemj.`),
    canonical: `/products/${p.slug}/`,
    nav: p.category?.name,
    body,
    after: `<div class="sticky-bar"><span class="price" data-price-sticky>${esc(lo === hi ? money(sc, lo) : priceRange(sc, lo, hi))}</span>${button('Add to bag', { attrs: 'style="flex:1" data-add-sticky' })}</div>`,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        description: p.description || undefined,
        sku: v0.sku,
        image: first ? first.widths.map((w) => `${sc.origin}/media/${first.path}/${w}.jpg`).slice(-1) : undefined,
        brand: { '@type': 'Brand', name: 'hairbydemj' },
        aggregateRating: reviews.rating ? { '@type': 'AggregateRating', ratingValue: reviews.rating.average, reviewCount: reviews.rating.count } : undefined,
        offers: { '@type': 'AggregateOffer', priceCurrency: sc.currency.code, lowPrice: (lo / 10 ** sc.currency.minorUnits).toFixed(sc.currency.minorUnits), highPrice: (hi / 10 ** sc.currency.minorUnits).toFixed(sc.currency.minorUnits), offerCount: p.variants.length, availability },
      },
      breadcrumbLd(sc, [['Home', '/'], ...(p.category ? [[p.category.name, `/c/${p.category.slug}/`] as [string, string]] : []), [p.name, `/products/${p.slug}/`]]),
    ],
  };
}

export async function looksPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const looks = await listCollections(sc.deps, { looks: true });
  return {
    title: 'Shop the look',
    body: `<h1 class="h1">Shop the look</h1>${looks.length ? `<div class="grid" style="--cols:3;--cols-tablet:2;--cols-phone:1">${each(looks, (l) => card(`${l.banner ? picture(l.banner, { alt: '', ratio: '16 / 9', sizes: '(max-width: 599px) 100vw, 33vw' }) : ''}<h2 class="h3"><a href="/looks/${esc(l.slug)}/">${esc(l.name)}</a></h2><p class="muted">${esc(l.description)}</p>${button('See the look', { kind: 'secondary', href: `/looks/${l.slug}/` })}`))}</div>` : card('<p class="muted">Looks are on their way.</p>')}`,
  };
}

export async function lookPage(sc: SiteContext, slug: string): Promise<{ title: string; body: string } | null> {
  let look;
  try {
    look = await getLook(sc.deps, slug, sc.currency.code);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  return {
    title: look.name,
    body: `${crumbs([['Home', '/'], ['Shop the look', '/looks/'], [look.name]])}${look.banner ? `<div class="hero">${bannerPicture(look.banner, null, { alt: look.name, eager: true })}</div>` : ''}<h1 class="h1">${esc(look.name)}</h1><p class="muted">${esc(look.description)}</p>
<div class="stack">${each(look.items, (i) => `<div class="row row--top row--nowrap">${picture(i.product.image, { alt: i.product.name, sizes: '96px', className: 'photo--thumb', ratio: '1 / 1' })}<div class="stack stack--xs grow"><a class="strong" href="/products/${esc(i.product.slug)}/">${esc(i.product.name)}</a><span class="small muted">${esc(i.description)}</span>${i.available ? '' : '<span class="small">Sold out</span>'}</div><span class="strong">${esc(money(sc, i.priceMinor))}</span></div>`)}</div>
<div class="kv strong"><span>Set total</span><span class="price">${esc(money(sc, look.totalMinor))}</span></div>
${look.allAvailable ? button('Add the set to bag', { attrs: `data-add-set="${esc(JSON.stringify(look.items.map((i) => i.variantId)))}"` }) : `<p class="muted">${icon('warning', 20)} One piece is sold out, so the set cannot be added in one go. Add the other pieces from their pages.</p>`}
<p class="small" role="status" aria-live="polite" data-add-status></p>`,
  };
}

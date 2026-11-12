// Admin pages for the catalogue: products and the product editor,
// categories and collections, inventory, and discounts.

import { can } from '../../accounts/staff.js';
import { listDiscounts, readDiscount, type Discount } from '../../cart/discounts.js';
import { getAdminProduct, listAdminCategories, listAdminCollections, listAdminProducts, listInventory, STOCK_REASONS } from '../../catalog/manage.js';
import { listPackageSizes } from '../../shipping/shipping.js';
import { num, panel, pageHead, raw, table, tabs } from '../components.js';
import { each, esc } from '../../site/html.js';
import { dialog } from './sales.js';
import { checkbox, date, form, input, money, pager, postButton, select, textarea, type AdminContext } from './view.js';

const PRODUCT_STATUS: Record<string, string> = { draft: 'Draft', published: 'Published', scheduled: 'Scheduled', unpublished: 'Unpublished' };

export async function products(ac: AdminContext): Promise<string> {
  const q = ac.ctx.query;
  const page = Math.max(1, Number(q.get('page')) || 1);
  const stock = q.get('stock');
  const list = await listAdminProducts(ac.deps, ac.staff, { q: q.get('q') ?? undefined, status: q.get('status') || undefined, stock: stock === 'in' || stock === 'low' || stock === 'out' ? stock : undefined, page, perPage: 50 });
  const change = can(ac.staff, 'products', 'change');
  return `${pageHead('Products', change ? `<a class="btn btn--primary" href="/products/new/">Add a product</a>` : '')}
<form class="afilters" method="get" action="/products/" role="search"><label class="afilter" for="pq"><span class="visually-hidden">Search</span><input class="field__input" id="pq" name="q" type="search" placeholder="Name or SKU" value="${esc(q.get('q') ?? '')}"></label>
<label class="afilter" for="ps"><span class="visually-hidden">Status</span><select id="ps" name="status" data-autosubmit><option value="">Status: any</option>${each(Object.entries(PRODUCT_STATUS), ([k, l]) => `<option value="${k}"${q.get('status') === k ? ' selected' : ''}>${esc(l)}</option>`)}</select></label>
<label class="afilter" for="pst"><span class="visually-hidden">Stock</span><select id="pst" name="stock" data-autosubmit><option value="">Stock: any</option><option value="in"${stock === 'in' ? ' selected' : ''}>In stock</option><option value="low"${stock === 'low' ? ' selected' : ''}>Running low</option><option value="out"${stock === 'out' ? ' selected' : ''}>Sold out</option></select></label>
<button class="btn btn--secondary" type="submit">Apply</button></form>
${list.products.length ? table(['Product', 'Category', 'Variants', 'Stock', 'Price from (₦)', 'Status'], list.products.map((p) => [raw(`<a class="link" href="/products/${p.id}/">${esc(p.name)}</a>`), p.category ?? '', num(p.variants), num(p.stock), num(p.priceFromMinor === null ? '' : money(ac, p.priceFromMinor, 'NGN')), PRODUCT_STATUS[p.status] ?? p.status]), { caption: 'Products', minWidth: 720 }) : '<div class="aempty"><h2 class="h3">No products found</h2></div>'}
${pager(ac, list.page, list.page * list.perPage < list.total, list.total, list.perPage)}`;
}

export async function productEditor(ac: AdminContext, id: number | null): Promise<{ title: string; body: string } | null> {
  let p: Awaited<ReturnType<typeof getAdminProduct>> | null = null;
  if (id !== null) {
    try {
      p = await getAdminProduct(ac.deps.db, id);
    } catch {
      return null;
    }
  }
  const categories = await listAdminCategories(ac.deps, ac.staff);
  const boxes = await listPackageSizes(ac.deps.db);
  const currencies = [...ac.currencies.values()];
  const change = can(ac.staff, 'products', 'change');
  const media = p ? await ac.deps.db.query("select id, kind, path, alt, colour, status, widths, error from product_media where product_id = $1 order by position, id", [p.id]) : { rows: [] };
  const details = `${input('name', 'Name', { value: p?.name, attrs: 'required' })}
${input('slug', 'Web address', { value: p?.slug, help: 'Leave empty to make one from the name. Customers see /products/<this>/.' })}
<div class="fields fields--2">${select('categoryId', 'Category', [['', 'No category'], ...categories.map((c): [string, string] => [String(c.id), c.parentId ? `  ${c.name}` : c.name])], p?.categoryId ? String(p.categoryId) : '', { data: 'number' })}${select('status', 'Status', Object.entries(PRODUCT_STATUS), p?.status ?? 'draft')}</div>
${input('publishAt', 'Publish at (for Scheduled)', { type: 'datetime-local', value: p?.publishAt ? new Date(p.publishAt.getTime() + 3600_000).toISOString().slice(0, 16) : '' })}
<div class="fields fields--3">${input('texture', 'Texture', { value: p?.texture })}${input('origin', 'Hair origin', { value: p?.origin })}${input('grade', 'Grade', { value: p?.grade })}</div>
${textarea('description', 'Description', p?.description ?? '', { rows: 5 })}
${textarea('careGuide', 'Care guide', p?.careGuide ?? '', { rows: 3 })}
${input('tags', 'Tags (separated by commas)', { value: p?.tags.join(', '), data: 'list' })}
${checkbox('isFinalSale', 'Final sale (returns only if wrong or damaged)', p?.isFinalSale ?? false)}
<details><summary class="strong small">Shipping and customs</summary><div class="stack">${select('packageSizeId', 'Box it ships in', [['', 'Work it out from the size'], ...boxes.map((b): [string, string] => [String(b.id), b.name])], p?.packageSizeId ? String(p.packageSizeId) : '', { data: 'number' })}${input('customsDescription', 'Customs description', { value: p?.customsDescription, help: 'For example: Human hair wig' })}${input('hsCode', 'HS code', { value: p?.hsCode, help: 'Customs tariff code, for example 670420' })}</div></details>
<details><summary class="strong small">Search engines</summary><div class="stack">${input('seoTitle', 'Page title', { value: p?.seoTitle })}${textarea('seoDescription', 'Description', p?.seoDescription ?? '', { rows: 2 })}</div></details>`;
  if (!p) {
    return { title: 'Add a product', body: `${pageHead('Add a product', '', '<a class="link" href="/products/">Products</a> › New')}${panel('Details', change ? form('/api/products', details, { submit: 'Create product', next: '/products/{product.id}/', reload: false }) : '')}` };
  }
  const variantRows = p.variants.map((v) => [
    raw(`<span class="strong">${esc(v.sku)}</span>${v.isActive ? '' : ' <span class="small muted">(hidden)</span>'}`),
    [v.lengthInches ? `${v.lengthInches}"` : '', v.densityPercent ? `${v.densityPercent}%` : '', v.laceType ?? '', v.colour ?? ''].filter(Boolean).join(', '),
    raw(currencies.map((c) => `<span class="small">${esc(v.prices[c.code] ? money(ac, v.prices[c.code]!.amountMinor, c.code) + (v.prices[c.code]!.isConverted ? '*' : '') : `${c.code}: none`)}</span>`).join('<br>')),
    num(`${v.onHand - v.reserved} (${v.reserved} held)`),
    raw(change ? `<details><summary class="link small">Edit</summary>${form(`/api/variants/${v.id}`, `<div class="fields fields--2">${input('sku', 'SKU', { value: v.sku })}${input('weightGrams', 'Weight (g)', { value: v.weightGrams, data: 'number' })}</div><div class="fields fields--2">${input('lengthInches', 'Length (inches)', { value: v.lengthInches, data: 'number' })}${input('densityPercent', 'Density (%)', { value: v.densityPercent, data: 'number' })}</div><div class="fields fields--2">${input('colour', 'Colour', { value: v.colour })}${input('laceType', 'Lace', { value: v.laceType })}</div><div class="fields fields--2">${currencies.map((c) => input(`prices.${c.code}`, `Price (${c.code})`, { value: v.prices[c.code] ? v.prices[c.code]!.amountMinor / 10 ** c.minorUnits : '', data: 'minor', attrs: 'inputmode="decimal"' })).join('')}</div>${checkbox('autoConvert', 'Work out the other currencies from the naira price', false)}${input('lowStockThreshold', 'Low-stock alert at', { value: v.lowStockThreshold, data: 'number' })}${checkbox('isActive', 'Shown in the shop', v.isActive)}`, { submit: 'Save variant' })}${postButton('Remove variant', `/api/variants/${v.id}/delete`, { kind: 'text', confirm: 'Remove this variant?' })}</details>` : ''),
  ]);
  const mediaHtml = media.rows.length
    ? `<div class="grid" style="--cols:4;--cols-tablet:3;--cols-phone:2">${each(media.rows, (m) => {
        const widths = (m.widths as number[] | null) ?? [];
        const w = widths[0];
        return `<figure class="stack stack--xs">${m.status === 'ready' && w ? `<img src="/media/${esc(String(m.path))}/${w}.jpg" alt="${esc(String(m.alt))}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px">` : `<div class="athumb" style="--w:100%;aspect-ratio:4/5">${esc(String(m.status))}</div>`}<figcaption class="small">${m.kind === 'video' ? 'Video' : 'Photo'}${m.colour ? `, ${esc(String(m.colour))}` : ''}${m.error ? `<br><span style="color:var(--error)">${esc(String(m.error))}</span>` : ''}</figcaption>${change ? postButton('Remove', `/api/media/${Number(m.id)}/delete`, { kind: 'text', confirm: 'Remove this photo?' }) : ''}</figure>`;
      })}</div>`
    : '<p class="muted small">No photos yet.</p>';
  return {
    title: p.name,
    body: `${pageHead(p.name, `<a class="btn btn--secondary" href="${esc(ac.deps.config.env === 'production' ? `https://${ac.deps.config.hosts.site}` : `http://${ac.deps.config.hosts.site}:${ac.deps.config.port}`)}/products/${esc(p.slug)}/" target="_blank" rel="noopener">View in the shop</a>${change ? postButton('Delete product', `/api/products/${p.id}/delete`, { kind: 'text', confirm: 'Delete this product? Products that have been ordered are unpublished instead.', next: '/products/' }) : ''}`, `<a class="link" href="/products/">Products</a> › ${esc(p.name)}`)}
<div class="stack stack--lg">
${panel('Details', change ? form(`/api/products/${p.id}`, details, { submit: 'Save product' }) : '')}
${panel('Variants', `${variantRows.length ? table(['SKU', 'Options', 'Prices', 'Available', ''], variantRows, { caption: 'Variants', minWidth: 760 }) : '<p class="muted small">No variants yet: the product cannot be bought.</p>'}<p class="small muted">* worked out from the naira price at today's rate.</p>
${change ? `<details><summary class="strong small">Make variants for every combination</summary>${form(`/api/products/${p.id}/variants/generate`, `<div class="fields fields--3">${input('lengths', 'Lengths (inches, with commas)', { data: 'list', help: 'For example: 14, 16, 18, 20' })}${input('densities', 'Densities (%, with commas)', { data: 'list' })}${input('colours', 'Colours (with commas)', { data: 'list' })}</div><div class="fields fields--3">${input('laceType', 'Lace')}${input('weightGrams', 'Weight of each (g)', { data: 'number' })}${input('skuPrefix', 'SKU starts with', { help: 'For example: BSW' })}</div><div class="fields fields--2">${input('basePriceMinor', 'Naira price of each', { data: 'minor' })}${input('initialStock', 'Stock of each to start', { data: 'number' })}</div>`, { submit: 'Make variants' })}</details>
<details><summary class="strong small">Add one variant</summary>${form(`/api/products/${p.id}/variants`, `<div class="fields fields--2">${input('sku', 'SKU')}${input('weightGrams', 'Weight (g)', { data: 'number' })}</div><div class="fields fields--3">${input('lengthInches', 'Length (inches)', { data: 'number' })}${input('densityPercent', 'Density (%)', { data: 'number' })}${input('colour', 'Colour')}</div>${input('prices.NGN', 'Price (NGN)', { data: 'minor' })}${checkbox('autoConvert', 'Work out the other currencies', true)}`, { submit: 'Add variant' })}</details>` : ''}`)}
${panel('Photos and videos', `${mediaHtml}${change ? `<form class="stack" data-upload="/api/products/${p.id}/media"><div class="field"><label class="field__label" for="up-file">Add photos or a video</label><input class="field__input" id="up-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime" multiple></div><div class="fields fields--2"><div class="field"><label class="field__label" for="up-alt">What the photo shows (for screen readers)</label><input class="field__input" id="up-alt" data-upload-alt></div><div class="field"><label class="field__label" for="up-colour">Colour it shows (optional)</label><input class="field__input" id="up-colour" data-upload-colour></div></div><button class="btn btn--secondary" type="submit">Upload</button><p class="small" role="status" data-upload-status></p></form>` : ''}`)}
</div>`,
  };
}

export async function categories(ac: AdminContext): Promise<string> {
  const cats = await listAdminCategories(ac.deps, ac.staff);
  const cols = await listAdminCollections(ac.deps, ac.staff);
  const change = can(ac.staff, 'products', 'change');
  const parentOptions: Array<[string, string]> = [['', 'Top level'], ...cats.filter((c) => !c.parentId).map((c): [string, string] => [String(c.id), c.name])];
  return `${pageHead('Categories and collections')}
${panel('Categories', `${table(['Category', 'Address', 'Products', 'In menu', ''], cats.map((c) => [raw(`${c.parentId ? '&nbsp;&nbsp;↳ ' : ''}<span class="strong">${esc(c.name)}</span>`), `/c/${c.slug}/`, num(c.products), c.showInMenu ? 'Yes' : 'No', raw(change ? `<details><summary class="link small">Edit</summary>${form(`/api/categories/${c.id}`, `${input('name', 'Name', { value: c.name })}${input('slug', 'Address', { value: c.slug })}${textarea('description', 'Description', c.description, { rows: 2 })}${input('position', 'Position', { value: c.position, data: 'number' })}${checkbox('showInMenu', 'Shown in the menu', c.showInMenu)}`, { submit: 'Save' })}${postButton('Remove', `/api/categories/${c.id}/delete`, { kind: 'text', confirm: 'Remove this category? It must be empty.' })}</details>` : '')]), { caption: 'Categories', minWidth: 640 })}
${change ? `<details><summary class="strong small">Add a category</summary>${form('/api/categories', `${input('name', 'Name')}${select('parentId', 'Inside', parentOptions, '', { data: 'number' })}${textarea('description', 'Description', '', { rows: 2 })}${checkbox('showInMenu', 'Shown in the menu', true)}`, { submit: 'Add category' })}</details>` : ''}`)}
${panel('Collections and looks', `${cols.length ? table(['Collection', 'Kind', 'Products', 'Status'], cols.map((c) => [raw(`<span class="strong">${esc(c.name)}</span>${c.isLook ? ' <span class="tag">Look</span>' : ''}`), c.type, num(c.products), c.status]), { caption: 'Collections' }) : '<p class="muted small">No collections yet.</p>'}
${change ? `<details><summary class="strong small">Add a collection</summary>${form('/api/collections', `${input('name', 'Name')}${textarea('description', 'Description', '', { rows: 2 })}${select('kind', 'Products', [['manual', 'Chosen by hand'], ['rules', 'By rules']], 'manual')}${checkbox('isLook', 'A shop-the-look set', false)}${select('status', 'Status', [['draft', 'Draft'], ['live', 'Live']], 'draft')}`, { submit: 'Add collection' })}</details>` : ''}<p class="small muted">Products are added to a collection from the collection's address in the API (module 4); a fuller editor follows the owner's feedback.</p>`)}`;
}

export async function inventory(ac: AdminContext): Promise<{ body: string; after: string }> {
  const q = ac.ctx.query;
  const page = Math.max(1, Number(q.get('page')) || 1);
  const low = q.get('low') === '1';
  const list = await listInventory(ac.deps, ac.staff, { lowOnly: low, q: q.get('q') ?? undefined, page, perPage: 50 });
  const change = can(ac.staff, 'products', 'change');
  return {
    body: `${pageHead('Inventory')}
${tabs('Stock', [['All', '/inventory/', !low], ['Running low', '/inventory/?low=1', low]])}
<form class="afilters" method="get" action="/inventory/" role="search">${low ? '<input type="hidden" name="low" value="1">' : ''}<label class="afilter" for="iq"><span class="visually-hidden">Search</span><input class="field__input" id="iq" name="q" type="search" placeholder="Name or SKU" value="${esc(q.get('q') ?? '')}"></label><button class="btn btn--secondary" type="submit">Search</button></form>
${list.rows.length ? table(['Product', 'Variant', 'SKU', 'On hand', 'Held', 'Available', 'Last change', ''], list.rows.map((r) => [r.product, r.variant, r.sku, num(r.onHand), num(r.reserved), raw(`<span${r.isLow ? ' class="astatus astatus--bad"' : ''}>${r.available}</span>`), r.lastChange ? `${date(r.lastChange.at)} (${r.lastChange.reason})` : '', raw(change ? `<button class="btn btn--text small" type="button" data-dialog-open="adjust" data-adjust="${r.variantId}" data-adjust-name="${esc(`${r.product}, ${r.variant}`)}">Adjust</button>` : '')]), { caption: 'Inventory', minWidth: 860 }) : '<div class="aempty"><h2 class="h3">Nothing here</h2></div>'}
${pager(ac, list.page, list.page * list.perPage < list.total, list.total, list.perPage)}`,
    after: change
      ? dialog('adjust', 'Adjust stock', `<p class="strong" data-adjust-title></p><form class="stack" data-json-form="/api/inventory/0/adjust" data-adjust-form data-reload novalidate>${select('mode', 'Change', [['add', 'Add'], ['remove', 'Remove'], ['set', 'Set to']], 'add')}${input('quantity', 'Quantity', { data: 'number', attrs: 'inputmode="numeric"' })}${select('reason', 'Reason', Object.entries(STOCK_REASONS), 'received')}${input('note', 'Note (optional)')}<div class="row"><button class="btn btn--primary" type="submit">Save</button></div><p class="small" role="alert" data-form-error></p></form>`)
      : '',
  };
}

export async function discounts(ac: AdminContext): Promise<string> {
  const list = await listDiscounts(ac.deps.db, ac.staff);
  const change = can(ac.staff, 'discounts', 'change');
  return `${pageHead('Discounts', change ? '<a class="btn btn--primary" href="/discounts/new/">Add a discount</a>' : '')}
${list.length ? table(['Discount', 'Code', 'Kind', 'Used', 'Runs', 'Status'], list.map((d) => [raw(`<a class="link" href="/discounts/${d.id}/">${esc(d.name)}</a>`), d.code ?? 'Automatic', describe(d), num(`${d.timesUsed}${d.totalUsesLimit ? ` of ${d.totalUsesLimit}` : ''}`), `${date(d.startsAt)}${d.endsAt ? ` to ${date(d.endsAt)}` : ''}`, d.status]), { caption: 'Discounts', minWidth: 760 }) : '<div class="aempty"><h2 class="h3">No discounts yet</h2></div>'}`;
}

function describe(d: Discount): string {
  if (d.kind === 'percentage') return `${(d.percentBps ?? 0) / 100}% off`;
  if (d.kind === 'fixed') return 'Amount off';
  if (d.kind === 'free_shipping') return 'Free delivery';
  return `Buy ${d.buyQuantity}, get ${d.getQuantity}`;
}

export async function discountEditor(ac: AdminContext, id: number | null): Promise<{ title: string; body: string } | null> {
  let d: Discount | null = null;
  if (id !== null) {
    try {
      d = await readDiscount(ac.deps.db, ac.staff, id);
    } catch {
      return null;
    }
  }
  const change = can(ac.staff, 'discounts', 'change');
  const local = (v: Date | null): string => (v ? new Date(v.getTime() + 3600_000).toISOString().slice(0, 16) : '');
  const fields = `${input('name', 'Name (staff see this; customers see it in the bag)', { value: d?.name })}
${input('code', 'Code', { value: d?.code, help: 'Leave empty for an automatic discount that needs no code.' })}
${select('kind', 'Kind', [['percentage', 'Percentage off'], ['fixed', 'Amount off'], ['free_shipping', 'Free delivery'], ['buy_x_get_y', 'Buy some, get some free']], d?.kind ?? 'percentage')}
<div class="fields fields--3">${input('percentBps', 'Percent off (100 = 1%)', { value: d?.percentBps, data: 'number', help: 'For percentage: 1000 is 10%.' })}${input('buyQuantity', 'Buy', { value: d?.buyQuantity, data: 'number' })}${input('getQuantity', 'Get free', { value: d?.getQuantity, data: 'number' })}</div>
<fieldset class="stack stack--sm"><legend class="strong small">Amounts per currency (amount off, and the smallest order it works on)</legend>${[...ac.currencies.values()].map((c) => `<div class="fields fields--2">${input(`amounts.${c.code}.amountMinor`, `${c.code} off`, { value: d?.amounts[c.code]?.amountMinor ? d.amounts[c.code]!.amountMinor! / 100 : '', data: 'minor' })}${input(`amounts.${c.code}.minOrderMinor`, `${c.code} minimum order`, { value: d?.amounts[c.code]?.minOrderMinor ? d.amounts[c.code]!.minOrderMinor! / 100 : '', data: 'minor' })}</div>`).join('')}</fieldset>
${select('customerGroup', 'Who can use it', [['everyone', 'Everyone'], ['new_customers', 'New customers'], ['gold_and_platinum', 'Gold and Platinum members']], d?.customerGroup ?? 'everyone')}
<div class="fields fields--2">${input('totalUsesLimit', 'Uses in all (empty for no limit)', { value: d?.totalUsesLimit, data: 'number' })}${input('perCustomerLimit', 'Uses per customer', { value: d?.perCustomerLimit, data: 'number' })}</div>
<div class="fields fields--2">${input('startsAt', 'Starts', { type: 'datetime-local', value: local(d?.startsAt ?? null) })}${input('endsAt', 'Ends (optional)', { type: 'datetime-local', value: local(d?.endsAt ?? null) })}</div>
${checkbox('combinable', 'Can be used with other discounts', d?.combinable ?? false)}
${select('status', 'Status', [['draft', 'Draft'], ['active', 'Active'], ['disabled', 'Switched off']], d?.status ?? 'draft')}
<input type="hidden" data-key="appliesTo" value="${esc(d?.appliesTo ?? 'all')}">`;
  return {
    title: d ? d.name : 'Add a discount',
    body: `${pageHead(d ? d.name : 'Add a discount', d && change ? postButton('Delete', `/api/discounts/${d.id}/delete`, { kind: 'text', confirm: 'Delete this discount?', next: '/discounts/' }) : '', '<a class="link" href="/discounts/">Discounts</a>')}${panel('', change ? form(d ? `/api/discounts/${d.id}` : '/api/discounts', fields, { submit: d ? 'Save discount' : 'Create discount', next: d ? undefined : '/discounts/{discount.id}/', reload: Boolean(d) }) : '')}`,
  };
}

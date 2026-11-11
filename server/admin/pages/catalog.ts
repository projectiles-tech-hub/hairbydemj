// Admin pages for the catalogue: products, categories, inventory, reviews.

import { button, check, field, icon } from '../../site/components.js';
import { each, esc } from '../../site/html.js';
import { dialog, filters, num, pageHead, pager, panel, raw, status, table, tabs, thumb } from '../components.js';
import { SAVED } from './sales.js';

export function products(): string {
  const p = (name: string): { html: string } => raw(`<a class="link" href="/admin/products/new/">${esc(name)}</a>`);
  return (
    pageHead('Products (132)', button('Import CSV', { kind: 'secondary' }) + button('Export', { kind: 'secondary' }) + button('New product', { href: '/admin/products/new/' })) +
    filters([['Status', ['All', 'Published', 'Draft', 'Unpublished']], ['Category', ['All', 'Wigs', 'Bundles', 'Closures', 'Accessories']], ['Stock', ['All', 'In stock', 'Low', 'Out of stock']], ['Texture', ['All', 'Straight', 'Body wave', 'Deep wave', 'Curly', 'Kinky']], ['Origin', ['All', 'Vietnamese', 'Cambodian', 'Peruvian', 'Brazilian']]]) +
    panel(
      '',
      table(
        ['Photo', 'Product', 'Category', num('Variants'), num('Stock'), num('Price (NGN)'), 'Status'],
        [
          [thumb(), p('Deep wave frontal wig'), 'Wigs', num(12), num(48), num('₦285,000'), status('Published', 'good')],
          [thumb(), p('Kinky curly bundles'), 'Bundles', num(9), num(3), num('₦285,000'), status('Published', 'good')],
          [thumb(), p('Lace frontal 13×4'), 'Closures', num(4), num(0), num('₦285,000'), status('Draft', 'off')],
          [thumb(), p('Silk bonnet'), 'Accessories', num(1), num(120), num('₦18,500'), status('Published', 'good')],
          [thumb(), p('Wig care set'), 'Wigs', num(12), num(17), num('₦285,000'), status('Unpublished', 'off')],
        ],
        { caption: 'Products', select: true, nameColumn: 1, minWidth: 860 },
      ),
    ) +
    pager()
  );
}

export function productEditor(): string {
  const v = (name: string, sku: string, stock: number, weight: string): Array<string | { html: string }> => {
    const inp = (label: string, value: string): { html: string } => raw(`<input class="field__input acell" aria-label="${esc(label)} for ${esc(name)}" value="${esc(value)}" inputmode="decimal">`);
    return [name, sku, inp('Price in naira', '285,000'), inp('Price in US dollars', '000'), inp('Price in pounds', '000'), inp('Price in euros', '000'), inp('Stock', String(stock)), inp('Weight in kilograms', weight)];
  };
  return (
    pageHead('New product', button('Save as draft', { kind: 'secondary', attrs: SAVED }) + button('Publish', { attrs: 'data-toast="Published. This is a preview, so nothing was stored."' }), `<a class="link" href="/admin/products/">Products</a> › New product`) +
    `<div class="acols"><div class="stack">` +
    panel('Details', field('Name') + field('Description', { textarea: true, placeholder: 'Rich text' })) +
    panel(
      'Hair attributes',
      `<div class="fields fields--3">` +
        field('Texture', { options: ['Body wave', 'Straight', 'Deep wave', 'Curly', 'Kinky'] }) +
        field('Lace type', { options: ['HD lace', 'Transparent', 'Closure', 'Frontal', 'Full lace'] }) +
        field('Origin', { options: ['Vietnamese', 'Cambodian', 'Peruvian', 'Brazilian'] }) +
        field('Lengths offered', { value: '14, 16, 18, 20, 22, 24, 26' }) +
        field('Densities', { value: '150%, 180%, 200%' }) +
        field('Colours', { value: 'Natural black, 1B/27, 613' }) +
        `</div>`,
    ) +
    panel(
      'Photos and video',
      `<div class="aphotos"><span class="athumb" style="--w:96px" role="img" aria-label="Cover photo">cover</span>${'<span class="athumb" style="--w:96px" role="img" aria-label="Photo"></span>'.repeat(3)}<button class="athumb athumb--add" style="--w:96px" type="button">${icon('plus', 20)}add</button></div><p class="small muted">Up to 10 photos and 1 video. Alt text per photo for accessibility and search.</p>`,
    ) +
    panel(
      'Variants and prices (42 generated)',
      table(['Variant', 'SKU', 'NGN', 'USD', 'GBP', 'EUR', 'Stock', 'Weight (kg)'], [v('22" · 180% · Natural black', 'WIG-BW-22-180-NB', 12, '0.45'), v('22" · 200% · Natural black', 'WIG-BW-22-200-NB', 5, '0.55'), v('24" · 180% · 613', 'WIG-BW-24-180-613', 0, '0.50')], { caption: 'Variants and prices', minWidth: 1080 }) +
        check('Convert USD, GBP and EUR from NGN automatically at the daily rate'),
    ) +
    `</div><div class="stack">` +
    panel('Status', `<fieldset class="row"><legend class="visually-hidden">Status</legend>${check('Draft', { type: 'radio', name: 'pstatus' })}${check('Published', { type: 'radio', name: 'pstatus', checked: true })}${check('Scheduled', { type: 'radio', name: 'pstatus' })}</fieldset>`) +
    panel('Organisation', field('Category', { options: ['Wigs', 'Bundles', 'Closures and frontals', 'Accessories'] }) + field('Collections', { value: 'Best-sellers, New arrivals' }) + field('Tags')) +
    panel('Search and SEO', field('Page title') + field('Description', { id: 'seo-description' }) + field('URL', { value: '/wigs/product-name' })) +
    panel('Shipping', field('Package size', { options: ['Medium box', 'Small box'] }) + field('Customs description and HS code', { value: 'Human hair wig · 6704.11' })) +
    `</div></div>`
  );
}

export function categories(): string {
  const sub = (name: string): { html: string } => raw(`<span class="aindent">${esc(name)}</span>`);
  return (
    pageHead('Categories and collections', button('New collection', { kind: 'secondary' }) + button('New category')) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel(
      'Categories',
      table(['Category', num('Products'), 'Shown in menu'], [['Wigs', num(48), 'Yes'], [sub('Lace front wigs'), num(20), 'Yes'], [sub('Full lace wigs'), num(12), 'Yes'], ['Bundles', num(32), 'Yes'], ['Closures and frontals', num(20), 'Yes'], ['Accessories', num(15), 'Yes']], { caption: 'Categories' }),
    ) +
    panel(
      'Collections',
      table(['Collection', 'Type', num('Products'), 'Status'], [['Best-sellers', 'Rules: top 20 by sales', num(20), status('Live', 'good')], ['New arrivals', 'Rules: added in last 30 days', num(14), status('Live', 'good')], ['Shop the look: Soft glam', 'Hand-picked', num(3), status('Live', 'good')]], { caption: 'Collections', minWidth: 520 }),
    ) +
    `</div>` +
    panel(
      'Edit collection',
      field('Name', { value: 'New arrivals' }) +
        field('Description', { textarea: true }) +
        `<fieldset class="row"><legend class="visually-hidden">How products are chosen</legend>${check('Rules', { type: 'radio', name: 'ctype', checked: true })}${check('Hand-picked', { type: 'radio', name: 'ctype' })}</fieldset>` +
        `<div class="fields fields--3">${field('Field', { options: ['Date added', 'Sales', 'Category', 'Tag'] })}${field('Condition', { options: ['in the last', 'is', 'is more than'] })}${field('Value', { value: '30 days' })}</div>` +
        button('Add rule', { kind: 'secondary' }) +
        `<div class="photo" style="--ratio:3/1" role="img" aria-label="Collection banner">collection banner</div>` +
        button('Save', { attrs: SAVED }),
    ) +
    `</div>`
  );
}

export function inventory(): string {
  return (
    pageHead('Inventory', button('Export', { kind: 'secondary' }) + button('Adjust stock', { attrs: 'data-dialog-open="adjust-stock"' })) +
    filters(
      [['Category', ['All', 'Wigs', 'Bundles', 'Closures', 'Accessories']]],
      `<label class="chip"><input type="checkbox" name="low"><span>Low stock only</span></label><label class="afilter afilter--search" for="inv-q"><span class="visually-hidden">Search variant or SKU</span><input id="inv-q" type="search" placeholder="Search variant or SKU"></label>`,
    ) +
    panel(
      '',
      table(
        ['Product', 'Variant', 'SKU', num('On hand'), num('Reserved'), num('Available'), num('Alert at'), 'Last change'],
        [
          ['Deep wave frontal wig', '22" · 180% · Natural black', 'WIG-BW-22-180-NB', num(12), num(2), num(10), num(3), 'Today, sale'],
          ['Kinky curly bundles', '22" · 200% · Natural black', 'WIG-BW-22-200-NB', num(5), num(1), num(4), num(3), 'Yesterday, sale'],
          ['Lace frontal 13×4', '24" · 180% · 613', 'WIG-BW-24-180-613', raw('<span class="astatus astatus--bad">0</span>'), num(0), num(0), num(3), '2 Nov, return received'],
          ['Silk bonnet', '18" · 150% · 613', 'BUN-ST-18-613', raw('<span class="astatus astatus--wait">2</span>'), num(0), num(2), num(3), '1 Nov, adjustment'],
        ],
        { caption: 'Inventory', minWidth: 960 },
      ),
    )
  );
}

export function adjustStockDialog(): string {
  return dialog(
    'adjust-stock',
    'Adjust stock',
    `<p class="strong small">Bone straight wig · 22 inches · 180% · Natural black</p><p class="small muted">On hand now: <span data-stock-now>12</span></p>` +
      `<fieldset class="row" data-stock-mode><legend class="visually-hidden">Kind of change</legend>${check('Add', { type: 'radio', name: 'smode', checked: true })}${check('Remove', { type: 'radio', name: 'smode' })}${check('Set to', { type: 'radio', name: 'smode' })}</fieldset>` +
      field('Quantity', { value: '6', inputmode: 'numeric', id: 'stock-qty' }) +
      field('Reason', { options: ['Received from supplier', 'Damaged', 'Stock count correction', 'Returned to supplier'] }) +
      field('Note (optional)') +
      `<p class="small muted" aria-live="polite">On hand after this change: <span data-stock-after>18</span>. The change is kept in the activity log.</p>`,
    button('Cancel', { kind: 'secondary', type: 'submit', attrs: 'value="cancel"' }) + button('Save adjustment', { type: 'submit', attrs: 'value="ok" data-toast="Stock adjusted. This is a preview, so nothing was stored."' }),
  );
}

export function reviews(): string {
  const stars = `<span class="stars" aria-hidden="true">${icon('star', 16).repeat(4)}${icon('starEmpty', 16)}</span>`;
  const review = (n: number): string =>
    `<article class="apanel areview"><span class="athumb" style="--w:48px" role="img" aria-label="Product photo"></span><div class="stack stack--sm grow">` +
    `<p class="small">${stars} 4 out of 5 · Product name · Customer name · Verified buyer · 2 Nov</p><p class="small muted">The text of the review, two or three lines.</p>` +
    `<div class="row">${thumb('Photo from the customer', 48).html}${thumb('Photo from the customer', 48).html}</div>` +
    field('Public reply (optional)', { id: `reply-${n}` }) +
    `</div><div class="areview__actions">${button('Approve', { attrs: 'data-toast="Review published. This is a preview, so nothing was stored."' })}${button('Hide', { kind: 'secondary' })}</div></article>`;
  return (
    pageHead('Reviews', button('Export', { kind: 'secondary' })) +
    tabs('Review status', [['Waiting (6)', '/admin/reviews/', true], ['Published', '/admin/reviews/'], ['Hidden', '/admin/reviews/']]) +
    each([1, 2, 3], review) +
    pager()
  );
}


// Admin pages for offers and content: discounts, gift cards, loyalty, chat, homepage, content pages.

import { button, check, field } from '../../site/components.js';
import { each, esc } from '../../site/html.js';
import { num, pageHead, pager, pair, panel, status, table } from '../components.js';
import { SAVED } from './sales.js';

export function discounts(): string {
  return (
    pageHead('New discount', button('Cancel', { kind: 'secondary', href: '/admin/discounts/' }) + button('Save and activate', { attrs: 'data-toast="Discount saved. This is a preview, so nothing was stored."' })) +
    `<div class="acols"><div class="stack">` +
    panel('Type', `<fieldset class="row"><legend class="visually-hidden">Type</legend>${check('Discount code', { type: 'radio', name: 'dtype', checked: true })}${check('Automatic discount', { type: 'radio', name: 'dtype' })}</fieldset>` + field('Code', { value: 'WELCOME10' })) +
    panel(
      'Value',
      `<fieldset class="row"><legend class="visually-hidden">Value</legend>${check('Percentage', { type: 'radio', name: 'dval', checked: true })}${check('Fixed amount per currency', { type: 'radio', name: 'dval' })}${check('Free shipping', { type: 'radio', name: 'dval' })}${check('Buy X get Y', { type: 'radio', name: 'dval' })}</fieldset>` +
        `<div class="fields fields--2">${field('Percentage', { value: '10 %' })}${field('Applies to', { options: ['All products', 'A category', 'A collection', 'Chosen products'] })}</div>`,
    ) +
    panel(
      'Rules and limits',
      `<div class="fields fields--3">${field('Minimum order', { value: '₦285,000' })}${field('Total uses', { value: 'Unlimited' })}${field('Uses per customer', { value: '1' })}${field('Starts', { value: '10 Nov 2026' })}${field('Ends', { value: 'No end date' })}${field('Customers', { options: ['Everyone', 'New customers', 'Gold and Platinum'] })}</div>` +
        check('Cannot be combined with other discounts'),
    ) +
    `</div><div class="stack">` +
    panel('Summary', `<ul class="small stack stack--xs"><li class="strong">WELCOME10</li><li>10% off all products</li><li>Minimum order ₦285,000</li><li>One use per customer</li><li>Starts 10 Nov 2026</li></ul>`) +
    panel('Active discounts', table(['Name', num('Used')], [['BLACKFRIDAY', num(214)], ['Free shipping over ₦285,000', num('1,020')]], { caption: 'Active discounts' })) +
    `</div></div>`
  );
}

export function giftCards(): string {
  return (
    pageHead('Gift cards', button('Export', { kind: 'secondary' }) + button('Issue gift card', { href: '#issue' })) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel(
      '',
      table(
        ['Code', num('Value'), num('Balance'), 'Bought by', 'Sent to', 'Status'],
        [
          ['XXXX-…-4F2A', num('₦50,000'), num('₦20,000'), 'Name', 'friend@example.com', status('Active', 'good')],
          ['XXXX-…-9C1D', num('₦100,000'), num('₦100,000'), 'Staff: goodwill', 'name@example.com', status('Active', 'good')],
          ['XXXX-…-77B0', num('$100'), num('$0'), 'Name', 'name@example.com', status('Used up', 'off')],
        ],
        { caption: 'Gift cards', minWidth: 680 },
      ),
    ) +
    pager() +
    `</div><div id="issue">` +
    panel(
      'Issue a gift card',
      `<div class="fields fields--2">${field('Amount', { value: '50,000', inputmode: 'numeric' })}${field('Currency', { options: ['NGN', 'USD', 'GBP', 'EUR'] })}</div>` +
        field('Recipient email', { type: 'email' }) +
        field('Reason (kept in the activity log)') +
        field('Expires', { options: ['12 months', '6 months', '24 months', 'Never'] }) +
        button('Issue and email', { attrs: 'data-toast="Gift card issued. This is a preview, so no email went out."' }),
    ) +
    `</div></div>`
  );
}

export function loyalty(): string {
  return (
    pageHead('Loyalty and referrals', button('Save changes', { attrs: SAVED })) +
    `<div class="acols acols--wide"><div class="stack">` +
    panel('Earning points', `<div class="fields fields--3">${field('Points per ₦1,000 spent', { value: '1' })}${field('Review with photos', { value: '100' })}${field('Birthday bonus', { value: '200' })}</div>`) +
    panel('Spending points', `<div class="fields fields--3">${field('Value of 100 points', { value: '₦6,500' })}${field('Minimum to redeem', { value: '500' })}${field('Most of an order payable with points', { value: '50 %' })}</div>`) +
    panel('Tiers', table(['Tier', num('From (points in 12 months)'), 'Benefit'], [['Bronze', num(0), 'Standard'], ['Gold', num('1,000'), 'Early access to sales'], ['Platinum', num('5,000'), 'Free express shipping']], { caption: 'Tiers', minWidth: 480 })) +
    `</div><div class="stack">` +
    panel('Referrals', `<div class="fields fields--2">${field('Friend gets', { value: '500 points' })}${field('Referrer gets', { value: '500 points' })}</div><p class="small muted">Points are given after the friend's first order is delivered.</p>`) +
    panel('This month', pair('Points given', '48,200') + pair('Points used', '12,500') + pair('New customers by referral', '31')) +
    `</div></div>`
  );
}

export function chat(): string {
  const threads: Array<[string, string, boolean]> = [['Customer name · 2 min', 'Where is my order?', true], ['Customer name · 8 min', 'Do you ship to Canada?', false], ['Visitor · 15 min', 'Which length should I pick?', false]];
  return (
    pageHead('Live chat inbox') +
    `<div class="achat apanel">` +
    `<ul class="achat__list" aria-label="Conversations">${each(threads, ([who, text, on]) => `<li><a href="#"${on ? ' aria-current="true"' : ''}><span class="strong small">${esc(who)}</span><span class="small muted">${esc(text)}</span></a></li>`)}</ul>` +
    `<section class="achat__thread stack" aria-label="Conversation with Customer name"><p class="strong small">Customer name · online</p>` +
    `<div class="bubble small">Hello, where is my order HBD-10432?</div><div class="bubble bubble--me small">Hello. It left Lagos this morning with DHL; here is the tracking link.</div>` +
    `<div class="chips">${each(['delivery times', 'returns', 'duties'], (r) => `<button class="chip" type="button" data-fill="chat-reply" data-fill-text="Saved reply about ${r}.">Saved reply: ${r}</button>`)}</div>` +
    `<form class="row row--nowrap achat__form" action="#" data-chat-form>${field('Type a reply', { id: 'chat-reply' })}${button('Send', { type: 'submit' })}</form></section>` +
    `<aside class="achat__side stack" aria-label="About this customer"><h2 class="apanel__title">Customer</h2><p class="small">Name · 3 orders · Gold</p><h2 class="apanel__title">Latest order</h2><p class="small">HBD-10432 · Shipped · DHL 1234567890</p>` +
    button('Open order', { kind: 'secondary', href: '/admin/orders/hbd-10432/', full: true }) +
    button('Close conversation', { kind: 'secondary', full: true }) +
    `</aside></div>`
  );
}

export function homepage(): string {
  const sections: Array<[string, boolean]> = [['Hero banner', true], ['Shop by collection', true], ['Best-sellers', true], ['New arrivals', true], ['Shop the look', true], ['Customer reviews', false]];
  return (
    pageHead('Homepage and banners', button('Preview', { kind: 'secondary', href: '/' }) + button('Publish', { attrs: 'data-toast="Homepage published. This is a preview, so nothing was stored."' })) +
    `<div class="acols acols--wide">` +
    panel(
      'Sections',
      `<p class="small muted">Use the arrows to change the order.</p><ol class="asort" data-sort>${each(
        sections,
        ([name, shown]) =>
          `<li><span class="grow">${esc(name)}</span><span class="small muted">${shown ? 'Shown' : 'Hidden'}</span><a class="link small" href="#edit">Edit</a>` +
          `<button class="icon-btn" type="button" data-move="-1" aria-label="Move ${esc(name)} up">↑</button><button class="icon-btn" type="button" data-move="1" aria-label="Move ${esc(name)} down">↓</button></li>`,
      )}</ol>`,
    ) +
    `<div id="edit">` +
    panel(
      'Edit: hero banner',
      `<div class="photo" style="--ratio:2/1" role="img" aria-label="Banner image">banner image (desktop and phone crops)</div>` +
        field('Headline') +
        field('Supporting sentence') +
        `<div class="fields fields--2">${field('Button label', { value: 'Shop new arrivals' })}${field('Links to', { options: ['Collection: New arrivals', 'Collection: Best-sellers', 'Category: Wigs'] })}${field('Show from', { value: '10 Nov' })}${field('Until', { value: 'No end date' })}</div>` +
        field('Countries', { options: ['All', 'Nigeria', 'United Kingdom', 'United States'] }),
    ) +
    `</div></div>`
  );
}

export function contentPages(): string {
  return (
    pageHead('Content pages', button('New page')) +
    `<div class="acols acols--wide">` +
    panel(
      '',
      table(
        ['Page', 'Type', 'Last changed', 'Status'],
        [
          ['About', 'Information', '2 Nov · Staff name', status('Published', 'good')],
          ['Shipping and delivery', 'Information', '1 Nov · Staff name', status('Published', 'good')],
          ['Returns and refunds', 'Policy', '1 Nov · Staff name', status('Published', 'good')],
          ['Privacy policy', 'Legal', '29 Oct · Staff name', status('Published', 'good')],
          ['How to care for a lace wig', 'Hair guide', '28 Oct · Staff name', status('Draft', 'off')],
          ['FAQ', 'Questions', '27 Oct · Staff name', status('Published', 'good')],
        ],
        { caption: 'Content pages', minWidth: 560 },
      ),
    ) +
    panel(
      'Editor',
      field('Title', { value: 'Shipping and delivery' }) +
        `<div class="aeditor"><div class="aeditor__bar" role="toolbar" aria-label="Text formatting">${each(['Bold', 'Italic', 'Heading 2', 'Heading 3', 'List', 'Link', 'Image'], (b) => `<button type="button" class="chip">${b}</button>`)}</div>` +
        `<label class="visually-hidden" for="page-text">Page text</label><textarea class="field__input" id="page-text" rows="10" placeholder="page text"></textarea></div>` +
        `<div class="fields fields--2">${field('URL', { value: '/shipping' })}${field('Search description')}</div>` +
        `<div class="row">${button('Save draft', { kind: 'secondary', attrs: SAVED })}${button('Publish', { attrs: 'data-toast="Page published. This is a preview, so nothing was stored."' })}</div>`,
    ) +
    `</div>`
  );
}

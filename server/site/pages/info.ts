// Information, legal and system pages.

import { accordion, button, card, chipLinks, field, photo, productCard } from '../components.js';
import { each, esc } from '../html.js';
import { sampleProducts } from '../sample-data.js';

function article(title: string, sections: ReadonlyArray<[string, string]>, side = ''): string {
  return `<h1 class="h1">${esc(title)}</h1><div class="split" style="--side:300px;--side-tablet:260px"><div class="stack stack--lg">${each(sections, ([h, p]) => `<section class="stack stack--sm"><h2 class="h3">${esc(h)}</h2><p class="muted">${esc(p)}</p></section>`)}</div><div class="stack">${side}</div></div>`;
}

export function about(): string {
  return (
    photo('Brand photo', { ratio: '21 / 9' }) +
    article(
      'Our story',
      [
        ['Where we started', 'Sample text. Two or three lines of the hairbydemj story go here.'],
        ['How we source our hair', 'Sample text. Where the hair comes from and how it is chosen.'],
        ['Our promise', 'Sample text. What every customer can expect from us.'],
      ],
      photo('Founder photo', { ratio: '4 / 5' }),
    )
  );
}

export function contact(): string {
  return `<h1 class="h1">Contact us</h1><div class="split" style="--side:340px"><form class="stack" action="#"><div class="fields fields--2">${field('Name', { autocomplete: 'name' })}${field('Email', { type: 'email', autocomplete: 'email' })}</div>${field('Order number (optional)', { placeholder: 'HBD-00000' })}${field('How can we help?', { options: ['Choose a topic', 'An order', 'A return', 'A product question', 'Something else'] })}${field('Message', { textarea: true })}${button('Send message', { type: 'submit', fullPhone: true })}</form>
${card(`${button('Message on WhatsApp', { kind: 'secondary', full: true, icon: 'whatsapp' })}${button('Start a live chat', { kind: 'secondary', full: true, icon: 'chat', attrs: 'data-chat-open' })}<p class="small muted">hello@hairbydemj.com<br>Monday to Saturday, 9:00 to 18:00 (Lagos time)</p>`, { title: 'Other ways to reach us' })}</div>`;
}

export function faq(): string {
  const qs: ReadonlyArray<[string, string]> = [
    ['How long does delivery take?', 'Within Nigeria, 1 to 4 days. To the UK, US and Europe, 3 to 7 days. The exact time shows at checkout for your address.'],
    ['Do I pay customs duties?', 'Outside Nigeria, yes. Import duties and taxes are charged by your country and paid by you to the carrier on delivery. They are not part of our price.'],
    ['Which payment methods do you accept?', 'In naira: card, bank transfer and USSD through Paystack. In dollars, pounds and euros: card, Apple Pay and Google Pay through Stripe.'],
    ['How do I return an item?', 'Start from your order page within 14 days of delivery. We reply within 2 working days.'],
    ['How do I choose a length and density?', 'See the length and density guide for drawings of where each length falls.'],
  ];
  return `<h1 class="h1">Questions and answers</h1>${field('Search the questions', { type: 'search', placeholder: 'For example: customs' })}${chipLinks([['Products', '#', true], ['Shipping', '#'], ['Payments', '#'], ['Returns', '#'], ['Account', '#']])}<div>${each(qs, ([q, a], i) => accordion(q, `<p>${esc(a)}</p>`, i === 0))}</div>`;
}

export function guides(): string {
  const p = sampleProducts(1)[0];
  return `<h1 class="h1">Hair guides</h1><div class="grid" style="--cols:3;--cols-tablet:3;--cols-phone:1">${[1, 2, 3].map(() => `<a class="stack stack--sm" href="#article" style="text-decoration:none">${photo('Article photo', { ratio: '16 / 10' })}<span class="h3">Article title</span><span class="small muted">One line summary · 4 min read</span></a>`).join('')}</div><hr class="divider" id="article">
<div class="split" style="--side:300px;--side-tablet:260px"><article class="stack stack--lg"><h2 class="h1">How to care for a lace wig</h2><section class="stack stack--sm"><h3 class="h3">Washing</h3><p class="muted">Sample text. Paragraph of two or three lines.</p></section><section class="stack stack--sm"><h3 class="h3">Storing</h3><p class="muted">Sample text. Paragraph of two or three lines.</p></section></article><aside class="stack"><h2 class="strong">Products in this guide</h2>${p ? productCard(p) : ''}</aside></div>`;
}

export function lengthGuide(): string {
  const d: ReadonlyArray<string> = ['150% natural', '180% full', '200% extra full'];
  return `<h1 class="h1">Length and density guide</h1><section class="stack"><h2 class="h3">Length</h2>${photo('Drawing: figure with length marks from 12 to 30 inches', { ratio: '16 / 9' })}</section>
<section class="stack"><h2 class="h3">Density</h2><div class="grid" style="--cols:3;--cols-tablet:3;--cols-phone:1">${each(d, (x) => `<div class="stack stack--sm">${photo(x, { ratio: '4 / 3' })}<p class="small muted">What it looks like and who it suits.</p></div>`)}</div></section>
<section class="stack stack--sm"><h2 class="h3">Cap size</h2><p class="muted">Small, medium or large. How to measure your head.</p></section>${button('Shop wigs', { href: '/wigs/', fullPhone: true })}`;
}

export function shipping(): string {
  const rows: ReadonlyArray<[string, string, string]> = [
    ['Nigeria', '1 to 4 days', 'No import duties'],
    ['United Kingdom', '3 to 6 days', 'Duties and VAT paid by you on delivery'],
    ['United States', '3 to 7 days', 'Duties may apply; paid by you on delivery'],
    ['Europe', '3 to 7 days', 'Duties and VAT paid by you on delivery'],
    ['Rest of the world', '5 to 10 days', 'Duties depend on your country'],
  ];
  return `<h1 class="h1">Shipping and delivery</h1><p class="muted">We ship worldwide with DHL, UPS and FedEx. The exact price shows at checkout from the carrier's live rates.</p>
<table class="table"><thead><tr><th scope="col">Where</th><th scope="col">Delivery time</th><th scope="col">Duties and taxes</th></tr></thead><tbody>${each(rows, ([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`)}</tbody></table>
<section class="stack stack--sm"><h2 class="h3">Duties and taxes</h2><p class="muted">Import duties and taxes are charged by your country and paid by you to the carrier. They are not part of our price.</p></section>`;
}

export function returnsPolicy(): string {
  return article(
    'Returns and refunds',
    [
      ['What can be returned', 'Unworn items within 14 days of delivery. Custom-coloured and cut-lace items cannot be returned unless faulty.'],
      ['How to return', 'Start from your order page. We reply within 2 working days.'],
      ['Refunds', 'To your original payment method within 5 to 10 days of us receiving the item, or as store credit at once.'],
    ],
    card(button('Go to my orders', { href: '/account/orders/', full: true }) + button('Track as a guest', { kind: 'secondary', href: '/track-order/', full: true }), { title: 'Start a return' }),
  );
}

export function legal(): string {
  const s: ReadonlyArray<[string, string]> = [
    ['1. What we collect', 'Sample text.'],
    ['2. How we use it', 'Sample text.'],
    ['3. Your rights (GDPR and NDPA)', 'Sample text.'],
    ['4. Cookies', 'Sample text.'],
  ];
  return article('Privacy policy', s, card(`<ul class="stack stack--sm small muted">${each(s, ([h]) => `<li>${esc(h)}</li>`)}</ul>${button('Change cookie choices', { kind: 'secondary', full: true, attrs: 'data-cookie-open' })}`, { title: 'On this page', outline: true }));
}

export function system(): string {
  const states: ReadonlyArray<[string, string, string, string]> = [
    ['Page not found', 'We cannot find that page. It may have moved.', 'Go to the home page', '/'],
    ['Something went wrong', 'That is our fault, not yours. Please try again in a moment.', 'Try again', '#'],
    ['Back soon', 'We are making improvements. Orders already placed are safe.', 'Message on WhatsApp', '/contact/'],
    ['You are on the list', 'Thank you. Look out for new arrivals and offers.', 'Start shopping', '/wigs/'],
    ['You are unsubscribed', 'You will no longer get offers by email. Order updates still arrive.', 'Subscribe again', '#'],
  ];
  return `<h1 class="h1">System pages</h1>${each(states, ([t, p, b, h]) => card(`<p class="muted">${esc(p)}</p>${button(b, { href: h, fullPhone: true })}`, { title: t, outline: true }))}`;
}

export function notFound(): string {
  return `<div class="stack center narrow" style="align-items:center;padding:48px 0"><h1 class="h1">Page not found</h1><p class="muted">We cannot find that page. It may have moved.</p>${button('Go to the home page', { href: '/', full: true })}</div>`;
}

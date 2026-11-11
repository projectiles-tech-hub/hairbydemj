// Sign-in pages and the "My account" area.

import { button, card, check, chipLinks, divider, field, icon, kv, listLoader, photo, productCard, rating, sectionHead } from '../components.js';
import { each, esc } from '../html.js';
import { naira, sampleProducts } from '../sample-data.js';

const MENU: ReadonlyArray<[label: string, href: string]> = [
  ['Overview', '/account/'],
  ['Orders', '/account/orders/'],
  ['Returns', '/account/returns/'],
  ['Wishlist', '/account/wishlist/'],
  ['Loyalty and referrals', '/account/loyalty/'],
  ['Addresses', '/account/addresses/'],
  ['Payment methods', '/account/payment-methods/'],
  ['Profile and security', '/account/profile/'],
  ['My reviews', '/account/reviews/'],
  ['Communication preferences', '/account/preferences/'],
  ['Sign out', '/sign-in/'],
];

/** The account shell: side menu on wider screens, one drop-down on phones. */
function shell(active: string, inner: string): string {
  return `<h1 class="h1">My account</h1>
<div class="account">
<nav class="account__nav" aria-label="Account">${each(MENU, ([l, h]) => `<a href="${h}"${l === active ? ' aria-current="page"' : ''}>${esc(l)}</a>`)}</nav>
<div class="field account__jump"><label class="field__label" for="account-jump">Account section</label><select class="field__input" id="account-jump" data-jump>${each(MENU, ([l, h]) => `<option value="${h}"${l === active ? ' selected' : ''}>${esc(l)}</option>`)}</select></div>
<div class="stack stack--lg">${inner}</div></div>`;
}

function narrow(inner: string, action: string): string {
  return `<form class="stack narrow" action="${action}">${inner}</form>`;
}

export function signIn(): string {
  return narrow(
    `<h1 class="h1">Sign in</h1>${field('Email', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' })}${field('Password', { type: 'password', autocomplete: 'current-password' })}
<a class="link small" href="/forgot-password/">Forgot your password?</a>${button('Sign in', { type: 'submit', full: true })}<p class="small muted center">or</p>
${button('Continue with Google', { kind: 'secondary', full: true, href: '/account/' })}${button('Continue with Apple', { kind: 'secondary', full: true, href: '/account/' })}
<p class="center">New here? <a class="link" href="/create-account/">Create an account</a></p>`,
    '/account/',
  );
}

export function createAccount(): string {
  return narrow(
    `<h1 class="h1">Create your account</h1><div class="fields fields--2">${field('First name', { autocomplete: 'given-name' })}${field('Last name', { autocomplete: 'family-name' })}</div>
${field('Email', { type: 'email', autocomplete: 'email' })}${field('Password', { type: 'password', autocomplete: 'new-password', help: 'At least 8 characters.' })}
${check('Send me new arrivals and offers')}<p class="small muted">By creating an account you agree to the <a class="link" href="/privacy/">Terms and Privacy policy</a>.</p>
${button('Create account', { type: 'submit', full: true })}<p class="small muted center">or</p>
${button('Continue with Google', { kind: 'secondary', full: true, href: '/account/' })}${button('Continue with Apple', { kind: 'secondary', full: true, href: '/account/' })}
<p class="center">Already have an account? <a class="link" href="/sign-in/">Sign in</a></p>`,
    '/verify-email/',
  );
}

export function verifyEmail(): string {
  return narrow(
    `<h1 class="h1">Check your email</h1><p class="muted">We sent a 6-digit code to you@example.com.</p>
${field('6-digit code', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', inputClass: 'code-input' })}
${button('Verify', { type: 'submit', full: true })}<p class="small muted center">Did not get it? <a class="link" href="#">Resend code</a> · <a class="link" href="/create-account/">Change email</a></p>`,
    '/account/',
  );
}

export function forgotPassword(): string {
  return (
    narrow(
      `<h1 class="h1">Forgot your password?</h1><p class="muted">Enter your email and we will send you a link to set a new one.</p>${field('Email', { type: 'email', autocomplete: 'email' })}${button('Send reset link', { type: 'submit', full: true })}<a class="link small center" href="/sign-in/">Back to sign in</a>`,
      '#new',
    ) +
    `<hr class="divider narrow">` +
    narrow(
      `<h2 class="h2" id="new">Set a new password</h2><p class="small muted">This is the page the emailed link opens.</p>${field('New password', { type: 'password', autocomplete: 'new-password', help: 'At least 8 characters.' })}${field('Confirm new password', { type: 'password', autocomplete: 'new-password' })}${button('Save new password', { type: 'submit', full: true })}`,
      '/account/',
    )
  );
}

export function overview(): string {
  const tiles: ReadonlyArray<[string, string, string, string]> = [
    ['Loyalty points', '1,250 pts', `Worth ${naira(650000)}`, '/account/loyalty/'],
    ['Orders', '3 orders', '1 on its way', '/account/orders/'],
    ['Wishlist', '5 items', '2 back in stock', '/account/wishlist/'],
  ];
  return shell(
    'Overview',
    `<h2 class="h3">Hello, Name</h2>
<div class="grid" style="--cols:3;--cols-tablet:3;--cols-phone:1">${each(tiles, ([a, b, c, h]) => `<a class="card stack stack--xs" href="${h}" style="text-decoration:none"><span class="small muted">${a}</span><span class="h3">${b}</span><span class="small muted">${c}</span></a>`)}</div>
<section class="stack">${sectionHead('Recent orders', ['View all', '/account/orders/'])}${kv('HBD-10432 · Shipped', naira(38150000))}${divider()}${kv('HBD-10398 · Delivered', naira(16500000))}${divider()}</section>
<section class="stack stack--sm">${sectionHead('Default address', ['Edit', '/account/addresses/'])}<p class="muted">Name · 12 Street, Lagos, Nigeria · +234 800 000 0000</p></section>`,
  );
}

export function orders(): string {
  const list: ReadonlyArray<[string, string, string]> = [
    ['HBD-10432', 'Today', 'Shipped · DHL Express'],
    ['HBD-10398', '2 Nov', 'Delivered'],
    ['HBD-10211', '20 Oct', 'Refunded'],
  ];
  return shell(
    'Orders',
    `<h2 class="h3">Orders (12)</h2>${chipLinks([['All', '#', true], ['On its way', '#'], ['Delivered', '#'], ['Returned', '#'], ['Cancelled', '#']])}
${each(list, ([id, date, status]) => card(`<div class="row row--nowrap row--top">${photo('Order ' + id, { thumb: 56 })}<div class="stack stack--xs grow"><span class="strong">Order ${id} · ${date}</span><span class="small muted">${status} · 2 items · ${naira(28500000)}</span></div></div><div class="row">${button('Track order', { href: '/account/orders/hbd-10432/', fullPhone: true })}${button('Buy again', { kind: 'secondary', fullPhone: true })}</div>`, { outline: true }))}
<div data-endless data-total="12" data-batch="0">${listLoader(12, 'orders')}</div>`,
  );
}

export function orderDetail(): string {
  const items = sampleProducts(3).filter((_, i) => i !== 1);
  return `<p class="small muted">Account › Orders › HBD-10432</p>
<div class="row row--between"><h1 class="h1">Order HBD-10432</h1><div class="row">${button('Download invoice', { kind: 'secondary', fullPhone: true })}${button('Start a return', { kind: 'secondary', href: '/account/returns/', fullPhone: true })}</div></div>
<div class="split" style="--side-tablet:260px"><div class="stack stack--lg">
<ol class="progress" aria-label="Order progress">${['Confirmed', 'Preparing', 'Shipped', 'Out for delivery', 'Delivered'].map((s, i) => `<li class="${i < 3 ? 'is-done' : ''}"${i === 2 ? ' aria-current="step"' : ''}>${s}</li>`).join('')}</ol>
${card(`<p class="strong">DHL Express · 1234567890 · <a class="link" href="#">Open on DHL</a></p>${kv('Today 09:12', 'Departed facility, Lagos')}${kv('Yesterday 18:40', 'Picked up')}${kv('2 days ago', 'Shipment information received')}`, { outline: true })}
<section class="stack"><h2 class="h3">Items</h2>${each(items, (p) => `<div class="row row--top row--nowrap">${photo(p.name, { thumb: 64 })}<div class="stack stack--xs grow"><span class="strong">${esc(p.name)}</span><span class="small muted">${esc(p.details)} · Qty 1 · ${naira(p.priceMinor)}</span><a class="link small" href="/account/reviews/">Write a review</a></div></div>`)}</section></div>
<div class="stack">${card(`<p class="small muted">Name · 12 Street, Lagos, Nigeria</p>`, { title: 'Delivery address' })}${card(`<p class="small muted">Paystack · Card ending 1234 · Paid</p>`, { title: 'Payment' })}${card(kv('Subtotal', naira(36300000)) + kv('Shipping', naira(1850000)) + kv('Total', naira(38150000), { strong: true, price: true }), { title: 'Totals' })}</div></div>`;
}

export function returns(): string {
  const items = sampleProducts(3).filter((_, i) => i !== 1);
  return `<p class="small muted">Account › Orders › HBD-10432 › Return</p><h1 class="h1">Request a return</h1>
<div class="split" style="--side-tablet:260px"><form class="stack stack--lg" action="/account/orders/">
<fieldset class="stack"><legend class="h3" style="margin-bottom:12px">1. Choose the items</legend>${each(items, (p, i) => `<label class="check" style="align-items:center"><input type="checkbox"${i === 0 ? ' checked' : ''}>${photo(p.name, { thumb: 56 })}<span class="stack stack--xs"><span class="strong">${esc(p.name)}</span><span class="small muted">${esc(p.details)} · Qty 1</span></span></label>`)}</fieldset>
<section class="stack"><h2 class="h3">2. Tell us why</h2>${field('Reason', { options: ['Choose a reason', 'Wrong item received', 'Damaged or faulty', 'Not as described', 'Changed my mind'] })}${field('Details (optional)', { textarea: true })}<div class="row">${photo('Add a photo', { thumb: 80 })}${photo('Photo 2', { thumb: 80 })}${photo('Photo 3', { thumb: 80 })}</div><p class="small muted">Photos are needed for damaged or wrong items.</p></section>
<fieldset class="stack stack--sm"><legend class="h3" style="margin-bottom:12px">3. How you get your refund</legend>${check('Original payment method (card ending 1234)', { type: 'radio', name: 'refund', checked: true })}${check('Store credit (+10%)', { type: 'radio', name: 'refund' })}</fieldset>
${button('Send return request', { type: 'submit', fullPhone: true })}</form>
<div class="stack">${card(`<ul class="stack stack--sm small muted" style="list-style:disc;padding-left:18px"><li>Request within 14 days of delivery.</li><li>We review within 2 working days.</li><li>Ship the item back with the instructions we send.</li><li>Refund within 5 to 10 days of receipt.</li></ul>`, { title: 'How returns work' })}${card(kv('RET-204 · HBD-10398', 'Refund issued') + kv('RET-198 · HBD-10211', 'Awaiting item'), { title: 'Your returns', outline: true })}</div></div>`;
}

export function wishlist(): string {
  const items = sampleProducts(5);
  return shell(
    'Wishlist',
    `<div class="row row--between"><h2 class="h3">Wishlist (${items.length})</h2><a class="link small" href="#">Share list</a></div>
<div class="grid" style="--cols:3;--cols-tablet:3;--cols-phone:2">${each(items, (p, i) => `<div class="stack stack--sm">${productCard(p)}${i === 4 ? button('Notify me', { kind: 'secondary', full: true }) : button('Add to bag', { full: true, attrs: 'data-open="mini-cart"' })}<a class="link small" href="#">Remove</a></div>`)}</div>`,
  );
}

export function loyalty(): string {
  return shell(
    'Loyalty and referrals',
    `<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">${card(`<span class="small muted">Your points</span><span class="h2">1,250 pts</span><p class="small muted">Worth ${naira(650000)} off your next order · Gold tier</p>${button('Use points at checkout', { href: '/checkout/', full: true })}`)}${card(`<span class="small muted">Refer a friend</span><span class="h3">You both get 500 points</span>${field('Your link', { value: 'hairbydemj.com/r/NAME123' })}${button('Copy link', { kind: 'secondary', full: true })}`)}</div>
<section class="stack stack--sm"><h2 class="h3">How to earn</h2><ul class="stack stack--sm" style="list-style:disc;padding-left:18px"><li>1 point for every ₦1,000 spent</li><li>100 points for a review with photos</li><li>500 points when a friend you referred places an order</li><li>Birthday bonus: 200 points</li></ul></section>
<section class="stack"><h2 class="h3">Points history</h2>${kv('Today · Order HBD-10432', '+ 350')}${divider()}${kv('2 Nov · Review with photos', '+ 100')}${divider()}${kv('20 Oct · Used at checkout', '− 500')}${divider()}</section>`,
  );
}

export function addresses(): string {
  return shell(
    'Addresses',
    `<div class="row row--between"><h2 class="h3">Addresses</h2>${button('Add address', { href: '#address-form' })}</div>
<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">${card(`<p class="strong">Home · Default</p><p class="small muted">Name<br>12 Street<br>Lagos, Nigeria<br>+234 800 000 0000</p><p class="small"><a class="link" href="#address-form">Edit</a> · <a class="link" href="#">Remove</a></p>`, { outline: true })}${card(`<p class="strong">Office</p><p class="small muted">Name<br>45 Avenue<br>Abuja, Nigeria<br>+234 800 000 0000</p><p class="small"><a class="link" href="#address-form">Edit</a> · <a class="link" href="#">Remove</a> · <a class="link" href="#">Make default</a></p>`, { outline: true })}</div>
<form class="card card--outline stack" id="address-form" action="#"><h2 class="h3">Add or edit an address</h2><div class="fields fields--2">${field('Full name', { autocomplete: 'name' })}${field('Phone', { type: 'tel', autocomplete: 'tel', placeholder: '+234', help: 'The carrier calls this number on delivery.' })}</div>
${field('Country', { options: ['Nigeria', 'Ghana', 'United Kingdom', 'United States', 'Canada'], value: 'Nigeria' })}${field('Street address', { autocomplete: 'address-line1' })}${field('Apartment, landmark (optional)', { autocomplete: 'address-line2' })}
<div class="fields fields--2">${field('City', { autocomplete: 'address-level2' })}${field('State', { options: ['Lagos', 'Edo', 'Abuja (FCT)', 'Rivers'] })}</div>${field('Postcode (if your country uses one)', { autocomplete: 'postal-code' })}
${check('Make this my default address')}<div class="row">${button('Save address', { type: 'submit', fullPhone: true })}${button('Cancel', { kind: 'secondary', fullPhone: true })}</div></form>`,
  );
}

export function paymentMethods(): string {
  return shell(
    'Payment methods',
    `<div class="row row--between"><h2 class="h3">Payment methods</h2>${button('Add card', { href: '#card-form' })}</div>
${card(`<p class="strong">Visa ending 1234 · Default</p><p class="small muted">Expires 08/28 · Paystack (NGN)</p><p class="small"><a class="link" href="#">Remove</a></p>`, { outline: true })}
${card(`<p class="strong">Mastercard ending 5678</p><p class="small muted">Expires 01/27 · Stripe (USD, GBP, EUR)</p><p class="small"><a class="link" href="#">Make default</a> · <a class="link" href="#">Remove</a></p>`, { outline: true })}
<form class="card card--outline stack" id="card-form" action="#"><h2 class="h3">Add a card</h2><p class="small muted">${icon('lock', 16)} Secure form from Paystack or Stripe. We never see or store your card number.</p>
<div class="card stack">${field('Card number', { inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '0000 0000 0000 0000' })}<div class="fields fields--2">${field('Expiry', { placeholder: 'MM / YY', autocomplete: 'cc-exp' })}${field('Security code', { placeholder: 'CVV', autocomplete: 'cc-csc', inputmode: 'numeric' })}</div>${field('Name on card', { autocomplete: 'cc-name' })}</div>
${check('Make this my default card', { checked: true })}<div class="row">${button('Save card', { type: 'submit', fullPhone: true })}${button('Cancel', { kind: 'secondary', fullPhone: true })}</div>
<p class="small muted">Your bank may ask you to approve this with a code or in your banking app.</p></form>
${card(`<p class="small muted">When there are no cards: "Save a card to check out faster. You can also pay by bank transfer or USSD at checkout without saving anything."</p>`, { title: 'No saved cards yet' })}`,
  );
}

export function profile(): string {
  return shell(
    'Profile and security',
    `<form class="card card--outline stack" action="#"><h2 class="h3">Your details</h2><div class="fields fields--2">${field('First name', { value: 'Name', autocomplete: 'given-name' })}${field('Last name', { value: 'Surname', autocomplete: 'family-name' })}${field('Phone', { type: 'tel', value: '+234 800 000 0000', autocomplete: 'tel' })}${field('Birthday (optional)', { placeholder: 'Day and month', help: 'For bonus points on your birthday.' })}</div>${button('Save changes', { type: 'submit', fullPhone: true })}</form>
<form class="card card--outline stack" action="#"><h2 class="h3">Email</h2><p>you@example.com · Verified ${icon('check', 16, 'verified')}</p>${field('New email', { type: 'email', autocomplete: 'email' })}${field('6-digit code sent to the new email', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', help: 'We send the code when you tap Change email. Your old address is told about the change.' })}${button('Change email', { type: 'submit', fullPhone: true })}</form>
<form class="card card--outline stack" action="#"><h2 class="h3">Password</h2>${field('Current password', { type: 'password', autocomplete: 'current-password' })}<div class="fields fields--2">${field('New password', { type: 'password', autocomplete: 'new-password', help: 'At least 8 characters.' })}${field('Confirm new password', { type: 'password', autocomplete: 'new-password' })}</div><p class="small muted">Changing your password signs you out on your other devices.</p>${button('Change password', { type: 'submit', fullPhone: true })}</form>
${card(kv('Google · connected', 'Disconnect') + kv('Apple · not connected', 'Connect'), { title: 'Sign-in methods', outline: true })}
<form class="card card--outline stack" action="/sign-in/"><h2 class="h3">Delete account</h2><p class="muted">This removes your profile, addresses, saved cards, wishlist and points. Order records are kept for the period the law requires. This cannot be undone.</p>${field('Type your password to confirm', { type: 'password', autocomplete: 'current-password' })}${button('Delete my account', { kind: 'secondary', type: 'submit', fullPhone: true })}</form>`,
  );
}

export function reviews(): string {
  const p = sampleProducts(1)[0];
  return shell(
    'My reviews',
    `<h2 class="h3">Waiting for your review</h2>
<form class="card card--outline stack" action="#"><div class="row row--nowrap row--top">${photo(p?.name ?? '', { thumb: 56 })}<div class="stack stack--xs"><span class="strong">${esc(p?.name ?? '')}</span><span class="small muted">Delivered 2 Nov</span></div></div>
<fieldset class="stack stack--sm"><legend class="strong" style="margin-bottom:8px">Your rating</legend><div class="row">${[1, 2, 3, 4, 5].map((n) => `<label class="icon-btn" style="color:var(--gold)"><input class="visually-hidden" type="radio" name="stars" value="${n}">${icon('starEmpty', 28, `${n} out of 5`)}</label>`).join('')}</div></fieldset>
${field('Title')}${field('Your review', { textarea: true, placeholder: 'What did you like? How does it wear?' })}<div class="row">${photo('Add a photo', { thumb: 72 })}${photo('Photo 2', { thumb: 72 })}${photo('Photo 3', { thumb: 72 })}</div>${button('Post review', { type: 'submit', fullPhone: true })}</form>
<h2 class="h3">Your reviews (2)</h2>${[['Published'], ['Being checked']].map(([state]) => card(`${rating(5, '5 out of 5 · Body wave bundles')}<p class="muted">Sample review. ${state}.</p><p class="small"><a class="link" href="#">Edit</a> · <a class="link" href="#">Delete</a></p>`, { outline: true })).join('')}`,
  );
}

export function preferences(): string {
  const groups: ReadonlyArray<[string, ReadonlyArray<[string, boolean, boolean?]>]> = [
    ['Order updates', [['Email (always on)', true, true], ['WhatsApp', true], ['SMS', false]]],
    ['Offers and new arrivals', [['Email', false], ['WhatsApp', false]]],
    ['Back-in-stock and price alerts', [['Email', true], ['WhatsApp', false]]],
    ['Review reminders', [['Email', true]]],
  ];
  return shell(
    'Communication preferences',
    `<form class="stack stack--lg" action="#"><h2 class="h3">Communication preferences</h2>${each(groups, ([title, opts]) => `<fieldset class="card card--outline stack stack--sm"><legend class="strong" style="float:left;margin-bottom:8px">${title}</legend><div style="clear:both" class="stack stack--sm">${each(opts, ([l, on, dis]) => check(l, { checked: on, disabled: dis }))}</div></fieldset>`)}${button('Save preferences', { type: 'submit', fullPhone: true })}</form>`,
  );
}

export function trackOrder(): string {
  return narrow(
    `<h1 class="h1">Track your order</h1><p class="muted">Enter the order number from your confirmation email.</p>${field('Order number', { placeholder: 'HBD-00000' })}${field('Email used for the order', { type: 'email', autocomplete: 'email' })}${button('Track order', { type: 'submit', full: true })}<p class="small muted center">Have an account? <a class="link" href="/sign-in/">Sign in</a> to see all your orders.</p>`,
    '/account/orders/hbd-10432/',
  );
}

export function formErrors(): string {
  const groups: ReadonlyArray<[string, ReadonlyArray<[string, string, string]>]> = [
    ['Sign in', [['Email', 'you@example', 'Enter a full email address, like name@example.com'], ['Password', '••••', 'Email or password is not right. Try again or reset your password.']]],
    ['Create account', [['Email', 'you@example.com', 'This email already has an account. Sign in instead.'], ['Password', 'abc', 'Use at least 8 characters.']]],
    ['Verify account', [['6-digit code', '123456', 'That code has expired. We have sent a new one.']]],
    ['Address', [['Phone', '0800', 'Enter the full number with country code, like +234 800 000 0000.'], ['Street address', '', 'Enter your street address so the carrier can find you.']]],
    ['Add card', [['Card number', '4000 0000 0000 0002', 'Your bank declined this card. Try another card or contact your bank.']]],
    ['Discount code', [['Code', 'WELCOME10', 'This code has expired.']]],
  ];
  return `<h1 class="h1">Form error states</h1><p class="muted">How every form shows mistakes: at the field, with an icon and a message that says how to fix it. What was typed is kept.</p>
<div class="grid" style="--cols:3;--cols-tablet:2;--cols-phone:1">${each(groups, ([title, fields]) => card(each(fields, ([l, v, e]) => field(l, { value: v, error: e })), { title, outline: true }))}</div>`;
}

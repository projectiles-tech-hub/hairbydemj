// Website pages for loyalty points, reviews and gift cards (module 17).

import { GIFT_CARDS } from '../../giftcards/giftcards.js';
import { loyaltySettings, loyaltyView } from '../../loyalty/loyalty.js';
import { itemsToReview, myReviews, productReviews, type ReviewView } from '../../reviews/reviews.js';
import { button, card, icon, sectionHead } from '../components.js';
import { each, esc } from '../html.js';
import { accountShell, field, formEnd } from './account.js';
import { money, type SiteContext } from './view.js';

const date = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const stars = (n: number): string => `<span class="stars" aria-label="${n} out of 5 stars">${'★'.repeat(n)}<span class="muted">${'★'.repeat(5 - n)}</span></span>`;
const naira = (sc: SiteContext, minor: number): string => money(sc, minor, sc.currencies.find((c) => c.code === 'NGN') ?? sc.currency);

const KIND_WORDS: Record<string, string> = { order: 'Order', review: 'Review', birthday: 'Birthday', referral: 'Referral', redeem: 'Spent', refund: 'Given back', adjust: 'From us', expire: 'Expired' };

export async function loyaltyPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const v = await loyaltyView(sc.deps.db, sc.customer!.id, sc.now);
  const link = `${sc.origin}/create-account/?ref=${encodeURIComponent(v.referralCode)}`;
  const r = v.rules;
  return {
    title: 'Points and referrals',
    body: accountShell(sc, '/account/loyalty/', 'Points and referrals', `
<div class="grid" style="--cols:2;--cols-tablet:2;--cols-phone:1">
${card(`<p class="display" style="margin:0">${v.points.toLocaleString('en-NG')}</p><p class="muted">points, worth ${esc(naira(sc, v.worthMinor))} at checkout</p><p><span class="strong">${esc(v.tier.name)}</span>${v.tier.benefit ? ` · ${esc(v.tier.benefit)}` : ''}</p>${v.nextTier ? `<p class="small muted">${v.nextTier.pointsToGo.toLocaleString('en-NG')} more points this year to reach ${esc(v.nextTier.name)}${v.nextTier.benefit ? ` (${esc(v.nextTier.benefit)})` : ''}.</p>` : ''}`, { title: 'Your points' })}
${card(`<p class="muted">Give friends your link. When a friend's first order is delivered, you get ${r.referralReferrer} points and they get ${r.referralFriend}.</p><div class="row row--nowrap" style="align-items:flex-end"><div class="field grow"><label class="field__label" for="ref-link">Your link</label><input class="field__input" id="ref-link" readonly value="${esc(link)}"></div>${button('Copy', { kind: 'secondary', attrs: `data-copy="${esc(link)}"` })}</div><p class="small muted">Or share your code: <span class="strong">${esc(v.referralCode)}</span>. ${v.referrals.invited} joined, ${v.referrals.rewarded} rewarded.</p>`, { title: 'Invite friends' })}
</div>
${card(`<ul class="stack stack--xs small">
<li>${r.pointsPer1000Ngn} ${r.pointsPer1000Ngn === 1 ? 'point' : 'points'} for every ₦1,000 you spend, once your order is delivered.</li>
<li>${r.reviewPoints} points for a review, ${r.reviewWithPhotosPoints} with photos, once it is published.</li>
<li>${r.birthdayBonus} points on your birthday (add it in <a class="link" href="/account/profile/">your details</a>).</li>
<li>At checkout, each point is worth ${esc(naira(sc, Math.round(r.nairaPerPoint * 100)))}. Use ${r.minimumToRedeem} or more at a time, for up to ${r.maxPercentOfOrder}% of the items.</li>
</ul>`, { title: 'How points work' })}
${card(v.history.length ? `<div class="stack stack--xs">${each(v.history, (h) => `<div class="row row--between"><span>${esc(KIND_WORDS[h.kind] ?? h.kind)}${h.orderNumber ? ` · ${esc(h.orderNumber)}` : ''}${h.note && h.kind !== 'redeem' && h.kind !== 'refund' ? ` · <span class="muted">${esc(h.note)}</span>` : ''}<br><span class="small muted">${esc(date(h.at))}</span></span><span class="strong">${h.points > 0 ? '+' : ''}${h.points.toLocaleString('en-NG')}</span></div><hr class="divider">`)}</div>` : '<p class="muted">No points yet. They arrive once an order is delivered.</p>', { title: 'History' })}`),
  };
}

function reviewCard(r: ReviewView, mine = false): string {
  const status = mine ? `<span class="small muted">${r.status === 'published' ? 'Published' : r.status === 'waiting' ? 'Waiting to be checked' : 'Not shown'}</span>` : '';
  return `<article class="stack stack--xs">${stars(r.rating)}<p class="small"><span class="strong">${esc(mine ? r.productName : r.author)}</span>${r.verifiedBuyer && !mine ? ` · ${icon('check', 14)} Verified buyer` : ''} · ${esc(date(r.createdAt))} ${status}</p><p>${esc(r.body)}</p>${r.photos.length ? `<div class="row">${each(r.photos, (p) => `<a href="/media/${esc(p.path)}/${p.widths[p.widths.length - 1] ?? 640}.jpg" target="_blank" rel="noopener"><img src="/media/${esc(p.path)}/640.jpg" alt="Photo from the review" width="96" height="96" loading="lazy" style="object-fit:cover;border-radius:8px"></a>`)}</div>` : ''}${r.reply ? `<p class="small" style="border-left:2px solid var(--gold);padding-left:12px"><span class="strong">hairbydemj replied:</span> ${esc(r.reply)}</p>` : ''}</article>`;
}

/** The reviews section of a product page. */
export async function productReviewsSection(sc: SiteContext, slug: string): Promise<{ html: string; rating: { average: number; count: number } | null }> {
  const page = Math.max(1, Number(sc.ctx.query.get('reviews')) || 1);
  const r = await productReviews(sc.deps.db, slug, page);
  const html = `<section class="stack" id="reviews" aria-labelledby="reviews-h">${sectionHead('Reviews').replace('<h2', '<h2 id="reviews-h"')}
${r.count ? `<div class="row" style="align-items:center">${stars(Math.round(r.average ?? 0))}<span class="strong">${r.average} out of 5</span><span class="muted">(${r.count} ${r.count === 1 ? 'review' : 'reviews'})</span></div>
<div class="stack stack--lg">${each(r.reviews, (x) => reviewCard(x))}</div>${r.more ? `<a class="link" href="?reviews=${page + 1}#reviews">More reviews</a>` : ''}` : '<p class="muted">No reviews yet. Bought this? You can review it from your account once it arrives.</p>'}
</section>`;
  return { html, rating: r.count ? { average: r.average ?? 0, count: r.count } : null };
}

export async function reviewsPage(sc: SiteContext): Promise<{ title: string; body: string }> {
  const [mine, todo] = await Promise.all([myReviews(sc.deps.db, sc.customer!.id), itemsToReview(sc.deps.db, sc.customer!.id)]);
  const rules = await loyaltySettings(sc.deps.db);
  return {
    title: 'Your reviews',
    body: accountShell(sc, '/account/reviews/', 'Reviews', `
${todo.length ? card(`<p class="small muted">Earn ${rules.reviewPoints} points for a review, ${rules.reviewWithPhotosPoints} with photos.</p>${each(todo, (t) => `<div class="row row--between"><span><span class="strong">${esc(t.productName)}</span><br><span class="small muted">${esc(t.description)} · ${esc(t.orderNumber)}</span></span>${button('Write a review', { kind: 'secondary', href: `/account/reviews/new/?item=${t.orderItemId}` })}</div><hr class="divider">`)}`, { title: 'Waiting for your review' }) : ''}
${card(mine.length ? `<div class="stack stack--lg">${each(mine, (r) => reviewCard(r, true))}</div>` : '<p class="muted">You have not written a review yet.</p>', { title: 'Your reviews' })}`),
  };
}

export async function writeReviewPage(sc: SiteContext): Promise<{ title: string; body: string } | null> {
  const item = Number(sc.ctx.query.get('item'));
  const todo = (await itemsToReview(sc.deps.db, sc.customer!.id)).find((t) => t.orderItemId === item);
  if (!todo) return null;
  return {
    title: 'Write a review',
    body: accountShell(sc, '/account/reviews/', 'Write a review', `
<p><span class="strong">${esc(todo.productName)}</span><br><span class="small muted">${esc(todo.description)}</span></p>
<form class="stack" data-review-form="${todo.orderItemId}" novalidate>
<fieldset class="stack stack--xs"><legend class="field__label">Your rating</legend><div class="rating">${each([5, 4, 3, 2, 1], (n) => `<label class="check"><input type="radio" name="rating" value="${n}"${n === 5 ? ' checked' : ''}><span>${stars(n)}</span></label>`)}</div><p class="field__error" data-error-for="rating" hidden></p></fieldset>
<div class="field"><label class="field__label" for="body">Your review</label><textarea class="field__input" id="body" name="body" rows="5" maxlength="2000" placeholder="How did it look, feel and last?"></textarea><p class="field__error" data-error-for="body" hidden></p></div>
<div class="field"><label class="field__label" for="photos">Photos (optional, up to 4)</label><input class="field__input" id="photos" name="photos" type="file" accept="image/*" multiple data-review-photos><p class="field__help">Photos of you wearing the hair are the most helpful.</p></div>
${formEnd('Send review')}
<p class="small muted">Reviews are checked before they appear, usually within a day.</p>
</form>`),
  };
}

export async function giftCardsPage(sc: SiteContext): Promise<{ title: string; description: string; body: string }> {
  const cur = sc.currency;
  const [min, max] = GIFT_CARDS.limits[cur.code] ?? [10, 1000];
  const presets = cur.code === 'NGN' ? [25_000, 50_000, 100_000, 200_000] : [50, 100, 150, 250];
  return {
    title: 'Gift cards',
    description: 'A hairbydemj gift card, sent by email, for any amount. Check a gift card balance.',
    body: `<h1 class="h1">Gift cards</h1>
<div class="split" style="--side:360px">
${card(`<form class="stack" data-gift-buy novalidate>
<fieldset class="stack stack--xs"><legend class="field__label">Amount (${esc(cur.code)})</legend><div class="chips">${each(presets, (p, i) => `<label class="chip"><input type="radio" name="preset" value="${p}"${i === 1 ? ' checked' : ''} class="visually-hidden"><span>${esc(money(sc, p * 10 ** cur.minorUnits))}</span></label>`)}</div></fieldset>
${field('amount', `Or another amount, from ${min.toLocaleString('en-NG')} to ${max.toLocaleString('en-NG')}`, 'inputmode="decimal" autocomplete="off"')}
<input type="hidden" name="currency" value="${esc(cur.code)}">
${field('recipientName', 'Their name', 'autocomplete="off"')}
${field('recipientEmail', 'Their email (the card is sent here)', 'type="email" autocomplete="off"')}
${field('fromName', 'From', `autocomplete="name" value=""`)}
<div class="field"><label class="field__label" for="message">Message (optional)</label><textarea class="field__input" id="message" name="message" rows="3" maxlength="300"></textarea></div>
${field('deliverOn', 'Send on (leave empty to send when paid)', 'type="date"')}
${sc.customer ? '' : field('email', 'Your email (for the receipt)', 'type="email" autocomplete="email"')}
<p class="small muted">Gift cards can be used on the website and in the app, for ${GIFT_CARDS.validDays / 365} years. They cannot be returned or changed for money.</p>
${formEnd('Buy and pay')}
</form>`, { title: 'Send a gift card' })}
${card(`<form class="stack" data-gift-balance novalidate>${field('code', 'Gift card code', 'autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX"')}${formEnd('Check balance')}</form><p class="strong" role="status" aria-live="polite" data-gift-result></p>`, { title: 'Check a balance' })}
</div>`,
  };
}

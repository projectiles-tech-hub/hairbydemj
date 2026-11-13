// Admin pages for gift cards, loyalty and referrals, and reviews (module 17).

import { can } from '../../accounts/staff.js';
import { listGiftCards } from '../../giftcards/giftcards.js';
import { listTiers, loyaltySettings } from '../../loyalty/loyalty.js';
import { listReviews } from '../../reviews/reviews.js';
import { each, esc } from '../../site/html.js';
import { num, panel, pageHead, raw, table, tabs } from '../components.js';
import { date, form, input, money, pager, postButton, select, textarea, type AdminContext } from './view.js';

const CARD_STATUS: Record<string, string> = { active: 'Active', used_up: 'Used up', expired: 'Expired', disabled: 'Switched off' };

export async function giftCards(ac: AdminContext): Promise<string> {
  const q = ac.ctx.query;
  const list = await listGiftCards(ac.deps.db, ac.staff, q);
  const status = q.get('status');
  const change = can(ac.staff, 'discounts', 'change');
  const currencies = [...ac.currencies.values()].map((c): [string, string] => [c.code, c.code]);
  return `${pageHead('Gift cards')}
${tabs('Gift card status', [['All', '/gift-cards/', !status], ...Object.entries(CARD_STATUS).map(([k, l]): [string, string, boolean] => [l, `/gift-cards/?status=${k}`, status === k])])}
<form class="afilters" method="get" action="/gift-cards/" role="search">${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ''}<label class="afilter" for="gq"><span class="visually-hidden">Search</span><input class="field__input" id="gq" name="q" type="search" placeholder="Email or last 4 of the code" value="${esc(q.get('q') ?? '')}"></label><button class="btn btn--secondary" type="submit">Search</button></form>
${list.cards.length ? table(['Card', 'For', 'Value', 'Left', 'Where from', 'Expires', 'Status', ''], list.cards.map((c) => [
    raw(`<span class="strong">…${esc(String(c.last4))}</span>`),
    raw(`${esc(String(c.recipientName ?? ''))}<br><span class="small muted">${esc(String(c.recipientEmail))}</span>`),
    num(money(ac, Number(c.initialMinor), String(c.currency))),
    num(money(ac, Number(c.balanceMinor), String(c.currency))),
    String(c.source),
    c.expiresAt ? date(String(c.expiresAt)) : '',
    CARD_STATUS[String(c.status)] ?? String(c.status),
    raw(change ? (c.status === 'disabled' ? postButton('Switch on', `/api/gift-cards/${Number(c.id)}/enable`, { kind: 'text' }) : postButton('Switch off', `/api/gift-cards/${Number(c.id)}/disable`, { kind: 'text', confirm: 'Switch off this gift card? It cannot be used until switched on again.' })) : ''),
  ]), { caption: 'Gift cards', minWidth: 960 }) : '<div class="aempty"><h2 class="h3">No gift cards</h2></div>'}
${pager(ac, list.page, list.page * 50 < list.total, list.total, 50)}
${change ? panel('Issue a gift card', `<p class="small muted">For a goodwill gesture or a prize. The code is emailed to the person; you will not see it. The reason is kept in the activity log.</p>${form('/api/gift-cards', `<div class="fields fields--2">${input('amountMinor', 'Value', { data: 'minor' })}${select('currency', 'Currency', currencies, 'NGN')}</div><div class="fields fields--2">${input('recipientName', 'Their name')}${input('recipientEmail', 'Their email', { type: 'email' })}</div>${input('reason', 'Why (for the record)')}${textarea('message', 'Message in the email (optional)', '', { rows: 2 })}`, { submit: 'Issue and email', confirm: 'Issue this gift card and email it now?' })}`) : ''}`;
}

export async function loyaltyPage(ac: AdminContext): Promise<string> {
  const rules = await loyaltySettings(ac.deps.db);
  const tiers = await listTiers(ac.deps.db);
  const change = can(ac.staff, 'discounts', 'change');
  const stats = (await ac.deps.db.query("select coalesce(sum(loyalty_points), 0)::bigint as points, count(*) filter (where loyalty_points > 0)::int as holders from customers where status = 'active'")).rows[0];
  const refs = (await ac.deps.db.query("select count(*)::int as n, count(*) filter (where status = 'rewarded')::int as rewarded from referrals")).rows[0];
  return `${pageHead('Loyalty and referrals')}
<div class="grid" style="--cols:3;--cols-tablet:3;--cols-phone:1">
${panel('Points held', `<p class="h2">${Number(stats?.points ?? 0).toLocaleString('en-NG')}</p><p class="small muted">by ${Number(stats?.holders ?? 0)} customers, worth ${esc(money(ac, Math.round(Number(stats?.points ?? 0) * rules.nairaPerPoint * 100), 'NGN'))}</p>`)}
${panel('Referrals', `<p class="h2">${Number(refs?.n ?? 0)}</p><p class="small muted">${Number(refs?.rewarded ?? 0)} rewarded</p>`)}
${panel('One point is worth', `<p class="h2">${esc(money(ac, Math.round(rules.nairaPerPoint * 100), 'NGN'))}</p><p class="small muted">at checkout</p>`)}
</div>
${panel('Point rules', change ? form('/api/settings/loyalty', `<div class="fields fields--2">${input('pointsPer1000Ngn', 'Points for each ₦1,000 spent (on delivery)', { value: rules.pointsPer1000Ngn, data: 'number' })}${input('nairaPerPoint', 'What one point is worth at checkout (₦)', { value: rules.nairaPerPoint, data: 'number' })}</div>
<div class="fields fields--2">${input('minimumToRedeem', 'Fewest points used at once', { value: rules.minimumToRedeem, data: 'number' })}${input('maxPercentOfOrder', 'Points pay at most (% of the items)', { value: rules.maxPercentOfOrder, data: 'number' })}</div>
<div class="fields fields--3">${input('reviewPoints', 'For a review', { value: rules.reviewPoints, data: 'number' })}${input('reviewWithPhotosPoints', 'For a review with photos', { value: rules.reviewWithPhotosPoints, data: 'number' })}${input('birthdayBonus', 'On their birthday', { value: rules.birthdayBonus, data: 'number' })}</div>
<div class="fields fields--2">${input('referralReferrer', 'To the customer who invited', { value: rules.referralReferrer, data: 'number' })}${input('referralFriend', 'To the friend who joined', { value: rules.referralFriend, data: 'number' })}</div>
<p class="small muted">Referral points are given when the friend's first order is delivered. Points for orders are taken back when goods are refunded.</p>`, { submit: 'Save rules' }) : `<p>${rules.pointsPer1000Ngn} per ₦1,000</p>`)}
${panel('Tiers', `<p class="small muted">A customer's tier comes from the points they earned in the last 12 months.</p>${change ? form('/api/loyalty/tiers', each(tiers, (t, i) => `<input type="hidden" data-key="tiers.${i}.code" value="${esc(t.code)}"><div class="fields fields--3">${input(`tiers.${i}.name`, 'Name', { value: t.name })}${input(`tiers.${i}.minPoints`, 'Points needed', { value: t.minPoints, data: 'number', attrs: t.code === 'bronze' ? 'readonly' : '' })}${input(`tiers.${i}.benefit`, 'What they get', { value: t.benefit })}</div>`), { submit: 'Save tiers' }) : table(['Tier', 'Points', 'Benefit'], tiers.map((t) => [t.name, num(t.minPoints), t.benefit]), { caption: 'Tiers' })}`)}
<p class="small muted">To add or take away a customer's points, open the customer.</p>`;
}

const REVIEW_STATUS: Record<string, string> = { waiting: 'Waiting', published: 'Published', hidden: 'Hidden' };

export async function reviewsPage(ac: AdminContext): Promise<string> {
  const status = ac.ctx.query.get('status') ?? 'waiting';
  const list = await listReviews(ac.deps.db, ac.staff, ac.ctx.query);
  const change = can(ac.staff, 'products', 'change');
  return `${pageHead('Reviews')}
${tabs('Review status', Object.entries(REVIEW_STATUS).map(([k, l]): [string, string, boolean] => [`${l} (${list.counts[k] ?? 0})`, `/reviews/?status=${k}`, status === k]))}
${list.reviews.length ? each(list.reviews, (r) => panel(`${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} ${r.productName}`, `<p class="small muted">${esc(r.author)}${r.customerEmail ? ` (${esc(r.customerEmail)})` : ''} · ${esc(date(r.createdAt))}${r.verifiedBuyer ? ' · verified buyer' : ''}</p><p>${esc(r.body)}</p>${r.photos.length ? `<div class="row">${each(r.photos, (p) => `<a href="/media/${esc(p.path)}/${p.widths[p.widths.length - 1] ?? 640}.jpg" target="_blank" rel="noopener"><img src="/media/${esc(p.path)}/640.jpg" alt="Photo from the review" width="120" height="120" style="object-fit:cover;border-radius:8px"></a>`)}</div>` : ''}
${change ? `<div class="row">${r.status !== 'published' ? postButton('Publish', `/api/reviews/${r.id}`, { body: { status: 'published' } }) : ''}${r.status !== 'hidden' ? postButton('Hide', `/api/reviews/${r.id}`, { kind: 'secondary', body: { status: 'hidden' } }) : ''}</div>${form(`/api/reviews/${r.id}`, textarea('reply', r.reply ? 'Your reply (shown under the review)' : 'Reply (shown under the review; the customer is emailed)', r.reply ?? '', { rows: 2 }), { submit: r.reply ? 'Change reply' : 'Reply', secondary: true })}` : r.reply ? `<p class="small">Reply: ${esc(r.reply)}</p>` : ''}`)) : `<div class="aempty"><h2 class="h3">No ${esc((REVIEW_STATUS[status] ?? 'waiting').toLowerCase())} reviews</h2></div>`}`;
}

/** The points panel on a customer's page. */
export async function customerPointsPanel(ac: AdminContext, customerId: number): Promise<string> {
  const c = (await ac.deps.db.query('select loyalty_points, loyalty_tier, referral_code from customers where id = $1', [customerId])).rows[0];
  if (!c) return '';
  const history = await ac.deps.db.query('select points, kind, note, created_at from loyalty_transactions where customer_id = $1 order by created_at desc, id desc limit 10', [customerId]);
  const change = can(ac.staff, 'customers', 'change');
  return panel('Points', `<p><span class="strong">${Number(c.loyalty_points).toLocaleString('en-NG')} points</span> · ${esc(String(c.loyalty_tier))}${c.referral_code ? ` · code ${esc(String(c.referral_code))}` : ''}</p>${history.rows.length ? `<ul class="small">${each(history.rows, (h) => `<li>${Number(h.points) > 0 ? '+' : ''}${Number(h.points)} ${esc(String(h.kind))}${h.note ? `: ${esc(String(h.note))}` : ''} · ${esc(date(h.created_at as Date))}</li>`)}</ul>` : ''}${change ? `<details><summary class="link small">Add or take away points</summary>${form(`/api/customers/${customerId}/points`, `${input('points', 'Points (use a minus sign to take away)', { data: 'number' })}${input('note', 'Why (for the record)')}`, { submit: 'Save' })}</details>` : ''}`);
}

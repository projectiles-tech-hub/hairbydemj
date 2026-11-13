// The admin's live chat inbox (module 18). The page is made on the server;
// browser/staff.ts keeps it live with Server-Sent Events.

import { can } from '../../accounts/staff.js';
import { chatHub, inbox, savedReplies, staffConversation } from '../../chat/chat.js';
import { each, esc } from '../../site/html.js';
import { panel, pageHead, tabs } from '../components.js';
import { date, form, input, postButton, textarea, type AdminContext } from './view.js';

export async function chatInbox(ac: AdminContext): Promise<string> {
  const status = ac.ctx.query.get('status') === 'closed' ? 'closed' : 'open';
  const list = await inbox(ac.deps.db, ac.staff, status);
  const chosen = Number(ac.ctx.query.get('c')) || Number(list[0]?.id ?? 0);
  const change = can(ac.staff, 'customers', 'change');
  const conv = chosen ? await staffConversation({ db: ac.deps.db, now: ac.deps.now, hub: chatHub, mail: ac.deps.mail }, ac.staff, chosen).catch(() => null) : null;
  const replies = await savedReplies(ac.deps.db);
  const listHtml = list.length
    ? `<ul class="achat__list" data-chat-list>${each(list, (c) => `<li><a class="achat__item${c.id === chosen ? ' is-current' : ''}" href="/chat/?status=${status}&c=${c.id}"${c.id === chosen ? ' aria-current="page"' : ''}><span class="strong small">${esc(String(c.name))}${Number(c.unread) ? ` <span class="achat__unread">${Number(c.unread)}</span>` : ''}</span><span class="small muted">${esc(date(String(c.lastAt), true))}</span><span class="small achat__last">${esc(String(c.lastBody).slice(0, 80))}</span></a></li>`)}</ul>`
    : `<div class="aempty"><p class="muted">No ${status} conversations.</p></div>`;
  const messages = conv
    ? each(conv.messages as Array<{ id: number; sender: string; staffName: string | null; body: string; at: string }>, (m) => `<div class="achat__msg achat__msg--${m.sender}" data-message="${m.id}"><p>${esc(m.body)}</p><span class="small muted">${m.sender === 'staff' ? esc(m.staffName ?? 'Staff') : m.sender === 'system' ? '' : esc(String(conv.name))} · ${esc(date(m.at, true))}</span></div>`)
    : '';
  const latest = conv?.latestOrder as { id: number; number: string; status: string } | null | undefined;
  return `${pageHead('Live chat inbox')}
${tabs('Conversations', [['Open', '/chat/', status === 'open'], ['Closed', '/chat/?status=closed', status === 'closed']])}
<p class="small muted" data-chat-staff-note>Customers see that staff are online while this page is open.</p>
<div class="achat" data-chat-inbox data-current="${conv ? Number(conv.id) : ''}">
<div class="achat__col">${listHtml}</div>
<div class="achat__col achat__main">${conv ? `<h2 class="h3">${esc(String(conv.name))} <span class="small muted" data-chat-online>${conv.online ? '· online' : ''}</span></h2>
<div class="achat__messages" data-chat-messages aria-live="polite">${messages}</div>
${change ? `<div class="row">${each(replies, (r) => `<button class="btn btn--secondary small" type="button" data-saved-reply="${esc(r.body)}">${esc(r.title)}</button>`)}</div>
<form class="stack" data-chat-reply="${Number(conv.id)}" novalidate><div class="field"><label class="field__label" for="chat-reply">Type a reply</label><textarea class="field__input" id="chat-reply" rows="3" maxlength="2000" data-chat-text></textarea></div><div class="row"><button class="btn btn--primary" type="submit">Send</button></div><p class="small" role="alert" data-form-error></p></form>` : ''}` : '<div class="aempty"><p class="muted">Choose a conversation.</p></div>'}</div>
<div class="achat__col">${conv ? `<h2 class="h3">Customer</h2><p class="small">${esc(String(conv.name))}${conv.email ? `<br><a class="link" href="mailto:${esc(String(conv.email))}">${esc(String(conv.email))}</a>` : ''}${conv.customerId ? `<br>${Number(conv.orders)} orders${conv.tier ? ` · ${esc(String(conv.tier))}` : ''}` : '<br>Visitor (not signed in)'}</p>
${latest ? `<h3 class="strong small">Latest order</h3><p class="small">${esc(latest.number)} · ${esc(latest.status.replace('_', ' '))}</p><a class="btn btn--secondary" href="/orders/${latest.id}/">Open order</a>` : ''}
${conv.customerId ? `<a class="link small" href="/customers/${Number(conv.customerId)}/">Open customer</a>` : ''}
${change ? (conv.status === 'open' ? postButton('Close conversation', `/api/chat/conversations/${Number(conv.id)}/close`, { kind: 'secondary' }) : postButton('Reopen', `/api/chat/conversations/${Number(conv.id)}/reopen`, { kind: 'secondary' })) : ''}` : ''}</div>
</div>
${can(ac.staff, 'settings', 'change') ? panel('Saved replies', `${replies.length ? `<ul class="small">${each(replies, (r) => `<li><span class="strong">${esc(r.title)}</span>: ${esc(r.body)} ${postButton('Remove', `/api/chat/saved-replies/${r.id}/delete`, { kind: 'text' })}</li>`)}</ul>` : '<p class="muted small">None yet.</p>'}${form('/api/chat/saved-replies', `${input('title', 'Name (for example: delivery times)')}${textarea('body', 'Reply', '', { rows: 3 })}`, { submit: 'Save reply', secondary: true })}`) : ''}`;
}

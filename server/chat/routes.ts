// HTTP addresses for live chat (module 18).
//
//   Shop (hairbydemj.com /api/chat..., api.hairbydemj.com /v1/chat...):
//     GET  .../chat             my conversation (or null), the WhatsApp number, whether staff are online
//     POST .../chat/messages    { body, name?, email? }; the first message starts the conversation
//     POST .../chat/read        staff's messages have been seen
//     GET  .../chat/events      Server-Sent Events: new messages in my conversation
//   A visitor who is not signed in is known by a chat token: a cookie on the
//   website, the X-Chat-Token header in the app (returned as chatToken once).
//
//   Admin (admin.hairbydemj.com), customers view or change:
//     GET  /api/chat/conversations?status=open|closed
//     GET  /api/chat/conversations/:id
//     POST /api/chat/conversations/:id/messages   { body }
//     POST /api/chat/conversations/:id/close, /reopen
//     GET  /api/chat/events                       Server-Sent Events: every conversation
//     GET  /api/chat/saved-replies, POST /api/chat/saved-replies { title, body }, POST /api/chat/saved-replies/:id/delete

import type { ServerResponse } from 'node:http';
import type { AccountDeps } from '../accounts/deps.js';
import { currentCustomer, requireStaff } from '../accounts/routes.js';
import { requireAccess } from '../accounts/staff.js';
import { requireSameOrigin } from '../accounts/web.js';
import { readStore } from '../admin/api.js';
import { ApiError, clientIp, readCookies, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import { CHAT, chatHub, conversationView, customerRead, customerSays, findConversation, inbox, savedReplies, saveReply, setConversationStatus, staffConversation, staffSays, type ChatDeps, type ChatEvent, type ChatOwner } from './chat.js';

function chatDeps(deps: AccountDeps): ChatDeps {
  return { db: deps.db, now: deps.now, hub: chatHub, mail: deps.mail };
}

/** Opens a Server-Sent Events stream; returns a function that sends one event. */
function openStream(ctx: RequestContext, onClose: () => void): (event: string, data: unknown) => void {
  const res: ServerResponse = ctx.res;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  // A comment every 25 seconds keeps proxies from closing a quiet stream.
  const beat = setInterval(() => res.write(': still here\n\n'), 25_000);
  const close = (): void => {
    clearInterval(beat);
    onClose();
  };
  ctx.req.on('close', close);
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

export function shopChatRoutes(router: Router, deps: AccountDeps, prefix: string, transport: 'cookie' | 'bearer'): Router {
  const chat = chatDeps(deps);
  const cookieName = deps.config.env === 'production' ? '__Host-hbd_chat' : 'hbd_chat';
  const owner = async (ctx: RequestContext): Promise<ChatOwner> => {
    const signedIn = await currentCustomer(deps, ctx, transport);
    let token: string | null = null;
    if (transport === 'cookie') token = readCookies(ctx.req)[cookieName] || null;
    else {
      const header = ctx.req.headers['x-chat-token'];
      token = typeof header === 'string' ? header : ctx.query.get('chatToken');
    }
    if (token && !/^[A-Za-z0-9_-]{20,200}$/.test(token)) token = null;
    return { customerId: signedIn?.customer.id ?? null, visitorToken: token };
  };
  const guard = (ctx: RequestContext): void => {
    if (transport === 'cookie') requireSameOrigin(ctx);
  };
  return router
    .get(`${prefix}/chat`, async (ctx) => {
      const store = await readStore(deps.db);
      sendJson(ctx.res, 200, { conversation: await conversationView(deps.db, await owner(ctx)), whatsapp: store.whatsapp || null, staffOnline: chatHub.staffOnline() > 0 }, { 'Cache-Control': 'no-store' });
    })
    .post(`${prefix}/chat/messages`, async (ctx) => {
      guard(ctx);
      const result = await customerSays(chat, await owner(ctx), await readJson(ctx.req, 8_192));
      if (result.visitorToken && transport === 'cookie') {
        const parts = [`${cookieName}=${result.visitorToken}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${CHAT.visitorDays * 86_400}`];
        if (deps.config.env === 'production') parts.push('Secure');
        ctx.res.setHeader('Set-Cookie', parts.join('; '));
      }
      sendJson(ctx.res, 201, { conversation: result.conversation, ...(result.visitorToken && transport !== 'cookie' ? { chatToken: result.visitorToken } : {}) });
    })
    .post(`${prefix}/chat/read`, async (ctx) => {
      guard(ctx);
      await customerRead(chat, await owner(ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .get(`${prefix}/chat/events`, async (ctx) => {
      const found = await findConversation(deps.db, await owner(ctx));
      if (!found) throw new ApiError(404, 'no_conversation', 'Send a message first.');
      let stop: () => void = () => undefined;
      const send = openStream(ctx, () => stop());
      stop = chatHub.listenToConversation(found.id, (event: ChatEvent) => send(event.type, event));
    });
}

export function adminChatRoutes(router: Router, deps: AccountDeps): Router {
  const chat = chatDeps(deps);
  const staffOf = async (ctx: RequestContext) => {
    if (ctx.req.method === 'POST') requireSameOrigin(ctx);
    return (await requireStaff(deps, ctx)).staff;
  };
  const idOf = (ctx: RequestContext): number => {
    const n = Number(ctx.params.id);
    if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'not_found', 'Not found');
    return n;
  };
  const ip = (ctx: RequestContext): string | null => clientIp(ctx.req, deps.config.trustProxy);
  return router
    .get('/api/chat/conversations', async (ctx) => {
      sendJson(ctx.res, 200, { conversations: await inbox(deps.db, await staffOf(ctx), ctx.query.get('status') ?? 'open') });
    })
    .get('/api/chat/conversations/:id', async (ctx) => {
      sendJson(ctx.res, 200, { conversation: await staffConversation(chat, await staffOf(ctx), idOf(ctx)) });
    })
    .post('/api/chat/conversations/:id/messages', async (ctx) => {
      const staff = await staffOf(ctx);
      sendJson(ctx.res, 201, { message: await staffSays(chat, staff, idOf(ctx), await readJson(ctx.req, 8_192)) });
    })
    .post('/api/chat/conversations/:id/close', async (ctx) => {
      await setConversationStatus(chat, await staffOf(ctx), idOf(ctx), 'closed', ip(ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post('/api/chat/conversations/:id/reopen', async (ctx) => {
      await setConversationStatus(chat, await staffOf(ctx), idOf(ctx), 'open', ip(ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .get('/api/chat/events', async (ctx) => {
      const staff = await staffOf(ctx);
      requireAccess(staff, 'customers', 'view');
      let stop: () => void = () => undefined;
      const send = openStream(ctx, () => stop());
      stop = chatHub.listenAsStaff((event) => send(event.type, event));
    })
    .get('/api/chat/saved-replies', async (ctx) => {
      requireAccess(await staffOf(ctx), 'customers', 'view');
      sendJson(ctx.res, 200, { replies: await savedReplies(deps.db) });
    })
    .post('/api/chat/saved-replies', async (ctx) => {
      await saveReply(deps.db, await staffOf(ctx), await readJson(ctx.req));
      sendJson(ctx.res, 200, { replies: await savedReplies(deps.db) });
    })
    .post('/api/chat/saved-replies/:id/delete', async (ctx) => {
      const staff = await staffOf(ctx);
      requireAccess(staff, 'settings', 'change');
      await deps.db.query('delete from saved_replies where id = $1', [idOf(ctx)]);
      sendJson(ctx.res, 200, { replies: await savedReplies(deps.db) });
    });
}

// Live chat between customers and staff (module 18), on our own server.
// Messages are kept in PostgreSQL; new ones reach open pages straight away
// through Server-Sent Events (see hub below). A customer who has left gets
// staff replies by email.

import { hashToken, randomToken } from '../accounts/crypto.js';
import { emailOf } from '../accounts/deps.js';
import { logActivity, requireAccess, type StaffMember } from '../accounts/staff.js';
import type { Db } from '../db/pool.js';
import { ApiError } from '../http.js';

export const CHAT = {
  maxBody: 2000,
  /** A conversation can send at most this many customer messages a minute. */
  perMinute: 20,
  /** A visitor's chat is kept this long between visits. */
  visitorDays: 30,
  /** After this long without a reply from the customer, an open conversation is closed by the worker. */
  closeAfterDays: 7,
};

// ----- the hub: who is listening right now -----

export interface ChatEvent {
  type: 'message' | 'conversation' | 'read';
  conversationId: number;
  message?: MessageView;
}

type Listener = (event: ChatEvent) => void;

/**
 * Pages listening for new messages, in this server process. The website,
 * admin and API all run in one process (docs/chat.md), so this is enough;
 * a second process would need PostgreSQL's LISTEN/NOTIFY instead.
 */
export class ChatHub {
  private readonly conversations = new Map<number, Set<Listener>>();
  private readonly staff = new Set<Listener>();

  listenToConversation(id: number, listener: Listener): () => void {
    const set = this.conversations.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.conversations.set(id, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.conversations.delete(id);
    };
  }

  listenAsStaff(listener: Listener): () => void {
    this.staff.add(listener);
    return () => this.staff.delete(listener);
  }

  /** Is the customer's page open on this conversation now? */
  customerOnline(id: number): boolean {
    return (this.conversations.get(id)?.size ?? 0) > 0;
  }

  staffOnline(): number {
    return this.staff.size;
  }

  publish(event: ChatEvent): void {
    for (const l of this.conversations.get(event.conversationId) ?? []) l(event);
    for (const l of this.staff) l(event);
  }
}

/** The one hub for this server process. */
export const chatHub = new ChatHub();

export interface ChatDeps {
  db: Db;
  now: () => Date;
  hub: ChatHub;
  mail: { send(email: { to: string; template: 'chat_reply'; data: Record<string, string> }): Promise<void> };
}

export interface MessageView {
  id: number;
  sender: 'customer' | 'staff' | 'system';
  staffName: string | null;
  body: string;
  at: string;
  read: boolean;
}

export interface ConversationView {
  id: number;
  status: 'open' | 'closed';
  name: string | null;
  messages: MessageView[];
}

const invalid = (field: string, message: string): ApiError => new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: message });

function messageFrom(r: Record<string, unknown>): MessageView {
  // Staff are shown by first name only.
  const staffName = r.staff_name ? String(r.staff_name).split(' ')[0] ?? null : null;
  return { id: Number(r.id), sender: r.sender as MessageView['sender'], staffName, body: String(r.body), at: (r.created_at as Date).toISOString(), read: r.read_at !== null };
}

async function messages(db: Db, conversationId: number, after = 0): Promise<MessageView[]> {
  const found = await db.query(
    'select m.id, m.sender, m.body, m.read_at, m.created_at, s.name as staff_name from chat_messages m left join staff s on s.id = m.staff_id where m.conversation_id = $1 and m.id > $2 order by m.id limit 500',
    [conversationId, after],
  );
  return found.rows.map((r) => messageFrom(r));
}

/** Who is chatting: a signed-in customer, or a visitor with their chat token. */
export interface ChatOwner {
  customerId: number | null;
  visitorToken: string | null;
}

/** The owner's open (or most recent) conversation, if any. */
export async function findConversation(db: Db, owner: ChatOwner): Promise<{ id: number; status: string; name: string | null } | null> {
  if (owner.customerId !== null) {
    const r = (await db.query("select id, status, visitor_name from chat_conversations where customer_id = $1 order by (status = 'open') desc, last_message_at desc limit 1", [owner.customerId])).rows[0];
    if (r) return { id: Number(r.id), status: String(r.status), name: (r.visitor_name as string | null) ?? null };
  }
  if (owner.visitorToken) {
    const r = (await db.query('select id, status, visitor_name from chat_conversations where visitor_token_hash = $1', [hashToken(owner.visitorToken)])).rows[0];
    if (r) return { id: Number(r.id), status: String(r.status), name: (r.visitor_name as string | null) ?? null };
  }
  return null;
}

export async function conversationView(db: Db, owner: ChatOwner): Promise<ConversationView | null> {
  const c = await findConversation(db, owner);
  if (!c) return null;
  return { id: c.id, status: c.status as 'open' | 'closed', name: c.name, messages: await messages(db, c.id) };
}

function bodyOf(input: unknown): string {
  const body = typeof input === 'string' ? input.trim() : '';
  if (!body) throw invalid('body', 'Type a message.');
  if (body.length > CHAT.maxBody) throw invalid('body', `Keep it under ${CHAT.maxBody} characters.`);
  return body;
}

/**
 * A customer's message. The first one starts a conversation; a visitor then
 * gets a token for it (returned once, kept by the browser or the app).
 */
export async function customerSays(deps: ChatDeps, owner: ChatOwner, input: Record<string, unknown>): Promise<{ conversation: ConversationView; visitorToken: string | null }> {
  const body = bodyOf(input.body);
  const now = deps.now();
  let found = await findConversation(deps.db, owner);
  let newToken: string | null = null;
  if (!found) {
    // A visitor may leave a name and email so a reply can reach them after they leave.
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) || null : null;
    let email: string | null = null;
    if (owner.customerId === null && typeof input.email === 'string' && input.email.trim()) {
      try {
        email = emailOf(input.email);
      } catch {
        throw invalid('email', 'Enter a valid email address, or leave it empty.');
      }
    }
    if (owner.customerId === null) newToken = randomToken();
    const made = await deps.db.query(
      'insert into chat_conversations (customer_id, visitor_token_hash, visitor_name, visitor_email, last_message_at, created_at) values ($1, $2, $3, $4, $5, $5) returning id',
      [owner.customerId, newToken ? hashToken(newToken) : null, name, email, now],
    );
    found = { id: Number(made.rows[0]?.id), status: 'open', name };
    deps.hub.publish({ type: 'conversation', conversationId: found.id });
  }
  const recent = Number((await deps.db.query("select count(*)::int as n from chat_messages where conversation_id = $1 and sender = 'customer' and created_at > $2::timestamptz - interval '1 minute'", [found.id, now])).rows[0]?.n ?? 0);
  if (recent >= CHAT.perMinute) throw new ApiError(429, 'too_many', 'You are sending messages very quickly. Wait a moment and try again.');
  const inserted = await deps.db.query("insert into chat_messages (conversation_id, sender, body, created_at) values ($1, 'customer', $2, $3) returning id, sender, body, read_at, created_at", [found.id, body, now]);
  await deps.db.query("update chat_conversations set last_message_at = $2, status = 'open', closed_at = null where id = $1", [found.id, now]);
  const message = messageFrom(inserted.rows[0] as Record<string, unknown>);
  deps.hub.publish({ type: 'message', conversationId: found.id, message });
  const view = await conversationView(deps.db, owner.customerId !== null ? owner : { customerId: null, visitorToken: newToken ?? owner.visitorToken });
  return { conversation: view!, visitorToken: newToken };
}

/** The customer has seen staff's messages. */
export async function customerRead(deps: ChatDeps, owner: ChatOwner): Promise<void> {
  const c = await findConversation(deps.db, owner);
  if (!c) return;
  const changed = await deps.db.query("update chat_messages set read_at = $2 where conversation_id = $1 and sender <> 'customer' and read_at is null", [c.id, deps.now()]);
  if (changed.rowCount) deps.hub.publish({ type: 'read', conversationId: c.id });
}

// ----- staff -----

export async function inbox(db: Db, staff: StaffMember, status: string): Promise<Array<Record<string, unknown>>> {
  requireAccess(staff, 'customers', 'view');
  const s = status === 'closed' ? 'closed' : 'open';
  const found = await db.query(
    `select c.id, c.status, c.last_message_at, c.customer_id, coalesce(nullif(trim(cu.first_name || ' ' || cu.last_name), ''), c.visitor_name, 'Visitor') as name,
            (select body from chat_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
            (select count(*)::int from chat_messages m where m.conversation_id = c.id and m.sender = 'customer' and m.read_at is null) as unread,
            s.name as assigned
       from chat_conversations c left join customers cu on cu.id = c.customer_id left join staff s on s.id = c.assigned_staff_id
      where c.status = $1 and exists (select 1 from chat_messages m where m.conversation_id = c.id)
      order by c.last_message_at desc limit 100`,
    [s],
  );
  return found.rows.map((r) => ({ id: Number(r.id), status: String(r.status), name: String(r.name), lastBody: String(r.last_body ?? ''), lastAt: (r.last_message_at as Date).toISOString(), unread: Number(r.unread), isCustomer: r.customer_id !== null, assigned: (r.assigned as string | null) ?? null }));
}

/** One conversation for staff, with who the customer is and their latest order. Marks the customer's messages read. */
export async function staffConversation(deps: ChatDeps, staff: StaffMember, id: number): Promise<Record<string, unknown>> {
  requireAccess(staff, 'customers', 'view');
  const c = (await deps.db.query(
    `select c.*, cu.email as customer_email, cu.first_name, cu.last_name, cu.loyalty_tier,
            (select count(*)::int from orders o where o.customer_id = c.customer_id) as orders
       from chat_conversations c left join customers cu on cu.id = c.customer_id where c.id = $1`,
    [id],
  )).rows[0];
  if (!c) throw new ApiError(404, 'not_found', 'That conversation does not exist.');
  const latest = c.customer_id
    ? (await deps.db.query('select id, number, status, placed_at from orders where customer_id = $1 order by placed_at desc limit 1', [c.customer_id])).rows[0]
    : null;
  const changed = await deps.db.query("update chat_messages set read_at = $2 where conversation_id = $1 and sender = 'customer' and read_at is null", [id, deps.now()]);
  if (changed.rowCount) deps.hub.publish({ type: 'read', conversationId: id });
  return {
    id: Number(c.id),
    status: String(c.status),
    name: c.customer_id ? `${String(c.first_name ?? '')} ${String(c.last_name ?? '')}`.trim() || 'Customer' : (c.visitor_name as string | null) ?? 'Visitor',
    email: (c.customer_email as string | null) ?? (c.visitor_email as string | null) ?? null,
    customerId: c.customer_id === null ? null : Number(c.customer_id),
    orders: Number(c.orders ?? 0),
    tier: (c.loyalty_tier as string | null) ?? null,
    latestOrder: latest ? { id: Number(latest.id), number: String(latest.number), status: String(latest.status) } : null,
    online: deps.hub.customerOnline(id),
    messages: await messages(deps.db, id),
  };
}

export async function staffSays(deps: ChatDeps, staff: StaffMember, id: number, input: Record<string, unknown>): Promise<MessageView> {
  requireAccess(staff, 'customers', 'change');
  const body = bodyOf(input.body);
  const now = deps.now();
  const c = (await deps.db.query('select c.id, c.customer_id, c.visitor_email, cu.email from chat_conversations c left join customers cu on cu.id = c.customer_id where c.id = $1', [id])).rows[0];
  if (!c) throw new ApiError(404, 'not_found', 'That conversation does not exist.');
  const inserted = await deps.db.query("insert into chat_messages (conversation_id, sender, staff_id, body, created_at) values ($1, 'staff', $2, $3, $4) returning id, sender, body, read_at, created_at", [id, staff.id, body, now]);
  await deps.db.query("update chat_conversations set last_message_at = $2, status = 'open', closed_at = null, assigned_staff_id = coalesce(assigned_staff_id, $3) where id = $1", [id, now, staff.id]);
  const message = messageFrom({ ...(inserted.rows[0] as Record<string, unknown>), staff_name: staff.name });
  deps.hub.publish({ type: 'message', conversationId: id, message });
  // Not on the page now: the reply goes by email too, if we have an address.
  const to = (c.email as string | null) ?? (c.visitor_email as string | null);
  if (!deps.hub.customerOnline(id) && to) await deps.mail.send({ to, template: 'chat_reply', data: { staffName: message.staffName ?? 'hairbydemj', message: body.slice(0, 500) } });
  return message;
}

export async function setConversationStatus(deps: ChatDeps, staff: StaffMember, id: number, status: 'open' | 'closed', ip: string | null): Promise<void> {
  requireAccess(staff, 'customers', 'change');
  const changed = await deps.db.query('update chat_conversations set status = $2, closed_at = case when $2 = \'closed\' then $3::timestamptz end where id = $1', [id, status, deps.now()]);
  if (!changed.rowCount) throw new ApiError(404, 'not_found', 'That conversation does not exist.');
  if (status === 'closed') await deps.db.query("insert into chat_messages (conversation_id, sender, body, created_at) values ($1, 'system', 'This conversation was closed. Write again any time.', $2)", [id, deps.now()]);
  deps.hub.publish({ type: 'conversation', conversationId: id });
  await logActivity(deps.db, staff, 'customers', `${status === 'closed' ? 'Closed' : 'Reopened'} chat conversation ${id}`, { type: 'chat', id }, ip);
}

export async function savedReplies(db: Db): Promise<Array<{ id: number; title: string; body: string }>> {
  return (await db.query('select id, title, body from saved_replies order by position, title')).rows.map((r) => ({ id: Number(r.id), title: String(r.title), body: String(r.body) }));
}

export async function saveReply(db: Db, staff: StaffMember, input: Record<string, unknown>): Promise<void> {
  requireAccess(staff, 'settings', 'change');
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 60) : '';
  const body = typeof input.body === 'string' ? input.body.trim().slice(0, CHAT.maxBody) : '';
  if (!title) throw invalid('title', 'Give it a short name.');
  if (!body) throw invalid('body', 'Write the reply.');
  await db.query('insert into saved_replies (title, body) values ($1, $2) on conflict (title) do update set body = excluded.body', [title, body]);
}

/** Open conversations nobody has written in for a week are closed (worker, daily). */
export async function closeQuietConversations(db: Db, now: Date): Promise<number> {
  const r = await db.query("update chat_conversations set status = 'closed', closed_at = $1 where status = 'open' and last_message_at < $1::timestamptz - make_interval(days => $2)", [now, CHAT.closeAfterDays]);
  // Visitors' chats with no account are removed after their token expires.
  await db.query("delete from chat_conversations where customer_id is null and last_message_at < $1::timestamptz - make_interval(days => $2)", [now, CHAT.visitorDays]);
  return r.rowCount ?? 0;
}

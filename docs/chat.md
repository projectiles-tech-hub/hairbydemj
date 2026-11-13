# Live chat

Module 18. Customers chat with staff from every page of the website and
from Help in the app; staff answer from **Live chat inbox** in the admin.
Everything runs on our own server; nothing is sent to an outside chat
service.

## How it works

- Messages are kept in PostgreSQL (`chat_conversations`, `chat_messages`,
  `saved_replies`).
- New messages reach open pages at once through **Server-Sent Events**: the
  browser or app keeps one quiet connection open (`/api/chat/events`), and
  the server writes each new message down it. A short comment every 25
  seconds keeps proxies from closing it; browsers reconnect by themselves.
- The website, admin and API run in one server process, so the list of who
  is listening is kept in memory (`server/chat/chat.ts`). If a second
  process is ever added, this would move to PostgreSQL's LISTEN/NOTIFY.
- Behind Caddy (module 19), the event addresses need
  `flush_interval -1` so events are not held back.

## Customers

- The chat button opens a panel. A visitor who is not signed in may give a
  name and an email; the browser then keeps a private chat cookie for 30
  days (the app keeps a chat token in the phone's secure storage).
- Signed-in customers' chats are linked to their account, so staff see their
  orders.
- If a staff reply arrives when the customer has left the page, it is
  emailed to them (when we have their email) with a link back to the chat.
- WhatsApp: when a WhatsApp number is set in the admin (**Store settings**),
  the panel and the app's Help screen offer "Message us on WhatsApp" as well
  (`https://wa.me/<number>`).
- At most 20 messages a minute per conversation, 2,000 characters each.

## Staff (customers area of a role)

- **Live chat inbox** lists open and closed conversations with unread
  counts, the conversation, saved replies, and who the customer is with
  their latest order. Everything updates live while the page is open, and
  customers see "We are online now" while at least one staff member has
  it open.
- Replies are sent with Enter (Shift+Enter for a new line). Closing a
  conversation adds a note for the customer; they can write again any time.
- Saved replies are added and removed at the bottom of the inbox (settings
  change).
- The worker closes conversations nobody has written in for 7 days, and
  removes visitors' chats (not linked to an account) after 30 days.

## Addresses

See the list at the top of `server/chat/routes.ts`.

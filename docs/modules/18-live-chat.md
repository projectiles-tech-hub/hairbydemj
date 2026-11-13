# Module 18 — Live chat

**Status:** In review (pull request open; the owner's merge is the approval) · **Depends on:** 13, 14, 15

## Goal

Live chat between customers and staff, run on our own server.

## Steps

- [x] Chat messages stored in PostgreSQL
- [x] Real-time delivery with Server-Sent Events
- [x] Chat widget on the website and Help screen in the app
- [x] Admin chat inbox
- [x] WhatsApp click-to-chat as an alternative
- [x] Tests

## Done when

Customers and staff can chat in real time from the website, app and admin.

## Notes (2026-11-13)

- Built on branch `feature/chat`, on top of modules 2 to 17. Guide:
  [`../chat.md`](../chat.md). Migration 0021.
- Walked through in Chromium with a visitor on the website and staff in the
  inbox: messages both ways arrived without reloading.

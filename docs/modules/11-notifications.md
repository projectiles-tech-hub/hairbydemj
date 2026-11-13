# Module 11 — Notifications

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Email and app push notifications with no paid services.

## Steps

- [x] Our own email sending from the server (signed with DKIM, handed to Postfix)
- [ ] SPF, DKIM and DMARC records for hairbydemj.com (written out in docs/notifications.md; set on the live server in module 19)
- [x] Email templates (order updates, verification, password reset, marketing)
- [x] Apple push (APNs) and Firebase Cloud Messaging, called directly
- [x] Customer notification preferences and unsubscribe
- [x] Tests

## Done when

Emails reach inboxes and push notifications reach both apps.

## Notes

- Guide: [`../notifications.md`](../notifications.md). Code:
  `server/notifications/`. No migration: the tables were made in module 2.
- "Done when" needs the live server (module 19) for inbox delivery and the
  apps (module 15) with the owner's Apple and Google keys for push.

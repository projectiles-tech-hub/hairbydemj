# Module 3 — Accounts and sign-in

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Secure customer and staff accounts, written in our own code.

## Steps

- [x] Sign-up with email and password (scrypt hashing)
- [x] Email verification codes
- [x] Secure session cookies, sign-in and sign-out
- [x] Forgot / reset password
- [x] Google sign-in (OpenID Connect)
- [x] Sign in with Apple (required in the iOS app when Google sign-in is offered)
- [x] Linking Google/Apple and email logins to one customer
- [x] Protection against password guessing and cross-site request forgery
- [x] Staff accounts, roles, permissions and two-step verification
- [x] Tests for every sign-in path

## Done when

Customers and staff can sign up, sign in, recover access and sign out safely,
and all tests pass.

## Notes

- Guide: [`../accounts.md`](../accounts.md) (addresses, settings, rules,
  commands, protections). Decision on addresses and the Owner:
  [`../decisions/0006-sign-in-addresses-and-owner.md`](../decisions/0006-sign-in-addresses-and-owner.md).
- No package added. Everything uses Node's built-in crypto module.
- Migration `0010_sign_in_protection.sql` adds the record of sign-in attempts.
- New settings: `AUTH_SECRET` (secret, required in production),
  `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `TRUST_PROXY`. See `.env.example`.
- New commands: `npm run staff:invite-owner`, `npm run staff:reset-access`.
- Built on top of Module 2; pull request #11 (Database) must be merged first.
- Emails are queued in the `jobs` table until module 11 sends them.
- Google and Apple sign-in are tested with stand-in keys. The real client
  IDs are needed from the owner before launch.
- Not in this module (in the designs, not in the steps above): change email,
  change password while signed in, delete account, edit profile.

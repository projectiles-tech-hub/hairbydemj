# 0001 — No frameworks

**Date:** 2026-10-29 · **Status:** Accepted (owner's decision)

## Decision

No frameworks or commerce platforms are used for the website, admin, API,
database access, authentication or background jobs. Everything is written in
plain TypeScript on Node.js with hand-written SQL. The only exception is Flutter
for the mobile app (see 0002).

## Considered and rejected

Medusa, Next.js, Hono, Drizzle ORM, Better Auth, Redis, BullMQ, Meilisearch,
Docker, Turborepo, pnpm workspaces, Tailwind CSS, Expo / React Native.

## Reasons

- Full flexibility for custom features; frameworks such as Medusa, Next.js and
  Expo resist features they were not designed for.
- No exposure to upsells or future licence changes.
- Fewer outside projects that can change, break or be abandoned.

## Consequences

- Longer development time; we own every line of sign-in, checkout and payment
  code, so those receive the most testing.
- Future sessions must not reintroduce these tools without the owner's explicit
  instruction.

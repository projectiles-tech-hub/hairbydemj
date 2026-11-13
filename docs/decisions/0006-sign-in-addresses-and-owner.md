# 0006. Sign-in addresses and the Owner

**Date:** 2026-11-11 · **Status:** Accepted (owner's decision)

## Decision

- The three addresses of the build plan stay: `hairbydemj.com` (shop),
  `admin.hairbydemj.com` (staff) and `api.hairbydemj.com` (phone app).
- Signed-in customers stay on `hairbydemj.com`, under `/account`.
- There is one super user role, the **Owner**, who controls everything. The
  Owner signs in at `admin.hairbydemj.com` like other staff, with two-step
  verification. Only an Owner can invite staff, create roles and change what
  a role may do. The first Owner is created by a command on the server.

## Considered

- **`app.hairbydemj.com` for signed-in customers.** The owner liked this.
  Not adopted, after discussion, because shopping and being signed in are
  mixed (wishlist, checkout, points), a cookie shared across subdomains is
  weaker than one locked to a single address, "app" would be confused with
  the phone app, and it would mean two sets of pages to keep in step.
- **Separate addresses per staff role** (`staff.`, `manager.`, `owner.`).
  Not adopted: what each person sees is decided by their role, which gives
  the same control with one address to secure.

## Consequences

- A customer's session cookie is locked to `hairbydemj.com`; a staff cookie
  to `admin.hairbydemj.com`. Neither works on the other.
- Either choice can be revisited later; it would change cookie settings and
  page addresses, not the database.

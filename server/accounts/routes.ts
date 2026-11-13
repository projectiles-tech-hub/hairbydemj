// The HTTP addresses for accounts.
//
//   Website (hairbydemj.com)        /api/auth/...   session in a cookie
//   Phone app (api.hairbydemj.com)  /v1/auth/...    session token in the reply, sent back as "Bearer"
//   Admin (admin.hairbydemj.com)    /api/auth/..., /api/staff..., /api/roles...   session in a cookie

import { ApiError, clientIp, readJson, sendJson, type RequestContext } from '../http.js';
import type { Router } from '../router.js';
import * as customers from './customers.js';
import type { AccountDeps } from './deps.js';
import type { Provider } from './oidc.js';
import * as staff from './staff.js';
import { bearerToken, clearSessionCookie, cookieToken, csrfToken, requireSameOrigin, setSessionCookie } from './web.js';

type Transport = 'cookie' | 'bearer';

const meta = (deps: AccountDeps, ctx: RequestContext): { ip: string | null; userAgent: string | null } => ({
  ip: clientIp(ctx.req, deps.config.trustProxy),
  userAgent: ctx.req.headers['user-agent'] ?? null,
});

/** The signed-in customer for this request, or null. */
export async function currentCustomer(deps: AccountDeps, ctx: RequestContext, transport: Transport): Promise<{ customer: customers.Customer; token: string } | null> {
  const token = transport === 'cookie' ? cookieToken(ctx.req, 'customer', deps.config) : bearerToken(ctx.req);
  const customer = await customers.customerFromToken(deps, token);
  return customer && token ? { customer, token } : null;
}

/** The signed-in staff member for this request, or a 401 error. */
export async function requireStaff(deps: AccountDeps, ctx: RequestContext): Promise<{ staff: staff.StaffMember; token: string }> {
  const token = cookieToken(ctx.req, 'staff', deps.config);
  const member = await staff.staffFromToken(deps, token);
  if (!member || !token) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
  return { staff: member, token };
}

export function customerAuthRoutes(router: Router, deps: AccountDeps, prefix: string, transport: Transport): Router {
  const client = transport === 'cookie' ? 'web' : 'app';
  const guard = (ctx: RequestContext): void => {
    if (transport === 'cookie') requireSameOrigin(ctx);
  };
  const reply = (ctx: RequestContext, status: number, signedIn: customers.SignedIn, extra: Record<string, unknown> = {}): void => {
    if (transport === 'cookie') {
      setSessionCookie(ctx.res, 'customer', deps.config, signedIn.token, signedIn.expiresAt, deps.now());
      sendJson(ctx.res, status, { customer: signedIn.customer, csrfToken: csrfToken(signedIn.token, deps.keys.csrf), ...extra });
    } else {
      sendJson(ctx.res, status, { customer: signedIn.customer, token: signedIn.token, expiresAt: signedIn.expiresAt.toISOString(), ...extra });
    }
  };
  const provider = (name: Provider) => async (ctx: RequestContext): Promise<void> => {
    guard(ctx);
    const result = await customers.signInWithProvider(deps, name, await readJson(ctx.req), { ...meta(deps, ctx), client });
    reply(ctx, result.created ? 201 : 200, result, { created: result.created });
  };
  const link = (name: Provider) => async (ctx: RequestContext): Promise<void> => {
    guard(ctx);
    const current = await currentCustomer(deps, ctx, transport);
    if (!current) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
    sendJson(ctx.res, 200, { customer: await customers.linkProvider(deps, current.customer.id, name, await readJson(ctx.req)) });
  };

  return router
    .post(`${prefix}/sign-up`, async (ctx) => {
      guard(ctx);
      sendJson(ctx.res, 201, await customers.signUp(deps, await readJson(ctx.req), meta(deps, ctx)));
    })
    .post(`${prefix}/resend-code`, async (ctx) => {
      guard(ctx);
      await customers.resendCode(deps, await readJson(ctx.req));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post(`${prefix}/verify-email`, async (ctx) => {
      guard(ctx);
      reply(ctx, 200, await customers.verifyEmail(deps, await readJson(ctx.req), { ...meta(deps, ctx), client }));
    })
    .post(`${prefix}/sign-in`, async (ctx) => {
      guard(ctx);
      reply(ctx, 200, await customers.signIn(deps, await readJson(ctx.req), { ...meta(deps, ctx), client }));
    })
    .post(`${prefix}/sign-out`, async (ctx) => {
      guard(ctx);
      await customers.signOut(deps, transport === 'cookie' ? cookieToken(ctx.req, 'customer', deps.config) : bearerToken(ctx.req));
      if (transport === 'cookie') clearSessionCookie(ctx.res, 'customer', deps.config);
      sendJson(ctx.res, 200, { ok: true });
    })
    .get(`${prefix}/me`, async (ctx) => {
      const current = await currentCustomer(deps, ctx, transport);
      if (!current) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
      sendJson(ctx.res, 200, { customer: current.customer, ...(transport === 'cookie' ? { csrfToken: csrfToken(current.token, deps.keys.csrf) } : {}) });
    })
    .post(`${prefix}/forgot-password`, async (ctx) => {
      guard(ctx);
      await customers.forgotPassword(deps, await readJson(ctx.req), meta(deps, ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post(`${prefix}/reset-password`, async (ctx) => {
      guard(ctx);
      await customers.resetPassword(deps, await readJson(ctx.req));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post(`${prefix}/google`, provider('google'))
    .post(`${prefix}/apple`, provider('apple'))
    .post(`${prefix}/link/google`, link('google'))
    .post(`${prefix}/link/apple`, link('apple'));
}

function idParam(ctx: RequestContext): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(404, 'not_found', 'Not found');
  return id;
}

export function staffRoutes(router: Router, deps: AccountDeps): Router {
  return router
    .post('/api/auth/sign-in', async (ctx) => {
      requireSameOrigin(ctx);
      sendJson(ctx.res, 200, await staff.staffSignInPassword(deps, await readJson(ctx.req), meta(deps, ctx)));
    })
    .post('/api/auth/two-step', async (ctx) => {
      requireSameOrigin(ctx);
      const result = await staff.staffSignInCode(deps, await readJson(ctx.req), meta(deps, ctx));
      setSessionCookie(ctx.res, 'staff', deps.config, result.token, result.expiresAt, deps.now());
      sendJson(ctx.res, 200, { staff: result.staff, csrfToken: csrfToken(result.token, deps.keys.csrf) });
    })
    .post('/api/auth/sign-out', async (ctx) => {
      requireSameOrigin(ctx);
      await staff.staffSignOut(deps, cookieToken(ctx.req, 'staff', deps.config));
      clearSessionCookie(ctx.res, 'staff', deps.config);
      sendJson(ctx.res, 200, { ok: true });
    })
    .get('/api/auth/me', async (ctx) => {
      const current = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { staff: current.staff, csrfToken: csrfToken(current.token, deps.keys.csrf) });
    })
    .post('/api/auth/invite/start', async (ctx) => {
      requireSameOrigin(ctx);
      sendJson(ctx.res, 200, await staff.acceptInviteStart(deps, await readJson(ctx.req)));
    })
    .post('/api/auth/invite/confirm', async (ctx) => {
      requireSameOrigin(ctx);
      await staff.acceptInviteConfirm(deps, await readJson(ctx.req), meta(deps, ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .get('/api/staff', async (ctx) => {
      const current = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { staff: await staff.listStaff(deps, current.staff) });
    })
    .post('/api/staff/invite', async (ctx) => {
      requireSameOrigin(ctx);
      const current = await requireStaff(deps, ctx);
      sendJson(ctx.res, 201, await staff.inviteStaff(deps, current.staff, await readJson(ctx.req), meta(deps, ctx)));
    })
    .post('/api/staff/:id/role', async (ctx) => {
      requireSameOrigin(ctx);
      const current = await requireStaff(deps, ctx);
      await staff.setStaffRole(deps, current.staff, idParam(ctx), await readJson(ctx.req), meta(deps, ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post('/api/staff/:id/disable', async (ctx) => {
      requireSameOrigin(ctx);
      const current = await requireStaff(deps, ctx);
      await staff.disableStaff(deps, current.staff, idParam(ctx), meta(deps, ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .post('/api/staff/:id/reset', async (ctx) => {
      requireSameOrigin(ctx);
      const current = await requireStaff(deps, ctx);
      await staff.resetStaffAccess(deps, current.staff, idParam(ctx), meta(deps, ctx));
      sendJson(ctx.res, 200, { ok: true });
    })
    .get('/api/roles', async (ctx) => {
      const current = await requireStaff(deps, ctx);
      sendJson(ctx.res, 200, { roles: await staff.listRoles(deps, current.staff) });
    })
    .post('/api/roles', async (ctx) => {
      requireSameOrigin(ctx);
      const current = await requireStaff(deps, ctx);
      sendJson(ctx.res, 201, await staff.createRole(deps, current.staff, await readJson(ctx.req), meta(deps, ctx)));
    })
    .post('/api/roles/:id/permissions', async (ctx) => {
      requireSameOrigin(ctx);
      const current = await requireStaff(deps, ctx);
      await staff.setRolePermissions(deps, current.staff, idParam(ctx), await readJson(ctx.req), meta(deps, ctx));
      sendJson(ctx.res, 200, { ok: true });
    });
}

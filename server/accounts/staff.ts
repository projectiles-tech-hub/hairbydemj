// Staff accounts: invitations, sign-in with two-step verification, sessions,
// roles and permissions. The Owner role can do everything; only an Owner can
// invite staff, create roles and change what a role may do.

import { withTransaction, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import { base32Encode, hashPassword, hashToken, newTotpSecret, passwordNeedsRehash, randomToken, readToken, seal, signToken, totpUri, unseal, verifyPassword, verifyTotp } from './crypto.js';
import { emailOf, passwordOf, text, type AccountDeps } from './deps.js';
import { checkAttempts, recordAttempt } from './guard.js';

export const STAFF = {
  /** An invite link lasts this long (from the approved invite dialog). */
  inviteHours: 48,
  /** Time allowed between the password step and the 6-digit code. */
  pendingMinutes: 5,
  /** A staff session ends after this long without use, and always after the longer limit. */
  idleMinutes: 120,
  sessionHours: 12,
};

export const AREAS = ['orders', 'returns', 'products', 'customers', 'discounts', 'settings', 'reports'] as const;
export type Area = (typeof AREAS)[number];
export type Access = 'view' | 'change';
export type Permissions = Record<Area, { view: boolean; change: boolean }>;

export interface StaffMember {
  id: number;
  name: string;
  email: string;
  roleId: number;
  roleName: string;
  isOwner: boolean;
  status: 'invited' | 'active' | 'disabled';
  twoStep: boolean;
  lastSignInAt: Date | null;
  permissions: Permissions;
}

interface Meta {
  ip: string | null;
  userAgent?: string | null;
}

type Query = { query: DbClient['query'] };

const WRONG = (): ApiError => new ApiError(401, 'wrong_credentials', 'Email or password is not right.');
const NOT_ALLOWED = (): ApiError => new ApiError(403, 'not_allowed', 'Your role does not allow this. Ask the store owner.');

function emptyPermissions(all = false): Permissions {
  return Object.fromEntries(AREAS.map((a) => [a, { view: all, change: all }])) as Permissions;
}

async function loadStaff(db: Query, where: string, value: unknown): Promise<(StaffMember & { passwordHash: string | null; totpSecret: Buffer | null; totpLastStep: number | null }) | null> {
  const result = await db.query(
    `select s.id, s.name, s.email, s.role_id, r.name as role_name, r.is_owner, s.status, s.totp_enabled_at, s.last_sign_in_at,
            s.password_hash, s.totp_secret_enc, s.totp_last_step,
            coalesce((select jsonb_object_agg(p.area, jsonb_build_object('view', p.can_view, 'change', p.can_change)) from role_permissions p where p.role_id = r.id), '{}') as permissions
     from staff s join roles r on r.id = s.role_id where ${where}`,
    [value],
  );
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const isOwner = r.is_owner === true;
  return {
    id: Number(r.id),
    name: String(r.name),
    email: String(r.email),
    roleId: Number(r.role_id),
    roleName: String(r.role_name),
    isOwner,
    status: r.status as StaffMember['status'],
    twoStep: r.totp_enabled_at !== null,
    lastSignInAt: r.last_sign_in_at as Date | null,
    permissions: isOwner ? emptyPermissions(true) : { ...emptyPermissions(), ...(r.permissions as Partial<Permissions>) },
    passwordHash: r.password_hash as string | null,
    totpSecret: r.totp_secret_enc as Buffer | null,
    totpLastStep: r.totp_last_step === null ? null : Number(r.totp_last_step),
  };
}

function publicStaff(s: StaffMember): StaffMember {
  return { id: s.id, name: s.name, email: s.email, roleId: s.roleId, roleName: s.roleName, isOwner: s.isOwner, status: s.status, twoStep: s.twoStep, lastSignInAt: s.lastSignInAt, permissions: s.permissions };
}

/** True when this staff member may view or change an area of the admin. */
export function can(staff: StaffMember, area: Area, access: Access): boolean {
  return staff.isOwner || staff.permissions[area][access];
}

export function requireAccess(staff: StaffMember, area: Area, access: Access): void {
  if (!can(staff, area, access)) throw NOT_ALLOWED();
}

function requireOwner(staff: StaffMember): void {
  if (!staff.isOwner) throw NOT_ALLOWED();
}

export async function logActivity(db: Query, actor: { id: number | null; name: string }, area: string, summary: string, entity?: { type: string; id: string | number }, ip: string | null = null): Promise<void> {
  await db.query('insert into activity_log (staff_id, staff_name, area, summary, entity_type, entity_id, ip) values ($1, $2, $3, $4, $5, $6, $7::inet)', [
    actor.id,
    actor.name,
    area,
    summary,
    entity?.type ?? null,
    entity ? String(entity.id) : null,
    ip,
  ]);
}

// ----- invitations -----

async function makeInvite(deps: AccountDeps, c: Query, staffId: number, invitedBy: number | null): Promise<string> {
  const token = randomToken();
  await c.query('delete from staff_invites where staff_id = $1 and accepted_at is null', [staffId]);
  await c.query('insert into staff_invites (staff_id, token_hash, invited_by, expires_at) values ($1, $2, $3, $4)', [staffId, hashToken(token), invitedBy, new Date(deps.now().getTime() + STAFF.inviteHours * 3_600_000)]);
  return token;
}

async function createInvited(deps: AccountDeps, actor: StaffMember | null, input: { name: string; email: string; roleId: number }, ip: string | null): Promise<{ staffId: number; token: string }> {
  try {
    return await withTransaction(deps.db, async (c) => {
      const made = await c.query('insert into staff (name, email, role_id) values ($1, $2, $3) returning id', [input.name, input.email, input.roleId]);
      const staffId = Number(made.rows[0]?.id);
      const token = await makeInvite(deps, c, staffId, actor?.id ?? null);
      const role = await c.query('select name from roles where id = $1', [input.roleId]);
      await logActivity(c, { id: actor?.id ?? null, name: actor?.name ?? 'Server command' }, 'Staff and roles', `Invited ${input.email} as ${String(role.rows[0]?.name)}`, { type: 'staff', id: staffId }, ip);
      return { staffId, token };
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') throw new ApiError(409, 'email_taken', 'A staff member with this email already exists.', { email: 'A staff member with this email already exists.' });
    if (code === '23503') throw new ApiError(422, 'invalid', 'Choose a role.', { role: 'Choose a role.' });
    throw error;
  }
}

/** Invite a staff member. They receive a link to set a password and two-step verification. */
export async function inviteStaff(deps: AccountDeps, actor: StaffMember, input: Record<string, unknown>, meta: Meta): Promise<{ staffId: number }> {
  requireOwner(actor);
  const name = text(input.name, 120);
  if (name === '') throw new ApiError(422, 'invalid', 'Check the details and try again.', { name: 'Enter their full name.' });
  const email = emailOf(input.email);
  const roleId = Number(input.roleId);
  if (!Number.isInteger(roleId)) throw new ApiError(422, 'invalid', 'Choose a role.', { role: 'Choose a role.' });
  const { staffId, token } = await createInvited(deps, actor, { name, email, roleId }, meta.ip);
  await deps.mail.send({ to: email, template: 'staff_invite', data: { name, token, hours: String(STAFF.inviteHours), invitedBy: actor.name } });
  return { staffId };
}

/**
 * Create the first Owner, or another one, from a command on the server.
 * There is nobody to invite the first Owner, so the link is returned to be
 * printed once instead of emailed.
 */
export async function inviteOwnerFromServer(deps: AccountDeps, input: { name: string; email: string }): Promise<{ token: string }> {
  const name = text(input.name, 120);
  if (name === '') throw new ApiError(422, 'invalid', 'Enter a name.');
  const email = emailOf(input.email);
  const role = await deps.db.query('select id from roles where is_owner');
  const { token } = await createInvited(deps, null, { name, email, roleId: Number(role.rows[0]?.id) }, null);
  return { token };
}

async function inviteFromToken(deps: AccountDeps, c: Query, token: string): Promise<{ inviteId: number; staffId: number; email: string }> {
  const found = await c.query(
    `select i.id, s.id as staff_id, s.email from staff_invites i join staff s on s.id = i.staff_id
     where i.token_hash = $1 and i.accepted_at is null and i.expires_at > $2 and s.status = 'invited'`,
    [hashToken(text(token, 200)), deps.now()],
  );
  const row = found.rows[0] as { id: number; staff_id: number; email: string } | undefined;
  if (!row) throw new ApiError(422, 'link_expired', 'This invite link has expired or was already used. Ask the store owner for a new one.');
  return { inviteId: Number(row.id), staffId: Number(row.staff_id), email: row.email };
}

/** Step 1 of accepting an invite: set the password; get the secret to add to an authenticator app. */
export async function acceptInviteStart(deps: AccountDeps, input: Record<string, unknown>): Promise<{ email: string; secret: string; uri: string }> {
  const password = passwordOf(input.password);
  const passwordHash = await hashPassword(password, deps.passwordParams);
  const secret = newTotpSecret();
  const email = await withTransaction(deps.db, async (c) => {
    const invite = await inviteFromToken(deps, c, String(input.token ?? ''));
    await c.query('update staff set password_hash = $2, totp_secret_enc = $3, totp_enabled_at = null, totp_last_step = null where id = $1', [invite.staffId, passwordHash, seal(secret, deps.keys.totp)]);
    return invite.email;
  });
  return { email, secret: base32Encode(secret), uri: totpUri(secret, email) };
}

/** Step 2: prove the authenticator app works by entering a code. The account becomes active. */
export async function acceptInviteConfirm(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<void> {
  const token = String(input.token ?? '');
  const code = text(input.code, 12).replace(/\s/g, '');
  const subject = `invite:${hashToken(text(token, 200)).toString('hex').slice(0, 32)}`;
  await checkAttempts(deps.db, 'staff_two_step', subject, meta.ip);
  const ok = await withTransaction(deps.db, async (c) => {
    const invite = await inviteFromToken(deps, c, token);
    const staff = await loadStaff(c, 's.id = $1', invite.staffId);
    if (!staff?.passwordHash || !staff.totpSecret) throw new ApiError(422, 'password_first', 'Set your password first.');
    const step = verifyTotp(unseal(staff.totpSecret, deps.keys.totp), code, deps.now(), null);
    if (step === null) return false;
    await c.query("update staff set status = 'active', totp_enabled_at = $2, totp_last_step = $3 where id = $1", [staff.id, deps.now(), step]);
    await c.query('update staff_invites set accepted_at = $2 where id = $1', [invite.inviteId, deps.now()]);
    await logActivity(c, staff, 'Staff and roles', 'Accepted the invite and set up two-step verification', { type: 'staff', id: staff.id }, meta.ip);
    return true;
  });
  await recordAttempt(deps.db, 'staff_two_step', subject, meta.ip, ok);
  if (!ok) throw new ApiError(422, 'wrong_code', 'That code is not right. Check your authenticator app and try again.', { code: 'That code is not right.' });
}

// ----- sign-in -----

let dummyHash: Promise<string> | null = null;

/** Step 1 of staff sign-in: email and password. Returns a short-lived token for step 2, not a session. */
export async function staffSignInPassword(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<{ pending: string }> {
  const email = text(input.email, 320).toLowerCase();
  const password = typeof input.password === 'string' ? input.password.slice(0, 1000) : '';
  if (email === '' || password === '') throw WRONG();
  await checkAttempts(deps.db, 'staff', email, meta.ip);
  const staff = await loadStaff(deps.db, 's.email = $1', email);
  dummyHash ??= hashPassword(randomToken(), deps.passwordParams);
  const usable = staff !== null && staff.status === 'active' && staff.passwordHash !== null;
  const ok = (await verifyPassword(password, usable ? staff.passwordHash : await dummyHash)) && usable;
  await recordAttempt(deps.db, 'staff', email, meta.ip, ok);
  if (!ok || !staff) throw WRONG();
  if (staff.passwordHash && passwordNeedsRehash(staff.passwordHash, deps.passwordParams)) {
    await deps.db.query('update staff set password_hash = $2 where id = $1', [staff.id, await hashPassword(password, deps.passwordParams)]);
  }
  return { pending: signToken({ sid: staff.id }, deps.keys.pending, STAFF.pendingMinutes * 60, deps.now()) };
}

/** Step 2: the 6-digit code from the authenticator app. Returns the session. */
export async function staffSignInCode(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<{ staff: StaffMember; token: string; expiresAt: Date }> {
  const payload = readToken(String(input.pending ?? ''), deps.keys.pending, deps.now());
  const staffId = typeof payload?.sid === 'number' ? payload.sid : null;
  if (staffId === null) throw new ApiError(401, 'start_again', 'That took too long. Sign in again.');
  const code = text(input.code, 12).replace(/\s/g, '');
  const subject = `staff:${staffId}`;
  await checkAttempts(deps.db, 'staff_two_step', subject, meta.ip);

  const result = await withTransaction(deps.db, async (c) => {
    // The row is locked so two requests cannot both use the same code.
    await c.query('select id from staff where id = $1 for update', [staffId]);
    const staff = await loadStaff(c, 's.id = $1', staffId);
    if (!staff || staff.status !== 'active' || !staff.totpSecret) return null;
    const step = verifyTotp(unseal(staff.totpSecret, deps.keys.totp), code, deps.now(), staff.totpLastStep);
    if (step === null) return null;
    const token = randomToken();
    const expiresAt = new Date(deps.now().getTime() + STAFF.sessionHours * 3_600_000);
    await c.query('update staff set totp_last_step = $2, last_sign_in_at = $3 where id = $1', [staff.id, step, deps.now()]);
    await c.query('insert into staff_sessions (staff_id, token_hash, ip, user_agent, expires_at, created_at, last_seen_at) values ($1, $2, $3::inet, $4, $5, $6, $6)', [staff.id, hashToken(token), meta.ip, text(meta.userAgent, 300) || null, expiresAt, deps.now()]);
    await logActivity(c, staff, 'Staff and roles', 'Signed in', { type: 'staff', id: staff.id }, meta.ip);
    return { staff: publicStaff({ ...staff, lastSignInAt: deps.now() }), token, expiresAt };
  });
  await recordAttempt(deps.db, 'staff_two_step', subject, meta.ip, result !== null);
  if (!result) throw new ApiError(401, 'wrong_code', 'That code is not right. Check your authenticator app and try again.', { code: 'That code is not right.' });
  return result;
}

/** The staff member a session token belongs to, or null. Ends idle and over-long sessions. */
export async function staffFromToken(deps: AccountDeps, token: string | null | undefined): Promise<StaffMember | null> {
  if (!token || token.length > 200) return null;
  const now = deps.now();
  const found = await deps.db.query(
    `update staff_sessions set last_seen_at = $2
     where token_hash = $1 and revoked_at is null and expires_at > $2 and last_seen_at > $3
     returning staff_id`,
    [hashToken(token), now, new Date(now.getTime() - STAFF.idleMinutes * 60_000)],
  );
  const staffId = found.rows[0]?.staff_id;
  if (staffId === undefined) return null;
  const staff = await loadStaff(deps.db, 's.id = $1', staffId);
  return staff && staff.status === 'active' ? publicStaff(staff) : null;
}

export async function staffSignOut(deps: AccountDeps, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await deps.db.query('update staff_sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null', [hashToken(token), deps.now()]);
}

// ----- managing staff and roles (Owner only) -----

export async function listStaff(deps: AccountDeps, actor: StaffMember): Promise<Array<Omit<StaffMember, 'permissions'>>> {
  requireAccess(actor, 'settings', 'view');
  const result = await deps.db.query('select s.id from staff s order by s.created_at, s.id');
  const out: Array<Omit<StaffMember, 'permissions'>> = [];
  for (const row of result.rows) {
    const s = await loadStaff(deps.db, 's.id = $1', row.id);
    if (s) {
      const { permissions: _permissions, ...rest } = publicStaff(s);
      out.push(rest);
    }
  }
  return out;
}

export interface Role {
  id: number;
  name: string;
  isOwner: boolean;
  permissions: Permissions;
}

export async function listRoles(deps: AccountDeps, actor: StaffMember): Promise<Role[]> {
  requireAccess(actor, 'settings', 'view');
  const result = await deps.db.query(
    `select r.id, r.name, r.is_owner,
            coalesce((select jsonb_object_agg(p.area, jsonb_build_object('view', p.can_view, 'change', p.can_change)) from role_permissions p where p.role_id = r.id), '{}') as permissions
     from roles r order by r.is_owner desc, r.name`,
  );
  return result.rows.map((r) => ({ id: Number(r.id), name: String(r.name), isOwner: r.is_owner === true, permissions: r.is_owner === true ? emptyPermissions(true) : { ...emptyPermissions(), ...(r.permissions as Partial<Permissions>) } }));
}

function permissionsOf(value: unknown): Permissions {
  const out = emptyPermissions();
  const given = (value && typeof value === 'object' ? value : {}) as Record<string, { view?: unknown; change?: unknown }>;
  for (const area of AREAS) {
    const change = given[area]?.change === true;
    // Being able to change something includes being able to see it.
    out[area] = { view: change || given[area]?.view === true, change };
  }
  return out;
}

async function writePermissions(c: Query, roleId: number, permissions: Permissions): Promise<void> {
  await c.query('delete from role_permissions where role_id = $1', [roleId]);
  for (const area of AREAS) {
    await c.query('insert into role_permissions (role_id, area, can_view, can_change) values ($1, $2, $3, $4)', [roleId, area, permissions[area].view, permissions[area].change]);
  }
}

export async function createRole(deps: AccountDeps, actor: StaffMember, input: Record<string, unknown>, meta: Meta): Promise<{ roleId: number }> {
  requireOwner(actor);
  const name = text(input.name, 60);
  if (name === '') throw new ApiError(422, 'invalid', 'Check the details and try again.', { name: 'Give the role a name.' });
  const permissions = permissionsOf(input.permissions);
  try {
    return await withTransaction(deps.db, async (c) => {
      const made = await c.query('insert into roles (name) values ($1) returning id', [name]);
      const roleId = Number(made.rows[0]?.id);
      await writePermissions(c, roleId, permissions);
      await logActivity(c, actor, 'Staff and roles', `Created the role ${name}`, { type: 'role', id: roleId }, meta.ip);
      return { roleId };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'name_taken', 'A role with this name already exists.', { name: 'A role with this name already exists.' });
    throw error;
  }
}

export async function setRolePermissions(deps: AccountDeps, actor: StaffMember, roleId: number, input: Record<string, unknown>, meta: Meta): Promise<void> {
  requireOwner(actor);
  const permissions = permissionsOf(input.permissions);
  await withTransaction(deps.db, async (c) => {
    const role = await c.query('select name, is_owner from roles where id = $1 for update', [roleId]);
    const r = role.rows[0] as { name: string; is_owner: boolean } | undefined;
    if (!r) throw new ApiError(404, 'not_found', 'That role does not exist.');
    if (r.is_owner) throw new ApiError(422, 'owner_role', 'The Owner role can always do everything and cannot be changed.');
    await writePermissions(c, roleId, permissions);
    await logActivity(c, actor, 'Staff and roles', `Changed what the role ${r.name} may do`, { type: 'role', id: roleId }, meta.ip);
  });
}

/** Counts active Owners other than this one, so the store is never left without an Owner. */
async function otherActiveOwners(c: Query, staffId: number): Promise<number> {
  const result = await c.query("select count(*)::int as n from staff s join roles r on r.id = s.role_id where r.is_owner and s.status = 'active' and s.id <> $1", [staffId]);
  return Number(result.rows[0]?.n);
}

export async function setStaffRole(deps: AccountDeps, actor: StaffMember, staffId: number, input: Record<string, unknown>, meta: Meta): Promise<void> {
  requireOwner(actor);
  const roleId = Number(input.roleId);
  await withTransaction(deps.db, async (c) => {
    const target = await loadStaff(c, 's.id = $1', staffId);
    const role = await c.query('select name, is_owner from roles where id = $1', [Number.isInteger(roleId) ? roleId : -1]);
    const r = role.rows[0] as { name: string; is_owner: boolean } | undefined;
    if (!target || !r) throw new ApiError(404, 'not_found', 'That staff member or role does not exist.');
    if (target.isOwner && !r.is_owner && (await otherActiveOwners(c, staffId)) === 0) throw new ApiError(422, 'last_owner', 'There must always be at least one Owner.');
    await c.query('update staff set role_id = $2 where id = $1', [staffId, roleId]);
    await logActivity(c, actor, 'Staff and roles', `Changed ${target.email} from ${target.roleName} to ${r.name}`, { type: 'staff', id: staffId }, meta.ip);
  });
}

/** Stop a staff member signing in, and sign them out everywhere at once. */
export async function disableStaff(deps: AccountDeps, actor: StaffMember, staffId: number, meta: Meta): Promise<void> {
  requireOwner(actor);
  if (actor.id === staffId) throw new ApiError(422, 'self', 'You cannot disable your own account.');
  await withTransaction(deps.db, async (c) => {
    const target = await loadStaff(c, 's.id = $1', staffId);
    if (!target) throw new ApiError(404, 'not_found', 'That staff member does not exist.');
    if (target.isOwner && (await otherActiveOwners(c, staffId)) === 0) throw new ApiError(422, 'last_owner', 'There must always be at least one Owner.');
    await c.query("update staff set status = 'disabled' where id = $1", [staffId]);
    await c.query('update staff_sessions set revoked_at = $2 where staff_id = $1 and revoked_at is null', [staffId, deps.now()]);
    await c.query('delete from staff_invites where staff_id = $1 and accepted_at is null', [staffId]);
    await logActivity(c, actor, 'Staff and roles', `Disabled ${target.email}`, { type: 'staff', id: staffId }, meta.ip);
  });
}

/**
 * For a lost phone or forgotten password: wipe the password and two-step
 * setup, sign the person out everywhere and email a fresh invite link.
 */
export async function resetStaffAccess(deps: AccountDeps, actor: StaffMember, staffId: number, meta: Meta): Promise<void> {
  requireOwner(actor);
  if (actor.id === staffId) throw new ApiError(422, 'self', 'You cannot reset your own access. Another Owner can, or use the server command.');
  const sent = await withTransaction(deps.db, async (c) => {
    const target = await loadStaff(c, 's.id = $1', staffId);
    if (!target) throw new ApiError(404, 'not_found', 'That staff member does not exist.');
    if (target.isOwner && (await otherActiveOwners(c, staffId)) === 0) throw new ApiError(422, 'last_owner', 'There must always be at least one Owner.');
    const token = await resetAccess(deps, c, staffId, actor.id);
    await logActivity(c, actor, 'Staff and roles', `Reset sign-in for ${target.email}`, { type: 'staff', id: staffId }, meta.ip);
    return { email: target.email, name: target.name, token };
  });
  await deps.mail.send({ to: sent.email, template: 'staff_invite', data: { name: sent.name, token: sent.token, hours: String(STAFF.inviteHours), invitedBy: actor.name } });
}

async function resetAccess(deps: AccountDeps, c: Query, staffId: number, by: number | null): Promise<string> {
  await c.query("update staff set status = 'invited', password_hash = null, totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null where id = $1", [staffId]);
  await c.query('update staff_sessions set revoked_at = $2 where staff_id = $1 and revoked_at is null', [staffId, deps.now()]);
  return makeInvite(deps, c, staffId, by);
}

/** The same reset from a command on the server, for an Owner who is locked out. The link is returned to be printed once. */
export async function resetAccessFromServer(deps: AccountDeps, emailInput: string): Promise<{ token: string }> {
  const email = emailOf(emailInput);
  return withTransaction(deps.db, async (c) => {
    const target = await loadStaff(c, 's.email = $1', email);
    if (!target) throw new ApiError(404, 'not_found', 'No staff member has that email.');
    const token = await resetAccess(deps, c, target.id, null);
    await logActivity(c, { id: null, name: 'Server command' }, 'Staff and roles', `Reset sign-in for ${target.email}`, { type: 'staff', id: target.id });
    return { token };
  });
}

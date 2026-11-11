// Helpers for tests in other modules that need a signed-in staff member.

import { totpCode, totpStep } from './crypto.js';
import type { AccountDeps } from './deps.js';
import { cookieName } from './web.js';
import { acceptInviteConfirm, acceptInviteStart, inviteOwnerFromServer, staffSignInCode, staffSignInPassword, type StaffMember } from './staff.js';

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

/**
 * Create a staff member and sign them in, going through the real invite and
 * two-step flow. `tick` moves the test clock, since no two-step code works twice.
 * With a roleId the person is moved to that role; otherwise they are an Owner.
 */
export async function signedInStaff(deps: AccountDeps, tick: (seconds: number) => void, who: { name: string; email: string; roleId?: number }): Promise<{ cookie: string; staff: StaffMember }> {
  const password = 'test-password-1';
  const { token } = await inviteOwnerFromServer(deps, { name: who.name, email: who.email });
  const start = await acceptInviteStart(deps, { token, password });
  const secret = base32Decode(start.secret);
  await acceptInviteConfirm(deps, { token, code: totpCode(secret, totpStep(deps.now())) }, { ip: null });
  if (who.roleId !== undefined) await deps.db.query('update staff set role_id = $2 where email = $1', [who.email, who.roleId]);
  tick(31);
  const { pending } = await staffSignInPassword(deps, { email: who.email, password }, { ip: null });
  const session = await staffSignInCode(deps, { pending, code: totpCode(secret, totpStep(deps.now())) }, { ip: null });
  return { cookie: `${cookieName('staff', deps.config)}=${session.token}`, staff: session.staff };
}

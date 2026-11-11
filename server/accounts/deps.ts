// What the account code needs from the rest of the server, gathered in one
// place so tests can swap the clock, the mailer and the identity checker.

import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import { deriveKey, PASSWORD_PARAMS, type ScryptParams } from './crypto.js';
import type { Mailer } from './mailer.js';
import type { IdentityVerifier } from './oidc.js';

export interface AccountDeps {
  db: Db;
  config: Config;
  mail: Mailer;
  identity: IdentityVerifier;
  now: () => Date;
  passwordParams: ScryptParams;
  keys: { pending: Buffer; totp: Buffer; csrf: Buffer };
}

export function accountDeps(parts: { db: Db; config: Config; mail: Mailer; identity: IdentityVerifier; now?: () => Date; passwordParams?: ScryptParams }): AccountDeps {
  return {
    db: parts.db,
    config: parts.config,
    mail: parts.mail,
    identity: parts.identity,
    now: parts.now ?? (() => new Date()),
    passwordParams: parts.passwordParams ?? PASSWORD_PARAMS,
    keys: {
      pending: deriveKey(parts.config.authSecret, 'staff-pending-sign-in'),
      totp: deriveKey(parts.config.authSecret, 'totp-secret-encryption'),
      csrf: deriveKey(parts.config.authSecret, 'csrf'),
    },
  };
}

// ----- checking what people type -----

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A tidy, lower-case email address, or a field error. */
export function emailOf(value: unknown, field = 'email'): string {
  const email = text(value, 320).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: 'Enter a full email address, like name@example.com' });
  }
  return email;
}

export function passwordOf(value: unknown, field = 'password'): string {
  const password = typeof value === 'string' ? value : '';
  if (password.length < PASSWORD_MIN) throw new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: `Use at least ${PASSWORD_MIN} characters.` });
  if (password.length > PASSWORD_MAX) throw new ApiError(422, 'invalid', 'Check the details and try again.', { [field]: `Use at most ${PASSWORD_MAX} characters.` });
  return password;
}

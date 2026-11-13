// Customer accounts: sign-up, email verification, sign-in and sign-out,
// password reset, and Google and Apple sign-in linked to one customer.

import { withTransaction, type DbClient } from '../db/pool.js';
import { ApiError } from '../http.js';
import { hashCode, hashPassword, hashToken, passwordNeedsRehash, randomCode, randomToken, verifyPassword } from './crypto.js';
import { emailOf, passwordOf, text, type AccountDeps } from './deps.js';
import { checkAttempts, recordAttempt } from './guard.js';
import { IdentityError, type Identity, type Provider } from './oidc.js';
import { recordReferral } from '../loyalty/loyalty.js';

export const CUSTOMER = {
  /** The 6-digit code lasts this long (from the approved journeys). */
  codeMinutes: 10,
  /** A new code can be asked for after this long. */
  resendSeconds: 60,
  codeTries: 5,
  /** The emailed reset link lasts this long. */
  resetMinutes: 60,
  /** A session ends after this long without use: website, then phone app. */
  sessionDays: { web: 30, app: 90 },
};

export interface Customer {
  id: number;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  hasPassword: boolean;
  providers: Provider[];
}

export interface SignedIn {
  customer: Customer;
  /** The session token: goes in a cookie on the website, or to the phone app. Shown once, stored only as a hash. */
  token: string;
  expiresAt: Date;
}

export type Client = 'web' | 'app';

interface Meta {
  ip: string | null;
  userAgent?: string | null;
  client?: Client;
}

const WRONG = (): ApiError => new ApiError(401, 'wrong_credentials', 'Email or password is not right. Try again or reset your password.');

// A real hash of a random password, so checking a password for an email
// with no account takes as long as checking one that exists.
let dummyHash: Promise<string> | null = null;

async function loadCustomer(db: { query: DbClient['query'] }, where: string, value: unknown): Promise<(Customer & { passwordHash: string | null; status: string }) | null> {
  const result = await db.query(
    `select c.id, c.email, c.email_verified_at, c.first_name, c.last_name, c.password_hash, c.status,
            coalesce((select array_agg(provider order by provider) from customer_identities i where i.customer_id = c.id), '{}') as providers
     from customers c where ${where}`,
    [value],
  );
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    email: String(r.email),
    emailVerified: r.email_verified_at !== null,
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    hasPassword: r.password_hash !== null,
    providers: r.providers as Provider[],
    passwordHash: r.password_hash as string | null,
    status: String(r.status),
  };
}

function publicCustomer(c: Customer): Customer {
  return { id: c.id, email: c.email, emailVerified: c.emailVerified, firstName: c.firstName, lastName: c.lastName, hasPassword: c.hasPassword, providers: c.providers };
}

async function startSession(deps: AccountDeps, db: { query: DbClient['query'] }, customerId: number, meta: Meta): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const client = meta.client ?? 'web';
  const expiresAt = new Date(deps.now().getTime() + CUSTOMER.sessionDays[client] * 86_400_000);
  await db.query('insert into customer_sessions (customer_id, token_hash, client, ip, user_agent, expires_at, created_at, last_seen_at) values ($1, $2, $3, $4::inet, $5, $6, $7, $7)', [
    customerId,
    hashToken(token),
    client,
    meta.ip,
    text(meta.userAgent, 300) || null,
    expiresAt,
    deps.now(),
  ]);
  await db.query('update customers set last_sign_in_at = $2 where id = $1', [customerId, deps.now()]);
  return { token, expiresAt };
}

async function signedIn(deps: AccountDeps, customerId: number, meta: Meta): Promise<SignedIn> {
  const session = await startSession(deps, deps.db, customerId, meta);
  const customer = await loadCustomer(deps.db, 'c.id = $1', customerId);
  if (!customer) throw new Error('Customer vanished during sign-in');
  return { customer: publicCustomer(customer), ...session };
}

/** Make a fresh 6-digit code and email it. Older unused codes stop working. */
async function sendCode(deps: AccountDeps, customer: { id: number; email: string }, options: { force?: boolean } = {}): Promise<void> {
  const recent = await deps.db.query("select created_at from customer_tokens where customer_id = $1 and purpose = 'verify_email' and used_at is null order by created_at desc limit 1", [customer.id]);
  const last = recent.rows[0]?.created_at as Date | undefined;
  if (!options.force && last && deps.now().getTime() - last.getTime() < CUSTOMER.resendSeconds * 1000) {
    const wait = Math.ceil(CUSTOMER.resendSeconds - (deps.now().getTime() - last.getTime()) / 1000);
    throw new ApiError(429, 'wait_to_resend', `You can ask for a new code in ${wait} seconds.`, {}, { 'Retry-After': String(wait) });
  }
  const code = randomCode();
  await withTransaction(deps.db, async (c) => {
    await c.query("delete from customer_tokens where customer_id = $1 and purpose = 'verify_email'", [customer.id]);
    await c.query("insert into customer_tokens (customer_id, purpose, token_hash, expires_at, created_at) values ($1, 'verify_email', $2, $3, $4)", [
      customer.id,
      hashCode(code, 'verify_email', customer.id),
      new Date(deps.now().getTime() + CUSTOMER.codeMinutes * 60_000),
      deps.now(),
    ]);
  });
  await deps.mail.send({ to: customer.email, template: 'verify_email', data: { code, minutes: String(CUSTOMER.codeMinutes) } });
}

export async function signUp(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<{ email: string }> {
  const email = emailOf(input.email);
  const password = passwordOf(input.password);
  // Each sign-up counts against the address it came from, so one visitor
  // cannot create accounts (and send code emails) without limit.
  await checkAttempts(deps.db, 'sign_up', email, meta.ip);
  await recordAttempt(deps.db, 'sign_up', email, meta.ip, false);
  const firstName = text(input.firstName, 80);
  const lastName = text(input.lastName, 80);
  const consent = input.marketingConsent === true;
  const passwordHash = await hashPassword(password, deps.passwordParams);
  let id: number;
  try {
    const result = await deps.db.query(
      `insert into customers (email, password_hash, first_name, last_name, marketing_consent, marketing_consent_at)
       values ($1, $2, $3, $4, $5, case when $5 then now() end) returning id`,
      [email, passwordHash, firstName, lastName, consent],
    );
    id = Number(result.rows[0]?.id);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError(409, 'email_taken', 'This email already has an account. Sign in instead.', { email: 'This email already has an account. Sign in instead.' });
    }
    throw error;
  }
  await deps.db.query('insert into notification_preferences (customer_id, offers_email) values ($1, $2)', [id, consent]);
  // A friend's referral code typed at sign-up (module 17).
  await recordReferral(deps.db, id, input.referralCode);
  await sendCode(deps, { id, email }, { force: true });
  return { email };
}

/** Send a new code. Says nothing about whether the email has an account. */
export async function resendCode(deps: AccountDeps, input: Record<string, unknown>): Promise<void> {
  const email = emailOf(input.email);
  const customer = await loadCustomer(deps.db, 'c.email = $1', email);
  if (!customer || customer.emailVerified || customer.status !== 'active') return;
  await sendCode(deps, customer);
}

export async function verifyEmail(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<SignedIn> {
  const email = emailOf(input.email);
  const code = text(input.code, 12).replace(/\s/g, '');
  const bad = new ApiError(422, 'wrong_code', 'That code is not right. Check it and try again.', { code: 'That code is not right. Check it and try again.' });
  await checkAttempts(deps.db, 'code', email, meta.ip);
  const customer = await loadCustomer(deps.db, 'c.email = $1', email);
  if (!customer || customer.status !== 'active') {
    await recordAttempt(deps.db, 'code', email, meta.ip, false);
    throw bad;
  }
  // An address that is already verified must sign in with its password; a code proves nothing here.
  if (customer.emailVerified) throw new ApiError(409, 'already_verified', 'This email is already verified. Sign in instead.');

  const found = await deps.db.query("select id, token_hash, expires_at, attempts from customer_tokens where customer_id = $1 and purpose = 'verify_email' and used_at is null order by created_at desc limit 1", [customer.id]);
  const token = found.rows[0] as { id: number; token_hash: Buffer; expires_at: Date; attempts: number } | undefined;
  if (!token || token.expires_at <= deps.now() || token.attempts >= CUSTOMER.codeTries) {
    await sendCode(deps, customer, { force: true });
    throw new ApiError(422, 'code_expired', 'That code has expired. We have sent a new one.', { code: 'That code has expired. We have sent a new one.' });
  }
  if (!token.token_hash.equals(hashCode(code, 'verify_email', customer.id))) {
    await deps.db.query('update customer_tokens set attempts = attempts + 1 where id = $1', [token.id]);
    await recordAttempt(deps.db, 'code', email, meta.ip, false);
    throw bad;
  }
  await withTransaction(deps.db, async (c) => {
    await c.query('update customer_tokens set used_at = $2 where id = $1', [token.id, deps.now()]);
    await c.query('update customers set email_verified_at = $2 where id = $1', [customer.id, deps.now()]);
  });
  return signedInAfterCheck(deps, customer.id, meta, email);
}

async function signedInAfterCheck(deps: AccountDeps, customerId: number, meta: Meta, email: string): Promise<SignedIn> {
  await recordAttempt(deps.db, 'code', email, meta.ip, true);
  return signedIn(deps, customerId, meta);
}

export async function signIn(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<SignedIn> {
  const email = text(input.email, 320).toLowerCase();
  const password = typeof input.password === 'string' ? input.password.slice(0, 1000) : '';
  if (email === '' || password === '') throw WRONG();
  await checkAttempts(deps.db, 'customer', email, meta.ip);

  const customer = await loadCustomer(deps.db, 'c.email = $1', email);
  dummyHash ??= hashPassword(randomToken(), deps.passwordParams);
  const usable = customer !== null && customer.status === 'active' && customer.passwordHash !== null;
  const ok = (await verifyPassword(password, usable ? customer.passwordHash : await dummyHash)) && usable;
  await recordAttempt(deps.db, 'customer', email, meta.ip, ok);
  if (!ok || !customer) throw WRONG();

  if (!customer.emailVerified) {
    await sendCode(deps, customer).catch((error: unknown) => {
      if (!(error instanceof ApiError && error.code === 'wait_to_resend')) throw error;
    });
    throw new ApiError(403, 'email_not_verified', 'Check your email for a 6-digit code to finish setting up your account.');
  }
  if (customer.passwordHash && passwordNeedsRehash(customer.passwordHash, deps.passwordParams)) {
    await deps.db.query('update customers set password_hash = $2 where id = $1', [customer.id, await hashPassword(password, deps.passwordParams)]);
  }
  return signedIn(deps, customer.id, meta);
}

/** The customer a session token belongs to, or null. Using a session keeps it alive. */
export async function customerFromToken(deps: AccountDeps, token: string | null | undefined): Promise<Customer | null> {
  if (!token || token.length > 200) return null;
  const hash = hashToken(token);
  const found = await deps.db.query(
    `select s.id, s.customer_id, s.client, s.last_seen_at from customer_sessions s join customers c on c.id = s.customer_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > $2 and c.status = 'active'`,
    [hash, deps.now()],
  );
  const s = found.rows[0] as { id: number; customer_id: number; client: Client; last_seen_at: Date } | undefined;
  if (!s) return null;
  // Push the expiry forward at most once an hour, to save writes.
  if (deps.now().getTime() - s.last_seen_at.getTime() > 3_600_000) {
    await deps.db.query('update customer_sessions set last_seen_at = $2, expires_at = $3 where id = $1', [s.id, deps.now(), new Date(deps.now().getTime() + CUSTOMER.sessionDays[s.client] * 86_400_000)]);
  }
  const customer = await loadCustomer(deps.db, 'c.id = $1', s.customer_id);
  return customer ? publicCustomer(customer) : null;
}

export async function signOut(deps: AccountDeps, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await deps.db.query('update customer_sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null', [hashToken(token), deps.now()]);
}

/** Email a reset link. Always answers the same way, whether or not the email has an account. */
export async function forgotPassword(deps: AccountDeps, input: Record<string, unknown>, meta: Meta): Promise<void> {
  const email = emailOf(input.email);
  await checkAttempts(deps.db, 'code', email, meta.ip);
  await recordAttempt(deps.db, 'code', email, meta.ip, false);
  const customer = await loadCustomer(deps.db, 'c.email = $1', email);
  if (!customer || customer.status !== 'active') return;
  const token = randomToken();
  await withTransaction(deps.db, async (c) => {
    await c.query("delete from customer_tokens where customer_id = $1 and purpose = 'reset_password'", [customer.id]);
    await c.query("insert into customer_tokens (customer_id, purpose, token_hash, expires_at, created_at) values ($1, 'reset_password', $2, $3, $4)", [
      customer.id,
      hashToken(token),
      new Date(deps.now().getTime() + CUSTOMER.resetMinutes * 60_000),
      deps.now(),
    ]);
  });
  await deps.mail.send({ to: customer.email, template: 'reset_password', data: { token, minutes: String(CUSTOMER.resetMinutes) } });
}

/** Set a new password from an emailed link. Every device is signed out. */
export async function resetPassword(deps: AccountDeps, input: Record<string, unknown>): Promise<void> {
  const token = text(input.token, 200);
  const password = passwordOf(input.password);
  const passwordHash = await hashPassword(password, deps.passwordParams);
  const email = await withTransaction(deps.db, async (c) => {
    const found = await c.query(
      `update customer_tokens t set used_at = $2 from customers c
       where t.token_hash = $1 and t.purpose = 'reset_password' and t.used_at is null and t.expires_at > $2 and c.id = t.customer_id and c.status = 'active'
       returning c.id, c.email`,
      [hashToken(token), deps.now()],
    );
    const row = found.rows[0] as { id: number; email: string } | undefined;
    if (!row) throw new ApiError(422, 'link_expired', 'This link has expired or was already used. Ask for a new one.');
    // Opening the emailed link also proves the email address is theirs.
    await c.query('update customers set password_hash = $2, email_verified_at = coalesce(email_verified_at, $3) where id = $1', [row.id, passwordHash, deps.now()]);
    await c.query('update customer_sessions set revoked_at = $2 where customer_id = $1 and revoked_at is null', [row.id, deps.now()]);
    return row.email;
  });
  await deps.mail.send({ to: email, template: 'password_changed', data: {} });
}

async function identityFrom(deps: AccountDeps, provider: Provider, input: Record<string, unknown>): Promise<Identity> {
  const idToken = typeof input.idToken === 'string' ? input.idToken : '';
  const nonce = typeof input.nonce === 'string' && input.nonce !== '' ? input.nonce : undefined;
  try {
    return await deps.identity.verify(provider, idToken, { nonce });
  } catch (error) {
    if (error instanceof IdentityError) throw new ApiError(401, 'sign_in_failed', `We could not sign you in with ${provider === 'google' ? 'Google' : 'Apple'}. Try again.`);
    throw error;
  }
}

/**
 * Sign in with Google or Apple.
 * - Seen before: sign in the customer it is linked to.
 * - New, and the provider confirms an email that already has an account: link it to that account.
 * - Otherwise: create a new account, already verified.
 */
export async function signInWithProvider(deps: AccountDeps, provider: Provider, input: Record<string, unknown>, meta: Meta): Promise<SignedIn & { created: boolean }> {
  const identity = await identityFrom(deps, provider, input);
  const outcome = await withTransaction(deps.db, async (c) => {
    const linked = await c.query("select c.id, c.status from customer_identities i join customers c on c.id = i.customer_id where i.provider = $1 and i.subject = $2", [provider, identity.subject]);
    const known = linked.rows[0] as { id: number; status: string } | undefined;
    if (known) {
      if (known.status !== 'active') throw new ApiError(403, 'account_closed', 'This account is closed.');
      return { id: known.id, created: false };
    }
    // Linking by email is only safe when the provider itself vouches for the address.
    if (!identity.email || !identity.emailVerified) {
      throw new ApiError(422, 'email_needed', 'We could not get a confirmed email address from that sign-in. Create an account with your email instead.');
    }
    const existing = await c.query('select id, status from customers where email = $1', [identity.email]);
    const match = existing.rows[0] as { id: number; status: string } | undefined;
    if (match) {
      if (match.status !== 'active') throw new ApiError(403, 'account_closed', 'This account is closed.');
      await c.query('insert into customer_identities (customer_id, provider, subject, email) values ($1, $2, $3, $4)', [match.id, provider, identity.subject, identity.email]);
      // If the account's email was never verified, whoever made it never
      // proved the address was theirs. Their password and sessions are
      // removed, so they cannot get into the account its real owner now holds.
      const unverified = await c.query('update customers set password_hash = null, email_verified_at = $2 where id = $1 and email_verified_at is null returning id', [match.id, deps.now()]);
      if ((unverified.rowCount ?? 0) > 0) {
        await c.query('update customer_sessions set revoked_at = $2 where customer_id = $1 and revoked_at is null', [match.id, deps.now()]);
        await c.query('delete from customer_tokens where customer_id = $1', [match.id]);
      }
      return { id: match.id, created: false };
    }
    // Apple sends the name only the first time, in the request, not in the token.
    const [first = '', ...rest] = (identity.name ?? text(input.name, 160)).split(/\s+/);
    const made = await c.query('insert into customers (email, email_verified_at, first_name, last_name) values ($1, $2, $3, $4) returning id', [identity.email, deps.now(), first, rest.join(' ')]);
    const id = Number(made.rows[0]?.id);
    await c.query('insert into customer_identities (customer_id, provider, subject, email) values ($1, $2, $3, $4)', [id, provider, identity.subject, identity.email]);
    await c.query('insert into notification_preferences (customer_id) values ($1)', [id]);
    return { id, created: true };
  });
  return { ...(await signedIn(deps, outcome.id, meta)), created: outcome.created };
}

/** A signed-in customer adds Google or Apple as another way in. */
export async function linkProvider(deps: AccountDeps, customerId: number, provider: Provider, input: Record<string, unknown>): Promise<Customer> {
  const identity = await identityFrom(deps, provider, input);
  try {
    await deps.db.query('insert into customer_identities (customer_id, provider, subject, email) values ($1, $2, $3, $4)', [customerId, provider, identity.subject, identity.email]);
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
    const owner = await deps.db.query('select customer_id from customer_identities where provider = $1 and subject = $2', [provider, identity.subject]);
    if (Number(owner.rows[0]?.customer_id) !== customerId) {
      throw new ApiError(409, 'already_linked', `That ${provider === 'google' ? 'Google' : 'Apple'} account is already linked to a different customer, or you already have one linked.`);
    }
  }
  const customer = await loadCustomer(deps.db, 'c.id = $1', customerId);
  if (!customer) throw new ApiError(401, 'signed_out', 'Sign in to continue.');
  return publicCustomer(customer);
}

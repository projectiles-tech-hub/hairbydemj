// Commands run on the server for staff accounts:
//   npm run staff:invite-owner -- "Full Name" owner@example.com
//   npm run staff:reset-access -- person@example.com
// Each prints a link once. Whoever opens it sets a password and two-step
// verification, so send it only to the person it is for.

import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createPool } from '../db/pool.js';
import { ApiError } from '../http.js';
import { accountDeps } from './deps.js';
import { queueMailer } from './mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from './oidc.js';
import { inviteOwnerFromServer, resetAccessFromServer, STAFF } from './staff.js';

async function main(): Promise<number> {
  const [command, first, second] = process.argv.slice(2);
  const usage = 'Usage:\n  node dist/server/accounts/cli.js invite-owner "Full Name" email\n  node dist/server/accounts/cli.js reset-access email';
  if ((command !== 'invite-owner' || !first || !second) && (command !== 'reset-access' || !first)) {
    console.error(usage);
    return 2;
  }
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. See docs/database.md.');
    return 2;
  }
  const db = createPool(config.databaseUrl, { max: 2 });
  const deps = accountDeps({
    db,
    config,
    mail: queueMailer(db, createLogger('error'), false),
    identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
  });
  try {
    const { token } = command === 'invite-owner' ? await inviteOwnerFromServer(deps, { name: first ?? '', email: second ?? '' }) : await resetAccessFromServer(deps, first ?? '');
    const scheme = config.env === 'production' ? 'https' : 'http';
    const port = config.env === 'production' ? '' : `:${config.port}`;
    console.log(command === 'invite-owner' ? 'Owner invited.' : 'Access reset. They are signed out everywhere and must set a new password and two-step verification.');
    console.log(`Link (works once, for ${STAFF.inviteHours} hours):`);
    console.log(`${scheme}://${config.hosts.admin}${port}/accept-invite/?token=${token}`);
    return 0;
  } catch (error) {
    console.error(error instanceof ApiError ? error.message : error);
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();

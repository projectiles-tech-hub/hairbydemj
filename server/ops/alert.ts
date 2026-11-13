// Emails an alert to the owner (ALERT_EMAIL) using the shop's own mail
// settings, so it is signed like every other email. Used by the server
// scripts in deploy/bin (failed deployment, backups, restore tests, disk,
// stopped services):
//   node --env-file=/srv/hairbydemj/shared/.env dist/server/ops/alert.js "Subject" "Message"

import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig, type Config } from '../config.js';
import { createLogger } from '../logger.js';
import { transmit, type Composed } from '../notifications/notify.js';

/** The alert address from the environment, checked. Empty when not set. */
export function alertAddress(env: NodeJS.ProcessEnv): string {
  const value = (env.ALERT_EMAIL ?? '').trim();
  if (value === '') return '';
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value)) throw new ConfigError('ALERT_EMAIL must be one email address');
  return value;
}

export function alertEmail(config: Config, to: string, subject: string, message: string): Composed {
  const text = `${message}\n\nSent by the hairbydemj server (${config.hosts.site}).\n`;
  const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    to,
    subject: `hairbydemj alert: ${subject}`.slice(0, 200),
    text,
    html: `<!doctype html><html><body><pre style="font:14px/1.5 monospace;white-space:pre-wrap">${escape(text)}</pre></body></html>`,
    headers: {},
  };
}

async function main(argv: string[]): Promise<void> {
  const [subject, message = ''] = argv;
  if (!subject) throw new Error('usage: alert.js "Subject" "Message"');
  const config = loadConfig();
  const to = alertAddress(process.env);
  if (!to) throw new Error('ALERT_EMAIL is not set, so the alert could not be emailed');
  const logger = createLogger(config.logLevel);
  await transmit({ config, logger, now: () => new Date() } as Parameters<typeof transmit>[0], alertEmail(config, to, subject, message));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

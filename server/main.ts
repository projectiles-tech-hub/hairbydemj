// Entry point: loads configuration, starts the HTTP server and shuts it down
// cleanly when systemd (or Ctrl+C) asks it to stop.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';
import { accountDeps } from './accounts/deps.js';
import { queueMailer } from './accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from './accounts/oidc.js';
import { createPool } from './db/pool.js';
import { prepareMediaDir, processPending, type MediaDeps } from './media/media.js';
import { toolsInstalled } from './media/tools.js';

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  // Accounts need the database. Without DATABASE_URL (development only) the
  // server still runs, but the account addresses are not there.
  const db = config.databaseUrl ? createPool(config.databaseUrl) : null;
  const accounts = db
    ? accountDeps({
        db,
        config,
        mail: queueMailer(db, logger, config.env === 'development'),
        identity: createIdentityVerifier({
          google: { ...PROVIDER_DEFAULTS.google, clientIds: config.googleClientIds },
          apple: { ...PROVIDER_DEFAULTS.apple, clientIds: config.appleClientIds },
        }),
      })
    : undefined;
  if (!db) logger.warn('DATABASE_URL is not set: running without accounts');
  const media: MediaDeps | undefined = db ? { db, now: () => new Date(), logger, mediaDir: config.mediaDir } : undefined;
  if (media) {
    prepareMediaDir(media)
      .then(() => toolsInstalled())
      .then((tools) => {
        if (!tools.vips) logger.error('libvips is not installed: photo uploads will fail (install the libvips-tools package)');
        if (!tools.ffmpeg) logger.error('ffmpeg is not installed: video uploads will fail (install the ffmpeg package)');
        // Pick up any video that was still being compressed when the server last stopped.
        return processPending(media);
      })
      .catch((error: unknown) => logger.error('media folder is not usable', { mediaDir: config.mediaDir, error }));
  }
  const server = createServer(createApp(config, logger, { version: readVersion(), accounts, media }));

  // Slow or stalled clients should not hold connections open forever.
  // Long enough for a large video upload on a slow connection. Small JSON
  // requests have their own 30-second limit where they are read.
  server.requestTimeout = 15 * 60_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  server.listen(config.port, config.host, () => {
    logger.info('server started', {
      env: config.env,
      address: `${config.host}:${config.port}`,
      hosts: config.hosts,
    });
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info('server stopping', { signal });
    server.close(() => {
      const done = (): void => {
        logger.info('server stopped');
        process.exit(0);
      };
      if (db) db.end().then(done, done);
      else done();
    });
    server.closeIdleConnections();
    setTimeout(() => {
      logger.warn('forcing shutdown after 10 seconds');
      process.exit(1);
    }, 10_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { error: reason });
  });
}

main();

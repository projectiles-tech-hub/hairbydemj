// Entry point of the background worker: a separate process from the web
// server, kept running by systemd (deploy/systemd/hairbydemj-worker.service).
// It reads the same settings as the server.

import { queueMailer } from '../accounts/mailer.js';
import { fetchRates } from '../cart/rates.js';
import { ConfigError, loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../logger.js';
import { dhl, fedex, ups } from '../shipping/carriers.js';
import { join } from 'node:path';
import { createWorker } from './worker.js';

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
  if (!config.databaseUrl) {
    process.stderr.write('Configuration error: the worker needs DATABASE_URL\n');
    process.exit(1);
  }
  const db = createPool(config.databaseUrl, { max: 4 });
  const now = (): Date => new Date();
  const mail = queueMailer(db, logger, config.env === 'development');
  const c = config.carriers;
  const worker = createWorker({
    db,
    now,
    logger,
    config,
    mail,
    fetchRates,
    shipping: { db, now, logger, carriers: { dhl: dhl(c.dhl), ups: ups(c.ups), fedex: fedex(c.fedex) }, labelDir: join(config.mediaDir, 'private', 'labels') },
    orders: { db, now, logger, mail },
  });

  const stop = (signal: string): void => {
    logger.info('worker stopping', { signal });
    worker.stop();
    // A job that hangs must not stop a restart for ever; systemd waits up to 60 seconds.
    setTimeout(() => process.exit(1), 50_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled promise rejection', { error: reason }));

  worker
    .run()
    .then(() => db.end())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error('worker crashed', { error });
      process.exit(1);
    });
}

main();

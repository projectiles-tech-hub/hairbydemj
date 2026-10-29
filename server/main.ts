// Entry point: loads configuration, starts the HTTP server and shuts it down
// cleanly when systemd (or Ctrl+C) asks it to stop.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';

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
  const server = createServer(createApp(config, logger, { version: readVersion() }));

  // Slow or stalled clients should not hold connections open forever.
  server.requestTimeout = 30_000;
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
      logger.info('server stopped');
      process.exit(0);
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

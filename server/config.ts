// Server configuration, read from environment settings.
// Secrets are never hard-coded; see .env.example for the names.

export type Environment = 'development' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  env: Environment;
  host: string;
  port: number;
  hosts: {
    site: string;
    admin: string;
    api: string;
  };
  publicDir: string;
  /** Folder for uploaded photos and videos. Kept outside the code and backed up. */
  mediaDir: string;
  logLevel: LogLevel;
  /** Address of the PostgreSQL database, with its password. Null when not set (development only). */
  databaseUrl: string | null;
  /** Secret used to sign short-lived tokens and to encrypt two-step verification secrets. */
  authSecret: string;
  /** Client IDs our Google and Apple sign-in tokens must be issued for. Not secret. */
  googleClientIds: string[];
  appleClientIds: string[];
  /** True when the server sits behind our own proxy (Caddy), which passes on the visitor's address. */
  trustProxy: boolean;
}

/** Used only in development, so sign-in works without any setup. Never valid in production. */
export const DEV_AUTH_SECRET = 'development-only-secret-not-for-production-use';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function read(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function hostname(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = read(env, name, fallback).toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(value)) {
    throw new ConfigError(`${name} must be a hostname without a port or scheme, got "${value}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const envName = read(env, 'NODE_ENV', 'development');
  if (envName !== 'development' && envName !== 'production') {
    throw new ConfigError(`NODE_ENV must be "development" or "production", got "${envName}"`);
  }

  const portText = read(env, 'PORT', '3000');
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`PORT must be a whole number from 0 to 65535, got "${portText}"`);
  }

  const logLevel = read(env, 'LOG_LEVEL', 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }

  const production = envName === 'production';
  const hosts = {
    site: hostname(env, 'SITE_HOST', production ? 'hairbydemj.com' : 'localhost'),
    admin: hostname(env, 'ADMIN_HOST', production ? 'admin.hairbydemj.com' : 'admin.localhost'),
    api: hostname(env, 'API_HOST', production ? 'api.hairbydemj.com' : 'api.localhost'),
  };
  if (new Set(Object.values(hosts)).size !== 3) {
    throw new ConfigError('SITE_HOST, ADMIN_HOST and API_HOST must all be different');
  }

  const databaseUrl = read(env, 'DATABASE_URL', '');
  if (databaseUrl !== '' && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    // The value is not printed: it normally holds the database password.
    throw new ConfigError('DATABASE_URL must start with postgres:// or postgresql://');
  }
  if (databaseUrl === '' && production) {
    throw new ConfigError('DATABASE_URL must be set in production');
  }

  const authSecret = read(env, 'AUTH_SECRET', production ? '' : DEV_AUTH_SECRET);
  if (authSecret.length < 32 || (production && authSecret === DEV_AUTH_SECRET)) {
    throw new ConfigError('AUTH_SECRET must be set to a random value of at least 32 characters');
  }
  const list = (name: string): string[] => read(env, name, '').split(',').map((x) => x.trim()).filter(Boolean);
  const trustProxyText = read(env, 'TRUST_PROXY', production ? 'true' : 'false');
  if (trustProxyText !== 'true' && trustProxyText !== 'false') {
    throw new ConfigError(`TRUST_PROXY must be "true" or "false", got "${trustProxyText}"`);
  }

  return {
    env: envName,
    host: read(env, 'HOST', '127.0.0.1'),
    port,
    hosts,
    publicDir: read(env, 'PUBLIC_DIR', 'public'),
    logLevel,
    mediaDir: read(env, 'MEDIA_DIR', 'uploads'),
    databaseUrl: databaseUrl === '' ? null : databaseUrl,
    authSecret,
    googleClientIds: list('GOOGLE_CLIENT_IDS'),
    appleClientIds: list('APPLE_CLIENT_IDS'),
    trustProxy: trustProxyText === 'true',
  };
}

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
  /** Where daily exchange rates are fetched from (a free service, naira as the base). */
  ratesUrl: string;
  /** Payment provider keys. Secret keys are only ever read from the environment. Empty means not set up. */
  payments: {
    paystackSecretKey: string;
    paystackPublicKey: string;
    stripeSecretKey: string;
    stripePublishableKey: string;
    stripeWebhookSecret: string;
    /** Changed only by tests, to talk to stand-in providers. */
    paystackApiUrl: string;
    stripeApiUrl: string;
  };
  /**
   * Carrier API logins. Only ever read from the environment. Empty means that
   * carrier is not set up and is left out of checkout. The API addresses are
   * the live ones unless changed (to a carrier's test address, or by tests).
   */
  carriers: {
    dhl: { apiKey: string; apiSecret: string; accountNumber: string; apiUrl: string };
    ups: { clientId: string; clientSecret: string; accountNumber: string; apiUrl: string };
    fedex: { apiKey: string; secretKey: string; accountNumber: string; apiUrl: string };
  };
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
    ratesUrl: read(env, 'RATES_URL', 'https://open.er-api.com/v6/latest/NGN'),
    payments: {
      paystackSecretKey: read(env, 'PAYSTACK_SECRET_KEY', ''),
      paystackPublicKey: read(env, 'PAYSTACK_PUBLIC_KEY', ''),
      stripeSecretKey: read(env, 'STRIPE_SECRET_KEY', ''),
      stripePublishableKey: read(env, 'STRIPE_PUBLISHABLE_KEY', ''),
      stripeWebhookSecret: read(env, 'STRIPE_WEBHOOK_SECRET', ''),
      paystackApiUrl: read(env, 'PAYSTACK_API_URL', 'https://api.paystack.co'),
      stripeApiUrl: read(env, 'STRIPE_API_URL', 'https://api.stripe.com'),
    },
    carriers: {
      dhl: { apiKey: read(env, 'DHL_API_KEY', ''), apiSecret: read(env, 'DHL_API_SECRET', ''), accountNumber: read(env, 'DHL_ACCOUNT_NUMBER', ''), apiUrl: read(env, 'DHL_API_URL', 'https://express.api.dhl.com/mydhlapi') },
      ups: { clientId: read(env, 'UPS_CLIENT_ID', ''), clientSecret: read(env, 'UPS_CLIENT_SECRET', ''), accountNumber: read(env, 'UPS_ACCOUNT_NUMBER', ''), apiUrl: read(env, 'UPS_API_URL', 'https://onlinetools.ups.com') },
      fedex: { apiKey: read(env, 'FEDEX_API_KEY', ''), secretKey: read(env, 'FEDEX_SECRET_KEY', ''), accountNumber: read(env, 'FEDEX_ACCOUNT_NUMBER', ''), apiUrl: read(env, 'FEDEX_API_URL', 'https://apis.fedex.com') },
    },
  };
}

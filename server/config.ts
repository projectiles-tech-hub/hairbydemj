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
  logLevel: LogLevel;
}

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

  return {
    env: envName,
    host: read(env, 'HOST', '127.0.0.1'),
    port,
    hosts,
    publicDir: read(env, 'PUBLIC_DIR', 'public'),
    logLevel,
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, DEV_AUTH_SECRET, loadConfig } from './config.js';

test('uses development defaults when nothing is set', () => {
  const config = loadConfig({});
  assert.equal(config.env, 'development');
  assert.equal(config.port, 3000);
  assert.deepEqual(config.hosts, { site: 'localhost', admin: 'admin.localhost', api: 'api.localhost' });
  assert.equal(config.logLevel, 'info');
});

test('uses the real hostnames in production', () => {
  const config = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/shop', AUTH_SECRET: 'x'.repeat(40) });
  assert.deepEqual(config.hosts, {
    site: 'hairbydemj.com',
    admin: 'admin.hairbydemj.com',
    api: 'api.hairbydemj.com',
  });
});

test('reads values from the environment', () => {
  const config = loadConfig({ PORT: '8080', HOST: '0.0.0.0', SITE_HOST: 'Shop.Test', LOG_LEVEL: 'debug' });
  assert.equal(config.port, 8080);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.hosts.site, 'shop.test');
  assert.equal(config.logLevel, 'debug');
});

test('rejects invalid settings', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), ConfigError);
  assert.throws(() => loadConfig({ PORT: 'eighty' }), ConfigError);
  assert.throws(() => loadConfig({ PORT: '70000' }), ConfigError);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'loud' }), ConfigError);
  assert.throws(() => loadConfig({ SITE_HOST: 'https://hairbydemj.com' }), ConfigError);
  assert.throws(() => loadConfig({ SITE_HOST: 'same.test', ADMIN_HOST: 'same.test' }), ConfigError);
});

test('reads the database address and leaves it empty in development when unset', () => {
  assert.equal(loadConfig({}).databaseUrl, null);
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/shop', AUTH_SECRET: 'x'.repeat(40) }).databaseUrl, 'postgres://u:p@127.0.0.1:5432/shop');
});

test('production needs a database address', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(40) }), /DATABASE_URL must be set in production/);
});

test('a wrong database address is refused without printing it', () => {
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'mysql://u:s3cret@host/db' }),
    (e: Error) => e instanceof ConfigError && !e.message.includes('s3cret'),
  );
});

test('production needs its own long AUTH_SECRET', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/shop' };
  assert.throws(() => loadConfig(base), /AUTH_SECRET/);
  assert.throws(() => loadConfig({ ...base, AUTH_SECRET: 'short' }), /AUTH_SECRET/);
  assert.throws(() => loadConfig({ ...base, AUTH_SECRET: DEV_AUTH_SECRET }), /AUTH_SECRET/);
  assert.equal(loadConfig({}).authSecret, DEV_AUTH_SECRET);
});

test('reads the sign-in client IDs and the proxy setting', () => {
  const config = loadConfig({ GOOGLE_CLIENT_IDS: 'a.apps.googleusercontent.com, b.apps.googleusercontent.com', APPLE_CLIENT_IDS: 'com.hairbydemj.app' });
  assert.deepEqual(config.googleClientIds, ['a.apps.googleusercontent.com', 'b.apps.googleusercontent.com']);
  assert.deepEqual(config.appleClientIds, ['com.hairbydemj.app']);
  assert.equal(config.trustProxy, false);
  assert.throws(() => loadConfig({ TRUST_PROXY: 'yes' }), /TRUST_PROXY/);
});

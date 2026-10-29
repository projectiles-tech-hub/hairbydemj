import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from './config.js';

test('uses development defaults when nothing is set', () => {
  const config = loadConfig({});
  assert.equal(config.env, 'development');
  assert.equal(config.port, 3000);
  assert.deepEqual(config.hosts, { site: 'localhost', admin: 'admin.localhost', api: 'api.localhost' });
  assert.equal(config.logLevel, 'info');
});

test('uses the real hostnames in production', () => {
  const config = loadConfig({ NODE_ENV: 'production' });
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

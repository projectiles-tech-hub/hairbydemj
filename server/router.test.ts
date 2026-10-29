import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from './router.js';

const noop = (): void => {};

test('matches exact paths and ignores trailing slashes', () => {
  const router = new Router().get('/products', noop);
  assert.equal(router.match('GET', '/products').kind, 'found');
  assert.equal(router.match('GET', '/products/').kind, 'found');
  assert.equal(router.match('GET', '/product').kind, 'not-found');
});

test('extracts and decodes named parameters', () => {
  const router = new Router().get('/products/:slug/reviews/:id', noop);
  const match = router.match('GET', '/products/bone%20straight/reviews/42');
  assert.equal(match.kind, 'found');
  if (match.kind === 'found') assert.deepEqual(match.params, { slug: 'bone straight', id: '42' });
});

test('answers HEAD with GET routes', () => {
  const router = new Router().get('/', noop);
  assert.equal(router.match('HEAD', '/').kind, 'found');
});

test('reports allowed methods when the path exists but the method does not', () => {
  const router = new Router().get('/cart', noop).post('/cart', noop);
  const match = router.match('DELETE', '/cart');
  assert.deepEqual(match, { kind: 'method-not-allowed', allow: ['GET', 'HEAD', 'POST'] });
});

test('does not match badly encoded parameters', () => {
  const router = new Router().get('/products/:slug', noop);
  assert.equal(router.match('GET', '/products/%E0%A4%A').kind, 'not-found');
});

test('rejects patterns without a leading slash', () => {
  assert.throws(() => new Router().get('products', noop));
});

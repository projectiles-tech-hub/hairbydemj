import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from './logger.js';

test('writes one JSON line per entry with level, message and fields', () => {
  const lines: string[] = [];
  const logger = createLogger('info', (_level, line) => lines.push(line));
  logger.info('hello', { orderId: 7 });
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
  assert.equal(entry['level'], 'info');
  assert.equal(entry['message'], 'hello');
  assert.equal(entry['orderId'], 7);
  assert.equal(typeof entry['time'], 'string');
});

test('skips entries below the minimum level', () => {
  const lines: string[] = [];
  const logger = createLogger('warn', (_level, line) => lines.push(line));
  logger.debug('a');
  logger.info('b');
  logger.warn('c');
  logger.error('d');
  assert.deepEqual(lines.map((l) => (JSON.parse(l) as { message: string }).message), ['c', 'd']);
});

test('records errors with their name, message and stack', () => {
  const lines: string[] = [];
  const logger = createLogger('debug', (_level, line) => lines.push(line));
  logger.error('failed', { error: new TypeError('bad input') });
  const entry = JSON.parse(lines[0] as string) as { error: { name: string; message: string; stack: string } };
  assert.equal(entry.error.name, 'TypeError');
  assert.equal(entry.error.message, 'bad input');
  assert.match(entry.error.stack, /TypeError/);
});

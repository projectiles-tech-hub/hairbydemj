// The provider check refuses live keys and reports each currency and carrier.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../config.js';
import type { Provider } from '../payments/providers.js';
import type { Carrier } from '../shipping/carriers.js';
import { checkCarriers, checkPayments, report } from './provider-check.js';

function provider(name: 'paystack' | 'stripe', mode: 'test' | 'live', started: string[]): Provider {
  const amounts = new Map<string, [number, string]>();
  return {
    name,
    configured: true,
    mode,
    async start(input) {
      started.push(`${name} ${input.currency} ${input.amountMinor}`);
      amounts.set(input.reference, [input.amountMinor, input.currency]);
      return { reference: input.reference, authorizationUrl: null, clientSecret: 'x' };
    },
    async retrieve(reference) {
      const [amountMinor, currency] = amounts.get(reference) ?? [0, ''];
      return { reference, status: 'pending', amountMinor, currency, method: null, cardBrand: null, cardLast4: null, failureReason: null };
    },
    async refund() {
      throw new Error('never called');
    },
    verifyWebhook: () => false,
    payouts: async () => [],
  };
}

test('starts a test payment in each of the four currencies', async () => {
  const started: string[] = [];
  const config = loadConfig({ STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  const lines = await checkPayments(config, { paystack: provider('paystack', 'test', started), stripe: provider('stripe', 'test', started) });
  assert.deepEqual(started, ['paystack NGN 150000', 'stripe USD 1000', 'stripe GBP 1000', 'stripe EUR 1000']);
  assert.ok(lines.every((l) => l.ok), report(lines));
});

test('refuses to run with live keys', async () => {
  const started: string[] = [];
  const lines = await checkPayments(loadConfig({}), { paystack: provider('paystack', 'live', started), stripe: provider('stripe', 'live', started) });
  assert.deepEqual(started, []);
  assert.match(report(lines), /PROBLEM {2}paystack keys: these are LIVE keys/);
  assert.match(report(lines), /stripe webhook secret: not set/);
});

test('asks each test carrier for quotes and skips ones not set up', async () => {
  const carrier = (configured: boolean, mode: 'test' | 'live' | null): Carrier => ({
    code: 'dhl',
    name: configured ? 'DHL Express' : 'UPS',
    configured,
    mode,
    rates: async () => [{ serviceCode: 'P', serviceName: 'Express Worldwide', amount: 60, currency: 'USD', transitDays: 3, deliveryDate: null }],
    ship: async () => {
      throw new Error('never called');
    },
    track: async () => ({ status: null, events: [] }),
  });
  const lines = await checkCarriers(loadConfig({}), [carrier(true, 'test'), carrier(false, null)]);
  assert.equal(lines.length, 3);
  assert.match(report(lines), /ok {7}DHL Express to London: 1 services; from USD 60/);
  assert.match(report(lines), /UPS: not set up/);
  const live = await checkCarriers(loadConfig({}), [carrier(true, 'live')]);
  assert.equal(live[0]?.ok, false);
});

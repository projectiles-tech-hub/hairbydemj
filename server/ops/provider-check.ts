// Checks the real payment and carrier accounts in their TEST modes (module 20).
// Run it once the owner has the test keys, on a computer or on staging:
//   node --env-file=.env dist/server/ops/provider-check.js
// It refuses live keys, so it can never take real money or buy a real label.
//
// Payments: starts a small payment in each of the four currencies (naira with
// Paystack; dollars, pounds and euros with Stripe), reads each back, and
// checks the webhook secret is set. Nobody is charged: the payments are left
// unpaid and expire. Paying one by hand with a test card (docs/testing.md)
// then shows the whole path, webhook included.
// Carriers: asks each carrier that is set up for a quote from Benin City to
// London and to Accra.

import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { loadConfig, type Config } from '../config.js';
import { paystack, stripe, type Provider } from '../payments/providers.js';
import { dhl, fedex, ups, type Carrier, type RateRequest } from '../shipping/carriers.js';

export interface CheckLine {
  name: string;
  ok: boolean;
  note: string;
}

const PAYMENTS: Array<{ currency: string; amountMinor: number; provider: 'paystack' | 'stripe' }> = [
  { currency: 'NGN', amountMinor: 150_000, provider: 'paystack' },
  { currency: 'USD', amountMinor: 1_000, provider: 'stripe' },
  { currency: 'GBP', amountMinor: 1_000, provider: 'stripe' },
  { currency: 'EUR', amountMinor: 1_000, provider: 'stripe' },
];

function quoteTo(country: string, city: string, postalCode: string | null): RateRequest {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  return {
    from: { name: 'hairbydemj', phone: '+2348000000000', line1: '1 Airport Road', city: 'Benin City', region: 'Edo', postalCode: '300001', country: 'NG' },
    to: { name: 'Test Customer', phone: '+440000000000', line1: '1 Test Street', city, postalCode, country },
    parcels: [{ packageSizeId: null, name: 'Small box', weightGrams: 800, lengthMm: 300, widthMm: 220, heightMm: 100 }],
    shipDate: day,
    customs: { currency: 'USD', invoiceNumber: 'TEST', items: [{ description: 'Human hair wig', hsCode: '6704200000', quantity: 1, unitValue: 150, weightGrams: 600, originCountry: 'NG' }] },
  };
}

export async function checkPayments(config: Config, providers?: Record<'paystack' | 'stripe', Provider>): Promise<CheckLine[]> {
  const p = config.payments;
  const made = providers ?? {
    paystack: paystack({ secretKey: p.paystackSecretKey, apiUrl: p.paystackApiUrl }),
    stripe: stripe({ secretKey: p.stripeSecretKey, webhookSecret: p.stripeWebhookSecret, apiUrl: p.stripeApiUrl }),
  };
  const lines: CheckLine[] = [];
  for (const name of ['paystack', 'stripe'] as const) {
    const provider = made[name];
    if (!provider.configured) lines.push({ name: `${name} keys`, ok: false, note: 'not set' });
    else if (provider.mode !== 'test') lines.push({ name: `${name} keys`, ok: false, note: 'these are LIVE keys; this check only runs with test keys' });
    else lines.push({ name: `${name} keys`, ok: true, note: 'test keys' });
  }
  lines.push({ name: 'stripe webhook secret', ok: p.stripeWebhookSecret !== '', note: p.stripeWebhookSecret ? 'set' : 'not set: Stripe payments would never be confirmed' });
  for (const payment of PAYMENTS) {
    const provider = made[payment.provider];
    const label = `${payment.currency} payment (${payment.provider})`;
    if (!provider.configured || provider.mode !== 'test') {
      lines.push({ name: label, ok: false, note: 'skipped: no test keys' });
      continue;
    }
    try {
      const reference = `check-${payment.currency.toLowerCase()}-${randomBytes(6).toString('hex')}`;
      const started = await provider.start({ reference, amountMinor: payment.amountMinor, currency: payment.currency, email: 'test@example.com', orderNumber: 'TEST', callbackUrl: `https://${config.hosts.site}/checkout/complete/` });
      const charge = await provider.retrieve(started.reference);
      const right = charge.amountMinor === 0 || (charge.amountMinor === payment.amountMinor && charge.currency.toUpperCase() === payment.currency);
      lines.push({ name: label, ok: charge.status !== 'failed' && right, note: `started and read back (${charge.status}); reference ${started.reference}` });
    } catch (error) {
      lines.push({ name: label, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  }
  return lines;
}

export async function checkCarriers(config: Config, carriers?: Carrier[]): Promise<CheckLine[]> {
  const c = config.carriers;
  const list = carriers ?? [dhl(c.dhl), ups(c.ups), fedex(c.fedex)];
  const lines: CheckLine[] = [];
  for (const carrier of list) {
    if (!carrier.configured) {
      lines.push({ name: carrier.name, ok: true, note: 'not set up (left out of checkout)' });
      continue;
    }
    if (carrier.mode !== 'test') {
      lines.push({ name: carrier.name, ok: false, note: 'pointed at the LIVE address; set its test address (docs/shipping.md) for this check' });
      continue;
    }
    for (const [where, request] of [['London', quoteTo('GB', 'London', 'SW1A 1AA')], ['Accra', quoteTo('GH', 'Accra', null)]] as const) {
      try {
        const rates = await carrier.rates(request);
        const cheapest = rates.slice().sort((a, b) => a.amount - b.amount)[0];
        lines.push({ name: `${carrier.name} to ${where}`, ok: rates.length > 0, note: cheapest ? `${rates.length} services; from ${cheapest.currency} ${cheapest.amount} (${cheapest.serviceName})` : 'no services offered' });
      } catch (error) {
        lines.push({ name: `${carrier.name} to ${where}`, ok: false, note: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return lines;
}

export function report(lines: CheckLine[]): string {
  return lines.map((l) => `${l.ok ? 'ok     ' : 'PROBLEM'}  ${l.name}: ${l.note}`).join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  const lines = [...(await checkPayments(config)), ...(await checkCarriers(config))];
  process.stdout.write(`${report(lines)}\n`);
  process.exit(lines.some((l) => !l.ok) ? 1 : 0);
}

// Paystack (naira) and Stripe (dollars, pounds, euros), called directly over
// their REST APIs as the plan says; no SDKs. Each provider gets: start a
// payment, read a payment back, refund, and check that a webhook really came
// from it.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type ProviderName = 'paystack' | 'stripe';

export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface Started {
  reference: string;
  /** Paystack: the page to send the customer to. */
  authorizationUrl: string | null;
  /** Paystack's access code, or Stripe's PaymentIntent client secret: what the payment form needs. */
  clientSecret: string;
}

export interface Charge {
  reference: string;
  status: 'succeeded' | 'failed' | 'pending';
  amountMinor: number;
  currency: string;
  method: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  failureReason: string | null;
}

export interface RefundResult {
  providerReference: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface Provider {
  name: ProviderName;
  configured: boolean;
  /** "test" or "live", read from the key. */
  mode: 'test' | 'live' | null;
  start(input: { reference: string; amountMinor: number; currency: string; email: string; orderNumber: string; callbackUrl: string }): Promise<Started>;
  retrieve(reference: string): Promise<Charge>;
  refund(input: { reference: string; amountMinor: number; idempotencyKey: string }): Promise<RefundResult>;
  /** True when the body was signed with our secret. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, now: Date): boolean;
  /** The latest payouts to the store's bank account. */
  payouts(): Promise<Payout[]>;
}

export interface Payout {
  amountMinor: number;
  currency: string;
  status: string;
  date: string;
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function call(url: string, init: RequestInit, label: string): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new ProviderError(`${label} could not be reached (${error instanceof Error ? error.message : 'no answer'})`);
  }
  const text = await response.text();
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(text) as Record<string, any>;
  } catch {
    // handled below
  }
  if (!response.ok) {
    const message = body?.message ?? body?.error?.message ?? text.slice(0, 200);
    throw new ProviderError(`${label} refused the request: ${String(message)}`, response.status);
  }
  return body;
}

// ----- Paystack -----

export function paystack(options: { secretKey: string; apiUrl: string }): Provider {
  const auth = { Authorization: `Bearer ${options.secretKey}`, 'Content-Type': 'application/json' };
  const configured = options.secretKey !== '';
  const need = (): void => {
    if (!configured) throw new ProviderError('Paystack is not set up: PAYSTACK_SECRET_KEY is missing');
  };
  return {
    name: 'paystack',
    configured,
    mode: !configured ? null : options.secretKey.startsWith('sk_live_') ? 'live' : 'test',
    async start(input) {
      need();
      const body = await call(`${options.apiUrl}/transaction/initialize`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          email: input.email,
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          // Card, bank transfer and USSD, as the plan lists for naira.
          channels: ['card', 'bank_transfer', 'ussd', 'bank'],
          metadata: { order_number: input.orderNumber },
        }),
      }, 'Paystack');
      if (body.status !== true || !body.data?.access_code) throw new ProviderError('Paystack did not start the payment');
      return { reference: String(body.data.reference ?? input.reference), authorizationUrl: String(body.data.authorization_url ?? ''), clientSecret: String(body.data.access_code) };
    },
    async retrieve(reference) {
      need();
      const body = await call(`${options.apiUrl}/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET', headers: auth }, 'Paystack');
      const d = body.data ?? {};
      const status = d.status === 'success' ? 'succeeded' : d.status === 'failed' || d.status === 'abandoned' || d.status === 'reversed' ? 'failed' : 'pending';
      return {
        reference: String(d.reference ?? reference),
        status,
        amountMinor: Number(d.amount),
        currency: String(d.currency ?? '').toUpperCase(),
        method: d.channel ? String(d.channel) : null,
        cardBrand: d.authorization?.brand ? String(d.authorization.brand) : null,
        cardLast4: /^\d{4}$/.test(String(d.authorization?.last4 ?? '')) ? String(d.authorization.last4) : null,
        failureReason: status === 'failed' ? String(d.gateway_response ?? 'The payment did not go through') : null,
      };
    },
    async refund(input) {
      need();
      const body = await call(`${options.apiUrl}/refund`, { method: 'POST', headers: auth, body: JSON.stringify({ transaction: input.reference, amount: input.amountMinor }) }, 'Paystack');
      const d = body.data ?? {};
      return { providerReference: String(d.id ?? ''), status: d.status === 'processed' ? 'succeeded' : d.status === 'failed' ? 'failed' : 'pending' };
    },
    verifyWebhook(rawBody, headers) {
      if (!configured) return false;
      // Paystack signs the exact body with HMAC-SHA512 using the secret key.
      const expected = createHmac('sha512', options.secretKey).update(rawBody).digest('hex');
      return safeEqualHex(header(headers, 'x-paystack-signature'), expected);
    },
    async payouts() {
      need();
      const body = await call(`${options.apiUrl}/settlement?perPage=5`, { method: 'GET', headers: auth }, 'Paystack');
      return ((body.data ?? []) as Array<Record<string, any>>).map((s) => ({ amountMinor: Number(s.total_amount ?? s.effective_amount ?? 0), currency: String(s.currency ?? 'NGN').toUpperCase(), status: String(s.status ?? ''), date: String(s.settlement_date ?? s.settled_at ?? s.createdAt ?? '') }));
    },
  };
}

// ----- Stripe -----

/** Stripe wants form fields, with nested names like metadata[order_number]. */
function form(fields: Record<string, string | number | boolean>): string {
  return Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export function stripe(options: { secretKey: string; webhookSecret: string; apiUrl: string }): Provider {
  const configured = options.secretKey !== '';
  const headers = (idempotencyKey?: string): Record<string, string> => ({
    Authorization: `Bearer ${options.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  });
  const need = (): void => {
    if (!configured) throw new ProviderError('Stripe is not set up: STRIPE_SECRET_KEY is missing');
  };
  return {
    name: 'stripe',
    configured,
    mode: !configured ? null : options.secretKey.startsWith('sk_live_') ? 'live' : 'test',
    async start(input) {
      need();
      const body = await call(`${options.apiUrl}/v1/payment_intents`, {
        method: 'POST',
        // The same reference twice gives the same PaymentIntent, never a second charge.
        headers: headers(`start-${input.reference}`),
        body: form({
          amount: input.amountMinor,
          currency: input.currency.toLowerCase(),
          // Cards, Apple Pay and Google Pay, as the plan lists for these currencies.
          'automatic_payment_methods[enabled]': true,
          receipt_email: input.email,
          description: `hairbydemj order ${input.orderNumber}`,
          'metadata[order_number]': input.orderNumber,
          'metadata[reference]': input.reference,
        }),
      }, 'Stripe');
      if (!body.id || !body.client_secret) throw new ProviderError('Stripe did not start the payment');
      return { reference: String(body.id), authorizationUrl: null, clientSecret: String(body.client_secret) };
    },
    async retrieve(reference) {
      need();
      const body = await call(`${options.apiUrl}/v1/payment_intents/${encodeURIComponent(reference)}?expand[]=latest_charge`, { method: 'GET', headers: headers() }, 'Stripe');
      const status = body.status === 'succeeded' ? 'succeeded' : body.status === 'canceled' || body.status === 'requires_payment_method' && body.last_payment_error ? 'failed' : 'pending';
      const card = body.latest_charge?.payment_method_details?.card;
      return {
        reference: String(body.id ?? reference),
        status,
        amountMinor: Number(body.amount_received || body.amount),
        currency: String(body.currency ?? '').toUpperCase(),
        method: body.latest_charge?.payment_method_details?.type ? String(body.latest_charge.payment_method_details.type) : null,
        cardBrand: card?.brand ? String(card.brand) : null,
        cardLast4: /^\d{4}$/.test(String(card?.last4 ?? '')) ? String(card.last4) : null,
        failureReason: status === 'failed' ? String(body.last_payment_error?.message ?? 'The payment did not go through') : null,
      };
    },
    async refund(input) {
      need();
      const body = await call(`${options.apiUrl}/v1/refunds`, { method: 'POST', headers: headers(input.idempotencyKey), body: form({ payment_intent: input.reference, amount: input.amountMinor }) }, 'Stripe');
      return { providerReference: String(body.id ?? ''), status: body.status === 'succeeded' ? 'succeeded' : body.status === 'failed' || body.status === 'canceled' ? 'failed' : 'pending' };
    },
    verifyWebhook(rawBody, headersIn, now) {
      if (!configured || options.webhookSecret === '') return false;
      // Stripe-Signature: t=<time>,v1=<HMAC-SHA256 of "<time>.<body>">. Old signatures are refused (5 minutes).
      const parts = header(headersIn, 'stripe-signature').split(',').map((p) => p.split('='));
      const time = parts.find(([k]) => k === 't')?.[1];
      const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
      if (!time || !/^\d+$/.test(time) || !signatures.length) return false;
      if (Math.abs(Math.floor(now.getTime() / 1000) - Number(time)) > 300) return false;
      const expected = createHmac('sha256', options.webhookSecret).update(`${time}.`).update(rawBody).digest('hex');
      return signatures.some((s) => safeEqualHex(s, expected));
    },
    async payouts() {
      need();
      const body = await call(`${options.apiUrl}/v1/payouts?limit=5`, { method: 'GET', headers: headers() }, 'Stripe');
      return ((body.data ?? []) as Array<Record<string, any>>).map((p) => ({ amountMinor: Number(p.amount ?? 0), currency: String(p.currency ?? '').toUpperCase(), status: String(p.status ?? ''), date: new Date(Number(p.arrival_date ?? p.created ?? 0) * 1000).toISOString() }));
    },
  };
}

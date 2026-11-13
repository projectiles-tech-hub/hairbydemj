// Starting payments, confirming them from webhooks, and refunds.
//
// The rule from the plan: an order is marked paid only when the provider's
// webhook says so, never because a browser or app says so. Webhooks can
// come twice, late, or in the wrong order; each is recorded once, and a
// payment that is already confirmed is never confirmed again.

import { createHash, randomBytes } from 'node:crypto';
import { withTransaction, type Db } from '../db/pool.js';
import { ApiError } from '../http.js';
import type { Logger } from '../logger.js';
import { markOrderPaid, orderEvent, updateRefundStatus } from './order-paid.js';
import { ProviderError, type Provider, type ProviderName } from './providers.js';

export interface PaymentDeps {
  db: Db;
  now: () => Date;
  logger: Logger;
  providers: Record<ProviderName, Provider>;
  /** Public keys the payment forms need. Not secret. */
  publicKeys: { paystack: string; stripe: string };
  /** Where Paystack sends the customer back to, with ?order=<number>. */
  returnUrl: string;
}

export interface PaymentStart {
  provider: ProviderName;
  reference: string;
  amountMinor: number;
  currency: string;
  /** Paystack: the payment page. */
  authorizationUrl: string | null;
  /** Paystack's access code, or Stripe's client secret, for the payment form. */
  clientSecret: string;
  publicKey: string;
}

/** A checkout that has not been paid within this time is let go; a payment form older than this is not reused. */
const REUSE_MINUTES = 20;

/** Start paying for an order that is waiting for payment. Calling again soon after gives the same payment form. */
export async function startPayment(deps: PaymentDeps, orderId: number): Promise<PaymentStart> {
  const found = await deps.db.query(
    `select o.id, o.number, o.email, o.currency, o.status, o.payment_status, o.total_minor - o.gift_card_minor as due, o.stock_held_until, c.provider
     from orders o join currencies c on c.code = o.currency where o.id = $1`,
    [orderId],
  );
  const order = found.rows[0] as { id: number; number: string; email: string; currency: string; status: string; payment_status: string; due: number; stock_held_until: Date | null; provider: ProviderName } | undefined;
  if (!order) throw new ApiError(404, 'not_found', 'That order does not exist.');
  if (order.payment_status !== 'awaiting' && order.payment_status !== 'failed') throw new ApiError(409, 'already_paid', 'This order has already been paid.');
  if (order.status === 'cancelled' || (order.stock_held_until !== null && order.stock_held_until <= deps.now())) {
    throw new ApiError(409, 'checkout_expired', 'This checkout has expired. Go back to your bag to check out again.');
  }
  const due = Number(order.due);
  if (due <= 0) throw new ApiError(409, 'nothing_to_pay', 'There is nothing left to pay on this order.');
  const provider = deps.providers[order.provider];
  if (!provider.configured) throw new ApiError(503, 'payments_unavailable', 'Payment is not available just now. Please try again shortly.');

  const recent = await deps.db.query(
    "select reference, client_secret, authorization_url from payments where order_id = $1 and provider = $2 and amount_minor = $3 and status = 'pending' and created_at > $4 order by id desc limit 1",
    [order.id, provider.name, due, new Date(deps.now().getTime() - REUSE_MINUTES * 60_000)],
  );
  const reuse = recent.rows[0] as { reference: string; client_secret: string | null; authorization_url: string | null } | undefined;
  if (reuse?.client_secret) {
    return { provider: provider.name, reference: reuse.reference, amountMinor: due, currency: order.currency, authorizationUrl: reuse.authorization_url, clientSecret: reuse.client_secret, publicKey: deps.publicKeys[provider.name] };
  }

  const reference = `${order.number}-${randomBytes(5).toString('hex')}`;
  let started;
  try {
    started = await provider.start({ reference, amountMinor: due, currency: order.currency, email: order.email, orderNumber: order.number, callbackUrl: `${deps.returnUrl}?order=${encodeURIComponent(order.number)}` });
  } catch (error) {
    deps.logger.error('payment could not be started', { orderId, provider: provider.name, error });
    throw new ApiError(502, 'payment_start_failed', 'We could not open the payment form just now. Please try again.');
  }
  await deps.db.query(
    'insert into payments (order_id, provider, reference, amount_minor, currency, client_secret, authorization_url, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
    [order.id, provider.name, started.reference, due, order.currency, started.clientSecret, started.authorizationUrl, deps.now()],
  );
  return { provider: provider.name, reference: started.reference, amountMinor: due, currency: order.currency, authorizationUrl: started.authorizationUrl, clientSecret: started.clientSecret, publicKey: deps.publicKeys[provider.name] };
}

interface Confirmed {
  amountMinor: number;
  currency: string;
  method: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
}

/** The provider confirms a charge. Returns the order id when the order must be refunded (paid after it was cancelled and sold out). */
async function confirmCharge(deps: PaymentDeps, provider: ProviderName, reference: string, charge: Confirmed): Promise<number | null> {
  return withTransaction(deps.db, async (c) => {
    const found = await c.query('select id, order_id, amount_minor, currency, status from payments where provider = $1 and reference = $2 for update', [provider, reference]);
    const payment = found.rows[0] as { id: number; order_id: number; amount_minor: number; currency: string; status: string } | undefined;
    if (!payment) throw new IgnoredEvent(`No payment with reference ${reference}`);
    if (payment.status === 'succeeded') return null; // already confirmed: a repeat
    if (Number(charge.amountMinor) !== Number(payment.amount_minor) || charge.currency.toUpperCase() !== payment.currency) {
      await c.query("update payments set failure_reason = $2, updated_at = $3 where id = $1", [payment.id, `The provider reported ${charge.currency} ${charge.amountMinor}, not ${payment.currency} ${payment.amount_minor}`, deps.now()]);
      await orderEvent(c, payment.order_id, 'payment_mismatch', `A payment came in for the wrong amount (${charge.currency} ${charge.amountMinor} instead of ${payment.currency} ${payment.amount_minor}). It was not accepted. Check it in the ${provider === 'paystack' ? 'Paystack' : 'Stripe'} dashboard.`);
      return null;
    }
    await c.query(
      "update payments set status = 'succeeded', webhook_confirmed_at = $2, method = $3, card_brand = $4, card_last4 = $5, failure_reason = null, client_secret = null, updated_at = $2 where id = $1",
      [payment.id, deps.now(), charge.method, charge.cardBrand, charge.cardLast4],
    );
    const { refundNeeded } = await markOrderPaid(c, payment.order_id, deps.now());
    return refundNeeded ? payment.id : null;
  });
}

async function markFailed(deps: PaymentDeps, provider: ProviderName, reference: string, reason: string): Promise<void> {
  await withTransaction(deps.db, async (c) => {
    const found = await c.query('select id, order_id, status from payments where provider = $1 and reference = $2 for update', [provider, reference]);
    const payment = found.rows[0] as { id: number; order_id: number; status: string } | undefined;
    if (!payment) throw new IgnoredEvent(`No payment with reference ${reference}`);
    // A failure that arrives after a success (out of order) changes nothing.
    if (payment.status !== 'pending') return;
    await c.query("update payments set status = 'failed', failure_reason = $2, updated_at = $3 where id = $1", [payment.id, reason.slice(0, 300), deps.now()]);
    await c.query("update orders set payment_status = 'failed' where id = $1 and payment_status = 'awaiting'", [payment.order_id]);
    await orderEvent(c, payment.order_id, 'payment_failed', `Payment did not go through: ${reason.slice(0, 200)}`);
  });
}

async function refundChanged(deps: PaymentDeps, match: { provider: ProviderName; refundReference?: string; paymentReference?: string; amountMinor?: number }, status: 'succeeded' | 'failed'): Promise<void> {
  await withTransaction(deps.db, async (c) => {
    const found = match.refundReference
      ? await c.query('select r.id, r.order_id, r.status, r.amount_minor from refunds r join payments p on p.id = r.payment_id where p.provider = $1 and r.provider_reference = $2 for update of r', [match.provider, match.refundReference])
      : await c.query(
          "select r.id, r.order_id, r.status, r.amount_minor from refunds r join payments p on p.id = r.payment_id where p.provider = $1 and p.reference = $2 and r.status = 'pending' and ($3::bigint is null or r.amount_minor = $3) order by r.id limit 1 for update of r",
          [match.provider, match.paymentReference, match.amountMinor ?? null],
        );
    const refund = found.rows[0] as { id: number; order_id: number; status: string; amount_minor: number } | undefined;
    if (!refund) throw new IgnoredEvent('No matching refund');
    if (refund.status === status) return;
    if (refund.status === 'succeeded') return; // never go back from a finished refund
    await c.query('update refunds set status = $2, completed_at = $3 where id = $1', [refund.id, status, deps.now()]);
    await orderEvent(c, refund.order_id, status === 'succeeded' ? 'refunded' : 'refund_failed', status === 'succeeded' ? `Refund of ${refund.amount_minor} completed` : 'A refund failed at the payment provider. Try again or refund by bank transfer.', { visible: status === 'succeeded' });
    if (status === 'succeeded') await updateRefundStatus(c, refund.order_id);
  });
}

/** A webhook about something we do not know: recorded and answered with 200, so the provider stops sending it. */
class IgnoredEvent extends Error {
  override name = 'IgnoredEvent';
}

/**
 * Handle a webhook. The signature is checked first; then the event is
 * recorded once (a repeat is answered and ignored) and acted on.
 */
export async function handleWebhook(deps: PaymentDeps, providerName: ProviderName, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ result: 'processed' | 'duplicate' | 'ignored' }> {
  const provider = deps.providers[providerName];
  if (!provider.verifyWebhook(rawBody, headers, deps.now())) throw new ApiError(401, 'bad_signature', 'The webhook signature is not valid.');
  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as Record<string, any>;
  } catch {
    throw new ApiError(400, 'bad_json', 'The webhook is not valid JSON.');
  }
  // Stripe gives each event an id. Paystack does not, so the exact body is the identity.
  const eventId = providerName === 'stripe' ? String(event.id ?? '') : createHash('sha256').update(rawBody).digest('hex');
  const type = String(providerName === 'stripe' ? event.type : event.event);
  if (!eventId) throw new ApiError(400, 'bad_event', 'The webhook has no id.');

  const recorded = await deps.db.query(
    `insert into payment_events (provider, event_id, type, payload, received_at) values ($1, $2, $3, $4, $5)
     on conflict (provider, event_id) do update set type = excluded.type
     returning id, processed_at`,
    [providerName, eventId, type, rawBody.toString('utf8'), deps.now()],
  );
  const row = recorded.rows[0] as { id: number; processed_at: Date | null };
  if (row.processed_at) return { result: 'duplicate' };

  let refundPaymentId: number | null = null;
  let result: 'processed' | 'ignored' = 'processed';
  try {
    const d = event.data ?? {};
    if (providerName === 'paystack') {
      if (type === 'charge.success' && d.status === 'success') {
        refundPaymentId = await confirmCharge(deps, 'paystack', String(d.reference), {
          amountMinor: Number(d.amount),
          currency: String(d.currency ?? ''),
          method: d.channel ? String(d.channel) : null,
          cardBrand: d.authorization?.brand ? String(d.authorization.brand) : null,
          cardLast4: /^\d{4}$/.test(String(d.authorization?.last4 ?? '')) ? String(d.authorization.last4) : null,
        });
      } else if (type === 'refund.processed' || type === 'refund.failed') {
        await refundChanged(deps, { provider: 'paystack', paymentReference: String(d.transaction_reference ?? ''), amountMinor: d.amount === undefined ? undefined : Number(d.amount) }, type === 'refund.processed' ? 'succeeded' : 'failed');
      } else result = 'ignored';
    } else {
      const object = d.object ?? {};
      if (type === 'payment_intent.succeeded') {
        // Read the payment back from Stripe for the card details, and as a second check.
        const charge = await provider.retrieve(String(object.id));
        if (charge.status !== 'succeeded') throw new Error(`Stripe says ${String(object.id)} is ${charge.status}, not succeeded`);
        refundPaymentId = await confirmCharge(deps, 'stripe', String(object.id), charge);
      } else if (type === 'payment_intent.payment_failed') {
        await markFailed(deps, 'stripe', String(object.id), String(object.last_payment_error?.message ?? 'The payment did not go through'));
      } else if ((type === 'refund.updated' || type === 'charge.refund.updated' || type === 'refund.failed') && object.object === 'refund') {
        if (object.status === 'succeeded' || object.status === 'failed' || object.status === 'canceled') {
          await refundChanged(deps, { provider: 'stripe', refundReference: String(object.id) }, object.status === 'succeeded' ? 'succeeded' : 'failed');
        }
      } else result = 'ignored';
    }
  } catch (error) {
    if (error instanceof IgnoredEvent) {
      await deps.db.query('update payment_events set processed_at = $2, error = $3 where id = $1', [row.id, deps.now(), error.message]);
      return { result: 'ignored' };
    }
    // Left unprocessed and answered with an error, so the provider sends it again.
    await deps.db.query('update payment_events set error = $2 where id = $1', [row.id, error instanceof Error ? error.message.slice(0, 500) : 'failed']);
    deps.logger.error('webhook processing failed', { provider: providerName, type, error });
    throw new ApiError(500, 'webhook_failed', 'The webhook could not be processed. It will be retried.');
  }
  await deps.db.query('update payment_events set processed_at = $2 where id = $1', [row.id, deps.now()]);

  if (refundPaymentId !== null) {
    const payment = await deps.db.query('select amount_minor from payments where id = $1', [refundPaymentId]);
    await refundPayment(deps, refundPaymentId, { amountMinor: Number(payment.rows[0]?.amount_minor), reason: 'Paid after the order was cancelled, and an item had sold out' }, null).catch((error: unknown) => {
      deps.logger.error('automatic refund failed', { paymentId: refundPaymentId, error });
    });
  }
  return { result };
}

export interface RefundOutcome {
  refundId: number;
  status: 'pending' | 'succeeded' | 'failed';
}

/**
 * Send money back through the provider that took it. Several partial
 * refunds may follow one payment, but never more than was paid.
 */
export async function refundPayment(
  deps: PaymentDeps,
  paymentId: number,
  input: { amountMinor: number; reason: string; includesShipping?: boolean; returnId?: number | null; items?: Array<{ orderItemId: number; quantity: number }> },
  staffId: number | null,
): Promise<RefundOutcome> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 1) throw new ApiError(422, 'invalid', 'Check the amount.', { amountMinor: 'Enter the amount to refund.' });
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new ApiError(422, 'invalid', 'Choose a reason.', { reason: 'Choose a reason.' });
  const prepared = await withTransaction(deps.db, async (c) => {
    const found = await c.query("select id, order_id, provider, reference, amount_minor, status from payments where id = $1 for update", [paymentId]);
    const payment = found.rows[0] as { id: number; order_id: number; provider: ProviderName; reference: string; amount_minor: number; status: string } | undefined;
    if (!payment) throw new ApiError(404, 'not_found', 'That payment does not exist.');
    if (payment.status !== 'succeeded') throw new ApiError(409, 'not_paid', 'Only a confirmed payment can be refunded.');
    const already = await c.query("select coalesce(sum(amount_minor), 0)::bigint as total from refunds where payment_id = $1 and status in ('pending', 'succeeded')", [paymentId]);
    const left = Number(payment.amount_minor) - Number(already.rows[0]?.total);
    if (input.amountMinor > left) throw new ApiError(422, 'invalid', `At most ${left} can still be refunded on this payment.`, { amountMinor: `At most ${left} can still be refunded.` });
    const made = await c.query(
      'insert into refunds (order_id, payment_id, return_id, amount_minor, includes_shipping, reason, staff_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
      [payment.order_id, payment.id, input.returnId ?? null, input.amountMinor, input.includesShipping === true, reason, staffId, deps.now()],
    );
    const refundId = Number(made.rows[0]?.id);
    for (const item of input.items ?? []) await c.query('insert into refund_items (refund_id, order_item_id, quantity) values ($1, $2, $3)', [refundId, item.orderItemId, item.quantity]);
    return { refundId, payment };
  });

  let result;
  try {
    result = await deps.providers[prepared.payment.provider].refund({ reference: prepared.payment.reference, amountMinor: input.amountMinor, idempotencyKey: `refund-${prepared.refundId}` });
  } catch (error) {
    await deps.db.query("update refunds set status = 'failed', completed_at = $2 where id = $1", [prepared.refundId, deps.now()]);
    await orderEvent(deps.db, prepared.payment.order_id, 'refund_failed', `A refund of ${input.amountMinor} was refused by ${prepared.payment.provider === 'paystack' ? 'Paystack' : 'Stripe'}: ${error instanceof ProviderError ? error.message : 'no answer'}`, { staffId });
    throw new ApiError(502, 'refund_failed', `The refund did not go through: ${error instanceof Error ? error.message : 'no answer'}. Nothing was refunded.`);
  }
  await withTransaction(deps.db, async (c) => {
    await c.query('update refunds set provider_reference = $2, status = $3, completed_at = case when $3 = \'pending\' then null else $4::timestamptz end where id = $1', [prepared.refundId, result.providerReference || null, result.status, deps.now()]);
    await orderEvent(c, prepared.payment.order_id, result.status === 'succeeded' ? 'refunded' : 'refund_started', result.status === 'succeeded' ? `Refund of ${input.amountMinor} completed: ${reason}` : `Refund of ${input.amountMinor} sent to the provider: ${reason}`, { staffId, visible: true });
    if (result.status === 'succeeded') await updateRefundStatus(c, prepared.payment.order_id);
  });
  return { refundId: prepared.refundId, status: result.status };
}

/** For the order page: has it been paid yet? The return page asks this while the webhook is on its way. */
export async function paymentStatus(deps: PaymentDeps, orderId: number): Promise<{ orderNumber: string; orderStatus: string; paymentStatus: string; amountDueMinor: number; currency: string; lastFailure: string | null }> {
  const found = await deps.db.query(
    `select o.number, o.status, o.payment_status, o.currency, o.total_minor - o.gift_card_minor as due,
            (select failure_reason from payments p where p.order_id = o.id and p.status = 'failed' order by p.id desc limit 1) as failure
     from orders o where o.id = $1`,
    [orderId],
  );
  const r = found.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw new ApiError(404, 'not_found', 'That order does not exist.');
  const paid = r.payment_status !== 'awaiting' && r.payment_status !== 'failed';
  return { orderNumber: String(r.number), orderStatus: String(r.status), paymentStatus: String(r.payment_status), amountDueMinor: paid ? 0 : Number(r.due), currency: String(r.currency), lastFailure: (r.failure as string | null) ?? null };
}

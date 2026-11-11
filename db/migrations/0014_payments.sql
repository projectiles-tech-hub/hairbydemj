-- 0014 Payments: what is needed to start a payment, confirm it from the
-- provider's webhook and refund it.

-- A guest pays for and later views their order with this token (stored as a hash).
alter table orders add column access_token_hash bytea unique;

alter table payments
  -- What the customer's browser or app needs to open the provider's payment
  -- form: Paystack's access code, or Stripe's PaymentIntent client secret.
  -- Not a secret key: it only lets someone pay this one amount.
  add column client_secret text,
  add column authorization_url text;

-- Several refunds can follow one payment (partial refunds); the provider's
-- refund id lets each be matched to its webhook.
create index refunds_provider_reference on refunds (provider_reference);

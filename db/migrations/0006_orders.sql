-- 0006 Carts, orders, payments, shipments and returns.

create table carts (
  id            bigint generated always as identity primary key,
  -- Hash of the cookie that identifies a guest's cart.
  token_hash    bytea unique,
  customer_id   bigint references customers (id) on delete cascade,
  currency      text not null references currencies (code),
  country       text check (country ~ '^[A-Z]{2}$'),
  discount_code citext,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (token_hash is not null or customer_id is not null)
);
create unique index carts_one_per_customer on carts (customer_id) where customer_id is not null;
create index carts_updated_at on carts (updated_at);
create trigger carts_updated before update on carts for each row execute function set_updated_at();

create table cart_items (
  id         bigint generated always as identity primary key,
  cart_id    bigint not null references carts (id) on delete cascade,
  variant_id bigint references variants (id) on delete cascade,
  -- For a gift card in the cart: amount, recipient, message, delivery date.
  gift_card  jsonb,
  quantity   integer not null default 1 check (quantity > 0),
  added_at   timestamptz not null default now(),
  check ((variant_id is null) <> (gift_card is null))
);
create unique index cart_items_one_per_variant on cart_items (cart_id, variant_id) where variant_id is not null;
create index cart_items_cart on cart_items (cart_id);
create index cart_items_variant on cart_items (variant_id);

create sequence order_number_seq start with 10001;
create sequence return_number_seq start with 201;

-- An order keeps its own copy of names, prices and the address, so later
-- changes to products or the customer's account never alter past orders.
create table orders (
  id                    bigint generated always as identity primary key,
  number                text not null unique default 'HBD-' || nextval('order_number_seq'),
  customer_id           bigint references customers (id) on delete set null,
  email                 citext not null,
  phone                 text,
  source                text not null default 'web' check (source in ('web', 'app', 'admin')),
  currency              text not null references currencies (code),
  status                text not null default 'on_hold' check (status in ('on_hold', 'to_fulfil', 'shipped', 'delivered', 'returned', 'cancelled')),
  payment_status        text not null default 'awaiting' check (payment_status in ('awaiting', 'paid', 'failed', 'partly_refunded', 'refunded')),
  subtotal_minor        bigint not null check (subtotal_minor >= 0),
  discount_minor        bigint not null default 0 check (discount_minor >= 0),
  points_redeemed       integer not null default 0 check (points_redeemed >= 0),
  points_minor          bigint not null default 0 check (points_minor >= 0),
  shipping_minor        bigint not null default 0 check (shipping_minor >= 0),
  total_minor           bigint not null check (total_minor >= 0),
  -- Part of the total paid with gift cards; the rest goes to the payment provider.
  gift_card_minor       bigint not null default 0 check (gift_card_minor >= 0),
  ship_full_name        text,
  ship_phone            text,
  ship_line1            text,
  ship_line2            text,
  ship_city             text,
  ship_region           text,
  ship_postal_code      text,
  ship_country          text check (ship_country ~ '^[A-Z]{2}$'),
  shipping_carrier      text check (shipping_carrier in ('dhl', 'ups', 'fedex', 'local')),
  shipping_service_code text,
  shipping_service_name text,
  delivery_estimate     text,
  total_weight_grams    integer check (total_weight_grams >= 0),
  package_size_id       bigint references package_sizes (id) on delete set null,
  -- True when checkout told an international customer that duties are paid on delivery.
  duties_notice_shown   boolean not null default false,
  customer_note         text,
  -- Stock stays reserved for an unpaid order until this time.
  stock_held_until      timestamptz,
  placed_at             timestamptz not null default now(),
  paid_at               timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (total_minor = subtotal_minor - discount_minor - points_minor + shipping_minor),
  check (gift_card_minor <= total_minor),
  check (discount_minor + points_minor <= subtotal_minor)
);
create index orders_customer on orders (customer_id, placed_at desc);
create index orders_status on orders (status, placed_at desc);
create index orders_placed on orders (placed_at desc);
create index orders_email on orders (email);
create index orders_unpaid_holds on orders (stock_held_until) where payment_status = 'awaiting';
create trigger orders_updated before update on orders for each row execute function set_updated_at();

alter table stock_movements
  add constraint stock_movements_order_fk foreign key (order_id) references orders (id) on delete set null;

create table order_items (
  id                  bigint generated always as identity primary key,
  order_id            bigint not null references orders (id) on delete cascade,
  kind                text not null default 'variant' check (kind in ('variant', 'gift_card')),
  variant_id          bigint references variants (id) on delete set null,
  product_id          bigint references products (id) on delete set null,
  gift_card_id        bigint references gift_cards (id) on delete set null,
  product_name        text not null,
  variant_description text not null default '',
  sku                 text,
  quantity            integer not null check (quantity > 0),
  unit_price_minor    bigint not null check (unit_price_minor >= 0),
  total_minor         bigint not null check (total_minor >= 0),
  weight_grams        integer not null default 0 check (weight_grams >= 0),
  is_final_sale       boolean not null default false,
  check (total_minor = unit_price_minor * quantity)
);
create index order_items_order on order_items (order_id);
create index order_items_variant on order_items (variant_id);
create index order_items_product on order_items (product_id);

create table order_discounts (
  id           bigint generated always as identity primary key,
  order_id     bigint not null references orders (id) on delete cascade,
  discount_id  bigint references discounts (id) on delete set null,
  code         text,
  description  text not null,
  amount_minor bigint not null check (amount_minor >= 0)
);
create index order_discounts_order on order_discounts (order_id);
create index order_discounts_discount on order_discounts (discount_id);

-- The order's timeline: what happened, when, and who did it.
create table order_events (
  id                  bigint generated always as identity primary key,
  order_id            bigint not null references orders (id) on delete cascade,
  kind                text not null,
  summary             text not null,
  staff_id            bigint references staff (id) on delete set null,
  visible_to_customer boolean not null default false,
  created_at          timestamptz not null default now()
);
create index order_events_order on order_events (order_id, created_at);

-- Every movement of a gift card's balance.
create table gift_card_transactions (
  id                  bigint generated always as identity primary key,
  gift_card_id        bigint not null references gift_cards (id) on delete cascade,
  order_id            bigint references orders (id) on delete set null,
  kind                text not null check (kind in ('issue', 'redeem', 'refund', 'adjust', 'expire')),
  amount_minor        bigint not null check (amount_minor <> 0),
  balance_after_minor bigint not null check (balance_after_minor >= 0),
  staff_id            bigint references staff (id) on delete set null,
  created_at          timestamptz not null default now()
);
create index gift_card_transactions_card on gift_card_transactions (gift_card_id, created_at);
create index gift_card_transactions_order on gift_card_transactions (order_id);

-- A charge at Paystack or Stripe. It counts as paid only once the provider's
-- webhook has confirmed it, never on the browser's word.
create table payments (
  id                   bigint generated always as identity primary key,
  order_id             bigint not null references orders (id) on delete restrict,
  provider             text not null check (provider in ('paystack', 'stripe')),
  reference            text not null,
  amount_minor         bigint not null check (amount_minor > 0),
  currency             text not null references currencies (code),
  status               text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  method               text,
  card_brand           text,
  card_last4           text check (card_last4 ~ '^[0-9]{4}$'),
  failure_reason       text,
  webhook_confirmed_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (provider, reference),
  check (status <> 'succeeded' or webhook_confirmed_at is not null)
);
create index payments_order on payments (order_id);
create trigger payments_updated before update on payments for each row execute function set_updated_at();

-- Webhook messages as received, so each is handled once even if sent twice.
create table payment_events (
  id           bigint generated always as identity primary key,
  provider     text not null check (provider in ('paystack', 'stripe')),
  event_id     text not null,
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (provider, event_id)
);
create index payment_events_unprocessed on payment_events (received_at) where processed_at is null;

create table shipments (
  id              bigint generated always as identity primary key,
  order_id        bigint not null references orders (id) on delete restrict,
  carrier         text not null check (carrier in ('dhl', 'ups', 'fedex', 'local')),
  service_code    text,
  service_name    text,
  -- What the customer was charged for delivery, and what the label cost us.
  rate_minor      bigint check (rate_minor >= 0),
  rate_currency   text references currencies (code),
  label_cost_minor bigint check (label_cost_minor >= 0),
  label_cost_currency text,
  label_path      text,
  tracking_number text,
  tracking_url    text,
  status          text not null default 'pending' check (status in ('pending', 'label_bought', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned')),
  weight_grams    integer check (weight_grams > 0),
  package_size_id bigint references package_sizes (id) on delete set null,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index shipments_order on shipments (order_id);
create index shipments_tracking on shipments (tracking_number);
create index shipments_in_progress on shipments (status) where status in ('label_bought', 'in_transit', 'out_for_delivery', 'exception');
create trigger shipments_updated before update on shipments for each row execute function set_updated_at();

create table shipment_events (
  id          bigint generated always as identity primary key,
  shipment_id bigint not null references shipments (id) on delete cascade,
  status      text not null,
  description text not null default '',
  location    text,
  occurred_at timestamptz not null,
  raw         jsonb,
  created_at  timestamptz not null default now(),
  unique (shipment_id, occurred_at, status)
);

create table returns (
  id              bigint generated always as identity primary key,
  number          text not null unique default 'RET-' || nextval('return_number_seq'),
  order_id        bigint not null references orders (id) on delete restrict,
  customer_id     bigint references customers (id) on delete set null,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled')),
  resolution      text not null default 'refund' check (resolution in ('refund', 'store_credit')),
  customer_note   text,
  decision_note   text,
  condition_note  text,
  label_path      text,
  tracking_number text,
  decided_by      bigint references staff (id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  received_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index returns_order on returns (order_id);
create index returns_customer on returns (customer_id);
create index returns_status on returns (status, requested_at desc);
create trigger returns_updated before update on returns for each row execute function set_updated_at();

create table return_items (
  id            bigint generated always as identity primary key,
  return_id     bigint not null references returns (id) on delete cascade,
  order_item_id bigint not null references order_items (id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  reason        text not null check (reason in ('wrong_item', 'wrong_length', 'damaged', 'not_as_described', 'changed_mind', 'other')),
  refund_minor  bigint not null default 0 check (refund_minor >= 0),
  unique (return_id, order_item_id)
);

create table return_media (
  id         bigint generated always as identity primary key,
  return_id  bigint not null references returns (id) on delete cascade,
  path       text not null,
  created_at timestamptz not null default now()
);
create index return_media_return on return_media (return_id);

-- Money sent back through the provider that took the payment.
create table refunds (
  id                 bigint generated always as identity primary key,
  order_id           bigint not null references orders (id) on delete restrict,
  payment_id         bigint references payments (id) on delete restrict,
  return_id          bigint references returns (id) on delete set null,
  provider_reference text,
  amount_minor       bigint not null check (amount_minor > 0),
  includes_shipping  boolean not null default false,
  reason             text not null,
  status             text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  staff_id           bigint references staff (id) on delete set null,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index refunds_order on refunds (order_id);
create index refunds_payment on refunds (payment_id);

create table refund_items (
  refund_id     bigint not null references refunds (id) on delete cascade,
  order_item_id bigint not null references order_items (id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  primary key (refund_id, order_item_id)
);

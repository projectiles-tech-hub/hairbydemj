-- 0015 Shipping: delivery prices offered at checkout are kept for a short
-- while, so the price the customer picked is the price the order gets;
-- shipments remember the carrier's own id and the packages sent.

create table shipping_quotes (
  -- A random id handed to the customer's browser or app; never a counter.
  id           text primary key check (id ~ '^[A-Za-z0-9_-]{20,64}$'),
  cart_id      bigint references carts (id) on delete cascade,
  currency     text not null references currencies (code),
  -- The delivery address the prices were worked out for.
  address      jsonb not null,
  -- The parcel or parcels: weight and box sizes.
  packages     jsonb not null,
  -- Each option: id, carrier, service, price, delivery estimate.
  options      jsonb not null,
  duties_notice boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index shipping_quotes_cart on shipping_quotes (cart_id);
create index shipping_quotes_expires on shipping_quotes (expires_at);

alter table shipments
  add column carrier_shipment_id text,
  add column packages jsonb not null default '[]',
  add column label_format text check (label_format in ('pdf', 'gif', 'png', 'zpl')),
  add column courier text,
  add column last_tracked_at timestamptz,
  add column created_by bigint references staff (id) on delete set null;
create index shipments_created_by on shipments (created_by);
create unique index shipments_carrier_tracking on shipments (carrier, tracking_number) where tracking_number is not null;

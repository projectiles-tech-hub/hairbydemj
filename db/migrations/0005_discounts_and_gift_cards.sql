-- 0005 Discounts and gift cards.

create table discounts (
  id                 bigint generated always as identity primary key,
  name               text not null check (length(trim(name)) > 0),
  -- Empty for an automatic discount, which needs no code.
  code               citext unique,
  kind               text not null check (kind in ('percentage', 'fixed', 'free_shipping', 'buy_x_get_y')),
  -- Hundredths of a percent: 1000 = 10%.
  percent_bps        integer check (percent_bps between 1 and 10000),
  buy_quantity       integer check (buy_quantity > 0),
  get_quantity       integer check (get_quantity > 0),
  applies_to         text not null default 'all' check (applies_to in ('all', 'categories', 'collections', 'products')),
  target_ids         bigint[] not null default '{}',
  customer_group     text not null default 'everyone' check (customer_group in ('everyone', 'new_customers', 'gold_and_platinum')),
  total_uses_limit   integer check (total_uses_limit > 0),
  per_customer_limit integer check (per_customer_limit > 0),
  times_used         integer not null default 0 check (times_used >= 0),
  combinable         boolean not null default false,
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  status             text not null default 'draft' check (status in ('draft', 'active', 'disabled')),
  created_by         bigint references staff (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'percentage') = (percent_bps is not null)),
  check ((kind = 'buy_x_get_y') = (buy_quantity is not null and get_quantity is not null)),
  check (ends_at is null or ends_at > starts_at),
  check (applies_to = 'all' or cardinality(target_ids) > 0)
);
create index discounts_active on discounts (status, starts_at, ends_at);
create trigger discounts_updated before update on discounts for each row execute function set_updated_at();

-- Amounts that differ by currency: the fixed amount off and the minimum order.
create table discount_amounts (
  discount_id     bigint not null references discounts (id) on delete cascade,
  currency        text not null references currencies (code),
  amount_minor    bigint check (amount_minor > 0),
  min_order_minor bigint check (min_order_minor >= 0),
  primary key (discount_id, currency),
  check (amount_minor is not null or min_order_minor is not null)
);

-- Gift card codes are stored as a hash, like passwords. The last four
-- characters are kept so staff and customers can tell cards apart.
create table gift_cards (
  id                    bigint generated always as identity primary key,
  code_hash             bytea not null unique,
  code_last4            text not null check (length(code_last4) = 4),
  currency              text not null references currencies (code),
  initial_minor         bigint not null check (initial_minor > 0),
  balance_minor         bigint not null check (balance_minor >= 0),
  purchaser_customer_id bigint references customers (id) on delete set null,
  issued_by_staff_id    bigint references staff (id) on delete set null,
  issue_reason          text,
  recipient_email       citext not null,
  recipient_name        text,
  message               text,
  deliver_at            timestamptz,
  delivered_at          timestamptz,
  expires_at            timestamptz,
  status                text not null default 'pending' check (status in ('pending', 'active', 'used_up', 'expired', 'disabled')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (balance_minor <= initial_minor),
  -- A card issued by staff must say why; the reason goes in the activity log.
  check (issued_by_staff_id is null or issue_reason is not null)
);
create index gift_cards_recipient on gift_cards (recipient_email);
create index gift_cards_purchaser on gift_cards (purchaser_customer_id);
create trigger gift_cards_updated before update on gift_cards for each row execute function set_updated_at();

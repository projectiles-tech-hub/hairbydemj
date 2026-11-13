-- 0007 Loyalty points, referrals and reviews.

create table loyalty_tiers (
  code       text primary key check (code ~ '^[a-z_]+$'),
  name       text not null,
  -- Points earned in the last 12 months needed to reach this tier.
  min_points integer not null unique check (min_points >= 0),
  benefit    text not null default '',
  position   integer not null default 0
);
insert into loyalty_tiers (code, name, min_points, position) values ('bronze', 'Bronze', 0, 0);
alter table customers
  add constraint customers_tier_fk foreign key (loyalty_tier) references loyalty_tiers (code) on update cascade;

create table reviews (
  id             bigint generated always as identity primary key,
  product_id     bigint not null references products (id) on delete cascade,
  customer_id    bigint references customers (id) on delete set null,
  order_item_id  bigint unique references order_items (id) on delete set null,
  author_name    text not null,
  rating         smallint not null check (rating between 1 and 5),
  body           text not null default '',
  verified_buyer boolean not null default false,
  status         text not null default 'waiting' check (status in ('waiting', 'published', 'hidden')),
  reply          text,
  replied_by     bigint references staff (id) on delete set null,
  replied_at     timestamptz,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index reviews_product on reviews (product_id, status, created_at desc);
create index reviews_status on reviews (status, created_at desc);
create index reviews_customer on reviews (customer_id);
create trigger reviews_updated before update on reviews for each row execute function set_updated_at();

create table review_media (
  id        bigint generated always as identity primary key,
  review_id bigint not null references reviews (id) on delete cascade,
  path      text not null,
  position  integer not null default 0
);
create index review_media_review on review_media (review_id);

-- Every movement of a customer's points.
create table loyalty_transactions (
  id            bigint generated always as identity primary key,
  customer_id   bigint not null references customers (id) on delete cascade,
  points        integer not null check (points <> 0),
  balance_after integer not null check (balance_after >= 0),
  kind          text not null check (kind in ('order', 'review', 'birthday', 'referral', 'redeem', 'refund', 'adjust', 'expire')),
  order_id      bigint references orders (id) on delete set null,
  review_id     bigint references reviews (id) on delete set null,
  staff_id      bigint references staff (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index loyalty_transactions_customer on loyalty_transactions (customer_id, created_at desc);
create index loyalty_transactions_order on loyalty_transactions (order_id);

-- Who invited whom. Points are given once the friend's first order is delivered.
create table referrals (
  id                   bigint generated always as identity primary key,
  referrer_id          bigint not null references customers (id) on delete cascade,
  referred_customer_id bigint not null unique references customers (id) on delete cascade,
  first_order_id       bigint references orders (id) on delete set null,
  status               text not null default 'pending' check (status in ('pending', 'rewarded', 'void')),
  rewarded_at          timestamptz,
  created_at           timestamptz not null default now(),
  check (referrer_id <> referred_customer_id)
);
create index referrals_referrer on referrals (referrer_id);

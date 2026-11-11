-- 0004 Customers: accounts, sign-in, addresses, saved cards, wishlists, notifications.

create table customers (
  id                   bigint generated always as identity primary key,
  email                citext not null unique,
  email_verified_at    timestamptz,
  -- scrypt hash; empty for accounts that only sign in with Google or Apple.
  password_hash        text,
  first_name           text not null default '',
  last_name            text not null default '',
  phone                text,
  country              text check (country ~ '^[A-Z]{2}$'),
  preferred_currency   text references currencies (code),
  marketing_consent    boolean not null default false,
  marketing_consent_at timestamptz,
  -- Month and day are used for the birthday bonus.
  birthday             date,
  loyalty_points       integer not null default 0 check (loyalty_points >= 0),
  loyalty_tier         text not null default 'bronze',
  referral_code        citext unique,
  internal_note        text not null default '',
  status               text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  last_sign_in_at      timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((status = 'deleted') = (deleted_at is not null))
);
create index customers_name_trgm on customers using gin ((first_name || ' ' || last_name) gin_trgm_ops);
create index customers_created on customers (created_at desc);
create trigger customers_updated before update on customers for each row execute function set_updated_at();

-- Sign-in with Google or Apple: the provider's own id for the person.
create table customer_identities (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references customers (id) on delete cascade,
  provider    text not null check (provider in ('google', 'apple')),
  subject     text not null,
  email       citext,
  created_at  timestamptz not null default now(),
  unique (provider, subject),
  unique (customer_id, provider)
);

create table customer_sessions (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references customers (id) on delete cascade,
  token_hash   bytea not null unique,
  client       text not null default 'web' check (client in ('web', 'app')),
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index customer_sessions_customer on customer_sessions (customer_id);

-- One-time codes and links: verify email, reset password, change email.
create table customer_tokens (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references customers (id) on delete cascade,
  purpose     text not null check (purpose in ('verify_email', 'reset_password', 'change_email')),
  token_hash  bytea not null unique,
  new_email   citext,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  check ((purpose = 'change_email') = (new_email is not null))
);
create index customer_tokens_customer on customer_tokens (customer_id, purpose);

create table addresses (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references customers (id) on delete cascade,
  label       text,
  full_name   text not null,
  phone       text not null,
  line1       text not null,
  line2       text,
  city        text not null,
  region      text,
  postal_code text,
  country     text not null check (country ~ '^[A-Z]{2}$'),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index addresses_customer on addresses (customer_id);
create unique index addresses_one_default on addresses (customer_id) where is_default;
create trigger addresses_updated before update on addresses for each row execute function set_updated_at();

-- Saved cards. Only the provider's reference and the last four digits are
-- kept; card numbers never reach this database.
create table payment_methods (
  id                    bigint generated always as identity primary key,
  customer_id           bigint not null references customers (id) on delete cascade,
  provider              text not null check (provider in ('paystack', 'stripe')),
  provider_customer_ref text,
  provider_method_ref   text not null,
  brand                 text,
  last4                 text check (last4 ~ '^[0-9]{4}$'),
  exp_month             smallint check (exp_month between 1 and 12),
  exp_year              smallint check (exp_year between 2000 and 2100),
  is_default            boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (provider, provider_method_ref)
);
create index payment_methods_customer on payment_methods (customer_id);
create unique index payment_methods_one_default on payment_methods (customer_id) where is_default;

create table wishlist_items (
  customer_id bigint not null references customers (id) on delete cascade,
  product_id  bigint not null references products (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, product_id)
);
create index wishlist_items_product on wishlist_items (product_id);

-- Phones that can receive push notifications.
create table push_devices (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references customers (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  token        text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_devices_customer on push_devices (customer_id);

create table notification_preferences (
  customer_id         bigint primary key references customers (id) on delete cascade,
  orders_email        boolean not null default true,
  orders_whatsapp     boolean not null default false,
  orders_push         boolean not null default true,
  offers_email        boolean not null default false,
  offers_whatsapp     boolean not null default false,
  offers_push         boolean not null default false,
  back_in_stock_email boolean not null default true,
  back_in_stock_push  boolean not null default true,
  updated_at          timestamptz not null default now()
);
create trigger notification_preferences_updated before update on notification_preferences for each row execute function set_updated_at();

-- The notifications list in the app and the account area.
create table notifications (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references customers (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null default '',
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_customer on notifications (customer_id, created_at desc);

create table back_in_stock_requests (
  id          bigint generated always as identity primary key,
  variant_id  bigint not null references variants (id) on delete cascade,
  customer_id bigint references customers (id) on delete cascade,
  email       citext not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (variant_id, email)
);

create table newsletter_subscribers (
  id              bigint generated always as identity primary key,
  email           citext not null unique,
  customer_id     bigint references customers (id) on delete set null,
  source          text,
  subscribed_at   timestamptz not null default now(),
  unsubscribed_at timestamptz
);

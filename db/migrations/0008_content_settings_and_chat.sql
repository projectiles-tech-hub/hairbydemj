-- 0008 Store settings, shipping settings, content, homepage and live chat.

-- Settings that are a handful of values rather than rows: store details,
-- loyalty rules, return window, staff alerts and the like. One key per group.
create table store_settings (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value      jsonb not null,
  updated_by bigint references staff (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger store_settings_updated before update on store_settings for each row execute function set_updated_at();

-- Carrier settings staff can change. Carrier passwords and keys are NOT
-- stored here; they live in the server's environment settings.
create table carriers (
  code       text primary key check (code in ('dhl', 'ups', 'fedex')),
  name       text not null,
  enabled    boolean not null default false,
  services   jsonb not null default '[]',
  -- Added on top of the carrier's rate, in hundredths of a percent.
  markup_bps integer not null default 0 check (markup_bps between 0 and 10000),
  updated_at timestamptz not null default now()
);
create trigger carriers_updated before update on carriers for each row execute function set_updated_at();
insert into carriers (code, name) values ('dhl', 'DHL Express'), ('ups', 'UPS'), ('fedex', 'FedEx');

-- Delivery inside Nigeria: prices set by staff, by zone.
create table local_shipping_rates (
  id            bigint generated always as identity primary key,
  zone_name     text not null unique,
  -- State names the zone covers; empty means "everywhere not listed in another zone".
  states        text[] not null default '{}',
  courier       text not null,
  price_minor   bigint not null check (price_minor >= 0),
  delivery_time text not null,
  position      integer not null default 0,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now()
);
create trigger local_shipping_rates_updated before update on local_shipping_rates for each row execute function set_updated_at();

-- The emails and messages customers receive, and where each is sent.
create table message_templates (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name             text not null,
  subject          text not null default '',
  body             text not null default '',
  email_enabled    boolean not null default true,
  -- Empty means the message cannot be sent that way.
  whatsapp_enabled boolean,
  push_enabled     boolean,
  updated_at       timestamptz not null default now()
);
create trigger message_templates_updated before update on message_templates for each row execute function set_updated_at();

create table content_pages (
  id                 bigint generated always as identity primary key,
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title              text not null,
  kind               text not null default 'information' check (kind in ('information', 'policy', 'legal', 'guide', 'faq')),
  body               text not null default '',
  search_description text,
  status             text not null default 'draft' check (status in ('draft', 'published')),
  published_at       timestamptz,
  updated_by         bigint references staff (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger content_pages_updated before update on content_pages for each row execute function set_updated_at();

create table homepage_sections (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('hero', 'collections', 'best_sellers', 'new_arrivals', 'shop_the_look', 'reviews')),
  position   integer not null default 0,
  is_shown   boolean not null default true,
  -- Headline, sentence, button, image paths and so on, depending on the kind.
  settings   jsonb not null default '{}',
  show_from  timestamptz,
  show_until timestamptz,
  -- Two-letter country codes; empty means every country.
  countries  text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (show_until is null or show_from is null or show_until > show_from)
);
create index homepage_sections_order on homepage_sections (position);
create trigger homepage_sections_updated before update on homepage_sections for each row execute function set_updated_at();

create table chat_conversations (
  id                 bigint generated always as identity primary key,
  customer_id        bigint references customers (id) on delete set null,
  -- For a visitor who is not signed in.
  visitor_token_hash bytea unique,
  visitor_name       text,
  status             text not null default 'open' check (status in ('open', 'closed')),
  assigned_staff_id  bigint references staff (id) on delete set null,
  order_id           bigint references orders (id) on delete set null,
  last_message_at    timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  closed_at          timestamptz
);
create index chat_conversations_open on chat_conversations (last_message_at desc) where status = 'open';
create index chat_conversations_customer on chat_conversations (customer_id);

create table chat_messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references chat_conversations (id) on delete cascade,
  sender          text not null check (sender in ('customer', 'staff', 'system')),
  staff_id        bigint references staff (id) on delete set null,
  body            text not null check (length(body) > 0),
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  check ((sender = 'staff') or staff_id is null)
);
create index chat_messages_conversation on chat_messages (conversation_id, created_at);

create table saved_replies (
  id       bigint generated always as identity primary key,
  title    text not null unique,
  body     text not null,
  position integer not null default 0
);

-- 0003 Catalogue: categories, collections, products, variants, prices, stock.

create table package_sizes (
  id                 bigint generated always as identity primary key,
  name               text not null unique,
  length_mm          integer not null check (length_mm > 0),
  width_mm           integer not null check (width_mm > 0),
  height_mm          integer not null check (height_mm > 0),
  empty_weight_grams integer not null check (empty_weight_grams >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger package_sizes_updated before update on package_sizes for each row execute function set_updated_at();

create table categories (
  id              bigint generated always as identity primary key,
  parent_id       bigint references categories (id) on delete restrict,
  name            text not null check (length(trim(name)) > 0),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description     text not null default '',
  position        integer not null default 0,
  show_in_menu    boolean not null default true,
  seo_title       text,
  seo_description text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index categories_parent on categories (parent_id, position);
create trigger categories_updated before update on categories for each row execute function set_updated_at();

-- A collection is either hand-picked or filled by rules (for example
-- "added in the last 30 days"). Shop-the-look sets are hand-picked collections.
create table collections (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  kind        text not null default 'manual' check (kind in ('manual', 'rules')),
  rules       jsonb not null default '[]',
  banner_path text,
  status      text not null default 'draft' check (status in ('draft', 'live')),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger collections_updated before update on collections for each row execute function set_updated_at();

create table products (
  id                  bigint generated always as identity primary key,
  name                text not null check (length(trim(name)) > 0),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description         text not null default '',
  care_guide          text not null default '',
  category_id         bigint references categories (id) on delete restrict,
  hair_origin         text,
  texture             text,
  grade               text,
  tags                text[] not null default '{}',
  status              text not null default 'draft' check (status in ('draft', 'published', 'scheduled', 'unpublished')),
  publish_at          timestamptz,
  is_final_sale       boolean not null default false,
  package_size_id     bigint references package_sizes (id) on delete set null,
  customs_description text,
  hs_code             text,
  seo_title           text,
  seo_description     text,
  -- Kept up to date by the database; used for full-text search.
  search              tsvector generated always as (
                        setweight(to_tsvector('english', name), 'A') ||
                        setweight(to_tsvector('english', coalesce(texture, '') || ' ' || coalesce(hair_origin, '') || ' ' || coalesce(grade, '')), 'B') ||
                        setweight(to_tsvector('english', description), 'C')
                      ) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status <> 'scheduled' or publish_at is not null)
);
create index products_category on products (category_id);
create index products_status on products (status, created_at desc);
create index products_search on products using gin (search);
create index products_name_trgm on products using gin (name gin_trgm_ops);
create index products_tags on products using gin (tags);
create trigger products_updated before update on products for each row execute function set_updated_at();

create table product_media (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products (id) on delete cascade,
  kind        text not null default 'image' check (kind in ('image', 'video')),
  path        text not null,
  alt         text not null default '',
  -- Set when a photo shows one colour, so picking that colour shows it.
  colour      text,
  width       integer check (width > 0),
  height      integer check (height > 0),
  duration_ms integer check (duration_ms > 0),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index product_media_product on product_media (product_id, position);

create table collection_products (
  collection_id bigint not null references collections (id) on delete cascade,
  product_id    bigint not null references products (id) on delete cascade,
  position      integer not null default 0,
  primary key (collection_id, product_id)
);
create index collection_products_product on collection_products (product_id);

-- One row for each thing that can be bought: a length, density and colour of a product.
create table variants (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references products (id) on delete cascade,
  sku             citext not null unique check (length(trim(sku)) > 0),
  length_inches   smallint check (length_inches > 0),
  density_percent smallint check (density_percent > 0),
  colour          text,
  lace_type       text,
  cap_size        text,
  -- Weight and size are needed to ask carriers for a delivery price.
  weight_grams    integer not null check (weight_grams > 0),
  length_mm       integer check (length_mm > 0),
  width_mm        integer check (width_mm > 0),
  height_mm       integer check (height_mm > 0),
  position        integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique nulls not distinct (product_id, length_inches, density_percent, colour, lace_type, cap_size)
);
create index variants_product on variants (product_id, position);
create trigger variants_updated before update on variants for each row execute function set_updated_at();

-- One price for each variant in each currency, set by staff.
create table prices (
  variant_id       bigint not null references variants (id) on delete cascade,
  currency         text not null references currencies (code),
  amount_minor     bigint not null check (amount_minor >= 0),
  -- A higher "was" price shown struck through, if any.
  compare_at_minor bigint check (compare_at_minor > amount_minor),
  -- True when the amount was converted from the base price, not typed by staff.
  is_converted     boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (variant_id, currency)
);
create trigger prices_updated before update on prices for each row execute function set_updated_at();

create table inventory (
  variant_id          bigint primary key references variants (id) on delete cascade,
  on_hand             integer not null default 0 check (on_hand >= 0),
  -- Held for orders that are placed but not yet shipped or paid.
  reserved            integer not null default 0 check (reserved >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  updated_at          timestamptz not null default now(),
  check (reserved <= on_hand)
);
create index inventory_low on inventory ((on_hand - reserved));
create trigger inventory_updated before update on inventory for each row execute function set_updated_at();

-- Every change to a stock level, so the numbers can always be explained.
create table stock_movements (
  id            bigint generated always as identity primary key,
  variant_id    bigint not null references variants (id) on delete cascade,
  change        integer not null check (change <> 0),
  on_hand_after integer not null check (on_hand_after >= 0),
  reason        text not null check (reason in ('sale', 'return', 'received', 'damaged', 'correction', 'supplier_return', 'cancelled_order')),
  note          text,
  order_id      bigint,
  staff_id      bigint references staff (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index stock_movements_variant on stock_movements (variant_id, created_at desc);

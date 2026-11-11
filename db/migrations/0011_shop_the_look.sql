-- 0011 Shop-the-look sets. A set is a hand-picked collection marked as a
-- look; each product in it can name the exact variant that goes in the bag
-- when the customer adds the whole look.

alter table collections add column is_look boolean not null default false;
alter table collections add constraint collections_look_is_manual check (not is_look or kind = 'manual');
create index collections_looks on collections (position) where is_look;

alter table collection_products add column variant_id bigint references variants (id) on delete set null;
create index collection_products_variant on collection_products (variant_id);

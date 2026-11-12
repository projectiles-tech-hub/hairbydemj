-- 0019 Try-on: the wig pictures used by the camera try-on (module 16).
-- Each is a see-through PNG of a wig seen from the front, for one product
-- and optionally one colour. The two "temple" points say where the wearer's
-- temples sit on the picture, as fractions of its width and height, so the
-- try-on can place and size it on any face.

create table try_on_images (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products (id) on delete cascade,
  colour      text,
  path        text not null,
  width       integer not null check (width > 0),
  height      integer not null check (height > 0),
  left_x      numeric(5, 4) not null check (left_x between 0 and 1),
  left_y      numeric(5, 4) not null check (left_y between 0 and 1),
  right_x     numeric(5, 4) not null check (right_x between 0 and 1),
  right_y     numeric(5, 4) not null check (right_y between 0 and 1),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  check (left_x < right_x)
);
create index try_on_images_product on try_on_images (product_id, position);
create unique index try_on_images_product_colour on try_on_images (product_id, coalesce(lower(colour), ''));

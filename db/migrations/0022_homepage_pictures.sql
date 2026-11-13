-- Pictures for the homepage, categories and collections, and scheduled
-- promotional banners (added after module 21).
--
-- Homepage pictures are kept in each section's settings
-- ({"picture": {"path", "widths", "width", "height"}, "phonePicture": {...}, "alt"}),
-- like its words. A section can now be a "promo": a banner staff add as
-- many of as they like, each with its own dates (show_from, show_until)
-- and countries, which every section already has.

alter table homepage_sections drop constraint homepage_sections_kind_check;
alter table homepage_sections add constraint homepage_sections_kind_check
  check (kind in ('hero', 'collections', 'best_sellers', 'new_arrivals', 'shop_the_look', 'reviews', 'promo'));

-- A category's picture, shown on its card in "Shop by category".
alter table categories add column image_path text;
alter table categories add column image_widths integer[] not null default '{}';

-- A collection's banner (banner_path already exists): the sizes made of it.
alter table collections add column banner_widths integer[] not null default '{}';

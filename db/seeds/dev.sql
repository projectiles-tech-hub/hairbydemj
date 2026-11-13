-- Sample data for local development only. Loaded with: npm run db:seed
-- Names, prices and figures are examples, not the store's real ones.

insert into roles (name) values ('Manager'), ('Fulfilment'), ('Support');
insert into role_permissions (role_id, area, can_view, can_change)
select r.id, p.area, p.can_view, p.can_change
from roles r
join (values
  ('Manager', 'orders', true, true), ('Manager', 'returns', true, true), ('Manager', 'products', true, true), ('Manager', 'customers', true, true),
  ('Manager', 'discounts', true, true), ('Manager', 'settings', true, false), ('Manager', 'reports', true, false),
  ('Fulfilment', 'orders', true, true), ('Fulfilment', 'returns', true, true), ('Fulfilment', 'products', true, false), ('Fulfilment', 'customers', true, false),
  ('Support', 'orders', true, false), ('Support', 'returns', true, true), ('Support', 'customers', true, true)
) as p (role, area, can_view, can_change) on p.role = r.name;

-- Staff are created as invited, with no password: sign-in comes in a later module.
insert into staff (name, email, role_id)
select 'Sample Owner', 'owner@hairbydemj.test', id from roles where is_owner;

insert into loyalty_tiers (code, name, min_points, benefit, position) values
  ('gold', 'Gold', 1000, 'Early access to sales', 1),
  ('platinum', 'Platinum', 5000, 'Free express shipping', 2);

insert into package_sizes (name, length_mm, width_mm, height_mm, empty_weight_grams) values
  ('Small box', 200, 150, 80, 100),
  ('Medium box', 300, 220, 100, 200);

insert into local_shipping_rates (zone_name, states, courier, price_minor, delivery_time, position) values
  ('Benin City', '{Edo}', 'Dispatch rider', 250000, 'Same day', 0),
  ('Lagos, Abuja', '{Lagos,"Federal Capital Territory"}', 'Courier', 450000, '1 to 2 days', 1),
  ('Other states', '{}', 'Courier', 650000, '2 to 4 days', 2);

update currencies set rate_from_base = 0.00065, rate_updated_at = now() where code = 'USD';
update currencies set rate_from_base = 0.00051, rate_updated_at = now() where code = 'GBP';
update currencies set rate_from_base = 0.00060, rate_updated_at = now() where code = 'EUR';

insert into categories (name, slug, position) values
  ('Wigs', 'wigs', 0), ('Bundles', 'bundles', 1), ('Closures and frontals', 'closures-and-frontals', 2), ('Accessories', 'accessories', 3);
insert into categories (parent_id, name, slug, position)
select id, 'Lace front wigs', 'lace-front-wigs', 0 from categories where slug = 'wigs'
union all
select id, 'Full lace wigs', 'full-lace-wigs', 1 from categories where slug = 'wigs';

insert into collections (name, slug, kind, rules, status, position) values
  ('Best-sellers', 'best-sellers', 'rules', '[{"field": "sales", "condition": "top", "value": 20}]', 'live', 0),
  ('New arrivals', 'new-arrivals', 'rules', '[{"field": "date_added", "condition": "in_the_last_days", "value": 30}]', 'live', 1),
  ('Shop the look: Soft glam', 'shop-the-look-soft-glam', 'manual', '[]', 'live', 2);

insert into products (name, slug, description, care_guide, category_id, hair_origin, texture, grade, tags, status, package_size_id, customs_description, hs_code)
select p.name, p.slug, p.description, 'Wash gently with sulphate-free shampoo and let it air dry.', c.id, p.origin, p.texture, p.grade, p.tags, 'published', s.id, p.customs, p.hs
from (values
  ('Bone straight wig', 'bone-straight-wig', 'Sleek, pin-straight human hair wig with a natural hairline.', 'lace-front-wigs', 'Vietnamese', 'Straight', 'Double drawn', '{wig,straight}'::text[], 'Medium box', 'Human hair wig', '6704.20'),
  ('Deep wave frontal wig', 'deep-wave-frontal-wig', 'Defined deep waves on a 13x4 HD lace frontal.', 'lace-front-wigs', 'Cambodian', 'Deep wave', 'Single donor', '{wig,wavy}'::text[], 'Medium box', 'Human hair wig', '6704.20'),
  ('Body wave bundles', 'body-wave-bundles', 'Soft body wave bundles that hold a curl.', 'bundles', 'Vietnamese', 'Body wave', 'Double drawn', '{bundles}'::text[], 'Small box', 'Human hair bundles', '6703.00'),
  ('Kinky curly bundles', 'kinky-curly-bundles', 'Tight, springy curls with plenty of volume.', 'bundles', 'Peruvian', 'Kinky curly', 'Single donor', '{bundles,curly}'::text[], 'Small box', 'Human hair bundles', '6703.00'),
  ('HD lace closure 5x5', 'hd-lace-closure-5x5', 'Thin HD lace that melts into the skin.', 'closures-and-frontals', 'Vietnamese', 'Straight', 'Double drawn', '{closure}'::text[], 'Small box', 'Human hair closure', '6704.20'),
  ('Silk bonnet', 'silk-bonnet', 'Keeps your hair smooth while you sleep.', 'accessories', null, null, null, '{accessory}'::text[], 'Small box', 'Silk bonnet', '6505.00')
) as p (name, slug, description, category, origin, texture, grade, tags, package, customs, hs)
join categories c on c.slug = p.category
join package_sizes s on s.name = p.package;

-- Variants: three lengths of each hair product, one bonnet.
insert into variants (product_id, sku, length_inches, density_percent, colour, lace_type, weight_grams, position)
select p.id, upper(left(replace(p.slug, '-', ''), 6)) || '-' || l.len || '-' || d.density || '-NB', l.len, d.density, 'Natural black',
       case when p.slug like '%wig%' or p.slug like '%closure%' then 'HD lace' end, 180 + l.len * 6, l.pos
from products p
cross join (values (18, 0), (22, 1), (26, 2)) as l (len, pos)
cross join (values (180)) as d (density)
where p.slug <> 'silk-bonnet';
insert into variants (product_id, sku, colour, weight_grams)
select id, 'ACC-BONNET-BLK', 'Black', 60 from products where slug = 'silk-bonnet';

-- Prices in naira (kobo); other currencies converted and rounded as the settings say.
insert into prices (variant_id, currency, amount_minor)
select v.id, 'NGN', case when p.slug = 'silk-bonnet' then 1850000 else (120000 + coalesce(v.length_inches, 0) * 7500)::bigint * 100 end
from variants v join products p on p.id = v.product_id;
insert into prices (variant_id, currency, amount_minor, is_converted)
select pr.variant_id, c.code, greatest(c.rounding_minor, round(pr.amount_minor * c.rate_from_base / c.rounding_minor) * c.rounding_minor)::bigint, true
from prices pr cross join currencies c
where pr.currency = 'NGN' and not c.is_base;

insert into inventory (variant_id, on_hand, low_stock_threshold)
select id, (id % 7) * 3, 3 from variants;
insert into stock_movements (variant_id, change, on_hand_after, reason, note)
select variant_id, on_hand, on_hand, 'received', 'Opening stock (sample data)' from inventory where on_hand > 0;

insert into collection_products (collection_id, product_id, position)
select c.id, p.id, row_number() over (order by p.id)
from collections c cross join products p
where c.slug = 'shop-the-look-soft-glam' and p.slug in ('bone-straight-wig', 'hd-lace-closure-5x5', 'silk-bonnet');

insert into customers (email, email_verified_at, first_name, last_name, phone, country, preferred_currency, marketing_consent, referral_code)
values ('customer@example.com', now(), 'Sample', 'Customer', '+2340000000000', 'NG', 'NGN', false, 'SAMPLE10');
insert into notification_preferences (customer_id) select id from customers;
insert into addresses (customer_id, full_name, phone, line1, city, region, country, is_default)
select id, 'Sample Customer', '+2340000000000', '12 Sample Street', 'Lagos', 'Lagos', 'NG', true from customers;

insert into discounts (name, code, kind, percent_bps, per_customer_limit, status) values ('Welcome 10%', 'WELCOME10', 'percentage', 1000, 1, 'active');

insert into content_pages (slug, title, kind, body, status, published_at) values
  ('about', 'About', 'information', 'Sample text.', 'published', now()),
  ('shipping', 'Shipping and delivery', 'information', 'Sample text.', 'published', now()),
  ('returns', 'Returns and refunds', 'policy', 'Sample text.', 'published', now()),
  ('privacy', 'Privacy policy', 'legal', 'Sample text.', 'published', now()),
  ('faq', 'FAQ', 'faq', 'Sample text.', 'published', now());

insert into homepage_sections (kind, position, is_shown) values
  ('hero', 0, true), ('collections', 1, true), ('best_sellers', 2, true), ('new_arrivals', 3, true), ('shop_the_look', 4, true), ('reviews', 5, false);

insert into message_templates (key, name, whatsapp_enabled, push_enabled) values
  ('order_confirmed', 'Order confirmed', true, true),
  ('order_shipped', 'Order shipped', true, true),
  ('return_approved', 'Return approved', false, true),
  ('back_in_stock', 'Back in stock', false, true),
  ('verify_email', 'Verify your email', null, null);

insert into saved_replies (title, body, position) values
  ('Delivery times', 'Sample reply about delivery times.', 0),
  ('Returns', 'Sample reply about returns.', 1),
  ('Duties', 'Import duties and taxes are paid by the receiver on delivery.', 2);

insert into store_settings (key, value) values
  ('store', '{"name": "hairbydemj", "support_email": "hello@hairbydemj.test", "ships_from": "Benin City, Edo State, Nigeria"}'),
  ('returns', '{"window_days": 14, "store_credit_bonus_percent": 10}'),
  ('loyalty', '{"points_per_1000_ngn": 1, "review_with_photos": 100, "birthday_bonus": 200, "referral_friend": 500, "referral_referrer": 500, "minimum_to_redeem": 500, "max_percent_of_order": 50}'),
  ('payments', '{"save_cards": true, "hold_stock_minutes": 30}');

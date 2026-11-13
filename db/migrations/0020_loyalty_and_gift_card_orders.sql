-- 0020 Loyalty points on orders, and gift cards bought in the shop (module 17).

-- When an order's points were last worked out (on delivery, and again after
-- a refund), so the worker looks at each order only when something changed.
alter table orders add column points_settled_at timestamptz;
create index orders_points_unsettled on orders (id) where points_settled_at is null and customer_id is not null and status in ('delivered', 'returned');

-- A bought gift card is made when the order is placed (status pending) and
-- given its code when the payment is confirmed; the code is emailed to the
-- recipient at deliver_at.
create index order_items_gift_card on order_items (gift_card_id) where gift_card_id is not null;

-- Photos on reviews are files under MEDIA_DIR; their sizes are kept like product photos.
alter table review_media add column widths integer[] not null default '{}';

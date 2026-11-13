-- 0016 Orders and returns: when an order's stock left the shelf, guest order
-- look-ups limited like sign-ins, and store credit given for a return.

-- Set once, when the order's items are taken off what is on hand (at dispatch).
alter table orders add column stock_shipped_at timestamptz;

-- The gift card a return was refunded onto, when the customer chose store credit.
alter table returns add column store_credit_gift_card_id bigint references gift_cards (id) on delete set null;
create index returns_store_credit on returns (store_credit_gift_card_id);

-- Guests look up an order by its number and email; guessing is limited.
alter table sign_in_attempts drop constraint sign_in_attempts_kind_check;
alter table sign_in_attempts add constraint sign_in_attempts_kind_check check (kind in ('customer', 'staff', 'staff_two_step', 'code', 'sign_up', 'gift_card', 'order_lookup'));

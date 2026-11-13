-- 0013 Cart: gift cards applied to a cart, where each currency's rate comes
-- from, and guessing protection for gift card codes.

create table cart_gift_cards (
  cart_id      bigint not null references carts (id) on delete cascade,
  gift_card_id bigint not null references gift_cards (id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (cart_id, gift_card_id)
);
create index cart_gift_cards_card on cart_gift_cards (gift_card_id);

-- "daily": the rate is fetched each day; "manual": staff type it and it stays.
alter table currencies add column rate_source text not null default 'daily' check (rate_source in ('daily', 'manual'));
update currencies set rate_source = 'manual' where is_base;

-- Gift card codes are guessed like passwords, so they are limited the same way.
alter table sign_in_attempts drop constraint sign_in_attempts_kind_check;
alter table sign_in_attempts add constraint sign_in_attempts_kind_check check (kind in ('customer', 'staff', 'staff_two_step', 'code', 'sign_up', 'gift_card'));

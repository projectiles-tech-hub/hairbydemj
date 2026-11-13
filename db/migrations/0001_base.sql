-- 0001 Base: extensions, shared helpers and the four currencies.

-- Typo-tolerant search (trigram) and case-insensitive text for emails and codes.
create extension if not exists pg_trgm;
create extension if not exists citext;

-- Keeps updated_at current on every change to a row.
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Currencies the store sells in. Money everywhere else is stored as whole
-- minor units (kobo, cents, pence) next to one of these codes.
create table currencies (
  code            text primary key check (code ~ '^[A-Z]{3}$'),
  name            text not null,
  symbol          text not null,
  minor_units     smallint not null default 2 check (minor_units between 0 and 3),
  provider        text not null check (provider in ('paystack', 'stripe')),
  is_base         boolean not null default false,
  shown_to        text not null default '',
  -- How many units of this currency one unit of the base currency buys.
  rate_from_base  numeric(18, 8) check (rate_from_base > 0),
  rate_updated_at timestamptz,
  -- Added on top of the daily rate, in hundredths of a percent (100 = 1%).
  rate_markup_bps integer not null default 0 check (rate_markup_bps between 0 and 5000),
  -- Converted prices are rounded to the nearest multiple of this many minor units.
  rounding_minor  bigint not null default 1 check (rounding_minor > 0),
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now()
);
create unique index currencies_one_base on currencies (is_base) where is_base;
create trigger currencies_updated before update on currencies for each row execute function set_updated_at();

insert into currencies (code, name, symbol, provider, is_base, shown_to, rate_from_base, rounding_minor) values
  ('NGN', 'Nigerian naira', '₦', 'paystack', true,  'Nigeria', 1, 50000),
  ('USD', 'US dollar',      '$', 'stripe',   false, 'United States and rest of world', null, 100),
  ('GBP', 'Pound sterling', '£', 'stripe',   false, 'United Kingdom', null, 100),
  ('EUR', 'Euro',           '€', 'stripe',   false, 'Eurozone', null, 100);

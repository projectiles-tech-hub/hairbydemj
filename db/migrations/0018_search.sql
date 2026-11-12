-- 0018 Search: the words the shop knows (for correcting typing mistakes and
-- finishing words as they are typed), and a record of what customers search
-- for, so staff can see what people want and what finds nothing.

create table search_words (
  word text primary key
);
create index search_words_trgm on search_words using gin (word gin_trgm_ops);

-- Rebuilt whenever products, categories or variants change. The catalogue is
-- small (hundreds to a few thousand products), so a full rebuild is quick.
create function rebuild_search_words() returns void language plpgsql as $$
begin
  delete from search_words;
  insert into search_words (word)
  select distinct w from (
    select regexp_split_to_table(lower(coalesce(name, '') || ' ' || coalesce(texture, '') || ' ' || coalesce(hair_origin, '') || ' ' || coalesce(grade, '') || ' ' || array_to_string(tags, ' ')), '[^a-z0-9]+') as w
      from products where status in ('published', 'scheduled')
    union all
    select regexp_split_to_table(lower(name), '[^a-z0-9]+') from categories
    union all
    select regexp_split_to_table(lower(coalesce(colour, '') || ' ' || coalesce(lace_type, '')), '[^a-z0-9]+') from variants where is_active
  ) t
  where length(w) >= 3 and w !~ '^[0-9]+$';
end $$;

create function search_words_changed() returns trigger language plpgsql as $$
begin
  perform rebuild_search_words();
  return null;
end $$;

create trigger products_search_words after insert or update or delete or truncate on products for each statement execute function search_words_changed();
create trigger categories_search_words after insert or update or delete or truncate on categories for each statement execute function search_words_changed();
create trigger variants_search_words after insert or update or delete or truncate on variants for each statement execute function search_words_changed();

select rebuild_search_words();

create table search_queries (
  id         bigint generated always as identity primary key,
  -- Lower-case, spaces squeezed, at most 100 characters. Never linked to a person.
  query      text not null,
  results    integer not null check (results >= 0),
  corrected  text,
  created_at timestamptz not null default now()
);
create index search_queries_created on search_queries (created_at);

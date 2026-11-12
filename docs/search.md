# Search

Product search uses PostgreSQL only: no search service. The code is in
`server/search/`; the shop's product list (`catalogue.md`) takes the search
words, so search shares every filter, sort and page of the category pages.

## For the website and app

| Address | What it does |
| --- | --- |
| `GET /api/catalog/products?q=...` (app: `/v1/catalog/products?q=...`) | Products for the words typed, best match first. Every filter of the category pages works with it (`category`, `texture`, `colour`, `length`, `min_price`, `in_stock` and the rest), as do `sort` (any, or `relevance`) and `cursor` pages. The answer carries `search: { query, corrected, broadened }`. |
| `GET /api/catalog/search/suggest?q=...&currency=` | While typing: up to 5 words to finish the last word, up to 3 categories and up to 5 products with picture and price. Kept by browsers for a minute. |

Show `corrected` as "Showing results for ..." and `broadened` as "No product
has all those words; showing products with any of them".

## How it finds products

1. **Tidied:** lower case, single spaces, at most 100 characters and 8 words.
2. **Lengths understood:** "22 inch", "22in", `22"` and a bare number from 6
   to 40 next to other words ("bob 12") become a length: only products sold
   in that length are shown.
3. **Typing mistakes corrected:** each word not known to the shop is
   replaced by the most alike known word (trigram similarity of at least
   0.3): "strait" becomes "straight", "boddy" becomes "body", "kinki curli"
   becomes "kinky curly". The known words come from published product
   names, textures, origins, grades and tags, category names, and variant
   colours and lace types (`search_words`, rebuilt by the database whenever
   these change). Small everyday words ("for", "with") are dropped, never
   corrected.
4. **The last word is finished as it is typed:** "bon" finds "bone".
5. **Matched** against everything a product can be found by: its name
   (strongest), texture, origin and grade, its description, its category,
   tags, and the colours and lace types of its variants. An exact SKU also
   finds its product.
6. **All words first; if nothing has them all, any of them** (and the answer
   says so).
7. **Ranked** by full-text rank, plus how alike the product name is to what
   was typed, with a lift for an exact name or SKU.

The database's full-text index (`products_search`) and trigram indexes
(`products_name_trgm`, `search_words_trgm`) keep this quick for a catalogue
of this size (hundreds to a few thousand products).

## For staff

`GET /api/search/report?days=30` (reports view): the most searched words with
how many products they found, and the searches that found nothing, which
show what customers want that the shop does not have (or calls something
else). Searches are recorded without anything about who searched (the first
page only) and removed after 180 days by the daily cleanup.

## Tests

`server/search/search.test.ts`: the known words staying up to date, typing
mistakes, everyday words, lengths, half-typed words, categories, colours,
tags, SKUs, drafts never found, "any word" when no product has all, shared
filters, sorting and pages, suggestions, and the staff report.

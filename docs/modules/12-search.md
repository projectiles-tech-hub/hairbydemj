# Module 12 — Search

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Fast, typo-tolerant product search using PostgreSQL only.

## Steps

- [x] Full-text search indexes on products
- [x] Trigram matching for typos
- [x] Search suggestions
- [x] Filters shared with category pages
- [x] Ranking tuning
- [x] Tests

## Done when

Searches with common typos return the right products quickly.

## Notes

- Guide: [`../search.md`](../search.md). Code: `server/search/`, and the
  `q` and `relevance` additions to `server/catalog/public.ts`. Migration
  `0018_search`.

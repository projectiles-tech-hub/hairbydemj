# Module 4 — Catalog

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

Products, variants, hair attributes, categories and collections, managed
through the API.

## Steps

- [x] Products with hair attributes (origin, texture, grade)
- [x] Variants (length, density, colour, lace type, cap size, SKU, weight, dimensions)
- [x] Inventory per variant with low-stock threshold
- [x] Categories and collections (including rule-based collections)
- [x] Shop-the-look sets
- [x] API routes to list, filter, view and manage catalog data
- [x] Tests

## Done when

Staff can create and manage the full catalog through the API, and customers can
browse and filter it.

## Notes

- Guide: [`../catalogue.md`](../catalogue.md) (addresses, filters, rules).
- No package added.
- Migration `0011_shop_the_look.sql`: marks a collection as a look and lets
  each piece name its exact variant.
- Built on top of modules 2 and 3; pull requests #11 and #12 go first.
- Product photos are module 5; shop search with typing mistakes is module 12.

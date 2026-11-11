# Module 2 — Database

**Status:** In review (pull request open; the owner's merge is the approval)

## Goal

PostgreSQL schema for the whole store, managed through numbered SQL migrations.

## Steps

- [x] Connect to PostgreSQL with the pg driver
- [x] Our own migration runner for numbered SQL files in db/migrations/
- [x] Tables for every entity in docs/spec/data-model.md
- [x] Indexes, constraints, and the trigram extension for search
- [x] Seed data for local development
- [x] Tests for the migration runner

## Done when

A fresh database can be built from the migrations alone, and the schema covers
the data model.

## Notes

- Packages added: `pg` (the PostgreSQL driver named in the build plan) and
  `@types/pg` (type definitions for the compiler, development-only).
- 9 migrations, 63 tables. Full list, rules and set-up steps:
  [`../database.md`](../database.md).
- The migration runner is `server/db/migrate.ts`; the commands are
  `npm run db:migrate`, `db:status` and `db:seed`.
- Tests run against a real PostgreSQL 16. Each run makes a throwaway
  database. GitHub Actions starts PostgreSQL for the checks.
- New setting: `DATABASE_URL` (secret, required in production). See
  `.env.example`.
- The server does not open a database connection yet; the first module that
  reads data (module 3) will.
- Choices to confirm are listed at the end of `docs/database.md`.

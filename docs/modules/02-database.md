# Module 2 — Database

**Status:** Not started

## Goal

PostgreSQL schema for the whole store, managed through numbered SQL migrations.

## Steps

- [ ] Connect to PostgreSQL with the pg driver
- [ ] Our own migration runner for numbered SQL files in db/migrations/
- [ ] Tables for every entity in docs/spec/data-model.md
- [ ] Indexes, constraints, and the trigram extension for search
- [ ] Seed data for local development
- [ ] Tests for the migration runner

## Done when

A fresh database can be built from the migrations alone, and the schema covers
the data model.

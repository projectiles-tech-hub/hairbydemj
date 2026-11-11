# db/migrations/

Numbered SQL migration files (for example `0003_catalogue.sql`), applied in
order by our own migration runner (`server/db/migrate.ts`).

Rules:

- Names are four digits, an underscore, lower-case words, `.sql`.
- Numbers run 0001, 0002, 0003 with no gaps.
- A migration that has been applied anywhere is never edited. To change the
  database, add a new file with the next number.

How to run them: see `docs/database.md`.

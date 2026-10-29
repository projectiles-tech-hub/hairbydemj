# Conventions

- **Language:** TypeScript for the server, worker, admin and browser scripts; Dart for the Flutter app; SQL for the database.
- **No frameworks** in server, website or admin code (see `docs/decisions/0001-no-frameworks.md`).
- **Database changes** only through numbered SQL migration files in `db/migrations/`.
- **Secrets** never in code; read from environment settings.
- **Money** stored as whole minor units (kobo, cents, pence) with the currency code, never as decimals.
- **Branches:** `main` (live), `develop` (staging), `feature/<name>` for each piece of work.
- **Commits:** clear, present-tense messages describing what changed.
- **Documentation:** update the module file, STATUS.md, TASKS.md, the session log and CHANGELOG.md at the end of every session.

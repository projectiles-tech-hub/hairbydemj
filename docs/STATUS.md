# Status

**Last updated:** 2026-11-11

## Where we are

- Module 0 (Repo setup) is complete and approved.
- Module 1 (Server foundation) is complete: pull request #1 approved by the
  owner, merged by the owner. All 26 tests pass.
- Owner decided on 2026-10-29 to finish the design modules D1 to D5 before
  continuing with the backend modules (Module 2 onward).
- Module D1 (Brand and design system) is complete: pull request #2 merged by
  the owner on 2026-11-10.
- Module D2 (Journeys and wireframes) is complete: 20 journeys and 178
  wireframe frames in Figma, built from a component kit, website drawn at
  phone, tablet and desktop widths. Pull request #4 merged by the owner on
  2026-11-11.
- Modules D3 (website pages), D4 (app screens) and D5 (admin pages) are
  complete: built in Figma, pull requests #6, #7 and #8 merged by the owner
  on 2026-11-11.
- Owner decided on 2026-11-11 to put the designs online before the backend,
  so the person the store is for can look at them
  (`decisions/0005-design-preview-before-backend.md`).
- Design preview is live at https://hairbydemj.vercel.app/ : 37 website
  pages as coded pages (pull request #9 merged), 52 app screens as pictures.
- Admin preview: 23 admin pages, 3 dialogs and 3 list states as coded pages
  under `/admin/` (pull request #10 merged).
- Owner instructed on 2026-11-11 to start the backend.

## Current module

[`modules/02-database.md`](modules/02-database.md): built and **in review**
on branch `feature/database`. 9 migrations, 63 tables, migration runner,
sample data, tests against PostgreSQL 16.

## Exact next step

1. Owner reviews and merges the Module 2 pull request, and looks at the
   "Choices made here, to confirm" table in [`database.md`](database.md).
2. Then **Module 3** in [`modules/`](modules/), confirmed with the owner
   before starting.

## Waiting on the owner

- Photographs, and real figures for the placeholders listed under "Sample
  values to confirm" in
  [`design/journeys-and-wireframes.md`](design/journeys-and-wireframes.md).
- See also the "Blocked / waiting on owner" section of [`TASKS.md`](TASKS.md).

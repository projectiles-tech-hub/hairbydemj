# 0005. Design preview before the backend

**Date:** 2026-11-11 · **Status:** Accepted (owner's decision)

## Decision

Before backend Module 2 starts, the designs are put online as a preview so
that the owner and the person the store is being built for can look at them
and give the final approval.

- The **website** pages are built as real coded pages (plain HTML, CSS and
  TypeScript, no framework) with sample products, prices and photo
  placeholders. Nothing can be bought.
- The **app** and **admin** designs are shown on the same preview as pictures
  exported from the Figma file.
- The preview is hosted on **Vercel's free plan**. This is for the preview
  only. The real store stays on the Namecheap Quasar VPS (decision 0003).

## What this changes

- Rule 7 in `CLAUDE.md` says modules are built in order and frontend modules
  only from approved designs. By the owner's instruction, the website page
  code (part of Module 13) is written early, from designs that are still in
  review, because the preview is how they will be approved.
- No money is spent, so decision 0004 (no paid services) holds.

## Consequences

- If the designs change after review, the coded pages change with them.
- The coded pages become the starting point for Module 13. They are not yet
  connected to the server's routes or to any real data.
- Vercel's free plan is meant for personal, non-commercial use, and it only
  deploys from a GitHub organisation's repository while that repository is
  public. A design preview that sells nothing fits today. If the repository
  is made private, or Vercel objects, the same `preview-dist/` folder can be
  hosted on any free static host instead.

How to build and publish the preview: [`../preview.md`](../preview.md).

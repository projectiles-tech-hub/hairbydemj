# Admin designs (module D5)

**Status:** In review. Built in Figma on 2026-11-11, awaiting the owner's
approval. Figma page: [Admin](https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N?node-id=55-13678).

## What is there

All 23 admin pages at 1440 px wide. Each page's link is in
[pages.md](pages.md).

## How they were made

- Each page starts from the wireframe approved in D2.
- Same design system as the website and app: 242 component instances, every
  colour from the tokens, every text from a text style, no wireframe parts
  left (checked by script).
- Built to be worked in all day: flat panels with a thin outline, no shadows;
  tables are rules and alignment with no striped rows or filled header bands;
  figures are set as plain type, not decorated tiles; gold is kept for the
  one main action on a page and for money.
- Shell: sidebar with the 23 pages in six groups (current page on a raised
  row), and a top bar with search, alerts and the signed-in staff member.

## Checked

- Contrast: every text pairing passes WCAG 2.1 AA (1,528 text layers).
- Nothing is set below 14 px.

## Needs the owner

- Sample content: order numbers, names, amounts, role names and settings are
  samples, not decisions.

## Not yet drawn

- Charts are placeholders (sales by day on Dashboard and Reports).
- Dialogs (confirm refund, adjust stock, invite staff), empty states and
  loading states.
- The admin is desktop only; no tablet or phone layouts.

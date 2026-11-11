# Website designs (module D3)

**Status:** Approved. Built in Figma on 2026-11-11; pull request #6 merged by
the owner on 2026-11-11. Figma page: [Website](https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N?node-id=55-8309).

## What is there

112 frames: all 37 website pages at desktop 1280, tablet 768 and phone 390,
plus the endless scrolling states board. Each page's three links are in
[pages.md](pages.md).

## How they were made

- Each design starts from the wireframe the owner approved in D2, so layout,
  content and responsive behaviour are unchanged.
- Every wireframe part was swapped for its design system component, and every
  colour, text size and corner was set from the D1 tokens and text styles.
  Checked by script: 1,175 component instances, no colour outside the tokens,
  no text without a text style, no wireframe parts left.
- Direction: one dark field from top to bottom (noir), with photographs and
  gold as the lit things on it. Cormorant Garamond for headings from 22 px,
  Source Sans 3 for everything else, prices in light gold.
- The home page opens with one large campaign photograph with the headline
  set over its lower edge; on phones the headline sits under the photograph.

## Checked

- Contrast: every text pairing passes WCAG 2.1 AA (checked by script on all
  4,849 text layers).
- Nothing is set below 14 px.
- Buttons and fields are 48 px or taller; chips are 40 px with 8 px gaps.

## Needs the owner

- **Photographs.** Every photo is a labelled placeholder. Product photos, one
  campaign photo for the home page, look photos and the brand photos for
  About are needed.
- **Sample content.** Product names, prices, the home headline and all other
  wording are samples so the pages read as real. They are not decisions.
- **Sample values** listed in journeys-and-wireframes.md still apply.

## Panels, menus and notices (added 2026-11-11)

Figma section "Website: panels, menus and notices", 10 frames: mini-cart
(desktop and phone), phone menu, filter panel (phone slide-up and tablet side
panel), sort sheet, cookie notice and cookie choices, live chat (desktop, with
the floating chat, WhatsApp and back-to-top buttons, and phone).

The Website page now holds 122 frames. Re-checked by script: contrast, 14 px
minimum, tokens and text styles all pass.

## Not drawn page by page

Hover, focus and pressed states are defined on the components (Button, Form
field, Chip), not repeated on every page.

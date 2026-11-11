# App designs (module D4)

**Status:** In review. Built in Figma on 2026-11-11, awaiting the owner's
approval. Figma page: [App](https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N?node-id=55-12564).

## What is there

43 screens at 390 px wide, for iOS and Android: the 21 journey screens and
the 20 remaining screens from D2, plus the two endless scrolling states.
Each screen's link is in [pages.md](pages.md).

## How they were made

- Each screen starts from the wireframe approved in D2.
- Built from the same design system as the website: 360 component instances,
  every colour from the tokens, every text from a text style, no wireframe
  parts left (checked by script).
- Shell: status bar, a title bar with a back arrow and icon actions, and the
  five-tab bar (Home, Shop, Try on, Bag, Account). The home screen carries
  the wordmark.

## Checked

- Contrast: every text pairing passes WCAG 2.1 AA (740 text layers).
- Nothing is set below 14 px. Buttons and fields are 48 px or taller.

## Needs the owner

- Photographs and sample content, as for the website designs.

## Not yet drawn

- One design serves iOS and Android. Platform differences (system back
  gesture and button, share sheet, date pickers, Apple Pay and Google Pay
  buttons) follow each platform's own controls in Flutter and are not drawn
  twice.
- The notification and camera permission prompts, bottom sheets (sort,
  filters open state) and the three onboarding slides as separate frames.
- Tablet layouts for the app.

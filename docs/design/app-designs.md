# App designs (module D4)

**Status:** Approved. Built in Figma on 2026-11-11; pull request #7 merged by
the owner on 2026-11-11. Figma page: [App](https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N?node-id=55-12564).

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

## Added 2026-11-11

- Section "App: splash, onboarding, permissions and sheets", 9 frames:
  splash, onboarding slides 1 to 3, notifications (ask, system prompt),
  camera (ask, refused), and the sort sheet.
- Tablet layouts at 768 px, 44 frames in two sections. 30 screens share the
  layout of the matching tablet website page, with the app's status bar,
  title bar and tab bar. 14 app-only screens keep the phone layout in a
  centred 480 px column.

The App page now holds 96 frames. Re-checked by script: contrast, 14 px
minimum, tokens and text styles all pass.

## Not drawn twice

One design serves iOS and Android. The system prompts, back gesture, share
sheet, date pickers and the Apple Pay and Google Pay buttons are drawn by
each phone in its own style; Flutter uses the platform's own controls.

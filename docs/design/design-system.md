# Design system

**Status:** In progress (module D1, Brand and design system).

One design system is shared by the website, admin and app. Once approved, the
exact values below are what the code uses.

## Brand

- Brand assets supplied by owner: the logo artwork (HD monogram with a woman
  in profile, and the "hairbydemj" wordmark), received 2026-10-30.
- The logo is traced into vectors in Figma (Logo page). Colours are linked to
  the design system variables.

| Version | Use |
| --- | --- |
| Logo/Primary | Main logo: mark above the wordmark. On noir or deep espresso. |
| Logo/Mark | Monogram with the woman in profile. 120 px wide and above. |
| Logo/Monogram | HD letters only, for small sizes: app icon, browser tab, social profile picture. |
| Logo/Wordmark, Signature | Gold to ivory to blush gradient, as in the artwork. Dark backgrounds. |
| Logo/Wordmark, Gold or Ivory | Single colour on dark backgrounds. |
| Logo/Wordmark, Noir | Light backgrounds, print and stamps. |
| Logo/App icon | 1024 by 1024 master on noir, square corners (iOS and Android apply their own mask). |

- Clear space: at least the height of the letter "h" in the wordmark on every side.
- Small sizes: the monogram stays readable down to 32 px. At 16 px it does
  not; use the 32 px version for browser tabs.

## Colours

Adopted by the owner on 2026-11-02. Exact values sampled from the owner's
logo artwork.

| Token | Name | Hex | Taken from | Use |
| --- | --- | --- | --- | --- |
| `noir` | Noir | `#040204` | Logo background | Backgrounds, header, footer |
| `espresso` | Deep espresso | `#2F2119` | Hair silhouette | Dark panels and cards |
| `gold` | Rich gold | `#CFA262` | "HD" monogram and "hair" | Primary buttons, key accents |
| `gold-light` | Light gold | `#EAC27F` | Gold highlights | Highlights, badges |
| `gold-deep` | Deep gold | `#AB7A40` | Gold shadows | Hover and pressed states |
| `ivory` | Champagne ivory | `#E6D5BE` | "byde" in the wordmark | Text on dark, light sections |
| `blush` | Blush | `#DCB597` | "mj" in the wordmark | Soft accents, tags |
| `error` | Coral red | `#E5735F` | Added 2026-11-02 | Error messages and invalid field borders |

### Supporting colours (added 2026-11-11, module D3)

Solid colours for surfaces, lines and secondary text. They replace
see-through versions of ivory, blush and gold, which did not hold their
transparency inside component copies in Figma and would also be harder to
keep consistent in code.

| Token | Hex | Use |
| --- | --- | --- |
| `line` | `#4A3D33` | Dividers and card outlines. Decorative only. |
| `border-control` | `#80766A` | Borders of unselected chips, checkboxes and radios. 4.5:1 on noir, 3.4:1 on espresso. |
| `text-muted` | `#A79A8A` | Secondary text. 7.5:1 on noir, 5.7:1 on espresso. |
| `surface-photo` | `#221B19` | Behind photos while they load; loading placeholders. |
| `surface-raised` | `#41332A` | Selected row or item on an espresso panel. |
| `gold-soft` | `#312519` | Soft gold tint behind the active app tab icon. |

### Contrast (WCAG 2.1 AA)

All text pairings pass 4.5:1 and all control borders pass 3:1. Key ratios:
ivory on noir 14.40, ivory on espresso 10.81, gold on noir 8.86, noir on gold
8.86, gold on espresso 6.65, light gold on espresso 9.26, noir on blush 10.93,
coral red on noir 6.84, coral red on espresso 5.14. Deep gold is not used for
text on espresso (4.13:1). Errors always show a warning icon and a message as
well as the colour.

## Typography

Two families, both free (SIL Open Font Licence, Google Fonts):

- **Source Sans 3:** the main font. Body text, buttons, forms, labels,
  navigation and all prices. Weights 400, 500, 600 and 700.
- **Cormorant Garamond:** headings only, at 22 px and above. Chosen as the
  closest match to the wordmark in the owner's logo (open letters, fine
  thin-to-thick contrast, long "j"). Its fine strokes are hard to read when
  small, so it is never used below 22 px. Weights 300, 500 and 600.

Both fonts were tested and include the ₦, £, € and $ signs and the Yoruba
and Igbo letters (ẹ, ọ, ụ, ị, ṣ, ṅ with tone marks).

| Style | Font | Size / line height (px) | Weight |
| --- | --- | --- | --- |
| Display | Cormorant Garamond | 56 / 64 (40 / 48 on phones) | 300 |
| Heading 1 | Cormorant Garamond | 40 / 48 (32 / 40 on phones) | 500 |
| Heading 2 | Cormorant Garamond | 32 / 40 (28 / 36 on phones) | 500 |
| Heading 3 | Cormorant Garamond | 24 / 32 (22 / 30 on phones) | 600 |
| Body large | Source Sans 3 | 18 / 28 | 400 |
| Body | Source Sans 3 | 16 / 24 | 400 |
| Body strong | Source Sans 3 | 16 / 24 | 600 |
| Small | Source Sans 3 | 14 / 20 | 400 |
| Label (sentence case) | Source Sans 3 | 14 / 20 | 500 |
| Button | Source Sans 3 | 16 / 20 | 600 |
| Price | Source Sans 3 | 20 / 26 | 600 |

Nothing is set smaller than 14 px.

## Spacing and layout

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 96.
- Website content width: up to 1280 px.
- Grid: 4 columns on phones (up to 599 px), 8 on tablets (600 to 1023 px),
  12 on desktop (1024 px and up).
- Tap targets: at least 48 px high on phones.

## Corners

| Token | Value | Use |
| --- | --- | --- |
| `radius/control` | 8 px | Form fields |
| `radius/card` | 16 px | Cards |
| `radius/full` | Fully round | Buttons, tags and chips |

## Motion

Material Design 3 timings and easing. Motion answers what the shopper does
(opening the cart, adding an item, saving to the wishlist). Reduced-motion
settings are respected.

| Token | Value | Use |
| --- | --- | --- |
| `motion/duration-short` | 150 ms | Hovers, presses, small toggles |
| `motion/duration-medium` | 300 ms | Menus, cart drawer, expanding sections |
| `motion/duration-long` | 500 ms | Page transitions, large reveals |
| `motion/easing-standard` | cubic-bezier(0.2, 0, 0, 1) | Movement within the screen |
| `motion/easing-emphasized-decelerate` | cubic-bezier(0.05, 0.7, 0.1, 1) | Things entering the screen |
| `motion/easing-emphasized-accelerate` | cubic-bezier(0.3, 0, 0.8, 0.15) | Things leaving the screen |

## Icons

Phosphor Icons (MIT licence), Light weight, 24 px, in champagne ivory unless a
component sets another colour. The Fill weight is used for selected states
(for example a saved wishlist heart). Chosen after a side-by-side comparison
with Font Awesome and Lucide. Icons in the system: search, bag, heart, heart
filled, account, menu, close, chevrons, plus, minus, star, delivery, chat,
delete, check, try on, camera, filter, warning.

## Components

| Component | Variants and states | Notes |
| --- | --- | --- |
| Button | Primary, Secondary, Text; Default, Hover, Focused, Pressed, Disabled | Fully round, at least 48 px high. Focused shows a 2 px light-gold ring with a 2 px gap. Text buttons are underlined. Optional icon. |
| Tag | Gold, Blush, Outline | Sentence case, for example "Best-seller", "New", "Sale". |
| Form field | Default, Focused, Error, Disabled | Label above, input at least 48 px high, help text. Error shows a coral border, a warning icon and a message saying how to fix it. |
| Product card | One component | 4:5 photo, optional badge, 48 px wishlist button on an espresso circle, name, length and density, price in the customer's currency. |

### Shared components for pages and screens (added 2026-11-11, module D3)

On the Components page, section "Shared components for pages and screens".

| Component | Variants | Notes |
| --- | --- | --- |
| Chip | Selected: No, Yes | Filters and option pickers (length, density, colour). 40 px high. |
| Quantity stepper | One | Minus, number, plus. 48 px high. |
| Checkbox, Radio | Off, On | 24 px mark with its label. |
| Photo placeholder | One, resizable | Stands in for photos, video and charts until real ones are supplied. |
| Product card compact | One | For two-across phone grids and tight rows. |
| List loader | Loading, End, Error | Endless scrolling states. |
| Header | Desktop, Compact | Wordmark, navigation, search, currency, account, wishlist, bag with count. |
| Footer | Desktop, Compact | Monogram, link groups, newsletter sign-up. |
| App status bar, App tab bar | Tab bar: one per active tab | Five tabs: Home, Shop, Try on, Bag, Account. |
| Admin sidebar, Admin top bar | One each | The 23 admin pages in six groups; search, alerts, signed-in staff. |

20 more icons were added to the Icons page for the app tab bar, the account
area and the admin (home, shop, bell, card, location, package, gift,
settings, share, WhatsApp, lock, edit, arrow up, sign out, help, reports,
customers, discount, receipt, image). To be checked against the Phosphor
Light originals before the frontend is built.

## Figma

- Design file: [hairbydemj Design System](https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N)
- Pages: Foundations (colour, type, spacing, corners, layout, motion), Icons,
  Components, Logo, Journeys, Wireframes, Website, App, Admin.
- All values are Figma variables and text styles, so a change in one place
  updates every component.

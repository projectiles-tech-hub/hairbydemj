# Design preview

A preview of the designs that anyone with the link can open on a phone,
tablet or computer. Why it exists: [`decisions/0005-design-preview-before-backend.md`](decisions/0005-design-preview-before-backend.md).

## What is in it

| Address | What it shows |
| --- | --- |
| `/` and the other website addresses | The 37 website pages as real pages, with sample data |
| `/designs/` | A list of every page in the preview |
| `/designs/app/` | 52 phone app screens, as pictures from Figma |
| `/designs/admin/` | 29 staff admin pages, as pictures from Figma |

A bar at the top of every page says it is a design preview. The pages tell
search engines not to list them.

Not in the preview: the tablet layouts of the app (they are in the Figma
file), real products and photos, sign-in, payment, and anything that needs
the backend.

## Where the code is

| Path | What it holds |
| --- | --- |
| `server/site/` | The website pages: layout, components, icons, sample data, one file per group of pages |
| `server/site/pages.ts` | The list of every website page and its address |
| `browser/site.ts` | The small script the pages use (menus, bag panel, endless scrolling, checkout steps) |
| `public/css/`, `public/fonts/`, `public/brand/` | Styles, the two fonts (hosted by us), the logo |
| `preview/build.ts` | Writes the preview into `preview-dist/` |
| `preview/designs/app/`, `preview/designs/admin/` | The pictures from Figma, each folder with an `index.json` list |
| `vercel.json` | Tells Vercel how to build the preview |

## Build it on a computer

```
npm ci
npm run build:preview
```

The preview is written to `preview-dist/` (not committed). To look at it:

```
cd preview-dist
python3 -m http.server 4173
```

then open `http://localhost:4173`.

## Put it on Vercel (owner's steps)

There are no keys, passwords or settings to enter. Everything Vercel needs
is in `vercel.json`.

1. Go to vercel.com and choose **Sign Up**. Pick the **Hobby** plan (free)
   and **Continue with GitHub**, using the GitHub account that can see
   `projectiles-tech-hub/hairbydemj`.
2. When GitHub asks, allow Vercel to access the `projectiles-tech-hub`
   organisation, at least the `hairbydemj` repository.
3. In Vercel choose **Add New**, then **Project**, and **Import** `hairbydemj`.
4. Leave every setting as it is (Framework Preset shows "Other") and press
   **Deploy**.
5. Open **Settings**, then **Environments**, then **Production**, and set the
   branch to `develop`. From then on the main link always shows what is
   merged into `develop`.
6. Vercel gives a link ending in `.vercel.app`. That link is what you share.

Things to know:

- The link is public: anyone who has it can open it.
- The repository must stay public for the free plan to deploy it, because it
  belongs to a GitHub organisation.
- Every pull request also gets its own preview link, shown on the pull
  request page.
- Do not connect `hairbydemj.com` to Vercel. The domain is for the real
  store on the Namecheap server.

## Updating the app and admin pictures

When a design changes in Figma, export the frame as a PNG at 1x, replace the
file of the same name in `preview/designs/app/` or `preview/designs/admin/`,
and rebuild. To add a picture, add the file and a line for it in that
folder's `index.json`.

## Known gaps

- The Product editor picture in the admin gallery is cut at the bottom,
  because the frame overlaps the one below it in the Figma file.
- Photos are placeholders until the owner supplies real ones.
- Prices, product names and counts are samples.

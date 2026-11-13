# Media: product photos and videos

Photos and videos are stored on our own server, resized and compressed with
two free command-line tools, and served with long cache times. No paid
service and no added package. The code is in `server/media/`.

## What the server needs

| Thing | How to get it |
| --- | --- |
| libvips (photos) | `sudo apt install libvips-tools` |
| ffmpeg (video) | `sudo apt install ffmpeg` |
| A folder for the files | Set `MEDIA_DIR`; see below |

When the server starts it checks both tools and writes a clear error to the
log if either is missing. GitHub Actions installs both so the tests run.

## Setting

| Name | Secret? | What it is |
| --- | --- | --- |
| `MEDIA_DIR` | No | Folder for uploads. `uploads` beside the code if not set. On the live server use a folder outside the code, for example `/var/lib/hairbydemj/media`, owned by the user the server runs as. It must be included in the backups (module 19). |

Inside it:

| Folder | What it holds |
| --- | --- |
| `originals/` | Every upload exactly as it arrived. Never sent to visitors. Kept so sizes can be remade later. |
| `public/` | The sizes visitors are sent. This is the only part that is served. |
| `tmp/` | Uploads while they arrive. Emptied when the server starts. |

## What happens to an upload

**A photo** (JPEG, PNG, WebP, or HEIC from an iPhone; up to 25 MB):

1. Who is uploading is checked before any of the file is accepted.
2. The file is recognised by its first bytes; its name and claimed type are
   not trusted. Anything that is not a photo or video is refused.
3. It is refused if it cannot be opened, is under 300 pixels on its shorter
   side, or is over 60 megapixels.
4. Copies are made at 320, 640, 960, 1280 and 1920 pixels wide, each as WebP
   (small, for modern browsers) and JPEG (works everywhere). A photo is never
   enlarged: an 800-pixel photo gets 320, 640 and 800.
5. Phone photos are turned the right way up, and everything hidden in the
   file (camera, date, GPS location) is removed from the copies.
6. The photo is ready as soon as the upload answers.

**A video** (MP4, MOV or WebM; up to 300 MB and 2 minutes):

1. The same checks, then the upload answers at once with "processing".
2. In the background it is turned into one MP4 that every phone and browser
   plays (H.264 picture, AAC sound), at most 1280 pixels on its longer side,
   arranged so it starts playing before it has fully downloaded. Location and
   device details are removed.
3. A still picture is taken from it and resized like a photo; this shows
   before the video plays.
4. It becomes "ready", or "failed" with the reason. The shop only ever shows
   ready items.
5. If the server restarts mid-way, the video is picked up again at start-up.

A product can have up to **10 photos and 1 video**, as in the product editor.

## Addresses of the files

Every file is under `/media/`, on all three addresses:

```
/media/p/<product id>/<random key>/640.webp
/media/p/<product id>/<random key>/640.jpg
/media/p/<product id>/<random key>/video.mp4
```

The catalogue gives each photo as a `path` (`p/12/3fa9…`), a description
(`alt`) and the `widths` that exist. The website and app build the address
from those and let the browser pick the best size.

Because the key is random and a file's content never changes, each file is
sent with `Cache-Control: public, max-age=31536000, immutable`: browsers
and Cloudflare may keep it for a year without checking back. Replacing a
photo means uploading a new one, which gets a new address.

Videos can be fetched in parts (`Range` requests), which players need to
start early and to skip ahead.

## Pictures for the shop itself

The top banner and promotional banners on the homepage, category pictures
and collection banners are uploaded in the admin (Homepage; Categories and
collections) and go through the same checks and cleaning as product photos:
recognised by their first bytes, turned the right way up, hidden details
removed, WebP and JPEG copies, never enlarged. The code is
`server/admin/pictures.ts` and `storeSitePicture` in `server/media/media.ts`.

| Kind | Sizes made (pixels wide) | Smallest accepted (shorter side) | Advice shown to staff |
| --- | --- | --- | --- |
| Banners (top banner, promotional banners, collection banners) | 640, 960, 1280, 1920, 2560 | 500 | Desktop: wide, about 2560 × 1100. Phone (optional): tall, about 1200 × 1500 |
| Category pictures | 320, 640, 960 | 300 | Square, at least 960 × 960 |

They are kept under `public/s/` (`s/home/<section>/<key>/`,
`s/category/<id>/<key>/`, `s/collection/<id>/<key>/`), with the originals
under `originals/s/`. Replacing or removing a picture removes its files.
A banner can have a separate phone picture: phones (under 600 pixels wide)
get it, everything else gets the desktop picture; without one, phones show
the desktop picture cropped. The first banner on the page loads straight
away; the rest load as the visitor scrolls.

## Linking to products and variants

- Each photo and video belongs to one product and has a position. The first
  photo is the cover shown in product lists.
- A photo can be given a **colour**. It then stands for every variant of
  that colour, so choosing "613" on the product page can show the 613
  photos. The colour must be one the product is sold in.

## Staff addresses

On the admin address; needs the "products" change permission (view for the list).

| Address | What it does |
| --- | --- |
| `POST /api/products/:id/media?alt=…&colour=…&name=…` | Upload. The request body is the file itself, not a form. Answers 201 for a photo, 202 for a video. |
| `GET /api/products/:id/media` | The product's photos and video, including any still processing or failed |
| `POST /api/products/:id/media/order` | `{ "ids": [...] }`: every item once, in the new order |
| `POST /api/media/:id` | Change `alt` or `colour` |
| `POST /api/media/:id/delete` | Remove it and its files |

Deleting a product removes all its files. Every change is in the activity log.

## For deployment (module 19)

- Caddy should serve `/media/*` straight from `MEDIA_DIR/public` on all
  three addresses, with the same cache header; the Node server also serves
  it, so nothing breaks without that.
- The server's request time limit is 15 minutes, to allow a large video on a
  slow connection. Small JSON requests keep a 30-second limit.
- Cloudflare's free plan accepts uploads up to 100 MB per request. Videos
  larger than that would need the admin address to bypass Cloudflare, or a
  lower limit; to settle then.

## Not in this module

The upload buttons and photo grid in the admin come with module 14. Photos
that customers add to reviews come with module 17 and will reuse this code.
Video compression will move to the background worker when module 10 is built.
